/* Shared only by the extension worker and local studio, never Meet MAIN. */
(() => {
  'use strict';
  const factory = globalThis.ModuleFactory, vision = globalThis.MeetEffectsVision;
  const base = globalThis.chrome?.runtime?.id
    ? chrome.runtime.getURL('vendor/')
    : new URL('vendor/', document.currentScript.src).href;
  let model = null, loading = null, idleTimer = null, generation = 0;
  function close() {
    generation++; loading?.abort(); clearTimeout(idleTimer); idleTimer = null;
    model?.close(); model = null;
  }
  async function getModel() {
    if (model) return model;
    const epoch = generation;
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 15000);
    loading = controller;
    try {
      // Pre-fetch bounded local assets so cancellation also stops initialization I/O.
      const read = async (name, size) => {
        const response = await fetch(base + name, { signal: controller.signal });
        if (!response.ok) throw new Error('Bundled person detection asset is missing.');
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength !== size) throw new Error('Bundled person detection asset has an unexpected size.');
        return bytes;
      };
      const [wasm, weights] = await Promise.all([
        read('vision_wasm_internal.wasm', 9574032), read('selfie_segmenter_landscape.tflite', 250177)
      ]);
      if (controller.signal.aborted || epoch !== generation) throw new DOMException('Segmentation cancelled.', 'AbortError');
      globalThis.ModuleFactory = factory;
      globalThis.Module = { wasmBinary: new Uint8Array(wasm) };
      const created = await vision.ImageSegmenter.createFromOptions({
        // The pinned loader skips runScript() when this is empty (see THIRD-PARTY).
        wasmLoaderPath: '', wasmBinaryPath: base + 'vision_wasm_internal.wasm'
      }, {
        baseOptions: { modelAssetBuffer: new Uint8Array(weights), delegate: 'CPU' },
        runningMode: 'IMAGE', outputCategoryMask: false, outputConfidenceMasks: true
      });
      if (controller.signal.aborted || epoch !== generation) { created.close(); throw new DOMException('Segmentation cancelled.', 'AbortError'); }
      model = created;
      return model;
    } finally {
      clearTimeout(timer); loading = null;
      globalThis.Module = undefined; globalThis.ModuleFactory = undefined;
    }
  }
  async function segment(job) {
    clearTimeout(idleTimer);
    try {
      const segmenter = await getModel();
      if (job.cancelled || Date.now() > job.deadline) throw new DOMException('Segmentation cancelled.', 'AbortError');
      const input = new ImageData(new Uint8ClampedArray(job.pixels), job.width, job.height);
      job.pixels = null;
      let mask;
      // This pinned model's one confidence channel is person probability.
      // Copy inside the callback; MediaPipe frees the returned views afterward.
      segmenter.segment(input, result => {
        const confidence = result.confidenceMasks?.[0];
        if (!confidence) throw new Error('Person detection returned no mask.');
        const values = confidence.getAsFloat32Array();
        mask = new Uint8Array(job.width * job.height);
        for (let y = 0; y < job.height; y++) for (let x = 0; x < job.width; x++) {
          const sx = Math.min(confidence.width - 1, Math.floor(x * confidence.width / job.width));
          const sy = Math.min(confidence.height - 1, Math.floor(y * confidence.height / job.height));
          mask[y * job.width + x] = values[sy * confidence.width + sx] >= 0.5 ? 255 : 0;
        }
      });
      return { mask: mask.buffer, width: job.width, height: job.height };
    } catch (error) { close(); throw error; }
    finally { idleTimer = setTimeout(close, 60000); }
  }
  globalThis.MeetEffectsSegmenter = { segment, close };
})();
