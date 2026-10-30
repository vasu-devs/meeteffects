/* Engine checks for the parent's browser harness. No camera or network upload. */
globalThis.runLiveDustTests = async function runLiveDustTests({ actualModel = true } = {}) {
  const checks = [], metrics = {}, frames = {}, engines = [];
  const assert = (condition, message) => { if (!condition) throw new Error(message); checks.push(message); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label, timeout = 18000) => {
    const start = performance.now();
    while (!predicate()) { if (performance.now() - start > timeout) throw new Error(label); await delay(10); }
  };
  const canvas = () => { const c = document.createElement('canvas'); c.width = 640; c.height = 360; return c; };
  const pixel = (c, x, y) => [...c.getContext('2d').getImageData(x, y, 1, 1).data];
  const realSegment = MeetEffects.segmentFrame;
  let active = 0, maxActive = 0, injectFailure = false, suspended = null, statusChanges = 0;
  let stream, video, sourceTimer;
  const source = canvas(), output = canvas(), photo = canvas(), ctx = source.getContext('2d');
  const photoContext = photo.getContext('2d'), detail = photoContext.createImageData(640, 360);
  for (let y = 0; y < 360; y++) for (let x = 0; x < 640; x++) {
    detail.data.set([x % 2 ? 55 : 15, y % 2 ? 110 : 50, (x + y) % 2 ? 200 : 50, 255], (y * 640 + x) * 4);
  }
  photoContext.putImageData(detail, 0, 0);
  const cleanPhoto = await MeetEffects.decodeBackground(photo.toDataURL());
  let position = 160, green = 85, red = 235;
  const paint = () => {
    ctx.fillStyle = `rgb(20,${green},140)`; ctx.fillRect(0, 0, 640, 360);
    ctx.fillStyle = `rgb(${red},20,30)`; ctx.fillRect(position, 70, 110, 290);
  };
  const maskFor = c => {
    const rgba = c.getContext('2d').getImageData(0, 0, c.width, c.height).data, mask = new Uint8Array(c.width * c.height);
    for (let i = 0; i < mask.length; i++) mask[i] = rgba[i * 4] > 140 && rgba[i * 4 + 1] < 45 ? 255 : 0;
    return { mask, width: c.width, height: c.height };
  };
  try {
    // Deterministic segmentation of a moving synthetic person permits exact pixel assertions.
    MeetEffects.segmentFrame = async c => {
      const result = maskFor(c); active++; maxActive = Math.max(maxActive, active);
      try {
        if (suspended) await suspended.promise;
        else await delay(7);
        if (injectFailure) throw new Error('Synthetic inference failure');
        return result;
      } finally { active--; }
    };
    paint();
    const engine = new MeetEffects.Engine(source, output, () => statusChanges++); engines.push(engine);
    engine.start(); engine.enableAutomatic();
    await wait(() => engine.autoReady, 'Warm mask never arrived');
    engine.trigger('cinema'); const started = engine.started;
    let missingPhoto = '';
    try { await engine.trigger('dust'); } catch (error) { missingPhoto = error.message; }
    assert(missingPhoto === 'Take a room photo first.' && engine.effect === 'cinema' && engine.started === started,
      'Missing photo rejects dust before changing the active effect');
    engine.setBackground(cleanPhoto);
    assert(engine.background === cleanPhoto && engine.effect === 'cinema' && engine.started === started,
      'Installing a shared photo does not trigger or reset an effect');
    engine.reset();
    const callbacks = statusChanges;
    await delay(150);
    assert(statusChanges === callbacks, 'Steady frame updates do not flood status callbacks');
    stream = output.captureStream(30); const track = stream.getVideoTracks()[0];
    video = document.createElement('video'); video.muted = true; video.srcObject = stream; await video.play();
    let delivered = 0, watching = true, frameCallback; const deliveredTimes = [];
    const onFrame = now => { delivered++; deliveredTimes.push(now); if (watching) frameCallback = video.requestVideoFrameCallback(onFrame); };
    frameCallback = video.requestVideoFrameCallback(onFrame);
    await engine.trigger('dust'); engine.render();
    assert(!engine.dustPending && !engine.held, 'Warm trigger starts immediately without a frozen snapshot');
    frames.before = output.toDataURL();
    const updates = engine.liveStats.updates;
    position = 300; green = 155; red = 190; paint();
    await wait(() => engine.liveStats.updates >= updates + 2, 'Moving frame did not process'); engine.render();
    assert(pixel(output, 40, 100)[1] > 145, 'Visible room changes during erosion');
    assert(pixel(output, 315, 200)[0] > 160 && pixel(output, 180, 200)[0] < 60, 'Still-visible person moves with the source during erosion');
    frames.during = output.toDataURL();
    assert(engine.live.frame !== engine.source && !engine.frozen && !engine.held, 'Automatic dust renders matched live pairs, not the manual frozen frame');
    const start = performance.now(), firstUpdate = engine.liveStats.updates, firstRender = engine.liveStats.renders, firstVideo = delivered;
    sourceTimer = setInterval(() => { position = 260 + Math.round(40 * Math.sin(performance.now() / 180)); green = 90 + Math.round(30 * Math.sin(performance.now() / 120)); paint(); }, 33);
    await delay(1000); frames.midTransition = output.toDataURL();
    await delay(400);
    clearInterval(sourceTimer); sourceTimer = null;
    const duration = (performance.now() - start) / 1000;
    metrics.synthetic = { updatesPerSecond: (engine.liveStats.updates - firstUpdate) / duration,
      rendersPerSecond: (engine.liveStats.renders - firstRender) / duration, outputFramesPerSecond: (delivered - firstVideo) / duration,
      latencyMs: engine.liveStats.latencyMs, maxActive, particles: engine.particles.length };
    const intervals = deliveredTimes.slice(1).map((v, i) => v - deliveredTimes[i]).sort((a, b) => a - b);
    metrics.synthetic.frameIntervalMedianMs = intervals[Math.floor(intervals.length / 2)];
    metrics.synthetic.frameIntervalP95Ms = intervals[Math.floor(intervals.length * 0.95)];
    assert(metrics.synthetic.outputFramesPerSecond >= 25 && metrics.synthetic.frameIntervalP95Ms < 85,
      'Delivered video stays fluid without long frame stalls');
    assert(maxActive === 1 && engine.particles.length <= 3200, 'Inference and particles stay bounded');
    assert(metrics.synthetic.updatesPerSecond >= 15, 'Synthetic moving stream processes at least 15 updates/second');
    engine.started = performance.now() - 5000;
    position = 350; green = 70; paint();
    let target = engine.liveStats.updates + 2;
    await wait(() => engine.liveStats.updates >= target, 'Hidden frame did not process'); engine.render(performance.now() + 2000);
    const firstBackground = pixel(output, 40, 100);
    assert(pixel(output, 380, 200)[0] < 80, 'Person remains hidden at its current location');
    const hiddenDetail = output.getContext('2d').getImageData(380, 200, 8, 8).data;
    const expectedDetail = cleanPhoto.getContext('2d').getImageData(380, 200, 8, 8).data;
    assert(hiddenDetail.every((v, i) => v === expectedDetail[i]), 'Hidden person reveals exact high-detail uploaded photo pixels');
    green = 180; position = 450; paint(); target = engine.liveStats.updates + 2;
    await wait(() => engine.liveStats.updates >= target, 'Hidden moving background did not process'); engine.render();
    assert(pixel(output, 40, 100)[1] > firstBackground[1] + 80, 'Room keeps moving after full disappearance');
    assert(pixel(output, 480, 200)[0] < 80 && pixel(output, 380, 200)[1] > 160, 'Hidden person moves without leaving its old silhouette');
    frames.hidden = output.toDataURL();
    injectFailure = true;
    await wait(() => !!engine.autoError, 'Inference failure was not reported');
    ctx.fillStyle = '#ff0000'; ctx.fillRect(0, 0, 640, 360); engine.render();
    assert(!!engine.held && pixel(output, 480, 200)[0] < 80, 'Inference failure holds processed output without revealing raw camera');
    injectFailure = false; paint();
    await wait(() => engine.autoReady && !engine.held, 'Stream did not recover after failure');
    assert(engine.effect === 'dust', 'Recovery preserves hidden state');
    suspended = {}; suspended.promise = new Promise(resolve => { suspended.resolve = resolve; });
    await wait(() => active === 1, 'No in-flight frame for cancellation test');
    engine.reset(); suspended.resolve(); suspended = null;
    await delay(80); engine.render();
    assert(engine.effect === 'none' && !engine.held && pixel(output, 480, 200)[0] > 160, 'Reset restores live video and an old result cannot restore dust');
    assert(engine.background === cleanPhoto, 'Reset retains the uploaded photo');
    await engine.trigger('dust'); engine.started = performance.now() - 5000; engine.render();
    engine.resize(800, 450);
    assert(engine.background === cleanPhoto, 'Resize retains the uploaded photo');
    assert(!!engine.held, 'Resize retains processed output until a matching new pair arrives');
    await wait(() => engine.autoReady && !engine.held, 'Resized stream did not recover'); engine.render();
    assert(pixel(output, 600, 250)[0] < 80, 'Resize never restores the hidden person');
    assert(stream.getVideoTracks()[0] === track && track.readyState === 'live', 'Trigger, reset and resize preserve the output track');
    suspended = {}; suspended.promise = new Promise(resolve => { suspended.resolve = resolve; });
    await wait(() => active === 1, 'No pending inference for stop test');
    const abort = engine.modelAbort; engine.stop(); suspended.resolve(); suspended = null; await delay(40);
    assert(abort.signal.aborted && !engine.timer && !engine.autoTimer && !engine.live && !engine.room && !engine.autoInFlight, 'Stop aborts pending inference and releases timers and frame buffers');
    assert(engine.background === null && cleanPhoto.width === 640 && cleanPhoto.height === 360 &&
      pixel(cleanPhoto, 381, 200).every((v, i) => v === pixel(photo, 381, 200)[i]),
      'Stop releases its photo reference without mutating the shared photo');
    watching = false; video.cancelVideoFrameCallback(frameCallback); video.pause(); video.srcObject = null; stream.getTracks().forEach(t => t.stop()); stream = null;

    if (actualModel) {
      const sample = new Image(); sample.src = '/tests/automatic-sample.jpg'; await sample.decode();
      MeetEffects.segmentFrame = realSegment;
      const actualSource = canvas(), actualOutput = canvas(), actualContext = actualSource.getContext('2d');
      const draw = () => {
        const phase = performance.now() / 350, offset = Math.sin(phase) * 14;
        actualContext.fillStyle = '#607c91'; actualContext.fillRect(0, 0, 640, 360);
        actualContext.drawImage(sample, offset, 0, 640, 360);
        actualContext.fillStyle = `rgb(20,${100 + Math.round(70 * Math.sin(phase))},90)`; actualContext.fillRect(0, 0, 25, 360);
      };
      draw(); sourceTimer = setInterval(draw, 1000 / 24);
      const actual = new MeetEffects.Engine(actualSource, actualOutput); engines.push(actual);
      actual.setBackground(cleanPhoto);
      const renderCosts = [], nativeRender = actual.render.bind(actual);
      actual.render = (...args) => {
        const before = performance.now(); nativeRender(...args);
        if (actual.effect === 'dust' && before - actual.started < 2900) renderCosts.push(performance.now() - before);
      };
      actual.start(); actual.enableAutomatic();
      stream = actualOutput.captureStream(30); video.srcObject = stream; await video.play();
      watching = true; delivered = 0; deliveredTimes.length = 0;
      frameCallback = video.requestVideoFrameCallback(onFrame);
      await wait(() => actual.autoReady, 'Actual model failed to warm: ' + actual.autoError);
      assert(actual.live.mask.some(v => v >= 128), 'Bundled actual model detects a person in the local sample');
      await actual.trigger('dust');
      await delay(1100); frames.actualDuring = actualOutput.toDataURL();
      const begin = performance.now(), updatesBefore = actual.liveStats.updates, rendersBefore = actual.liveStats.renders, videoBefore = delivered;
      const latencies = [], sampler = setInterval(() => latencies.push(actual.liveStats.latencyMs), 100);
      try { await delay(3500); } finally { clearInterval(sampler); }
      const elapsed = (performance.now() - begin) / 1000;
      latencies.sort((a, b) => a - b);
      const actualIntervals = deliveredTimes.slice(1).map((v, i) => v - deliveredTimes[i]).sort((a, b) => a - b);
      renderCosts.sort((a, b) => a - b);
      metrics.actualModel = { outputFramesPerSecond: (delivered - videoBefore) / elapsed,
        frameIntervalMedianMs: actualIntervals[Math.floor(actualIntervals.length / 2)],
        frameIntervalP95Ms: actualIntervals[Math.floor(actualIntervals.length * 0.95)],
        activeRenderP95Ms: renderCosts[Math.floor(renderCosts.length * 0.95)], updatesPerSecond: (actual.liveStats.updates - updatesBefore) / elapsed,
        rendersPerSecond: (actual.liveStats.renders - rendersBefore) / elapsed,
        latencyMedianMs: latencies[Math.floor(latencies.length / 2)], latencyP95Ms: latencies[Math.floor(latencies.length * 0.95)],
        inferenceSize: [actual.live.width, actual.live.height], outputSize: [640, 360], error: actual.autoError };
      assert(!actual.autoError && actual.liveStats.updates - updatesBefore > 20, 'Actual model keeps processing moving input throughout disappearance');
      assert(metrics.actualModel.updatesPerSecond >= 15, 'Actual model reaches at least 15 processed updates/second');
      assert(metrics.actualModel.rendersPerSecond >= 27, 'Output rendering stays near 30 frames/second');
      assert(metrics.actualModel.activeRenderP95Ms < 33.4 && metrics.actualModel.frameIntervalP95Ms < 85,
        'Real-model active breakup fits the render budget and delivers steady video frames');
      frames.actualHidden = actualOutput.toDataURL();
      watching = false; video.cancelVideoFrameCallback(frameCallback); video.pause(); video.srcObject = null;
      stream.getTracks().forEach(t => t.stop()); stream = null;
      actual.stop(); clearInterval(sourceTimer); sourceTimer = null;
    }
    return { ok: true, checks, metrics, frames, limitation: 'Synthetic motion plus bundled model on a local public image; no live Meet call. Hidden person reveals the supplied empty-room photo.' };
  } catch (error) { return { ok: false, checks, metrics, frames, error: error.stack }; }
  finally {
    clearInterval(sourceTimer); suspended?.resolve();
    for (const e of engines) e.stop();
    video?.pause(); if (video) video.srcObject = null;
    stream?.getTracks().forEach(t => t.stop());
    MeetEffects.segmentFrame = realSegment;
  }
};
