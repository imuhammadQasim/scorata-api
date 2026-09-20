// Central configuration for fetch-registrations.js.
// Edit this file to add states, tune filters, or override auto-detected columns.

// --- States -----------------------------------------------------------
// Each entry describes one Socrata (SODA API) dataset to pull from.
// domain      = the Socrata site domain (no protocol), e.g. "data.colorado.gov"
// datasetId   = the 4x4 dataset identifier, e.g. "4ykn-tg5h"
// overrides   = optional manual column-mapping overrides. Only needed when the
//               auto-detector in src/schema.js picks the wrong column (see
//               README "Known gotchas"). Valid keys: dateCol, idCol, nameCol,
//               typeCol, statusCol, cityCol, zipCol.
//
// Do NOT guess dataset IDs. To find one for a new state:
//   1. Query the Socrata Discovery API:
//      https://api.us.socrata.com/api/catalog/v1?domains={domain}&q=business%20entities
//   2. Confirm the candidate with its metadata endpoint:
//      https://{domain}/api/views/{datasetId}.json
//   3. Run `node fetch-registrations.js --states XX --sample` and eyeball the
//      detected mapping + sample row before trusting it.
export const STATES = {
  CO: {
    domain: "data.colorado.gov",
    datasetId: "4ykn-tg5h",
    // "Business Entities in Colorado" — verified via metadata + sample rows.
    // No manual overrides needed: entityformdate/entityid/entityname/entitytype/
    // entitystatus/principalcity/principalzipcode all auto-detect.
  },
  NY: {
    domain: "data.ny.gov",
    datasetId: "n9v6-gdp6",
    // "Active Corporations: Beginning 1800" — verified via metadata + sample
    // rows. Despite the dataset's name it covers LLCs and other entity types
    // too (NY's Division of Corporations handles all of them). No manual
    // overrides needed: dos_id/current_entity_name/entity_type/
    // initial_dos_filing_date/dos_process_city/dos_process_zip all auto-detect
    // (location_city/zip, which the detector would otherwise also consider,
    // is empty on recently-filed entities — see README "Known gotchas").
  },
};

// How many days back (from now, UTC) counts as "newly registered".
export const DAYS_BACK = 30;

// Case-insensitive substring match against business_name.
// Empty array = keep all names (no include filter applied).
export const KEYWORDS_INCLUDE = [];

// Case-insensitive substring match against business_name; any match excludes the row.
export const KEYWORDS_EXCLUDE = [
  "holdings",
  "capital",
  "trust",
  "realty",
  "investment",
];

// Loose (case-insensitive substring, either direction) match against the
// state's entity-type field. NOTE: entity-type formatting varies wildly by
// state (e.g. Colorado uses abbreviation codes like "DLLC"/"DPC", New York
// spells it out as "DOMESTIC LIMITED LIABILITY COMPANY"/"DOMESTIC BUSINESS
// CORPORATION"). Verify with --sample and extend this list per your needs;
// see README "Known gotchas" for concrete examples of what does and doesn't match.
export const ENTITY_TYPES_KEEP = ["LLC", "Corporation", "INC"];
