# Local person segmentation

The extension bundles Google's MediaPipe Tasks Vision **0.10.21** and the official
**SelfieSegmenter landscape, float16, version 1** model. All inference is local.
The application never fetches scripts/models from a CDN, uploads frames, or opens
a camera/microphone through this module.

## Provenance and licenses

- MediaPipe Authors / Google: [source release v0.10.21](https://github.com/google-ai-edge/mediapipe/tree/v0.10.21),
  [published package](https://www.npmjs.com/package/@mediapipe/tasks-vision/v/0.10.21).
  Apache-2.0; the upstream license and bundled third-party notices are preserved
  in `extension/vendor/LICENSE`, and package metadata is retained in `package.json`.
- Google: [pinned model](https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter_landscape/float16/1/selfie_segmenter_landscape.tflite).
  The [official model card](https://storage.googleapis.com/mediapipe-assets/Model%20Card%20MediaPipe%20Selfie%20Segmentation.pdf)
  identifies Apache License 2.0. Authors: Tingbo Hou, Siargy Pisarchyk and Karthik
  Raveendran, Google. Model card dated May 6, 2021. This is the 144 × 256 RGB
  landscape model; its one confidence channel represents person probability.
- The test photograph is Google's public
  [segmentation_input_rotation0.jpg](https://storage.googleapis.com/mediapipe-assets/segmentation_input_rotation0.jpg),
  shown in the [official segmentation guide](https://developers.google.com/edge/mediapipe/solutions/vision/image_segmenter/web_js).
  It is a Pascal VOC example; it is **not redistributed in this repository or extension**.
  Tests read a separately downloaded local copy and never upload it.

Only the SIMD WASM variant is included, for the Chromium browsers targeted by
this MV3 extension. No non-SIMD fallback, source maps, npm tree, GPU model, or
archive is installed. The CJS bundle body is unmodified; `vision-bundle.js` adds a
small classic-script closure with a local `exports` object and exposes its result
as `MeetEffectsVision`. The modification is declared in its header. Its upstream
source-map comment is retained, but no map is bundled or needed at runtime.

Vendored file sizes:

- `vision-bundle.js`: 138,065 bytes (137,890-byte upstream body plus wrapper).
- `vision_wasm_internal.js`: 204,284 bytes.
- `vision_wasm_internal.wasm`: 9,574,032 bytes.
- `selfie_segmenter_landscape.tflite`: 250,177 bytes.
- `LICENSE`: 12,331 bytes; `package.json`: 592 bytes; plus `SHA256SUMS`.

Total vendor payload: **10,179,999 bytes**. `extension/vendor/SHA256SUMS` contains
every delivered asset's SHA-256. `scripts/vendor-vision.py` pins original URLs,
exact sizes and SHA-256 values, verifies before writing, and caps the vendor
directory at 20 MiB. It downloads individual files, never an npm archive.

```sh
python3 scripts/vendor-vision.py --check  # offline verification
# Re-create from pinned sources only when a download is authorized:
python3 scripts/vendor-vision.py
# Or reuse an existing local source download:
python3 scripts/vendor-vision.py --from-dir /tmp/meeteffects-segment-inspect
```

## API and resource lifecycle

Load `segment-client.js` after `engine.js`. It adds:

```js
const { mask, width, height } = await MeetEffects.segmentFrame(canvas, { signal });
```

Input is a readable 2D canvas, 1–512 pixels per side. The independent `Uint8Array`
output has **the same dimensions and orientation as the supplied canvas**:
0 = background, 255 = person (confidence threshold 0.5). No mirroring is applied.
MediaPipe's callback-owned mask is copied before its views are freed. Smaller
native masks are mapped to input dimensions by nearest-neighbor sampling.

Each client holds one pending request. A newer call rejects the previous promise
with `AbortError`; callers with multiple camera sessions should serialize calls.
An AbortSignal, page exit, or a 15-second deadline rejects pending work and sends
cancellation. IDs and client tokens prevent stale responses from settling later
requests. The host keeps at most one running plus one queued frame, each at most
1 MiB of RGBA. The extension worker accepts one frame across tabs and replies
with a busy error if another tab is processing. It does not grow a global queue.

Only one model exists per inference context, initialized lazily and closed after
60 seconds idle; Chrome may stop an idle service worker sooner. Initialization
fetches have a 15-second abort timer. Cancellation closes/aborts initialization.
Window messages transfer buffers; Chromium's JSON runtime messaging uses bounded
base64 only between the isolated host and the extension worker. Nothing is saved
to storage. A synchronous inference already executing cannot be interrupted;
its result is discarded after cancellation/deadline. In Meet it executes outside
the page thread; local studio inference can briefly block its own thread.

## Runtime integration

The manifest and studio load the following model components alongside the camera
engine and controls. The engine now submits continuous bounded frames, with at
most one request in flight and no accumulating queue:

```json
{
  "background": { "service_worker": "segment-worker.js" },
  "content_security_policy": {
    "extension_pages": "script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"
  },
  "content_scripts": [
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["engine.js", "segment-client.js"],
      "run_at": "document_start",
      "world": "MAIN"
    },
    {
      "matches": ["https://meet.google.com/*"],
      "js": ["segment-host.js"],
      "run_at": "document_start",
      "world": "ISOLATED"
    }
  ]
}
```

Other MAIN scripts load after `segment-client.js`. The isolated panel's
entry remains separate. **No segmentation web-accessible resources, host permissions,
offscreen permission, or camera permission are required.** `segment-worker.js` is the service worker;
`background.js` is an image-reconstruction helper, not this service worker.

Studio script order (before its existing `studio.js`, retaining its other helpers):

```html
<script src="engine.js"></script>
<script src="segment-client.js"></script>
<script src="vendor/vision-bundle.js"></script>
<script src="vendor/vision_wasm_internal.js"></script>
<script src="segment-inference.js"></script>
<script src="segment-host.js"></script>
```

Supported: a loaded `chrome-extension://` studio, HTTP localhost studio, and Meet
via actual MV3 injection. **Opening studio directly as `file://` is unsupported**
(opaque origin/local fetch restrictions). Localhost may use the normal project
server; if a CSP is added, allow same-origin scripts/assets and
`'wasm-unsafe-eval'` in its script policy. Meet's page policy is never changed.

## Why an extension worker

The pinned [MediaPipe graph runner](https://github.com/google-ai-edge/mediapipe/blob/v0.10.21/mediapipe/web/graph_runner/graph_runner.ts)
skips its script loader when `wasmLoaderPath` is empty, using a preloaded
`ModuleFactory`. We verified that path and use it. However, under
`default-src 'self'; script-src 'self'; require-trusted-types-for 'script'`, both
installed Chromium 145 and 156 rejected even a valid empty WASM module in the
isolated world (`CompileError: WebAssembly.compile():`). The same real model
worked in extension-page and localhost contexts. Thus preloading alone did not
satisfy the strict-page gate. The small service worker gives inference its own
extension policy, without an offscreen-document architecture. The page only
snapshots pixels; the isolated host validates and relays them. Bundled scripts
are imported by the worker; page DOM script insertion and eval are not used.

## Focused verification

```sh
node --test --test-concurrency=1 tests/segmentation.test.cjs
SEGMENTATION_SAMPLE=/tmp/meeteffects-segment-inspect/segmentation-sample.jpg \
SEGMENTATION_REPORT=/tmp/meeteffects-segmentation-report.json \
node tests/segmentation-browser.cjs
```

The sample SHA-256 is
`5bf58d8af1f1c33224f3f3bc0ce451c8daf0739cc15a86d59d8c3bf2879afb97` (16,741 bytes).
`CHROME_PATH` can select an already installed Chromium. The raw-CDP harness makes
a temporary extension copy in `/tmp`, injects it through real MV3 content-script
entries, and serves all Meet fixture requests locally under strict CSP. It also
tests the extension and localhost studios. Every host report must pass before
the overall report says `ok: true`. Tests cover genuine off-center person/forest
classification, a blank frame, copied masks, dimensions, cancellation, supersession,
oversize input, page exit/restore, and absence of camera acquisition. Network
observation includes both the page and service worker; every request must be a
known local resource and a GET without an upload body. The unit suite covers
missing-host timeout, malformed/stale replies, abort, and lifecycle recovery.

The harness closes only its own headless browser/server and removes its temporary
profile/extension copy in `finally`. This proves local model/bridge integration;
it does not prove a live Google Meet call, reconstruction quality, or all lighting
and clothing conditions.
