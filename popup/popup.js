import { initMode, currentMode } from '../shared/mode.js';

const $ = (id) => document.getElementById(id);

let tab = null;
let status = null;
let busy = false;

function send(msg) {
  return chrome.runtime.sendMessage(msg).then((res) => {
    if (res && res.error) throw new Error(res.error);
    return res;
  });
}

function render() {
  if (!status) return;
  $('unavailable').hidden = status.capturable;
  $('ready').hidden = !status.capturable;
  if (!status.capturable) return;

  const paused = status.paused || !status.enabled;
  $('statusDot').classList.toggle('paused', paused);
  $('statusText').textContent = status.paused
    ? 'Paused on this site. Nothing is being recorded.'
    : !status.enabled
      ? 'Recording is turned off for this site in Settings.'
      : 'Ready. This page is being recorded.';
  $('pauseBtn').textContent = status.paused ? 'Resume on this site' : 'Pause on this site';
  $('reloadHint').hidden = status.connected || paused;

  const c = status.counts;
  $('cRequests').textContent = c.requests;
  $('cFailed').textContent = c.failed;
  $('cErrors').textContent = c.errors;
  $('cActions').textContent = c.actions;
  $('cFailed').parentElement.classList.toggle('bad', c.failed > 0);
  $('cErrors').parentElement.classList.toggle('bad', c.errors > 0);
}

async function refresh() {
  try {
    status = await send({ type: 'getStatus', tabId: tab.id });
    render();
  } catch (e) {
    showError(e.message);
  }
}

function showError(message) {
  $('error').textContent = message;
  $('error').hidden = !message;
}

function setBusy(on, text) {
  busy = on;
  $('reportBtn').disabled = on;
  $('progress').hidden = !on;
  if (text) $('progressText').textContent = text;
}

async function report() {
  if (busy) return;
  showError('');
  const mode = currentMode() === 'advanced' ? document.querySelector('input[name=shot]:checked').value : status.screenshotMode;
  setBusy(true, mode === 'fullpage' ? "Capturing the whole page. Please don't scroll…" : 'Taking a screenshot…');
  try {
    await send({ type: 'prepareReport', tabId: tab.id, mode });
    window.close();
  } catch (e) {
    setBusy(false);
    showError(e.message || 'Something went wrong while creating the report.');
  }
}

async function init() {
  await initMode();
  [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  await refresh();
  if (status) document.querySelector(`input[name=shot][value="${status.screenshotMode}"]`).checked = true;

  $('reportBtn').addEventListener('click', report);
  $('clearBtn').addEventListener('click', async () => {
    await send({ type: 'clearTab', tabId: tab.id });
    refresh();
  });
  $('pauseBtn').addEventListener('click', async () => {
    await send({ type: 'togglePause', url: tab.url });
    setTimeout(refresh, 100);
  });
  $('optionsLink').addEventListener('click', (e) => {
    e.preventDefault();
    chrome.runtime.openOptionsPage();
  });

  setInterval(() => {
    if (!busy) refresh();
  }, 1500);
}

init();
