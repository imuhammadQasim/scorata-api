// Thin client for the Socrata Open Data API (SODA), with retry/backoff and timeouts.

const TIMEOUT_MS = 30_000;
const MAX_RETRIES = 5;
const BASE_DELAY_MS = 500;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function metadataUrl(domain, datasetId) {
  return `https://${domain}/api/views/${datasetId}.json`;
}

function resourceUrl(domain, datasetId) {
  return `https://${domain}/resource/${datasetId}.json`;
}

async function requestWithRetry(url, { token, params } = {}) {
  const fullUrl = params ? `${url}?${params.toString()}` : url;
  const headers = {};
  if (token) headers["X-App-Token"] = token;

  let lastError;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    let response;
    try {
      response = await fetch(fullUrl, {
        headers,
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (err) {
      lastError = new Error(
        `Network error calling ${url}: ${err.message} (bad domain, DNS failure, or timeout)`
      );
      if (attempt === MAX_RETRIES) throw lastError;
      await sleep(backoffDelay(attempt));
      continue;
    }

    if (response.ok) {
      return response.json();
    }

    const bodyText = await response.text().catch(() => "");
    let bodyMessage = bodyText;
    try {
      const parsed = JSON.parse(bodyText);
      bodyMessage = parsed.message || bodyText;
    } catch {
      // not JSON, keep raw text
    }

    if (response.status === 404) {
      throw new Error(
        `404 Not Found calling ${url}. Check the domain and dataset ID are correct. Response: ${bodyMessage}`
      );
    }

    if (response.status === 400) {
      throw new Error(
        `400 Bad Request calling ${fullUrl}. This usually means a column name in $where/$order/$select does not exist on this dataset. Response: ${bodyMessage}`
      );
    }

    const retryable = response.status === 429 || response.status >= 500;
    if (!retryable || attempt === MAX_RETRIES) {
      throw new Error(
        `HTTP ${response.status} calling ${fullUrl}. Response: ${bodyMessage}`
      );
    }

    const retryAfterHeader = response.headers.get("retry-after");
    const retryAfterMs = retryAfterHeader ? Number(retryAfterHeader) * 1000 : null;
    const delay = retryAfterMs && !Number.isNaN(retryAfterMs) ? retryAfterMs : backoffDelay(attempt);
    console.warn(
      `  [retry] HTTP ${response.status} from ${new URL(url).hostname}, retrying in ${Math.round(
        delay
      )}ms (attempt ${attempt + 1}/${MAX_RETRIES})`
    );
    await sleep(delay);
    lastError = new Error(`HTTP ${response.status}`);
  }
  throw lastError;
}

function backoffDelay(attempt) {
  const exp = BASE_DELAY_MS * 2 ** attempt;
  const jitter = Math.random() * 250;
  return exp + jitter;
}

export async function fetchDatasetMetadata(domain, datasetId, token) {
  const data = await requestWithRetry(metadataUrl(domain, datasetId), { token });
  if (!Array.isArray(data.columns)) {
    throw new Error(
      `Metadata for ${domain}/${datasetId} did not include a columns array. Response shape unexpected.`
    );
  }
  return data.columns.map((c) => ({
    fieldName: c.fieldName,
    dataTypeName: c.dataTypeName,
    name: c.name,
  }));
}

/**
 * Fetch a single page of rows.
 */
export async function fetchPage(domain, datasetId, token, { where, order, limit, offset }) {
  const params = new URLSearchParams();
  if (where) params.set("$where", where);
  if (order) params.set("$order", order);
  params.set("$limit", String(limit));
  params.set("$offset", String(offset));
  return requestWithRetry(resourceUrl(domain, datasetId), { token, params });
}

/**
 * Fetch all rows matching the query, paginating with $limit/$offset until a
 * page returns fewer rows than the page size. If `maxRows` is set, stops
 * early once at least that many rows have been collected (used by --sample).
 */
export async function fetchAllRows(
  domain,
  datasetId,
  token,
  { where, order, pageSize = 1000, maxRows = Infinity, onPage } = {}
) {
  const rows = [];
  let offset = 0;
  while (rows.length < maxRows) {
    const limit = Math.min(pageSize, maxRows - rows.length);
    const page = await fetchPage(domain, datasetId, token, { where, order, limit, offset });
    rows.push(...page);
    if (onPage) onPage(page.length, rows.length);
    if (page.length < limit) break;
    offset += page.length;
  }
  return rows;
}
