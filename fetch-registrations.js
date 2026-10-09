#!/usr/bin/env node
import "dotenv/config";
import { parseArgs } from "node:util";
import { STATES, DAYS_BACK } from "./config.js";
import { fetchDatasetMetadata, fetchAllRows } from "./src/socrata.js";
import { detectSchema, assertRequiredColumns, printMapping } from "./src/schema.js";
import { normalizeRow } from "./src/normalize.js";
import { passesFilters, buildKeywordWhereFragment } from "./src/filters.js";
import { writeCsv } from "./src/csvWriter.js";
import { upsertToSqlite } from "./src/sqliteStore.js";

const HELP = `
Usage:
  node fetch-registrations.js --states CO NY [--days 30] [--sample]
  node fetch-registrations.js --states CO [--days 30] [--out output/] [--active-only] [--sqlite path.db]

Options:
  --states       One or more state keys from config.js (space-separated). Required.
  --days         How many days back counts as "newly registered". Default: ${DAYS_BACK}.
  --sample       Fetch only 5 rows per state, print the detected schema mapping and one
                 sample row, then exit. Use this to verify a new state before a full run.
  --out          Output directory for the CSV. Default: output/
  --active-only  If the dataset has a status column, only keep rows that look active/good-standing.
  --sqlite       Path to a SQLite DB file. Upserts on (state, entity_id) so repeat runs
                 only add newly-seen entities. Requires "npm install better-sqlite3".
  --help         Show this help.
`;

/**
 * node:util's parseArgs has no "nargs" concept, so a flag like
 * `--states CO NY` (multiple bare values after one flag) can't be expressed
 * directly. This pulls consecutive non-flag tokens following --states out of
 * argv before handing the rest to parseArgs.
 */
function extractStates(argv) {
  const states = [];
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--states") {
      i++;
      while (i < argv.length && !argv[i].startsWith("--")) {
        states.push(argv[i]);
        i++;
      }
      i--;
    } else {
      rest.push(argv[i]);
    }
  }
  return { states, rest };
}

function parseCliArgs() {
  const { states, rest } = extractStates(process.argv.slice(2));
  const { values } = parseArgs({
    args: rest,
    options: {
      days: { type: "string" },
      sample: { type: "boolean", default: false },
      out: { type: "string", default: "output" },
      sqlite: { type: "string" },
      "active-only": { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
  });

  if (values.help) {
    console.log(HELP);
    process.exit(0);
  }

  if (states.length === 0) {
    console.error("Error: --states is required, e.g. --states CO NY\n" + HELP);
    process.exit(1);
  }

  const unknown = states.filter((s) => !STATES[s]);
  if (unknown.length > 0) {
    console.error(
      `Error: unknown state key(s): ${unknown.join(", ")}. Available: ${Object.keys(STATES).join(", ")}`
    );
    process.exit(1);
  }

  return {
    states,
    days: values.days ? Number(values.days) : DAYS_BACK,
    sample: values.sample,
    out: values.out,
    sqlitePath: values.sqlite,
    activeOnly: values["active-only"],
  };
}

function isoDaysAgo(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 19);
}

function buildWhereClause({ dateCol, statusCol, keywordFragment }, sinceIso, activeOnly) {
  const clauses = [`${dateCol} > '${sinceIso}'`];
  if (activeOnly) {
    if (statusCol) {
      clauses.push(`(upper(${statusCol}) like '%GOOD%' OR upper(${statusCol}) like '%ACTIV%')`);
    } else {
      console.warn("  [active-only] No status column detected; skipping active-only filter for this state.");
    }
  }
  if (keywordFragment) clauses.push(keywordFragment);
  return clauses.join(" AND ");
}

async function processState(stateKey, opts, token) {
  const { domain, datasetId, overrides = {} } = STATES[stateKey];
  if (!domain || !datasetId) {
    throw new Error(STATES[stateKey].unavailableReason);
  }
  console.log(`\n=== ${stateKey} (${domain}/${datasetId}) ===`);

  const columns = await fetchDatasetMetadata(domain, datasetId, token);
  const mapping = detectSchema(columns, overrides);
  assertRequiredColumns(mapping, stateKey);
  printMapping(stateKey, mapping);

  const sinceIso = isoDaysAgo(opts.days);
  const keywordFragment = buildKeywordWhereFragment(mapping.nameCol);
  const where = buildWhereClause(mapping, sinceIso, opts.activeOnly);
  const order = `${mapping.dateCol} DESC, ${mapping.idCol} ASC`;

  const maxRows = opts.sample ? 5 : Infinity;
  let lastLogged = 0;
  const rawRows = await fetchAllRows(domain, datasetId, token, {
    where,
    order,
    pageSize: opts.sample ? 5 : 1000,
    maxRows,
    onPage: (_pageLen, total) => {
      if (!opts.sample && total - lastLogged >= 1000) {
        console.log(`  fetched ${total} rows so far...`);
        lastLogged = total;
      }
    },
  });

  const seen = new Map();
  let duplicates = 0;
  for (const row of rawRows) {
    const normalized = normalizeRow(row, { stateKey, domain, mapping });
    const id = normalized.entity_id;
    if (id && seen.has(id)) {
      duplicates++;
      continue;
    }
    if (id) seen.set(id, normalized);
    else seen.set(Symbol(), normalized); // rows with no id: keep, can't dedupe
  }
  const deduped = [...seen.values()];

  const filtered = deduped.filter(passesFilters);

  console.log(
    `  rows fetched: ${rawRows.length} | duplicates removed: ${duplicates} | rows after filters: ${filtered.length}`
  );

  return { stateKey, rawCount: rawRows.length, duplicates, filtered };
}

async function main() {
  const opts = parseCliArgs();
  const token = process.env.SOCRATA_APP_TOKEN;
  if (!token) {
    console.warn(
      "\n[warning] No SOCRATA_APP_TOKEN set. Requests will use Socrata's low, unauthenticated rate limit. " +
        "See README for how to get a free token.\n"
    );
  }

  const results = [];
  const failedStates = [];
  for (const stateKey of opts.states) {
    try {
      const result = await processState(stateKey, opts, token);
      results.push(result);
    } catch (err) {
      console.error(`\n[error] ${stateKey}: ${err.message}`);
      failedStates.push(stateKey);
    }
  }

  if (failedStates.length > 0) process.exitCode = 1;

  if (opts.sample) {
    for (const r of results) {
      console.log(`\nSample row for ${r.stateKey}:`);
      console.log(r.filtered[0] ? JSON.stringify(r.filtered[0], null, 2) : "(no rows returned)");
    }
    return;
  }

  const allRows = results.flatMap((r) => r.filtered);

  if (allRows.length === 0) {
    console.log("\nNo rows to write after filtering. Exiting without writing a CSV.");
    return;
  }

  const csvPath = writeCsv(allRows, opts.out);

  let sqliteSummary = null;
  if (opts.sqlitePath) {
    sqliteSummary = await upsertToSqlite(allRows, opts.sqlitePath);
  }

  const dates = allRows.map((r) => r.formation_date).filter(Boolean).sort();
  const dateRange = dates.length > 0 ? `${dates[0]} to ${dates[dates.length - 1]}` : "(none)";

  console.log("\n=== Summary ===");
  for (const r of results) {
    console.log(
      `  ${r.stateKey}: fetched ${r.rawCount}, duplicates removed ${r.duplicates}, kept ${r.filtered.length}`
    );
  }
  console.log(`  Total rows written: ${allRows.length}`);
  console.log(`  Formation date range: ${dateRange}`);
  console.log(`  CSV written to: ${csvPath}`);
  if (sqliteSummary) {
    console.log(
      `  SQLite (${opts.sqlitePath}): ${sqliteSummary.inserted} new rows inserted, ${sqliteSummary.skippedExisting} already present`
    );
  }
}

main().catch((err) => {
  console.error("\n[fatal]", err);
  process.exit(1);
});
