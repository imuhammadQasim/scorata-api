// Central configuration for fetch-registrations.js.
// Edit this file to add states, tune filters, or override auto-detected columns.

// --- States -----------------------------------------------------------
// Each configured entry describes one verified Socrata (SODA API) dataset.
// Unverified states remain listed with null domain/datasetId; do not guess IDs.
// overrides = optional manual column-mapping overrides. Only needed when the
//             auto-detector in src/schema.js picks the wrong column. Valid
//             keys: dateCol, idCol, nameCol, typeCol, statusCol, cityCol, zipCol.
//
// Do NOT guess dataset IDs. To find one for a new state:
//   1. Query the Socrata Discovery API:
//      https://api.us.socrata.com/api/catalog/v1?domains={domain}&q=business%20entities
//   2. Confirm the candidate with its metadata endpoint:
//      https://{domain}/api/views/{datasetId}.json
//   3. Run `node fetch-registrations.js --states XX --sample` and eyeball the
//      detected mapping + sample row before trusting it.
const STATE_CODES = [
  "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA",
  "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
  "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ",
  "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
  "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY",
];

const UNCONFIGURED_STATES = Object.fromEntries(
  STATE_CODES.map((state) => [
    state,
    {
      domain: null,
      datasetId: null,
      unavailableReason:
        "No compatible Socrata business-registration dataset has been verified for this state.",
    },
  ])
);

export const STATES = {
  ...UNCONFIGURED_STATES,
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
  CT: {
    domain: "data.ct.gov",
    datasetId: "n7gp-d28j",
    // "Connecticut Business Registry - Business Master" — verified against
    // metadata and recent rows; date_registration/id/name auto-detect.
  },
  PA: {
    domain: "data.pa.gov",
    datasetId: "xvd7-5r2c",
    // "Registered Businesses in PA Current by County Department of State" —
    // verified against metadata and recent rows.
    overrides: {
      idCol: "filing_number",
    },
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
