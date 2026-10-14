// Central configuration for fetch-registrations.js.
// Edit this file to add states, tune filters, or override auto-detected columns.

// --- States -----------------------------------------------------------
// Each configured entry describes one verified Socrata (SODA API) dataset.
// Unverified states remain listed with null domain/datasetId; do not guess IDs.
// overrides = optional manual column-mapping overrides. Only needed when the
//             auto-detector in src/schema.js picks the wrong column. Valid
//             keys: dateCol, idCol, nameCol, typeCol, statusCol, cityCol, zipCol,
//             addressCol, address2Col, addressStateCol, agentFirstCol,
//             agentLastCol, agentOrgCol, agentNameCol, agentAddressCol.
// entityTypes = optional exact list of entity-type values to keep (see CO).
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
    //
    // entityTypes (optional, any state): exact entity-type values to keep,
    //   replacing the loose global ENTITY_TYPES_KEEP. Colorado uses short
    //   codes: "DLLC" = an LLC formed in Colorado, while "FLLC" (formed in
    //   another state) would slip through the loose "LLC" match.
    entityTypes: ["DLLC"],
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

// Whole-word, case-insensitive match against business_name; any match excludes
// the row. Use this for your own one-off exclusions. The built-in junk rules
// below run as well.
export const KEYWORDS_EXCLUDE = [];

// --- Junk rules (src/filters.js) ----------------------------------------
// Each list is matched as whole words (or phrases), case-insensitively.

// Companies that only own or hold something (a house, land, an investment).
// They have no customers, so they never need a website or a phone line.
export const PROPERTY_HOLDING_WORDS = [
  "holding", "holdings", "capital", "trust", "realty", "real estate",
  "investment", "investments", "investor", "investors", "invest",
  "property", "properties", "propco", "opco", "rental", "rentals",
  "acres", "apartment", "apartments", "condo", "condos", "condominium",
  "condominiums", "townhome", "townhomes", "townhouse", "duplex", "duplexes",
  "hoa", "homeowners", "association", "estates",
  "fund", "funds", "funding", "lender", "1031", "spv", "spe", "gp", "lp",
  "member", "owner", "manager", "ventures", "venture", "acquisition",
  "acquisitions", "equity", "assets", "portfolio",
  "family llc", "family partners", "family office", "family enterprises",
];

// Online-reseller and drop-shipping shells, registered by the dozen with a
// made-up name and a registered agent's address.
export const RESELLER_SHELL_WORDS = [
  "trading", "commerce", "ecommerce", "e-commerce", "ecom", "ecoms",
  "impex", "mart", "shopify", "dropship", "dropshipping",
];

// Loose (case-insensitive substring, either direction) match against the
// state's entity-type field, for states without their own `entityTypes` list.
// NOTE: entity-type formatting varies wildly by state (e.g. Colorado uses
// abbreviation codes like "DLLC"/"DPC", New York spells it out as "DOMESTIC
// LIMITED LIABILITY COMPANY"/"DOMESTIC BUSINESS CORPORATION"). Verify with
// --sample and extend this list per your needs; see README "Known gotchas".
// Any type containing "FOREIGN" (formed in another state) is always dropped.
export const ENTITY_TYPES_KEEP = ["LLC", "Limited Liability", "Corporation", "INC"];
