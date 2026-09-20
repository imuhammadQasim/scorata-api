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

  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");

  const columnDefs = OUTPUT_COLUMNS.map((c) => `${c} TEXT`).join(", ");

  db.exec(`
    CREATE TABLE IF NOT EXISTS businesses (
      ${columnDefs},
      PRIMARY KEY (state, entity_id)
    );
  `);

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
