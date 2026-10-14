import fs from "node:fs";
import path from "node:path";
import { OUTPUT_COLUMNS } from "./normalize.js";

/**
 * Upsert rows into a SQLite database, keyed on (state, entity_id), so
 * repeat daily runs only add entities not already stored. better-sqlite3 is
 * an optional dependency and is only imported when --sqlite is used.
 */
export async function upsertToSqlite(rows, dbPath) {
  let Database;
  try {
    ({ default: Database } = await import("better-sqlite3"));
  } catch (err) {
    throw new Error(
      `--sqlite requires the optional "better-sqlite3" dependency, which is not installed. ` +
        `Run "npm install better-sqlite3" and try again. (${err.message})`
    );
  }

  fs.mkdirSync(path.dirname(path.resolve(dbPath)), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const columnDefs = OUTPUT_COLUMNS.map((c) => `${c} TEXT`).join(", ");

  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      ${columnDefs},
      PRIMARY KEY (state, entity_id)
    );
  `);

  // A database made before a column was added to OUTPUT_COLUMNS gets it now.
  const existing = new Set(db.prepare("PRAGMA table_info(businesses)").all().map((c) => c.name));
  for (const col of OUTPUT_COLUMNS) {
    if (!existing.has(col)) db.exec(`ALTER TABLE businesses ADD COLUMN ${col} TEXT`);
  }

  const insert = db.prepare(`
    INSERT OR IGNORE INTO businesses (${OUTPUT_COLUMNS.join(", ")})
    VALUES (${OUTPUT_COLUMNS.map((c) => `@${c}`).join(", ")})
  `);

  let inserted = 0;
  const runAll = db.transaction((allRows) => {
    for (const row of allRows) {
      const info = insert.run(row);
      inserted += info.changes;
    }
  });
  runAll(rows);

  db.close();
  return { inserted, skippedExisting: rows.length - inserted };
}
