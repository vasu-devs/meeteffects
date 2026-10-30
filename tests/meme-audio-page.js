/* Invoke runMemeAudioTests() with a real CDP user gesture, in the existing
 * isolated browser harness. Synthetic sources only; no microphone acquisition,
 * downloads, autoplay flags, speakers, or external peer/signalling services. */
globalThis.runMemeAudioTests = async () => {
  const checks = [], metrics = {}, peers = [], tracks = [], oscillators = [], contexts = [], outputs = [];
  const NativeContext = globalThis.AudioContext, savedAssets = MeetEffects.memeAssets;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const wait = async (predicate, message, timeout = 3000) => {
    const start = performance.now();
    while (!await predicate()) { if (performance.now() - start > timeout) throw new Error(message); await delay(20); }
  };
  const fixture = new NativeContext();
  const receiverAudio = document.createElement('audio'); receiverAudio.volume = 0;
  let sound, preview, remoteSource, restoreConnect = null;
  const started = performance.now();
  function makeMic(frequency = 440) {
    const oscillator = fixture.createOscillator(), gain = fixture.createGain(), destination = fixture.createMediaStreamDestination();
    oscillator.frequency.value = frequency; gain.gain.value = 0.04;
    oscillator.connect(gain); gain.connect(destination); oscillator.start();
    oscillators.push(oscillator); const track = destination.stream.getAudioTracks()[0]; tracks.push(track); return track;
  }
  function toneURL() {
    const rate = 16000, count = rate * 1.5, buffer = new ArrayBuffer(44 + count * 2), view = new DataView(buffer);
    const word = (at, text) => [...text].forEach((char, i) => view.setUint8(at + i, char.charCodeAt(0)));
    word(0, 'RIFF'); view.setUint32(4, buffer.byteLength - 8, true); word(8, 'WAVE'); word(12, 'fmt ');
    view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true);
    view.setUint32(24, rate, true); view.setUint32(28, rate * 2, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true);
    word(36, 'data'); view.setUint32(40, count * 2, true);
    for (let i = 0; i < count; i++) view.setInt16(44 + i * 2, Math.sin(2 * Math.PI * 1200 * i / rate) * 10000, true);
    let binary = ''; for (const byte of new Uint8Array(buffer)) binary += String.fromCharCode(byte);
    return 'data:audio/wav;base64,' + btoa(binary);
  }
  try {
    await fixture.resume();
    globalThis.AudioContext = class extends NativeContext {
      constructor(...args) { super(...args); contexts.push(this); }
      createMediaStreamDestination() {
        const node = super.createMediaStreamDestination(); outputs.push(...node.stream.getAudioTracks()); return node;
      }
    };
    MeetEffects.memeAssets = { ...savedAssets, __audio_test: { sound: toneURL() } };
    assert(typeof MeetEffects.createMeetSound === 'function', 'Audio module was not loaded');
    sound = MeetEffects.createMeetSound();
    const raw = makeMic(); sound.noteMicrophone(raw);
    const a = new RTCPeerConnection({ iceServers: [] }), b = new RTCPeerConnection({ iceServers: [] }); peers.push(a, b);
    a.onicecandidate = e => { if (e.candidate) void b.addIceCandidate(e.candidate).catch(() => {}); };
    b.onicecandidate = e => { if (e.candidate) void a.addIceCandidate(e.candidate).catch(() => {}); };
    const analyser = fixture.createAnalyser(), silent = fixture.createGain();
    analyser.fftSize = 4096; analyser.smoothingTimeConstant = 0; silent.gain.value = 0;
    analyser.connect(silent); silent.connect(fixture.destination);
    b.ontrack = e => {
      const stream = new MediaStream([e.track]);
      // Chromium's WebRTC receiver needs a playing media element to drive its
      // decoder. Volume stays zero; measurements use the independent analyser.
      receiverAudio.srcObject = stream; void receiverAudio.play().catch(() => {});
      remoteSource = fixture.createMediaStreamSource(stream); remoteSource.connect(analyser);
    };
    const sender = a.addTrack(raw, new MediaStream([raw]));
    await a.setLocalDescription(await a.createOffer()); await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer()); await a.setRemoteDescription(b.localDescription);
    const bins = new Float32Array(analyser.frequencyBinCount);
    const band = frequency => {
      analyser.getFloatFrequencyData(bins);
      const index = Math.round(frequency * analyser.fftSize / fixture.sampleRate);
      return Math.max(...bins.slice(Math.max(0, index - 2), index + 3));
    };
    try { await wait(() => band(440) > -65, 'Native microphone energy did not arrive at local WebRTC receiver'); }
    catch (failure) {
      metrics.startup = { context: fixture.state, connection: a.connectionState, ice: a.iceConnectionState,
        remote: !!remoteSource, micDb: band(440), stats: [...(await b.getStats()).values()].filter(r => r.type === 'inbound-rtp') };
      throw failure;
    }
    metrics.nativeMicDb = band(440);
    assert(!sound.getState().enabled && sender.track === raw && contexts.length === 0, 'Default OFF changed native microphone or opened an AudioContext');
    assert(!await sound.play('__audio_test') && sender.track === raw, 'OFF played sound');
    checks.push('Default OFF preserves the native sender and opens no audio context; receiver gets microphone energy');

    await sound.setEnabled(true);
    assert(sound.getState().connected && sender.track === raw, 'Existing call could not enable sounds without replacing its idle microphone');
    assert(await sound.play('__audio_test'), 'Cue did not start');
    const firstMix = sender.track;
    assert(firstMix !== raw && firstMix.kind === 'audio', 'Cue did not replace the outgoing audio sender');
    await wait(() => band(1200) > -45 && band(440) > -65, 'Receiver did not receive cue and microphone together');
    metrics.cueDb = band(1200); metrics.mixedMicDb = band(440);
    const stats = await b.getStats();
    assert([...stats.values()].some(report => report.type === 'inbound-rtp' && report.kind === 'audio' && report.packetsReceived > 0), 'Receiver has no inbound audio RTP');
    await sound.stopCue(); await delay(180);
    assert(sender.track === raw && firstMix.readyState === 'ended', 'Reset did not restore raw microphone and stop owned mix');
    assert(band(1200) < -65 && band(440) > -65, 'Reset did not remove the cue while preserving microphone energy');
    await sound.play('__audio_test'); const naturalMix = sender.track;
    await wait(() => sender.track === raw && naturalMix.readyState === 'ended', 'Cue completion did not return to the native microphone');
    checks.push('Existing-call enable mixes real cue + microphone energy at WebRTC receiver; reset restores native audio');

    await sound.play('__audio_test'); const mutedMix = sender.track;
    raw.enabled = false;
    assert(!mutedMix.enabled, 'Raw mute did not synchronously silence the mixed output');
    await wait(() => sender.track === raw, 'Mute did not restore raw sender'); await delay(180);
    assert(band(1200) < -65 && band(440) < -65 && !await sound.play('__audio_test'), 'Muted microphone allowed a cue or microphone audio');
    raw.enabled = true; await sound.play('__audio_test');
    sender.track.enabled = false;
    await wait(() => sender.track === raw, 'Muting sender.track did not restore raw sender');
    assert(!raw.enabled, 'Cue cleanup unexpectedly unmuted sender.track mute intent');
    raw.enabled = true;
    Object.defineProperty(raw, 'muted', { configurable: true, get: () => true }); raw.dispatchEvent(new Event('mute'));
    assert(!await sound.play('__audio_test') && raw.enabled, 'Hardware mute allowed cue or changed independent enabled flag');
    delete raw.muted; raw.dispatchEvent(new Event('unmute'));
    checks.push('Raw enabled, sender.track enabled, and hardware mute suppress cues without accidental unmute');

    await sound.play('__audio_test'); const stoppedOutput = sender.track; stoppedOutput.stop();
    await wait(() => sender.track === null && stoppedOutput.readyState === 'ended', 'Explicit output.stop resurrected the microphone sender');
    assert(raw.readyState === 'live', 'Explicit output.stop stopped borrowed raw microphone');
    await sender.replaceTrack(raw); await sound.play('__audio_test');
    await sound.setEnabled(false); await delay(160);
    assert(sender.track === raw && raw.readyState === 'live' && outputs.every(t => t.readyState === 'ended'), 'OFF did not release every owned mix and preserve microphone');
    assert(band(440) > -65 && band(1200) < -65, 'OFF changed actual received microphone audio');
    checks.push('Explicit mixed-output stop detaches without stopping borrowed input; OFF preserves received native microphone');

    await sound.setEnabled(true);
    await sound.play('__audio_test');
    const off = sound.setEnabled(false), on = sound.setEnabled(true); await Promise.all([off, on]);
    assert(sound.getState().enabled && sound.getState().connected && sender.track === raw, 'A completed OFF raced with and closed a newer ON');
    const decodeContext = contexts.at(-1), decode = decodeContext.decodeAudioData;
    let finishDecode;
    decodeContext.decodeAudioData = () => new Promise(resolve => { finishDecode = resolve; });
    const pending = sound.play('__audio_test'); await wait(() => finishDecode, 'Decode fixture did not start');
    await sound.stopCue(); finishDecode(fixture.createBuffer(1, 100, 16000)); await pending;
    assert(sender.track === raw, 'Late decode undid reset');
    decodeContext.decodeAudioData = decode;
    const pendingOff = sound.play('__audio_test'); await sound.setEnabled(false); await pendingOff;
    assert(sender.track === raw, 'Late startup undid OFF');
    const nativeResume = globalThis.AudioContext.prototype.resume;
    globalThis.AudioContext.prototype.resume = () => new Promise(() => {});
    const enabling = sound.setEnabled(true); await sound.setEnabled(false); await enabling;
    globalThis.AudioContext.prototype.resume = nativeResume;
    assert(sender.track === raw && !sound.getState().enabled, 'Cancelling blocked autoplay lost native microphone');
    checks.push('Reset/OFF invalidate late decode and blocked resume without installing a stale sender');

    await sound.setEnabled(true); await sound.play('__audio_test');
    await contexts.at(-1).suspend();
    await wait(() => !sound.getState().enabled && sender.track === raw, 'Suspended AudioContext did not return to native audio');
    assert(sound.getState().error.includes('interrupted'), 'Interrupted audio had no visible error');
    globalThis.AudioContext.prototype.resume = () => Promise.reject(new Error('Synthetic autoplay denial'));
    await sound.setEnabled(true); globalThis.AudioContext.prototype.resume = nativeResume;
    assert(!sound.getState().enabled && sound.getState().error.includes('autoplay denial') && sender.track === raw, 'Autoplay rejection did not visibly fall back to native microphone');
    checks.push('AudioContext interruption and autoplay failure report errors and restore native microphone');

    await sound.setEnabled(true);
    const replacement = makeMic(440); sound.noteMicrophone(replacement);
    await sound.play('__audio_test'); const replacedMix = sender.track;
    await sender.replaceTrack(replacement);
    assert(sender.track === replacement && replacedMix.readyState === 'ended' && raw.readyState === 'live', 'Replacing microphone leaked mix or stopped borrowed input');
    await sound.play('__audio_test'); await sender.replaceTrack(null);
    assert(sender.track === null && outputs.every(t => t.readyState === 'ended'), 'replaceTrack(null) left an owned output');
    await sender.replaceTrack(replacement); await sound.play('__audio_test');
    const restorePending = sound.stopCue(); a.removeTrack(sender); await restorePending;
    await wait(() => sender.track === null && outputs.every(t => t.readyState === 'ended'), 'removeTrack during restoration resurrected sender or leaked output');
    checks.push('Microphone replacement, replaceTrack(null), and removeTrack during restoration release owned tracks');

    const c = new RTCPeerConnection({ iceServers: [] }); peers.push(c);
    const cloned = replacement.clone(), streamClone = new MediaStream([replacement]).clone().getAudioTracks()[0]; tracks.push(cloned, streamClone);
    assert(cloned !== replacement && streamClone !== replacement && cloned.enabled && streamClone.readyState === 'live', 'Native microphone cloning changed');
    const cloneSender = c.addTransceiver(cloned, { direction: 'sendonly' }).sender;
    // A previous removal closes the now-unused audio context; play reopens it.
    await sound.play('__audio_test'); assert(cloneSender.track !== cloned, 'Known native clone was not eligible through addTransceiver');
    let endedEvents = 0; cloned.addEventListener('ended', () => endedEvents++);
    cloned.stop(); await wait(() => cloneSender.track === cloned && outputs.every(t => t.readyState === 'ended'), 'Direct raw.stop did not release the cue');
    assert(endedEvents === 0 && replacement.readyState === 'live' && streamClone.readyState === 'live', 'Direct stop altered native ended/clone behavior');
    await cloneSender.replaceTrack(streamClone); await sound.play('__audio_test');
    streamClone.dispatchEvent(new Event('ended'));
    await wait(() => outputs.every(t => t.readyState === 'ended'), 'Source ended event did not clean up mix');
    const unknown = makeMic(660), unrelated = c.addTrack(unknown);
    const next = makeMic(); sound.noteMicrophone(next); await cloneSender.replaceTrack(next); await sound.play('__audio_test');
    assert(unrelated.track === unknown, 'Unregistered audio was replaced');
    c.close(); await wait(() => outputs.every(t => t.readyState === 'ended'), 'Peer close did not release mix output');
    assert(next.readyState === 'live' && replacement.readyState === 'live' && unknown.readyState === 'live', 'Peer cleanup stopped a borrowed track');
    checks.push('addTransceiver + native clones work; direct raw.stop, source ended, close clean up; unregistered audio untouched');

    await sound.dispose();
    await wait(() => contexts.every(ctx => ctx.state === 'closed'), 'Meet audio context leaked after dispose');
    // Intercept preview speaker connections with a zero-gain sink. The actual
    // production player runs, but this suite cannot make audible laptop sound.
    const connect = AudioNode.prototype.connect;
    let previewConnections = 0;
    AudioNode.prototype.connect = function (destination, ...args) {
      if (destination === this.context.destination) {
        const zero = this.context.createGain(); zero.gain.value = 0; connect.call(zero, destination);
        previewConnections++; return connect.call(this, zero, ...args);
      }
      return connect.call(this, destination, ...args);
    };
    restoreConnect = () => { AudioNode.prototype.connect = connect; };
    preview = MeetEffects.createPreviewSound();
    assert(!preview.getState().enabled && !await preview.play('__audio_test'), 'Preview was not OFF by default');
    await preview.setEnabled(true); assert(await preview.play('__audio_test'), 'Preview did not play fixture cue');
    assert(previewConnections === 1 && !('noteMicrophone' in preview), 'Preview did not use only its local speaker sink');
    await preview.stopCue(); await preview.dispose();
    await wait(() => contexts.every(ctx => ctx.state === 'closed'), 'Preview context leaked');
    checks.push('Studio preview is opt-in and uses only local playback; test intercepts sink to keep speakers silent');
    metrics.elapsedMs = Math.round(performance.now() - started);
    return { ok: true, checks, metrics };
  } catch (error) { return { ok: false, checks, metrics, error: error.stack }; }
  finally {
    await preview?.dispose(); await sound?.dispose(); restoreConnect?.();
    receiverAudio.pause(); receiverAudio.srcObject = null;
    for (const peer of peers) peer.close(); remoteSource?.disconnect();
    for (const oscillator of oscillators) { oscillator.stop(); oscillator.disconnect(); }
    for (const track of tracks) track.stop();
    for (const ctx of contexts) if (ctx.state !== 'closed') await ctx.close().catch(() => {});
    await fixture.close(); globalThis.AudioContext = NativeContext; MeetEffects.memeAssets = savedAssets;
  }
};
