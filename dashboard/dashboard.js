/**
 * Dashboard popup: Today totals, category donut, Most Used list,
 * Add Site sheet, weekly bars, and Downtime controls.
 *
 * Reads/writes chrome.storage.local. Usage ticks happen in the service worker.
 */

import { CATEGORIES, PRESET_SITES, CATEGORY_BY_ID } from "../shared/constants.js";
import { faviconUrl, normalizeDomain } from "../shared/domains.js";
import {
  loadState,
  saveState,
  sumUsage,
  totalForDate
} from "../shared/storage.js";
import {
  formatDuration,
  formatDurationLarge,
  localDateKey,
  weekDateKeys,
  weekdayLabel
} from "../shared/time.js";

const $ = (id) => document.getElementById(id);

let selectedDate = localDateKey();
let expandedId = null;
let state = null;

init();

async function init() {
  fillCategorySelect();
  fillPresets();
  bindEvents();
  state = await loadState();
  render();
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area === "local") {
      state = await loadState();
      render();
    }
  });
}

function fillCategorySelect() {
  $("add-category").innerHTML = CATEGORIES.map(
    (c) => `<option value="${c.id}">${c.label}</option>`
  ).join("");
}

function fillPresets() {
  $("presets").innerHTML = PRESET_SITES.map(
    (s) =>
      `<button type="button" class="preset" data-domain="${s.domain}">${s.displayName}</button>`
  ).join("");
}

function bindEvents() {
  $("add-open").addEventListener("click", () => openSheet());
  $("add-cancel").addEventListener("click", closeSheet);
  $("add-save").addEventListener("click", onAddSite);
  $("add-sheet").addEventListener("click", (e) => {
    if (e.target.id === "add-sheet") closeSheet();
  });

  $("presets").addEventListener("click", (e) => {
    const btn = e.target.closest(".preset");
    if (!btn) return;
    const preset = PRESET_SITES.find((s) => s.domain === btn.dataset.domain);
    document.querySelectorAll(".preset").forEach((el) => el.classList.remove("selected"));
    btn.classList.add("selected");
    $("add-domain").value = preset.domain;
    $("add-category").value = preset.category;
  });

  $("add-domain").addEventListener("input", () => {
    const domain = normalizeDomain($("add-domain").value);
    const preset = PRESET_SITES.find(
      (s) => s.domain === domain || (s.aliases || []).includes(domain)
    );
    if (preset) $("add-category").value = preset.category;
  });

  $("downtime-enabled").addEventListener("change", saveDowntime);
  $("downtime-start").addEventListener("change", saveDowntime);
  $("downtime-end").addEventListener("change", saveDowntime);

  $("allowed-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const domain = normalizeDomain($("allowed-input").value);
    if (!domain) return;
    if (!state.alwaysAllowed.includes(domain)) {
      state.alwaysAllowed = [...state.alwaysAllowed, domain];
      await saveState(state);
    }
    $("allowed-input").value = "";
    render();
  });
}

function openSheet() {
  $("add-domain").value = "";
  $("add-limit").value = "30";
  $("add-redirect").value = "";
  $("add-category").value = "other";
  document.querySelectorAll(".preset").forEach((el) => el.classList.remove("selected"));
  $("add-sheet").classList.remove("hidden");
}

function closeSheet() {
  $("add-sheet").classList.add("hidden");
}

async function onAddSite() {
  const domain = normalizeDomain($("add-domain").value);
  if (!domain) {
    $("add-domain").focus();
    return;
  }
  if (state.sites.some((s) => s.domain === domain)) {
    closeSheet();
    return;
  }
  const preset = PRESET_SITES.find(
    (s) => s.domain === domain || (s.aliases || []).includes(domain)
  );
  const site = {
    id: crypto.randomUUID(),
    domain: preset?.domain || domain,
    displayName: preset?.displayName || domain,
    category: $("add-category").value || "other",
    dailyLimitMinutes: Math.max(0, Number($("add-limit").value) || 0),
    redirectUrl: $("add-redirect").value.trim(),
    aliases: preset?.aliases || []
  };
  state.sites = [...state.sites, site];
  await saveState(state);
  closeSheet();
  render();
}

async function saveDowntime() {
  state.downtime = {
    enabled: $("downtime-enabled").checked,
    start: $("downtime-start").value || "22:00",
    end: $("downtime-end").value || "07:00"
  };
  await saveState(state);
}

function render() {
  const today = localDateKey();
  if (!weekDateKeys().includes(selectedDate)) selectedDate = today;

  const isToday = selectedDate === today;
  const usageMap = isToday
    ? state.todayUsage
    : state.history[selectedDate] || {};
  const total = sumUsage(usageMap);

  const hero = formatDurationLarge(total);
  $("hero-time").textContent = hero.text;
  $("hero-delta").textContent = comparisonLine(today, total);
  $("hero-delta").className = `delta ${comparisonClass(today, total)}`;

  $("most-used-date").textContent = isToday
    ? "Today"
    : weekdayLabel(selectedDate);

  renderDonut(usageMap);
  renderSites(usageMap);
  renderWeek();
  renderDowntime();
}

function comparisonLine(today, total) {
  const yesterdayKey = shiftDate(today, -1);
  const yesterday = totalForDate(state, yesterdayKey);
  if (!yesterday) return "No data from yesterday yet";
  const diff = yesterday === 0 ? 0 : Math.round(((total - yesterday) / yesterday) * 100);
  const abs = Math.abs(diff);
  if (diff < 0) return `↓ ${abs}% from yesterday`;
  if (diff > 0) return `↑ ${abs}% from yesterday`;
  return "Same as yesterday";
}

function comparisonClass(today, total) {
  const yesterday = totalForDate(state, shiftDate(today, -1));
  if (!yesterday) return "";
  if (total < yesterday) return "down";
  if (total > yesterday) return "up";
  return "";
}

function shiftDate(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return localDateKey(date);
}

function categoryTotals(usageMap) {
  const totals = Object.fromEntries(CATEGORIES.map((c) => [c.id, 0]));
  for (const site of state.sites) {
    totals[site.category] = (totals[site.category] || 0) + (usageMap[site.domain] || 0);
  }
  const tracked = new Set(state.sites.map((s) => s.domain));
  for (const [domain, ms] of Object.entries(usageMap)) {
    if (!tracked.has(domain)) totals.other += ms;
  }
  return totals;
}

function renderDonut(usageMap) {
  const totals = categoryTotals(usageMap);
  const sum = Object.values(totals).reduce((a, b) => a + b, 0);
  const svg = $("donut");
  const cx = 60;
  const cy = 60;
  const r = 44;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const arcs =
    sum === 0
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e5ea" stroke-width="14" />`
      : CATEGORIES.map((cat) => {
          const frac = totals[cat.id] / sum;
          const len = frac * circ;
          const dash = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${cat.color}" stroke-width="14" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}" stroke-linecap="butt" />`;
          offset += len;
          return dash;
        }).join("");

  svg.innerHTML = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f2f2f7" stroke-width="14" />
    ${arcs}
  `;

  $("legend").innerHTML = CATEGORIES.map((cat) => {
    const ms = totals[cat.id];
    if (sum > 0 && ms === 0) return "";
    return `<li><span><span class="swatch" style="background:${cat.color}"></span>${cat.label}</span><span>${formatDuration(ms)}</span></li>`;
  }).join("");
}

function renderSites(usageMap) {
  const rows = [...state.sites].sort(
    (a, b) => (usageMap[b.domain] || 0) - (usageMap[a.domain] || 0)
  );
  $("sites-empty").style.display = rows.length ? "none" : "block";
  $("site-list").innerHTML = rows
    .map((site) => {
      const used = usageMap[site.domain] || 0;
      const limitMs = (Number(site.dailyLimitMinutes) || 0) * 60 * 1000;
      const pct = limitMs > 0 ? Math.min(100, (used / limitMs) * 100) : 0;
      const cat = CATEGORY_BY_ID[site.category] || CATEGORY_BY_ID.other;
      const open = expandedId === site.id ? "open" : "";
      const initial = (site.displayName || site.domain).charAt(0).toUpperCase();
      return `
        <li class="site-row ${open}" data-id="${site.id}">
          <button type="button" class="site-main" data-toggle="${site.id}">
            <img class="favicon" src="${faviconUrl(site.domain)}" alt="" data-fallback="${cat.color}|${initial}" />
            <span>
              <span class="site-name">${escapeHtml(site.displayName)}</span>
              <span class="tag">${cat.label}</span>
            </span>
            <span class="site-time">${formatDuration(used)}</span>
          </button>
          <div class="bar" aria-hidden="true"><span style="width:${pct}%;background:${cat.color}"></span></div>
          <div class="expand">
            <label>Daily limit (minutes)
              <input type="number" min="0" step="5" value="${site.dailyLimitMinutes}" data-limit="${site.id}" />
            </label>
            <label>Redirect site
              <input type="text" value="${escapeHtml(site.redirectUrl || "")}" placeholder="leetcode.com" data-redirect="${site.id}" />
            </label>
            <button type="button" class="danger-btn" data-remove="${site.id}">Remove Website</button>
          </div>
        </li>`;
    })
    .join("");

  $("site-list").querySelectorAll(".favicon").forEach((img) => {
    img.addEventListener("error", () => {
      const [color, initial] = img.dataset.fallback.split("|");
      const span = document.createElement("div");
      span.className = "favicon-fallback";
      span.style.background = color;
      span.textContent = initial;
      img.replaceWith(span);
    });
  });

  $("site-list").onclick = async (e) => {
    const toggle = e.target.closest("[data-toggle]");
    if (toggle) {
      const id = toggle.dataset.toggle;
      expandedId = expandedId === id ? null : id;
      render();
      return;
    }
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      state.sites = state.sites.filter((s) => s.id !== remove.dataset.remove);
      await saveState(state);
      expandedId = null;
      render();
    }
  };

  $("site-list").onchange = async (e) => {
    const limit = e.target.dataset.limit;
    const redirect = e.target.dataset.redirect;
    const site = state.sites.find((s) => s.id === (limit || redirect));
    if (!site) return;
    if (limit) site.dailyLimitMinutes = Math.max(0, Number(e.target.value) || 0);
    if (redirect) site.redirectUrl = e.target.value.trim();
    await saveState(state);
  };
}

function renderWeek() {
  const keys = weekDateKeys();
  const today = localDateKey();
  const totals = keys.map((k) => totalForDate(state, k));
  const max = Math.max(1, ...totals);
  $("week-chart").innerHTML = keys
    .map((key, i) => {
      const h = Math.max(6, Math.round((totals[i] / max) * 88));
      const active = key === selectedDate ? "active" : "";
      const isToday = key === today ? "today" : "";
      return `
        <button type="button" class="week-day ${active} ${isToday}" data-day="${key}" title="${formatDuration(totals[i])}">
          <span class="week-col"><span class="week-fill" style="height:${h}px"></span></span>
          <span class="week-label">${weekdayLabel(key).charAt(0)}</span>
        </button>`;
    })
    .join("");

  $("week-chart").onclick = (e) => {
    const btn = e.target.closest("[data-day]");
    if (!btn) return;
    selectedDate = btn.dataset.day;
    render();
  };
}

function renderDowntime() {
  $("downtime-enabled").checked = Boolean(state.downtime.enabled);
  $("downtime-start").value = state.downtime.start || "22:00";
  $("downtime-end").value = state.downtime.end || "07:00";
  $("allowed-chips").innerHTML = (state.alwaysAllowed || [])
    .map(
      (d) =>
        `<span class="chip">${escapeHtml(d)}<button type="button" data-unallow="${escapeHtml(d)}" aria-label="Remove">×</button></span>`
    )
    .join("");

  $("allowed-chips").onclick = async (e) => {
    const btn = e.target.closest("[data-unallow]");
    if (!btn) return;
    state.alwaysAllowed = state.alwaysAllowed.filter((d) => d !== btn.dataset.unallow);
    await saveState(state);
    render();
  };
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
