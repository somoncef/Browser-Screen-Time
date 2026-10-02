/**
 * Dashboard popup: Today totals, category donut, Most Used list,
 * Add Site sheet, weekly bars, and Downtime controls.
 *
 * Reads/writes chrome.storage.local. Usage ticks happen in the service worker.
 */

import { CATEGORIES, PRESET_SITES, CATEGORY_BY_ID, SITE_SLICE_COLORS } from "../shared/constants.js";
import { faviconUrl, normalizeDomain } from "../shared/domains.js";
import {
  loadState,
  pruneHistory,
  saveState,
  sumUsage,
  totalForDate,
  usageMapForDate
} from "../shared/storage.js";
import {
  dayHeading,
  formatDuration,
  formatDurationLarge,
  localDateKey,
  monthDateKeys,
  monthTitle,
  parseDateKey,
  retainedDateKeys,
  weekDateKeys,
  weekdayLabel
} from "../shared/time.js";
import { limitToMinutes, minutesToDisplay } from "../shared/sites.js";

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
  $("data-retention").addEventListener("change", saveRetention);

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
  $("add-limit-unit").value = "minutes";
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
  const unit = $("add-limit-unit").value || "minutes";
  const preset = PRESET_SITES.find(
    (s) => s.domain === domain || (s.aliases || []).includes(domain)
  );
  const existing = state.sites.find((s) => s.domain === (preset?.domain || domain));
  const minutes = limitToMinutes($("add-limit").value, unit);
  if (existing) {
    existing.category = $("add-category").value || existing.category;
    existing.dailyLimitMinutes = minutes;
    existing.dailyLimitUnit = unit;
    existing.redirectUrl = $("add-redirect").value.trim();
  } else {
    state.sites = [
      ...state.sites,
      {
        id: crypto.randomUUID(),
        domain: preset?.domain || domain,
        displayName: preset?.displayName || domain,
        category: $("add-category").value || "other",
        dailyLimitMinutes: minutes,
        dailyLimitUnit: unit,
        redirectUrl: $("add-redirect").value.trim(),
        aliases: preset?.aliases || []
      }
    ];
  }
  await saveState(state);
  closeSheet();
  render();
}

async function saveRetention() {
  state.dataRetention = $("data-retention").value === "month" ? "month" : "week";
  pruneHistory(state);
  selectedDate = localDateKey();
  await saveState(state);
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
  const periodKeys = retainedDateKeys(state.dataRetention);
  if (!periodKeys.includes(selectedDate)) selectedDate = today;

  const isToday = selectedDate === today;
  const usageMap = usageMapForDate(state, selectedDate);
  const total = sumUsage(usageMap);
  const heading = dayHeading(selectedDate);

  const hero = formatDurationLarge(total);
  $("hero-eyebrow").textContent = heading;
  $("hero-time").textContent = hero.text;
  $("hero-delta").textContent = comparisonLine(selectedDate, total);
  $("hero-delta").className = `delta ${comparisonClass(selectedDate, total)}`;

  $("most-used-date").textContent = heading;

  renderDonut(usageMap);
  renderSites(usageMap, isToday);
  renderPeriod();
  renderDowntime();
  renderSettings();
}

function comparisonLine(dateKey, total) {
  const prevKey = shiftDate(dateKey, -1);
  const previous = totalForDate(state, prevKey);
  const prevName = dayHeading(prevKey).toLowerCase();
  if (!previous) return `No data from ${prevName} yet`;
  const diff = previous === 0 ? 0 : Math.round(((total - previous) / previous) * 100);
  const abs = Math.abs(diff);
  if (diff < 0) return `↓ ${abs}% from ${prevName}`;
  if (diff > 0) return `↑ ${abs}% from ${prevName}`;
  return `Same as ${prevName}`;
}

function comparisonClass(dateKey, total) {
  const previous = totalForDate(state, shiftDate(dateKey, -1));
  if (!previous) return "";
  if (total < previous) return "down";
  if (total > previous) return "up";
  return "";
}

function shiftDate(dateKey, days) {
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(y, m - 1, d + days);
  return localDateKey(date);
}

function siteSlices(usageMap) {
  const siteByDomain = new Map((state.sites || []).map((s) => [s.domain, s]));
  const ranked = Object.entries(usageMap)
    .filter(([, ms]) => ms > 0)
    .map(([domain, ms]) => ({
      domain,
      label: siteByDomain.get(domain)?.displayName || domain,
      ms
    }))
    .sort((a, b) => b.ms - a.ms);

  const top = ranked.slice(0, 5);
  const restMs = ranked.slice(5).reduce((sum, row) => sum + row.ms, 0);
  const slices = top.map((row, i) => ({
    ...row,
    color: SITE_SLICE_COLORS[i % SITE_SLICE_COLORS.length]
  }));
  if (restMs > 0) {
    slices.push({ domain: "_other", label: "Other", ms: restMs, color: "#c7c7cc" });
  }
  return slices;
}

function renderDonut(usageMap) {
  const slices = siteSlices(usageMap);
  const sum = slices.reduce((a, s) => a + s.ms, 0);
  const svg = $("donut");
  const cx = 60;
  const cy = 60;
  const r = 44;
  const circ = 2 * Math.PI * r;

  let offset = 0;
  const arcs =
    sum === 0
      ? `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#e5e5ea" stroke-width="14" />`
      : slices
          .map((slice) => {
            const frac = slice.ms / sum;
            const len = frac * circ;
            const dash = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${slice.color}" stroke-width="14" stroke-dasharray="${len} ${circ - len}" stroke-dashoffset="${-offset}" stroke-linecap="butt" />`;
            offset += len;
            return dash;
          })
          .join("");

  svg.innerHTML = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#f2f2f7" stroke-width="14" />
    ${arcs}
  `;

  $("legend").innerHTML = slices
    .map(
      (slice) =>
        `<li><span><span class="swatch" style="background:${slice.color}"></span>${escapeHtml(slice.label)}</span><span>${formatDuration(slice.ms)}</span></li>`
    )
    .join("");
}

function renderSites(usageMap, isToday) {
  const siteByDomain = new Map((state.sites || []).map((s) => [s.domain, s]));
  const rows = Object.entries(usageMap)
    .filter(([, ms]) => ms > 0)
    .map(([domain, used]) => {
      const site = siteByDomain.get(domain) || {
        id: domain,
        domain,
        displayName: domain,
        category: "other",
        dailyLimitMinutes: 0,
        dailyLimitUnit: "minutes",
        redirectUrl: ""
      };
      return { site, used };
    })
    .sort((a, b) => b.used - a.used);

  $("sites-empty").style.display = rows.length ? "none" : "block";
  $("sites-empty").textContent = isToday
    ? "Browse as usual — sites you visit will show up here. Tap one to set a daily limit."
    : "No websites visited this day.";

  $("site-list").innerHTML = rows
    .map(({ site, used }) => {
      const unit = site.dailyLimitUnit || "minutes";
      const limitMs = (Number(site.dailyLimitMinutes) || 0) * 60 * 1000;
      const pct = limitMs > 0 ? Math.min(100, (used / limitMs) * 100) : 0;
      const cat = CATEGORY_BY_ID[site.category] || CATEGORY_BY_ID.other;
      const open = isToday && expandedId === site.id ? "open" : "";
      const initial = (site.displayName || site.domain).charAt(0).toUpperCase();
      const bar =
        isToday && limitMs > 0
          ? `<div class="bar" aria-hidden="true"><span style="width:${pct}%;background:${cat.color}"></span></div>`
          : "";
      const expand = isToday
        ? `<div class="expand">
            <label>Daily limit
              <div class="limit-row">
                <input type="number" min="0" step="1" value="${escapeHtml(minutesToDisplay(site.dailyLimitMinutes, unit))}" data-limit="${site.id}" />
                <select data-limit-unit="${site.id}" aria-label="Limit unit">
                  <option value="minutes" ${unit === "minutes" ? "selected" : ""}>Minutes</option>
                  <option value="hours" ${unit === "hours" ? "selected" : ""}>Hours</option>
                </select>
              </div>
            </label>
            <label>Redirect site
              <input type="text" value="${escapeHtml(site.redirectUrl || "")}" placeholder="leetcode.com" data-redirect="${site.id}" />
            </label>
            <button type="button" class="danger-btn" data-remove="${site.id}">Remove limit</button>
          </div>`
        : "";
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
          ${bar}
          ${expand}
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
    if (!isToday) return;
    const toggle = e.target.closest("[data-toggle]");
    if (toggle) {
      const id = toggle.dataset.toggle;
      expandedId = expandedId === id ? null : id;
      render();
      return;
    }
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      const site = state.sites.find((s) => s.id === remove.dataset.remove);
      if (site) {
        site.dailyLimitMinutes = 0;
        site.redirectUrl = "";
      }
      await saveState(state);
      expandedId = null;
      render();
    }
  };

  $("site-list").onchange = async (e) => {
    const limit = e.target.dataset.limit;
    const unitId = e.target.dataset.limitUnit;
    const redirect = e.target.dataset.redirect;
    const site = state.sites.find((s) => s.id === (limit || unitId || redirect));
    if (!site) return;
    if (limit || unitId) {
      const row = e.target.closest(".site-row");
      const unit = row.querySelector("[data-limit-unit]")?.value || site.dailyLimitUnit || "minutes";
      const value = row.querySelector("[data-limit]")?.value;
      site.dailyLimitUnit = unit;
      site.dailyLimitMinutes = limitToMinutes(value, unit);
    }
    if (redirect) site.redirectUrl = e.target.value.trim();
    await saveState(state);
  };
}

function renderPeriod() {
  const isMonth = state.dataRetention === "month";
  $("period-title").textContent = isMonth ? monthTitle() : "This Week";
  $("week-chart").classList.toggle("hidden", isMonth);
  $("month-chart").classList.toggle("hidden", !isMonth);
  if (isMonth) renderMonth();
  else renderWeek();
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

function renderMonth() {
  const keys = monthDateKeys();
  const today = localDateKey();
  const totals = keys.map((k) => totalForDate(state, k));
  const max = Math.max(1, ...totals);
  const firstDow = parseDateKey(keys[0]).getDay();
  const pad = firstDow === 0 ? 6 : firstDow - 1;
  const headers = ["M", "T", "W", "T", "F", "S", "S"]
    .map((label) => `<span class="month-dow">${label}</span>`)
    .join("");
  const blanks = Array.from({ length: pad }, () => `<span class="month-cell empty"></span>`).join("");
  const cells = keys
    .map((key, i) => {
      const used = totals[i];
      const intensity = used <= 0 ? 0 : 0.18 + 0.72 * (used / max);
      const bg = used > 0 ? `rgba(94, 92, 230, ${intensity.toFixed(2)})` : "#f2f2f7";
      const color = intensity > 0.55 ? "#ffffff" : "inherit";
      const active = key === selectedDate ? "active" : "";
      const isToday = key === today ? "today" : "";
      const future = key > today ? "future" : "";
      const dayNum = parseDateKey(key).getDate();
      return `<button type="button" class="month-cell ${active} ${isToday} ${future}" data-day="${key}" style="background:${bg};color:${color}" title="${formatDuration(used)}">${dayNum}</button>`;
    })
    .join("");
  $("month-chart").innerHTML = headers + blanks + cells;
  $("month-chart").onclick = (e) => {
    const btn = e.target.closest("[data-day]");
    if (!btn || btn.classList.contains("future")) return;
    selectedDate = btn.dataset.day;
    render();
  };
}

function renderSettings() {
  $("data-retention").value = state.dataRetention === "month" ? "month" : "week";
  $("retention-hint").textContent =
    state.dataRetention === "month"
      ? "Only this calendar month is kept. When a new month starts, last month is deleted. This is a few kilobytes — it will not slow Chrome."
      : "Only this week (Mon–Sun) is kept. When a new week starts, last week is deleted. This is a few kilobytes — it will not slow Chrome.";
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
