(() => {
  if (window.__snapcaseCollector) return;
  window.__snapcaseCollector = true;

  const EVENT_NAME = 'snapcase:event';
  const CONFIG_NAME = 'snapcase:config';
  const FLUSH_MS = 300;
  const INPUT_DEBOUNCE_MS = 800;

  let config = {
    enabled: true,
    maxBodyBytes: 100 * 1024,
    consoleLevels: ['error', 'warn'],
    replayEnabled: true,
    replaySeconds: 30,
    includeStorageValues: false,
  };
  let contextAlive = true;
  let batch = [];
  let flushTimer = null;

  // ---------- messaging ----------

  function sendToBackground(message) {
    if (!contextAlive) return Promise.resolve(null);
    try {
      return chrome.runtime.sendMessage(message).catch((err) => {
        if (/context invalidated/i.test(String(err && err.message))) contextAlive = false;
        return null;
      });
    } catch {
      contextAlive = false;
      return Promise.resolve(null);
    }
  }

  function flush() {
    clearTimeout(flushTimer);
    flushTimer = null;
    if (!batch.length) return Promise.resolve();
    const events = batch;
    batch = [];
    return sendToBackground({ type: 'events', events });
  }

  function queueEvent(evt) {
    if (!config.enabled) return;
    batch.push(evt);
    if (!flushTimer) flushTimer = setTimeout(flush, FLUSH_MS);
  }

  document.addEventListener(EVENT_NAME, (e) => {
    try {
      queueEvent(JSON.parse(e.detail));
    } catch {
      // malformed event
    }
  });

  window.addEventListener('pagehide', flush);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flush();
  });

  function pushConfigToPage() {
    document.dispatchEvent(
      new CustomEvent(CONFIG_NAME, {
        detail: JSON.stringify({
          enabled: config.enabled,
          maxBodyBytes: config.maxBodyBytes,
          consoleLevels: config.consoleLevels,
        }),
      }),
    );
  }

  async function loadConfig() {
    const res = await sendToBackground({ type: 'hello', url: location.href });
    if (res && res.config) config = { ...config, ...res.config };
    pushConfigToPage();
    updateReplay();
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') loadConfig();
    });
  } catch {
    contextAlive = false;
  }

  // ---------- user actions ----------

  function cssEscape(s) {
    return window.CSS && CSS.escape ? CSS.escape(s) : String(s).replace(/[^\w-]/g, '\\$&');
  }

  function selectorFor(el) {
    if (!el || el.nodeType !== 1) return '';
    if (el.id) return '#' + cssEscape(el.id);
    const parts = [];
    let node = el;
    while (node && node.nodeType === 1 && parts.length < 4 && node !== document.body) {
      let part = node.nodeName.toLowerCase();
      if (node.id) {
        parts.unshift('#' + cssEscape(node.id));
        break;
      }
      const cls = [...node.classList].filter((c) => !/^\d|[:[\]]/.test(c)).slice(0, 2);
      if (cls.length) part += '.' + cls.map(cssEscape).join('.');
      const parent = node.parentElement;
      if (parent) {
        const same = [...parent.children].filter((c) => c.nodeName === node.nodeName);
        if (same.length > 1) part += `:nth-of-type(${same.indexOf(node) + 1})`;
      }
      parts.unshift(part);
      node = node.parentElement;
    }
    return parts.join(' > ');
  }

  function clean(text, max = 60) {
    const t = String(text || '').replace(/\s+/g, ' ').trim();
    return t.length > max ? t.slice(0, max - 1) + '…' : t;
  }

  function labelForField(el) {
    if (el.id) {
      const lbl = document.querySelector(`label[for="${cssEscape(el.id)}"]`);
      if (lbl) return clean(lbl.innerText);
    }
    const wrapping = el.closest('label');
    if (wrapping) return clean(wrapping.innerText);
    return clean(el.getAttribute('aria-label') || el.getAttribute('placeholder') || el.getAttribute('name') || el.getAttribute('title') || '');
  }

  function labelFor(el) {
    const tag = el.nodeName.toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return labelForField(el);
    return clean(
      el.getAttribute('aria-label') ||
        el.innerText ||
        el.getAttribute('title') ||
        el.getAttribute('alt') ||
        (el.querySelector && el.querySelector('img[alt]') && el.querySelector('img[alt]').getAttribute('alt')) ||
        el.getAttribute('value') ||
        '',
    );
  }

  const INTERACTIVE = 'a,button,input,select,textarea,label,summary,[role=button],[role=link],[role=tab],[role=menuitem],[role=checkbox],[role=option],[onclick]';

  function describeTarget(target) {
    const el = (target.closest && target.closest(INTERACTIVE)) || target;
    return {
      el,
      info: {
        tag: el.nodeName.toLowerCase(),
        role: el.getAttribute('role') || undefined,
        inputType: el.nodeName === 'INPUT' ? (el.type || 'text').toLowerCase() : undefined,
        label: labelFor(el),
        selector: selectorFor(el),
        href: el.nodeName === 'A' && el.href ? el.href : undefined,
      },
    };
  }

  function recordAction(action) {
    const now = Date.now();
    queueEvent({
      kind: 'action',
      id: now.toString(36) + '-a' + Math.random().toString(36).slice(2, 6),
      ts: now,
      time: new Date(now).toISOString(),
      url: location.href,
      ...action,
    });
  }

  document.addEventListener(
    'click',
    (e) => {
      if (!e.isTrusted || !(e.target instanceof Element)) return;
      const { el, info } = describeTarget(e.target);
      const action = { action: 'click', ...info };
      if (info.inputType === 'checkbox' || info.inputType === 'radio') action.checked = el.checked;
      if (info.inputType === 'password' || info.tag === 'textarea' || (info.tag === 'input' && !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(info.inputType))) {
        action.action = 'focus';
      }
      recordAction(action);
    },
    true,
  );

  const inputTimers = new WeakMap();
  const inputStarted = new WeakMap();
  document.addEventListener(
    'input',
    (e) => {
      const el = e.target;
      if (!e.isTrusted || !(el instanceof Element)) return;
      const tag = el.nodeName.toLowerCase();
      if (tag !== 'input' && tag !== 'textarea' && !el.isContentEditable) return;
      const type = tag === 'input' ? (el.type || 'text').toLowerCase() : tag;
      if (['checkbox', 'radio', 'range', 'color', 'file'].includes(type)) return;
      clearTimeout(inputTimers.get(el));
      if (!inputStarted.has(el)) inputStarted.set(el, Date.now());
      inputTimers.set(
        el,
        setTimeout(() => {
          const isPassword = type === 'password';
          const ts = inputStarted.get(el);
          inputStarted.delete(el);
          recordAction({
            ts,
            time: new Date(ts).toISOString(),
            action: 'input',
            tag,
            inputType: type,
            label: el.isContentEditable ? 'text editor' : labelForField(el),
            selector: selectorFor(el),
            valueLength: isPassword ? undefined : (el.value != null ? el.value.length : (el.innerText || '').length),
            masked: true,
          });
        }, INPUT_DEBOUNCE_MS),
      );
    },
    true,
  );

  document.addEventListener(
    'change',
    (e) => {
      const el = e.target;
      if (!e.isTrusted || !(el instanceof Element)) return;
      const tag = el.nodeName.toLowerCase();
      if (tag === 'select') {
        const opt = el.selectedOptions && el.selectedOptions[0];
        recordAction({ action: 'select', tag, label: labelForField(el), selector: selectorFor(el), value: opt ? clean(opt.text) : '' });
      } else if (tag === 'input' && el.type === 'file') {
        recordAction({ action: 'file', tag, inputType: 'file', label: labelForField(el), selector: selectorFor(el), fileCount: el.files ? el.files.length : 0 });
      }
    },
    true,
  );

  document.addEventListener(
    'submit',
    (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;
      const heading = form.querySelector('h1,h2,h3,legend');
      recordAction({
        action: 'submit',
        tag: 'form',
        label: clean(form.getAttribute('aria-label') || form.getAttribute('name') || (heading && heading.innerText) || form.id || ''),
        selector: selectorFor(form),
      });
    },
    true,
  );

  document.addEventListener(
    'keydown',
    (e) => {
      if (!e.isTrusted || !['Enter', 'Escape'].includes(e.key)) return;
      const el = e.target instanceof Element ? e.target : null;
      recordAction({
        action: 'key',
        key: e.key,
        tag: el ? el.nodeName.toLowerCase() : undefined,
        label: el ? labelFor(el) : '',
        selector: el ? selectorFor(el) : '',
      });
    },
    true,
  );

  // ---------- session replay ----------

  let segments = [[]];
  let stopRecording = null;

  function startReplay() {
    if (stopRecording || !window.rrwebRecord || !window.rrwebRecord.record) return;
    segments = [[]];
    try {
      stopRecording = window.rrwebRecord.record({
        emit(event, isCheckout) {
          if (isCheckout) {
            segments.push([]);
            if (segments.length > 2) segments.shift();
          }
          segments[segments.length - 1].push(event);
        },
        checkoutEveryNms: Math.max(10, config.replaySeconds) * 1000,
        maskAllInputs: true,
        recordCanvas: false,
        collectFonts: false,
        inlineImages: false,
        sampling: { mousemove: 50, scroll: 150, media: 800, input: 'last' },
        slimDOMOptions: 'all',
      });
    } catch (e) {
      stopRecording = null;
    }
  }

  function stopReplay() {
    if (stopRecording) {
      try {
        stopRecording();
      } catch {
        // ignore
      }
    }
    stopRecording = null;
    segments = [[]];
  }

  function updateReplay() {
    const want = config.enabled && config.replayEnabled;
    if (!want) {
      stopReplay();
      return;
    }
    if (stopRecording) return;
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', startReplay, { once: true });
    } else {
      startReplay();
    }
  }

  // ---------- environment ----------

  function storageInfo(storage) {
    const out = {};
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i);
        if (config.includeStorageValues) {
          const v = storage.getItem(key) || '';
          out[key] = v.length > 500 ? v.slice(0, 500) + '…' : v;
        } else {
          out[key] = `[${(storage.getItem(key) || '').length} chars]`;
        }
      }
    } catch {
      return { error: 'not accessible' };
    }
    return out;
  }

  async function collectEnvironment() {
    const nav = navigator;
    let uaData = null;
    try {
      if (nav.userAgentData) {
        const high = await nav.userAgentData.getHighEntropyValues(['platformVersion', 'fullVersionList', 'architecture', 'model']);
        uaData = {
          brands: (high.fullVersionList || nav.userAgentData.brands || []).map((b) => `${b.brand} ${b.version}`),
          mobile: nav.userAgentData.mobile,
          platform: high.platform || nav.userAgentData.platform,
          platformVersion: high.platformVersion,
          architecture: high.architecture,
          model: high.model || undefined,
        };
      }
    } catch {
      // not available
    }
    const conn = nav.connection;
    return {
      url: location.href,
      title: document.title,
      referrer: document.referrer || undefined,
      userAgent: nav.userAgent,
      userAgentData: uaData,
      language: nav.language,
      languages: nav.languages,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timezoneOffsetMinutes: new Date().getTimezoneOffset(),
      screen: { width: screen.width, height: screen.height, colorDepth: screen.colorDepth },
      viewport: { width: window.innerWidth, height: window.innerHeight },
      devicePixelRatio: window.devicePixelRatio,
      colorScheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
      online: nav.onLine,
      connection: conn ? { effectiveType: conn.effectiveType, downlink: conn.downlink, rtt: conn.rtt, saveData: conn.saveData } : undefined,
      deviceMemoryGB: nav.deviceMemory,
      hardwareConcurrency: nav.hardwareConcurrency,
      cookiesEnabled: nav.cookieEnabled,
      cookieNames: document.cookie ? document.cookie.split(';').map((c) => c.split('=')[0].trim()).filter(Boolean) : [],
      localStorage: storageInfo(window.localStorage),
      sessionStorage: storageInfo(window.sessionStorage),
      documentReadyState: document.readyState,
      pageLoadMs: (() => {
        const navEntry = performance.getEntriesByType('navigation')[0];
        return navEntry ? Math.round(navEntry.loadEventEnd || navEntry.domContentLoadedEventEnd || 0) : undefined;
      })(),
    };
  }

  // ---------- full-page screenshot helper ----------

  let hiddenFixed = null;
  let savedScroll = null;
  let savedScrollBehavior = null;

  function nextFrame() {
    return new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  }

  function hideFixedElements() {
    if (hiddenFixed) return;
    hiddenFixed = [];
    const all = document.body ? document.body.getElementsByTagName('*') : [];
    for (const el of all) {
      const pos = getComputedStyle(el).position;
      if (pos === 'fixed' || pos === 'sticky') {
        hiddenFixed.push([el, el.style.getPropertyValue('visibility'), el.style.getPropertyPriority('visibility')]);
        el.style.setProperty('visibility', 'hidden', 'important');
      }
    }
  }

  function restorePage() {
    if (hiddenFixed) {
      hiddenFixed.forEach(([el, value, priority]) => {
        if (value) el.style.setProperty('visibility', value, priority);
        else el.style.removeProperty('visibility');
      });
    }
    hiddenFixed = null;
    if (savedScrollBehavior !== null) {
      document.documentElement.style.scrollBehavior = savedScrollBehavior;
      savedScrollBehavior = null;
    }
    if (savedScroll) window.scrollTo(savedScroll.x, savedScroll.y);
    savedScroll = null;
  }

  function measurePage() {
    const de = document.documentElement;
    const body = document.body || de;
    savedScroll = { x: window.scrollX, y: window.scrollY };
    savedScrollBehavior = de.style.scrollBehavior;
    de.style.scrollBehavior = 'auto';
    return {
      scrollHeight: Math.max(de.scrollHeight, body.scrollHeight, de.clientHeight),
      viewportHeight: window.innerHeight,
      viewportWidth: window.innerWidth,
      devicePixelRatio: window.devicePixelRatio,
    };
  }

  async function scrollToY(y, hideFixed) {
    window.scrollTo(0, y);
    if (hideFixed) hideFixedElements();
    await nextFrame();
    await new Promise((r) => setTimeout(r, 120));
    return { scrollY: window.scrollY };
  }

  // ---------- background requests ----------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || typeof msg.type !== 'string') return false;
    switch (msg.type) {
      case 'ping':
        sendResponse({ ok: true });
        return false;
      case 'flush':
        flush().then(() => sendResponse({ ok: true }));
        return true;
      case 'getReplay':
        sendResponse({ events: segments.flat() });
        return false;
      case 'getEnv':
        collectEnvironment().then(sendResponse, () => sendResponse({}));
        return true;
      case 'fp:measure':
        sendResponse(measurePage());
        return false;
      case 'fp:scrollTo':
        scrollToY(msg.y, msg.hideFixed).then(sendResponse);
        return true;
      case 'fp:restore':
        restorePage();
        sendResponse({ ok: true });
        return false;
      case 'clearReplay':
        if (stopRecording) {
          stopReplay();
          updateReplay();
        }
        sendResponse({ ok: true });
        return false;
      default:
        return false;
    }
  });

  loadConfig();
})();
