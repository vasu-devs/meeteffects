(() => {
  'use strict';
  if (document.getElementById('meeteffects-host')) return;
  const host = document.createElement('div'); host.id = 'meeteffects-host';
  // Shadow DOM prevents Meet's styles from changing the controls. DOM APIs also
  // work on pages enforcing Trusted Types; no innerHTML or remote stylesheet.
  const shadow = host.attachShadow({ mode: 'closed' });
  const sheet = new CSSStyleSheet();
  sheet.replaceSync(`
    :host { all: initial; position: fixed; top: 88px; right: 18px; z-index: 2147483646; color: #202622; font: 14px/1.45 'Trebuchet MS', sans-serif; }
    * { box-sizing: border-box; } button, input { font: inherit; } button { cursor: pointer; }
    button:focus-visible, input:focus-visible { outline: 3px solid #6b812c; outline-offset: 2px; }
    .toggle { display: block; margin-left: auto; border: 1px solid #d8ded7; border-radius: 22px; padding: 10px 16px; background: #deef91; color: #202622; font-weight: bold; box-shadow: 0 3px 12px #0002; cursor: grab; touch-action: none; user-select: none; }
    .toggle:active { cursor: grabbing; }
    .deck { position: absolute; right: 0; width: min(306px, calc(100vw - 36px)); max-height: calc(100dvh - 170px); overflow: auto; margin-top: 8px; padding: 20px; background: #f1f3ef; border: 1px solid #d8ded7; border-radius: 12px; box-shadow: 0 12px 40px #0003; }
    [hidden] { display: none !important; } h2 { font-size: 23px; margin: 0 0 5px; letter-spacing: -.7px; } p { margin: 7px 0 12px; } .small { font-size: 12px; color: #606b63; }
    .effect { display: flex; align-items: center; justify-content: space-between; width: 100%; text-align: left; border: 1px solid #d8ded7; background: white; color: #202622; border-radius: 5px; padding: 11px; margin: 6px 0; }
    .effect[aria-pressed=true] { background: #deef91; border-color: #6b812c; } .effect:disabled { opacity: .55; cursor: not-allowed; }
    kbd { font: inherit; font-size: 11px; color: #606b63; } .reset { font-weight: bold; }
    .status { font-size: 12px; min-height: 35px; overflow-wrap: anywhere; } .error { color: #9a2721; }
    meter { width: 100%; height: 9px; display: block; margin: 6px 0; } .snap-note { font-size: 11px; color: #606b63; }
    label { display: block; margin-top: 12px; } input[type=file] { width: 100%; font-size: 12px; margin: 6px 0; }
    .meme-thumb { width: 38px; height: 36px; object-fit: cover; border-radius: 3px; margin-right: 9px; } .effect-name { flex: 1; } .sound-note { font-size: 11px; color: #606b63; }
    .room-now { background: #deef91; font-weight: bold; } summary { cursor: pointer; } details { font-size: 12px; margin: 10px 0; }
  `);
  shadow.adoptedStyleSheets = [sheet];
  const el = (tag, text, parent, cls) => { const n = document.createElement(tag); if (text) n.textContent = text; if (cls) n.className = cls; parent?.append(n); return n; };
  const toggle = el('button', 'MeetEffects', shadow, 'toggle');
  toggle.setAttribute('aria-expanded', 'false');
  toggle.title = 'Drag to move. Click to open effects. Alt + arrow keys also move it.';
  const deck = el('section', '', shadow, 'deck'); deck.hidden = true;
  deck.setAttribute('aria-label', 'MeetEffects controls');
  let position = null, drag = null, ignoreClickUntil = 0;
  function place(x, y, save = true) {
    const width = host.getBoundingClientRect().width, height = toggle.getBoundingClientRect().height;
    position = {x:Math.max(8, Math.min(x, innerWidth - width - 8)), y:Math.max(8, Math.min(y, innerHeight - height - 8))};
    host.style.right = 'auto'; host.style.left = '0px'; host.style.top = '0px';
    host.style.transform = `translate(${position.x}px, ${position.y}px)`;
    // Open upward near the bottom edge; keep all controls reachable by scrolling.
    const below = innerHeight - position.y - height - 16, above = position.y - 16;
    const alignLeft = position.x + width < Math.min(306, innerWidth - 36) + 8;
    deck.style.left = alignLeft ? '0px' : 'auto'; deck.style.right = alignLeft ? 'auto' : '0px';
    const upward = below < 260 && above > below;
    deck.style.bottom = upward ? `${height + 8}px` : 'auto';
    deck.style.top = upward ? 'auto' : `${height}px`;
    deck.style.maxHeight = `${Math.max(40, upward ? above : below)}px`;
    if (save) { try { sessionStorage.setItem('meeteffects-position', JSON.stringify(position)); } catch { /* Storage can be disabled. */ } }
  }
  function keepOnscreen() {
    const rect = host.getBoundingClientRect();
    place(position?.x ?? rect.left, position?.y ?? rect.top, false);
  }
  toggle.onclick = event => {
    if (event?.detail && performance.now() < ignoreClickUntil) return;
    deck.hidden = !deck.hidden; toggle.setAttribute('aria-expanded', String(!deck.hidden)); keepOnscreen(); send('status');
  };
  toggle.onpointerdown = event => {
    if (event.button !== 0 || event.isPrimary === false) return;
    const rect = host.getBoundingClientRect();
    drag = {id:event.pointerId,x:event.clientX,y:event.clientY,left:rect.left,top:rect.top,moved:false};
    toggle.setPointerCapture(event.pointerId);
  };
  toggle.onpointermove = event => {
    if (!drag || event.pointerId !== drag.id) return;
    const dx = event.clientX - drag.x, dy = event.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx,dy) < 5) return;
    drag.moved = true; event.preventDefault(); place(drag.left + dx, drag.top + dy);
  };
  const finishDrag = event => {
    if (!drag || event.pointerId !== drag.id) return;
    if (drag.moved) ignoreClickUntil = performance.now() + 400;
    drag = null;
    if (toggle.hasPointerCapture(event.pointerId)) toggle.releasePointerCapture(event.pointerId);
  };
  toggle.onpointerup = finishDrag; toggle.onpointercancel = finishDrag; toggle.onlostpointercapture = finishDrag;
  toggle.addEventListener('keydown', event => {
    if (!event.altKey || !['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(event.key)) return;
    event.preventDefault(); const rect = host.getBoundingClientRect();
    place(rect.left + (event.key === 'ArrowRight' ? 24 : event.key === 'ArrowLeft' ? -24 : 0), rect.top + (event.key === 'ArrowDown' ? 24 : event.key === 'ArrowUp' ? -24 : 0));
  });
  addEventListener('resize', keepOnscreen);
  el('h2', 'Make an exit.', deck);
  const state = el('p', 'Turn on your Meet camera to connect.', deck, 'status'); state.setAttribute('role', 'status');
  const roomNow = el('button', 'Take room photo', deck, 'effect room-now'); roomNow.disabled = true;
  const roomCaptureButton = el('button', '5-second timer', deck, 'effect room-capture');
  roomCaptureButton.setAttribute('aria-label', '5-second room timer'); roomCaptureButton.disabled = true;
  const roomInfo = el('p', 'Take a photo of the empty room now, or use the timer to step away. That photo fills the space behind you.', deck, 'small');
  roomInfo.setAttribute('role', 'status');
  const roomDetails = el('details', '', deck); el('summary', 'Or use a photo', roomDetails);
  const roomLabel = el('label', 'Before image · empty room', roomDetails);
  const roomUpload = el('input', '', roomLabel); roomUpload.type = 'file'; roomUpload.accept = 'image/png,image/jpeg,image/webp'; roomUpload.setAttribute('aria-label', 'Empty-room before image');
  let roomRead = null, roomVersion = 0, roomCapturing = false;
  function takeRoomPhoto(immediate = false) {
    roomVersion++; roomRead?.abort(); roomRead = null;
    send(roomCapturing && !immediate ? 'background-capture-cancel' : 'background-capture', {immediate});
  }
  roomNow.onclick = () => takeRoomPhoto(true);
  roomCaptureButton.onclick = () => takeRoomPhoto();
  roomUpload.onchange = () => {
    const file = roomUpload.files[0]; if (!file) return;
    const version = ++roomVersion; roomRead?.abort(); roomRead = null;
    send('background-start');
    if (file.size > 5 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) { send('background-cancel'); roomUpload.value = ''; return; }
    const reader = roomRead = new FileReader();
    reader.onload = () => { if (version !== roomVersion) return; roomRead = null; send('background', {data:reader.result}); };
    reader.onerror = () => { if (version === roomVersion) { roomRead = null; send('background-cancel'); } };
    reader.readAsDataURL(file); roomUpload.value = '';
  };
  const snapLabel = el('label', '', deck);
  const snap = el('input', '', snapLabel); snap.type = 'checkbox'; snap.checked = true;
  snapLabel.append(document.createTextNode(' Snap to disappear'));
  snap.onchange = () => send(snap.checked ? 'snap-on' : 'snap-off');
  const meter = el('meter', '', deck); meter.min = 0; meter.max = 1; meter.value = 0; meter.setAttribute('aria-label', 'Microphone level');
  const snapInfo = el('p', 'Waiting for your Meet microphone.', deck, 'snap-note');
  const buttons = new Map();
  let actionVersion = 0, pendingRead = null;
  function cancelRead() { actionVersion++; pendingRead?.abort(); pendingRead = null; }
  for (const [effect, label, key] of [['dust','Turn to dust','1'], ['cinema','Absolute cinema','2'], ['tired',"I’m tired, boss",'3'], ['brb','Mentally out of office','4'], ['none','Back to reality','0']]) {
    const asset = globalThis.MeetEffects?.memeAssets?.[effect];
    const b = el('button', asset?.image ? '' : label, deck, `effect ${effect === 'none' ? 'reset' : ''}`);
    if (asset?.image) {
      const image = el('img', '', b, 'meme-thumb'); image.src = asset.image; image.alt = '';
      el('span', asset.label, b, 'effect-name');
    }
    el('kbd', `Alt+Shift+${key}`, b); b.setAttribute('aria-pressed', 'false');
    b.disabled = true;
    b.onclick = () => send('effect', { effect });
    buttons.set(effect, b);
  }
  const soundLabel = el('label', '', deck);
  const sounds = el('input', '', soundLabel); sounds.type = 'checkbox';
  soundLabel.append(document.createTextNode(' Meme sounds'));
  sounds.onchange = () => send('sound', { enabled: sounds.checked });
  const soundInfo = el('p', 'Off. Enable to send clips with your microphone.', deck, 'sound-note');
  const customLabel = el('label', 'Bring your own meme', deck);
  const upload = el('input', '', customLabel); upload.type = 'file'; upload.accept = 'image/png,image/jpeg,image/webp,image/gif';
  upload.onchange = async () => {
    cancelRead();
    const file = upload.files[0]; if (!file) return;
    if (file.size > 5 * 1024 * 1024 || !['image/png','image/jpeg','image/webp','image/gif'].includes(file.type)) {
      state.textContent = 'Use a PNG, JPEG, WebP or GIF smaller than 5 MB.'; upload.value = ''; return;
    }
    const reader = new FileReader();
    pendingRead = reader; const version = actionVersion;
    reader.onload = () => { if (version !== actionVersion) return; pendingRead = null; send('image', { data: reader.result }); };
    reader.onerror = () => { if (version === actionVersion) { pendingRead = null; state.textContent = 'Could not read that image.'; } };
    reader.readAsDataURL(file); upload.value = '';
  };
  el('p', 'Your room photo replaces the hidden area; the rest stays live. Snaps use sound; claps and taps may also trigger dust.', deck, 'small');
  el('p', 'Effects go out with your camera. Turn off Meet backgrounds and other camera-effect extensions. Alt+Shift shortcuts work while this tab has focus.', deck, 'small');
  function send(type, extra = {}) {
    if (['effect', 'plate', 'image', 'snap-on', 'background-capture', 'background-capture-cancel'].includes(type)) cancelRead();
    document.dispatchEvent(new CustomEvent('meeteffects:command', { detail: JSON.stringify({ type, ...extra }) }));
  }
  document.addEventListener('meeteffects:status', event => {
    try {
      if (typeof event.detail !== 'string' || event.detail.length > 4000) return;
      const s = JSON.parse(event.detail);
      state.textContent = s.message || (s.interrupted ? 'Camera interrupted. Check the webcam or privacy shutter.' : s.cameras ?
        (!s.background ? 'Camera connected. Take a room photo to enable dust.' : s.preparing ? 'Starting live disappearance…' : s.autoReady ? 'Camera connected. Live dust is ready.' : 'Camera connected. Warming up live detection…') : 'Turn on your Meet camera to connect.');
      state.classList.toggle('error', !!s.message || !!s.interrupted);
      snap.checked = s.snapWanted !== false;
      meter.value = Math.min(1, (s.snapLevel || 0) * 4);
      snapInfo.textContent = s.backgroundCapturing ? 'Snaps pause while the room is captured.' : !snap.checked ? 'Snaps off. Turn to dust still works.' : s.snapPending ? 'Starting snap detection…' : s.snap ?
        (s.micOn ? 'Listening. Snap to vanish; snap again to return.' : 'Unmute your Meet microphone to use snaps.') : 'Waiting for your Meet microphone.';
      sounds.checked = !!s.sound?.enabled;
      roomCapturing = !!s.backgroundCapturing;
      roomCaptureButton.disabled = !s.cameras;
      roomNow.disabled = !s.cameras;
      roomCaptureButton.textContent = roomCapturing ? 'Cancel setup' : '5-second timer';
      roomInfo.textContent = roomCapturing ? (s.backgroundCapture?.phase === 'countdown' ? `Step out of frame. Taking photo in ${s.backgroundCapture.seconds}…` : 'Taking the room photo…') : s.backgroundLoading ? 'Loading your room photo…' : s.backgroundError || (s.background ? 'Room ready—come back and snap. Keep the camera fixed.' : 'Take a photo of the empty room now, or use the timer to step away. That photo fills the space behind you.');
      roomInfo.classList.toggle('error', !!s.backgroundError);
      soundInfo.textContent = s.sound?.error || (!sounds.checked ? 'Off. Enable to send clips with your microphone.' : s.sound?.connected ? 'On. Clips go to the call while your mic is unmuted.' : 'On. Waiting for the call microphone.');
      for (const [effect, b] of buttons) {
        b.disabled = !s.cameras || (effect === 'dust' && (roomCapturing || !s.background));
        b.setAttribute('aria-pressed', String(s.effect === effect));
      }
      upload.disabled = !s.cameras;
      if (!s.cameras) cancelRead();
    } catch { /* Ignore malformed messages from page scripts. */ }
  });
  addEventListener('keydown', event => {
    if (!event.altKey || !event.shiftKey || event.ctrlKey || event.metaKey || event.repeat) return;
    if (event.composedPath().some(n => n instanceof Element && (n.matches('input,textarea,select') || n.isContentEditable))) return;
    const effect = { Digit0:'none', Digit1:'dust', Digit2:'cinema', Digit3:'tired', Digit4:'brb' }[event.code];
    if (effect) { event.preventDefault(); send('effect', { effect }); }
  });
  addEventListener('pagehide', () => { cancelRead(); roomVersion++; roomRead?.abort(); roomRead = null; drag = null; });
  document.documentElement.append(host);
  try { const saved = JSON.parse(sessionStorage.getItem('meeteffects-position')); if (saved && Number.isFinite(saved.x) && Number.isFinite(saved.y)) place(saved.x, saved.y, false); } catch { /* Use default placement. */ }
  send('status');
})();
