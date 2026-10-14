#!/usr/bin/env node
// Find a phone number for each business in a fetch-registrations CSV, using
// an OpenAI model with web search to locate the business's own website or
// Facebook page. The model only points at pages; this script decides what to
// keep:
//   - a website is kept only if its domain contains the business name and the
//     site shows it is in the right state; its phone is read from the site
//     itself, not from the model
//   - a Facebook page is kept only if the page name is exactly the business
//     name and it shows the right location (or a local phone)
import "dotenv/config";
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { stringify } from "csv-stringify/sync";
import { coreName } from "./src/names.js";
import { readSite, formatPhone, phonesInText, phonesInTelLinks } from "./src/web.js";
import { stateName } from "./src/states.js";

const DEFAULT_MODEL = "gpt-5.4-nano";

const HELP = `
Usage:
  node find-phones.js --in output/new_businesses_YYYY-MM-DD.csv [--limit 10] [--offset 0]
                     [--min-age 14] [--model ${DEFAULT_MODEL}] [--out output/]

  --min-age  Only look up businesses at least this many days old (new ones aren't online yet).

Needs OPENAI_API_KEY in .env. Each lead costs one model request with web
search, so start with a small --limit.
`;

// ------------------------------------------------------------------ CSV in --

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = "";
  let quoted = false;
  const s = text.replace(/^﻿/, "");
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (quoted) {
      if (c === '"' && s[i + 1] === '"') {
        field += '"';
        i++;
      } else if (c === '"') quoted = false;
      else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      row.push(field);
      field = "";
    } else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else field += c;
  }
  if (field || row.length) {
    row.push(field);
    rows.push(row);
  }
  const [header, ...body] = rows.filter((r) => r.some((v) => v !== ""));
  return body.map((r) => Object.fromEntries(header.map((h, i) => [h, r[i] ?? ""])));
}

// ------------------------------------------------------------------ OpenAI --

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["candidates"],
  properties: {
    candidates: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["kind", "url", "page_name", "phone", "location_shown"],
        properties: {
          kind: { type: "string", enum: ["website", "facebook"] },
          url: { type: "string" },
          page_name: { type: "string" },
          phone: { type: ["string", "null"] },
          location_shown: { type: ["string", "null"] },
        },
      },
    },
  },
};

function prompt(lead) {
  return `Find this newly registered US business online.

Business name: ${lead.business_name}
Registered: ${lead.formation_date} (very new)
Location: ${lead.city}, ${lead.state} ${lead.zip}
Registered agent (often the owner): ${lead.agent_type === "person" ? lead.agent_name : "unknown"}

Search the web for this exact business. Return only pages that clearly belong to THIS business:
its own website and/or its Facebook page. Ignore directories and registry listings (Bizapedia,
OpenCorporates, state records). Many businesses in other states share similar names: skip any
page whose name differs or whose location is elsewhere.

For each page give: kind ("website" or "facebook"), url, page_name (the business name exactly as
the page shows it), phone (exactly as shown on the page, or null), location_shown (city/state the
page shows, or null). Never guess or invent a phone number. If nothing clearly matches, return an
empty list.`;
}

async function lookUp(lead, model, apiKey) {
  for (let attempt = 1; ; attempt++) {
    try {
      return await lookUpOnce(lead, model, apiKey);
    } catch (err) {
      // Network drops and rate limits are worth a second try; bad keys aren't.
      if (err.fatal || attempt >= 3) throw err;
      await new Promise((resolve) => setTimeout(resolve, 3000 * attempt));
    }
  }
}

async function lookUpOnce(lead, model, apiKey) {
  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      model,
      tools: [{ type: "web_search" }],
      input: prompt(lead),
      text: { format: { type: "json_schema", name: "business_pages", strict: true, schema: SCHEMA } },
    }),
    signal: AbortSignal.timeout(120_000),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error?.message || `HTTP ${response.status}`;
    const fatal = [401, 403, 404].includes(response.status) || /quota|billing/i.test(message);
    throw Object.assign(new Error(`OpenAI: ${message}`), { fatal });
  }

  const text = (data.output || [])
    .filter((item) => item.type === "message")
    .flatMap((item) => item.content || [])
    .find((c) => c.type === "output_text")?.text;
  const searches = (data.output || []).filter((item) => item.type === "web_search_call").length;
  let candidates = [];
  try {
    candidates = JSON.parse(text || "{}").candidates || [];
  } catch {
    candidates = [];
  }
  return { candidates, searches, tokens: data.usage?.total_tokens || 0 };
}

// --------------------------------------------------------------- checking --

const squash = (s) => String(s || "").toLowerCase().replace(/[^a-z0-9]/g, "");

function hostKey(url) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, "").toLowerCase();
    return { host, key: squash(host.split(".").slice(0, -1).join("")) };
  } catch {
    return { host: "", key: "" };
  }
}

// Words that describe the kind of business and are often left out of a
// domain ("AetherGuardian Internet Services" -> aetherguardian.net).
const GENERIC_TAIL = new Set(
  `services service solutions group company co enterprises enterprise consulting internet
   technologies technology tech studio studios collective partners holdings ltd llc inc`.split(/\s+/)
);

/**
 * Does the domain name this business? Either it contains the whole name
 * ("kestrelmechanical.com", "shinycleanllc.com"), or it is the name without
 * its generic last words, plus at most "llc"/"co"/"inc" or the state
 * ("co"/"colorado" for a Colorado lead). A different word in their place
 * ("silverpeakpartners" for "Silver Peak Enterprises") is another business.
 */
function domainNamesBusiness(domainKey, lead) {
  const full = squash(coreName(lead.business_name));
  if (full.length >= 4 && domainKey.includes(full)) return true;
  const tokens = coreName(lead.business_name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  while (tokens.length > 1 && GENERIC_TAIL.has(tokens[tokens.length - 1])) tokens.pop();
  const head = tokens.join("");
  if (head.length < 6) return false;
  const state = [String(lead.state || "").toLowerCase(), squash(stateName(lead.state))].filter(Boolean);
  return new RegExp(`^${head}(${["llc", "co", "inc", ...state].join("|")})?$`).test(domainKey);
}

const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * Does this text place the business in the lead's city or state? The ZIP,
 * the city, the state's full name, or its code written as in an address
 * (", CO" or "CO 80403"); a bare "CO"/"IN"/"OR" is too common a word to count.
 */
function showsLocation(text, lead) {
  const t = String(text || "");
  const zip5 = (lead.zip || "").slice(0, 5);
  if (/^\d{5}$/.test(zip5) && new RegExp(`\\b${zip5}\\b`).test(t)) return true;
  if (lead.city && new RegExp(`\\b${escapeRe(lead.city)}\\b`, "i").test(t)) return true;
  const name = stateName(lead.state);
  if (name && new RegExp(`\\b${escapeRe(name)}\\b`, "i").test(t)) return true;
  const code = String(lead.state || "").toUpperCase();
  return Boolean(code) && new RegExp(`,\\s*${code}\\b|\\b${code}\\s+\\d{5}\\b`).test(t);
}

async function checkWebsite(c, lead, nameKey) {
  const { host, key } = hostKey(c.url);
  if (!host || host.endsWith("facebook.com")) return null;
  if (!domainNamesBusiness(key, lead)) return { rejected: `domain ${host} doesn't match the name` };

  const site = await readSite(c.url);
  const modelPhone = formatPhone(c.phone);
  if (!site) {
    // The domain matches, but we couldn't confirm anything on the page.
    return { website: c.url, phone: modelPhone, phoneSource: modelPhone ? "website (not verified: site didn't load)" : "" };
  }

  const phones = [...phonesInTelLinks(site.html), ...phonesInText(site.text)].filter((p, i, a) => a.indexOf(p) === i);
  if (!showsLocation(site.text, lead)) {
    return { rejected: `${host} shows no ${lead.state} location (same name, other business)` };
  }
  const phone = (modelPhone && phones.includes(modelPhone) && modelPhone) || phones[0] || "";
  return { website: site.url, phone, phoneSource: phone ? "website" : "" };
}

function checkFacebook(c, lead, nameKey) {
  const { host } = hostKey(c.url);
  if (!host.endsWith("facebook.com")) return null;
  if (squash(coreName(c.page_name)) !== nameKey) {
    return { rejected: `Facebook page "${c.page_name}" isn't the exact name` };
  }
  const phone = formatPhone(c.phone);
  if (!showsLocation(c.location_shown, lead)) {
    return { rejected: `Facebook page "${c.page_name}" shows no ${lead.state} location` };
  }
  return { facebook: c.url, phone, phoneSource: phone ? "facebook (check before calling)" : "" };
}

async function findPhone(lead, model, apiKey) {
  const { candidates, searches, tokens } = await lookUp(lead, model, apiKey);
  const nameKey = squash(coreName(lead.business_name));
  const result = { website: "", facebook: "", phone: "", phoneSource: "", notes: [] };

  for (const c of candidates) {
    const checked = c.kind === "facebook" ? checkFacebook(c, lead, nameKey) : await checkWebsite(c, lead, nameKey);
    if (!checked) continue;
    if (checked.rejected) {
      result.notes.push(checked.rejected);
      continue;
    }
    if (checked.website && !result.website) result.website = checked.website;
    if (checked.facebook && !result.facebook) result.facebook = checked.facebook;
    // A phone read from the site itself beats any other.
    const better = !result.phone || (checked.phoneSource === "website" && result.phoneSource !== "website");
    if (checked.phone && better) {
      result.phone = checked.phone;
      result.phoneSource = checked.phoneSource;
    }
  }
  if (candidates.length === 0) result.notes.push("model found nothing");
  return { ...result, searches, tokens };
}

// -------------------------------------------------------------------- main --

function parseCli() {
  const { values } = parseArgs({
    options: {
      in: { type: "string" },
      limit: { type: "string", default: "10" },
      offset: { type: "string", default: "0" },
      "min-age": { type: "string", default: "14" },
      model: { type: "string", default: process.env.OPENAI_MODEL || DEFAULT_MODEL },
      out: { type: "string", default: "output" },
      help: { type: "boolean", default: false },
    },
  });
  if (values.help || !values.in) {
    console.log(HELP);
    process.exit(values.help ? 0 : 1);
  }
  if (!process.env.OPENAI_API_KEY) {
    console.error("Error: set OPENAI_API_KEY in .env");
    process.exit(1);
  }
  return { ...values, limit: Number(values.limit), offset: Number(values.offset), minAge: Number(values["min-age"]) };
}

async function main() {
  const opts = parseCli();
  // Accepts the call sheet (formed_on, ask_for) as well as a full export
  // (formation_date, agent_name, agent_type).
  const all = parseCsv(fs.readFileSync(opts.in, "utf8")).map((r) => ({
    ...r,
    formation_date: r.formation_date || r.formed_on || "",
    agent_name: r.agent_name || r.ask_for || "",
    agent_type: r.agent_type || (r.ask_for ? "person" : ""),
  }));
  // A business only a few days old is rarely online yet: skip it until it is
  // at least --min-age days old.
  const cutoff = new Date(Date.now() - opts.minAge * 86_400_000).toISOString().slice(0, 10);
  const oldEnough = all.filter((l) => l.formation_date && l.formation_date <= cutoff);
  // Owner-run filings first; ones parked at an agent company's address last.
  const ordered = [...oldEnough].sort(
    (a, b) =>
      (a.virtual_address === "yes") - (b.virtual_address === "yes") ||
      (b.agent_type === "person") - (a.agent_type === "person")
  );
  const leads = ordered.slice(opts.offset, opts.offset + opts.limit);
  console.log(
    `${oldEnough.length} of ${all.length} leads are at least ${opts.minAge} days old. ` +
      `Looking up ${leads.length} with ${opts.model} + web search...\n`
  );

  const found = [];
  const notFound = [];
  let searches = 0;
  let tokens = 0;

  for (const lead of leads) {
    let r;
    try {
      r = await findPhone(lead, opts.model, process.env.OPENAI_API_KEY);
    } catch (err) {
      console.error(`  [error] ${lead.business_name}: ${err.message}`);
      if (err.fatal) break;
      continue;
    }
    searches += r.searches;
    tokens += r.tokens;

    const row = {
      business_name: lead.business_name,
      phone: r.phone,
      phone_source: r.phoneSource,
      ask_for: lead.agent_type === "person" ? lead.agent_name : "",
      website: r.website,
      facebook: r.facebook,
      city: lead.city,
      zip: lead.zip,
      formed_on: lead.formation_date,
      address: lead.address,
      notes: r.notes.join("; "),
      entity_id: lead.entity_id,
      call_result: "",
    };
    // The business's own website or Facebook page is enough, even without a phone.
    const hit = Boolean(r.website || r.facebook);
    (hit ? found : notFound).push(row);
    console.log(
      `  ${hit ? "FOUND" : "  -  "}  ${lead.business_name}  ${r.phone || r.website || r.facebook}` +
        (r.notes.length ? `\n         ${r.notes.join("; ")}` : "")
    );
  }

  fs.mkdirSync(opts.out, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, "-");
  const write = (name, rows) => {
    if (rows.length === 0) return null;
    const file = path.join(opts.out, `${name}_${stamp}.csv`);
    // BOM so Excel opens the file as UTF-8.
    fs.writeFileSync(file, "﻿" + stringify(rows, { header: true }), "utf8");
    return file;
  };
  const files = [write("found", found), write("not_found", notFound)].filter(Boolean);

  const withPhone = found.filter((r) => r.phone).length;
  console.log(`\nFound ${found.length} (${withPhone} with a phone), not found ${notFound.length}.`);
  console.log(`Model: ${opts.model} | web searches: ${searches} | tokens: ${tokens}`);
  if (files.length) console.log(`Files:\n  ${files.join("\n  ")}`);
}

main().catch((err) => {
  console.error("\n[fatal]", err);
  process.exit(1);
});
