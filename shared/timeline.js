import { describeAction, describeNavigation, describeConsole, describeRequestTech } from './describe.js';

export function buildTimeline(report) {
  const items = [];
  for (const n of report.network) {
    items.push({ ts: n.ts, kind: 'network', problem: !!n.failed, label: describeRequestTech(n), ref: n.id });
  }
  for (const c of report.console) {
    items.push({ ts: c.ts, kind: 'console', level: c.level, problem: c.level === 'error', label: describeConsole(c, 300), ref: c.id });
  }
  for (const a of report.actions) {
    items.push({ ts: a.ts, kind: 'action', problem: false, label: describeAction(a), ref: a.id });
  }
  for (const v of report.navigation) {
    items.push({ ts: v.ts, kind: 'navigation', problem: false, label: describeNavigation(v), ref: v.id });
  }
  // Within the same millisecond, the user's action comes before the requests and errors it caused.
  const order = { navigation: 0, action: 1, network: 2, console: 3 };
  items.sort((a, b) => a.ts - b.ts || order[a.kind] - order[b.kind]);
  return items.map((i) => ({ ...i, time: new Date(i.ts).toISOString() }));
}
