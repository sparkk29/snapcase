(function () {
  'use strict';

  var data = JSON.parse(document.getElementById('report-data').textContent);
  var root = document.getElementById('root');
  var tabsNav = document.getElementById('tabs');

  function el(tag, attrs) {
    var node = document.createElement(tag);
    attrs = attrs || {};
    Object.keys(attrs).forEach(function (k) {
      var v = attrs[k];
      if (v == null || v === false) return;
      if (k === 'class') node.className = v;
      else if (k.indexOf('on') === 0) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? '' : v);
    });
    for (var i = 2; i < arguments.length; i++) append(node, arguments[i]);
    return node;
  }

  function append(node, child) {
    if (child == null || child === false) return;
    if (Array.isArray(child)) child.forEach(function (c) { append(node, c); });
    else node.appendChild(child instanceof Node ? child : document.createTextNode(String(child)));
  }

  function plural(n, one, many) {
    return n + ' ' + (n === 1 ? one : many || one + 's');
  }

  function fmtTime(ts) {
    var d = new Date(ts);
    return d.toLocaleTimeString([], { hour12: false }) + '.' + String(d.getMilliseconds()).padStart(3, '0');
  }

  function prettyBody(body) {
    if (body == null || body === '') return '(empty)';
    try {
      var t = String(body).trim();
      if (t[0] === '{' || t[0] === '[') return JSON.stringify(JSON.parse(t), null, 2);
    } catch (e) {
      // not JSON
    }
    return String(body);
  }

  function headerText(h) {
    var keys = Object.keys(h || {});
    return keys.length ? keys.map(function (k) { return k + ': ' + h[k]; }).join('\n') : '(none)';
  }

  function copyText(text, button) {
    function done() {
      var old = button.textContent;
      button.textContent = 'Copied';
      setTimeout(function () { button.textContent = old; }, 1500);
    }
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else fallback();
    function fallback() {
      var ta = el('textarea', {}, text);
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      ta.remove();
      done();
    }
  }

  function shellQuote(s) {
    return "'" + String(s).replace(/'/g, "'\\''") + "'";
  }

  function toCurl(n) {
    var parts = ['curl ' + shellQuote(n.url)];
    if (n.method !== 'GET') parts.push('-X ' + n.method);
    Object.keys(n.requestHeaders || {}).forEach(function (k) {
      parts.push('-H ' + shellQuote(k + ': ' + n.requestHeaders[k]));
    });
    if (n.requestBody != null && !/^\[.*not captured\]$/.test(n.requestBody)) parts.push('--data-raw ' + shellQuote(n.requestBody));
    return parts.join(' \\\n  ');
  }

  var byId = {};
  data.network.concat(data.console, data.actions, data.navigation).forEach(function (e) { byId[e.id] = e; });

  // ---------- detail blocks ----------

  function block(title, text) {
    return [el('h4', {}, title), el('pre', {}, text)];
  }

  function networkDetail(n) {
    var curlBtn = el('button', { type: 'button', class: 'mini' }, 'Copy as cURL');
    curlBtn.addEventListener('click', function () { copyText(toCurl(n), curlBtn); });
    var bodyBtn = el('button', { type: 'button', class: 'mini' }, 'Copy response');
    bodyBtn.addEventListener('click', function () { copyText(n.responseBody || '', bodyBtn); });
    return el(
      'div',
      { class: 'detail' },
      el('div', { class: 'detail-actions' }, curlBtn, bodyBtn),
      block(
        'General',
        [
          n.method + ' ' + n.url,
          'Status: ' + (n.status || '-') + ' ' + (n.statusText || ''),
          n.error ? 'Error: ' + n.error : null,
          'Started: ' + n.startedAt,
          'Finished: ' + n.endedAt,
          'Duration: ' + n.durationMs + ' ms',
          'Type: ' + n.type,
        ].filter(Boolean).join('\n'),
      ),
      block('Request headers', headerText(n.requestHeaders)),
      n.requestBody != null ? block('Request body', prettyBody(n.requestBody)) : null,
      block('Response headers', headerText(n.responseHeaders)),
      block('Response body', prettyBody(n.responseBody)),
    );
  }

  function consoleDetail(c) {
    return el('div', { class: 'detail' }, block('Message', c.message), c.stack ? block('Stack trace', c.stack) : null);
  }

  function itemDetail(item) {
    var src = byId[item.ref];
    if (!src) return el('div', { class: 'detail' }, 'No details.');
    if (item.kind === 'network') return networkDetail(src);
    if (item.kind === 'console') return consoleDetail(src);
    if (item.kind === 'action') {
      return el('div', { class: 'detail' }, block('Element', [src.selector && 'Selector: ' + src.selector, src.label && 'Label: ' + src.label, 'Page: ' + src.url].filter(Boolean).join('\n')));
    }
    return el('div', { class: 'detail' }, block('Navigation', ['To: ' + src.url, src.from ? 'From: ' + src.from : null].filter(Boolean).join('\n')));
  }

  function toggleRow(row, makeDetail) {
    var open = row.querySelector(':scope > .detail-wrap');
    if (open) open.remove();
    else row.appendChild(el('div', { class: 'detail-wrap' }, makeDetail()));
  }

  // ---------- views ----------

  function chips(options, current, onPick) {
    var wrap = el('div', { class: 'chips', role: 'group' });
    options.forEach(function (o) {
      var b = el('button', { type: 'button', 'aria-pressed': String(o[0] === current) }, o[1]);
      b.addEventListener('click', function () {
        wrap.querySelectorAll('button').forEach(function (x) { x.setAttribute('aria-pressed', String(x === b)); });
        onPick(o[0]);
      });
      wrap.appendChild(b);
    });
    return wrap;
  }

  function envRows(env) {
    var ua = env.userAgentData || {};
    var rows = [
      ['Browser', data.browser],
      ['Operating system', ua.platform ? ua.platform + (ua.platformVersion ? ' ' + ua.platformVersion : '') : null],
      ['Language', env.language],
      ['Time zone', env.timezone],
      ['Screen', env.screen ? env.screen.width + ' × ' + env.screen.height : null],
      ['Browser window', env.viewport ? env.viewport.width + ' × ' + env.viewport.height : null],
      ['Pixel ratio', env.devicePixelRatio],
      ['Color scheme', env.colorScheme],
      ['Connection', env.connection ? [env.connection.effectiveType, env.connection.downlink && env.connection.downlink + ' Mbps', env.connection.rtt != null && env.connection.rtt + ' ms RTT'].filter(Boolean).join(', ') : null],
      ['Online', env.online == null ? null : env.online ? 'Yes' : 'No'],
      ['Device memory', env.deviceMemoryGB ? env.deviceMemoryGB + ' GB' : null],
      ['CPU cores', env.hardwareConcurrency],
      ['Page load time', env.pageLoadMs ? env.pageLoadMs + ' ms' : null],
      ['Cookies', env.cookieNames ? plural(env.cookieNames.length, 'cookie') : null],
      ['Local storage keys', env.localStorage ? Object.keys(env.localStorage).length : null],
      ['Extension version', env.extensionVersion],
    ];
    return rows.filter(function (r) { return r[1] != null && r[1] !== ''; });
  }

  function renderOverview() {
    var f = data.form || {};
    var title = f.title || data.page.title || 'Bug report';
    var problems = data.problems.failed.length + data.problems.errors.length;
    var img = el('img', { src: data.screenshot, alt: 'Screenshot of the page', class: 'shot' });
    img.addEventListener('click', function () { img.classList.toggle('zoomed'); });

    var steps = (f.steps || []).length ? el('ol', { class: 'steps' }, f.steps.map(function (s) { return el('li', {}, s); })) : null;

    var section = function (heading, text) {
      return text ? el('section', { class: 'block' }, el('h3', {}, heading), el('p', { class: 'prewrap' }, text)) : null;
    };

    var problemsBox = null;
    if (problems) {
      problemsBox = el(
        'section',
        { class: 'problems' },
        el('h3', {}, 'Problems detected (' + problems + ')'),
        el(
          'ul',
          {},
          data.problems.failed.map(function (p) {
            return el('li', {}, el('div', {}, p.simple), el('code', {}, p.tech));
          }),
          data.problems.errors.map(function (p) {
            return el('li', {}, el('code', {}, p.text));
          }),
        ),
      );
    }

    var env = data.environment || {};
    return el(
      'div',
      { class: 'overview' },
      el('h1', {}, title),
      el(
        'div',
        { class: 'meta' },
        el('div', {}, el('b', {}, 'Page: '), el('a', { href: data.page.url, target: '_blank', rel: 'noopener noreferrer' }, data.page.url)),
        el('div', {}, el('b', {}, 'Reported: '), new Date(data.createdAt).toLocaleString()),
        el('div', {}, el('b', {}, 'Browser: '), data.browser),
      ),
      (data.warnings || []).map(function (w) { return el('div', { class: 'warn' }, w); }),
      problemsBox,
      el(
        'div',
        { class: 'grid' },
        el('div', { class: 'shot-wrap' }, img, el('div', { class: 'caption' }, 'Click the screenshot to zoom.')),
        el(
          'div',
          {},
          section('What they were trying to do', f.whatDoing),
          section('What went wrong', f.whatWrong),
          section('Notes', f.notes),
          steps ? el('section', { class: 'block' }, el('h3', {}, 'Steps to reproduce'), steps) : null,
          !f.whatDoing && !f.whatWrong && !f.notes && !steps ? el('p', { class: 'muted' }, 'No description was provided.') : null,
        ),
      ),
      el(
        'section',
        { class: 'block' },
        el('h3', {}, 'Environment'),
        el(
          'table',
          { class: 'kv' },
          envRows(env).map(function (r) { return el('tr', {}, el('th', {}, r[0]), el('td', {}, String(r[1]))); }),
        ),
        el('details', {}, el('summary', {}, 'All environment data'), el('pre', {}, JSON.stringify(env, null, 2))),
      ),
    );
  }

  function renderTimeline() {
    var filter = 'all';
    var list = el('div', { class: 'list' });
    var start = data.timeline.length ? data.timeline[0].ts : 0;
    function draw() {
      list.replaceChildren();
      var items = data.timeline.filter(function (i) {
        if (filter === 'all') return true;
        if (filter === 'problems') return i.problem;
        if (filter === 'action') return i.kind === 'action' || i.kind === 'navigation';
        return i.kind === filter;
      });
      if (!items.length) list.appendChild(el('div', { class: 'empty' }, 'Nothing here.'));
      items.forEach(function (item) {
        var row = el('div', { class: 'row' + (item.problem ? ' problem' : '') });
        var kind = item.kind === 'navigation' ? 'Page' : item.kind === 'console' ? (item.level === 'warn' ? 'Warning' : item.level === 'error' ? 'Error' : 'Console') : item.kind === 'action' ? 'Action' : 'Network';
        var head = el(
          'button',
          { type: 'button', class: 'row-head' },
          el('span', { class: 'time' }, fmtTime(item.ts)),
          el('span', { class: 'rel' }, '+' + ((item.ts - start) / 1000).toFixed(1) + 's'),
          el('span', { class: 'kind kind-' + item.kind + (item.problem ? ' bad' : '') }, kind),
          el('span', { class: 'label' }, item.label),
        );
        head.addEventListener('click', function () { toggleRow(row, function () { return itemDetail(item); }); });
        row.appendChild(head);
        list.appendChild(row);
      });
    }
    draw();
    return el(
      'div',
      {},
      el('div', { class: 'toolbar' }, chips([['all', 'All'], ['problems', 'Problems only'], ['network', 'Network'], ['console', 'Console'], ['action', 'User actions']], filter, function (v) { filter = v; draw(); })),
      list,
    );
  }

  function renderNetwork() {
    var search = el('input', { type: 'search', placeholder: 'Filter by URL, method or status…', 'aria-label': 'Filter requests' });
    var statusSel = el(
      'select',
      { 'aria-label': 'Status filter' },
      [['all', 'All statuses'], ['failed', 'Failed only'], ['2', '2xx'], ['3', '3xx'], ['4', '4xx'], ['5', '5xx']].map(function (o) { return el('option', { value: o[0] }, o[1]); }),
    );
    var count = el('span', { class: 'muted' });
    var tbody = el('tbody');
    function draw() {
      var q = search.value.trim().toLowerCase();
      var st = statusSel.value;
      var rows = data.network.filter(function (n) {
        if (st === 'failed' && !n.failed) return false;
        if (/^\d$/.test(st) && String(n.status).charAt(0) !== st) return false;
        if (q && (n.method + ' ' + n.url + ' ' + n.status).toLowerCase().indexOf(q) < 0) return false;
        return true;
      });
      count.textContent = rows.length + ' of ' + data.network.length;
      tbody.replaceChildren();
      rows.forEach(function (n) {
        var tr = el(
          'tr',
          { class: 'clickable' + (n.failed ? ' problem' : ''), tabindex: '0' },
          el('td', { class: 'mono' }, fmtTime(n.ts)),
          el('td', {}, n.method),
          el('td', {}, n.status ? String(n.status) : n.aborted ? 'cancelled' : 'error'),
          el('td', { class: 'url', title: n.url }, n.url),
          el('td', {}, n.type),
          el('td', { class: 'num' }, n.durationMs + ' ms'),
        );
        var open = function () {
          var next = tr.nextElementSibling;
          if (next && next.classList.contains('detail-row')) next.remove();
          else tr.after(el('tr', { class: 'detail-row' }, el('td', { colspan: '6' }, networkDetail(n))));
        };
        tr.addEventListener('click', open);
        tr.addEventListener('keydown', function (e) { if (e.key === 'Enter') open(); });
        tbody.appendChild(tr);
      });
    }
    search.addEventListener('input', draw);
    statusSel.addEventListener('change', draw);
    draw();
    return el(
      'div',
      {},
      el('div', { class: 'toolbar' }, search, statusSel, count),
      data.network.length
        ? el(
            'div',
            { class: 'table-wrap' },
            el('table', { class: 'net' }, el('thead', {}, el('tr', {}, ['Time', 'Method', 'Status', 'URL', 'Type', 'Duration'].map(function (h) { return el('th', {}, h); }))), tbody),
          )
        : el('div', { class: 'empty' }, 'No network requests were captured.'),
    );
  }

  function renderConsole() {
    var filter = 'all';
    var list = el('div', { class: 'list' });
    function draw() {
      list.replaceChildren();
      var items = data.console.filter(function (c) {
        if (filter === 'all') return true;
        if (filter === 'other') return c.level !== 'error' && c.level !== 'warn';
        return c.level === filter;
      });
      if (!items.length) list.appendChild(el('div', { class: 'empty' }, 'No console messages.'));
      items.forEach(function (c) {
        var row = el('div', { class: 'row' + (c.level === 'error' ? ' problem' : c.level === 'warn' ? ' warning' : '') });
        var head = el(
          'button',
          { type: 'button', class: 'row-head three' },
          el('span', { class: 'time' }, fmtTime(c.ts)),
          el('span', { class: 'kind' }, c.level),
          el('span', { class: 'label mono' }, c.message),
        );
        head.addEventListener('click', function () { toggleRow(row, function () { return consoleDetail(c); }); });
        row.appendChild(head);
        list.appendChild(row);
      });
    }
    draw();
    return el(
      'div',
      {},
      el('div', { class: 'toolbar' }, chips([['all', 'All'], ['error', 'Errors'], ['warn', 'Warnings'], ['other', 'Other']], filter, function (v) { filter = v; draw(); })),
      list,
    );
  }

  var playerStarted = false;
  function renderReplay() {
    var events = (data.replay && data.replay.events) || [];
    var box = el('div', { class: 'replay-box' });
    if (events.length < 2) {
      return el('div', { class: 'empty' }, 'No session replay was captured for this report.');
    }
    var first = events[0].timestamp;
    var last = events[events.length - 1].timestamp;
    setTimeout(function () {
      if (playerStarted) return;
      playerStarted = true;
      var Player = window.rrwebPlayer && (window.rrwebPlayer.default || window.rrwebPlayer.Player || window.rrwebPlayer);
      if (typeof Player !== 'function') {
        box.appendChild(el('div', { class: 'empty' }, 'The replay player could not be loaded.'));
        return;
      }
      var width = Math.min(box.clientWidth || 960, 1200);
      try {
        new Player({
          target: box,
          props: { events: events, width: width, height: Math.round(width * 0.58), autoPlay: false, skipInactive: true, showController: true, mouseTail: true },
        });
      } catch (e) {
        box.appendChild(el('div', { class: 'empty' }, 'The replay could not be played: ' + e.message));
      }
    }, 0);
    return el(
      'div',
      {},
      el(
        'p',
        { class: 'muted' },
        'A recording of the page from ' + fmtTime(first) + ' to ' + fmtTime(last) + ' (' + Math.round((last - first) / 1000) + ' seconds). Typed text is hidden.',
      ),
      box,
    );
  }

  // ---------- tabs ----------

  var views = {};
  var tabs = [
    ['overview', 'Overview', renderOverview],
    ['timeline', 'Timeline', renderTimeline],
    ['network', 'Network (' + data.network.length + ')', renderNetwork],
    ['console', 'Console (' + data.console.length + ')', renderConsole],
    ['replay', 'Replay', renderReplay],
  ];

  function show(id) {
    tabsNav.querySelectorAll('button').forEach(function (b) { b.setAttribute('aria-selected', String(b.dataset.tab === id)); });
    Object.keys(views).forEach(function (k) { views[k].hidden = k !== id; });
    if (!views[id]) {
      var def = tabs.filter(function (t) { return t[0] === id; })[0];
      views[id] = el('section', { class: 'view', role: 'tabpanel' }, def[2]());
      root.appendChild(views[id]);
    }
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
  }

  tabs.forEach(function (t) {
    var b = el('button', { type: 'button', role: 'tab', 'data-tab': t[0] }, t[1]);
    if ((t[0] === 'network' && data.problems.failed.length) || (t[0] === 'console' && data.problems.errors.length)) b.classList.add('has-problems');
    b.addEventListener('click', function () { show(t[0]); });
    tabsNav.appendChild(b);
  });

  var initial = location.hash.slice(1);
  show(tabs.some(function (t) { return t[0] === initial; }) ? initial : 'overview');
})();
