import {
  STATES,
  KEYWORDS_INCLUDE,
  KEYWORDS_EXCLUDE,
  ENTITY_TYPES_KEEP,
  PROPERTY_HOLDING_WORDS,
  RESELLER_SHELL_WORDS,
} from "../config.js";
import { coreName, wordListRegex } from "./names.js";
import { zipInState, stateName } from "./states.js";

function includesCI(haystack, needle) {
  return haystack.toUpperCase().includes(needle.toUpperCase());
}

const excludeRe = wordListRegex(KEYWORDS_EXCLUDE);
const propertyRe = wordListRegex(PROPERTY_HOLDING_WORDS);
const resellerRe = wordListRegex(RESELLER_SHELL_WORDS);

const CLOSED_STATUS = /dissolv|withdraw|revok|delinquen|relinquish|expire|inactive|cancel|merged|converted/i;
const CLOSED_NAME = /\b(dissolved|authority relinquished|withdrawn)\b/i;

// "1149 S Logan", "5646 S MALTA ST", "15300 E Temple Place 56", "4848 E. Kentucky Ave B":
// a street address used as the company name, which is how single-property
// LLCs are named.
const STREET_WORDS =
  "st|street|ave|avenue|rd|road|dr|drive|ln|lane|way|blvd|boulevard|ct|court|cir|circle|pl|place|pkwy|parkway|hwy|highway|trl|trail|ter|terrace|loop|sq|square|unit|apt|cr|county road";
const ADDRESS_NAME = new RegExp(
  `^\\d{1,6}(-\\d+)?\\s+((([nsew]|north|south|east|west)\\.?\\s+\\S+)|(.*\\b(${STREET_WORDS})\\b))`,
  "i"
);

// "1590 LLC", "95034 LLC": a number and nothing else.
const NUMBER_ONLY = /^[\d\s#-]+$/;

// Mass filings from out-of-state agents append the state's code after the
// suffix: "Leah Schauer LLC CO" in Colorado.
const stateTagged = (name, state) =>
  new RegExp(`\\bl\\.?l\\.?c\\.?\\s+${state}$`, "i").test(name.trim());

// Pinyin syllables. A single all-caps word that is three or more of these
// plus up to three filler letters ("ZHANGTAORD", "WANGCAISK",
// "LIAOZHENGFENGWM") is a bulk-registered shell, not a trading name. It must
// also contain a sound English names rarely have, so "LOLOLASH" (a lash
// studio) or "DECORIUM" don't qualify.
const PINYIN_NAME =
  /^((zh|ch|sh|[bpmfdtnlgkhjqxrzcsyw])?(iang|iong|uang|ang|eng|ing|ong|ian|iao|uai|uan|ai|ei|ao|ou|an|en|in|un|ia|ie|iu|ua|uo|ue|ui|a|o|e|i|u)){3,}[a-z]{0,3}$/i;
const PINYIN_MARKER = /zh|x|q|ng|ao|ui|iu|ei|ai|ou/i;

// Keyboard-mash names ("gswghj", "fhdxg", "cnisnkl"): one lowercase word with
// five consonants in a row, or almost no vowels. "junkcleanouts" passes.
const CONSONANT_RUN = /[bcdfghjklmnpqrstvwxz]{5,}/;
const vowelShare = (s) => (s.match(/[aeiouy]/gi) || []).length / s.length;

// A property *service* business ("Mile High Property Pros", "Property
// Maintenance") is a customer, not a holding company, so the property words
// don't apply to it.
const PROPERTY_SERVICE =
  /\b(services?|pros?|maintenance|management|cleaning|solutions|care|repairs?|inspections?|restoration|preservation|staging|photography|media)\b/i;

function entityTypeAllowed(type, stateConfig) {
  if (stateConfig?.entityTypes) {
    return stateConfig.entityTypes.some((t) => t.toUpperCase() === type.toUpperCase());
  }
  // A "foreign" entity was formed in another state and only registered here;
  // a nonprofit isn't a customer.
  if (/foreign|non.?profit|not.?for.?profit/i.test(type)) return false;
  if (ENTITY_TYPES_KEEP.length === 0) return true;
  if (!type) return false;
  return ENTITY_TYPES_KEEP.some((keep) => includesCI(type, keep) || includesCI(keep, type));
}

function outOfState(row) {
  const stated = (row.address_state || "").trim().toUpperCase();
  if (stated) {
    return stated !== row.state.toUpperCase() && stated !== stateName(row.state).toUpperCase();
  }
  // No state on the address: fall back to whether the ZIP belongs to the state.
  return zipInState(row.zip, row.state) === false;
}

function looksLikeJunkName(core) {
  const singleWord = !/\s/.test(core);
  if (
    singleWord &&
    core.length >= 8 &&
    core === core.toUpperCase() &&
    PINYIN_NAME.test(core) &&
    PINYIN_MARKER.test(core)
  ) {
    return true;
  }
  if (
    singleWord &&
    core.length >= 5 &&
    core === core.toLowerCase() &&
    (CONSONANT_RUN.test(core) || vowelShare(core) < 0.25)
  ) {
    return true;
  }
  return false;
}

/**
 * Why a normalized row should be dropped, or null to keep it. The reason
 * codes are counted in the fetch summary so the filters can be tuned.
 */
export function rejectReason(row) {
  const stateConfig = STATES[row.state];
  const name = row.business_name || "";
  const core = coreName(name);

  if (!entityTypeAllowed(row.entity_type || "", stateConfig)) return "entity_type";
  if (CLOSED_NAME.test(name) || (row.entity_status && CLOSED_STATUS.test(row.entity_status))) {
    return "closed";
  }
  if (outOfState(row)) return "out_of_state";

  if (KEYWORDS_INCLUDE.length > 0 && !KEYWORDS_INCLUDE.some((kw) => includesCI(name, kw))) {
    return "keyword_include";
  }
  if (excludeRe && excludeRe.test(name)) return "keyword_exclude";

  if (!core || NUMBER_ONLY.test(core) || ADDRESS_NAME.test(core)) return "property_address";
  if (propertyRe && propertyRe.test(core) && !PROPERTY_SERVICE.test(core)) return "property_holding";
  if (resellerRe && resellerRe.test(core)) return "reseller_shell";
  if (stateTagged(name, row.state) || looksLikeJunkName(core)) return "junk_name";

  return null;
}

/** Keep the row? (Kept for callers that only need a yes/no.) */
export function passesFilters(normalizedRow) {
  return rejectReason(normalizedRow) === null;
}

/**
 * Build the optional server-side SoQL fragment for KEYWORDS_INCLUDE, to cut
 * down on rows transferred. Post-fetch filtering in rejectReason() still
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
