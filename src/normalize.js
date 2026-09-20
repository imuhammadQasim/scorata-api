export const OUTPUT_COLUMNS = [
  "state",
  "entity_id",
  "business_name",
  "entity_type",
  "formation_date",
  "city",
  "zip",
  "source_domain",
];

function val(row, fieldName) {
  if (!fieldName) return "";
  const v = row[fieldName];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

/**
 * Normalize one raw Socrata row into the unified output schema.
 */
export function normalizeRow(row, { stateKey, domain, mapping }) {
  const rawDate = val(row, mapping.dateCol);

  return {
    state: stateKey,
    entity_id: val(row, mapping.idCol),
    business_name: val(row, mapping.nameCol),
    entity_type: val(row, mapping.typeCol),
    formation_date: rawDate ? rawDate.slice(0, 10) : "",
    city: val(row, mapping.cityCol),
    zip: val(row, mapping.zipCol),
    source_domain: domain,
  };
}
