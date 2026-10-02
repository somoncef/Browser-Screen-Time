/**
 * chrome.storage.local persistence for tracked sites, usage, history, Downtime.
 *
 * Shape (v1):
 * {
 *   version: 1,
 *   sites: [{ id, domain, displayName, category, dailyLimitMinutes, dailyLimitUnit, redirectUrl, aliases }],
 *   downtime: { enabled, start, end },
 *   alwaysAllowed: ["gmail.com"],
 *   dataRetention: "week" | "month",
 *   todayDate: "2026-10-02",
 *   todayUsage: { "youtube.com": 123456 },  // milliseconds
 *   history: { "2026-10-01": { "youtube.com": 999 } }
 * }
 */

import { STORAGE_KEY, SESSION_KEY } from "./constants.js";
import { localDateKey, retainedDateKeys } from "./time.js";

export function emptyState() {
  return {
    version: 1,
    sites: [],
    downtime: {
      enabled: false,
      start: "22:00",
      end: "07:00"
    },
    alwaysAllowed: [],
    dataRetention: "week",
    todayDate: localDateKey(),
    todayUsage: {},
    history: {}
  };
}

export async function loadState() {
  const result = await chrome.storage.local.get(STORAGE_KEY);
  const state = result[STORAGE_KEY];
  if (!state || state.version !== 1) {
    const fresh = emptyState();
    await saveState(fresh);
    return fresh;
  }
  const merged = { ...emptyState(), ...state };
  if (merged.dataRetention !== "month") merged.dataRetention = "week";
  return pruneHistory(merged);
}

export async function saveState(state) {
  await chrome.storage.local.set({ [STORAGE_KEY]: state });
  return state;
}

export async function updateState(mutator) {
  const state = await loadState();
  const next = await mutator(state);
  const toSave = next || state;
  await saveState(toSave);
  return toSave;
}

/**
 * Move today's counters into history when the local date changes.
 * Called from the service worker on alarms and before every usage write.
 */
export function rollMidnight(state, now = new Date()) {
  const today = localDateKey(now);
  if (state.todayDate === today) return state;

  if (state.todayDate) {
    state.history = { ...state.history, [state.todayDate]: { ...state.todayUsage } };
  }
  state.todayDate = today;
  state.todayUsage = {};
  return pruneHistory(state, now);
}

/**
 * Keep only the current week or current calendar month, then drop
 * auto-tracked sites that have no remaining usage and no limit set.
 */
export function pruneHistory(state, now = new Date()) {
  const allowed = new Set(retainedDateKeys(state.dataRetention, now));
  const today = localDateKey(now);
  allowed.add(today);
  const pruned = {};
  for (const [key, value] of Object.entries(state.history || {})) {
    if (allowed.has(key) && key !== today) pruned[key] = value;
  }
  state.history = pruned;

  const stillUsed = new Set(Object.keys(state.todayUsage || {}));
  for (const day of Object.values(state.history)) {
    for (const domain of Object.keys(day || {})) stillUsed.add(domain);
  }
  state.sites = (state.sites || []).filter((site) => {
    if ((Number(site.dailyLimitMinutes) || 0) > 0) return true;
    if (site.redirectUrl) return true;
    return stillUsed.has(site.domain);
  });
  return state;
}

export function addUsage(state, domain, ms) {
  if (!domain || ms <= 0) return state;
  const current = state.todayUsage[domain] || 0;
  state.todayUsage = { ...state.todayUsage, [domain]: current + ms };
  return state;
}

export function usageOnDate(state, dateKey, domain) {
  const map = usageMapForDate(state, dateKey);
  return domain ? map[domain] || 0 : sumUsage(map);
}

export function usageMapForDate(state, dateKey) {
  if (dateKey === state.todayDate) return state.todayUsage || {};
  return state.history[dateKey] || {};
}

export function sumUsage(map) {
  return Object.values(map || {}).reduce((a, b) => a + b, 0);
}

export function totalForDate(state, dateKey) {
  return usageOnDate(state, dateKey, null);
}

export async function loadSession() {
  const result = await chrome.storage.session.get(SESSION_KEY);
  return (
    result[SESSION_KEY] || {
      activeDomain: null,
      lastTick: null,
      focused: true,
      idle: false
    }
  );
}

export async function saveSession(session) {
  await chrome.storage.session.set({ [SESSION_KEY]: session });
  return session;
}
