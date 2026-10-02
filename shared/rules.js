/**
 * Blocking rules: per-site daily limits + Downtime schedule.
 *
 * Always Allowed sites skip Downtime only. Daily limits still apply
 * (same idea as iOS Screen Time).
 */

import { parseHHMM, minutesOfDay, msUntilMidnight, downtimeEndDate } from "./time.js";
import { findTrackedSite, hostnameFromUrl, normalizeDomain, toHttpsUrl } from "./domains.js";

export function isDowntimeNow(downtime, date = new Date()) {
  if (!downtime?.enabled) return false;
  const now = minutesOfDay(date);
  const start = parseHHMM(downtime.start);
  const end = parseHHMM(downtime.end);
  if (start === end) return true;
  if (start < end) return now >= start && now < end;
  return now >= start || now < end;
}

export function isAlwaysAllowed(domain, alwaysAllowed) {
  const host = normalizeDomain(domain);
  return (alwaysAllowed || []).some((entry) => {
    const d = normalizeDomain(entry);
    return host === d || host.endsWith(`.${d}`);
  });
}

export function getBlockStatus(state, site, now = new Date()) {
  if (!site) return { blocked: false, reason: null };

  const usageMs = state.todayUsage[site.domain] || 0;
  const limitMs = (Number(site.dailyLimitMinutes) || 0) * 60 * 1000;
  const overLimit = limitMs > 0 && usageMs >= limitMs;

  const inDowntime = isDowntimeNow(state.downtime, now);
  const exempt = isAlwaysAllowed(site.domain, state.alwaysAllowed);

  if (inDowntime && !exempt) {
    return { blocked: true, reason: "downtime", usageMs, limitMs };
  }
  if (overLimit) {
    return { blocked: true, reason: "limit", usageMs, limitMs };
  }
  return { blocked: false, reason: null, usageMs, limitMs };
}

export function unblockAt(state, reason, now = new Date()) {
  if (reason === "downtime") {
    return downtimeEndDate(state.downtime, now);
  }
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight;
}

export function msUntilUnblock(state, reason, now = new Date()) {
  if (reason === "downtime") {
    return Math.max(0, downtimeEndDate(state.downtime, now).getTime() - now.getTime());
  }
  return msUntilMidnight(now);
}

export function blockStatusForUrl(state, url, now = new Date()) {
  const host = hostnameFromUrl(url);
  const site = findTrackedSite(host, state.sites);
  if (!site) return { blocked: false, site: null, host };
  return { ...getBlockStatus(state, site, now), site, host };
}

/**
 * Avoid redirect loops: if the destination is also blocked, use the blocked page.
 */
export function resolveBlockDestination(state, site, extensionBlockedUrl) {
  const redirect = toHttpsUrl(site.redirectUrl);
  if (!redirect) return extensionBlockedUrl;
  const destStatus = blockStatusForUrl(state, redirect);
  if (destStatus.blocked) return extensionBlockedUrl;
  return redirect;
}
