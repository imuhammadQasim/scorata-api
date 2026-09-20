# scorata-api

CLI that pulls newly registered businesses from US state open-data portals
(Socrata / SODA API) into a normalized CSV, for later enrichment and B2B
outreach. Uses only official open-data endpoints — no scraping.

## What it outputs

For each row it writes:

| column | meaning |
|---|---|
| `state` | state key from `config.js` (e.g. `CO`) |
| `entity_id` | the state's unique entity/filing ID |
| `business_name` | registered business name |
| `entity_type` | the state's raw entity-type value (e.g. `DLLC`, `DOMESTIC BUSINESS CORPORATION`) |
| `formation_date` | registration/formation date, `YYYY-MM-DD` |
| `city` | city from the entity's on-file address |
| `zip` | zip from the entity's on-file address |
| `source_domain` | which Socrata domain the row came from |

This is intentionally a lean, lookup-ready schema (enough to find the
business online or in a state registry search) rather than a full filing
record. If you need more fields (street address, registered agent, status,
etc.) later, they're one line to add back in `src/normalize.js` and
`src/schema.js` — the raw API rows already carry them.

## Setup

```bash
npm install
cp .env.example .env
```

### Getting a free Socrata app token

The tool works without a token, but Socrata heavily rate-limits anonymous
requests, so you'll hit 429s on anything but tiny `--sample` runs.

1. Create a free account at the Socrata domain you're pulling from (e.g.
   https://data.colorado.gov/signup), or at https://data.cityofchicago.org/signup
   which is accepted federation-wide.
2. Go to your profile → **Edit Profile** → **Developer Settings** → **Create New App Token**.
3. Copy the token into `.env`:
   ```
   SOCRATA_APP_TOKEN=your_token_here
   ```

The token is sent as the `X-App-Token` header. It is never logged or
hardcoded — if it's missing, the tool prints a warning and keeps going at the
lower anonymous rate limit.

## Usage

```bash
# Verify a state's schema mapping + one sample row before trusting it
node fetch-registrations.js --states CO NY --sample

# Full 30-day fetch, writes output/new_businesses_YYYY-MM-DD.csv
node fetch-registrations.js --states CO --days 30

# Multiple states, custom output dir, only active/good-standing entities
node fetch-registrations.js --states CO NY --days 30 --out output/ --active-only

# Also upsert into SQLite (dedupes across daily runs)
node fetch-registrations.js --states CO --sqlite data/businesses.db
```

Run `node fetch-registrations.js --help` for the full flag list.

`--sqlite` requires the optional native dependency `better-sqlite3`
(`npm install better-sqlite3`); it's not installed by default so the core
tool has zero native/build dependencies. If your Node version is too new for
better-sqlite3 to have a prebuilt binary, `npm install` will try to compile
it from source, which on Windows requires the "Desktop development with C++"
Visual Studio workload; if you hit a `node-gyp`/`find-visualstudio` error and
don't want to install that, either use an LTS Node version or skip `--sqlite`
and rely on the CSV output only.

## Adding a new state

Don't guess dataset IDs — every state's open-data portal structures its
business-entity dataset differently, and some domains have several
similarly-named datasets (filings, transaction history, aggregated counts,
active-only snapshots, etc.) where only one is actually useful.

1. **Find a candidate** with the Socrata Discovery API:
   ```
   https://api.us.socrata.com/api/catalog/v1?domains={domain}&q=business%20entities
   ```
   Replace `{domain}` with the state's Socrata domain (e.g. `data.ny.gov`).
   Look at `resource.name` and `resource.type` — you want an entity-level
   `dataset`, not a `chart`/`visualization`, and not a monthly aggregate.

2. **Confirm it** by reading its metadata:
   ```
   https://{domain}/api/views/{datasetId}.json
   ```
   Check `columns[].fieldName` / `dataTypeName` for a formation/filing date
   column and an entity name column. If you don't see either, it's the wrong
   dataset.

3. **Add it to `config.js`** under `STATES`, with no `overrides` yet.

4. **Run `--sample`** and read the printed mapping + sample row carefully:
   ```
   node fetch-registrations.js --states XX --sample
   ```
   If a field mapped to `(not found)` or to the wrong column (compare against
   the metadata from step 2), add a manual `overrides` entry for that state
   (valid keys: `dateCol`, `idCol`, `nameCol`, `typeCol`, `statusCol`,
   `cityCol`, `zipCol`).

5. Once the sample row looks right, run a full fetch and sanity-check row
   counts and the date range in the summary output.

## Known gotchas

- **`fieldName` vs. CSV label.** Socrata's metadata has both a human label
  (`columns[].name`, e.g. "Current Entity Name") and an API field name
  (`columns[].fieldName`, e.g. `current_entity_name`). Only `fieldName` works
  in `$where`/`$order`/`$select` — this tool always uses `fieldName`. If you
  add overrides by copy-pasting from a dataset's web UI, make sure you copied
  the field name, not the display label.

- **Entity-type formatting varies by state.** Colorado uses short codes
  (`DLLC`, `DPC`, `FPC`...); New York spells it out (`DOMESTIC LIMITED
  LIABILITY COMPANY`, `DOMESTIC BUSINESS CORPORATION`). The default
  `ENTITY_TYPES_KEEP = ["LLC", "Corporation", "INC"]` in `config.js` matches
  Colorado's LLC codes and New York's "CORPORATION" rows, but will **not**
  match New York's spelled-out `LIMITED LIABILITY COMPANY` type — extend the
  list (e.g. add `"LIMITED LIABILITY"`) if you need those. Always check real
  values with `--sample` (or a `$select=entity_type,count(*)&$group=entity_type`
  query against the dataset) before assuming a filter works for a new state.

- **A dataset's "populated address" isn't always the obvious one.** New
  York's `n9v6-gdp6` dataset has `location_address_1/city/zip`,
  `chairman_address_1/city/zip`, and `dos_process_address_1/city/zip` — but
  for *recently filed* entities, only `dos_process_*` is populated;
  `location_*` is only backfilled for older records. The auto-detector here
  happens to pick `dos_process_*` for NY because it appears earliest among
  non-excluded columns, but this is exactly the kind of thing `--sample`
  exists to catch — always check for empty columns in the sample row before
  trusting a new state's mapping.

- **One row per officer/associated name.** Some states (Oregon, Pennsylvania)
  publish one row per officer or registered name rather than one row per
  entity, so a raw fetch will contain duplicate `entity_id`s. This tool
  de-duplicates on `entity_id` after fetching (keeping the first-seen row per
  ID, since results are ordered by formation date) and logs how many
  duplicates were removed. If you add one of these states, double-check the
  "duplicates removed" count in the summary looks sane relative to fetched
  rows — a suspiciously low count may mean the ID column wasn't
  auto-detected correctly.

- **Refresh lag.** Not every dataset updates daily. Oregon's business
  registry extract, for example, refreshes roughly weekly, so a `--days 1`
  or `--days 7` run right after a refresh can look like registrations
  suddenly "catch up" in a batch, and a run right before the next refresh can
  look artificially quiet. Check a dataset's metadata page (`rowsUpdatedAt`)
  or its portal listing for its actual refresh cadence before relying on
  short `--days` windows.

- **No status column doesn't mean "unknown status."** New York's dataset
  (`n9v6-gdp6`) is *already* filtered to active corporations by the state, so
  there's no status field to detect — `--active-only` prints a note and
  no-ops for states like this rather than failing.

## Design notes

- Node 18+, ES modules, built-in `fetch` and `node:util` `parseArgs` — no
  axios/node-fetch/commander/yargs.
- All Socrata requests go through `src/socrata.js`, which adds a 30s timeout
  (`AbortSignal.timeout`), retries with exponential backoff + jitter on 429
  and 5xx (respecting `Retry-After` when present, max 5 attempts), and
  raises clear errors for bad domains, bad dataset IDs, and unknown-column
  400s (which usually means a column override is wrong).
- Pagination uses `$limit=1000` + `$offset`, ordered by
  `{dateCol} DESC, {idCol} ASC` so pages stay stable even if new rows are
  inserted mid-run.
- `KEYWORDS_INCLUDE`/`KEYWORDS_EXCLUDE`/`ENTITY_TYPES_KEEP` filtering always
  happens client-side after fetching (`src/filters.js`); when
  `KEYWORDS_INCLUDE` is non-empty it's *also* pushed into the SoQL `$where`
  clause as an optimization to cut down on rows transferred, but the
  post-fetch filter still re-checks everything.

## Out of scope

This tool only produces the lead list. It does not scrape websites, send
emails, or do phone/email enrichment — that's a separate, later step (e.g.
Google Places / Hunter / Apollo).
