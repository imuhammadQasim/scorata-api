import fs from "node:fs";
import path from "node:path";
import { stringify } from "csv-stringify/sync";

/** Google search for the business the way you'd type it: name, state, zip. */
export function googleSearchUrl(row) {
  const zip5 = (row.zip || "").slice(0, 5);
  const query = [row.business_name, row.state, zip5].filter(Boolean).join(" ");
  return `https://www.google.com/search?q=${encodeURIComponent(query)}`;
}

/**
 * Excel and Google Sheets run a cell that starts with = + - @ as a formula,
 * so a registered name like "=1+1 LLC" is written as plain text.
 */
function asText(value) {
  const s = String(value ?? "");
  return /^[=+\-@]/.test(s) ? `'${s}` : s;
}

// The call sheet: only what you need while searching and calling. Every
// other registry column is still stored by --sqlite.
const CALL_SHEET = {
  business_name: (r) => asText(r.business_name),
  // A clickable "Search" cell in Excel / Google Sheets. The URL is encoded,
  // so the name can't break out of the formula.
  google_search: (r) => `=HYPERLINK("${googleSearchUrl(r)}","Search")`,
  ask_for: (r) => asText(r.agent_type === "person" ? r.agent_name : ""),
  phone: () => "",
  website: () => "",
  call_result: () => "",
  notes: () => "",
  city: (r) => asText(r.city),
  state: (r) => r.state,
  zip: (r) => r.zip,
  formed_on: (r) => r.formation_date,
};

export function writeCsv(rows, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filePath = path.join(outDir, `new_businesses_${dateStamp}.csv`);

  const sheet = rows.map((row) =>
    Object.fromEntries(Object.entries(CALL_SHEET).map(([col, get]) => [col, get(row)]))
  );
  const csv = stringify(sheet, { header: true, columns: Object.keys(CALL_SHEET) });

  // BOM so Excel opens the file as UTF-8.
  fs.writeFileSync(filePath, "﻿" + csv, "utf8");
  return filePath;
}
