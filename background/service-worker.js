/**
 * Background service worker (Manifest V3).
 *
 * Responsibilities:
 * 1. Count focused-tab time on tracked domains (not background tabs).
 * 2. Roll daily usage into history at local midnight.
 * 3. Redirect or show the blocked page when a limit / Downtime applies.
 *
 * Service workers can sleep. We persist a tiny session blob in
 * chrome.storage.session and flush elapsed time on every interesting event
 * plus a 1-minute alarm.
 *
 * Follow-up hook: a native-app game blocker can read the same
 * chrome.storage.local key (`bst_state`) or listen to the same
 * midnight / Downtime rules in shared/rules.js.
 */

import { ALARM_MIDNIGHT, ALARM_TICK, IDLE_SECONDS, MAX_FLUSH_MS } from "../shared/constants.js";
import { hostnameFromUrl } from "../shared/domains.js";
import { ensureSite } from "../shared/sites.js";
import { nextLocalMidnightMs } from "../shared/time.js";
import {
  addUsage,
  loadSession,
  loadState,
  rollMidnight,
  saveSession,
  saveState
} from "../shared/storage.js";
import { blockStatusForUrl, resolveBlockDestination } from "../shared/rules.js";

chrome.runtime.onInstalled.addListener(() => {
  init().catch(console.error);
});

chrome.runtime.onStartup.addListener(() => {
  init().catch(console.error);
});

init().catch(console.error);

async function init() {
  chrome.idle.setDetectionInterval(IDLE_SECONDS);
  await ensureAlarms();
  await flushAndSync({ reason: "init" });
}

async function ensureAlarms() {
  await chrome.alarms.create(ALARM_TICK, { periodInMinutes: 1 });
  await chrome.alarms.create(ALARM_MIDNIGHT, { when: nextLocalMidnightMs() });
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_MIDNIGHT) {
    chrome.alarms.create(ALARM_MIDNIGHT, { when: nextLocalMidnightMs() });
  }
  flushAndSync({ reason: alarm.name }).catch(console.error);
});

chrome.tabs.onActivated.addListener(() => {
  flushAndSync({ reason: "tab-activated" }).catch(console.error);
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === "complete" || changeInfo.url) {
    // Tracking always uses the focused tab — this event may be a background load.
    flushAndSync({ reason: "tab-updated" })
      .then(() => loadState())
      .then((state) => tab.url && maybeBlockTab(tab, state))
      .catch(console.error);
  }
});

chrome.windows.onFocusChanged.addListener((windowId) => {
  flushAndSync({
    reason: "focus",
    focused: windowId !== chrome.windows.WINDOW_ID_NONE
  }).catch(console.error);
});

chrome.idle.onStateChanged.addListener((idleState) => {
  flushAndSync({
    reason: "idle",
    idle: idleState !== "active"
  }).catch(console.error);
});

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "local") {
    enforceActiveTabs().catch(console.error);
  }
});

/**
 * Credit elapsed time to the previously active tracked domain, then
 * snapshot the current focused tab and enforce blocks.
 */
async function flushAndSync(meta = {}) {
  const now = Date.now();
  let state = rollMidnight(await loadState(), new Date(now));
  const session = await loadSession();

  // Credit time using the *previous* focus/idle snapshot, then apply this event.
  const canCredit =
    session.focused !== false &&
    session.idle !== true &&
    session.activeDomain &&
    session.lastTick;

  if (canCredit) {
    const elapsed = Math.min(Math.max(0, now - session.lastTick), MAX_FLUSH_MS);
    if (elapsed > 0) {
      addUsage(state, session.activeDomain, elapsed);
    }
  }

  if (typeof meta.focused === "boolean") session.focused = meta.focused;
  if (typeof meta.idle === "boolean") session.idle = meta.idle;

  await saveState(state);

  const tab = await getFocusedHttpTab();
  const host = tab?.url ? hostnameFromUrl(tab.url) : "";
  const site = host ? ensureSite(state, host) : null;
  if (site) await saveState(state);

  session.activeDomain = site ? site.domain : null;
  session.lastTick = now;
  await saveSession(session);

  await enforceTabs(state);
}

async function getFocusedHttpTab() {
  const [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true
  });
  return tab || null;
}

async function maybeBlockTab(tab, state) {
  const status = blockStatusForUrl(state, tab.url);
  if (!status.blocked || !status.site) return;

  const blockedPage = chrome.runtime.getURL(
    `blocked/blocked.html?domain=${encodeURIComponent(status.site.domain)}&reason=${encodeURIComponent(status.reason)}`
  );

  const destination = resolveBlockDestination(state, status.site, blockedPage);
  if (tab.url && tab.url.startsWith(destination.split("?")[0])) return;
  if (tab.url && tab.url.startsWith(chrome.runtime.getURL("blocked/blocked.html"))) {
    return;
  }

  try {
    await chrome.tabs.update(tab.id, { url: destination });
  } catch (err) {
    console.warn("Could not redirect tab", err);
  }
}

async function enforceActiveTabs() {
  const state = await loadState();
  await enforceTabs(state);
}

async function enforceTabs(state) {
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (tab.url) await maybeBlockTab(tab, state);
  }
}
