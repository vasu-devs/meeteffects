/* Runs against a local public Google sample, never a camera. */
async function runSegmentationTests(host) {
  const checks = [];
  const check = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  try {
    let trustedTypesBlocked = false;
    try { document.createElement('script').src = '/not-loaded.js'; } catch { trustedTypesBlocked = true; }
    check(trustedTypesBlocked === (host !== 'extension studio'), 'Trusted Types script sink follows host CSP');
    let wasmBlocked = false;
    try { await WebAssembly.compile(new Uint8Array([0,97,115,109,1,0,0,0])); } catch { wasmBlocked = true; }
    check(wasmBlocked === host.startsWith('strict'), 'MAIN WASM follows host CSP');
    const image = new Image(); image.src = 'sample.jpg'; await image.decode();
    const canvas = document.createElement('canvas'); canvas.width = image.width; canvas.height = image.height;
    const context = canvas.getContext('2d', { willReadFrequently: true }); context.drawImage(image, 0, 0);
    let captures = 0;
    if (navigator.mediaDevices) navigator.mediaDevices.getUserMedia = async () => { captures++; throw new Error('Unexpected capture'); };
    const started = performance.now();
    const result = await MeetEffects.segmentFrame(canvas);
    const coldMs = performance.now() - started;
    check(result.mask instanceof Uint8Array && result.width === canvas.width && result.height === canvas.height && result.mask.length === canvas.width * canvas.height, 'Mask matches input dimensions and ownership');
    check(result.mask.every(v => v === 0 || v === 255), 'Binary person/background output');
    const region = (x, y, w, h) => {
      let n = 0; for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) n += result.mask[j * result.width + i] / 255;
      return n / (w * h);
    };
    const foreground = region(35, 65, 25, 45), background = region(200, 10, 40, 60);
    check(foreground > 0.7 && background < 0.1, 'ML finds off-center people and excludes forest');
    const firstBytes = result.mask.slice();
    const blank = document.createElement('canvas'); blank.width = 320; blank.height = 180;
    blank.getContext('2d').fillRect(0, 0, 320, 180);
    const warmStart = performance.now();
    const empty = await MeetEffects.segmentFrame(blank);
    const warmMs = performance.now() - warmStart;
    check(empty.mask.filter(v => v === 255).length / empty.mask.length < 0.05, 'Blank frame has no invented silhouette');
    check(result.mask.every((v, i) => v === firstBytes[i]), 'Earlier mask survives later inference');
    const aborted = new AbortController(); aborted.abort();
    const before = await MeetEffects.segmentFrame(canvas, { signal: aborted.signal }).then(() => 'resolved', e => e.name);
    check(before === 'AbortError', 'Already-aborted signal rejects');
    const controller = new AbortController();
    const cancelled = MeetEffects.segmentFrame(canvas, { signal: controller.signal }).then(() => 'resolved', e => e.name);
    controller.abort();
    check(await cancelled === 'AbortError', 'In-flight cancellation rejects');
    const superseded = MeetEffects.segmentFrame(canvas).then(() => 'resolved', e => e.name);
    const latest = MeetEffects.segmentFrame(blank);
    check(await superseded === 'AbortError', 'Newer snapshot supersedes pending request');
    check((await latest).width === 320, 'Stale response cannot settle newer request');
    const invalid = document.createElement('canvas'); invalid.width = 513;
    check(await MeetEffects.segmentFrame(invalid).then(() => false, e => e.name === 'RangeError'), 'Oversize input rejected');
    const leaving = MeetEffects.segmentFrame(canvas).then(() => 'resolved', e => e.name);
    dispatchEvent(new PageTransitionEvent('pagehide'));
    check(await leaving === 'AbortError', 'Page exit cancels pending work');
    dispatchEvent(new PageTransitionEvent('pageshow'));
    check((await MeetEffects.segmentFrame(blank)).height === 180, 'Restored page can initialize again');
    check(captures === 0, 'No camera or microphone acquisition');
    return { ok: true, host, checks, coldMs, warmMs, foreground, background };
  } catch (error) { return { ok: false, host, checks, error: error.stack }; }
}
