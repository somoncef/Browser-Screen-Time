/**
 * Local-time helpers. All Screen Time math is in the user's timezone.
 */

const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const WEEKDAY_FULL = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday"
];

/** YYYY-MM-DD in local time. */
export function localDateKey(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

export function parseDateKey(key) {
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d);
}

/** Monday-first week containing `date` (iOS Screen Time style). */
export function weekDateKeys(date = new Date()) {
  const day = date.getDay(); // 0 Sun … 6 Sat
  const mondayOffset = day === 0 ? -6 : 1 - day;
  const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() + mondayOffset);
  const keys = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    keys.push(localDateKey(d));
  }
  return keys;
}

/** All YYYY-MM-DD keys in the calendar month of `date`. */
export function monthDateKeys(date = new Date()) {
  const y = date.getFullYear();
  const m = date.getMonth();
  const last = new Date(y, m + 1, 0).getDate();
  const keys = [];
  for (let d = 1; d <= last; d++) {
    keys.push(localDateKey(new Date(y, m, d)));
  }
  return keys;
}

export function monthTitle(date = new Date()) {
  return date.toLocaleString(undefined, { month: "long", year: "numeric" });
}

export function retainedDateKeys(retention, date = new Date()) {
  return retention === "month" ? monthDateKeys(date) : weekDateKeys(date);
}

export function weekdayLabel(dateKey) {
  return WEEKDAY_SHORT[parseDateKey(dateKey).getDay()];
}

export function weekdayFull(dateKey) {
  return WEEKDAY_FULL[parseDateKey(dateKey).getDay()];
}

/** "Today", "Yesterday", or "Thursday" for the dashboard hero. */
export function dayHeading(dateKey, now = new Date()) {
  const today = localDateKey(now);
  if (dateKey === today) return "Today";
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (dateKey === localDateKey(yesterday)) return "Yesterday";
  return weekdayFull(dateKey);
}

export function parseHHMM(value) {
  const [h, m] = String(value || "00:00").split(":").map(Number);
  return (h || 0) * 60 + (m || 0);
}

export function minutesOfDay(date = new Date()) {
  return date.getHours() * 60 + date.getMinutes();
}

/**
 * Next local midnight as a timestamp, for chrome.alarms.
 */
export function nextLocalMidnightMs(from = new Date()) {
  const next = new Date(from);
  next.setHours(24, 0, 0, 0);
  return next.getTime();
}

/** Human duration: 2h 14m, 45m, 12s (only seconds if under a minute). */
export function formatDuration(ms) {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hours = Math.floor(totalSec / 3600);
  const minutes = Math.floor((totalSec % 3600) / 60);
  const seconds = totalSec % 60;
  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }
  if (minutes > 0) return `${minutes}m`;
  return `${seconds}s`;
}

/** Large dashboard numeral: always show hours + minutes like iOS. */
export function formatDurationLarge(ms) {
  const totalMin = Math.max(0, Math.floor(ms / 60000));
  const hours = Math.floor(totalMin / 60);
  const minutes = totalMin % 60;
  return { hours, minutes, text: `${hours}h ${minutes}m` };
}

export function formatClock(date) {
  return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/**
 * Time remaining until local midnight, or until downtime ends.
 */
export function msUntilMidnight(from = new Date()) {
  return nextLocalMidnightMs(from) - from.getTime();
}

export function downtimeEndDate(downtime, from = new Date()) {
  const endMins = parseHHMM(downtime.end);
  const end = new Date(from);
  end.setHours(Math.floor(endMins / 60), endMins % 60, 0, 0);
  const startMins = parseHHMM(downtime.start);
  const nowMins = minutesOfDay(from);
  const overnight = startMins >= endMins;
  if (overnight) {
    if (nowMins >= startMins) {
      end.setDate(end.getDate() + 1);
    }
  } else if (nowMins >= endMins) {
    end.setDate(end.getDate() + 1);
  }
  return end;
}
