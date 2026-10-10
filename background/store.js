const STORAGE_KEY = 'tabData';
const PERSIST_DELAY_MS = 1500;
const MAX_NAVIGATION = 100;
const LIGHT_BODY_CHARS = 2000;

const tabs = new Map();
let loadPromise = null;
let persistTimer = null;

function emptyTab() {
  return { network: [], console: [], actions: [], navigation: [] };
}

export function ensureLoaded() {
  if (!loadPromise) {
    loadPromise = chrome.storage.session
      .get(STORAGE_KEY)
      .then((res) => {
        const saved = res[STORAGE_KEY] || {};
        for (const [id, data] of Object.entries(saved)) {
          if (!tabs.has(Number(id))) tabs.set(Number(id), { ...emptyTab(), ...data });
        }
      })
      .catch(() => {});
  }
  return loadPromise;
}

function getTab(tabId) {
  let t = tabs.get(tabId);
  if (!t) {
    t = emptyTab();
    tabs.set(tabId, t);
  }
  return t;
}

function pushCapped(list, item, max) {
  list.push(item);
  if (list.length > max) list.splice(0, list.length - max);
}

export function addEvents(tabId, events, limits) {
  const t = getTab(tabId);
  for (const e of events) {
    if (e.kind === 'network') pushCapped(t.network, e, limits.maxRequests);
    else if (e.kind === 'console') pushCapped(t.console, e, limits.maxConsole);
    else if (e.kind === 'action') pushCapped(t.actions, e, limits.maxActions);
    else if (e.kind === 'navigation') pushCapped(t.navigation, e, MAX_NAVIGATION);
  }
  schedulePersist();
}

export function clearTab(tabId) {
  tabs.delete(tabId);
  schedulePersist();
}

export function snapshot(tabId) {
  const t = tabs.get(tabId) || emptyTab();
  const byTs = (a, b) => a.ts - b.ts;
  return {
    network: [...t.network].sort(byTs),
    console: [...t.console].sort(byTs),
    actions: [...t.actions].sort(byTs),
    navigation: [...t.navigation].sort(byTs),
  };
}

export function counts(tabId) {
  const t = tabs.get(tabId) || emptyTab();
  return {
    requests: t.network.length,
    failed: t.network.filter((n) => n.failed).length,
    errors: t.console.filter((c) => c.level === 'error').length,
    warnings: t.console.filter((c) => c.level === 'warn').length,
    actions: t.actions.length,
  };
}

export function tabIds() {
  return [...tabs.keys()];
}

function lighten(data) {
  const cut = (s) => (typeof s === 'string' && s.length > LIGHT_BODY_CHARS ? s.slice(0, LIGHT_BODY_CHARS) + '\n…[truncated to save memory]' : s);
  const out = {};
  for (const [id, t] of Object.entries(data)) {
    out[id] = { ...t, network: t.network.map((n) => ({ ...n, requestBody: cut(n.requestBody), responseBody: cut(n.responseBody) })) };
  }
  return out;
}

function schedulePersist() {
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    const data = Object.fromEntries(tabs);
    try {
      await chrome.storage.session.set({ [STORAGE_KEY]: data });
    } catch {
      try {
        await chrome.storage.session.set({ [STORAGE_KEY]: lighten(data) });
      } catch {
        // storage full: in-memory data is still used while the worker is alive
      }
    }
  }, PERSIST_DELAY_MS);
}
