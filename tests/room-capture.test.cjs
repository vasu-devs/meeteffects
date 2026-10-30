const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');

function events(properties = {}) {
  const listeners = new Map();
  return Object.assign(properties, {
    addEventListener(type, fn) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(fn);
    },
    removeEventListener(type, fn) { listeners.get(type)?.delete(fn); },
    dispatch(type) { for (const fn of [...(listeners.get(type) || [])]) fn(); },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); }
  });
}

// A broken deadline must fail an assertion instead of hanging on a fake timer.
async function settled(promise) {
  let done = false;
  promise.then(() => { done = true; }, () => { done = true; });
  for (let i = 0; i < 5; i++) await Promise.resolve();
  assert.ok(done, 'capture must settle without another timer tick');
  return promise;
}

function harness(t, width = 1920, height = 1080) {
  let now = 0, nextTimer = 0, mediaRequests = 0, inferences = 0;
  const timers = new Map(), canvases = [], cameraTracks = [];
  const canvas = (w = width, h = height, color = [12, 34, 56, 255]) => {
    const result = { width: w, height: h, color: [...color], draws: [] };
    result.getContext = () => ({
      drawImage(source, ...args) {
        result.color = [...source.color]; result.draws.push({ source, args, at: now });
      }
    });
    return result;
  };
  const context = { DOMException, performance: { now: () => now },
    navigator: { mediaDevices: { getUserMedia() {
      mediaRequests++; assert.fail('capture must reuse the existing camera');
    } } },
    document: { createElement(type) {
      assert.equal(type, 'canvas'); const result = canvas(); canvases.push(result); return result;
    } },
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { at: now + delay, fn }); return id; },
    clearTimeout(id) { timers.delete(id); }, clearInterval(id) { timers.delete(id); }
  };
  vm.runInNewContext(fs.readFileSync(require.resolve('../extension/engine.js'), 'utf8'), context);
  context.MeetEffects.segmentFrame = () => { inferences++; assert.fail('capture must not run inference'); };
  const newTrack = () => {
    const track = events({ enabled: true, muted: false, readyState: 'live' });
    cameraTracks.push(track); return track;
  };
  const track = newTrack(), tracks = [track], stream = { getVideoTracks: () => [...tracks] };
  const source = events({ videoWidth: width, videoHeight: height, srcObject: stream, readyState: 4,
    paused: false, ended: false, muted: true, color: [12, 34, 56, 255] });
  const engine = new context.MeetEffects.Engine(source, canvas());
  engine.automatic = true; engine.autoReady = true;
  const scale = Math.min(1, 960 / Math.max(width, height));
  const fw = Math.max(1, Math.round(width * scale)), fh = Math.max(1, Math.round(height * scale));
  const ratio = Math.min(1, 256 / Math.max(fw, fh));
  const mw = Math.max(1, Math.round(fw * ratio)), mh = Math.max(1, Math.round(fh * ratio));
  const publish = ({ personPixels = 0, color = [200, 10, 20, 255], capturedAt = now } = {}) => {
    const mask = new Uint8Array(mw * mh); mask.fill(255, 0, personPixels);
    engine.live = { frame: canvas(fw, fh, color), mask, width: mw, height: mh, capturedAt };
    engine.liveStats.updates++;
    return engine.live;
  };
  publish();
  const signal = events({ aborted: false });
  const abort = () => { signal.aborted = true; signal.dispatch('abort'); };
  t.after(abort);
  const progress = [], progressTimes = [];
  const capture = onProgress => {
    const pending = context.MeetEffects.captureEmptyRoom(engine, { signal, onProgress(value) {
      progress.push({ ...value }); progressTimes.push(now); onProgress?.(value);
    } });
    // Assertions may fail before awaiting the result; retain its rejection for settled().
    pending.catch(() => {});
    return pending;
  };
  const advance = ms => {
    const end = now + ms;
    let ticks = 0;
    for (;;) {
      const due = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
      if (!due || due[1].at > end) break;
      assert.ok(++ticks <= 10000, 'fake timer must make bounded progress');
      timers.delete(due[0]); now = due[1].at; due[1].fn();
    }
    now = end;
  };
  const clean = () => {
    assert.equal(timers.size, 0, 'capture timer must be cleared');
    assert.equal(signal.listenerCount(), 0, 'abort listener must be removed');
    assert.equal(source.listenerCount(), 0, 'video listeners must be removed');
    for (const cameraTrack of cameraTracks) {
      assert.equal(cameraTrack.listenerCount(), 0, 'camera listeners must be removed');
    }
    assert.equal(mediaRequests, 0); assert.equal(inferences, 0);
  };
  return { engine, source, track, tracks, newTrack, abort, capture, publish, progress, progressTimes,
    advance, clean, canvases, canvas };
}

const countdown = [5, 4, 3, 2, 1].map(seconds => ({ phase: 'countdown', seconds }));
const capturing = { phase: 'capturing', seconds: 0 };

test('counts down for five seconds, then immediately copies the current raw camera into a detached canvas', async t => {
  const h = harness(t);
  h.advance(1234); // The deadline is relative to this capture, not page startup.
  const stale = h.engine.live.frame;
  h.engine.canvas.color = [1, 2, 3, 255];
  const pending = h.capture();
  assert.deepEqual(h.progress, countdown.slice(0, 1));
  for (let seconds = 1; seconds <= 5; seconds++) {
    h.advance(999);
    assert.deepEqual(h.progress, countdown.slice(0, seconds));
    assert.equal(h.canvases.length, 0, 'must not copy a frame before five seconds');
    if (seconds < 5) h.advance(1);
  }
  // A fresh camera frame arrives after all countdown updates; ML still holds the old frame.
  h.source.color = [92, 140, 210, 255];
  h.advance(1);
  assert.deepEqual(h.progress, [...countdown, capturing]);
  assert.deepEqual(h.progressTimes, [1234, 2234, 3234, 4234, 5234, 6234]);
  assert.equal(h.canvases.length, 1, 'copy must happen on the final countdown tick');
  const copy = await settled(pending);
  assert.equal(copy, h.canvases[0]);
  assert.equal(copy.width, 960); assert.equal(copy.height, 540);
  assert.deepEqual(copy.color, [92, 140, 210, 255]);
  assert.notEqual(copy, stale); assert.notEqual(copy, h.engine.canvas); assert.notEqual(copy, h.source);
  assert.deepEqual(copy.draws, [{ source: h.source, args: [0, 0, 960, 540], at: 6234 }]);
  h.clean();
  h.source.color.fill(0); stale.color.fill(0); h.engine.canvas.color.fill(0);
  h.source.videoWidth = 1; stale.width = 1; h.engine.canvas.width = 1;
  assert.deepEqual(copy.color, [92, 140, 210, 255]); assert.equal(copy.width, 960);
  h.abort(); h.track.dispatch('ended'); h.advance(20000);
  assert.equal(h.canvases.length, 1); assert.equal(h.progress.length, 6); h.clean();
});

test('fresh foreground false positives above 0.1% cannot extend the countdown', async t => {
  const h = harness(t);
  h.publish({ personPixels: 100 });
  assert.ok(100 / h.engine.live.mask.length > 0.001);
  const pending = h.capture();
  for (let i = 0; i < 20; i++) {
    h.publish({ personPixels: 100 }); h.advance(250);
    if (i < 19) assert.equal(h.canvases.length, 0);
  }
  const copy = await settled(pending);
  assert.equal(copy.draws[0].source, h.source); assert.equal(copy.draws[0].at, 5000);
  assert.deepEqual(h.progress, [...countdown, capturing]); h.clean();
});

test('missing, stale and broken model state cannot veto the timed camera photo', async t => {
  const cases = {
    'automatic off': e => { e.automatic = false; },
    'warming up without a result': e => { e.autoReady = false; e.live = null; },
    'ready without a result': e => { e.live = null; },
    'not ready with an old result': e => { e.autoReady = false; },
    'detector failed': e => { e.autoError = 'Detector failed'; },
    'stale result': e => { e.live.capturedAt = -100000; },
    'invalid timestamp': e => { e.live.capturedAt = NaN; },
    'future timestamp': e => { e.live.capturedAt = 100000; },
    'missing mask': e => { e.live.mask = null; },
    'malformed mask': e => { e.live.mask = new Float32Array(1).fill(NaN); },
    'mismatched dimensions': e => { e.live.width++; e.live.frame.height++; },
    'processed frame': e => { e.live.frame = e.canvas; }
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const h = harness(t); change(h.engine);
    const pending = h.capture(); h.advance(4999);
    assert.equal(h.canvases.length, 0); h.advance(1);
    const copy = await settled(pending);
    assert.equal(copy.draws[0].source, h.source); assert.equal(copy.draws[0].at, 5000);
    assert.deepEqual(h.progress, [...countdown, capturing]); h.clean();
  });
});

test('a model lifecycle change during countdown does not invalidate the camera', async t => {
  const h = harness(t), pending = h.capture();
  h.advance(2000); h.engine.autoGeneration++;
  h.advance(1000);
  Object.assign(h.engine, { automatic: false, autoReady: false, autoError: 'Detector failed', live: null });
  h.advance(2000);
  const copy = await settled(pending);
  assert.equal(copy.draws[0].source, h.source); assert.equal(copy.draws[0].at, 5000); h.clean();
});

test('capture preserves the existing effect, background and dust state on success or cancellation', async t => {
  for (const effect of ['cinema', 'dust']) for (const cancel of [false, true]) {
    const h = harness(t), e = h.engine;
    const state = { effect, started: 123, background: h.canvas(), image: { meme: true }, imageVersion: 4,
      particles: [{ born: 42 }], dustVersion: 7, dustPending: true, plate: h.canvas(),
      held: h.canvas(), frozen: h.canvas(), tiles: [{ x: 4, y: 8 }], threshold: 32 };
    Object.assign(e, state);
    const pending = h.capture();
    if (cancel) { h.advance(2500); h.abort(); await assert.rejects(settled(pending), { name: 'AbortError' }); }
    else { h.advance(5000); const copy = await settled(pending); assert.notEqual(copy, state.background); }
    for (const [key, value] of Object.entries(state)) assert.equal(e[key], value, key);
    // Canvas stubs contain functions; compare their data separately to detect in-place mutation.
    for (const key of ['background', 'plate', 'held', 'frozen']) {
      assert.equal(e[key].width, 1920, key); assert.equal(e[key].height, 1080, key);
      assert.deepEqual(e[key].color, [12, 34, 56, 255], key); assert.deepEqual(e[key].draws, [], key);
    }
    assert.deepEqual(e.particles, [{ born: 42 }]); assert.deepEqual(e.tiles, [{ x: 4, y: 8 }]);
    assert.deepEqual(e.image, { meme: true }); h.clean();
  }
});

test('portrait copies preserve aspect ratio, stay within 960 pixels and never upscale', async t => {
  for (const [width, height, expectedWidth, expectedHeight] of [
    [1080, 1920, 540, 960], [240, 320, 240, 320], [1001, 2003, 480, 960], [1, 2000, 1, 960]
  ]) {
    const h = harness(t, width, height), pending = h.capture(); h.advance(5000);
    const copy = await settled(pending);
    assert.equal(copy.width, expectedWidth); assert.equal(copy.height, expectedHeight);
    assert.equal(copy.draws[0].source, h.source);
    assert.deepEqual(copy.draws[0].args, [0, 0, expectedWidth, expectedHeight]); h.clean();
  }
});

test('abort is immediate before capture, during countdown and inside the last progress callback', async t => {
  for (const when of ['before', 'countdown', 'just before capture', 'first progress', 'last countdown', 'capturing']) {
    await t.test(when, async t => {
      const h = harness(t); if (when === 'before') h.abort();
      const pending = h.capture(({ seconds }) => {
        if ((when === 'first progress' && seconds === 5) ||
            (when === 'last countdown' && seconds === 1) || (when === 'capturing' && seconds === 0)) h.abort();
      });
      if (when === 'countdown' || when === 'just before capture') {
        h.advance(when === 'countdown' ? 2250 : 4999); h.abort();
      } else if (when === 'last countdown' || when === 'capturing') h.advance(5000);
      await assert.rejects(settled(pending), { name: 'AbortError' }); h.clean();
      if (when === 'before') assert.equal(h.progress.length, 0);
      if (when === 'capturing') assert.deepEqual(h.progress, [...countdown, capturing]);
      const count = h.progress.length; h.advance(20000);
      assert.equal(h.canvases.length, 0); assert.equal(h.progress.length, count); h.clean();
    });
  }
});

test('camera changes and interruptions reject within the next 50 ms and release all listeners', async t => {
  const cases = {
    stop: h => h.engine.stop(),
    'engine width': h => { h.engine.canvas.width = 1280; },
    'engine height': h => { h.engine.canvas.height = 720; },
    'physical video width': h => { h.source.videoWidth = 1280; },
    'physical video height': h => { h.source.videoHeight = 720; },
    interrupted: h => { h.engine.sourceInterrupted = true; },
    disabled: h => { h.track.enabled = false; },
    muted: h => { h.track.muted = true; },
    ended: h => { h.track.readyState = 'ended'; },
    'paused video': h => { h.source.paused = true; },
    'ended video': h => { h.source.ended = true; },
    'video error': h => { h.source.error = { code: 2 }; },
    'missing video data': h => { h.source.readyState = 1; },
    'detached stream': h => { h.source.srcObject = null; },
    'replacement stream with the same track': h => { h.source.srcObject = { getVideoTracks: () => [...h.tracks] }; },
    'removed track': h => { h.tracks.splice(0); },
    'added track': h => { h.tracks.push(h.newTrack()); },
    'replacement track': h => { h.tracks[0] = h.newTrack(); },
    'replacement source': h => { h.engine.source = { ...h.source }; }
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const h = harness(t), pending = h.capture();
    h.advance(1250); change(h); h.advance(50);
    await assert.rejects(settled(pending), /Camera/); h.clean();
    const count = h.progress.length; h.advance(20000);
    assert.equal(h.canvases.length, 0); assert.equal(h.progress.length, count); h.clean();
  });
});

test('mute and ended events on any original track reject without waiting for a timer tick', async t => {
  for (const type of ['mute', 'ended']) for (const index of [0, 1]) {
    const h = harness(t); h.tracks.push(h.newTrack());
    const pending = h.capture(); h.advance(123);
    // The source can recover before polling; the interruption itself still cancels setup.
    h.tracks[index].dispatch(type);
    await assert.rejects(settled(pending), /Camera interrupted/); h.clean();
    h.advance(20000); assert.equal(h.canvases.length, 0); h.clean();
  }
});

test('an initially disabled black camera, unready video or invalid dimensions reject immediately', async t => {
  const cases = {
    disabled: h => { h.track.enabled = false; },
    muted: h => { h.track.muted = true; },
    ended: h => { h.track.readyState = 'ended'; },
    paused: h => { h.source.paused = true; },
    unready: h => { h.source.readyState = 1; },
    detached: h => { h.source.srcObject = null; },
    'no video track': h => { h.tracks.splice(0); },
    'missing source': h => { h.engine.source = null; },
    'zero video width': h => { h.source.videoWidth = 0; },
    'zero video height': h => { h.source.videoHeight = 0; },
    'zero engine width': h => { h.engine.canvas.width = 0; },
    'zero engine height': h => { h.engine.canvas.height = 0; }
  };
  for (const [name, change] of Object.entries(cases)) await t.test(name, async t => {
    const h = harness(t); h.source.color = [0, 0, 0, 255]; change(h);
    await assert.rejects(settled(h.capture()), /Camera/);
    assert.equal(h.progress.length, 0); assert.equal(h.canvases.length, 0); h.clean();
  });
});

test('progress exceptions at the start, middle and final tick propagate unchanged and clean up', async t => {
  for (const seconds of [5, 3, 0]) {
    const h = harness(t), failure = new Error('progress failed');
    const pending = h.capture(value => { if (value.seconds === seconds) throw failure; });
    h.advance((5 - seconds) * 1000);
    await assert.rejects(settled(pending), error => error === failure); h.clean();
    const count = h.progress.length; h.advance(20000);
    assert.equal(h.canvases.length, 0); assert.equal(h.progress.length, count); h.clean();
  }
});

test('a raw-frame copy exception propagates unchanged and releases the final timer and listeners', async t => {
  const h = harness(t), failure = new Error('copy failed'), pending = h.capture();
  h.advance(4999);
  Object.defineProperty(h.source, 'color', { get() { throw failure; } });
  h.advance(1);
  await assert.rejects(settled(pending), error => error === failure);
  assert.deepEqual(h.progress, [...countdown, capturing]);
  assert.equal(h.canvases.length, 1); assert.equal(h.canvases[0].draws.length, 0); h.clean();
  h.advance(20000); assert.equal(h.canvases.length, 1); assert.equal(h.progress.length, 6); h.clean();
});
