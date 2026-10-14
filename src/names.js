// Helpers for working with registered business names.

const LEGAL_SUFFIX =
  /[\s,.]*(limited liability company|limited liability co|l\.?\s?l\.?\s?c\.?|p\.?\s?l\.?\s?l\.?\s?c\.?|ltd\.?|limited|inc\.?|incorporated|corp\.?|corporation|p\.?c\.?)\s*$/i;

// ", Dissolved October 5, 2026" / ", Colorado Authority Relinquished ..." that
// some registries append to the name of a closed entity.
const STATUS_SUFFIX = /,\s*(dissolved|[a-z ]*authority relinquished|withdrawn|revoked)\b.*$/i;

/**
 * The name without its status note and legal suffix(es):
 * "Kestrel Mechanical, LLC" -> "Kestrel Mechanical".
 */
export function coreName(name) {
  let core = String(name || "").replace(STATUS_SUFFIX, "").trim();
  // Strip repeatedly: "Magico llc LLC", "Melody Sullivan ... LLC."
  for (let i = 0; i < 3; i++) {
    const next = core.replace(LEGAL_SUFFIX, "").trim();
    if (next === core) break;
    core = next;
  }
  return core.replace(/[\s,.&-]+$/, "").trim();
}

const STOP_WORDS = new Set(["the", "and", "of", "a", "an", "co", "company", "dba"]);

/** Lowercase alphanumeric words of the core name, minus filler words. */
export function nameTokens(name) {
  return coreName(name)
    .toLowerCase()
    .replace(/&/g, " ")
    .split(/[^a-z0-9]+/)
    .filter((t) => t && !STOP_WORDS.has(t));
}

/** Escape a string for literal use inside a RegExp. */
export function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** One regex that matches any of the words/phrases as whole words. */
export function wordListRegex(words) {
  if (!words || words.length === 0) return null;
  const alternatives = words.map((w) => escapeRegExp(w.trim()).replace(/\s+/g, "\\s+"));
  return new RegExp(`(^|[^a-z0-9])(${alternatives.join("|")})($|[^a-z0-9])`, "i");
}
