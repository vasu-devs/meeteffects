(() => {
  'use strict';
  if (globalThis.__meetEffectsInstalled || !navigator.mediaDevices?.getUserMedia) return;
  globalThis.__meetEffectsInstalled = true;
  const nativeGetUserMedia = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const sessions = new Set(), microphones = new Set();
  const ownedTracks = new WeakSet();
  const nativeStreamClone = MediaStream.prototype.clone;
  MediaStream.prototype.clone = function () {
    if (!this.getTracks().some(track => ownedTracks.has(track))) return nativeStreamClone.call(this);
    return new MediaStream(this.getTracks().map(track => track.clone()));
  };
  let stopSnap = null, snapAbort = null, snapGeneration = 0, effectGeneration = 0, lastError = '';
  let snapWanted = true, snapTrack = null, pendingSnapTrack = null, snapLevel = 0;
  let sound = null;
  let roomImage = null, roomGeneration = 0, roomLoading = false, roomError = '';
  let roomCapture = null, roomProgress = null;
  let lifecycle = new AbortController();
  const live = () => [...sessions].filter(s => !s.disposed);
  function status(message = '') {
    if (message) lastError = message;
    const active = live();
    document.dispatchEvent(new CustomEvent('meeteffects:status', { detail: JSON.stringify({
      cameras: active.length, plate: active.length > 0 && active.every(s => !!s.engine.plate),
      background: !!roomImage, backgroundLoading: roomLoading, backgroundError: roomError,
      backgroundCapturing: !!roomCapture, backgroundCapture: roomProgress,
      effect: active.at(-1)?.engine.effect || 'none', snap: !!stopSnap, snapWanted,
      snapPending: !!pendingSnapTrack, snapLevel, micOn: !!snapTrack?.enabled && !snapTrack?.muted,
      autoReady: active.length > 0 && active.every(s => s.engine.autoReady),
      preparing: active.some(s => s.engine.dustPending),
      sound: sound?.getState() || {enabled:false,connected:false,error:''},
      message: lastError || active.find(s => s.engine.autoError)?.engine.autoError || '',
      interrupted: active.some(s => s.engine.sourceInterrupted)
    }) }));
  }
  sound = MeetEffects.createMeetSound?.(() => status());
  function cancelRoomCapture(message = '') {
    if (!roomCapture) return;
    roomGeneration++; roomCapture.controller.abort(); roomCapture = null; roomProgress = null;
    roomError = message; status();
  }
  function disableSnap() {
    snapGeneration++;
    snapAbort?.abort(); snapAbort = null;
    stopSnap?.(); stopSnap = null; snapTrack = null; pendingSnapTrack = null; snapLevel = 0;
  }
  async function startSnap() {
    if (!snapWanted || !live().length) return;
    // Prefer the latest acquisition; never open another microphone in Meet.
    const mic = [...microphones].reverse().find(t => t.readyState === 'live');
    if (!mic || (stopSnap && snapTrack === mic) || pendingSnapTrack === mic) return;
    disableSnap(); const generation = snapGeneration;
    pendingSnapTrack = mic; snapAbort = new AbortController();
    try {
      const stop = await MeetEffects.listenForSnap(mic, () => {
        if (roomCapture) return;
        effectGeneration++;
        sound?.stopCue();
        const active = live(), effect = active.some(s => s.engine.effect === 'dust') ? 'none' : 'dust';
        Promise.all(active.map(s => s.engine.trigger(effect)))
          .then(() => status()).catch(error => status(error.message));
      }, () => {
        if (generation !== snapGeneration) return;
        disableSnap(); microphones.delete(mic); status(); void startSnap();
      }, snapAbort.signal, level => {
        if (generation !== snapGeneration) return;
        snapLevel = level; status();
      });
      if (generation !== snapGeneration || !live().length || !snapWanted) stop();
      else { stopSnap = stop; snapTrack = mic; pendingSnapTrack = null; lastError = ''; status(); }
    } catch (error) {
      if (generation !== snapGeneration) return;
      pendingSnapTrack = null;
      if (error.name !== 'AbortError') status(`Snaps could not start: ${error.message}`);
    }
  }
  function noteMicrophones(stream) {
    for (const track of microphones) if (track.readyState !== 'live') microphones.delete(track);
    for (const track of stream.getAudioTracks()) {
      microphones.add(track);
      sound?.noteMicrophone(track);
      track.addEventListener('ended', () => microphones.delete(track), { once: true });
    }
    void startSnap();
  }
  async function processCamera(rawTrack, signal) {
    cancelRoomCapture('Camera changed. Take a new room photo.');
    const video = document.createElement('video');
    video.muted = true; video.playsInline = true;
    video.srcObject = new MediaStream([rawTrack]);
    const cancelStartup = () => { rawTrack.stop(); video.pause(); video.srcObject = null; };
    signal.addEventListener('abort', cancelStartup, { once: true });
    let engine, captured, session;
    try {
      await MeetEffects.waitForMedia(video.play(), signal);
      if (rawTrack.readyState !== 'live') throw new Error('Camera stopped during startup.');
      if (!video.videoWidth) throw new Error('Camera has not supplied a frame.');
      const canvas = document.createElement('canvas');
      const scale = Math.min(1, 960 / video.videoWidth);
      canvas.width = Math.round(video.videoWidth * scale);
      canvas.height = Math.round(video.videoHeight * scale);
      engine = new MeetEffects.Engine(video, canvas, () => status());
      if (roomImage) engine.setBackground(roomImage);
      engine.sourceInterrupted = rawTrack.muted;
      engine.start();
      captured = canvas.captureStream(30);
      const output = captured.getVideoTracks()[0];
      session = { engine, video, rawTrack, consumers: new Set(), disposed: false };
      const enabledDescriptor = Object.getOwnPropertyDescriptor(MediaStreamTrack.prototype, 'enabled');
      function dispose() {
        if (session.disposed) return;
        session.disposed = true;
        if (roomCapture?.engine === engine) cancelRoomCapture('Camera stopped. Turn it on and start setup again.');
        engine.stop(); video.pause(); video.srcObject = null;
        rawTrack.stop(); sessions.delete(session);
        if (!sessions.size) { disableSnap(); sound?.stopCue(); }
        status();
      }
      session.dispose = dispose;
      function syncEnabled() {
        rawTrack.enabled = [...session.consumers].some(t => t.readyState === 'live' && t.enabled);
      }
      function wrap(track) {
        ownedTracks.add(track);
        session.consumers.add(track);
        const stop = track.stop.bind(track), clone = track.clone.bind(track);
        const getSettings = track.getSettings.bind(track);
        function release() {
          session.consumers.delete(track);
          if (!session.consumers.size) dispose(); else syncEnabled();
        }
        Object.defineProperties(track, {
          stop: { value() { stop(); release(); } },
          clone: { value() { const copy = clone(); if (copy.readyState === 'live') wrap(copy); return copy; } },
          getSettings: { value() {
            return { ...rawTrack.getSettings(), ...getSettings(),
              deviceId: rawTrack.getSettings().deviceId, width: canvas.width, height: canvas.height };
          } },
          getConstraints: { value: () => rawTrack.getConstraints() },
          applyConstraints: { value: async constraints => {
            await rawTrack.applyConstraints(constraints);
            // The resize event below uses decoded dimensions and lets the live
            // detector recover with a matching frame/mask pair.
          } }
        });
        if (enabledDescriptor?.get && enabledDescriptor?.set) {
          Object.defineProperty(track, 'enabled', {
            get() { return enabledDescriptor.get.call(track); },
            set(value) { enabledDescriptor.set.call(track, value); syncEnabled(); }
          });
        }
        track.addEventListener('ended', release, { once: true });
        return track;
      }
      wrap(output);
      const interruption = interrupted => {
        if (session.disposed) return;
        engine.sourceInterrupted = interrupted; status();
      };
      rawTrack.addEventListener('mute', () => interruption(true));
      rawTrack.addEventListener('unmute', () => interruption(false));
      video.addEventListener('resize', () => {
        if (!video.videoWidth || session.disposed) return;
        const factor = Math.min(1, 960 / video.videoWidth);
        engine.resize(Math.round(video.videoWidth * factor), Math.round(video.videoHeight * factor));
        if (engine.effect === 'dust' && !engine.automatic && !engine.plate) status('Camera size changed. Holding the effect; Back to reality resets it.');
      });
      rawTrack.addEventListener('ended', () => {
        for (const track of [...session.consumers]) {
          track.stop();
          track.dispatchEvent(new Event('ended'));
        }
        dispose();
      }, { once: true });
      engine.onError = () => {
        // Stop failed output instead of silently freezing a misleading frame.
        for (const track of [...session.consumers]) { track.stop(); track.dispatchEvent(new Event('ended')); }
        status('Effects stopped. Toggle your Meet camera off/on to reconnect.');
      };
      sessions.add(session); lastError = ''; engine.enableAutomatic(); status(); void startSnap();
      signal.removeEventListener('abort', cancelStartup);
      return output;
    } catch (error) {
      signal.removeEventListener('abort', cancelStartup); engine?.stop();
      captured?.getTracks().forEach(t => t.stop());
      video.pause(); video.srcObject = null;
      throw error;
    }
  }
  navigator.mediaDevices.getUserMedia = async function (constraints) {
    // Permission denial and device errors retain their native rejection behavior.
    const signal = lifecycle.signal;
    const stream = await nativeGetUserMedia(constraints);
    if (signal.aborted) { stream.getTracks().forEach(t => t.stop()); throw new DOMException('Page left during camera startup.', 'AbortError'); }
    noteMicrophones(stream);
    const raw = stream.getVideoTracks()[0];
    if (!raw) return stream;
    try {
      const processed = await processCamera(raw, signal);
      stream.removeTrack(raw); stream.addTrack(processed);
      return stream;
    } catch (error) {
      if (signal.aborted) { stream.getTracks().forEach(t => t.stop()); throw error; }
      status('Effects unavailable; original camera is connected. Reload Meet to retry.');
      console.warn('MeetEffects: camera processing could not start.', error);
      return stream;
    }
  };

  document.addEventListener('meeteffects:command', async event => {
    try {
      if (typeof event.detail !== 'string' || event.detail.length > 7_001_000) return;
      const command = JSON.parse(event.detail);
      if (!command || typeof command !== 'object') return;
      if (command.type === 'status') { status(); return; }
      if (command.type === 'sound') { await sound?.setEnabled(command.enabled === true); status(); return; }
      if (command.type === 'background-capture-cancel') { cancelRoomCapture(); status(); return; }
      if (command.type === 'background-capture') {
        cancelRoomCapture();
        const owner = live().at(-1)?.engine;
        if (!owner) throw new Error('Turn your Meet camera on before setting up dust.');
        const version = ++roomGeneration, controller = new AbortController();
        const capture = roomCapture = {controller,engine:owner};
        roomLoading = false; roomError = ''; lastError = ''; effectGeneration++; sound?.stopCue();
        try {
          const image = await MeetEffects.captureEmptyRoom(owner, {immediate:command.immediate === true,signal:controller.signal,onProgress:progress=>{
            if (roomCapture !== capture) return;
            roomProgress = progress; status();
          }});
          if (version !== roomGeneration || lifecycle.signal.aborted || controller.signal.aborted) return;
          roomImage = image;
          for (const session of live()) session.engine.setBackground(image);
        } catch (error) {
          if (version === roomGeneration && error.name !== 'AbortError') roomError = error.message;
        } finally {
          if (roomCapture === capture) { roomCapture = null; roomProgress = null; status(); }
        }
        return;
      }
      if (['background-start','background-cancel','background','effect','plate','image'].includes(command.type)) cancelRoomCapture();
      if (command.type === 'background-start') { roomGeneration++; roomLoading = true; roomError = ''; status(); return; }
      if (command.type === 'background-cancel') { roomGeneration++; roomLoading = false; roomError = 'Could not read the photo. Choose a PNG, JPEG or WebP under 5 MB.'; status(); return; }
      if (command.type === 'background') {
        const version = ++roomGeneration;
        roomLoading = true; roomError = ''; status();
        try {
          const image = await MeetEffects.decodeBackground(command.data);
          if (version !== roomGeneration || lifecycle.signal.aborted) return;
          roomImage = image; lastError = '';
          for (const session of live()) session.engine.setBackground(image);
        } catch (error) { if (version === roomGeneration) roomError = error.message; }
        finally { if (version === roomGeneration) { roomLoading = false; status(); } }
        return;
      }
      lastError = '';
      if (command.type === 'snap-off') { snapWanted = false; disableSnap(); status(); return; }
      const active = live();
      if (!active.length) throw new Error('Turn your Meet camera on. If it is already on, reload this tab.');
      if (command.type === 'effect') {
        const version = ++effectGeneration;
        sound?.stopCue();
        await Promise.all(active.map(s => s.engine.trigger(command.effect)));
        if (version === effectGeneration && command.effect !== 'none' && command.effect !== 'dust') void sound?.play(command.effect).catch(() => status());
      } else if (command.type === 'plate') {
        if (active.some(s => s.engine.sourceInterrupted)) throw new Error('Wait for the camera to recover before saving the room.');
        effectGeneration++;
        for (const s of active) s.engine.capturePlate();
      } else if (command.type === 'image') {
        sound?.stopCue();
        const version = ++effectGeneration;
        await Promise.all(active.map(async s => { await s.engine.setImage(command.data); if (!s.disposed && version === effectGeneration) s.engine.trigger('custom'); }));
      } else if (command.type === 'snap-on') {
        snapWanted = true; await startSnap();
      }
      status();
    } catch (error) { if (error.name !== 'AbortError') status(error.message || 'The effect could not be applied.'); }
  });
  document.addEventListener('pointerdown', () => { if (snapWanted && !stopSnap && !pendingSnapTrack) void startSnap(); }, true);
  addEventListener('pagehide', () => {
    lifecycle.abort();
    cancelRoomCapture();
    roomGeneration++; roomImage = null; roomLoading = false; roomError = '';
    void sound?.dispose(); sound = null;
    disableSnap();
    for (const s of live()) {
      for (const track of [...s.consumers]) track.stop();
      s.dispose();
    }
    microphones.clear();
  });
  addEventListener('pageshow', () => {
    if (lifecycle.signal.aborted) lifecycle = new AbortController();
    if (!sound) sound = MeetEffects.createMeetSound?.(() => status());
  });
})();
