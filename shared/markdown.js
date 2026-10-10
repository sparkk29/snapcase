import { describeRequestTech, describeConsole, problemsSummary } from './describe.js';

export function browserSummary(env) {
  if (!env) return 'Unknown';
  const ua = env.userAgentData;
  let browser = '';
  if (ua && ua.brands) {
    browser = ua.brands.find((b) => /chrome|edge|opera|brave/i.test(b) && !/chromium/i.test(b)) || ua.brands.find((b) => !/not.?a.?brand/i.test(b)) || '';
  }
  if (!browser) {
    const m = /(Edg|OPR|Chrome)\/([\d.]+)/.exec(env.userAgent || '');
    browser = m ? `${m[1] === 'Edg' ? 'Edge' : m[1] === 'OPR' ? 'Opera' : 'Chrome'} ${m[2]}` : 'Unknown browser';
  }
  const os = ua && ua.platform ? `${ua.platform}${ua.platformVersion ? ' ' + ua.platformVersion : ''}` : '';
  const vp = env.viewport ? `${env.viewport.width}×${env.viewport.height}` : '';
  const dpr = env.devicePixelRatio && env.devicePixelRatio !== 1 ? ` @${env.devicePixelRatio}x` : '';
  return [browser, os && `on ${os}`, vp && `· window ${vp}${dpr}`].filter(Boolean).join(' ');
}

function section(title, body) {
  return body && String(body).trim() ? `### ${title}\n${String(body).trim()}\n` : '';
}

export function buildMarkdown(report, form) {
  const { failed, errors } = problemsSummary(report);
  const title = form.title || report.page.title || 'Bug report';
  const lines = [];
  lines.push(`## Bug report: ${title}`);
  lines.push('');
  lines.push(`**Page:** ${report.page.url}  `);
  lines.push(`**Reported:** ${new Date(report.createdAt).toLocaleString()}  `);
  lines.push(`**Browser:** ${browserSummary(report.environment)}`);
  lines.push('');
  lines.push(section('What I was trying to do', form.whatDoing));
  lines.push(section('What went wrong', form.whatWrong));
  lines.push(section('Notes', form.notes));
  if (form.steps && form.steps.length) {
    lines.push(section('Steps to reproduce', form.steps.map((s, i) => `${i + 1}. ${s}`).join('\n')));
  }
  if (failed.length || errors.length) {
    const parts = [];
    if (failed.length) {
      parts.push(`**Failed requests (${failed.length})**`);
      failed.slice(-10).forEach((n) => parts.push(`- \`${describeRequestTech(n)}\` at ${new Date(n.ts).toLocaleTimeString()}`));
    }
    if (errors.length) {
      if (parts.length) parts.push('');
      parts.push(`**Error messages (${errors.length})**`);
      errors.slice(-10).forEach((c) => parts.push(`- ${describeConsole(c, 200).replace(/`/g, "'")}`));
    }
    lines.push(section('Problems detected', parts.join('\n')));
  }
  const count = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
  lines.push(
    `_Captured ${count(report.network.length, 'network request')}, ${count(report.console.length, 'console message')} and ${count(report.actions.length, 'user action')}. Full details, including the session replay, are in the attached zip (open report.html)._`,
  );
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}
