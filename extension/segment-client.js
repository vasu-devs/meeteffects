/* Snapshot-only API. In Meet, inference lives in the extension's isolated world. */
(() => {
  'use strict';
  const channel = 'meeteffects-segment-v1', client = crypto.randomUUID();
  const timeout = 15000;
  let sequence = 0, pending = null, hidden = false;
  function send(message, transfer = []) {
    window.postMessage({ channel, client, ...message }, location.origin, transfer);
  }
  function cancel(message = 'Segmentation cancelled.', name = 'AbortError') {
    if (!pending) return;
    const current = pending;
    current.finish(new DOMException(message, name));
    send({ type: 'cancel', id: current.id });
  }
  addEventListener('message', event => {
    const data = event.data, current = pending;
    if (event.source !== window || event.origin !== location.origin || !current ||
        data?.channel !== channel || data.client !== client || data.id !== current.id || data.type !== 'result') return;
    if (Date.now() > current.deadline) { cancel('Person detection timed out.', 'TimeoutError'); return; }
    if (data.error) { current.finish(new Error(String(data.error).slice(0, 240))); return; }
    if (data.width !== current.width || data.height !== current.height ||
        !(data.mask instanceof ArrayBuffer) || data.mask.byteLength !== current.width * current.height) {
      cancel('Invalid person mask.', 'DataError'); return;
    }
    current.finish(null, { mask: new Uint8Array(data.mask), width: data.width, height: data.height });
  });
  function segmentFrame(canvas, { signal } = {}) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted || hidden) { reject(new DOMException('Segmentation cancelled.', 'AbortError')); return; }
      const width = canvas?.width, height = canvas?.height;
      if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width > 512 || height > 512) {
        reject(new RangeError('Person detection needs a canvas between 1 and 512 pixels per side.')); return;
      }
      // One outstanding frame per client. A newer snapshot supersedes the old one.
      cancel('Superseded by a newer frame.');
      const pixels = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, width, height).data;
      const id = ++sequence, deadline = Date.now() + timeout;
      const abort = () => cancel();
      const timer = setTimeout(() => cancel('Person detection timed out.', 'TimeoutError'), timeout);
      pending = { id, width, height, deadline, finish(error, result) {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); pending = null;
        if (error) reject(error); else resolve(result);
      } };
      signal?.addEventListener('abort', abort, { once: true });
      try { send({ type: 'frame', id, width, height, deadline, pixels: pixels.buffer }, [pixels.buffer]); }
      catch (error) { pending.finish(error); }
    });
  }
  addEventListener('pagehide', () => { hidden = true; cancel(); });
  addEventListener('pageshow', () => { hidden = false; });
  Object.assign(globalThis.MeetEffects, { segmentFrame });
})();
