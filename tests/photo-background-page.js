/* Optional focused checks for the parent's single combined browser run. */
globalThis.runPhotoBackgroundTests = async function runPhotoBackgroundTests() {
  const checks = [], engines = [], realSegment = MeetEffects.segmentFrame;
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const canvas = (width, height) => Object.assign(document.createElement('canvas'), { width, height });
  const pixels = (c, x, y, w = 1, h = 1) => c.getContext('2d').getImageData(x, y, w, h).data;
  const same = (a, b) => a.length === b.length && a.every((value, i) => value === b[i]);
  let fullPerson = false, fail = false;
  try {
    const photo = canvas(800, 360), pc = photo.getContext('2d'), detail = pc.createImageData(800, 360);
    for (let y = 0; y < 360; y++) for (let x = 0; x < 800; x++) {
      detail.data.set([x % 251, y % 251, (x + y) % 2 ? 210 : 35, 255], (y * 800 + x) * 4);
    }
    pc.putImageData(detail, 0, 0);
    const background = await MeetEffects.decodeBackground(photo.toDataURL());
    assert(background !== photo && same(pixels(background, 200, 120, 8, 8), pixels(photo, 200, 120, 8, 8)),
      'Decoding creates an independent exact PNG snapshot');
    for (const type of ['image/jpeg', 'image/webp']) {
      const decoded = await MeetEffects.decodeBackground(photo.toDataURL(type));
      assert(decoded.width === 800 && decoded.height === 360, `${type} decodes without changing aspect`);
    }
    const large = canvas(1600, 900), scaled = await MeetEffects.decodeBackground(large.toDataURL());
    assert(scaled.width === 960 && scaled.height === 540, 'Photo decode bounds the longest dimension to 960');
    large.width = 1; large.height = 1;
    for (const input of ['data:image/gif;base64,R0lGODlh', 'data:image/png;base64,R0lGODlh',
      'data:image/png;base64,iVBORw0KGgo=', 'data:image/png;base64,' + 'A'.repeat(7_000_000)]) {
      let rejected = false; try { await MeetEffects.decodeBackground(input); } catch { rejected = true; }
      assert(rejected, 'Invalid, mislabeled, corrupt or oversized photo is rejected');
    }
    MeetEffects.segmentFrame = async c => {
      if (fail) throw new Error('Synthetic photo inference failure');
      const data = pixels(c, 0, 0, c.width, c.height), mask = new Uint8Array(c.width * c.height);
      for (let i = 0; i < mask.length; i++) mask[i] = fullPerson || (data[i * 4] > 200 && data[i * 4 + 1] < 40) ? 255 : 0;
      return { width: c.width, height: c.height, mask };
    };
    const source = canvas(640, 360), output = canvas(640, 360), sc = source.getContext('2d');
    const paint = (x, green = 80) => {
      sc.fillStyle = `rgb(18,${green},130)`; sc.fillRect(0, 0, 640, 360);
      sc.fillStyle = 'rgb(240,20,30)'; sc.fillRect(x, 80, 120, 240);
    };
    const engine = new MeetEffects.Engine(source, output); engines.push(engine);
    engine.automatic = true;
    const update = async () => { await engine.updateAutomatic(); clearTimeout(engine.autoTimer); engine.autoTimer = null; };
    paint(160); await update();
    assert(engine.autoReady && !engine.background, 'Tracking warms independently of photo upload');
    engine.setBackground(background); await engine.trigger('dust', 0); engine.render(5000);
    assert(same(pixels(output, 200, 120, 16, 16), pixels(background, 280, 120, 16, 16)),
      'Hidden person reveals exact output-resolution photo detail with centered crop');
    assert(same(pixels(output, 40, 40), pixels(source, 40, 40)), 'Room outside the person stays live');
    paint(320, 170); await update(); engine.render(5000);
    assert(same(pixels(output, 360, 120, 16, 16), pixels(background, 440, 120, 16, 16)),
      'Moving hidden person reveals photo at its current location');
    assert(same(pixels(output, 200, 120), pixels(source, 200, 120)), 'Previous person location returns to live room');
    fullPerson = true; await update(); engine.render(5000);
    assert(engine.autoReady && !engine.autoError && same(pixels(output, 40, 40), pixels(background, 120, 40)),
      'Uploaded photo works when the person fills the entire frame');
    const beforeFailure = pixels(output, 0, 0, 640, 360);
    fail = true; await update(); sc.fillStyle = '#ff0000'; sc.fillRect(0, 0, 640, 360); engine.render(6000);
    assert(engine.held && same(pixels(output, 0, 0, 640, 360), beforeFailure), 'Inference failure holds processed photo output');
    fail = false; await update(); engine.render(6000);
    assert(engine.autoReady && !engine.held && engine.effect === 'dust', 'Inference recovery retains disappearance');
    engine.resize(800, 450); assert(engine.held && engine.background === background, 'Resize holds processed output and retains photo');
    await update(); engine.render(6000);
    const reference = canvas(800, 450); reference.getContext('2d').drawImage(background, -100, 0, 1000, 450);
    assert(same(pixels(output, 200, 100, 16, 16), pixels(reference, 200, 100, 16, 16)), 'Resize uses center-cover without stretching photo');
    engine.reset(); engine.render();
    assert(engine.background === background && pixels(output, 400, 200)[0] === 255, 'Reset restores raw live camera and retains the photo');
    const saved = pixels(background, 200, 120, 16, 16); engine.stop();
    assert(engine.background === null && background.width === 800 && background.height === 360 && same(saved, pixels(background, 200, 120, 16, 16)),
      'Stopping releases only the engine reference to shared photo');
    return { ok: true, checks };
  } catch (error) { return { ok: false, checks, error: error.stack }; }
  finally { for (const engine of engines) engine.stop(); MeetEffects.segmentFrame = realSegment; }
};
