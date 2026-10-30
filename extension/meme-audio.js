(() => {
  'use strict';

  // One hook set per realm, shared by the bridge and isolated test controllers.
  // Membership comes only from noteMicrophone (and native clones), never labels,
  // device IDs, remote tracks, or getDisplayMedia.
  const clients = new Set(), senders = new WeakMap(), peers = new WeakMap(), observed = new Set();
  let unhook = null, nativeReplace;
  function installHooks() {
    if (unhook) return;
    const restore = [];
    function method(proto, key, wrap) {
      const descriptor = Object.getOwnPropertyDescriptor(proto, key);
      if (!descriptor?.value) return;
      const value = wrap(descriptor.value);
      Object.defineProperty(proto, key, { ...descriptor, value });
      restore.push(() => {
        if (proto[key] === value) Object.defineProperty(proto, key, descriptor);
      });
    }
    function record(pc, sender) {
      let entry = senders.get(sender);
      if (!entry) {
        entry = { pc, sender };
        entry.ref = new WeakRef(entry); observed.add(entry.ref); senders.set(sender, entry);
      }
      if (pc) {
        entry.pc = pc;
        let set = peers.get(pc);
        if (!set) { set = new Set(); peers.set(pc, set); }
        set.add(entry);
      }
      for (const client of clients) client.observe(entry);
      return entry;
    }
    function before(entry, replacement, closed = false) {
      if (entry) for (const client of clients) client.detach(entry, replacement, closed);
    }
    const pc = globalThis.RTCPeerConnection?.prototype, sender = globalThis.RTCRtpSender?.prototype;
    if (pc && sender) {
      nativeReplace = sender.replaceTrack;
      method(pc, 'addTrack', original => function (...args) {
        const result = original.apply(this, args);
        if (result.track?.kind === 'audio') record(this, result);
        return result;
      });
      method(pc, 'addTransceiver', original => function (...args) {
        const result = original.apply(this, args);
        if (args[0] === 'audio' || args[0]?.kind === 'audio') record(this, result.sender);
        return result;
      });
      // Includes senders created by a remote description, before replaceTrack.
      method(pc, 'getSenders', original => function (...args) {
        const result = original.apply(this, args);
        for (const item of result) if (!item.track || item.track.kind === 'audio') record(this, item);
        return result;
      });
      method(pc, 'getTransceivers', original => function (...args) {
        const result = original.apply(this, args);
        for (const item of result) if (item.receiver.track.kind === 'audio') record(this, item.sender);
        return result;
      });
      method(sender, 'replaceTrack', original => function (...args) {
        const entry = senders.get(this);
        // Restoration is enqueued before the application's replacement, on the
        // native peer-connection operations chain. Never overwrite its new mic.
        before(entry, entry?.sender.track);
        const result = original.apply(this, args);
        return result.then(value => {
          if (args[0]?.kind === 'audio' || entry) record(entry?.pc, this);
          return value;
        });
      });
      method(pc, 'removeTrack', original => function (...args) {
        const result = original.apply(this, args);
        before(senders.get(args[0]), null);
        return result;
      });
      method(pc, 'close', original => function (...args) {
        const result = original.apply(this, args);
        for (const entry of peers.get(this) || []) {
          before(entry, null, true); observed.delete(entry.ref);
        }
        peers.delete(this);
        return result;
      });
    }
    const track = globalThis.MediaStreamTrack?.prototype;
    if (track) {
      method(track, 'stop', original => function (...args) {
        const result = original.apply(this, args);
        for (const client of clients) client.changed(this);
        return result;
      });
      method(track, 'clone', original => function (...args) {
        const result = original.apply(this, args);
        for (const client of clients) if (client.knows(this)) client.noteMicrophone(result);
        return result;
      });
      const enabled = Object.getOwnPropertyDescriptor(track, 'enabled');
      if (enabled?.get && enabled?.set && enabled.configurable) {
        const set = function (value) {
          enabled.set.call(this, value);
          for (const client of clients) client.changed(this);
        };
        Object.defineProperty(track, 'enabled', { ...enabled, set });
        restore.push(() => {
          if (Object.getOwnPropertyDescriptor(track, 'enabled')?.set === set) Object.defineProperty(track, 'enabled', enabled);
        });
      }
      method(MediaStream.prototype, 'clone', original => function (...args) {
        if (!this.getAudioTracks().some(t => [...clients].some(c => c.knows(t)))) return original.apply(this, args);
        // Native stream.clone does not call the JS track.clone hook. Preserve
        // independent native track clones, including the bridge's video clones.
        return new MediaStream(this.getTracks().map(t => t.clone()));
      });
    }
    unhook = () => { restore.reverse().forEach(fn => fn()); observed.clear(); unhook = null; };
  }

  const cancelled = () => new DOMException('Sound cancelled.', 'AbortError');
  function bounded(promise, signal, timeout = 4000) {
    return new Promise((resolve, reject) => {
      let timer;
      const finish = (fn, value) => { clearTimeout(timer); signal.removeEventListener('abort', abort); fn(value); };
      const abort = () => finish(reject, cancelled());
      signal.addEventListener('abort', abort, { once: true });
      timer = setTimeout(() => finish(reject, new Error('Audio did not start. Turn sounds off and on to retry.')), timeout);
      Promise.resolve(promise).then(value => finish(resolve, value), error => finish(reject, error));
      if (signal.aborted) abort();
    });
  }
  function audioBytes(data) {
    if (typeof data !== 'string' || !/^data:audio\//i.test(data)) throw new Error('This meme has no local sound.');
    const comma = data.indexOf(',');
    if (comma < 0) throw new Error('Invalid local sound.');
    const text = /;base64$/i.test(data.slice(0, comma)) ? atob(data.slice(comma + 1)) : decodeURIComponent(data.slice(comma + 1));
    return Uint8Array.from(text, c => c.charCodeAt(0)).buffer;
  }

  function createSound(preview, onChange = () => {}) {
    const known = new WeakSet(), ended = new WeakSet(), listeners = new Map(), entries = new Set(), mixes = new Set();
    let enabled = false, disposed = false, disposal = null, error = '', context = null, startup = null;
    let version = 0, cueVersion = 0, startAbort = null, cueAbort = null, cue = null, watch = null, syncingEnabled = false;
    const live = track => track?.readyState === 'live' && !ended.has(track);
    const audible = track => live(track) && track.enabled && !track.muted;
    const eligible = entry => entry.pc?.signalingState !== 'closed' && known.has(entry.sender.track) && audible(entry.sender.track);
    function getState() {
      return { enabled, connected: enabled && context?.state === 'running' &&
        (preview || [...entries].some(eligible) || [...mixes].some(m => audible(m.raw))), error };
    }
    function notify() { try { onChange(getState()); } catch { /* UI must not break a native media operation. */ } }
    function closeContext() {
      if (mixes.size || !context) return;
      const old = context; context = null; startup = null;
      old.onstatechange = null;
      void old.close().catch(() => {});
    }
    function destroy(mix) {
      if (mix.destroyed) return;
      mix.destroyed = true; mixes.delete(mix);
      mix.source.disconnect(); mix.destination.disconnect(); mix.track.stop();
    }
    function silenceOutput(mix) {
      syncingEnabled = true;
      try { mix.track.enabled = false; } finally { syncingEnabled = false; }
    }
    function release(mix, target = mix.raw, closed = false) {
      if (mix.releasing) {
        // removeTrack/explicit output.stop can arrive after a raw restoration
        // was queued. Queue null last so the earlier restore cannot resurrect it.
        if (closed) destroy(mix);
        else if (target === null && mix.restoreTarget !== null) {
          mix.restoreTarget = null;
          return nativeReplace.call(mix.entry.sender, null).catch(failure => {
            error = `Microphone could not disconnect: ${failure.message}`; notify();
          });
        }
        return mix.releasing;
      }
      mix.restoreTarget = target;
      if (!audible(mix.raw)) silenceOutput(mix);
      let restoring;
      try {
        // install may still be on the native operations queue when reset occurs.
        restoring = !closed && (mix.installing || mix.entry.sender.track === mix.track)
          ? nativeReplace.call(mix.entry.sender, target) : Promise.resolve();
      } catch (failure) { restoring = Promise.reject(failure); }
      mix.releasing = restoring.then(() => destroy(mix), failure => {
        if (closed || mix.entry.pc?.signalingState === 'closed' || mix.entry.sender.track !== mix.track) destroy(mix);
        else {
          // Keep the mic-only graph alive if a live sender rejects restoration.
          // Stopping its track here would silently remove the user's microphone.
          mix.releasing = null;
          error = `Original microphone could not reconnect: ${failure.message}`;
        }
      }).then(() => { if (!enabled || !entries.size) closeContext(); cleanupDisposed(); notify(); });
      return mix.releasing;
    }
    function stopCue() {
      cueVersion++; cueAbort?.abort(); cueAbort = null;
      clearInterval(watch); watch = null;
      if (cue) {
        const old = cue; cue = null; old.onended = null;
        try { old.stop(); } catch { /* Already ended. */ }
        old.disconnect();
      }
      return Promise.all([...mixes].map(mix => release(mix)));
    }
    async function fail(failure, stamp) {
      if (disposed || stamp !== version) return;
      error = `Meme sounds unavailable: ${failure.message || failure}`;
      enabled = false; const failedVersion = ++version; startAbort?.abort();
      await stopCue();
      if (!enabled && version === failedVersion) closeContext();
      notify();
    }
    function ensureContext() {
      if (context?.state === 'running') return Promise.resolve(context);
      if (startup) return startup;
      const stamp = version, abort = startAbort = new AbortController();
      try {
        const current = context ||= new AudioContext();
        // resume is invoked synchronously from setEnabled's user gesture.
        startup = bounded(current.resume(), abort.signal).then(() => {
          if (disposed || !enabled || stamp !== version || current !== context) throw cancelled();
          if (current.state !== 'running') throw new Error('Audio is suspended. Turn sounds off and on to retry.');
          current.onstatechange = () => {
            if (current === context && enabled && current.state !== 'running') {
              void fail(new Error('Audio was interrupted; the original microphone is being restored.'), version);
            }
          };
          return current;
        }).finally(() => { if (current === context) startup = null; });
        return startup;
      } catch (failure) { return Promise.reject(failure); }
    }
    async function setEnabled(value) {
      if (disposed) return getState();
      if (!value) {
        enabled = false; version++; startAbort?.abort(); error = '';
        const stamp = version, stopped = stopCue();
        if (!mixes.size) closeContext();
        notify(); await stopped;
        if (stamp === version && !enabled) closeContext();
        notify();
        return getState();
      }
      if (!enabled) version++;
      enabled = true; error = ''; const stamp = version;
      try { await ensureContext(); notify(); }
      catch (failure) { if (failure.name !== 'AbortError') await fail(failure, stamp); }
      return getState();
    }
    function changed(track) {
      const output = [...mixes].find(mix => mix.track === track);
      if (output) {
        if (syncingEnabled) return;
        if (track.readyState === 'ended') { detach(output.entry, null, false); return; }
        // An application may mute sender.track rather than its original GUM
        // track. Carry that intent back before restoring the borrowed microphone.
        if (output.raw.enabled !== track.enabled) output.raw.enabled = track.enabled;
        return;
      }
      if (!known.has(track)) return;
      if (!live(track)) for (const entry of entries) {
        if (entry.sender.track === track || [...mixes].some(mix => mix.entry === entry && mix.raw === track)) entries.delete(entry);
      }
      if (!audible(track)) {
        // enabled has no DOM event; the native setter and stop hooks cover it.
        for (const mix of mixes) if (mix.raw === track && mix.track.enabled) silenceOutput(mix);
        void stopCue();
      }
      if (!live(track)) {
        const cleanup = listeners.get(track); cleanup?.(); listeners.delete(track);
        if (!entries.size) closeContext();
      }
      notify();
    }
    function observe(entry) {
      if (disposed) return;
      if (known.has(entry.sender.track)) entries.add(entry);
      else if (![...mixes].some(m => m.entry === entry)) entries.delete(entry);
      notify();
    }
    function detach(entry, replacement, closed) {
      if (!entries.has(entry) && ![...mixes].some(m => m.entry === entry)) return;
      // Stop the shared cue before releasing any graph. Application replaceTrack
      // restores raw first; removeTrack(null) must stay null even during startup.
      cueVersion++; cueAbort?.abort(); clearInterval(watch); watch = null;
      if (cue) { const old = cue; cue = null; old.onended = null; try { old.stop(); } catch {} old.disconnect(); }
      entries.delete(entry);
      for (const mix of mixes) void release(mix, mix.entry === entry && replacement === null ? null : mix.raw, closed && mix.entry === entry);
      if (!entries.size && !mixes.size) closeContext();
      notify();
    }
    function noteMicrophone(track) {
      if (disposed || track?.kind !== 'audio' || known.has(track) || !live(track)) return;
      known.add(track);
      const change = event => { if (event.type === 'ended') ended.add(track); changed(track); };
      for (const type of ['mute', 'unmute', 'ended']) track.addEventListener(type, change);
      listeners.set(track, () => { for (const type of ['mute', 'unmute', 'ended']) track.removeEventListener(type, change); });
      for (const ref of observed) { const entry = ref.deref(); if (entry) observe(entry); else observed.delete(ref); }
    }
    async function play(effect) {
      const stopped = stopCue(), stamp = version, token = cueVersion;
      if (!enabled || disposed) return false;
      const data = globalThis.MeetEffects.memeAssets?.[effect]?.sound;
      if (!data) return false;
      const abort = cueAbort = new AbortController();
      const valid = () => enabled && !disposed && stamp === version && token === cueVersion && !abort.signal.aborted;
      try {
        const current = await ensureContext(); await stopped;
        if (!valid()) return false;
        const targets = preview ? [] : [...entries].filter(eligible);
        if (!preview && !targets.length) { notify(); return false; }
        const buffer = await bounded(current.decodeAudioData(audioBytes(data)), abort.signal);
        if (!valid()) return false;
        for (const entry of targets) {
          if (!eligible(entry)) continue;
          const raw = entry.sender.track;
          const source = current.createMediaStreamSource(new MediaStream([raw]));
          const destination = current.createMediaStreamDestination();
          // Keep channel count compatible with the negotiated microphone.
          destination.channelCount = Math.max(1, Math.min(2, raw.getSettings().channelCount || 1));
          source.connect(destination);
          const mix = { entry, raw, source, destination, track: destination.stream.getAudioTracks()[0], installing: true, releasing: null };
          mixes.add(mix);
          try { await nativeReplace.call(entry.sender, mix.track); }
          finally { mix.installing = false; }
          if (!valid()) { await release(mix); return false; }
        }
        if (!valid() || current.state !== 'running') throw cancelled();
        if (!preview && !mixes.size) return false;
        const node = current.createBufferSource(); node.buffer = buffer;
        if (preview) node.connect(current.destination);
        else for (const mix of mixes) {
          if (!audible(mix.raw)) { await stopCue(); return false; }
          node.connect(mix.destination);
        }
        cue = node;
        node.onended = () => { if (cue === node) void stopCue(); };
        node.start();
        // Defensive check for native changes outside the JS hooks. Only exists
        // for the duration of a cue; mute/stop events cancel synchronously.
        if (!preview) watch = setInterval(() => {
          if ([...mixes].some(m => !audible(m.raw) || m.entry.pc?.signalingState === 'closed')) void stopCue();
        }, 16);
        notify(); return true;
      } catch (failure) {
        if (valid() && failure.name !== 'AbortError') await fail(failure, stamp);
        return false;
      }
    }
    const client = { knows: track => known.has(track), noteMicrophone, changed, observe, detach };
    if (!preview) { installHooks(); clients.add(client); }
    function cleanupDisposed() {
      if (!disposed || mixes.size) return;
      for (const cleanup of listeners.values()) cleanup(); listeners.clear(); entries.clear();
      if (!preview) { clients.delete(client); if (!clients.size) unhook?.(); }
      closeContext(); notify();
    }
    function dispose() {
      if (disposal) return disposal;
      const stopped = setEnabled(false); disposed = true;
      disposal = stopped.then(cleanupDisposed);
      return disposal;
    }
    return { ...(preview ? {} : { noteMicrophone }), setEnabled, play, stopCue, dispose, getState };
  }
  Object.assign(globalThis.MeetEffects ||= {}, {
    createMeetSound: onChange => createSound(false, onChange),
    createPreviewSound: onChange => createSound(true, onChange)
  });
})();
