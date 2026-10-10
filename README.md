# Bug Reporter (Chrome extension)

Report a problem in one click. The extension quietly records what happens on each tab and, when you click **Report a problem**, bundles everything into a zip:

- Screenshot (visible area or full page) with your markings: highlight, arrow, hide private info, pen, text
- Every `fetch` / `XMLHttpRequest` call with request/response headers, bodies and timestamps (also as a HAR file)
- Console errors and warnings, uncaught exceptions, unhandled promise rejections, failed resource loads
- The steps you took (clicks, typing with values hidden, form submits, page changes)
- A replay of the last 30 to 60 seconds of the page (typed text masked)
- Browser and device details
- `report.html`: an offline viewer for all of the above; `summary.md`: a ready-to-paste ticket summary

Personal data (auth headers, cookies, passwords, tokens, emails, card numbers, plus your own rules) is redacted **before** it is stored.

## Simple and Advanced modes

Switch with the toggle at the top of the popup, review page or settings.

- **Simple** (default): one big button, a 3-step guided review (Mark, Describe, Save), plain language, no counters on the toolbar icon.
- **Advanced**: request/error counters, visible vs full-page choice, all drawing tools, captured-activity timeline, pause per site, and every setting.

Both modes produce the same complete zip, so developers always get full technical details.

## Install

1. Open `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.
3. Pin the extension. Tabs that were already open are picked up automatically; if one says "isn't being recorded yet", reload it.

## Try it with the demo app

```bash
node test/server.js
```

Open http://localhost:5173, click around (Pay now fails on purpose), then click the extension icon and **Report a problem**.

## Zip contents

| File | What it is |
| --- | --- |
| `report.html` | Offline viewer: overview, timeline, network, console, replay |
| `summary.md` | Markdown summary for tickets |
| `screenshot.png` | Screenshot with markings |
| `screenshot-original.png`, `screenshot-fullpage.png` | Originals |
| `network.json`, `network.har` | Requests and responses (HAR opens in DevTools > Network) |
| `console.json`, `actions.json`, `navigation.json`, `timeline.json` | Raw event logs |
| `environment.json` | Browser, OS, screen, locale, storage keys |
| `replay.json` | rrweb session replay events |
| `report.json` | Metadata, description, steps, counts |

## Limitations

- Only `fetch` and `XMLHttpRequest` are captured (not WebSockets, `sendBeacon`, or requests made by service workers or before the page starts).
- Replay and the action trail restart on a full page reload; network and console logs survive reloads.
- Full-page screenshots can show artifacts on pages with scroll animations or inner scrolling containers.
- Chrome doesn't allow extensions on `chrome://` pages or the Chrome Web Store.

## Project layout

```
manifest.json
background/   service worker: buffers, redaction, badge, screenshots, report prep
content/      inject.js (page world: fetch/XHR/console/history), collector.js (actions, replay, env, full-page scrolling)
shared/       settings, mode toggle, redaction, descriptions, timeline, HAR, markdown, ui.css
popup/        toolbar popup
review/       review page: annotation, description, export (zip builder)
report/       template for the offline report.html
options/      settings page
lib/          vendored JSZip 3.10.2, rrweb record + player 2.1.7
test/         demo app (server.js + demo.html)
```
# snapcase
