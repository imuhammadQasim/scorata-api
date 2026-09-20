// Fuzzy column detection: maps a dataset's raw columns to the fields this
// tool needs, with manual per-state overrides taking priority.

const DATE_TYPES = ["calendar_date", "floating_timestamp"];

function findColumn(columns, regexes, { typeFilter, exclude } = {}) {
  for (const re of regexes) {
    for (const col of columns) {
      if (exclude && exclude.test(col.fieldName)) continue;
      if (typeFilter && !typeFilter.includes(col.dataTypeName)) continue;
      if (re.test(col.fieldName)) return col.fieldName;
    }
  }
  return undefined;
}

/**
 * Detect the column mapping for a dataset.
 * @param {{fieldName:string, dataTypeName:string, name:string}[]} columns
 * @param {object} overrides manual per-state overrides
 * @returns {object} mapping of logical field -> fieldName (or undefined)
 */
export function detectSchema(columns, overrides = {}) {
  const nonPersonExclude = /agent|officer|director|chairman|ceo|president|incorporator/i;

  const dateCol =
    overrides.dateCol ||
    findColumn(
      columns,
      [/(form|creat|regist|filing).*date/i, /date.*(form|creat|regist|filing)/i, /(form|creat|regist|filing)/i],
      { typeFilter: DATE_TYPES }
    );

  const idCol =
    overrides.idCol ||
    findColumn(columns, [
      /^(entity|dos|filing|business|registration)_?id$/i,
      /_id$/i,
      /^id$/i,
    ]);

  const nameCol =
    overrides.nameCol ||
    findColumn(
      columns,
      [/^(entity|business|current_entity|company|corp|filer|dba)_?name$/i, /name/i],
      { exclude: nonPersonExclude }
    );

  const typeCol =
    overrides.typeCol ||
    findColumn(columns, [/entity_?type|business_?type|corp(oration)?_?type|filing_?type/i, /type/i], {
      exclude: /address|agent/i,
    });

  const statusCol =
    overrides.statusCol ||
    findColumn(columns, [/entity_?status|filing_?status|business_?status|^status$/i, /status/i]);

  const cityCol =
    overrides.cityCol ||
    findColumn(columns, [/principal.*city|business.*city|mailing.*city|^city$/i, /city/i], {
      exclude: nonPersonExclude,
    });

  const zipCol =
    overrides.zipCol ||
    findColumn(
      columns,
      [/principal.*zip|business.*zip|mailing.*zip|^zip(code)?$/i, /zip|postal/i],
      { exclude: nonPersonExclude }
    );

  return {
    dateCol,
    idCol,
    nameCol,
    typeCol,
    statusCol,
    cityCol,
    zipCol,
  };
}

export function assertRequiredColumns(mapping, stateKey) {
  const required = ["dateCol", "idCol", "nameCol"];
  const missing = required.filter((key) => !mapping[key]);
  if (missing.length > 0) {
    throw new Error(
      `[${stateKey}] Could not auto-detect required column(s): ${missing.join(
        ", "
      )}. Add a manual override in config.js (STATES.${stateKey}.overrides) after inspecting the dataset's real field names.`
    );
  }
}

export function printMapping(stateKey, mapping) {
  console.log(`\nDetected column mapping for ${stateKey}:`);
  const rows = Object.entries(mapping).map(([logical, fieldName]) => ({
    field: logical,
    mapsTo: fieldName || "(not found)",
  }));
  console.table(rows);
}
