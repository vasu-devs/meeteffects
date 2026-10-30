const { test } = require('node:test');
const assert = require('node:assert/strict');
require('../extension/engine.js');
require('../extension/snap.js');
const { dustTiles, SnapGate, waitForMedia } = globalThis.MeetEffects;

test('dust leaves an unchanged room untouched and detects foreground blocks', () => {
  const room = new Uint8ClampedArray(16 * 16 * 4).fill(80);
  assert.deepEqual(dustTiles(room, room, 16, 16), []);
  const frame = room.slice();
  for (let y = 4; y < 12; y++) for (let x = 4; x < 12; x++) {
    const i = (y * 16 + x) * 4; frame[i] = 240; frame[i + 1] = 180;
  }
  const tiles = dustTiles(frame, room, 16, 16);
  assert.equal(tiles.length, 4);
  assert.ok(tiles.every(t => t.x >= 4 && t.x < 12 && t.y >= 4 && t.y < 12));
});
test('dust ignores small sensor noise and handles image edges', () => {
  const room = new Uint8ClampedArray(17 * 13 * 4).fill(80);
  const noise = new Uint8ClampedArray(room.length).fill(90);
  assert.equal(dustTiles(noise, room, 17, 13).length, 0);
  const subject = new Uint8ClampedArray(room.length).fill(240);
  const tiles = dustTiles(subject, room, 17, 13);
  assert.ok(tiles.length > 0);
  assert.ok(tiles.every(t => t.x + t.w <= 17 && t.y + t.h <= 13));
});
test('snap gate rejects steady sound, requires treble and respects cooldown', () => {
  const gate = new SnapGate();
  for (let i = 0; i < 35; i++) assert.equal(gate.update(0.004, 0.1, i * 16), false);
  assert.equal(gate.update(0.2, 0.1, 600), false, 'bass transient is not a snap');
  gate.update(0.004, 0.1, 620);
  assert.equal(gate.update(0.2, 0.5, 650), true);
  gate.update(0.004, 0.1, 670);
  assert.equal(gate.update(0.2, 0.5, 1000), false);
  for (let i = 0; i < 40; i++) gate.update(0.004, 0.1, 2000 + i * 16);
  assert.equal(gate.update(0.2, 0.5, 5000), true);
});
test('extension only injects on Google Meet and requests no privileged APIs', () => {
  const manifest = require('../extension/manifest.json');
  assert.equal(manifest.manifest_version, 3);
  assert.equal(manifest.permissions, undefined);
  assert.ok(manifest.content_scripts.every(s => s.matches.join() === 'https://meet.google.com/*'));
  const hook = manifest.content_scripts.find(s => s.js.includes('bridge.js'));
  assert.equal(hook.world, 'MAIN'); assert.equal(hook.run_at, 'document_start');
});
test('media startup can be aborted without resolving its pending promise', async () => {
  const controller=new AbortController();
  const startup=waitForMedia(new Promise(()=>{}),controller.signal,1000);
  controller.abort();await assert.rejects(startup,{name:'AbortError'});
});
test('a stalled media startup times out', async () => {
  await assert.rejects(waitForMedia(new Promise(()=>{}),undefined,15),/timed out/);
});
test('snap gate accepts a quieter onset without a rejected partial onset poisoning it', () => {
  const gate = new SnapGate();
  for (let now=0;now<600;now+=16) gate.update(0.004,0.1,now,0.008,0.004);
  assert.equal(gate.update(0.015,0.7,610,0.04,0.004),false);
  assert.equal(gate.update(0.035,0.7,626,0.10,0.004),true);
  assert.equal(gate.update(0.08,0.7,642,0.20,0.004),false,'overlapping history must not retrigger');
});
test('short-window features preserve a quiet 2ms transient in a 43ms history', () => {
  const wave=new Float32Array(2048),spectrum=new Float32Array(1024).fill(-100);
  for(let i=600;i<696;i++)wave[i]=i%2?0.08:-0.08;
  spectrum[250]=-20;
  const f=MeetEffects.snapFeatures(wave,spectrum,48000);
  assert.ok(f.rms>0.05&&f.peak>0.079&&f.highRatio>0.9);
  assert.equal(f.background,0,'brief snap must not raise the estimated room noise');
});
