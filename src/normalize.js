export const OUTPUT_COLUMNS = [
  "state",
  "entity_id",
  "business_name",
  "entity_type",
  "entity_status",
  "formation_date",
  "address",
  "city",
  "address_state",
  "zip",
  "agent_name",
  "agent_type",
  "virtual_address",
  "source_domain",
];

function val(row, fieldName) {
  if (!fieldName) return "";
  const v = row[fieldName];
  if (v === null || v === undefined) return "";
  return String(v).trim();
}

function joinNonEmpty(parts) {
  return parts.filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
}

/**
 * Compare street addresses loosely: case, punctuation and spacing ignored,
 * and a suite on one side only is allowed ("1500 N Grant St Ste R" is the
 * same building as "1500 N GRANT ST").
 */
function sameAddress(a, b) {
  const norm = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
  const x = norm(a);
  const y = norm(b);
  if (x.length < 6 || y.length < 6) return false;
  return x.startsWith(y) || y.startsWith(x);
}

// A registered agent given as one name field is a company if it reads like one.
const COMPANY_NAME = /\b(llc|l\.l\.c|inc|corp|corporation|company|co|ltd|lp|llp|pllc|services|agents?|registered|trust|group)\b\.?/i;

/**
 * Normalize one raw Socrata row into the unified output schema.
 *
 * Columns a state's dataset doesn't have (street address, registered agent,
 * ...) are left empty, which every downstream filter treats as "unknown"
 * rather than as a reason to reject.
 */
export function normalizeRow(row, { stateKey, domain, mapping }) {
  const rawDate = val(row, mapping.dateCol);

  const address = joinNonEmpty([val(row, mapping.addressCol), val(row, mapping.address2Col)]);

  let agentPerson = joinNonEmpty([val(row, mapping.agentFirstCol), val(row, mapping.agentLastCol)]);
  let agentOrg = val(row, mapping.agentOrgCol);
  const agentSingle = val(row, mapping.agentNameCol);
  if (!agentPerson && !agentOrg && agentSingle) {
    if (COMPANY_NAME.test(agentSingle)) agentOrg = agentSingle;
    else agentPerson = agentSingle;
  }
  const agentAddress = val(row, mapping.agentAddressCol);

  // A company registered agent whose office is also the business's principal
  // address means the owner put the agent's address on file. The business may
  // still be real, but that address says nothing about where it operates.
  const virtualAddress = Boolean(agentOrg) && sameAddress(address, agentAddress);

  return {
    state: stateKey,
    entity_id: val(row, mapping.idCol),
    business_name: val(row, mapping.nameCol),
    entity_type: val(row, mapping.typeCol),
    entity_status: val(row, mapping.statusCol),
    formation_date: rawDate ? rawDate.slice(0, 10) : "",
    address,
    city: val(row, mapping.cityCol),
    address_state: val(row, mapping.addressStateCol),
    zip: val(row, mapping.zipCol),
    agent_name: agentPerson || agentOrg,
    agent_type: agentPerson ? "person" : agentOrg ? "company" : "",
    virtual_address: virtualAddress ? "yes" : "",
    source_domain: domain,
  };
}
