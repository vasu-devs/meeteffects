<img src="assets/icon.svg" width="64" height="64" alt="">

# MeetEffects

An experimental Chrome / Chromium / Brave extension for camera effects in Google
Meet, with a local studio for trying them. Version 0.4.3 adds finer disintegration, a denser dust plume and a 30 fps render target,
while keeping your movement live during disappearance. Capture your empty-room
photo immediately or after a five-second countdown. Real meme images
and optional sounds remain available; the MeetEffects button is now draggable.

## Install in Chrome, Chromium or Brave

**[Download the extension ZIP](https://github.com/vasu-devs/meeteffects/releases/latest)**
from Releases. The packaged model is included; no build, npm install, API key or
separate MeetEffects account is required.

1. Download `meeteffects-0.4.3.zip` from the release's **Assets** and extract it to
   a permanent folder, such as `Downloads/MeetEffects`. The folder should contain
   `manifest.json` directly. Keep it there while the extension is installed.
2. Open `chrome://extensions` (or `brave://extensions`), enable **Developer mode**,
   click **Load unpacked**, and select that extracted folder.
   If you downloaded the repository's source ZIP or cloned it instead, select its
   **`extension` subfolder**, not the repository root.
3. Reload the Meet tab. For later updates, replace the files in your installed
   folder, click **Reload** on the extension card, then reload Meet again.
   Chrome does not reload unpacked extensions automatically.
4. Keep your normal webcam selected. Turn on your camera and microphone and turn
   off Meet's built-in backgrounds/effects.
5. Open the **MeetEffects** pill. Click **Take room photo** to save the current
   camera view immediately, or click **5-second timer** and step out of frame.
   It saves that photo as the background behind you and says **Room ready—come back and snap**. Return to
   your seat. Person detection and snap listening start automatically. Snap once, or click
   **Turn to dust**. Keep moving as you dissolve; the room stays live afterward.
   Snap again to return, or click **Back to reality**. Drag the MeetEffects button
   wherever it does not overlap Meet; its position is remembered for this tab.

Check the outgoing result from a second device in a private test call before
using it in a meeting. The [live-call checklist](docs/LIVE-CALL-CHECKLIST.md)
explains that check. Your local self-view may mirror captions.

For a local preview, click the extension icon → **Try the effects studio** →
**Use camera + snaps**, then allow camera and microphone access. Alternatively run
`npm start` and open <http://localhost:8765>. The studio starts with a labelled
illustrated demo. **The studio alone does not change Meet's camera.** Open it
through the extension or localhost; opening its HTML directly as a file is not
supported.

## Effects

| Effect | Behavior | In-Meet shortcut |
| --- | --- | --- |
| Turn to dust | Live person tracking, erosion and moving grains; room stays live | Alt+Shift+1 |
| Absolute cinema | Monochrome, letterbox and the actual Scorsese reaction image | Alt+Shift+2 |
| I'm tired, boss | Live camera with the subtitled John Coffey film still | Alt+Shift+3 |
| This is fine | KC Green's dog in the burning room over your camera | Alt+Shift+4 |
| Your meme | Overlay a local PNG, JPEG, WebP or animated GIF | File picker |
| Back to reality | Restore ordinary video | Alt+Shift+0 |

Shortcuts work with the Meet tab focused, outside editable fields. The studio
uses number keys without modifiers. Custom assets are limited to 5 MiB and
16 megapixels. Animated GIFs use Chromium's ImageDecoder.

### Disappearance with your saved room

The packaged model continuously tracks your outline. The disappearance erodes
the current person image and emits grains while new camera frames keep arriving.
Person-relative erosion avoids screen-fixed pattern flicker; evenly distributed
grains drift into a gentle wind and fade, with at most 3,200 alive at once.
Decorative breakup runs independently of the lower-resolution detection mask.
The visible room keeps updating after you vanish. A second snap brings you back (a short cooldown avoids double
triggers). Person pixels are removed
using a mask paired with the frame that produced it; no trigger snapshot is held
during normal operation. Model processing stays local.

Click **Take room photo** to capture the current raw camera image immediately.
For time to step out of view, use **5-second timer**; it takes the photo at zero. Person detection
cannot delay or reject this photo, even if it misclassifies a chair or the room.
Make sure you have stepped out before the countdown reaches zero. No file upload
is required. Cancel, camera changes, camera interruption and reset
cancel a pending capture; an existing room photo is retained. Snaps pause during
setup. Take another photo whenever the framing or lighting changes. For an optional alternative, expand
**Or use a photo** and choose a PNG, JPEG or WebP up to 5 MiB / 16 megapixels.
The image is kept in memory for this tab and survives camera restarts.
Reopening/reloading the tab requires setting up the room again. The photo supplies the hidden area at output
resolution; the room outside your outline keeps moving. It is centered and cropped
to fill the camera aspect ratio, never stretched. Use the same camera position,
framing and lighting for a clean match. The photographed hidden area is static.
If detection fails, processed output holds until tracking recovers or you reset;
live video is not silently revealed.

**Snap detection uses sound, not a hand gesture.** Claps and desk taps can also
trigger it. The visible microphone meter helps check whether sound reaches the
detector. Meet's microphone must be unmuted, and noise suppression can remove
snaps. The extension reuses Meet's microphone without changing its audio settings
or capturing a second microphone. The standalone studio requests microphone
access automatically after camera startup. Turn off **Snap to disappear** to stop
listening. Browser permission prompts cannot be bypassed.

### Meme sounds

Turn on **Meme sounds** in the Meet panel to accompany a reaction with a short
percussion cue. The cue is mixed into the outgoing microphone only while it plays;
reset, disabling sounds, or microphone mute stops it. Sounds default off. In the
studio, the same toggle plays a local preview only. Keep the microphone unmuted
to send a cue to the call; the extension does not capture another microphone.

The three reaction pictures are the actual captioned images, bundled locally.
Cues are Kenney CC0 percussion, not movie dialogue. Exact image and audio sources
are recorded in [MEME-SOURCES.md](docs/MEME-SOURCES.md).

## Development

Use **Node.js 22 or later**, **Python 3**, and a current Chromium-based browser.
There are no npm dependencies to install.

```sh
git clone https://github.com/vasu-devs/meeteffects.git
cd meeteffects
npm test
python3 scripts/vendor-vision.py --check
python3 scripts/vendor-memes.py --check
npm run package
npm start
```

`npm start` serves the studio only on `127.0.0.1:8765`; stop it with Ctrl+C.
On systems where Python is named differently, run the equivalent scripts with
your Python 3 interpreter. To change effects, start with `extension/engine.js`;
`bridge.js` owns Meet camera integration, `panel.js` the movable controls, and
`studio.js` the standalone preview.

## Verification

`npm test` runs focused unit tests. `npm run test:browser` runs one installed
Chromium / Chrome for Testing instance with a disposable profile, synthetic media
and a local WebRTC receiver. No browser download is needed; set `CHROME_PATH` if
necessary. The runner stops its browser and local server in `finally`.

Coverage includes outgoing processed pixels, audio preservation, cloned tracks
and streams, camera toggles, source interruptions, cleanup, upload races,
permission denial, interrupted startup and real Web Audio snap bursts.

The segmentation gate uses the actual packaged model under strict CSP and Trusted
Types on a local studio, extension studio and intercepted Meet-origin fixture:

```sh
SEGMENTATION_SAMPLE=/path/to/segmentation_input_rotation0.jpg node tests/segmentation-browser.cjs
AUTOMATIC_SAMPLE=/path/to/segmentation_input_rotation0.jpg npm run test:browser
```

The sample is Google's MediaPipe test image, downloaded separately for validation;
see [dependency provenance](docs/THIRD-PARTY.md). The second command additionally
tests the fixed five-second capture deadline on both a synthetic camera and
a generated room scene, microphone startup and a generated snap through
the real model, live particle renderer and snap-back. It also checks native pointer
dragging, keyboard movement, viewport clamping and photo decoding. Reports and actual rendered frames go in `artifacts/`.
Generated audio is useful regression evidence, not physical-device calibration.

**A live Google Meet call, physical snap accuracy and prolonged background-tab
performance remain unverified.** Local WebRTC and strict-CSP fixtures do not establish real-call compatibility.
`npm run test:meet-page` is a separate actual-site smoke check; it does not sign in,
create or join a call, and reports a signed-out redirect as blocked.

## Architecture and privacy

Packaged MAIN-world scripts intercept `getUserMedia` at `document_start`. Native
permissions and constraints still apply. A canvas processes video at up to 960 px
wide with a 30 fps render/capture target and up to 24 matched masks/sec, returning
its captured video alongside unchanged microphone
tracks. Effect changes keep that output track. Screen sharing is untouched.
Controls live in an isolated-world shadow root.

Person detection processes one bounded frame at a time continuously while the
camera is active, skipping work instead of building an inference queue. Meet sends snapshots through an isolated-world
relay to extension-owned inference; local/extension studios run the same inference
directly. Packaged JS, WASM and model files require no runtime CDN. Dependency
versions, local transformations, licenses and hashes are documented in
[THIRD-PARTY.md](docs/THIRD-PARTY.md).

Frames, masks and meme images stay in memory until cleanup. There is no recording,
analytics, backend or frame upload. **Meet still transmits the processed camera and
normal microphone to your call.** MAIN-world scripts share Meet's trust boundary;
this is not isolation from Google or other page scripts.

A camera startup-processing failure returns the original camera with a visible
message. A rendering failure stops the affected output instead of silently
revealing raw video. Source interruption shows a black “Camera interrupted” frame.
A resolution change or processing interruption holds a safe processed frame while
tracking is re-established; it does not silently reveal the person.
Disable the extension and reload Meet to remove its hooks.

## Integration limitations

Chrome supports [MAIN-world content scripts](https://developer.chrome.com/docs/extensions/develop/concepts/content-scripts),
but Google provides no compatibility contract for camera interception. The
[Meet Media API](https://developers.google.com/workspace/meet/media-api/guides/get-started)
reads conference media; it does not inject outgoing effects. Rendering timers can
be throttled in background tabs. A native virtual camera remains a possible
alternative if real-call testing exposes transport problems; no native driver or
system package has been installed.

## Packaging

`npm run package` creates `artifacts/meeteffects-0.4.3.zip`, including all local
model assets. Extract it and load the extracted folder as an unpacked extension.
The extension has not been submitted to the Chrome Web Store.

## Licenses and credits

No license has been selected for the original project code; public availability
should not be read as a blanket license for this repository's contents.
MediaPipe and its model retain their Apache-2.0 notices, and Kenney's percussion
cues retain their CC0 notice. See [third-party notices](docs/THIRD-PARTY.md) and
[media provenance](docs/MEME-SOURCES.md).

The three meme pictures have **no verified open redistribution license**. Their
sources and known creators are documented; the model/audio licenses do not cover
those pictures. This experimental project is not affiliated with Google Meet,
Google, or the people depicted in the memes.
