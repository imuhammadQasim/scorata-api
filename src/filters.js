import { KEYWORDS_INCLUDE, KEYWORDS_EXCLUDE, ENTITY_TYPES_KEEP } from "../config.js";

function includesCI(haystack, needle) {
  return haystack.toUpperCase().includes(needle.toUpperCase());
}

/**
 * Apply KEYWORDS_INCLUDE / KEYWORDS_EXCLUDE / ENTITY_TYPES_KEEP to a
 * normalized row. Returns true if the row should be kept.
 */
export function passesFilters(normalizedRow) {
  const name = normalizedRow.business_name || "";

  if (KEYWORDS_INCLUDE.length > 0) {
    const included = KEYWORDS_INCLUDE.some((kw) => includesCI(name, kw));
    if (!included) return false;
  }

  if (KEYWORDS_EXCLUDE.length > 0) {
    const excluded = KEYWORDS_EXCLUDE.some((kw) => includesCI(name, kw));
    if (excluded) return false;
  }

  if (ENTITY_TYPES_KEEP.length > 0) {
    const type = normalizedRow.entity_type || "";
    if (!type) return false;
    const typeMatches = ENTITY_TYPES_KEEP.some(
      (keep) => includesCI(type, keep) || includesCI(keep, type)
    );
    if (!typeMatches) return false;
  }

  return true;
}

/**
 * Build the optional server-side SoQL fragment for KEYWORDS_INCLUDE, to cut
 * down on rows transferred. Post-fetch filtering in passesFilters() still
 * runs regardless, so this is purely an optimization.
 */
export function buildKeywordWhereFragment(nameCol) {
  if (!nameCol || KEYWORDS_INCLUDE.length === 0) return null;
  const clauses = KEYWORDS_INCLUDE.map((kw) => {
    const escaped = kw.toUpperCase().replace(/'/g, "''");
    return `upper(${nameCol}) like '%${escaped}%'`;
  });
  return `(${clauses.join(" OR ")})`;
}
