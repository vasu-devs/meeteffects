/* Shared by Meet and the studio. Frames and effects stay on this device. */
(() => {
  'use strict';
  const clamp = (v, a = 0, b = 1) => Math.min(b, Math.max(a, v));
  const smooth = v => { const t = clamp(v); return t * t * (3 - 2 * t); };
  const effects = new Set(['none', 'dust', 'cinema', 'tired', 'brb', 'custom']);

  // Fine, continuous noise is sampled in person-relative coordinates. It does
  // not crawl across the body when the camera image translates by a few pixels.
  const hash = (x, y) => {
    let n = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
    n = Math.imul(n ^ (n >>> 13), 1274126177);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  let dustNoise;
  function erosionDelay(nx, ny) {
    if (!dustNoise) {
      dustNoise = new Float32Array(256 * 256);
      const noise = (x, y) => {
        const ix = Math.floor(x), iy = Math.floor(y), fx = smooth(x - ix), fy = smooth(y - iy);
        const a = hash(ix, iy), b = hash(ix + 1, iy), c = hash(ix, iy + 1), d = hash(ix + 1, iy + 1);
        return (a + (b - a) * fx) * (1 - fy) + (c + (d - c) * fx) * fy;
      };
      for (let y = 0; y < 256; y++) for (let x = 0; x < 256; x++) {
        dustNoise[y * 256 + x] = noise(x / 38, y / 31) * 0.5 +
          noise(x / 6, y / 5) * 0.32 + hash(x, y) * 0.18;
      }
    }
    const x = clamp(nx) * 254, y = clamp(ny) * 254, ix = Math.floor(x), iy = Math.floor(y);
    const fx = x - ix, fy = y - iy, i = iy * 256 + ix;
    const n = (dustNoise[i] * (1 - fx) + dustNoise[i + 1] * fx) * (1 - fy) +
      (dustNoise[i + 256] * (1 - fx) + dustNoise[i + 257] * fx) * fy;
    return 0.12 + (1 - clamp(nx)) * 1.75 + clamp(ny) * 0.12 + n * 0.6;
  }

  // A clean plate supplies the pixels the camera cannot see behind a person.
  // Block differencing is deliberately small and runs once per dust transition.
  function dustTiles(frame, background, width, height, threshold = 32) {
    const size = Math.max(4, Math.ceil(width / 160));
    const tiles = [];
    for (let y = 0; y < height; y += size) {
      for (let x = 0; x < width; x += size) {
        let difference = 0, samples = 0;
        for (let dy = 0; dy < size && y + dy < height; dy += 2) {
          for (let dx = 0; dx < size && x + dx < width; dx += 2) {
            const i = ((y + dy) * width + x + dx) * 4;
            difference += Math.max(Math.abs(frame[i] - background[i]),
              Math.abs(frame[i + 1] - background[i + 1]), Math.abs(frame[i + 2] - background[i + 2]));
            samples++;
          }
        }
        if (difference / samples > threshold) {
          let hash = Math.imul(x + 1, 374761393) ^ Math.imul(y + 1, 668265263);
          hash = Math.imul(hash ^ (hash >>> 13), 1274126177);
          const seed = ((hash ^ (hash >>> 16)) >>> 0) / 4294967296;
          tiles.push({ x, y, w: Math.min(size, width - x), h: Math.min(size, height - y),
            delay: (1 - x / width) * 0.85 + seed * 0.4, seed });
        }
      }
    }
    return tiles;
  }

  function makeCanvas(width, height) {
    const canvas = document.createElement('canvas');
    canvas.width = width; canvas.height = height;
    return canvas;
  }

  async function decodeBackground(dataUrl) {
    const maximumBytes = 5 * 1024 * 1024;
    const invalid = () => new Error('Use a PNG, JPEG or WebP empty-room photo up to 5 MiB.');
    if (typeof dataUrl !== 'string' || dataUrl.length > 4 * Math.ceil(maximumBytes / 3) + 23) throw invalid();
    const header = /^data:image\/(png|jpeg|webp);base64,/.exec(dataUrl);
    if (!header) throw invalid();
    const encoded = dataUrl.slice(header[0].length);
    const padding = encoded.endsWith('==') ? 2 : encoded.endsWith('=') ? 1 : 0;
    if (!encoded.length || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded) ||
        encoded.length / 4 * 3 - padding > maximumBytes) throw invalid();
    const signature = atob(encoded.slice(0, 32));
    const correctType = header[1] === 'png' ? signature.startsWith('\x89PNG\r\n\x1a\n') :
      header[1] === 'jpeg' ? signature.startsWith('\xff\xd8\xff') :
        signature.startsWith('RIFF') && signature.slice(8, 12) === 'WEBP';
    if (!correctType) throw invalid();
    const image = new Image(); image.src = dataUrl;
    try { await image.decode(); } catch { throw new Error('Could not decode the empty-room photo. Use a valid PNG, JPEG or WebP.'); }
    const { naturalWidth: width, naturalHeight: height } = image;
    if (!width || !height || width * height > 16_000_000) throw new Error('Photo is too large. Use at most 16 megapixels.');
    const scale = Math.min(1, 960 / Math.max(width, height));
    const canvas = makeCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
    // A detached snapshot, shared read-only by callers. Engines never draw into or resize it.
    const ctx = canvas.getContext('2d', { alpha: false });
    ctx.fillStyle = '#000'; ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
  }

  // Setup is a timed camera photo, independent of person-detection confidence.
  // ML still tracks the live dust effect; it must not veto the room countdown.
  function captureEmptyRoom(engine, { signal, onProgress, immediate = false } = {}) {
    return new Promise((resolve, reject) => {
      const countdownEnds = performance.now() + (immediate === true ? 0 : 5000);
      const source = engine.source, stream = source?.srcObject;
      const tracks = [...(stream?.getVideoTracks() || [])];
      const width = engine.canvas.width, height = engine.canvas.height;
      const sourceWidth = source?.videoWidth ?? source?.width, sourceHeight = source?.videoHeight ?? source?.height;
      const scale = Math.min(1, 960 / Math.max(width, height));
      let timer, settled = false, seconds;
      const finish = (error, canvas) => {
        if (settled) return;
        settled = true; clearTimeout(timer);
        signal?.removeEventListener('abort', aborted);
        for (const track of tracks) {
          track.removeEventListener('mute', interrupted); track.removeEventListener('ended', interrupted);
        }
        if (error) reject(error); else resolve(canvas);
      };
      const aborted = () => finish(new DOMException('Room capture cancelled.', 'AbortError'));
      const interrupted = () => finish(new Error('Camera interrupted. Restart room setup when the camera is on.'));
      const tick = () => {
        try {
          if (signal?.aborted) { aborted(); return; }
          if (engine.stopped) throw new Error('Camera stopped. Restart room setup.');
          if (!source || !(width > 0 && height > 0 && sourceWidth > 0 && sourceHeight > 0) ||
              engine.sourceInterrupted || source?.ended || source?.paused || source?.error ||
              (typeof source?.videoWidth === 'number' && !stream) ||
              (typeof source?.readyState === 'number' && source.readyState < 2) ||
              (stream && (!tracks.length || tracks.some(t => !t.enabled || t.muted || t.readyState !== 'live')))) {
            interrupted(); return;
          }
          const currentTracks = source?.srcObject?.getVideoTracks() || [];
          if (engine.source !== source || source?.srcObject !== stream ||
              engine.canvas.width !== width || engine.canvas.height !== height ||
              (source?.videoWidth ?? source?.width) !== sourceWidth || (source?.videoHeight ?? source?.height) !== sourceHeight ||
              currentTracks.length !== tracks.length || currentTracks.some((t, i) => t !== tracks[i])) {
            throw new Error('Camera changed. Restart room setup.');
          }
          const nextSeconds = Math.max(0, Math.ceil((countdownEnds - performance.now()) / 1000));
          if (seconds !== nextSeconds) {
            seconds = nextSeconds; onProgress?.({phase:seconds ? 'countdown' : 'capturing', seconds});
            if (settled) return;
          }
          if (!seconds) {
            const canvas = makeCanvas(Math.max(1, Math.round(width * scale)), Math.max(1, Math.round(height * scale)));
            canvas.getContext('2d', { alpha: false }).drawImage(source, 0, 0, canvas.width, canvas.height);
            finish(null, canvas); return;
          }
          timer = setTimeout(tick, 50);
        } catch (error) { finish(error); }
      };
      signal?.addEventListener('abort', aborted, { once: true });
      for (const track of tracks) {
        track.addEventListener('mute', interrupted); track.addEventListener('ended', interrupted);
      }
      tick();
    });
  }

  // Camera playback and audio-context startup both need bounded, cancelable waits.
  function waitForMedia(promise, signal, timeout = 6000) {
    return new Promise((resolve, reject) => {
      let timer;
      const cleanup = () => { clearTimeout(timer); signal?.removeEventListener('abort', aborted); };
      const succeed = value => { cleanup(); resolve(value); };
      const fail = error => { cleanup(); reject(error); };
      const aborted = () => fail(new DOMException('Media startup cancelled.', 'AbortError'));
      Promise.resolve(promise).then(succeed, fail);
      signal?.addEventListener('abort', aborted, { once: true });
      if (signal?.aborted) aborted();
      else timer = setTimeout(() => fail(new Error('Media startup timed out. Please try again.')), timeout);
    });
  }

  // The page client accepts one request. Busy engines skip a tick instead of
  // queuing stale camera frames or superseding another preview's request.
  let segmentationBusy = false;

  class Engine {
    constructor(source, canvas, onChange = () => {}) {
      this.source = source;
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d', { alpha: false });
      this.onChange = onChange;
      this.effect = 'none';
      this.plate = null;
      this.background = null;
      this.image = null;
      this.imageVersion = 0;
      this.started = 0;
      this.threshold = 32;
      this.stopped = false;
      this.automatic = false; this.dustVersion = 0; this.dustPending = false;
      this.autoReady = false; this.autoError = '';
      this.autoGeneration = 0; this.autoInFlight = false; this.autoTimer = null;
      this.live = null; this.spareFrame = null; this.particles = [];
      this.liveStats = { updates: 0, renders: 0, latencyMs: 0, intervalMs: 1000 / 24 };
    }
    snapshot(source = this.source, maximum = 256) {
      const scale = Math.min(1, maximum / Math.max(this.canvas.width, this.canvas.height));
      const frame = makeCanvas(Math.max(1, Math.round(this.canvas.width * scale)), Math.max(1, Math.round(this.canvas.height * scale)));
      frame.getContext('2d').drawImage(source, 0, 0, frame.width, frame.height);
      return frame;
    }
    setBackground(canvas) {
      this.background = canvas;
      this.onChange();
    }
    setAutoStatus(ready, error = '', pending = this.dustPending) {
      if (ready === this.autoReady && error === this.autoError && pending === this.dustPending) return;
      this.autoReady = ready; this.autoError = error; this.dustPending = pending; this.onChange();
    }
    enableAutomatic() {
      if (this.stopped) return;
      if (this.automatic && (this.autoTimer || this.autoInFlight || this.live)) return this.warmup;
      this.automatic = true;
      this.warmup = new Promise(resolve => { this.finishWarmup = resolve; });
      this.scheduleAutomatic(0); this.onChange();
      return this.warmup;
    }
    scheduleAutomatic(delay) {
      if (this.stopped || !this.automatic || this.autoTimer || this.autoInFlight) return;
      this.autoTimer = setTimeout(() => { this.autoTimer = null; void this.updateAutomatic(); }, delay);
    }
    async updateAutomatic() {
      if (this.stopped || !this.automatic || this.autoInFlight) return;
      if (this.sourceInterrupted || segmentationBusy) { this.scheduleAutomatic(this.sourceInterrupted ? 125 : 16); return; }
      const generation = this.autoGeneration, controller = new AbortController(), began = performance.now();
      this.modelAbort = controller; this.autoInFlight = true; segmentationBusy = true;
      let retry = 0, frame;
      try {
        const scale = Math.min(1, 960 / Math.max(this.canvas.width, this.canvas.height));
        const w = Math.max(1, Math.round(this.canvas.width * scale)), h = Math.max(1, Math.round(this.canvas.height * scale));
        frame = this.spareFrame || makeCanvas(w, h); this.spareFrame = null;
        if (frame.width !== w || frame.height !== h) { frame.width = w; frame.height = h; }
        frame.getContext('2d').drawImage(this.source, 0, 0, w, h);
        const ratio = Math.min(1, 256 / Math.max(w, h));
        const sw = Math.max(1, Math.round(w * ratio)), sh = Math.max(1, Math.round(h * ratio));
        if (!this.sample || this.sample.width !== sw || this.sample.height !== sh) {
          this.sample = makeCanvas(sw, sh);
          this.hidden = new Uint8Array(sw * sh); this.horizontal = new Uint8Array(sw * sh);
        }
        const sampleContext = this.sample.getContext('2d', { willReadFrequently: true });
        sampleContext.drawImage(frame, 0, 0, sw, sh);
        const rgba = sampleContext.getImageData(0, 0, sw, sh).data;
        const result = await MeetEffects.segmentFrame(this.sample, { signal: controller.signal });
        if (controller.signal.aborted || generation !== this.autoGeneration || this.stopped) return;
        if (result.width !== sw || result.height !== sh || result.mask?.length !== sw * sh) throw new Error('Person detection returned an invalid mask.');
        const hidden = MeetEffects.dilatePerson(result.mask, sw, sh, this.hidden, this.horizontal);
        let left = sw, right = 0, top = sh, bottom = 0;
        for (let i = 0; i < result.mask.length; i++) if (result.mask[i] >= 128) {
          const x = i % sw, y = Math.floor(i / sw);
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        this.spareFrame = this.live?.frame || null;
        this.live = { frame, rgba, mask: result.mask, hidden, width: sw, height: sh,
          left, top, span: Math.max(1, right - left), heightSpan: Math.max(1, bottom - top), capturedAt: began };
        frame = null; this.held = null;
        this.liveStats.updates++; this.liveStats.latencyMs = performance.now() - began;
        // Target 24 updates/s and leave time idle when processing becomes expensive.
        const cost = this.liveStats.latencyMs;
        this.autoCost = this.autoCost == null ? Math.min(35, cost) : this.autoCost * 0.8 + Math.min(250, cost) * 0.2;
        this.liveStats.intervalMs = Math.max(1000 / 24, Math.min(250, this.autoCost / 0.7));
        const pending = this.dustPending;
        if (pending && this.effect === 'dust') this.started = performance.now();
        this.setAutoStatus(true, '', false);
        this.finishWarmup?.(); this.finishWarmup = null;
        this.dustWait?.resolve(); this.dustWait = null;
      } catch (error) {
        if (controller.signal.aborted || generation !== this.autoGeneration || this.stopped) return;
        // A missing mask must never expose the hidden camera. Hold the last
        // processed output only on failure; successful frames resume the stream.
        if (this.effect === 'dust' && !this.held) this.holdOutput();
        this.setAutoStatus(false, error.message, false);
        this.finishWarmup?.(); this.finishWarmup = null;
        this.dustWait?.reject(error); this.dustWait = null;
        retry = 750;
      } finally {
        if (frame) { frame.width = 1; frame.height = 1; }
        if (this.modelAbort === controller) this.modelAbort = null;
        this.autoInFlight = false; segmentationBusy = false;
        const elapsed = performance.now() - began;
        this.scheduleAutomatic(retry || Math.max(8, this.liveStats.intervalMs - elapsed));
      }
    }
    holdOutput() {
      this.held = makeCanvas(this.canvas.width, this.canvas.height);
      this.held.getContext('2d').drawImage(this.canvas, 0, 0);
    }
    cancelDust() {
      this.dustVersion++; this.dustAbort?.abort(); this.dustAbort = null; this.dustPending = false;
      this.dustWait?.resolve(); this.dustWait = null; this.particles.length = 0;
      this.lastEmission = null; this.emissionCredit = 0; this.particleSequence = 0;
      this.dustAnchor = null; this.anchorFrame = null;
      this.erosionImage?.data.fill(0);
      this.preparedLive = null; this.preparedErosion = false;
    }
    automaticDust(now = performance.now()) {
      if (this.stopped) return Promise.resolve();
      if (!this.background) return Promise.reject(new Error('Take a room photo first.'));
      if (this.sourceInterrupted) return Promise.reject(new Error('Camera interrupted. Wait for it to recover.'));
      this.cancelDust();
      this.effect = 'dust'; this.started = now;
      // A warmed, matched pair starts immediately; there is no trigger snapshot.
      if (this.live && this.autoReady) { this.held = null; this.onChange(); return Promise.resolve(); }
      this.dustPending = true; this.onChange();
      this.scheduleAutomatic(0);
      return new Promise((resolve, reject) => { this.dustWait = { resolve, reject }; });
    }
    releaseAutomaticFrames() {
      for (const canvas of [this.live?.frame, this.spareFrame, this.sample, this.fill, this.contour, this.photoLayer]) {
        if (canvas) { canvas.width = 1; canvas.height = 1; }
      }
      this.live = null; this.spareFrame = null; this.sample = null; this.fill = null; this.room = null;
      this.photoLayer = null; this.hidden = null; this.horizontal = null; this.erosionImage = null;
      this.contour = null; this.contourImage = null; this.erosionDelays = null; this.preparedLive = null; this.preparedErosion = false;
      this.dustAnchor = null; this.anchorFrame = null;
    }
    resize(width, height) {
      if (width === this.canvas.width && height === this.canvas.height) return;
      const pending = this.dustPending;
      this.cancelDust(); this.autoGeneration++; this.modelAbort?.abort();
      if (this.effect === 'dust') {
        this.holdOutput(); this.frozen = null; this.tiles = null;
        if (this.automatic) this.dustPending = pending;
      }
      this.releaseAutomaticFrames();
      this.canvas.width = width; this.canvas.height = height;
      this.plate = null; this.autoReady = false; this.onChange();
      this.scheduleAutomatic(0);
    }
    capturePlate() {
      this.plate = makeCanvas(this.canvas.width, this.canvas.height);
      this.plate.getContext('2d', { willReadFrequently: true }).drawImage(this.source, 0, 0, this.plate.width, this.plate.height);
      this.reset();
    }
    reset() {
      this.cancelDust(); this.autoError = '';
      this.effect = 'none'; this.tiles = null; this.frozen = null; this.held = null;
      this.onChange();
    }
    trigger(effect, now = performance.now()) {
      if (!effects.has(effect)) throw new Error('Unknown effect.');
      if (effect === 'none') { this.reset(); return; }
      if (effect === 'dust' && this.automatic) return this.automaticDust(now);
      this.cancelDust();
      if (effect === 'dust') {
        if (!this.plate) throw new Error('Save an empty-room shot first.');
        this.frozen = makeCanvas(this.canvas.width, this.canvas.height);
        const context = this.frozen.getContext('2d', { willReadFrequently: true });
        context.drawImage(this.source, 0, 0, this.frozen.width, this.frozen.height);
        this.tiles = dustTiles(context.getImageData(0, 0, this.frozen.width, this.frozen.height).data,
          this.plate.getContext('2d').getImageData(0, 0, this.plate.width, this.plate.height).data,
          this.canvas.width, this.canvas.height, this.threshold);
      }
      if (effect === 'custom' && !this.image) throw new Error('Choose an image or GIF first.');
      this.effect = effect; this.started = now; this.onChange();
    }
    async setImage(dataUrl) {
      if (typeof dataUrl !== 'string' || dataUrl.length > 7_000_000 ||
          !/^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/=]+$/.test(dataUrl)) {
        throw new Error('Use a PNG, JPEG, WebP or GIF smaller than 5 MB.');
      }
      const version = ++this.imageVersion;
      const image = new Image();
      image.src = dataUrl;
      await image.decode();
      if (image.naturalWidth * image.naturalHeight > 16_000_000) throw new Error('Image is too large. Use less than 16 megapixels.');
      let decoder = null, first = null;
      try {
        if (dataUrl.startsWith('data:image/gif;')) {
          if (!globalThis.ImageDecoder || !await ImageDecoder.isTypeSupported('image/gif')) {
            throw new Error('Animated GIFs need a recent Chromium browser. Try a PNG instead.');
          }
          const data = Uint8Array.from(atob(dataUrl.split(',')[1]), c => c.charCodeAt(0));
          decoder = new ImageDecoder({ data, type: 'image/gif' });
          await decoder.tracks.ready;
          first = (await decoder.decode({ frameIndex: 0 })).image;
        }
        if (version !== this.imageVersion || this.stopped) { first?.close(); decoder?.close(); return; }
        this.clearImage(); this.image = image; this.decoder = decoder; this.gifFrame = first;
        this.gifIndex = 0; this.gifNext = 0;
      } catch (error) { first?.close(); decoder?.close(); throw error; }
    }
    clearImage() {
      this.decoder?.close(); this.gifFrame?.close();
      this.decoder = null; this.gifFrame = null; this.gifPending = false; this.image = null;
    }
    advanceGif(now) {
      const decoder = this.decoder;
      if (!decoder || this.gifPending || now < this.gifNext || decoder.tracks.selectedTrack.frameCount < 2) return;
      this.gifPending = true;
      const next = (this.gifIndex + 1) % decoder.tracks.selectedTrack.frameCount;
      decoder.decode({ frameIndex: next }).then(({ image }) => {
        if (this.decoder !== decoder || this.stopped) { image.close(); return; }
        this.gifFrame?.close(); this.gifFrame = image; this.gifIndex = next;
        this.gifNext = performance.now() + Math.max(40, (image.duration || 100000) / 1000);
      }).catch(() => {
        if (this.decoder === decoder) { decoder.close(); this.decoder = null; }
      }).finally(() => { if (this.decoder === decoder) this.gifPending = false; });
    }
    dustCoordinates(live) {
      if (this.anchorFrame === live) return this.dustAnchor;
      if (!this.dustAnchor) {
        this.dustAnchor = { left: live.left, top: live.top, span: live.span, heightSpan: live.heightSpan };
      } else {
        // Keep decorative scale fixed for this transition. Only common movement
        // of opposite bounds moves its origin; changing one edge (a hand, hair,
        // or a noisy mask pixel) must not drag noise across a stationary torso.
        const shift = (a, b) => a * b > 0 ?
          Math.sign(a) * Math.min(Math.abs(a), Math.abs(b)) : 0;
        const anchor = this.dustAnchor;
        anchor.left += shift(live.left - anchor.left, live.left + live.span - anchor.left - anchor.span);
        anchor.top += shift(live.top - anchor.top, live.top + live.heightSpan - anchor.top - anchor.heightSpan);
      }
      this.anchorFrame = live;
      return this.dustAnchor;
    }
    dustAmount(x, y, t, live = this.live) {
      const anchor = this.dustCoordinates(live);
      return smooth((t - erosionDelay((x - anchor.left) / anchor.span, (y - anchor.top) / anchor.heightSpan)) / 0.22);
    }
    prepareDust(live, eroding) {
      if (this.preparedLive === live && (!eroding || this.preparedErosion)) return;
      const { width: sw, height: sh, hidden, mask } = live, anchor = this.dustCoordinates(live);
      if (!this.contour) {
        this.contour = makeCanvas(sw, sh);
        this.contourImage = new ImageData(new Uint8ClampedArray(sw * sh * 4), sw, sh);
        // Decorative breakup has twice the mask resolution; photo detail stays full size.
        this.fill = makeCanvas(sw * 2, sh * 2);
        this.erosionImage = new ImageData(new Uint8ClampedArray(sw * sh * 16), sw * 2, sh * 2);
        this.erosionDelays = new Float32Array(sw * sh * 4);
      }
      const alpha = this.contourImage.data;
      for (let y = 0; y < sh; y++) for (let x = 0; x < sw; x++) {
        const i = y * sw + x;
        let value = hidden[i] * 255;
        if (value && mask[i] < 128) {
          let total = 0, count = 0;
          for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
            const xx = x + dx, yy = y + dy;
            if (xx >= 0 && xx < sw && yy >= 0 && yy < sh) { total += hidden[yy * sw + xx]; count++; }
          }
          value = Math.round(255 * total / count);
        }
        alpha[i * 4 + 3] = value;
      }
      this.contour.getContext('2d').putImageData(this.contourImage, 0, 0);
      // Once gone, only the current safety contour needs updating.
      if (eroding) for (let y = 0; y < sh * 2; y++) for (let x = 0; x < sw * 2; x++) {
        this.erosionDelays[y * sw * 2 + x] = erosionDelay(
          (x / 2 - anchor.left) / anchor.span, (y / 2 - anchor.top) / anchor.heightSpan);
      }
      this.preparedLive = live; this.preparedErosion = eroding;
    }
    emitDust(now) {
      const live = this.live, t = (now - this.started) / 1000;
      // Render-time births remain even at lower inference rates. A delayed tab
      // drops missed births instead of releasing a catch-up burst on its return.
      const dt = Math.min(0.05, Math.max(0, (now - (this.lastEmission ?? now)) / 1000));
      this.lastEmission = now;
      let kept = 0;
      for (const p of this.particles) if (now - p.born < p.life * 1000) this.particles[kept++] = p;
      this.particles.length = kept;
      if (!live || t < 0 || t > 2.9 || this.dustPending) return;
      this.emissionCredit += dt * 2100;
      const births = Math.min(110, Math.floor(this.emissionCredit), 3200 - kept);
      this.emissionCredit -= Math.floor(this.emissionCredit);
      // Low-discrepancy candidates cover the whole silhouette, including its
      // bottom and every former pixel-grid residue class. Work is strictly bounded.
      let emitted = 0;
      for (let attempt = 0; attempt < 3600 && emitted < births; attempt++) {
        const id = ++this.particleSequence;
        const u = (id * 0.754877666) % 1, v = (id * 0.569840291) % 1;
        const x = live.left + u * live.span, y = live.top + v * live.heightSpan;
        const i = Math.floor(y) * live.width + Math.floor(x);
        if (live.mask[i] < 128 || i < 0 || i >= live.mask.length) continue;
        const amount = this.dustAmount(x, y, t);
        if (amount < 0.12 || amount > 0.88) continue;
        const seed = hash(id, 17), c = i * 4;
        // Stagger sub-frame births so a plume does not consist of visible rows.
        this.particles.push({ x: x / live.width, y: y / live.height, born: now - seed * dt * 1000,
          seed, life: 1.25 + seed * 0.5, color: `rgb(${live.rgba[c]},${live.rgba[c + 1]},${live.rgba[c + 2]})` });
        emitted++;
      }
    }
    renderLiveDust(now) {
      const { ctx, canvas, live } = this, w = canvas.width, h = canvas.height;
      if (!live) {
        // First startup has not hidden anyone yet. Failures use the processed hold.
        ctx.drawImage(this.source, 0, 0, w, h); return;
      }
      ctx.drawImage(live.frame, 0, 0, w, h);
      const t = this.dustPending ? 0 : (now - this.started) / 1000, eroding = t < 2.9;
      this.prepareDust(live, eroding);
      if (eroding) {
        const pixels = this.erosionImage.data;
        for (let y = 0; y < this.fill.height; y++) for (let x = 0; x < this.fill.width; x++) {
          const i = y * this.fill.width + x, alpha = i * 4 + 3;
          // Within the current silhouette, a tracking wobble cannot undo
          // removal. Clear history as soon as a pixel becomes live room again.
          pixels[alpha] = live.hidden[(y >> 1) * live.width + (x >> 1)] ?
            Math.max(pixels[alpha], Math.round(255 * smooth((t - this.erosionDelays[i]) / 0.22))) : 0;
        }
        this.fill.getContext('2d').putImageData(this.erosionImage, 0, 0);
      }
      if (!this.photoLayer) this.photoLayer = makeCanvas(w, h);
      const layer = this.photoLayer.getContext('2d'), background = this.background;
      const scale = Math.max(w / background.width, h / background.height);
      const bw = background.width * scale, bh = background.height * scale;
      layer.clearRect(0, 0, w, h);
      layer.drawImage(background, (w - bw) / 2, (h - bh) / 2, bw, bh);
      layer.globalCompositeOperation = 'destination-in';
      layer.drawImage(this.contour, 0, 0, w, h);
      if (eroding) layer.drawImage(this.fill, 0, 0, w, h);
      layer.globalCompositeOperation = 'source-over';
      ctx.drawImage(this.photoLayer, 0, 0);
      this.emitDust(now);
      for (const p of this.particles) {
        const age = Math.max(0, (now - p.born) / 1000), progress = age / p.life;
        const fade = 1 - smooth((progress - 0.35) / 0.65);
        if (!fade) continue;
        // Accelerate into a gentle wind, then drift at a bounded terminal speed.
        const flow = age - (1 - Math.exp(-age * 3)) / 3, phase = p.y * 8 + p.seed * 3;
        const curl = Math.sin(phase + age * 2.4) - Math.sin(phase);
        const x = p.x * w + flow * w * (0.09 + p.seed * 0.12) + curl * w * 0.013 * age;
        const y = p.y * h - flow * h * (0.06 + p.seed * 0.14) + curl * h * 0.025 * age;
        const size = (0.65 + p.seed * p.seed * 2.1) * (w / 640) * (1 - 0.35 * smooth(progress));
        ctx.fillStyle = p.color;
        // A few translucent wisps connect the solid grains without per-particle blur.
        if (p.seed > 0.87) {
          ctx.globalAlpha = fade * 0.075;
          ctx.fillRect(x - size * 3, y - size * 0.5, size * 4, size * 1.7);
        }
        ctx.globalAlpha = fade * 0.88;
        ctx.fillRect(x, y, size, size);
      }
    }
    render(now = performance.now()) {
      const { ctx, canvas } = this, w = canvas.width, h = canvas.height;
      const t = (now - this.started) / 1000;
      this.liveStats.renders++;
      ctx.save();
      ctx.globalAlpha = 1; ctx.filter = 'none';
      if (this.sourceInterrupted) {
        ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, h);
        this.caption('CAMERA INTERRUPTED', h * 0.5, w * 0.055);
      } else if (this.effect === 'dust' && this.held) {
        ctx.drawImage(this.held, 0, 0, w, h);
      } else if (this.effect === 'dust' && this.automatic) {
        this.renderLiveDust(now);
      } else if (this.effect === 'dust') {
        ctx.drawImage(this.plate, 0, 0, w, h);
        for (const p of this.tiles) {
          const elapsed = Math.max(0, t - p.delay);
          const fade = clamp(1 - elapsed / 1.8);
          if (!fade) continue;
          ctx.globalAlpha = fade;
          if (p.color && elapsed > 0.06) {
            const wind = elapsed * elapsed;
            ctx.fillStyle = p.color;
            for (let grain = 0; grain < 2; grain++) {
              const spread = p.seed + grain * 0.37;
              const grainSize = Math.max(0.5, (0.8 + spread) * fade);
              ctx.fillRect(p.x + wind * w * (0.12 + spread * 0.19) + Math.sin(elapsed * 9 + spread * 21) * elapsed * 13,
                p.y - wind * h * (0.07 + spread * 0.14) + Math.cos(elapsed * 7 + spread * 17) * elapsed * 12, grainSize, grainSize);
            }
            continue;
          }
          const drift = elapsed * elapsed;
          ctx.drawImage(this.frozen, p.x, p.y, p.w, p.h,
            p.x + drift * w * (0.1 + p.seed * 0.14),
            p.y - drift * h * (0.08 + p.seed * 0.16) + Math.sin(elapsed * 5 + p.seed * 10) * elapsed * 9,
            p.w * (0.3 + 0.7 * fade), p.h * (0.3 + 0.7 * fade));
        }
      } else {
        if (this.effect === 'cinema' || this.effect === 'tired') ctx.filter = 'grayscale(1)';
        ctx.drawImage(this.source, 0, 0, w, h);
        ctx.filter = 'none';
        if (this.effect === 'cinema') {
          const bar = h * 0.13 * clamp(t * 3);
          ctx.fillStyle = '#000'; ctx.fillRect(0, 0, w, bar); ctx.fillRect(0, h - bar, w, bar);
          if (!MeetEffects.drawMeme?.(ctx, this.effect, w, h, t)) this.caption('ABSOLUTE CINEMA', h * 0.83, w * 0.075);
        } else if (this.effect === 'tired') {
          ctx.fillStyle = 'rgba(18,25,45,.25)'; ctx.fillRect(0, 0, w, h);
          if (!MeetEffects.drawMeme?.(ctx, this.effect, w, h, t)) this.caption("I'M TIRED, BOSS.", h * 0.87, w * 0.071);
        } else if (this.effect === 'brb') {
          ctx.fillStyle = 'rgba(15,20,18,.82)'; ctx.fillRect(0, 0, w, h);
          if (!MeetEffects.drawMeme?.(ctx, this.effect, w, h, t)) {
            this.caption('MENTALLY', h * 0.44, w * 0.075);
            this.caption('OUT OF OFFICE', h * 0.6, w * 0.075);
          }
        } else if (this.effect === 'custom' && this.image) {
          this.advanceGif(now);
          const ratio = Math.min(w * 0.6 / this.image.naturalWidth, h * 0.65 / this.image.naturalHeight);
          const iw = this.image.naturalWidth * ratio, ih = this.image.naturalHeight * ratio;
          ctx.drawImage(this.gifFrame || this.image, (w - iw) / 2, h - ih - h * 0.05, iw, ih);
        }
      }
      ctx.restore();
    }
    caption(text, y, size) {
      const { ctx, canvas } = this;
      ctx.font = `900 ${Math.round(size)}px Impact, "Arial Narrow", sans-serif`;
      ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.lineJoin = 'round';
      ctx.lineWidth = Math.max(3, size * 0.09); ctx.strokeStyle = '#111'; ctx.fillStyle = '#fff';
      ctx.strokeText(text, canvas.width / 2, y, canvas.width * 0.92);
      ctx.fillText(text, canvas.width / 2, y, canvas.width * 0.92);
    }
    start() {
      if (this.timer) return;
      this.stopped = false;
      if (this.automatic) this.enableAutomatic();
      this.render();
      // A timer keeps the capture progressing in background tabs more reliably
      // than rAF; Chrome can still throttle it. This is measured, not guaranteed.
      this.timer = setInterval(() => {
        try { this.render(); } catch (error) { this.stop(); this.onError?.(error); }
      }, 1000 / 30);
    }
    stop() {
      this.stopped = true; this.autoGeneration++;
      this.cancelDust(); this.modelAbort?.abort(); this.modelAbort = null;
      clearTimeout(this.autoTimer); this.autoTimer = null;
      this.finishWarmup?.(); this.finishWarmup = null;
      this.releaseAutomaticFrames(); this.autoReady = false;
      clearInterval(this.timer); this.timer = null;
      this.plate = null; this.background = null; this.frozen = null; this.tiles = null; this.held = null; this.clearImage();
    }
  }
  globalThis.MeetEffects = { Engine, dustTiles, clamp, waitForMedia, decodeBackground, captureEmptyRoom };
})();
