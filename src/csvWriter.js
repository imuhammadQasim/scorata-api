import fs from "node:fs";
import path from "node:path";
import { stringify } from "csv-stringify/sync";
import { OUTPUT_COLUMNS } from "./normalize.js";

export function writeCsv(rows, outDir) {
  fs.mkdirSync(outDir, { recursive: true });
  const dateStamp = new Date().toISOString().slice(0, 10);
  const filePath = path.join(outDir, `new_businesses_${dateStamp}.csv`);

  const csv = stringify(rows, {
    header: true,
    columns: OUTPUT_COLUMNS,
  });

  fs.writeFileSync(filePath, csv, "utf8");
  return filePath;
}
