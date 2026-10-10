export function shortUrl(url, max = 70) {
  try {
    const u = new URL(url);
    let s = u.pathname + u.search;
    if (s.length > max) s = s.slice(0, max - 1) + '…';
    return s || '/';
  } catch {
    return String(url || '').slice(0, max);
  }
}

function quote(label) {
  return label ? `"${label}"` : '';
}

function elementWord(a) {
  if (a.inputType === 'checkbox') return 'checkbox';
  if (a.inputType === 'radio') return 'option';
  if (a.tag === 'a' || a.role === 'link') return 'link';
  if (a.tag === 'button' || a.role === 'button' || ['submit', 'button', 'reset'].includes(a.inputType)) return 'button';
  if (a.role === 'tab') return 'tab';
  if (a.role === 'menuitem') return 'menu item';
  if (a.tag === 'select') return 'dropdown';
  if (a.tag === 'input' || a.tag === 'textarea') return 'field';
  return '';
}

export function describeAction(a) {
  const label = a.label;
  const word = elementWord(a);
  switch (a.action) {
    case 'click':
      if (a.inputType === 'checkbox') {
        const verb = a.checked ? 'Ticked' : 'Unticked';
        return label ? `${verb} the ${quote(label)} checkbox` : `${verb} a checkbox`;
      }
      if (a.inputType === 'radio') return label ? `Chose the ${quote(label)} option` : 'Chose an option';
      if (label && word) return `Clicked the ${quote(label)} ${word}`;
      if (label) return `Clicked on ${quote(label)}`;
      if (word) return `Clicked a ${word}`;
      return 'Clicked on the page';
    case 'focus':
      return label ? `Clicked into the ${quote(label)} field` : 'Clicked into a field';
    case 'input':
      if (a.inputType === 'password') return label ? `Typed a password into ${quote(label)}` : 'Typed a password';
      return label ? `Typed in the ${quote(label)} field` : 'Typed some text';
    case 'select':
      return `Selected ${quote(a.value) || 'an option'}${label ? ` in ${quote(label)}` : ''}`;
    case 'file':
      return `Chose ${a.fileCount === 1 ? 'a file' : `${a.fileCount} files`}${label ? ` for ${quote(label)}` : ''}`;
    case 'submit':
      return label ? `Submitted the ${quote(label)} form` : 'Submitted a form';
    case 'key':
      return `Pressed ${a.key}${label && a.tag !== 'body' ? ` in ${quote(label)}` : ''}`;
    default:
      return label ? `Interacted with ${quote(label)}` : 'Interacted with the page';
  }
}

export function describeNavigation(n) {
  if (n.navType === 'load') return `Opened the page ${shortUrl(n.url)}`;
  return `Went to ${shortUrl(n.url)}`;
}

export function describeRequestSimple(n) {
  const where = shortUrl(n.url, 50);
  if (n.error && !n.status) return `The page could not reach the server (${where})`;
  if (n.status >= 500) return `The server had a problem (error ${n.status}) while loading ${where}`;
  if (n.status === 401 || n.status === 403) return `Access was denied (error ${n.status}) for ${where}`;
  if (n.status === 404) return `Something was not found (error 404): ${where}`;
  return `A request failed (error ${n.status}): ${where}`;
}

export function describeRequestTech(n) {
  const status = n.status ? `${n.status}${n.statusText ? ' ' + n.statusText : ''}` : n.error || 'failed';
  return `${n.method} ${shortUrl(n.url, 90)} → ${status} (${n.durationMs} ms)`;
}

export function describeConsole(c, max = 160) {
  const msg = String(c.message || '').replace(/\s+/g, ' ').trim();
  const text = msg.length > max ? msg.slice(0, max - 1) + '…' : msg;
  const prefix = c.level === 'error' ? 'Error' : c.level === 'warn' ? 'Warning' : c.level.charAt(0).toUpperCase() + c.level.slice(1);
  return `${prefix}: ${text}`;
}

export function buildSteps(actions, navigation, limit = 15) {
  const items = [
    ...actions.map((a) => ({ ts: a.ts, text: describeAction(a), key: `${a.action}|${a.selector}`, a })),
    ...navigation.map((n) => ({ ts: n.ts, text: describeNavigation(n), key: `nav|${n.url}`, order: -1 })),
  ].sort((x, y) => x.ts - y.ts || (x.order || 0) - (y.order || 0));

  const steps = [];
  for (const item of items) {
    const prev = steps[steps.length - 1];
    if (prev && prev.key === item.key) continue;
    if (prev && prev.text === item.text) continue;
    // A form submit right after clicking its submit button is the same step.
    if (item.a && item.a.action === 'submit' && prev && prev.a && prev.a.action === 'click' && elementWord(prev.a) === 'button' && item.ts - prev.ts < 1500) continue;
    steps.push(item);
  }
  return steps.slice(-limit).map((s) => s.text);
}

export function problemsSummary(report) {
  const failed = report.network.filter((n) => n.failed);
  const errors = report.console.filter((c) => c.level === 'error');
  return { failed, errors, total: failed.length + errors.length };
}
