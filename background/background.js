import { getSettings, setSettings, getHost, isCaptureEnabled, isPausedHost, isCapturableUrl } from '../shared/settings.js';
import { createRedactor } from '../shared/redact.js';
import { ensureLoaded, addEvents, clearTab, snapshot, counts, tabIds } from './store.js';
import { updateBadge } from './badge.js';
import { captureVisible, captureFullPage } from './screenshot.js';

const STATIC_RE = /\.(m?js|css|png|jpe?g|gif|svg|webp|avif|ico|woff2?|ttf|otf|eot|map|mp4|webm|mp3)(\?|#|$)/i;
const REPORT_TTL_MS = 30 * 60 * 1000;

const pendingReports = new Map();
let settingsCache = null;
let redactor = null;

async function settings() {
  if (!settingsCache) {
    settingsCache = await getSettings();
    redactor = createRedactor(settingsCache);
  }
  return settingsCache;
}

chrome.storage.onChanged.addListener(async (changes, area) => {
  if (area !== 'sync') return;
  settingsCache = null;
  const s = await settings();
  await ensureLoaded();
  for (const id of tabIds()) updateBadge(id, counts(id), s);
});

function isStaticUrl(url) {
  try {
    return STATIC_RE.test(new URL(url).pathname);
  } catch {
    return false;
  }
}

function contentConfig(s, url) {
  return {
    enabled: isCaptureEnabled(s, url),
    maxBodyBytes: Math.max(1, Number(s.maxBodyKB) || 100) * 1024,
    consoleLevels: s.consoleLevels,
    replayEnabled: s.replayEnabled,
    replaySeconds: Number(s.replaySeconds) || 30,
    includeStorageValues: s.includeStorageValues,
  };
}

// ---------- report ----------

function makeId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

async function safeSend(tabId, msg) {
  try {
    return await chrome.tabs.sendMessage(tabId, msg);
  } catch {
    return null;
  }
}

async function prepareReport(tabId, mode) {
  const s = await settings();
  const tab = await chrome.tabs.get(tabId);
  if (!isCapturableUrl(tab.url)) {
    throw new Error("This page can't be captured. Chrome doesn't allow extensions on built-in pages like this one.");
  }

  const warnings = [];
  const visible = await captureVisible(tab.windowId);
  let fullPage = null;
  if (mode === 'fullpage') {
    try {
      const result = await captureFullPage(tab, Number(s.maxFullPageHeight) || 15000);
      fullPage = result.dataUrl;
      if (result.truncated) warnings.push('The page is very long, so the full-page screenshot was cut off at the maximum height.');
    } catch (e) {
      warnings.push(`The full-page screenshot could not be taken (${e.message}). Only the visible area is included.`);
    }
  }

  await safeSend(tabId, { type: 'flush' });
  await ensureLoaded();
  const data = snapshot(tabId);
  const env = (await safeSend(tabId, { type: 'getEnv' })) || { url: tab.url, title: tab.title };
  let replayEvents = [];
  if (s.replayEnabled) {
    const res = await safeSend(tabId, { type: 'getReplay' });
    replayEvents = (res && res.events) || [];
    if (!replayEvents.length) warnings.push('No session replay was available for this page (it starts recording when the page loads).');
  }

  const r = redactor;
  const report = {
    id: makeId(),
    createdAt: new Date().toISOString(),
    extensionVersion: chrome.runtime.getManifest().version,
    page: { url: r.url(tab.url), title: tab.title || '', host: getHost(tab.url) },
    screenshotMode: fullPage ? 'fullpage' : 'visible',
    screenshots: { visible, fullPage },
    network: data.network,
    console: data.console,
    actions: data.actions,
    navigation: data.navigation,
    environment: { ...r.environment(env), extensionVersion: chrome.runtime.getManifest().version },
    replay: { seconds: Number(s.replaySeconds) || 30, events: r.replay(replayEvents) },
    warnings,
  };

  const now = Date.now();
  for (const [id, entry] of pendingReports) if (now - entry.at > REPORT_TTL_MS) pendingReports.delete(id);
  pendingReports.set(report.id, { at: now, report });

  await chrome.tabs.create({
    url: chrome.runtime.getURL(`review/review.html?id=${report.id}`),
    index: tab.index + 1,
    openerTabId: tab.id,
    windowId: tab.windowId,
  });
  return { ok: true, id: report.id };
}

// ---------- message handlers ----------

const handlers = {
  async hello(msg, sender) {
    const s = await settings();
    return { config: contentConfig(s, (sender.tab && sender.tab.url) || msg.url) };
  },

  async events(msg, sender) {
    const tabId = sender.tab && sender.tab.id;
    if (tabId == null || sender.frameId !== 0) return { ok: false };
    const s = await settings();
    const url = sender.url || sender.tab.url;
    if (!isCaptureEnabled(s, url)) return { ok: false };
    const events = (msg.events || [])
      .filter((e) => e && typeof e === 'object' && typeof e.kind === 'string')
      .filter((e) => !(e.kind === 'network' && s.ignoreStatic && isStaticUrl(e.url)))
      .map((e) => redactor.event(e));
    await ensureLoaded();
    addEvents(tabId, events, s);
    updateBadge(tabId, counts(tabId), s);
    return { ok: true };
  },

  async getStatus(msg) {
    const s = await settings();
    const tab = await chrome.tabs.get(msg.tabId);
    await ensureLoaded();
    const capturable = isCapturableUrl(tab.url);
    let connected = false;
    if (capturable) connected = !!(await safeSend(msg.tabId, { type: 'ping' }));
    return {
      url: tab.url,
      host: getHost(tab.url),
      capturable,
      connected,
      enabled: capturable && isCaptureEnabled(s, tab.url),
      paused: isPausedHost(s, tab.url),
      counts: counts(msg.tabId),
      uiMode: s.uiMode,
      screenshotMode: s.screenshotMode,
    };
  },

  async clearTab(msg) {
    await ensureLoaded();
    clearTab(msg.tabId);
    await safeSend(msg.tabId, { type: 'clearReplay' });
    updateBadge(msg.tabId, counts(msg.tabId), await settings());
    return { ok: true };
  },

  async togglePause(msg) {
    const s = await settings();
    const host = getHost(msg.url);
    if (!host) return { ok: false };
    const paused = s.pausedDomains.includes(host);
    await setSettings({ pausedDomains: paused ? s.pausedDomains.filter((d) => d !== host) : [...s.pausedDomains, host] });
    return { ok: true, paused: !paused };
  },

  prepareReport(msg) {
    return prepareReport(msg.tabId, msg.mode);
  },

  getReport(msg) {
    const entry = pendingReports.get(msg.id);
    return { report: entry ? entry.report : null };
  },

  discardReport(msg) {
    pendingReports.delete(msg.id);
    return { ok: true };
  },
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  const handler = msg && handlers[msg.type];
  if (!handler) return false;
  Promise.resolve()
    .then(() => handler(msg, sender))
    .then(sendResponse, (err) => sendResponse({ error: (err && err.message) || String(err) }));
  return true;
});

// ---------- tab lifecycle ----------

chrome.tabs.onRemoved.addListener(async (tabId) => {
  await ensureLoaded();
  clearTab(tabId);
});

chrome.tabs.onReplaced.addListener(async (addedTabId, removedTabId) => {
  await ensureLoaded();
  clearTab(removedTabId);
});

// Content scripts declared in the manifest only run on pages loaded after install,
// so inject them into tabs that are already open.
chrome.runtime.onInstalled.addListener(async () => {
  const openTabs = await chrome.tabs.query({ url: ['http://*/*', 'https://*/*'] });
  for (const tab of openTabs) {
    if (!isCapturableUrl(tab.url)) continue;
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content/inject.js'], world: 'MAIN' });
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['lib/rrweb-record.min.js', 'content/collector.js'] });
    } catch {
      // discarded or restricted tabs
    }
  }
});
