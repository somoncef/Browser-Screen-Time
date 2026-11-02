/**
 * Dashboard popup: Today totals, site donut, Most Used list,
 * Add Site sheet, weekly bars / month heatmap, and Downtime controls.
 *
 * Reads/writes chrome.storage.local. Usage ticks happen in the service worker.
 */

import {
  CATEGORIES,
  PRESET_SITES,
  CATEGORY_BY_ID,
  QUICK_LIMITS,
  SITE_SLICE_COLORS
} from "../shared/constants.js";
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
import { isDowntimeNow } from "../shared/rules.js";
import { limitToMinutes, minutesToDisplay } from "../shared/sites.js";

const $ = (id) => document.getElementById(id);

let selectedDate = localDateKey();
let expandedId = null;
let state = null;
let toastTimer = null;

init();

async function init() {
  fillCategorySelect();
  fillPresets();
  fillQuickLimits();
  bindEvents();
  state = await loadState();
  render();
  chrome.storage.onChanged.addListener(async (changes, area) => {
    if (area !== "local") return;
    state = await loadState();
    // Usage ticks arrive every minute — don't wipe an input the user is typing in.
    if (isEditing()) return;
    render();
  });
}

/** True while focus is inside a site's limit editor (render() would rebuild it). */
function isEditing() {
  return Boolean(document.activeElement?.closest(".expand"));
}

function fillCategorySelect() {
  $("add-category").innerHTML = CATEGORIES.map(
    (c) => `<option value="${c.id}">${c.label}</option>`
  ).join("");
}

function fillPresets() {
  $("presets").innerHTML = PRESET_SITES.map(
    (s) =>
      `<button type="button" class="preset" data-domain="${s.domain}"><img src="${faviconUrl(s.domain)}" alt="" />${s.displayName}</button>`
  ).join("");
}

function fillQuickLimits() {
  $("add-quick").innerHTML = quickButtons(null);
}

function quickButtons(siteId, currentMinutes) {
  const target = siteId ? `data-site="${siteId}"` : "";
  const buttons = QUICK_LIMITS.map((m) => {
    const selected = currentMinutes === m ? "selected" : "";
    return `<button type="button" class="quick ${selected}" data-quick="${m}" ${target}>${formatDuration(m * 60000)}</button>`;
  });
  return buttons.join("");
}

function bindEvents() {
  $("add-open").addEventListener("click", () => openSheet());
  $("add-cancel").addEventListener("click", closeSheet);
  $("add-save").addEventListener("click", onAddSite);
  $("add-sheet").addEventListener("click", (e) => {
    if (e.target.id === "add-sheet") closeSheet();
  });
  $("back-today").addEventListener("click", () => {
    selectedDate = localDateKey();
    render();
  });

  document.addEventListener("keydown", (e) => {
    const sheetOpen = !$("add-sheet").classList.contains("hidden");
    if (e.key === "Escape" && sheetOpen) {
      e.preventDefault();
      closeSheet();
    } else if (e.key === "Enter" && sheetOpen && e.target.matches("input")) {
      e.preventDefault();
      onAddSite();
    }
  });

  $("presets").addEventListener("click", (e) => {
    const btn = e.target.closest(".preset");
    if (!btn) return;
    const preset = PRESET_SITES.find((s) => s.domain === btn.dataset.domain);
    document.querySelectorAll(".preset").forEach((el) => el.classList.remove("selected"));
    btn.classList.add("selected");
    $("add-domain").value = preset.domain;
    $("add-category").value = preset.category;
    clearAddError();
    syncSaveLabel();
  });

  $("add-quick").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-quick]");
    if (!btn) return;
    const minutes = Number(btn.dataset.quick);
    const unit = minutes % 60 === 0 ? "hours" : "minutes";
    $("add-limit-unit").value = unit;
    $("add-limit").value = minutesToDisplay(minutes, unit);
    syncAddQuick();
  });
  $("add-limit").addEventListener("input", syncAddQuick);
  $("add-limit-unit").addEventListener("change", syncAddQuick);

  $("add-domain").addEventListener("input", () => {
    const domain = normalizeDomain($("add-domain").value);
    const preset = findPreset(domain);
    if (preset) $("add-category").value = preset.category;
    clearAddError();
    syncSaveLabel();
  });

  $("downtime-enabled").addEventListener("change", saveDowntime);
  $("downtime-start").addEventListener("change", saveDowntime);
  $("downtime-end").addEventListener("change", saveDowntime);
  $("data-retention").addEventListener("change", saveRetention);

  $("allowed-form").addEventListener("submit", async (e) => {
    e.preventDefault();
    const input = $("allowed-input");
    const domain = normalizeDomain(input.value);
    if (!isValidDomain(domain)) {
      input.classList.add("invalid");
      input.focus();
      return;
    }
    input.classList.remove("invalid");
    if (!state.alwaysAllowed.includes(domain)) {
      state.alwaysAllowed = [...state.alwaysAllowed, domain];
      await saveState(state);
      showToast(`${domain} is always allowed`);
    }
    input.value = "";
    render();
  });
  $("allowed-input").addEventListener("input", () =>
    $("allowed-input").classList.remove("invalid")
  );
}

function findPreset(domain) {
  return PRESET_SITES.find((s) => s.domain === domain || (s.aliases || []).includes(domain));
}

function isValidDomain(domain) {
  return /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(domain);
}

function openSheet() {
  $("add-domain").value = "";
  $("add-limit").value = "30";
  $("add-limit-unit").value = "minutes";
  $("add-redirect").value = "";
  $("add-category").value = "other";
  document.querySelectorAll(".preset").forEach((el) => el.classList.remove("selected"));
  clearAddError();
  syncAddQuick();
  syncSaveLabel();
  $("add-sheet").classList.remove("hidden");
  $("add-domain").focus();
}

function closeSheet() {
  $("add-sheet").classList.add("hidden");
}

function clearAddError() {
  $("add-error").classList.add("hidden");
  $("add-domain").classList.remove("invalid");
}

function syncAddQuick() {
  const minutes = limitToMinutes($("add-limit").value, $("add-limit-unit").value);
  $("add-quick").querySelectorAll("[data-quick]").forEach((btn) => {
    btn.classList.toggle("selected", Number(btn.dataset.quick) === minutes);
  });
}

function syncSaveLabel() {
  const domain = normalizeDomain($("add-domain").value);
  const preset = findPreset(domain);
  const exists = state?.sites.some((s) => s.domain === (preset?.domain || domain));
  $("add-save").textContent = exists ? "Update Limit" : "Add Site";
}

async function onAddSite() {
  const domain = normalizeDomain($("add-domain").value);
  if (!isValidDomain(domain)) {
    $("add-error").classList.remove("hidden");
    $("add-domain").classList.add("invalid");
    $("add-domain").focus();
    return;
  }
  const unit = $("add-limit-unit").value || "minutes";
  const preset = findPreset(domain);
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
  const name = preset?.displayName || domain;
  showToast(minutes > 0 ? `${name}: ${formatDuration(minutes * 60000)} a day` : `${name} added`);
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
  renderDowntime();
}

function showToast(message) {
  const toast = $("toast");
  toast.textContent = message;
  toast.classList.remove("hidden");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.add("hidden"), 2200);
}

function render() {
  const today = localDateKey();
  const periodKeys = retainedDateKeys(state.dataRetention);
  if (!periodKeys.includes(selectedDate)) selectedDate = today;

  const isToday = selectedDate === today;
  const usageMap = usageMapForDate(state, selectedDate);
  const total = sumUsage(usageMap);
  const heading = dayHeading(selectedDate);

  $("nav-date").textContent = new Date().toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric"
  });

  const hero = formatDurationLarge(total);
  $("hero-eyebrow").textContent = heading;
  $("hero-time").textContent = hero.text;
  $("hero-delta").textContent = comparisonLine(selectedDate, total);
  $("hero-delta").className = `delta ${comparisonClass(selectedDate, total)}`;
  $("back-today").classList.toggle("hidden", isToday);

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
  const diff = Math.round(((total - previous) / previous) * 100);
  const abs = Math.abs(diff);
  if (diff < 0) return `↓ ${abs}% vs ${prevName}`;
  if (diff > 0) return `↑ ${abs}% vs ${prevName}`;
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
    slices.push({ domain: "_other", label: "Other", ms: restMs, color: "rgba(255,255,255,0.45)" });
  }
  return { slices, count: ranked.length };
}

function renderDonut(usageMap) {
  const { slices, count } = siteSlices(usageMap);
  const sum = slices.reduce((a, s) => a + s.ms, 0);
  const svg = $("donut");
  const cx = 60;
  const cy = 60;
  const r = 44;
  const circ = 2 * Math.PI * r;
  const gap = slices.length > 1 ? 1.5 : 0;

  let offset = 0;
  const arcs = slices
    .map((slice) => {
      const len = (slice.ms / sum) * circ;
      const visible = Math.max(0, len - gap);
      const dash = `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${slice.color}" stroke-width="14" stroke-dasharray="${visible} ${circ - visible}" stroke-dashoffset="${-offset}" />`;
      offset += len;
      return dash;
    })
    .join("");

  svg.innerHTML = `
    <circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="rgba(255,255,255,0.18)" stroke-width="14" />
    ${arcs}
  `;

  $("donut-count").textContent = String(count);
  $("donut-label").textContent = count === 1 ? "site" : "sites";

  $("legend").innerHTML = slices
    .map(
      (slice) =>
        `<li><span><span class="swatch" style="background:${slice.color}"></span>${escapeHtml(slice.label)}</span><span>${formatDuration(slice.ms)}</span></li>`
    )
    .join("");
}

/** Bar / badge color: green while comfortable, amber near the limit, red when over. */
function limitTone(pct) {
  if (pct >= 100) return { cls: "over", color: "var(--danger)" };
  if (pct >= 75) return { cls: "warn", color: "var(--warn)" };
  return { cls: "", color: "var(--good)" };
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
  $("sites-empty-text").textContent = isToday
    ? "Browse as usual — sites you visit will show up here. Tap one to set a daily limit."
    : "No websites visited this day.";

  $("site-list").innerHTML = rows
    .map(({ site, used }) => {
      const unit = site.dailyLimitUnit || "minutes";
      const limitMin = Number(site.dailyLimitMinutes) || 0;
      const limitMs = limitMin * 60 * 1000;
      const pct = limitMs > 0 ? Math.min(100, (used / limitMs) * 100) : 0;
      const tone = limitTone(pct);
      const cat = CATEGORY_BY_ID[site.category] || CATEGORY_BY_ID.other;
      const open = isToday && expandedId === site.id ? "open" : "";
      const initial = (site.displayName || site.domain).charAt(0).toUpperCase();

      let limitTag = "";
      if (limitMs > 0) {
        const text = !isToday
          ? `${formatDuration(limitMs)} limit`
          : used >= limitMs
            ? "Limit reached"
            : `${formatDuration(limitMs - used)} left`;
        limitTag = `<span class="tag limit-tag ${isToday ? tone.cls : ""}">⏱ ${text}</span>`;
      }

      const bar =
        isToday && limitMs > 0
          ? `<div class="bar" aria-hidden="true"><span style="width:${pct}%;background:${tone.color}"></span></div>`
          : "";
      const expand = isToday
        ? `<div class="expand">
            <div class="field-label">Daily limit
              <div class="quick-limits">${quickButtons(site.id, limitMin)}</div>
              <div class="limit-row">
                <input type="number" min="0" step="1" value="${escapeHtml(minutesToDisplay(site.dailyLimitMinutes, unit))}" data-limit="${site.id}" aria-label="Daily limit" />
                <select data-limit-unit="${site.id}" aria-label="Limit unit">
                  <option value="minutes" ${unit === "minutes" ? "selected" : ""}>Minutes</option>
                  <option value="hours" ${unit === "hours" ? "selected" : ""}>Hours</option>
                </select>
              </div>
            </div>
            <label>Redirect here when blocked
              <input type="text" value="${escapeHtml(site.redirectUrl || "")}" placeholder="leetcode.com" data-redirect="${site.id}" />
            </label>
            ${limitMs > 0 || site.redirectUrl ? `<button type="button" class="danger-btn" data-remove="${site.id}">Remove limit</button>` : ""}
          </div>`
        : "";
      return `
        <li class="site-row ${open}" data-id="${site.id}">
          <button type="button" class="site-main" data-toggle="${site.id}" ${isToday ? "" : "disabled"} aria-expanded="${open ? "true" : "false"}">
            <img class="favicon" src="${faviconUrl(site.domain)}" alt="" data-fallback="${cat.color}|${initial}" />
            <span>
              <span class="site-name">${escapeHtml(site.displayName)}</span>
              <span class="meta">
                <span class="tag" style="--c:${cat.color}">${cat.label}</span>
                ${limitTag}
              </span>
            </span>
            <span class="site-time">${formatDuration(used)}</span>
            ${isToday ? `<span class="chevron" aria-hidden="true">›</span>` : "<span></span>"}
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
    const quick = e.target.closest("[data-quick][data-site]");
    if (quick) {
      const site = state.sites.find((s) => s.id === quick.dataset.site);
      if (!site) return;
      const minutes = Number(quick.dataset.quick);
      site.dailyLimitMinutes = minutes;
      site.dailyLimitUnit = minutes % 60 === 0 ? "hours" : "minutes";
      await saveState(state);
      showToast(`${site.displayName}: ${formatDuration(minutes * 60000)} a day`);
      render();
      return;
    }
    const remove = e.target.closest("[data-remove]");
    if (remove) {
      const site = state.sites.find((s) => s.id === remove.dataset.remove);
      if (site) {
        site.dailyLimitMinutes = 0;
        site.redirectUrl = "";
        showToast(`Limit removed for ${site.displayName}`);
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
    showToast("Saved");
    e.target.blur();
    render();
  };
}

function renderPeriod() {
  const isMonth = state.dataRetention === "month";
  const keys = isMonth ? monthDateKeys() : weekDateKeys();
  const today = localDateKey();
  const pastTotals = keys.filter((k) => k <= today).map((k) => totalForDate(state, k));
  const daysWithData = pastTotals.filter((t) => t > 0);
  const avg = daysWithData.length
    ? daysWithData.reduce((a, b) => a + b, 0) / daysWithData.length
    : 0;

  $("period-title").textContent = isMonth ? monthTitle() : "This Week";
  $("period-avg").textContent = avg > 0 ? `Daily avg ${formatDuration(avg)}` : "";
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
      const h = totals[i] > 0 ? Math.max(6, Math.round((totals[i] / max) * 88)) : 0;
      const active = key === selectedDate ? "active" : "";
      const isToday = key === today ? "today" : "";
      return `
        <button type="button" class="week-day ${active} ${isToday}" data-day="${key}" title="${weekdayLabel(key)} · ${formatDuration(totals[i])}">
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

/** Heatmap color: cool violet for light days, hot pink for heavy days. */
function heatColor(ratio) {
  const hue = 255 + 75 * ratio;
  const light = 88 - 36 * ratio;
  return `hsl(${hue.toFixed(0)}, 85%, ${light.toFixed(0)}%)`;
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
      const ratio = used / max;
      const style = used > 0
        ? `background:${heatColor(ratio)};color:${ratio > 0.5 ? "#ffffff" : "#2a1f5c"}`
        : "";
      const active = key === selectedDate ? "active" : "";
      const isToday = key === today ? "today" : "";
      const future = key > today ? "future" : "";
      const dayNum = parseDateKey(key).getDate();
      return `<button type="button" class="month-cell ${active} ${isToday} ${future}" data-day="${key}" style="${style}" title="${formatDuration(used)}">${dayNum}</button>`;
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
      ? "History resets on the 1st of each month."
      : "History resets every Monday.";
}

function renderDowntime() {
  const enabled = Boolean(state.downtime.enabled);
  $("downtime-enabled").checked = enabled;
  $("downtime-start").value = state.downtime.start || "22:00";
  $("downtime-end").value = state.downtime.end || "07:00";
  $("downtime-times").classList.toggle("off", !enabled);
  $("downtime-active").classList.toggle("hidden", !isDowntimeNow(state.downtime));
  $("allowed-chips").innerHTML = (state.alwaysAllowed || [])
    .map(
      (d) =>
        `<span class="chip">${escapeHtml(d)}<button type="button" data-unallow="${escapeHtml(d)}" aria-label="Remove ${escapeHtml(d)}">×</button></span>`
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
