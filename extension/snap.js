(() => {
  'use strict';
  // Detects a short broadband transient, not a uniquely identifiable finger snap.
  // Claps/taps can trigger it; the visible snap toggle disables listening.
  class SnapGate {
    constructor() { this.floor = 0.004; this.last = -Infinity; this.started = null; this.armed = true; this.quietSince = null; }
    update(rms, highRatio, now, peak = rms * 2, background = rms) {
      this.started ??= now;
      const warming = now - this.started < 500;
      if (warming || background < this.floor * 2) this.floor = Math.max(0.0005, this.floor * 0.85 + background * 0.15);
      if (rms < Math.max(0.010, this.floor * 2)) {
        this.quietSince ??= now;
        if (now - this.quietSince >= 80) this.armed = true;
      } else this.quietSince = null;
      const hit = !warming && this.armed && now - this.last > 3500 &&
        rms > Math.max(0.018, this.floor * 4) && peak > 0.06 && highRatio > 0.20;
      if (hit) { this.last = now; this.armed = false; }
      return hit;
    }
  }
  function snapFeatures(wave, spectrum, sampleRate) {
    const size = Math.max(1, Math.round(sampleRate * 0.004)), step = Math.max(1, Math.round(sampleRate * 0.002));
    let rms = 0, peak = 0, total = 0, high = 0;
    const levels = [];
    for (let offset = 0; offset + size <= wave.length; offset += step) {
      let energy = 0;
      for (let i = offset; i < offset + size; i++) { energy += wave[i] * wave[i]; peak = Math.max(peak, Math.abs(wave[i])); }
      const level = Math.sqrt(energy / size); levels.push(level); rms = Math.max(rms, level);
    }
    levels.sort((a, b) => a - b);
    for (let i = 0; i < spectrum.length; i++) {
      const power = Number.isFinite(spectrum[i]) ? 10 ** (spectrum[i] / 10) : 0;
      total += power; if (i * sampleRate / wave.length > 2500) high += power;
    }
    return { rms, peak, background: levels[Math.floor(levels.length / 2)] || 0, highRatio: high / Math.max(1e-20, total) };
  }
  async function listenForSnap(track, callback, onEnded = () => {}, signal, onLevel = () => {}) {
    if (!track || track.readyState !== 'live') throw new Error('Turn your meeting microphone on first.');
    const context = new AudioContext();
    let timer, source, stopped = false;
    const stop = () => {
      if (stopped) return;
      stopped = true; clearInterval(timer); source?.disconnect();
      track.removeEventListener('ended', ended); signal?.removeEventListener('abort', stop);
      void context.close().catch(() => {});
    };
    const ended = () => { stop(); onEnded(); };
    track.addEventListener('ended', ended, { once: true });
    signal?.addEventListener('abort', stop, { once: true });
    try {
      await MeetEffects.waitForMedia(context.resume(), signal, 4000);
      if (signal?.aborted || stopped || track.readyState !== 'live') throw new DOMException('Microphone startup cancelled.', 'AbortError');
      if (context.state !== 'running') throw new Error('Turn Snap to disappear off and on to enable audio analysis.');
      source = context.createMediaStreamSource(new MediaStream([track]));
      const analyser = context.createAnalyser();
      analyser.fftSize = Math.min(32768, 2 ** Math.ceil(Math.log2(context.sampleRate * 0.04))); analyser.smoothingTimeConstant = 0;
      source.connect(analyser); // Never connected to speakers or a recording sink.
      const wave = new Float32Array(analyser.fftSize), bins = new Float32Array(analyser.frequencyBinCount);
      let gate = new SnapGate(), wasEnabled = true, lastLevel = -Infinity;
      timer = setInterval(() => {
        if (track.readyState !== 'live') { ended(); return; }
        if (!track.enabled || track.muted) {
          wasEnabled = false;
          if (performance.now() - lastLevel >= 150) { onLevel(0); lastLevel = performance.now(); }
          return;
        }
        if (!wasEnabled) { gate = new SnapGate(); wasEnabled = true; }
        analyser.getFloatTimeDomainData(wave); analyser.getFloatFrequencyData(bins);
        const features = snapFeatures(wave, bins, context.sampleRate), now = performance.now();
        if (now - lastLevel >= 150) { onLevel(features.peak); lastLevel = now; }
        if (gate.update(features.rms, features.highRatio, now, features.peak, features.background)) callback();
      }, 16);
      return stop;
    } catch (error) { stop(); throw error; }
  }
  Object.assign(globalThis.MeetEffects, { SnapGate, snapFeatures, listenForSnap });
})();
