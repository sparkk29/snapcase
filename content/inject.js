(() => {
  if (window.__snapcaseInjected) return;
  window.__snapcaseInjected = true;

  const EVENT_NAME = 'snapcase:event';
  const CONFIG_NAME = 'snapcase:config';
  const META = Symbol('snapcase');
  const MAX_QUEUE = 300;
  const MAX_ARG_LENGTH = 2000;

  const config = {
    enabled: true,
    maxBodyBytes: 100 * 1024,
    consoleLevels: ['error', 'warn'],
  };
  let ready = false;
  let queue = [];
  let counter = 0;

  const nativeStringify = JSON.stringify;
  const nativeDispatch = EventTarget.prototype.dispatchEvent;

  function dispatch(evt) {
    try {
      nativeDispatch.call(document, new CustomEvent(EVENT_NAME, { detail: nativeStringify(evt) }));
    } catch {
      // Serialization failures must never break the page.
    }
  }

  function emit(evt) {
    if (!config.enabled) return;
    evt.id = Date.now().toString(36) + '-' + (counter++).toString(36);
    evt.ts = evt.ts || Date.now();
    evt.time = new Date(evt.ts).toISOString();
    if (!ready) {
      if (queue.length < MAX_QUEUE) queue.push(evt);
      return;
    }
    dispatch(evt);
  }

  document.addEventListener(CONFIG_NAME, (e) => {
    try {
      Object.assign(config, JSON.parse(e.detail));
    } catch {
      return;
    }
    if (!ready) {
      ready = true;
      const pending = queue;
      queue = [];
      if (config.enabled) pending.forEach(dispatch);
    }
  });

  // ---------- helpers ----------

  function absoluteUrl(url) {
    try {
      return new URL(String(url), location.href).href;
    } catch {
      return String(url);
    }
  }

  function truncate(str, max) {
    if (str == null) return str;
    str = String(str);
    if (str.length <= max) return str;
    return str.slice(0, max) + `\n…[truncated, ${str.length - max} more characters]`;
  }

  function headersToObject(headers) {
    const out = {};
    if (!headers) return out;
    try {
      if (headers instanceof Headers) {
        headers.forEach((v, k) => { out[k] = v; });
      } else if (Array.isArray(headers)) {
        headers.forEach(([k, v]) => { out[String(k).toLowerCase()] = String(v); });
      } else if (typeof headers === 'object') {
        Object.keys(headers).forEach((k) => { out[k.toLowerCase()] = String(headers[k]); });
      }
    } catch {
      // ignore unreadable headers
    }
    return out;
  }

  function parseRawHeaders(raw) {
    const out = {};
    (raw || '').trim().split(/[\r\n]+/).forEach((line) => {
      const idx = line.indexOf(':');
      if (idx > 0) out[line.slice(0, idx).trim().toLowerCase()] = line.slice(idx + 1).trim();
    });
    return out;
  }

  function serializeBody(body) {
    if (body == null) return null;
    const max = config.maxBodyBytes;
    try {
      if (typeof body === 'string') return truncate(body, max);
      if (body instanceof URLSearchParams) return truncate(body.toString(), max);
      if (typeof FormData !== 'undefined' && body instanceof FormData) {
        const parts = [];
        body.forEach((v, k) => {
          parts.push(`${k}=${typeof v === 'string' ? v : `[file ${v.name || 'blob'}, ${v.size} bytes]`}`);
        });
        return truncate(parts.join('&'), max);
      }
      if (typeof Blob !== 'undefined' && body instanceof Blob) return `[binary ${body.type || 'blob'}, ${body.size} bytes]`;
      if (body instanceof ArrayBuffer) return `[binary, ${body.byteLength} bytes]`;
      if (ArrayBuffer.isView(body)) return `[binary, ${body.byteLength} bytes]`;
      if (typeof ReadableStream !== 'undefined' && body instanceof ReadableStream) return '[stream body not captured]';
      if (body instanceof Document) return truncate(new XMLSerializer().serializeToString(body), max);
      return truncate(String(body), max);
    } catch {
      return '[body not captured]';
    }
  }

  const TEXT_TYPE = /(^text\/|json|xml|javascript|x-www-form-urlencoded|graphql|csv|html)/i;

  async function readResponseBody(res) {
    const type = res.headers.get('content-type') || '';
    if (/event-stream/i.test(type)) return { body: '[event stream not captured]' };
    if (type && !TEXT_TYPE.test(type)) {
      const len = res.headers.get('content-length');
      return { body: `[binary ${type}${len ? `, ${len} bytes` : ''}]`, size: len ? Number(len) : undefined };
    }
    if (!res.body) return { body: '', size: 0 };
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    const max = config.maxBodyBytes;
    let text = '';
    let size = 0;
    let truncated = false;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (text.length < max) {
        text += decoder.decode(value, { stream: true });
      } else {
        truncated = true;
        reader.cancel().catch(() => {});
        break;
      }
    }
    if (!truncated) text += decoder.decode();
    if (text.length > max) truncated = true;
    if (truncated) text = text.slice(0, max) + '\n…[truncated]';
    return { body: text, size: truncated ? undefined : size };
  }

  function isFailed(status, error) {
    return !!error || status === 0 || status >= 400;
  }

  // ---------- fetch ----------

  const nativeFetch = window.fetch;
  if (typeof nativeFetch === 'function') {
    window.fetch = function (input, init) {
      const ts = Date.now();
      const t0 = performance.now();
      let method = 'GET';
      let url = '';
      let requestHeaders = {};
      let requestBody = null;
      try {
        const req = typeof Request !== 'undefined' && input instanceof Request ? input : null;
        url = absoluteUrl(req ? req.url : input instanceof URL ? input.href : input);
        method = String((init && init.method) || (req && req.method) || 'GET').toUpperCase();
        requestHeaders = { ...headersToObject(req && req.headers), ...headersToObject(init && init.headers) };
        if (init && init.body != null) requestBody = serializeBody(init.body);
        else if (req && req.body) requestBody = '[request body not captured]';
      } catch {
        // keep defaults
      }

      const promise = nativeFetch.apply(this, arguments);
      if (!config.enabled) return promise;

      promise.then(
        async (res) => {
          let body = null;
          let size;
          try {
            ({ body, size } = await readResponseBody(res.clone()));
          } catch (e) {
            body = `[response body not readable: ${e && e.message}]`;
          }
          emit({
            kind: 'network',
            type: 'fetch',
            ts,
            method,
            url,
            requestHeaders,
            requestBody,
            status: res.status,
            statusText: res.statusText,
            responseHeaders: headersToObject(res.headers),
            responseBody: body,
            responseSize: size,
            redirected: res.redirected,
            startedAt: new Date(ts).toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: Math.round(performance.now() - t0),
            failed: isFailed(res.status),
          });
        },
        (err) => {
          const aborted = err && err.name === 'AbortError';
          emit({
            kind: 'network',
            type: 'fetch',
            ts,
            method,
            url,
            requestHeaders,
            requestBody,
            status: 0,
            statusText: '',
            responseHeaders: {},
            responseBody: null,
            startedAt: new Date(ts).toISOString(),
            endedAt: new Date().toISOString(),
            durationMs: Math.round(performance.now() - t0),
            error: aborted ? 'Request was cancelled' : String((err && err.message) || err || 'Network error'),
            aborted,
            failed: !aborted,
          });
        },
      );
      return promise;
    };
  }

  // ---------- XMLHttpRequest ----------

  const XHR = XMLHttpRequest.prototype;
  const nativeOpen = XHR.open;
  const nativeSend = XHR.send;
  const nativeSetHeader = XHR.setRequestHeader;

  XHR.open = function (method, url) {
    this[META] = { method: String(method || 'GET').toUpperCase(), url: absoluteUrl(url), headers: {} };
    return nativeOpen.apply(this, arguments);
  };

  XHR.setRequestHeader = function (name, value) {
    if (this[META]) this[META].headers[String(name).toLowerCase()] = String(value);
    return nativeSetHeader.apply(this, arguments);
  };

  XHR.send = function (body) {
    const meta = this[META];
    if (meta && config.enabled) {
      meta.ts = Date.now();
      meta.t0 = performance.now();
      meta.body = serializeBody(body);
      const xhr = this;
      const markError = (msg, aborted) => () => { meta.error = msg; meta.aborted = !!aborted; };
      xhr.addEventListener('error', markError('Network error'));
      xhr.addEventListener('timeout', markError('Request timed out'));
      xhr.addEventListener('abort', markError('Request was cancelled', true));
      xhr.addEventListener('loadend', () => {
        let responseBody = null;
        try {
          const rt = xhr.responseType;
          if (rt === '' || rt === 'text') responseBody = truncate(xhr.responseText, config.maxBodyBytes);
          else if (rt === 'json') responseBody = truncate(nativeStringify(xhr.response), config.maxBodyBytes);
          else if (rt === 'document') responseBody = xhr.response ? truncate(new XMLSerializer().serializeToString(xhr.response), config.maxBodyBytes) : null;
          else responseBody = `[${rt} response not captured]`;
        } catch (e) {
          responseBody = `[response body not readable: ${e && e.message}]`;
        }
        const error = meta.error || (xhr.status === 0 && !meta.aborted ? 'Network error or request blocked' : undefined);
        emit({
          kind: 'network',
          type: 'xhr',
          ts: meta.ts,
          method: meta.method,
          url: meta.url,
          requestHeaders: meta.headers,
          requestBody: meta.body,
          status: xhr.status,
          statusText: xhr.statusText,
          responseHeaders: parseRawHeaders(xhr.getAllResponseHeaders()),
          responseBody,
          startedAt: new Date(meta.ts).toISOString(),
          endedAt: new Date().toISOString(),
          durationMs: Math.round(performance.now() - meta.t0),
          error,
          aborted: meta.aborted || undefined,
          failed: !meta.aborted && isFailed(xhr.status, error),
        });
      });
    }
    return nativeSend.apply(this, arguments);
  };

  // ---------- console & errors ----------

  function describeNode(node) {
    try {
      let s = '<' + node.nodeName.toLowerCase();
      if (node.id) s += '#' + node.id;
      if (node.classList && node.classList.length) s += '.' + [...node.classList].slice(0, 3).join('.');
      return s + '>';
    } catch {
      return '[node]';
    }
  }

  function safeStringify(value) {
    const seen = new WeakSet();
    try {
      return nativeStringify(value, (key, v) => {
        if (typeof v === 'bigint') return v.toString() + 'n';
        if (typeof v === 'function') return `[function ${v.name || 'anonymous'}]`;
        if (typeof Node !== 'undefined' && v instanceof Node) return describeNode(v);
        if (v instanceof Error) return { name: v.name, message: v.message };
        if (v && typeof v === 'object') {
          if (seen.has(v)) return '[circular]';
          seen.add(v);
        }
        return v;
      });
    } catch {
      return Object.prototype.toString.call(value);
    }
  }

  function formatArg(arg) {
    if (typeof arg === 'string') return arg;
    if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
    if (arg === undefined) return 'undefined';
    if (typeof arg === 'symbol') return arg.toString();
    if (typeof Node !== 'undefined' && arg instanceof Node) return describeNode(arg);
    if (arg && typeof arg === 'object') return safeStringify(arg);
    return String(arg);
  }

  function formatArgs(args) {
    return truncate(Array.prototype.map.call(args, formatArg).join(' '), MAX_ARG_LENGTH);
  }

  function findStack(args) {
    for (const a of args) if (a instanceof Error && a.stack) return truncate(a.stack, 4000);
    return undefined;
  }

  ['error', 'warn', 'info', 'log', 'debug'].forEach((level) => {
    const original = console[level];
    if (typeof original !== 'function') return;
    console[level] = function () {
      try {
        if (config.enabled && config.consoleLevels.includes(level)) {
          let stack = findStack(arguments);
          if (!stack && level === 'error') {
            stack = (new Error().stack || '').split('\n').slice(2).join('\n') || undefined;
          }
          emit({ kind: 'console', level, source: 'console', message: formatArgs(arguments), stack });
        }
      } catch {
        // never interfere with logging
      }
      return original.apply(this, arguments);
    };
  });

  window.addEventListener(
    'error',
    (e) => {
      if (!config.consoleLevels.includes('error')) return;
      const target = e.target;
      if (target && target !== window && target.nodeType === 1) {
        const src = target.src || target.href || target.currentSrc || '';
        emit({
          kind: 'console',
          level: 'error',
          source: 'resource',
          message: `Failed to load ${target.nodeName.toLowerCase()}: ${src}`,
        });
        return;
      }
      emit({
        kind: 'console',
        level: 'error',
        source: 'exception',
        message: e.message || formatArg(e.error),
        stack: (e.error && e.error.stack) ? truncate(e.error.stack, 4000) : (e.filename ? `at ${e.filename}:${e.lineno}:${e.colno}` : undefined),
      });
    },
    true,
  );

  window.addEventListener('unhandledrejection', (e) => {
    if (!config.consoleLevels.includes('error')) return;
    const reason = e.reason;
    emit({
      kind: 'console',
      level: 'error',
      source: 'promise',
      message: 'Unhandled promise rejection: ' + formatArg(reason),
      stack: reason && reason.stack ? truncate(reason.stack, 4000) : undefined,
    });
  });

  // ---------- navigation ----------

  let lastUrl = location.href;
  function navigated(navType) {
    const url = location.href;
    if (url === lastUrl && navType !== 'load') return;
    emit({ kind: 'navigation', navType, url, from: navType === 'load' ? document.referrer || undefined : lastUrl });
    lastUrl = url;
  }

  ['pushState', 'replaceState'].forEach((name) => {
    const original = history[name];
    history[name] = function () {
      const result = original.apply(this, arguments);
      try {
        navigated(name);
      } catch {
        // ignore
      }
      return result;
    };
  });
  window.addEventListener('popstate', () => navigated('popstate'));
  window.addEventListener('hashchange', () => navigated('hashchange'));
  navigated('load');
})();
