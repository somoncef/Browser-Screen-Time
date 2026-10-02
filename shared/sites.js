/**
 * Create / reuse site records. Visits auto-register so Most Used
 * lists every site the user actually opened (http/https).
 */

import { PRESET_SITES } from "./constants.js";
import { findTrackedSite, normalizeDomain } from "./domains.js";

export function findPresetForHost(host) {
  const h = normalizeDomain(host);
  if (!h) return null;
  return (
    PRESET_SITES.find((s) => {
      const names = [s.domain, ...(s.aliases || [])];
      return names.some((d) => h === d || h.endsWith(`.${d}`));
    }) || null
  );
}

export function isSkippableHost(host) {
  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return false;
}

export function limitToMinutes(value, unit) {
  const n = Math.max(0, Number(value) || 0);
  return unit === "hours" ? Math.round(n * 60) : Math.round(n);
}

export function minutesToDisplay(minutes, unit) {
  const m = Number(minutes) || 0;
  if (unit === "hours") {
    const hours = m / 60;
    return Number.isInteger(hours) ? String(hours) : String(Math.round(hours * 100) / 100);
  }
  return String(m);
}

export function createSiteRecord(host) {
  const preset = findPresetForHost(host);
  const domain = preset?.domain || normalizeDomain(host);
  return {
    id: crypto.randomUUID(),
    domain,
    displayName: preset?.displayName || domain,
    category: preset?.category || "other",
    dailyLimitMinutes: 0,
    dailyLimitUnit: "minutes",
    redirectUrl: "",
    aliases: preset?.aliases || []
  };
}

/** Returns the site row, appending one if this host is new. */
export function ensureSite(state, host) {
  if (isSkippableHost(host)) return null;
  const existing = findTrackedSite(host, state.sites);
  if (existing) return existing;
  const site = createSiteRecord(host);
  state.sites = [...state.sites, site];
  return site;
}
