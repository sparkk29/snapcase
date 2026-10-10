const MASK = '[REDACTED]';

const SENSITIVE_HEADERS = [
  'authorization',
  'proxy-authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
  'x-access-token',
  'x-csrf-token',
  'x-xsrf-token',
];

const SENSITIVE_KEY_RE = /(pass(word|wd|phrase)?$|^pwd$|secret|token|apikey|authori[sz]ation|^auth$|^session(id)?$|^sid$|^ssn$|cardnumber|creditcard|^card$|^cc(num|number)?$|cvv|cvc|^otp$|^pin$|privatekey)/;

const EMAIL_RE = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const JWT_RE = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/g;
const AUTH_SCHEME_RE = /\b(Bearer|Basic|Token)\s+[A-Za-z0-9\-._~+/]{8,}=*/gi;
const CARD_RE = /\b(?:\d[ -]?){12,18}\d\b/g;
const PHONE_RE = /(?<![\w.])\+?\d{1,3}?[ .-]?\(?\d{3}\)?[ .-]?\d{3}[ .-]?\d{4}(?![\w.])/g;
const JSON_PAIR_RE = /"([^"\\]{1,80})"(\s*:\s*)("(?:[^"\\]|\\.)*"|-?\d[\d.eE+-]*)/g;

function normalizeKey(key) {
  return String(key).toLowerCase().replace(/[^a-z0-9]/g, '');
}

function luhn(digits) {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function compileCustomRules(rules) {
  const out = [];
  for (const rule of rules || []) {
    if (!rule || !rule.pattern) continue;
    try {
      out.push({ re: new RegExp(rule.pattern, rule.flags || 'gi'), label: String(rule.label || 'CUSTOM').toUpperCase().replace(/\s+/g, '_') });
    } catch {
      // invalid user regex is skipped
    }
  }
  return out;
}

export function createRedactor(settings) {
  const flags = settings.redact || {};
  const headerSet = new Set([...SENSITIVE_HEADERS, ...(settings.extraHeaders || []).map((h) => String(h).trim().toLowerCase())]);
  const extraKeys = new Set((settings.extraKeys || []).map(normalizeKey).filter(Boolean));
  const custom = compileCustomRules(settings.customRules);

  function isSensitiveKey(key) {
    const k = normalizeKey(key);
    if (!k) return false;
    return extraKeys.has(k) || SENSITIVE_KEY_RE.test(k);
  }

  function text(value) {
    if (typeof value !== 'string' || !value) return value;
    let s = value;
    if (flags.tokens) {
      s = s.replace(JWT_RE, '[REDACTED_TOKEN]');
      s = s.replace(AUTH_SCHEME_RE, (m, scheme) => `${scheme} ${MASK}`);
    }
    if (flags.emails) s = s.replace(EMAIL_RE, '[REDACTED_EMAIL]');
    if (flags.cards) {
      s = s.replace(CARD_RE, (m) => {
        const digits = m.replace(/\D/g, '');
        return digits.length >= 13 && digits.length <= 19 && luhn(digits) ? '[REDACTED_CARD]' : m;
      });
    }
    if (flags.phones) s = s.replace(PHONE_RE, '[REDACTED_PHONE]');
    for (const rule of custom) {
      rule.re.lastIndex = 0;
      s = s.replace(rule.re, `[REDACTED_${rule.label}]`);
    }
    return s;
  }

  function body(value) {
    if (typeof value !== 'string' || !value) return value;
    let s = value;
    if (flags.jsonKeys) {
      s = s.replace(JSON_PAIR_RE, (m, key, sep, val) => (isSensitiveKey(key) ? `"${key}"${sep}"${MASK}"` : m));
      if (/^[^\s{}[\]<>"]+=[^\s]*(&[^\s=&]+=[^\s]*)*$/.test(s.trim())) {
        s = s
          .trim()
          .split('&')
          .map((pair) => {
            const idx = pair.indexOf('=');
            if (idx < 0) return pair;
            let key = pair.slice(0, idx);
            try {
              key = decodeURIComponent(key.replace(/\+/g, ' '));
            } catch {
              // keep raw key
            }
            return isSensitiveKey(key) ? `${pair.slice(0, idx)}=${MASK}` : pair;
          })
          .join('&');
      }
    }
    return text(s);
  }

  function url(value) {
    if (typeof value !== 'string' || !value) return value;
    let out = value;
    if (flags.query) {
      try {
        const u = new URL(value);
        let changed = false;
        for (const [k, v] of [...u.searchParams.entries()]) {
          const nv = isSensitiveKey(k) ? MASK : text(v);
          if (nv !== v) {
            u.searchParams.set(k, nv);
            changed = true;
          }
        }
        if (changed) out = u.href.replace(/%5BREDACTED(_[A-Z]+)?%5D/g, (m) => decodeURIComponent(m));
      } catch {
        // not a valid URL
      }
    }
    return text(out);
  }

  function headers(obj) {
    if (!obj || typeof obj !== 'object') return obj;
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
      out[k] = flags.headers && headerSet.has(k.toLowerCase()) ? MASK : text(v);
    }
    return out;
  }

  function network(entry) {
    return {
      ...entry,
      url: url(entry.url),
      requestHeaders: headers(entry.requestHeaders),
      requestBody: body(entry.requestBody),
      responseHeaders: headers(entry.responseHeaders),
      responseBody: body(entry.responseBody),
      error: text(entry.error),
    };
  }

  function consoleEntry(entry) {
    return { ...entry, message: body(entry.message), stack: text(entry.stack) };
  }

  function action(entry) {
    return { ...entry, label: text(entry.label), value: text(entry.value), href: entry.href ? url(entry.href) : entry.href, url: url(entry.url) };
  }

  function navigation(entry) {
    return { ...entry, url: url(entry.url), from: entry.from ? url(entry.from) : entry.from };
  }

  function event(evt) {
    switch (evt.kind) {
      case 'network':
        return network(evt);
      case 'console':
        return consoleEntry(evt);
      case 'action':
        return action(evt);
      case 'navigation':
        return navigation(evt);
      default:
        return evt;
    }
  }

  function storageMap(map) {
    if (!map || typeof map !== 'object') return map;
    const out = {};
    for (const [k, v] of Object.entries(map)) out[k] = isSensitiveKey(k) && !/^\[\d+ chars\]$/.test(v) ? MASK : body(v);
    return out;
  }

  function environment(env) {
    if (!env) return env;
    return {
      ...env,
      url: url(env.url),
      referrer: env.referrer ? url(env.referrer) : env.referrer,
      localStorage: storageMap(env.localStorage),
      sessionStorage: storageMap(env.sessionStorage),
    };
  }

  const REPLAY_TEXT_KEYS = new Set(['textContent', 'value', 'text']);

  function replayValue(value, key) {
    if (typeof value === 'string') return REPLAY_TEXT_KEYS.has(key) ? text(value) : value;
    if (Array.isArray(value)) return value.map((v) => replayValue(v, key));
    if (value && typeof value === 'object') {
      const out = {};
      for (const k of Object.keys(value)) out[k] = replayValue(value[k], k);
      return out;
    }
    return value;
  }

  function replay(events) {
    if (!Array.isArray(events) || !events.length) return events;
    if (!flags.emails && !flags.tokens && !flags.cards && !flags.phones && !custom.length) return events;
    return events.map((e) => replayValue(e, ''));
  }

  return { text, body, url, headers, event, environment, replay, isSensitiveKey };
}
