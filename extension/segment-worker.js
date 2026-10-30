/* Extension-owned CPU inference: page CSP cannot authorize or block its WASM. */
importScripts('vendor/vision-bundle.js', 'vendor/vision_wasm_internal.js', 'segment-inference.js');
let active = null;
chrome.runtime.onMessage.addListener((data, sender, reply) => {
  if (sender.id !== chrome.runtime.id || !sender.tab ||
      !sender.url?.startsWith('https://meet.google.com/') || sender.frameId !== 0 ||
      typeof data?.client !== 'string' || data.client.length > 64 || !Number.isSafeInteger(data.id) || data.id < 1) return;
  const owner = `${sender.tab.id}:${sender.documentId}`;
  if (data.type === 'meeteffects-segment-cancel') {
    if (active?.owner === owner && active.client === data.client && active.id === data.id) {
      active.cancelled = true; active.pixels = null;
      MeetEffectsSegmenter.close();
    }
    reply({ cancelled: true }); return;
  }
  if (data.type !== 'meeteffects-segment') return;
  if (active) { reply({ error: 'Person detection is busy. Try again shortly.' }); return; }
  if (!Number.isInteger(data.width) || !Number.isInteger(data.height) || data.width < 1 || data.height < 1 ||
      data.width > 512 || data.height > 512 || !Number.isFinite(data.deadline) || data.deadline < Date.now() ||
      typeof data.pixels !== 'string' || data.pixels.length !== 4 * Math.ceil(data.width * data.height * 4 / 3)) {
    reply({ error: 'Invalid person detection frame.' }); return;
  }
  let pixels;
  try { pixels = Uint8Array.from(atob(data.pixels), c => c.charCodeAt(0)); }
  catch { reply({ error: 'Invalid person detection pixels.' }); return; }
  if (pixels.length !== data.width * data.height * 4) { reply({ error: 'Invalid person detection pixels.' }); return; }
  const job = { owner, client: data.client, id: data.id, width: data.width, height: data.height,
    pixels: pixels.buffer, deadline: Math.min(data.deadline, Date.now() + 15000), cancelled: false };
  active = job;
  MeetEffectsSegmenter.segment(job).then(result => {
    if (job.cancelled || Date.now() > job.deadline) { reply({ error: 'Person detection cancelled or timed out.' }); return; }
    const bytes = new Uint8Array(result.mask); let text = '';
    for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
    reply({ width: result.width, height: result.height, mask: btoa(text) });
  }).catch(error => reply({ error: String(error.message).slice(0, 180) }))
    .finally(() => { job.pixels = null; active = null; });
  return true; // Keep only this bounded request's response port alive.
});
