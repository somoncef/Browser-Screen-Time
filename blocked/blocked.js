/**
 * Interstitial shown when a tracked site is blocked and no redirect is set.
 */

import { loadState } from "../shared/storage.js";
import { formatClock, formatDuration } from "../shared/time.js";
import { unblockAt } from "../shared/rules.js";

const params = new URLSearchParams(location.search);
const domain = params.get("domain") || "";
const reason = params.get("reason") || "limit";
const isDowntime = reason === "downtime";

const state = await loadState();
const site = state.sites.find((s) => s.domain === domain);
const used = state.todayUsage[domain] || 0;
const until = unblockAt(state, reason);

document.body.classList.toggle("downtime", isDowntime);
document.title = isDowntime ? "Downtime" : "Time Limit";
document.getElementById("eyebrow").textContent = isDowntime ? "Downtime" : "Time Limit";
document.getElementById("icon").textContent = isDowntime ? "🌙" : "⏳";
document.getElementById("title").textContent = site?.displayName || domain || "This site";
document.getElementById("used").textContent = formatDuration(used);
document.getElementById("until").textContent = formatClock(until);
document.getElementById("lead").textContent = isDowntime
  ? "Downtime is on. Time to rest — this site is paused until the window ends."
  : "You’ve reached today’s limit for this website. Nice work sticking to it!";

document.getElementById("close-tab").addEventListener("click", async () => {
  const tab = await chrome.tabs.getCurrent();
  if (tab?.id != null) chrome.tabs.remove(tab.id);
});

document.getElementById("retry").addEventListener("click", () => {
  location.href = `https://${domain}`;
});

let timer = null;

function tick() {
  const remaining = until.getTime() - Date.now();
  const el = document.getElementById("countdown");
  if (remaining <= 0) {
    el.textContent = "You can use this site again.";
    if (domain) document.getElementById("retry").classList.remove("hidden");
    clearInterval(timer);
    return;
  }
  el.textContent = `${formatDuration(remaining)} remaining`;
}

tick();
timer = setInterval(tick, 1000);
