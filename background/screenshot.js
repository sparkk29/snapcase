// Chrome allows at most 2 captureVisibleTab calls per second.
const CAPTURE_INTERVAL_MS = 550;
const MAX_FRAMES = 40;
const MAX_CANVAS_DIMENSION = 32000;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let lastCaptureAt = 0;

async function capture(windowId) {
  const wait = CAPTURE_INTERVAL_MS - (Date.now() - lastCaptureAt);
  if (wait > 0) await sleep(wait);
  lastCaptureAt = Date.now();
  return chrome.tabs.captureVisibleTab(windowId, { format: 'png' });
}

export function captureVisible(windowId) {
  return capture(windowId);
}

function blobToDataUrl(blob) {
  return blob.arrayBuffer().then((buf) => {
    const bytes = new Uint8Array(buf);
    let binary = '';
    const chunk = 0x8000;
    for (let i = 0; i < bytes.length; i += chunk) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + chunk));
    }
    return `data:${blob.type};base64,${btoa(binary)}`;
  });
}

async function dataUrlToBitmap(dataUrl) {
  const blob = await (await fetch(dataUrl)).blob();
  return createImageBitmap(blob);
}

export async function captureFullPage(tab, maxHeight, onProgress) {
  const send = (msg) => chrome.tabs.sendMessage(tab.id, msg);
  const m = await send({ type: 'fp:measure' });
  if (!m || !m.viewportHeight) throw new Error('Could not measure the page');

  const frames = [];
  try {
    const dprLimit = Math.floor(MAX_CANVAS_DIMENSION / (m.devicePixelRatio || 1));
    const total = Math.min(m.scrollHeight, maxHeight, dprLimit);
    const estimate = Math.min(MAX_FRAMES, Math.ceil(total / m.viewportHeight));
    let y = 0;
    for (let i = 0; i < MAX_FRAMES && y < total; i++) {
      const res = await send({ type: 'fp:scrollTo', y, hideFixed: i > 0 });
      const actualY = res ? res.scrollY : y;
      if (i > 0 && actualY <= frames[frames.length - 1].y) break;
      frames.push({ y: actualY, dataUrl: await capture(tab.windowId) });
      if (onProgress) onProgress(frames.length, estimate);
      if (actualY + m.viewportHeight >= total) break;
      y = actualY + m.viewportHeight;
    }

    const bitmaps = await Promise.all(frames.map((f) => dataUrlToBitmap(f.dataUrl)));
    const scale = bitmaps[0].width / m.viewportWidth;
    const last = frames[frames.length - 1];
    const cssHeight = Math.min(total, last.y + m.viewportHeight);
    const canvas = new OffscreenCanvas(bitmaps[0].width, Math.round(cssHeight * scale));
    const ctx = canvas.getContext('2d');
    frames.forEach((f, i) => ctx.drawImage(bitmaps[i], 0, Math.round(f.y * scale)));
    bitmaps.forEach((b) => b.close());
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    return {
      dataUrl: await blobToDataUrl(blob),
      frames: frames.length,
      truncated: m.scrollHeight > total,
    };
  } finally {
    await send({ type: 'fp:restore' }).catch(() => {});
  }
}
