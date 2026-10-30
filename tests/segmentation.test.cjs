const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const source = fs.readFileSync(path.join(__dirname, '../extension/segment-client.js'), 'utf8');

function client() {
  const listeners = new Map(), sent = [], timers = new Map(); let timerId = 0;
  const window = { postMessage(data, origin, transfer) { sent.push(structuredClone(data, { transfer })); } };
  const context = { window, location: { origin: 'https://meet.google.com' }, MeetEffects: {},
    crypto: { randomUUID: () => 'test-client' }, DOMException, Uint8Array, ArrayBuffer,
    setTimeout(fn) { timers.set(++timerId, fn); return timerId; }, clearTimeout(id) { timers.delete(id); },
    addEventListener(type, fn) { listeners.set(type, fn); } };
  vm.runInNewContext(source, context);
  const canvas = { width: 2, height: 3, getContext: () => ({ getImageData: () => ({ data: new Uint8ClampedArray(24) }) }) };
  const respond = (request, values = new Uint8Array(6)) => listeners.get('message')({ source: window, origin: context.location.origin,
    data: { ...request, type: 'result', mask: values.buffer } });
  return { ...context, sent, timers, canvas, respond, events: listeners };
}

test('missing host times out, releases pending state, sends cancellation, and permits retry', async () => {
  const c = client();
  const pending = c.MeetEffects.segmentFrame(c.canvas);
  const failure = assert.rejects(pending, { name: 'TimeoutError' });
  [...c.timers.values()][0](); await failure;
  assert.equal(c.timers.size, 0); assert.equal(c.sent.at(-1).type, 'cancel');
  const retried = c.MeetEffects.segmentFrame(c.canvas); c.respond(c.sent.at(-1));
  assert.equal((await retried).mask.length, 6);
});

test('superseded and malformed responses cannot settle a current request', async () => {
  const c = client();
  const old = c.MeetEffects.segmentFrame(c.canvas); const oldRequest = c.sent.at(-1);
  const oldFailure = assert.rejects(old, { name: 'AbortError' });
  const latest = c.MeetEffects.segmentFrame(c.canvas); const latestRequest = c.sent.at(-1);
  c.respond(oldRequest); assert.equal(c.timers.size, 1);
  const invalid = assert.rejects(latest, { name: 'DataError' });
  c.respond(latestRequest, new Uint8Array(5));
  await oldFailure; await invalid; assert.equal(c.timers.size, 0);
});

test('abort and page lifecycle cancel, clear timers, and restore a usable client', async () => {
  const c = client(), controller = new AbortController();
  const request = c.MeetEffects.segmentFrame(c.canvas, { signal: controller.signal });
  const aborted = assert.rejects(request, { name: 'AbortError' });
  controller.abort(); await aborted; assert.equal(c.timers.size, 0);
  const exiting = c.MeetEffects.segmentFrame(c.canvas);
  const exited = assert.rejects(exiting, { name: 'AbortError' });
  c.events.get('pagehide')(); await exited;
  await assert.rejects(c.MeetEffects.segmentFrame(c.canvas), { name: 'AbortError' });
  c.events.get('pageshow')();
  const restored = c.MeetEffects.segmentFrame(c.canvas); c.respond(c.sent.at(-1));
  assert.equal((await restored).height, 3); assert.equal(c.timers.size, 0);
});

function relay(sendMessage) {
  const events=new Map(),sent=[],window={postMessage(data){sent.push(data);}};
  const context={window,location:{origin:'https://meet.google.com',protocol:'https:'},chrome:{runtime:{id:'test',sendMessage}},
    ArrayBuffer,Uint8Array,btoa,atob,addEventListener(type,fn){events.set(type,fn);}};
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/segment-host.js'),'utf8'),context);
  const dispatch=type=>events.get('message')({source:window,origin:context.location.origin,data:{channel:'meeteffects-segment-v1',client:'test',id:1,type,width:2,height:2,pixels:new ArrayBuffer(16),deadline:Date.now()+5000}});
  return {events,sent,dispatch};
}
test('invalidated extension gives a specific Meet refresh instruction',()=>{
  const r=relay(()=>{throw new Error('Extension context invalidated.');});r.dispatch('frame');
  assert.match(r.sent[0].error,/Refresh this Meet tab/);
});
test('cancelling an in-flight frame after extension reload does not throw',async()=>{
  let complete;
  const r=relay(message=>{if(message.type.endsWith('-cancel'))throw new Error('Extension context invalidated.');return new Promise(resolve=>{complete=resolve;});});
  r.dispatch('frame');assert.doesNotThrow(()=>r.dispatch('cancel'));complete(null);await Promise.resolve();
  assert.equal(r.sent.length,0);
});
