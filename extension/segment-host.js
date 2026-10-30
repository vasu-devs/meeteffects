/* Meet isolated-world relay, or direct local-studio host. No capture or remote I/O. */
(() => {
  'use strict';
  const channel = 'meeteffects-segment-v1';
  const relay = !!globalThis.chrome?.runtime?.id && location.protocol !== 'chrome-extension:';
  let active = null, queued = null, hidden = false;
  const encode = buffer => {
    const bytes = new Uint8Array(buffer); let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    return btoa(text);
  };
  function respond(job, result) {
    window.postMessage({ channel, client: job.client, id: job.id, type: 'result', ...result },
      location.origin, result.mask ? [result.mask] : []);
  }
  function expired(job) { return hidden || job.cancelled || Date.now() > job.deadline; }
  async function run(job) {
    active = job;
    try {
      let result;
      if (relay) {
        // Chromium runtime messaging is JSON-only. Bounded base64 stays inside
        // the extension; window messaging transfers ArrayBuffers on either end.
        const pixels = encode(job.pixels); job.pixels = null;
        result = await chrome.runtime.sendMessage({ type: 'meeteffects-segment',
          client: job.client, id: job.id, width: job.width, height: job.height, deadline: job.deadline, pixels });
        if (!result || result.error) throw new Error(result?.error || 'Person detection worker stopped.');
        if (typeof result.mask !== 'string' || result.mask.length !== 4 * Math.ceil(job.width * job.height / 3)) throw new Error('Invalid worker mask.');
        result.mask = Uint8Array.from(atob(result.mask), c => c.charCodeAt(0)).buffer;
      } else result = await MeetEffectsSegmenter.segment(job);
      if (!expired(job)) respond(job, result);
    } catch (error) {
      const message = String(error.message);
      if (!expired(job)) respond(job, { error: /extension context invalidated/i.test(message)
        ? 'MeetEffects was reloaded. Refresh this Meet tab to reconnect.'
        : 'Local person detection could not start. ' + message.slice(0, 160) });
    } finally {
      job.pixels = null; active = null;
      const next = queued; queued = null;
      if (next && !expired(next)) void run(next);
    }
  }
  addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window || event.origin !== location.origin || data?.channel !== channel ||
        typeof data.client !== 'string' || data.client.length > 64 || !Number.isSafeInteger(data.id) || data.id < 1) return;
    if (data.type === 'cancel') {
      if (active?.client === data.client && active.id === data.id) cancelActive();
      if (queued?.client === data.client && queued.id === data.id) queued = null;
      return;
    }
    if (data.type !== 'frame' || hidden || !Number.isInteger(data.width) || !Number.isInteger(data.height) ||
        data.width < 1 || data.height < 1 || data.width > 512 || data.height > 512 ||
        !(data.pixels instanceof ArrayBuffer) || data.pixels.byteLength !== data.width * data.height * 4 ||
        !Number.isFinite(data.deadline) || data.deadline < Date.now()) return;
    const job = { client: data.client, id: data.id, width: data.width, height: data.height,
      pixels: data.pixels, deadline: Math.min(data.deadline, Date.now() + 15000), cancelled: false };
    if (active) {
      if (queued) respond(queued, { error: 'Superseded by a newer frame.' });
      queued = job; // At most one running + one queued frame, each <= 1 MiB.
    } else void run(job);
  });
  function cancelActive() {
    active.cancelled = true; active.pixels = null;
    if (relay) {
      // An extension reload can also make sendMessage throw synchronously.
      try { chrome.runtime.sendMessage({ type: 'meeteffects-segment-cancel', client: active.client, id: active.id }).catch(() => {}); } catch { /* The invalidated worker is already disconnected. */ }
    }
    else MeetEffectsSegmenter.close();
  }
  addEventListener('pagehide', () => {
    hidden = true; queued = null;
    if (active) cancelActive();
    if (!relay) MeetEffectsSegmenter.close();
  });
  addEventListener('pageshow', () => { hidden = false; });
})();
