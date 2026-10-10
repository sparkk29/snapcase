export const DEFAULT_SETTINGS = {
  uiMode: 'simple',
  screenshotMode: 'visible',
  maxFullPageHeight: 15000,
  replayEnabled: true,
  replaySeconds: 30,
  badgeInSimpleMode: false,
  includeDomains: [],
  excludeDomains: [],
  pausedDomains: [],
  ignoreStatic: true,
  maxBodyKB: 100,
  maxRequests: 300,
  maxConsole: 500,
  maxActions: 200,
  consoleLevels: ['error', 'warn'],
  redact: {
    headers: true,
    jsonKeys: true,
    query: true,
    emails: true,
    tokens: true,
    cards: true,
    phones: false,
  },
  extraHeaders: [],
  extraKeys: [],
  customRules: [],
  includeStorageValues: false,
};

export async function getSettings() {
  const stored = await chrome.storage.sync.get(null);
  return {
    ...DEFAULT_SETTINGS,
    ...stored,
    redact: { ...DEFAULT_SETTINGS.redact, ...(stored.redact || {}) },
  };
}

export async function setSettings(partial) {
  await chrome.storage.sync.set(partial);
}

export async function resetSettings() {
  await chrome.storage.sync.clear();
}

function hostMatches(host, pattern) {
  const p = String(pattern).trim().toLowerCase();
  if (!p) return false;
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return host === base || host.endsWith('.' + base);
  }
  return host === p || host.endsWith('.' + p);
}

export function getHost(url) {
  try {
    const u = new URL(url);
    return u.protocol === 'file:' ? 'file' : u.hostname.toLowerCase();
  } catch {
    return '';
  }
}

export function isCaptureEnabled(settings, url) {
  const host = getHost(url);
  if (!host) return false;
  if (settings.pausedDomains.some((p) => hostMatches(host, p))) return false;
  if (settings.excludeDomains.some((p) => hostMatches(host, p))) return false;
  if (settings.includeDomains.length && !settings.includeDomains.some((p) => hostMatches(host, p))) return false;
  return true;
}

export function isPausedHost(settings, url) {
  const host = getHost(url);
  return !!host && settings.pausedDomains.some((p) => hostMatches(host, p));
}

export function isCapturableUrl(url) {
  if (!url) return false;
  if (!/^(https?|file):/i.test(url)) return false;
  if (/^https:\/\/(chrome\.google\.com\/webstore|chromewebstore\.google\.com)/i.test(url)) return false;
  return true;
}
