import { getSettings, setSettings, resetSettings, DEFAULT_SETTINGS } from '../shared/settings.js';
import { initMode } from '../shared/mode.js';

const $ = (id) => document.getElementById(id);
const LIST_FIELDS = ['includeDomains', 'excludeDomains', 'pausedDomains', 'extraHeaders', 'extraKeys'];
const NUMBER_FIELDS = ['maxBodyKB', 'maxRequests', 'maxConsole', 'maxActions', 'maxFullPageHeight'];
const CHECK_FIELDS = ['replayEnabled', 'badgeInSimpleMode', 'ignoreStatic', 'includeStorageValues'];

let savedTimer = null;

function lines(text) {
  return text
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);
}

function parseRules(text) {
  const rules = [];
  const errors = [];
  lines(text).forEach((line, i) => {
    const idx = line.indexOf(':');
    const label = idx > 0 ? line.slice(0, idx).trim() : 'CUSTOM';
    const pattern = idx > 0 ? line.slice(idx + 1).trim() : line;
    try {
      new RegExp(pattern, 'gi');
      rules.push({ label, pattern, flags: 'gi' });
    } catch (e) {
      errors.push(`Line ${i + 1}: ${e.message}`);
    }
  });
  return { rules, errors };
}

function showSaved() {
  $('savedIndicator').textContent = 'Saved';
  clearTimeout(savedTimer);
  savedTimer = setTimeout(() => ($('savedIndicator').textContent = ''), 1500);
}

function fill(s) {
  document.querySelectorAll('input[name=screenshotMode]').forEach((r) => (r.checked = r.value === s.screenshotMode));
  $('replaySeconds').value = String(s.replaySeconds);
  CHECK_FIELDS.forEach((f) => ($(f).checked = !!s[f]));
  LIST_FIELDS.forEach((f) => ($(f).value = (s[f] || []).join('\n')));
  NUMBER_FIELDS.forEach((f) => ($(f).value = s[f]));
  document.querySelectorAll('input[name=consoleLevels]').forEach((c) => (c.checked = s.consoleLevels.includes(c.value)));
  document.querySelectorAll('[data-redact]').forEach((c) => (c.checked = !!s.redact[c.dataset.redact]));
  $('customRules').value = (s.customRules || []).map((r) => `${r.label}: ${r.pattern}`).join('\n');
}

function collect() {
  const out = {
    screenshotMode: document.querySelector('input[name=screenshotMode]:checked')?.value || 'visible',
    replaySeconds: Number($('replaySeconds').value),
    consoleLevels: [...document.querySelectorAll('input[name=consoleLevels]:checked')].map((c) => c.value),
    redact: Object.fromEntries([...document.querySelectorAll('[data-redact]')].map((c) => [c.dataset.redact, c.checked])),
  };
  CHECK_FIELDS.forEach((f) => (out[f] = $(f).checked));
  LIST_FIELDS.forEach((f) => (out[f] = lines($(f).value).map((l) => (f.endsWith('Domains') ? l.toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '') : l))));
  NUMBER_FIELDS.forEach((f) => {
    const input = $(f);
    const n = Number(input.value);
    const min = Number(input.min);
    const max = Number(input.max);
    out[f] = Number.isFinite(n) && input.value !== '' ? Math.min(max, Math.max(min, Math.round(n))) : DEFAULT_SETTINGS[f];
  });
  const { rules, errors } = parseRules($('customRules').value);
  $('customRulesError').textContent = errors.join(' ');
  out.customRules = rules;
  return out;
}

async function save() {
  await setSettings(collect());
  showSaved();
}

async function init() {
  await initMode();
  fill(await getSettings());

  document.querySelector('main').addEventListener('change', (e) => {
    if (e.target.closest('[data-mode-toggle]')) return;
    save();
  });

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.pausedDomains && document.activeElement !== $('pausedDomains')) {
      $('pausedDomains').value = (changes.pausedDomains.newValue || []).join('\n');
    }
  });

  $('resetBtn').addEventListener('click', async () => {
    if (!confirm('Reset all settings to their defaults?')) return;
    await resetSettings();
    fill(await getSettings());
    showSaved();
  });
}

init();
