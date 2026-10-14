// Fetching a business's web page and reading phone numbers from it.

const PAGE_BYTES_LIMIT = 1_500_000;

/**
 * A web page's HTML, or null if it isn't reachable HTML. Only the first
 * 1.5 MB is read, and nothing on the page is executed.
 */
export async function fetchHtml(url, { timeoutMs = 10_000 } = {}) {
  let response;
  try {
    response = await fetch(url, {
      redirect: "follow",
      headers: {
        "User-Agent":
          "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36",
        Accept: "text/html,application/xhtml+xml",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
  } catch {
    return null;
  }
  if (!response.ok || !(response.headers.get("content-type") || "").includes("html")) return null;

  const reader = response.body?.getReader();
  if (!reader) return null;
  const chunks = [];
  let size = 0;
  try {
    while (size < PAGE_BYTES_LIMIT) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      size += value.length;
    }
  } catch {
    return null;
  } finally {
    reader.cancel().catch(() => {});
  }
  return { url: response.url || url, html: Buffer.concat(chunks).toString("utf8") };
}

export function htmlToText(html) {
  return String(html || "")
    .replace(/<(script|style|noscript|svg)[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

/** "(303) 555-1234", or "" if the digits aren't a valid US number. */
export function formatPhone(raw) {
  let digits = String(raw || "").replace(/\D/g, "");
  if (digits.length === 11 && digits.startsWith("1")) digits = digits.slice(1);
  if (!/^[2-9]\d{2}[2-9]\d{6}$/.test(digits)) return "";
  return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
}

// Groups must be separated so order numbers and dates aren't read as phones.
const PHONE_IN_TEXT = /(?:\+?1[\s.-]?)?\(?\b([2-9]\d{2})\)?[\s.-]{1,2}([2-9]\d{2})[\s.-](\d{4})\b/g;

export function phonesInText(text) {
  const found = [];
  for (const m of String(text || "").matchAll(PHONE_IN_TEXT)) {
    const phone = formatPhone(`${m[1]}${m[2]}${m[3]}`);
    if (phone && !found.includes(phone)) found.push(phone);
  }
  return found;
}

/** Phones from tel: links, which a site owner sets deliberately. */
export function phonesInTelLinks(html) {
  const found = [];
  for (const m of String(html || "").matchAll(/href\s*=\s*["']\s*tel:([^"']+)["']/gi)) {
    let raw = m[1];
    try {
      raw = decodeURIComponent(raw);
    } catch {
      // keep the raw value
    }
    const phone = formatPhone(raw);
    if (phone && !found.includes(phone)) found.push(phone);
  }
  return found;
}

/**
 * Read a site's home page and its contact page. Returns the combined HTML
 * and visible text, or null if the site can't be loaded.
 */
export async function readSite(url) {
  let home = null;
  try {
    home = await fetchHtml(new URL("/", url).href);
  } catch {
    return null;
  }
  if (!home) home = await fetchHtml(url);
  if (!home) return null;

  const pages = [home];
  const host = new URL(home.url).hostname;
  const contactHref = [...home.html.matchAll(/href\s*=\s*["']([^"'#]*contact[^"'#]*)["']/gi)]
    .map((m) => {
      try {
        return new URL(m[1], home.url).href;
      } catch {
        return "";
      }
    })
    .find((href) => href && new URL(href).hostname === host);

  for (const path of contactHref ? [contactHref] : ["/contact", "/contact-us"]) {
    const page = await fetchHtml(new URL(path, home.url).href);
    if (page) {
      pages.push(page);
      break;
    }
  }

  const html = pages.map((p) => p.html).join("\n");
  return { url: home.url, html, text: pages.map((p) => htmlToText(p.html)).join(" ") };
}
