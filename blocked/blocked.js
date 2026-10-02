/**
 * Interstitial shown when a tracked site is blocked and no redirect is set.
 */

import { loadState } from "../shared/storage.js";
import { formatClock, formatDuration } from "../shared/time.js";
import { unblockAt } from "../shared/rules.js";

const params = new URLSearchParams(location.search);
const domain = params.get("domain") || "";
const reason = params.get("reason") || "limit";

const state = await loadState();
const site = state.sites.find((s) => s.domain === domain);
const used = state.todayUsage[domain] || 0;
const until = unblockAt(state, reason);

document.getElementById("title").textContent = site?.displayName || domain || "This site";
document.getElementById("used").textContent = formatDuration(used);
document.getElementById("until").textContent = formatClock(until);

const lead =
  reason === "downtime"
    ? "Downtime is on. This site is paused until the window ends."
    : "You’ve reached today’s time limit for this website.";
document.getElementById("lead").textContent = lead;

function tick() {
  const remaining = until.getTime() - Date.now();
  const el = document.getElementById("countdown");
  if (remaining <= 0) {
    el.textContent = "You can try again now.";
    return;
  }
  el.textContent = `${formatDuration(remaining)} remaining`;
}

tick();
setInterval(tick, 1000);
