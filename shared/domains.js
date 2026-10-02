/**
 * Domain matching: youtube.com matches www.youtube.com and music.youtube.com.
 */

export function normalizeDomain(input) {
  if (!input) return "";
  let value = String(input).trim().toLowerCase();
  value = value.replace(/^https?:\/\//, "");
  value = value.split("/")[0];
  value = value.split(":")[0];
  value = value.replace(/^www\./, "");
  return value;
}

export function hostnameFromUrl(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return "";
    return normalizeDomain(u.hostname);
  } catch {
    return "";
  }
}

export function allDomainsForSite(site) {
  const list = [site.domain, ...(site.aliases || [])];
  return [...new Set(list.map(normalizeDomain).filter(Boolean))];
}

export function siteMatchesHost(site, host) {
  if (!host) return false;
  return allDomainsForSite(site).some(
    (d) => host === d || host.endsWith(`.${d}`)
  );
}

/** Longest matching tracked site wins (music.youtube.com vs youtube.com). */
export function findTrackedSite(host, sites) {
  const matches = (sites || []).filter((s) => siteMatchesHost(s, host));
  matches.sort(
    (a, b) => allDomainsForSite(b)[0].length - allDomainsForSite(a)[0].length
  );
  return matches[0] || null;
}

export function faviconUrl(domain) {
  return `https://www.google.com/s2/favicons?sz=64&domain=${encodeURIComponent(domain)}`;
}

export function toHttpsUrl(input) {
  const trimmed = String(input || "").trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
