const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
require('../extension/engine.js');
require('../extension/background.js');

test('streaming room history learns only visible room and preserves current background changes', () => {
  const w = 32, h = 24, room = new MeetEffects.RoomEstimator(w, h);
  const rgba = new Uint8ClampedArray(w * h * 4), mask = new Uint8Array(w * h);
  const paint = color => { for (let i = 0; i < mask.length; i++) rgba.set(color, i * 4); };
  paint([20, 80, 140, 255]);
  room.update(rgba, mask); room.update(rgba, mask);
  for (let y = 8; y < 20; y++) for (let x = 10; x < 22; x++) {
    const i = y * w + x; mask[i] = 255; rgba.set([240, 20, 30, 255], i * 4);
  }
  for (let y = 0; y < h; y++) rgba.set([30, 190, 80, 255], y * w * 4);
  const result = room.update(rgba, mask);
  assert.deepEqual([...result.pixels.slice((12 * w + 15) * 4, (12 * w + 15) * 4 + 4)], [20, 80, 140, 255]);
  assert.deepEqual([...result.pixels.slice(0, 4)], [30, 190, 80, 255]);
  assert.equal(room.clearAge[12 * w + 15], 0);
  assert.equal(room.hidden[12 * w + 9], 1);
});

test('unseen hidden region updates from current room without learning the person', () => {
  const w = 20, h = 12, room = new MeetEffects.RoomEstimator(w, h);
  const rgba = new Uint8ClampedArray(w * h * 4), mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = i % w >= 7 && i % w < 13 ? 255 : 0;
  const update = color => {
    for (let i = 0; i < mask.length; i++) rgba.set(mask[i] ? [255, 0, 0, 255] : color, i * 4);
    return [...room.update(rgba, mask).pixels.slice((6 * w + 10) * 4, (6 * w + 10) * 4 + 4)];
  };
  assert.deepEqual(update([20, 80, 140, 255]), [20, 80, 140, 255]);
  assert.deepEqual(update([30, 150, 110, 255]), [30, 150, 110, 255]);
  assert.equal(room.seen[6 * w + 10], 0);
});

function harness() {
  const timers = new Map(); let id = 0, active = 0, maximum = 0;
  const jobs = [];
  const canvas = () => ({ width: 64, height: 36, getContext() { return {
    drawImage() {}, fillRect() {}, clearRect() {}, putImageData() {}, getImageData: (x, y, w, h) => ({ data: new Uint8ClampedArray(w * h * 4) })
  }; } });
  const images = [];
  const context = { document: { createElement: canvas }, performance, AbortController, DOMException, atob,
    Image: class {
      constructor() { this.naturalWidth = 1920; this.naturalHeight = 1080; images.push(this); }
      async decode() { if (this.fail) throw new Error('Invalid image'); }
    },
    ImageData: class { constructor(data, width, height) { Object.assign(this, { data, width, height }); } },
    setTimeout(fn) { timers.set(++id, fn); return id; }, clearTimeout(i) { timers.delete(i); },
    setInterval(fn) { timers.set(++id, fn); return id; }, clearInterval(i) { timers.delete(i); } };
  vm.createContext(context);
  for (const file of ['engine.js', 'background.js']) vm.runInContext(fs.readFileSync(require.resolve('../extension/' + file), 'utf8'), context);
  context.MeetEffects.segmentFrame = (c, { signal }) => new Promise((resolve, reject) => {
    active++; maximum = Math.max(maximum, active);
    jobs.push({ signal, resolve(value = 0) { active--; resolve({ width: c.width, height: c.height, mask: new Uint8Array(c.width * c.height).fill(value) }); },
      reject() { active--; reject(new Error('synthetic failure')); } });
  });
  const tick = () => { const entry = timers.entries().next().value; if (entry) { timers.delete(entry[0]); entry[1](); } };
  const flush = async () => { for (let i = 0; i < 5; i++) await Promise.resolve(); };
  return { context, jobs, timers, canvas, images, tick, flush, maximum: () => maximum };
}

test('warm mask is retained, warm trigger is immediate, reset cannot be undone by old inference', async () => {
  const h = harness(); let changes = 0;
  const e = new h.context.MeetEffects.Engine(h.canvas(), h.canvas(), () => changes++);
  e.setBackground(h.canvas());
  e.enableAutomatic(); h.tick(); assert.equal(h.jobs.length, 1);
  h.jobs[0].resolve(); await h.flush(); assert.equal(e.autoReady, true); assert.equal(e.liveStats.updates, 1);
  await e.trigger('dust'); assert.equal(e.dustPending, false); assert.equal(e.held, null);
  h.tick(); e.reset(); h.jobs[1].resolve(); await h.flush();
  assert.equal(e.effect, 'none'); assert.equal(e.held, null); assert.equal(e.dustPending, false);
  const before = changes; h.tick(); h.jobs[2].resolve(); await h.flush();
  assert.equal(changes, before, 'healthy processed frames must not flood status callbacks');
  assert.equal(h.maximum(), 1);
  e.stop(); assert.equal(h.timers.size, 0); assert.equal(e.live, null); assert.equal(e.room, null);
});

test('stop aborts the only inference and ignores even a noncooperative late result', async () => {
  const h = harness(), e = new h.context.MeetEffects.Engine(h.canvas(), h.canvas());
  e.setBackground(h.canvas());
  e.enableAutomatic(); h.tick(); const pending = e.trigger('dust');
  e.stop(); assert.equal(h.jobs[0].signal.aborted, true); await pending;
  h.jobs[0].resolve(); await h.flush();
  assert.equal(e.live, null); assert.equal(e.autoReady, false); assert.equal(h.timers.size, 0);
});

test('two engines skip busy ticks without superseding or queuing requests', async () => {
  const h = harness(), a = new h.context.MeetEffects.Engine(h.canvas(), h.canvas()), b = new h.context.MeetEffects.Engine(h.canvas(), h.canvas());
  a.enableAutomatic(); b.enableAutomatic(); h.tick(); h.tick();
  assert.equal(h.jobs.length, 1); h.jobs[0].resolve(); await h.flush();
  h.tick(); assert.equal(h.jobs.length, 2); assert.equal(h.maximum(), 1);
  a.stop(); b.stop(); h.jobs[1].resolve(); await h.flush(); assert.equal(h.timers.size, 0);
});

test('missing photo rejects dust before any effect state changes; tracking warms even with a full-frame person', async () => {
  const h = harness(), e = new h.context.MeetEffects.Engine(h.canvas(), h.canvas());
  e.enableAutomatic(); e.trigger('cinema', 123); h.tick();
  h.jobs[0].resolve(255); await h.flush();
  assert.equal(e.autoReady, true); assert.equal(e.autoError, '');
  const version = e.dustVersion;
  await assert.rejects(e.trigger('dust', 456), { message: 'Take a room photo first.' });
  assert.equal(e.effect, 'cinema'); assert.equal(e.started, 123);
  assert.equal(e.dustVersion, version); assert.equal(e.dustPending, false);
  const photo = h.canvas(); e.setBackground(photo);
  assert.equal(e.effect, 'cinema'); assert.equal(e.started, 123);
  assert.equal(e.dustVersion, version); assert.equal(e.background, photo);
  await e.trigger('dust', 456); assert.equal(e.effect, 'dust'); assert.equal(e.held, null);
  const dustVersion = e.dustVersion; e.particles.push({ born: 456 });
  e.setBackground(photo);
  assert.equal(e.effect, 'dust'); assert.equal(e.started, 456); assert.equal(e.dustVersion, dustVersion);
  assert.equal(e.particles.length, 1, 'installing a photo does not restart erosion or clear its particles');
  e.reset(); assert.equal(e.background, photo);
  e.resize(128, 72); assert.equal(e.background, photo);
  e.stop(); assert.equal(e.background, null);
  assert.equal(photo.width, 64); assert.equal(photo.height, 36);
});

test('a photo shared by two engines survives one engine resizing, resetting, and stopping', () => {
  const h = harness(), photo = h.canvas(); let changes = 0;
  const a = new h.context.MeetEffects.Engine(h.canvas(), h.canvas(), () => changes++);
  const b = new h.context.MeetEffects.Engine(h.canvas(), h.canvas());
  a.setBackground(photo); b.setBackground(photo); assert.equal(changes, 1);
  a.resize(128, 72); a.reset(); a.stop();
  assert.equal(b.background, photo); assert.equal(photo.width, 64); assert.equal(photo.height, 36);
  b.stop();
});

test('photo dust holds processed output on failure and reset prevents a recovery from restoring dust', async () => {
  const h = harness(), e = new h.context.MeetEffects.Engine(h.canvas(), h.canvas()), photo = h.canvas();
  e.setBackground(photo); e.enableAutomatic(); h.tick(); h.jobs[0].resolve(255); await h.flush();
  await e.trigger('dust', 123); h.tick(); h.jobs[1].reject(); await h.flush();
  assert.equal(e.effect, 'dust'); assert.equal(e.started, 123); assert.ok(e.held);
  assert.equal(e.autoReady, false); assert.equal(e.autoError, 'synthetic failure'); assert.equal(e.background, photo);
  h.tick(); e.reset(); h.jobs[2].resolve(255); await h.flush();
  assert.equal(e.effect, 'none'); assert.equal(e.held, null); assert.equal(e.autoReady, true);
  assert.equal(e.background, photo); e.stop(); assert.equal(h.timers.size, 0);
});

test('photo decode validates type, encoding and exact byte limit before image decode', async () => {
  const h = harness(), decode = h.context.MeetEffects.decodeBackground;
  const invalid = [null, '', 'https://example.com/photo.png', 'data:image/gif;base64,R0lGODlh',
    'data:image/png;base64,R0lGODlh', 'data:image/svg+xml;base64,PHN2Zz4=',
    'data:image/png;base64,AA=A', 'data:image/png;base64,abc', 'data:image/png;base64,%%%%',
    'data:image/png;base64,' + 'A'.repeat(4 * Math.ceil(5 * 1024 * 1024 / 3) + 4)];
  for (const value of invalid) await assert.rejects(decode(value), /PNG, JPEG or WebP/);
  assert.equal(h.images.length, 0);
  const bytes = Buffer.alloc(5 * 1024 * 1024 + 1); bytes.set(Buffer.from('89504e470d0a1a0a', 'hex'));
  await assert.rejects(decode('data:image/png;base64,' + bytes.toString('base64')), /5 MiB/);
  assert.equal(h.images.length, 0);
  const exact = await decode('data:image/png;base64,' + bytes.subarray(0, -1).toString('base64'));
  assert.equal(exact.width, 960); assert.equal(exact.height, 540);
});

test('photo decode bounds dimensions, keeps aspect, accepts supported signatures and rejects failed decoding', async () => {
  const h = harness(), decode = h.context.MeetEffects.decodeBackground;
  const url = (type, bytes) => 'data:image/' + type + ';base64,' + Buffer.from(bytes).toString('base64');
  const png = url('png', [137, 80, 78, 71, 13, 10, 26, 10]);
  for (const data of [png, url('jpeg', [255, 216, 255]), url('webp', 'RIFF0000WEBP')]) {
    const image = await decode(data); assert.equal(image.width, 960); assert.equal(image.height, 540);
  }
  let pending = decode(png); Object.assign(h.images.at(-1), { naturalWidth: 4001, naturalHeight: 4000 });
  await assert.rejects(pending, /16 megapixels/);
  pending = decode(png); Object.assign(h.images.at(-1), { naturalWidth: 4000, naturalHeight: 4000 });
  const limit = await pending; assert.equal(limit.width, 960); assert.equal(limit.height, 960);
  pending = decode(png); Object.assign(h.images.at(-1), { naturalWidth: 320, naturalHeight: 640 });
  const small = await pending; assert.equal(small.width, 320); assert.equal(small.height, 640);
  h.context.Image.prototype.decode = async () => { throw new Error('broken decoder'); };
  await assert.rejects(decode(png), /Could not decode/);
});

test('dust erosion follows a translated silhouette without erased regions reappearing', () => {
  const h = harness(), e = new h.context.MeetEffects.Engine(h.canvas(), h.canvas());
  const original = { left: 48, top: 12, span: 100, heightSpan: 120 };
  for (let y = 12; y < 132; y += 3) for (let x = 48; x < 148; x += 3) {
    for (const t of [0.5, 0.9, 1.3, 1.7, 2.1]) {
      const before = e.dustAmount(x, y, t, original);
      const translated = e.dustAmount(x + 4, y + 2, t + 1 / 24,
        { ...original, left: original.left + 4, top: original.top + 2 });
      assert.ok(translated + 1e-8 >= before, 'moving 10 output pixels cannot undo erosion');
    }
  }
});

test('dust births cover the whole body, remain bounded and do not depend on inference cadence', () => {
  const run = hz => {
    const h = harness(), e = new h.context.MeetEffects.Engine(h.canvas(), h.canvas());
    const w = 256, height = 144;
    const mask = new Uint8Array(w * height), rgba = new Uint8ClampedArray(w * height * 4);
    for (let y = 12; y <= 132; y++) for (let x = 48; x <= 148; x++) {
      mask[y * w + x] = 255; rgba.set([220, 90, 30, 255], (y * w + x) * 4);
    }
    e.started = 0; e.cancelDust();
    e.live = { mask, rgba, width: w, height, left: 48, top: 12, span: 100, heightSpan: 120 };
    const count = [], bins = [0, 0, 0, 0]; let total = 0, lastBorn = -1, gap = 0;
    for (let frame = 0; frame <= 150; frame++) {
      const now = frame * 1000 / 30;
      e.liveStats.updates = Math.floor(now * hz / 1000);
      e.emitDust(now);
      assert.ok(e.particles.length <= 3200);
      for (const p of e.particles) if (p.born > lastBorn) {
        bins[Math.min(3, Math.floor((p.y * height - 12) / 30))]++; total++;
      }
      const newest = e.particles.reduce((n, p) => Math.max(n, p.born), lastBorn);
      if (now > 700 && now < 2000) gap = Math.max(gap, now - newest);
      lastBorn = newest; count.push(e.particles.length);
    }
    assert.ok(total > 3000, `Expected a sustained plume, got ${total} grains`);
    for (const bin of bins) assert.ok(bin > total * 0.18 && bin < total * 0.32, `Uneven full-body dust: ${bins}`);
    assert.ok(gap < 75, `Visible emission gap: ${gap} ms`);
    assert.equal(e.particles.length, 0, 'grains expire completely');
    return count;
  };
  assert.deepEqual(run(15), run(24));
});

test('one-pixel outline changes cannot flicker a stationary torso back into view', () => {
  const h = harness(), e = new h.context.MeetEffects.Engine(h.canvas(), h.canvas());
  const initial = { left: 60, span: 120, top: 40, heightSpan: 103 };
  // The concrete review reproduction changed alpha from 194 to 62 previously.
  const before = e.dustAmount(93, 73, 1.9, initial);
  const after = e.dustAmount(93, 73, 1.9 + 1 / 24, { ...initial, top: 39, heightSpan: 104 });
  assert.ok(after >= before);
  for (const changed of [
    {...initial, left:59,span:121}, {...initial,left:61,span:119},
    {...initial,span:121}, {...initial,top:41,heightSpan:102}, {...initial,heightSpan:104}
  ]) {
    e.cancelDust();
    for (let i=0;i<48;i++) {
      const x=75+i%12*7, y=55+Math.floor(i/12)*17, t=0.6+(i%12)*0.13;
      const a=e.dustAmount(x,y,t,initial), b=e.dustAmount(x,y,t+1/30,changed);
      assert.ok(b>=a, 'bounded silhouette jitter must not reverse disappearance');
    }
  }
  e.reset(); assert.equal(e.dustAnchor,null); assert.equal(e.anchorFrame,null);
});


test('rendered erosion is monotonic under mask jitter and clears history when the person leaves', () => {
  const h = harness(), e = new h.context.MeetEffects.Engine(h.canvas(), h.canvas());
  const w=256, height=144, mask=new Uint8Array(w*height).fill(255), hidden=new Uint8Array(w*height).fill(1);
  const live={width:w,height,mask,hidden,frame:h.canvas(),rgba:new Uint8ClampedArray(w*height*4),
    left:60,span:120,top:40,heightSpan:103};
  e.setBackground(h.canvas()); e.cancelDust(); e.started=0; e.live=live;
  const alpha=()=>e.erosionImage.data[(73*2*w*2+93*2)*4+3];
  e.renderLiveDust(1900); let previous=alpha(); assert.ok(previous>0);
  for(let i=1;i<=6;i++) {
    e.live={...live,left:60+(i%2?-2:2),top:40+(i%2?-2:2)};
    e.renderLiveDust(1900+i*1000/30); assert.ok(alpha()>=previous); previous=alpha();
  }
  e.live={...live,mask:new Uint8Array(w*height),hidden:new Uint8Array(w*height)};
  e.renderLiveDust(2200); assert.equal(alpha(),0,'no lingering silhouette when room is visible');
  e.live=live; e.renderLiveDust(2300); assert.ok(alpha()>0);
  e.reset(); assert.ok(e.erosionImage.data.every(v=>v===0),'new triggers cannot inherit previous erosion');
  assert.equal(e.preparedLive,null,'reset invalidates the previous decorative coordinate cache');
  e.started=2350; e.renderLiveDust(2350); assert.equal(alpha(),0,'a fresh transition starts intact even with the same matched frame');
  e.stop(); assert.equal(e.erosionImage,null); assert.equal(e.contour,null);
});
