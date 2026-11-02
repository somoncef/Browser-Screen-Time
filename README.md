# Browser Screen Time

A Chrome extension that tracks how long you spend on each website and helps you cut back, styled after iPhone Screen Time.

## Features

- **Automatic tracking.** Time is counted only for the tab you are actually looking at: background tabs, unfocused windows and idle time (60 seconds without input) are not counted.
- **Today at a glance.** Total time, a comparison with the previous day, and a donut chart of your top sites.
- **Most Used list.** Every site you visit, with its category, time spent and, if it has a limit, how much time is left.
- **Daily limits.** Set a limit per site in minutes or hours, or tap 15m / 30m / 1h / 2h. A progress bar turns green → amber → red as you approach the limit.
- **Blocking.** When a limit is reached the site is replaced with a "Time Limit" page that counts down until midnight. You can optionally redirect to another site instead (e.g. `reddit.com` → `leetcode.com`).
- **Downtime.** Block every website during a daily time window (e.g. 22:00–07:00), except sites on your **Always Allowed** list. Always Allowed sites skip Downtime but still respect their daily limits.
- **History.** A weekly bar chart or a monthly heatmap; tap any day to see that day's usage.
- **Light and dark mode**, following your system setting.

## Install

The extension is not on the Chrome Web Store. To load it locally:

1. Download or clone this repository.
2. Open `chrome://extensions` in Chrome (or `edge://extensions` in Edge).
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the project folder (the one containing `manifest.json`).
5. Pin the extension and click its icon to open the dashboard.

There is no build step; the source files are loaded as-is.

## Usage

- **Set a limit on a site you use:** open the dashboard, tap the site in **Most Used**, then pick a quick limit or type your own.
- **Set a limit before visiting a site:** tap **+**, pick a popular site or type a domain, choose a limit and tap **Add Site**.
- **Remove a limit:** open the site in **Most Used** and tap **Remove limit**.
- **Downtime:** switch it on, set the From/To times and add any sites you always want available.
- **History length:** under **Settings**, keep usage for *this week* (resets every Monday) or *this month* (resets on the 1st).

A domain also covers its subdomains: a limit on `youtube.com` applies to `www.youtube.com` and `music.youtube.com`.

## Project structure

```
manifest.json               Extension manifest (Manifest V3)
background/
  service-worker.js         Time tracking, midnight rollover, blocking
dashboard/
  index.html                Popup UI
  dashboard.js              Popup logic and rendering
  styles.css                Popup styles (light + dark)
blocked/
  blocked.html/.css/.js     Page shown when a site is blocked
shared/
  constants.js              Categories, preset sites, colors, timings
  domains.js                Domain normalization and matching
  rules.js                  Daily limit and Downtime rules
  sites.js                  Creating and updating site records
  storage.js                chrome.storage state, history pruning
  time.js                   Local date and duration helpers
icons/                      Extension icons
```

### How tracking works

The service worker keeps a small snapshot (active domain, last tick, focus and idle state) in `chrome.storage.session`. On every tab switch, page load, window focus change, idle change and a one-minute alarm, it credits the time elapsed since the last snapshot to the previous site, then checks every open tab and blocks any that are over their limit or in Downtime. A single credit is capped at 5 minutes, so a sleeping worker can't add hours at once. At local midnight, today's usage moves into history.

All data is stored in `chrome.storage.local` under the `bst_state` key. See the comment at the top of `shared/storage.js` for its shape.

## Permissions

| Permission | Why |
| --- | --- |
| `tabs` | Read the active tab's URL and redirect blocked tabs |
| `storage` | Save sites, limits and usage history |
| `alarms` | Per-minute tracking tick and midnight rollover |
| `idle` | Stop counting time when you are away |
| `host_permissions` (`http://*/*`, `https://*/*`) | Access to all websites |

## Privacy

Usage data never leaves your browser; there is no server and no analytics. One exception: site icons are loaded from Google's favicon service (`google.com/s2/favicons`), which reveals to Google the domains shown in the dashboard.
