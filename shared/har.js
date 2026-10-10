function toNameValue(obj) {
  return Object.entries(obj || {}).map(([name, value]) => ({ name, value: String(value) }));
}

function queryString(url) {
  try {
    return [...new URL(url).searchParams.entries()].map(([name, value]) => ({ name, value }));
  } catch {
    return [];
  }
}

function header(obj, name) {
  const key = Object.keys(obj || {}).find((k) => k.toLowerCase() === name);
  return key ? obj[key] : undefined;
}

export function toHAR(network, { pageUrl, pageTitle, version }) {
  const started = network.length ? network[0].startedAt : new Date().toISOString();
  return {
    log: {
      version: '1.2',
      creator: { name: 'Snapcase', version: version || '1.0.0' },
      pages: [{ startedDateTime: started, id: 'page_1', title: pageTitle || pageUrl || '', pageTimings: {} }],
      entries: network.map((n) => {
        const reqType = header(n.requestHeaders, 'content-type');
        const resType = header(n.responseHeaders, 'content-type');
        const entry = {
          pageref: 'page_1',
          startedDateTime: n.startedAt,
          time: n.durationMs || 0,
          request: {
            method: n.method,
            url: n.url,
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: toNameValue(n.requestHeaders),
            queryString: queryString(n.url),
            headersSize: -1,
            bodySize: n.requestBody ? n.requestBody.length : 0,
          },
          response: {
            status: n.status || 0,
            statusText: n.statusText || n.error || '',
            httpVersion: 'HTTP/1.1',
            cookies: [],
            headers: toNameValue(n.responseHeaders),
            content: {
              size: n.responseSize != null ? n.responseSize : n.responseBody ? n.responseBody.length : 0,
              mimeType: resType || 'x-unknown',
              text: n.responseBody || '',
            },
            redirectURL: header(n.responseHeaders, 'location') || '',
            headersSize: -1,
            bodySize: -1,
          },
          cache: {},
          timings: { blocked: -1, dns: -1, connect: -1, send: 0, wait: n.durationMs || 0, receive: 0, ssl: -1 },
          _resourceType: n.type === 'fetch' ? 'fetch' : 'xhr',
        };
        if (n.requestBody != null) entry.request.postData = { mimeType: reqType || 'text/plain', text: n.requestBody };
        if (n.error) entry._error = n.error;
        return entry;
      }),
    },
  };
}
