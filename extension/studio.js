(() => {
  'use strict';
  const $ = id => document.getElementById(id);
  const output = $('output'), notice = $('notice');
  let engine, cameraStream, microphoneStream, stopSnap, generation = 0, snapGeneration = 0, effectGeneration = 0;
  let cameraAbort = null, snapAbort = null;
  let cameraMode = false, closed = false;
  let roomImage = null, roomVersion = 0, roomRead = null;
  let roomCapture = null, roomProgress = null;
  const labels = { none:'No effect', dust:'Turn to dust', cinema:'Absolute cinema', tired:'I’m tired, boss', brb:'Mentally out of office', custom:'Your meme' };
  let sound;
  function updateSound() {
    const state = sound?.getState() || {};
    $('sounds').checked = !!state.enabled;
    $('sound-state').textContent = state.error || (state.enabled ? 'On. Clips play here; Meet has its own sound toggle.' : 'Off. Enable to hear clips in this preview.');
    $('sound-state').classList.toggle('error', !!state.error);
  }
  sound = MeetEffects.createPreviewSound?.(updateSound);
  for (const [effect, asset] of Object.entries(MeetEffects.memeAssets || {})) {
    const button = document.querySelector(`[data-effect="${effect}"]`);
    if (!button || !asset.image) continue;
    labels[effect] = asset.label;
    button.querySelector('strong').textContent = asset.label;
    button.querySelector('small').textContent = asset.description || 'A real reaction, on your live camera.';
    const image = new Image(); image.src = asset.image; image.alt = ''; image.className = 'meme-thumb';
    button.prepend(image);
  }
  function message(text, error = false) { notice.textContent = text; notice.classList.toggle('error', error); }
  function cancelRoomCapture() {
    if (!roomCapture) return;
    roomVersion++; roomCapture.abort(); roomCapture = null; roomProgress = null;
    $('room-state').textContent = roomImage ? 'Setup cancelled. Your previous room photo is kept.' : 'Setup cancelled. Take a room photo when you are ready.';
    update();
  }
  function saveRoom(image, captured = false) {
    roomImage = image;
    if (cameraMode) engine.setBackground(image);
    $('room-preview').src = image.toDataURL('image/jpeg', .8); $('room-preview').hidden = false;
    $('room-state').textContent = captured ? 'Room saved—come back and snap. Keep the camera fixed.' : 'Photo ready. Kept for this tab, including camera restarts. Keep the camera fixed.';
    update();
  }
  function stopListening() {
    snapGeneration++; stopSnap?.(); stopSnap = null;
    snapAbort?.abort(); snapAbort = null;
    microphoneStream?.getTracks().forEach(t => t.stop()); microphoneStream = null;
    $('snap').checked = false; $('mic-level').value = 0; $('snap-state').textContent = 'Snap listening is off.';
  }
  function release() {
    cancelRoomCapture();
    cameraAbort?.abort(); cameraAbort = null;
    sound?.stopCue();
    stopListening(); engine?.stop();
    if (engine?.source instanceof HTMLVideoElement) { engine.source.pause(); engine.source.srcObject = null; }
    cameraStream?.getTracks().forEach(t => t.stop()); cameraStream = null;
  }
  function update() {
    for (const b of document.querySelectorAll('[data-effect]')) {
      b.setAttribute('aria-pressed', String(b.dataset.effect === engine.effect));
      b.disabled = b.dataset.effect === 'dust' && (!!roomCapture || (cameraMode && !engine.background));
    }
    $('effect-label').textContent = labels[engine.effect];
    $('room-capture').disabled = !cameraMode;
    $('room-now').disabled = !cameraMode;
    $('room-capture').textContent = roomCapture ? 'Cancel setup' : '5-second timer';
    if (roomProgress) $('room-state').textContent = roomProgress.phase === 'countdown' ? `Step out of frame. Taking photo in ${roomProgress.seconds}…` : 'Taking the room photo…';
    $('dust-state').textContent = cameraMode && !engine.background ? 'Take a room photo to use behind you when you vanish.' : engine.dustPending ? 'Starting live disappearance…' : engine.autoError ||
      (engine.automatic ? (engine.autoReady ? 'Live dust is ready. Keep moving.' : 'Warming up live person detection…') : 'Demo dust is ready.');
  }
  function drawDemo(person) {
    const c = document.createElement('canvas'); c.width = 960; c.height = 540;
    const x = c.getContext('2d');
    x.fillStyle = '#b5c3b4'; x.fillRect(0,0,960,540);
    x.fillStyle = '#dbe1d1'; x.fillRect(0,0,355,540);
    x.fillStyle = '#eaf0e7'; x.fillRect(45,50,245,300);
    x.fillStyle = '#adc2bd'; x.fillRect(57,62,221,276);
    x.fillStyle = '#dbe1d1'; x.fillRect(160,60,10,280); x.fillRect(55,193,225,10);
    x.fillStyle = '#637b73'; x.beginPath(); x.moveTo(58,300); x.lineTo(100,237); x.lineTo(150,275); x.lineTo(210,215); x.lineTo(278,290); x.lineTo(278,338); x.lineTo(58,338); x.fill();
    x.fillStyle = '#72896d'; x.fillRect(698,80,165,125);
    x.fillStyle = '#e0debf'; x.fillRect(709,91,143,103);
    x.strokeStyle='#748065'; x.lineWidth=3; x.beginPath(); x.arc(780,144,31,0,Math.PI*2); x.stroke();
    x.fillStyle='#89947d'; x.fillRect(653,334,244,10);
    x.fillStyle='#3e654f';
    for(let i=0;i<7;i++){x.beginPath();x.ellipse(773+Math.sin(i*2)*45,260-i*8,15,40,i*.9,0,Math.PI*2);x.fill();}
    x.fillStyle='#c2b395'; x.beginPath(); x.moveTo(742,285); x.lineTo(805,285); x.lineTo(794,333); x.lineTo(752,333); x.fill();
    x.fillStyle='#8b9d85'; x.fillRect(0,458,960,82);
    if (person) {
      x.fillStyle='#4b5d54'; x.beginPath(); x.roundRect(333,299,292,250,80); x.fill();
      x.fillStyle='#e4b38f'; x.fillRect(444,292,73,67);
      x.fillStyle='#ce9676'; x.beginPath(); x.ellipse(480,296,37,26,0,0,Math.PI); x.fill();
      x.fillStyle='#ebb995'; x.beginPath(); x.ellipse(480,224,85,104,0,0,Math.PI*2); x.fill();
      x.beginPath(); x.ellipse(396,236,13,23,0,0,Math.PI*2); x.ellipse(565,236,13,23,0,0,Math.PI*2); x.fill();
      x.fillStyle='#3f4234'; x.beginPath(); x.moveTo(399,223); x.bezierCurveTo(365,107,466,83,529,132); x.bezierCurveTo(594,132,585,214,562,230); x.lineTo(548,177); x.bezierCurveTo(495,209,447,151,413,196); x.fill();
      x.strokeStyle='#3f4234'; x.lineWidth=6; x.beginPath(); x.moveTo(424,219);x.lineTo(452,216);x.moveTo(504,216);x.lineTo(531,219);x.stroke();
      x.fillStyle='#3f4234'; x.beginPath();x.ellipse(441,235,5,7,0,0,Math.PI*2);x.ellipse(517,235,5,7,0,0,Math.PI*2);x.fill();
      x.strokeStyle='#bf8566';x.lineWidth=3;x.beginPath();x.moveTo(478,236);x.lineTo(469,262);x.lineTo(485,265);x.stroke();
      x.strokeStyle='#734c3b';x.lineWidth=4;x.beginPath();x.arc(481,269,25,.25,2.8);x.stroke();
      x.strokeStyle='#e4b38f';x.lineWidth=31;x.lineCap='round';x.beginPath();x.moveTo(377,401);x.lineTo(339,486);x.moveTo(584,402);x.lineTo(621,486);x.stroke();
    }
    x.fillStyle='#cbc3ab';x.fillRect(0,501,960,39);
    x.fillStyle='#6b7770';x.beginPath();x.roundRect(378,448,212,95,10);x.fill();
    x.fillStyle='#c4ccc4';x.beginPath();x.arc(483,491,9,0,Math.PI*2);x.fill();
    return c;
  }
  function useDemo() {
    generation++; release(); cameraMode = false;
    output.width = 960; output.height = 540;
    const source = drawDemo(false);
    engine = new MeetEffects.Engine(source, output, update);
    engine.onError = () => { release(); message('Demo rendering stopped. Reload the studio to retry.', true); };
    engine.capturePlate(); source.getContext('2d').drawImage(drawDemo(true),0,0);
    engine.start();
    $('source-label').textContent='Demo scene'; $('demo-tag').hidden=false;
    $('camera').textContent='Use camera + snaps'; $('camera').disabled=false; $('demo').hidden=true;
    $('privacy').textContent='Camera is off. Try an effect.';
    message('Try the demo, or use your camera and snap to disappear.'); update();
  }
  $('camera').onclick = async () => {
    cancelRoomCapture();
    const attempt = ++generation; $('camera').disabled=true;
    cameraAbort?.abort(); const controller = new AbortController(); cameraAbort = controller;
    message('Waiting for camera permission…');
    let stream, video, replaced = false;
    const cancel = () => { stream?.getTracks().forEach(t => t.stop()); if (video) { video.pause(); video.srcObject = null; } };
    controller.signal.addEventListener('abort', cancel, { once: true });
    try {
      if (!navigator.mediaDevices?.getUserMedia) throw new Error('Camera access needs localhost or a secure page.');
      stream = await navigator.mediaDevices.getUserMedia({ video:{width:{ideal:960},height:{ideal:540},frameRate:{ideal:30,max:30}}, audio:false });
      if (attempt !== generation || closed || controller.signal.aborted) { cancel(); return; }
      video = document.createElement('video'); video.muted=true; video.playsInline=true; video.srcObject=stream;
      await MeetEffects.waitForMedia(video.play(), controller.signal);
      if (attempt !== generation || closed || controller.signal.aborted) { cancel(); return; }
      controller.signal.removeEventListener('abort', cancel); cameraAbort = null;
      replaced = true; release(); cameraStream=stream; cameraMode=true;
      const factor=Math.min(1,960/video.videoWidth);
      output.width=Math.round(video.videoWidth*factor); output.height=Math.round(video.videoHeight*factor);
      engine=new MeetEffects.Engine(video,output,update);
      if (roomImage) engine.setBackground(roomImage);
      const owner = engine;
      engine.onError = error => { if (engine !== owner || closed) return; useDemo(); message(`Camera rendering stopped: ${error.message}. Camera released; demo restored.`, true); };
      engine.start(); engine.enableAutomatic();
      stream.getVideoTracks()[0].addEventListener('ended',()=>{if(cameraStream===stream&&!closed){useDemo();message('Camera disconnected. Switched back to the demo.',true);}}, {once:true});
      $('source-label').textContent='Your camera preview'; $('demo-tag').hidden=true;
      $('demo').hidden=false; $('camera').textContent='Restart camera';
      $('privacy').textContent='Local preview. No recording or upload.';
      message(roomImage ? 'Camera ready. Snap or click Turn to dust.' : 'Camera ready. Take a room photo now, or use the 5-second timer to step away.'); update();
      void startListening();
    } catch(error) {
      cancel();
      if(attempt===generation&&!closed&&error.name!=='AbortError') {
        if (replaced) useDemo();
        message(`Camera could not start: ${error.message}. Your previous preview remains available.`,true);
      }
    } finally {
      controller.signal.removeEventListener('abort', cancel);
      if (cameraAbort === controller) cameraAbort = null;
      if(attempt===generation&&!closed)$('camera').disabled=false;
    }
  };
  $('demo').onclick=useDemo;
  async function effect(name) {
    cancelRoomCapture();
    const version = ++effectGeneration, owner = engine;
    sound?.stopCue();
    try {
      await owner.trigger(name);
      if (owner !== engine || version !== effectGeneration || closed) return;
      if (name !== 'none' && name !== 'dust') void sound?.play(name).catch(updateSound);
      message(name==='dust'?'Vanishing live. Back to reality brings you back.':name==='none'?'Back to your regular camera.':`${labels[name]} is on. Clear it with Back to reality.`);
    } catch(error) { if (owner === engine && version === effectGeneration) message(error.message,true); }
  }
  for(const b of document.querySelectorAll('[data-effect]'))b.onclick=()=>effect(b.dataset.effect);
  async function takeRoomPhoto(immediate = false) {
    if (roomCapture) { cancelRoomCapture(); if (!immediate) return; }
    if (!cameraMode) return;
    const version = ++roomVersion, owner = engine, controller = new AbortController();
    effectGeneration++;
    roomRead?.abort(); roomRead = null; roomCapture = controller;
    sound?.stopCue();
    try {
      const image = await MeetEffects.captureEmptyRoom(owner, {immediate,signal:controller.signal,onProgress:progress=>{
        if (roomCapture !== controller) return;
        roomProgress = progress; update();
      }});
      if (version !== roomVersion || owner !== engine || closed || controller.signal.aborted) return;
      roomCapture = null; roomProgress = null;
      saveRoom(image, true); message('Room saved—come back and snap to disappear.');
    } catch (error) {
      if (version === roomVersion && !closed && error.name !== 'AbortError') $('room-state').textContent = error.message;
    } finally {
      if (roomCapture === controller) { roomCapture = null; roomProgress = null; update(); }
    }
  }
  $('room-now').onclick = () => takeRoomPhoto(true);
  $('room-capture').onclick = () => takeRoomPhoto();
  $('room-image').onchange = async () => {
    const file = $('room-image').files[0]; if (!file) return;
    cancelRoomCapture();
    const version = ++roomVersion; roomRead?.abort();
    try {
      if (file.size > 5 * 1024 * 1024 || !['image/png','image/jpeg','image/webp'].includes(file.type)) throw new Error('Use a PNG, JPEG or WebP smaller than 5 MB.');
      $('room-state').textContent = 'Loading your room photo…';
      const data = await new Promise((resolve, reject) => {
        const reader = roomRead = new FileReader();
        reader.onload = () => resolve(reader.result);
        reader.onerror = () => reject(new Error('Could not read the room photo.'));
        reader.onabort = () => reject(new DOMException('Photo replaced.', 'AbortError'));
        reader.readAsDataURL(file);
      });
      const image = await MeetEffects.decodeBackground(data);
      if (version !== roomVersion || closed) return;
      saveRoom(image);
    } catch (error) {
      if (version === roomVersion && !closed && error.name !== 'AbortError') $('room-state').textContent = error.message;
    } finally {
      if (version === roomVersion) { roomRead = null; $('room-image').value = ''; }
    }
  };
  $('meme').onchange=async()=>{
    const file=$('meme').files[0];if(!file)return;
    cancelRoomCapture(); update();
    const owner=engine;
    const version=++effectGeneration;
    try{
      if(file.size>5*1024*1024)throw new Error('Choose an image smaller than 5 MB.');
      const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=()=>reject(new Error('Could not read image.'));r.readAsDataURL(file);});
      await owner.setImage(data); if(owner!==engine||closed||version!==effectGeneration)return;
      effect('custom');
    }catch(error){message(error.message,true);}finally{$('meme').value='';}
  };
  async function startListening() {
    stopListening(); $('snap').checked = true;
    const attempt=++snapGeneration;
    const controller = new AbortController(); snapAbort = controller;
    $('snap-state').textContent = 'Waiting for microphone permission…';
    let stream,stop;
    try {
      stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:false,noiseSuppression:false,autoGainControl:false},video:false});
      if(attempt!==snapGeneration||closed){stream.getTracks().forEach(t=>t.stop());return;}
      microphoneStream = stream;
      stop=await MeetEffects.listenForSnap(stream.getAudioTracks()[0],()=>{
        if (roomCapture) return;
        void effect(engine.effect==='dust'?'none':'dust');
      },()=>{
        if(attempt!==snapGeneration)return;
        stopListening();message('Microphone disconnected. Turn Snap to disappear on to reconnect.',true);
      },controller.signal,level=>{if(attempt===snapGeneration)$('mic-level').value=Math.min(1,level*4);});
      if(attempt!==snapGeneration||closed){stop();stream.getTracks().forEach(t=>t.stop());return;}
      microphoneStream=stream;stopSnap=stop;
      $('snap-state').textContent = 'Listening. Snap to vanish; snap again to return.';
    } catch(error) {
      stop?.();stream?.getTracks().forEach(t=>t.stop());
      if(attempt===snapGeneration){stopListening();$('snap-state').textContent=`Microphone unavailable: ${error.message}. Turn to dust still works.`;}
    }
  }
  $('snap').onchange=()=>{
    if(!$('snap').checked){stopListening();return;}
    void startListening();
  };
  $('sounds').onchange = async () => {
    try { await sound?.setEnabled($('sounds').checked); } catch { /* Audio state carries its error. */ }
    updateSound();
  };
  addEventListener('keydown',event=>{
    if(event.ctrlKey||event.altKey||event.metaKey||event.repeat||event.target.matches('input,textarea,select')||event.target.isContentEditable)return;
    const name={Digit0:'none',Digit1:'dust',Digit2:'cinema',Digit3:'tired',Digit4:'brb'}[event.code];
    if(name){event.preventDefault();effect(name);}
  });
  addEventListener('pagehide',()=>{closed=true;generation++;roomVersion++;roomRead?.abort();roomRead=null;roomImage=null;release();void sound?.dispose();});
  useDemo();
})();
