import { getSettings, setSettings } from './settings.js';

let current = 'simple';
const listeners = new Set();

function apply(mode) {
  current = mode === 'advanced' ? 'advanced' : 'simple';
  document.body.classList.toggle('mode-simple', current === 'simple');
  document.body.classList.toggle('mode-advanced', current === 'advanced');
  document.querySelectorAll('[data-mode-toggle] button').forEach((btn) => {
    btn.setAttribute('aria-pressed', String(btn.dataset.mode === current));
  });
  listeners.forEach((fn) => fn(current));
}

function renderToggle(container) {
  container.classList.add('mode-toggle');
  container.setAttribute('role', 'group');
  container.setAttribute('aria-label', 'Interface mode');
  container.innerHTML = '';
  for (const [mode, label, title] of [
    ['simple', 'Simple', 'Simple: just the essentials'],
    ['advanced', 'Advanced', 'Advanced: technical details and settings'],
  ]) {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.dataset.mode = mode;
    btn.textContent = label;
    btn.title = title;
    btn.addEventListener('click', () => {
      if (current === mode) return;
      apply(mode);
      setSettings({ uiMode: mode });
    });
    container.appendChild(btn);
  }
}

export async function initMode() {
  document.querySelectorAll('[data-mode-toggle]').forEach(renderToggle);
  const s = await getSettings();
  apply(s.uiMode);
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area === 'sync' && changes.uiMode && changes.uiMode.newValue !== current) apply(changes.uiMode.newValue);
  });
  return current;
}

export function currentMode() {
  return current;
}

export function onModeChange(fn) {
  listeners.add(fn);
}
