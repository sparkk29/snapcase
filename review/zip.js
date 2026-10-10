import { toHAR } from '../shared/har.js';
import { buildMarkdown, browserSummary } from '../shared/markdown.js';
import { buildTimeline } from '../shared/timeline.js';
import { problemsSummary, describeRequestSimple, describeRequestTech, describeConsole } from '../shared/describe.js';

const TEMPLATE_FILES = {
  template: 'report/report-template.html',
  css: 'report/report.css',
  js: 'report/report.js',
  playerJs: 'lib/rrweb-player.min.js',
  playerCss: 'lib/rrweb-player.css',
  logo: 'assets/logo.svg',
};

function pad(n) {
  return String(n).padStart(2, '0');
}

export function reportFileName(report) {
  const d = new Date(report.createdAt);
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  const host = (report.page.host || 'page').replace(/[^a-z0-9.-]/gi, '_');
  return `bug-report-${host}-${stamp}.zip`;
}

function base64Of(dataUrl) {
  return dataUrl.slice(dataUrl.indexOf(',') + 1);
}

function hasFullSnapshot(events) {
  return Array.isArray(events) && events.some((e) => e && e.type === 2);
}

async function loadTemplates() {
  const entries = await Promise.all(
    Object.entries(TEMPLATE_FILES).map(async ([key, path]) => [key, await (await fetch(chrome.runtime.getURL(path))).text()]),
  );
  return Object.fromEntries(entries);
}

function escapeScript(js) {
  return js.replace(/<\/script/gi, '<\\/script').replace(/<!--/g, '<\\!--');
}

function escapeJson(json) {
  return json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

export function buildViewData(report, form, annotatedDataUrl) {
  const { failed, errors } = problemsSummary(report);
  const replayEvents = report.replay && hasFullSnapshot(report.replay.events) ? report.replay.events : [];
  return {
    id: report.id,
    createdAt: report.createdAt,
    extensionVersion: report.extensionVersion,
    page: report.page,
    browser: browserSummary(report.environment),
    form,
    warnings: report.warnings,
    problems: {
      failed: failed.map((n) => ({ ref: n.id, simple: describeRequestSimple(n), tech: describeRequestTech(n) })),
      errors: errors.map((c) => ({ ref: c.id, text: describeConsole(c, 300) })),
    },
    screenshot: annotatedDataUrl,
    network: report.network,
    console: report.console,
    actions: report.actions,
    navigation: report.navigation,
    timeline: buildTimeline(report),
    environment: report.environment,
    replay: { seconds: report.replay ? report.replay.seconds : 0, events: replayEvents },
  };
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

export async function buildReportHtml(viewData) {
  const t = await loadTemplates();
  const values = {
    '/*__STYLES__*/': t.playerCss + '\n' + t.css,
    __REPORT_DATA__: escapeJson(JSON.stringify(viewData)),
    '/*__PLAYER_JS__*/': escapeScript(t.playerJs),
    '/*__REPORT_JS__*/': escapeScript(t.js),
    __REPORT_TITLE__: escapeHtml(viewData.form.title || viewData.page.title || 'Bug report'),
    __LOGO_SVG__: t.logo.replace(/<title>[^<]*<\/title>/, '').replace(/width="\d+" height="\d+"/, 'width="26" height="26" aria-hidden="true"'),
  };
  // Single pass, so placeholder-like text inside inserted page data is never substituted.
  return t.template.replace(/\/\*__STYLES__\*\/|__REPORT_DATA__|\/\*__PLAYER_JS__\*\/|\/\*__REPORT_JS__\*\/|__REPORT_TITLE__|__LOGO_SVG__/g, (m) => values[m]);
}

export async function buildZip(report, form, annotatedDataUrl) {
  const zip = new JSZip();
  const timeline = buildTimeline(report);
  const markdown = buildMarkdown(report, form);
  const viewData = buildViewData(report, form, annotatedDataUrl);
  const json = (v) => JSON.stringify(v, null, 2);
  const png = { base64: true, compression: 'STORE' };

  zip.file('report.html', await buildReportHtml(viewData));
  zip.file('summary.md', markdown);
  zip.file('screenshot.png', base64Of(annotatedDataUrl), png);
  zip.file('screenshot-original.png', base64Of(report.screenshots.visible), png);
  if (report.screenshots.fullPage) zip.file('screenshot-fullpage.png', base64Of(report.screenshots.fullPage), png);
  zip.file('network.json', json(report.network));
  zip.file('network.har', json(toHAR(report.network, { pageUrl: report.page.url, pageTitle: report.page.title, version: report.extensionVersion })));
  zip.file('console.json', json(report.console));
  zip.file('actions.json', json(report.actions));
  zip.file('navigation.json', json(report.navigation));
  zip.file('timeline.json', json(timeline));
  zip.file('environment.json', json(report.environment));
  if (viewData.replay.events.length) zip.file('replay.json', JSON.stringify(viewData.replay.events));

  const { failed, errors } = problemsSummary(report);
  zip.file(
    'report.json',
    json({
      id: report.id,
      createdAt: report.createdAt,
      extensionVersion: report.extensionVersion,
      page: report.page,
      screenshotMode: report.screenshotMode,
      title: form.title,
      whatDoing: form.whatDoing,
      whatWrong: form.whatWrong,
      notes: form.notes,
      steps: form.steps,
      counts: {
        requests: report.network.length,
        failedRequests: failed.length,
        consoleMessages: report.console.length,
        consoleErrors: errors.length,
        actions: report.actions.length,
        replayEvents: viewData.replay.events.length,
      },
      warnings: report.warnings,
    }),
  );

  return zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
}
