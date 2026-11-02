/**
 * Shared constants for Browser Screen Time.
 * Keep category ids stable — they are stored in chrome.storage.local.
 */

export const CATEGORIES = [
  { id: "social", label: "Social", color: "#64d2ff" },
  { id: "entertainment", label: "Entertainment", color: "#bf5af2" },
  { id: "shopping", label: "Shopping", color: "#ff9f0a" },
  { id: "productivity", label: "Productivity", color: "#30d158" },
  { id: "other", label: "Other", color: "#8e8e93" }
];

export const CATEGORY_BY_ID = Object.fromEntries(
  CATEGORIES.map((c) => [c.id, c])
);

/** Popular sites shown in the Add Site sheet. */
export const PRESET_SITES = [
  {
    domain: "youtube.com",
    displayName: "YouTube",
    category: "entertainment",
    aliases: ["youtu.be", "m.youtube.com"]
  },
  {
    domain: "instagram.com",
    displayName: "Instagram",
    category: "social"
  },
  {
    domain: "tiktok.com",
    displayName: "TikTok",
    category: "social"
  },
  {
    domain: "x.com",
    displayName: "Twitter / X",
    category: "social",
    aliases: ["twitter.com"]
  },
  {
    domain: "reddit.com",
    displayName: "Reddit",
    category: "social"
  },
  {
    domain: "facebook.com",
    displayName: "Facebook",
    category: "social",
    aliases: ["fb.com", "m.facebook.com"]
  }
];

export const PRESET_BY_DOMAIN = Object.fromEntries(
  PRESET_SITES.map((s) => [s.domain, s])
);

/** Donut slice colors — bright so they pop on the gradient hero card. */
export const SITE_SLICE_COLORS = [
  "#ffd60a",
  "#5ef0ff",
  "#6dffa8",
  "#ffb04a",
  "#ffffff",
  "#ffa3d7"
];

/** One-tap limit choices in the dashboard (minutes). */
export const QUICK_LIMITS = [15, 30, 60, 120];

/** Idle after this many seconds is not counted as screen time. */
export const IDLE_SECONDS = 60;

/** Cap a single flush so a sleeping worker cannot dump hours at once. */
export const MAX_FLUSH_MS = 5 * 60 * 1000;

export const STORAGE_KEY = "bst_state";
export const SESSION_KEY = "bst_session";

export const ALARM_TICK = "bst_tick";
export const ALARM_MIDNIGHT = "bst_midnight";
