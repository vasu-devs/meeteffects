# Live Google Meet acceptance

These are remaining manual acceptance checks, not claimed passes. Use a test call
with a second device/participant, not a work meeting. No invitations are sent by
the extension or test runner.

## Five-minute first test

1. In Chrome/Brave, open `chrome://extensions` or `brave://extensions`, enable
   Developer mode, and choose **Load unpacked**. Select the extracted release
   folder containing `manifest.json`, or the repository's `extension` folder.
   [Download a release](https://github.com/vasu-devs/meeteffects/releases/latest).

   If already installed, click **Reload** on the MeetEffects extension card.
   Then reload any open Google Meet tab. Keep your usual webcam selected.
2. Start an ordinary private meeting in Google Meet. Allow camera access, enable
   your camera, and turn off Meet's built-in backgrounds/effects.
3. Click **MeetEffects** near the top right. Its status should start with
   **Camera connected**. Click **Absolute cinema**: your picture should become
   monochrome with black bars and the Scorsese reaction image. Click **Back to reality** to reset.
4. Join the same meeting from your phone or a second device. Turn off that
   device's microphone and speaker/volume to avoid echo. Watch your laptop's
   camera tile there while toggling the effect. That is the outgoing-video check;
   seeing an effect in the laptop's own preview alone does not prove it.
5. On the laptop, click **Take room photo** for an immediate shot, or **5-second timer**
   to step out before the photo is taken. Wait until the room is saved, return to your seat, then snap with the Meet
   microphone unmuted. Keep moving while you dissolve. The phone should see your motion continue,
   then the live room while you remain hidden. Snap again or click **Back to reality** to return. The captured room photo fills the area behind you.
   Try the **Turn to dust** button too; this separates sound detection from the
   visual effect if a snap is missed.

If something fails:

- **No MeetEffects pill:** confirm the extension is enabled and allowed on
  `meet.google.com`, then reload Meet. Check that you loaded `extension`, not the
  repository root. Chrome's extension card may show an **Errors** button.
- **Pill says camera is disconnected:** enable the Meet camera and allow site
  camera permission. If already enabled, reload Meet after reloading the extension.
- **An "original camera" fallback message:** the compositor did not start. Record
  the exact message; do not treat the original feed as a successful effect test.
- **Effect is visible on the laptop but missing on the phone:** remote delivery
  has failed. Record browser/version, effect, and MeetEffects status so the media
  handoff can be investigated.
- **Snaps do nothing:** check that Snap to disappear is on and its meter moves.
  Unmute the Meet microphone. Noise suppression may filter the sound; try the
  button to check the visual effect independently.
- **Detection is loading or failed:** wait for the status, or record the exact
  error. A frozen picture after failure is intentional; reset to return.
- **Room edges do not match after disappearing:** keep the camera fixed and use
  a before photo with the same framing and lighting. Take another room photo if framing or lighting has changed.
- **Text looks backwards only on your laptop:** check the phone; Meet can mirror
  the self-preview.

## Longer acceptance check

- [ ] Install in the actual Chrome/Chromium/Brave version you use; reload Meet.
- [ ] Disable built-in backgrounds and other camera processing extensions.
- [ ] Confirm normal video and microphone audio from the other device.
- [ ] Confirm Scorsese cinema, John Coffey tired, This Is Fine, PNG and animated GIF from that device.
- [ ] Enable Meme sounds and confirm the other device hears a cue plus normal speech.
- [ ] Check mute, reset and sounds-off each stop the cue; microphone audio recovers.
- [ ] Take a room photo (also try the timer), return and snap to turn to dust, keep moving, then snap back.
- [ ] Drag the MeetEffects button away from Meet controls; click still opens it.
- [ ] Toggle the camera off/on and confirm the saved room photo remains selected.
- [ ] Toggle the camera off/on five times; check hardware indicator and browser capture state.
- [ ] Change the physical camera and resolution; verify held output and reset behavior.
- [ ] Check microphone mute/unmute, replacement and snap toggle cleanup.
- [ ] Make 20 snap attempts and record detections; spend two minutes speaking,
      gesturing and typing to record false triggers. Buttons remain the fallback.
- [ ] Background the Meet tab for at least six minutes and watch the remote video.
- [ ] Run a 15-minute call, checking responsiveness, CPU/memory trend and audio sync.
- [ ] Leave the meeting; ensure camera capture ends. If Meet intentionally retains
      preview capture on its post-call page, close that tab and verify release.
- [ ] Disable the extension and reload Meet to confirm ordinary camera behavior.

Record browser/OS, camera, each result and observed limitations here or in an issue.
If Meet rejects the canvas track or hidden-tab video freezes, reassess the transport
before adding more effects. The native virtual-camera route is the fallback;
do not solve a capture-lifecycle bug by leaving the camera running indefinitely.
