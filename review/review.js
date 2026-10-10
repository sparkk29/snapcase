import { initMode, currentMode, onModeChange } from '../shared/mode.js';
import { buildMarkdown } from '../shared/markdown.js';
import { buildTimeline } from '../shared/timeline.js';
import { buildSteps, problemsSummary } from '../shared/describe.js';
import { Annotator } from './annotate.js';
import { buildZip, reportFileName } from './zip.js';

const $ = (id) => document.getElementById(id);

let report = null;
let annotator = null;
let step = 0;
let downloaded = false;
let timelineFilter = 'all';
let timeline = [];
const byId = new Map();

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

function toast(message) {
  const t = el('div', { class: 'toast', role: 'status' }, message);
  document.body.append(t);
  setTimeout(() => t.remove(), 2600);
}

function plural(n, one, many = one + 's') {
  return `${n} ${n === 1 ? one : many}`;
}

// ---------- steps (Simple mode wizard) ----------

function goStep(i) {
  step = Math.max(0, Math.min(2, i));
  document.querySelectorAll('.step').forEach((s) => s.classList.toggle('active', Number(s.dataset.step) === step));
  document.querySelectorAll('.stepper li').forEach((li) => {
    const n = Number(li.dataset.goto);
    li.classList.toggle('active', n === step);
    li.classList.toggle('done', n < step);
    if (n === step) li.setAttribute('aria-current', 'step');
    else li.removeAttribute('aria-current');
  });
  if (currentMode() === 'simple') window.scrollTo({ top: 0, behavior: 'smooth' });
}

// ---------- form ----------

function getForm() {
  return {
    title: $('title').value.trim(),
    whatDoing: $('whatDoing').value.trim(),
    whatWrong: $('whatWrong').value.trim(),
    notes: $('notes').value.trim(),
    steps: $('steps')
      .value.split('\n')
      .map((s) => s.replace(/^\s*\d+[.)]\s*/, '').trim())
      .filter(Boolean),
  };
}

// ---------- annotation ----------

function syncToolbar() {
  $('undoBtn').disabled = !annotator.canUndo;
  $('redoBtn').disabled = !annotator.canRedo;
  $('clearShapesBtn').disabled = !annotator.canUndo;
}

function selectTool(tool) {
  annotator.setTool(tool);
  document.querySelectorAll('.tool[data-tool]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.tool === tool)));
}

function bindToolbar() {
  document.querySelectorAll('.tool[data-tool]').forEach((b) => b.addEventListener('click', () => selectTool(b.dataset.tool)));
  document.querySelectorAll('.swatch').forEach((s) =>
    s.addEventListener('click', () => {
      annotator.setColor(s.dataset.color);
      document.querySelectorAll('.swatch').forEach((x) => x.setAttribute('aria-checked', String(x === s)));
    }),
  );
  $('undoBtn').addEventListener('click', () => annotator.undo());
  $('redoBtn').addEventListener('click', () => annotator.redo());
  $('clearShapesBtn').addEventListener('click', () => annotator.clear());

  document.addEventListener('keydown', (e) => {
    const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement && document.activeElement.tagName);
    if (typing || !(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
    e.preventDefault();
    if (e.shiftKey) annotator.redo();
    else annotator.undo();
  });

  onModeChange((mode) => {
    if (mode === 'simple' && ['pen', 'text'].includes(annotator.tool)) selectTool('rect');
  });
}

// ---------- summaries ----------

function renderWarnings() {
  const box = $('warnings');
  box.replaceChildren(...report.warnings.map((w) => el('div', { class: 'notice warn' }, w)));
}

function renderProblemsNotice() {
  const { failed, errors, total } = problemsSummary(report);
  const notice = $('problemsNotice');
  if (!total) {
    notice.hidden = true;
    return;
  }
  const parts = [];
  if (failed.length) parts.push(plural(failed.length, 'page request') + ' that failed');
  if (errors.length) parts.push(plural(errors.length, 'error message'));
  notice.replaceChildren(
    el(
      'div',
      {},
      el('strong', {}, `We noticed ${plural(total, 'problem')} on this page`),
      el('div', {}, `(${parts.join(' and ')}). They're included in the report automatically, so you don't need to describe them.`),
    ),
  );
  notice.hidden = false;
}

function renderIncluded() {
  const { failed, errors } = problemsSummary(report);
  const steps = getForm().steps.length;
  const replay = report.replay && report.replay.events && report.replay.events.length;
  const simple = currentMode() === 'simple';
  const items = [
    report.screenshots.fullPage ? 'A screenshot of the whole page, with your markings' : 'A screenshot of the page, with your markings',
    'Your description' + (steps ? ` and ${plural(steps, 'step')}` : ''),
    simple
      ? 'Technical details for the developers (page activity and error messages)'
      : `${plural(report.network.length, 'network request')} (${failed.length} failed), ${plural(report.console.length, 'console message')} (${errors.length} errors), ${plural(report.actions.length, 'user action')}`,
  ];
  if (replay) items.push(simple ? 'A short replay of what happened on the page (typed text is hidden)' : `Session replay, last ${report.replay.seconds}+ seconds (${report.replay.events.length} events, inputs masked)`);
  if (!simple) items.push('Browser and device details, HAR file, and an offline report.html viewer');
  $('included').replaceChildren(...items.map((t) => el('li', {}, t)));
}

// ---------- technical panel ----------

function prettyBody(body) {
  if (body == null || body === '') return '(empty)';
  try {
    const t = body.trim();
    if (t.startsWith('{') || t.startsWith('[')) return JSON.stringify(JSON.parse(t), null, 2);
  } catch {
    // not JSON
  }
  return body;
}

function headerText(h) {
  const entries = Object.entries(h || {});
  return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join('\n') : '(none)';
}

function detailFor(item) {
  const src = byId.get(item.ref);
  if (!src) return el('div', {}, 'No details.');
  const block = (title, text) => [el('h4', {}, title), el('pre', {}, text)];
  if (item.kind === 'network') {
    return el(
      'div',
      {},
      block(
        'General',
        [
          `${src.method} ${src.url}`,
          `Status: ${src.status || '-'} ${src.statusText || ''}`.trim(),
          src.error ? `Error: ${src.error}` : null,
          `Started: ${src.startedAt}`,
          `Duration: ${src.durationMs} ms`,
          `Type: ${src.type}`,
        ]
          .filter(Boolean)
          .join('\n'),
      ),
      block('Request headers', headerText(src.requestHeaders)),
      src.requestBody != null ? block('Request body', prettyBody(src.requestBody)) : null,
      block('Response headers', headerText(src.responseHeaders)),
      block('Response body', prettyBody(src.responseBody)),
    );
  }
  if (item.kind === 'console') {
    return el('div', {}, block('Message', src.message), src.stack ? block('Stack', src.stack) : null);
  }
  if (item.kind === 'action') {
    return el('div', {}, block('Element', [src.selector && `Selector: ${src.selector}`, src.label && `Label: ${src.label}`, `Page: ${src.url}`].filter(Boolean).join('\n')));
  }
  return el('div', {}, block('Navigation', [`To: ${src.url}`, src.from && `From: ${src.from}`].filter(Boolean).join('\n')));
}

function kindPill(item) {
  if (item.kind === 'network') return el('span', { class: `pill ${item.problem ? 'bad' : ''}` }, 'Network');
  if (item.kind === 'console') return el('span', { class: `pill ${item.level === 'error' ? 'bad' : item.level === 'warn' ? 'warn' : ''}` }, item.level === 'warn' ? 'Warning' : 'Console');
  if (item.kind === 'action') return el('span', { class: 'pill good' }, 'Action');
  return el('span', { class: 'pill' }, 'Page');
}

function renderTimeline() {
  const items = timeline.filter((i) => {
    if (timelineFilter === 'all') return true;
    if (timelineFilter === 'problems') return i.problem;
    if (timelineFilter === 'console') return i.kind === 'console';
    if (timelineFilter === 'action') return i.kind === 'action' || i.kind === 'navigation';
    return i.kind === timelineFilter;
  });
  const box = $('timeline');
  if (!items.length) {
    box.replaceChildren(el('div', { class: 'empty' }, 'Nothing captured here.'));
    return;
  }
  const rows = items.slice(-500).map((item) => {
    const row = el('div', { class: `tl-row${item.problem ? ' problem' : ''}` });
    const time = new Date(item.ts).toLocaleTimeString([], { hour12: false }) + '.' + String(item.ts % 1000).padStart(3, '0');
    const main = el('button', { type: 'button', class: 'tl-main', 'aria-expanded': 'false' }, el('span', { class: 'tl-time' }, time), el('span', {}, kindPill(item)), el('span', { class: 'tl-label' }, item.label));
    main.addEventListener('click', () => {
      const open = row.querySelector('.tl-detail');
      if (open) {
        open.remove();
        main.setAttribute('aria-expanded', 'false');
      } else {
        row.append(el('div', { class: 'tl-detail' }, detailFor(item)));
        main.setAttribute('aria-expanded', 'true');
      }
    });
    row.append(main);
    return row;
  });
  box.replaceChildren(...rows);
  box.scrollTop = box.scrollHeight;
}

function renderTechPanel() {
  const { failed, errors } = problemsSummary(report);
  $('techCounts').replaceChildren(
    el('span', { class: 'pill' }, plural(report.network.length, 'request')),
    el('span', { class: `pill ${failed.length ? 'bad' : ''}` }, `${failed.length} failed`),
    el('span', { class: `pill ${errors.length ? 'bad' : ''}` }, plural(errors.length, 'error')),
    el('span', { class: 'pill' }, plural(report.actions.length, 'action')),
    el('span', { class: 'pill' }, report.replay.events.length ? 'Replay included' : 'No replay'),
  );
  document.querySelectorAll('#timelineFilters button').forEach((b) =>
    b.addEventListener('click', () => {
      timelineFilter = b.dataset.filter;
      document.querySelectorAll('#timelineFilters button').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
      renderTimeline();
    }),
  );
  renderTimeline();
}

// ---------- export ----------

async function download() {
  const btn = $('downloadBtn');
  $('saveError').hidden = true;
  btn.disabled = true;
  btn.textContent = 'Preparing the report…';
  try {
    const blob = await buildZip(report, getForm(), annotator.toDataURL());
    const url = URL.createObjectURL(blob);
    const filename = reportFileName(report);
    const downloadId = await chrome.downloads.download({ url, filename, conflictAction: 'uniquify', saveAs: false });
    setTimeout(() => URL.revokeObjectURL(url), 120000);
    downloaded = true;
    const showBtn = el('button', { type: 'button', class: 'btn' }, 'Show file');
    showBtn.addEventListener('click', () => chrome.downloads.show(downloadId));
    $('saveResult').replaceChildren(
      el('div', {}, el('strong', {}, 'Report saved.'), el('div', {}, `It's in your Downloads folder as ${filename}. Send this file to your team.`)),
      showBtn,
    );
    $('saveResult').hidden = false;
    btn.textContent = 'Download again';
  } catch (e) {
    $('saveError').textContent = `The report could not be saved: ${e.message}`;
    $('saveError').hidden = false;
    btn.textContent = 'Download report';
  } finally {
    btn.disabled = false;
  }
}

async function copySummary() {
  try {
    await navigator.clipboard.writeText(buildMarkdown(report, getForm()));
    toast('Summary copied. Paste it into an email, chat or ticket.');
  } catch (e) {
    toast(`Could not copy: ${e.message}`);
  }
}

// ---------- init ----------

async function init() {
  await initMode();
  const id = new URLSearchParams(location.search).get('id');
  let res = null;
  try {
    res = await chrome.runtime.sendMessage({ type: 'getReport', id });
  } catch {
    res = null;
  }
  report = res && res.report;
  $('loading').hidden = true;
  if (!report) {
    $('missing').hidden = false;
    return;
  }

  [...report.network, ...report.console, ...report.actions, ...report.navigation].forEach((e) => byId.set(e.id, e));
  timeline = buildTimeline(report);

  $('pageUrl').textContent = report.page.url;
  document.title = `Report a problem: ${report.page.title || report.page.host} · Snapcase`;
  $('app').hidden = false;

  annotator = new Annotator($('stage'), { onChange: syncToolbar });
  const primary = report.screenshots.fullPage || report.screenshots.visible;
  await annotator.load(primary);
  $('shotInfo').textContent = `${report.screenshots.fullPage ? 'Full-page' : 'Visible area'} screenshot, ${annotator.canvas.width}×${annotator.canvas.height}px. The original is also saved.`;
  bindToolbar();
  selectTool('rect');

  $('steps').value = buildSteps(report.actions, report.navigation).join('\n');
  $('steps').addEventListener('input', renderIncluded);

  renderWarnings();
  renderProblemsNotice();
  renderIncluded();
  renderTechPanel();
  onModeChange(renderIncluded);

  document.querySelectorAll('[data-next]').forEach((b) => b.addEventListener('click', () => goStep(step + 1)));
  document.querySelectorAll('[data-prev]').forEach((b) => b.addEventListener('click', () => goStep(step - 1)));
  document.querySelectorAll('.stepper li').forEach((li) => li.addEventListener('click', () => goStep(Number(li.dataset.goto))));
  $('downloadBtn').addEventListener('click', download);
  $('copyBtn').addEventListener('click', copySummary);

  window.addEventListener('beforeunload', (e) => {
    if (!downloaded) e.preventDefault();
  });

  goStep(0);
}

init();
