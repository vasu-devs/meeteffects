/* Full studio path: generated camera + generated snap audio, real local ML. */
async function runAutomaticStudioTest() {
  const $ = id => document.getElementById(id), checks = [], frames = {};
  const assert = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const wait = async (predicate, label, timeout = 18000) => {
    const began = performance.now();
    while (!predicate()) { if (performance.now() - began > timeout) throw new Error(label + ': ' + $('notice').textContent + ' / ' + $('dust-state').textContent + ' / ' + $('snap-state').textContent); await delay(50); }
  };
  const nativeGum = navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
  const source = document.createElement('canvas'); source.width = 640; source.height = 360;
  const image = new Image(); image.src = '/tests/automatic-sample.jpg'; await image.decode();
  let personVisible = true;
  const draw = () => {
    const context = source.getContext('2d');
    context.fillStyle='#607c91'; context.fillRect(0,0,source.width,source.height);
    if (personVisible) context.drawImage(image, Math.sin(performance.now()/350)*12, 0, source.width, source.height);
    context.fillStyle = Math.floor(performance.now() / 240) % 2 ? '#e63c41' : '#1fa14a';
    context.fillRect(580,10,40,40);
  };
  draw(); const sourceTimer = setInterval(draw, 33);
  const camera = source.captureStream(30), audio = new AudioContext(); await audio.resume();
  const destination = audio.createMediaStreamDestination(), silence = audio.createConstantSource();
  silence.offset.value = 0; silence.connect(destination); silence.start();
  const mic = destination.stream;
  const canvas = $('output');
  let recorder, recording, chunks = [], recordingStream;
  const acquisitions = [];
  navigator.mediaDevices.getUserMedia = async constraints => {
    acquisitions.push(constraints.video ? 'camera' : 'microphone');
    return constraints.video ? camera.clone() : mic.clone();
  };
  try {
    $('camera').click();
    await wait(() => $('source-label').textContent === 'Your camera preview' && $('snap-state').textContent.startsWith('Listening.'), 'Automatic camera and snap startup');
    assert(document.querySelector('[data-effect=dust]').disabled, 'Camera dust waits for room setup');
    $('room-capture').click();
    assert($('room-capture').textContent==='Cancel setup'&&$('room-state').textContent.includes('5'),'Room setup starts a visible five-second countdown');
    $('room-capture').click();
    assert($('room-preview').hidden&&$('room-state').textContent.includes('cancelled'),'Cancel setup does not save a room photo');
    const setupBegan=performance.now();$('room-capture').click();
    await delay(1200);personVisible=false;
    assert($('room-preview').hidden,'Setup gives time to step away before taking the photo');
    await wait(()=>$('room-state').textContent.startsWith('Room saved')&&!$('room-preview').hidden,'Automatic empty-room capture',5000);
    assert(performance.now()-setupBegan>=5000&&performance.now()-setupBegan<6000,'Room photo saves at the five-second deadline without a model approval wait');
    await $('room-preview').decode();
    const room=document.createElement('canvas');room.width=640;room.height=360;room.getContext('2d').drawImage($('room-preview'),0,0,640,360);
    const pixel=room.getContext('2d').getImageData(320,180,1,1).data;
    assert(Math.abs(pixel[0]-96)<6&&Math.abs(pixel[1]-124)<6&&Math.abs(pixel[2]-145)<6,'Saved photo contains the raw empty room without the person');
    const immediateBegan=performance.now();$('room-capture').click();$('room-now').click();
    await wait(()=>$('room-state').textContent.startsWith('Room saved')&&$('room-capture').textContent==='5-second timer','Immediate studio room photo',1000);
    assert(performance.now()-immediateBegan<1000,'Take room photo replaces a pending studio timer immediately');
    personVisible=true;await delay(250);
    assert(!document.querySelector('[data-effect=dust]').disabled,'Automatic capture enables live dust without a file upload');
    assert(!$('snap').disabled && $('snap').checked, 'Snap listening arms automatically');
    assert(acquisitions.join() === 'camera,microphone', 'One camera and one microphone acquisition');
    const original = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    frames.before = canvas.toDataURL('image/png');
    recordingStream = canvas.captureStream(30);
    recorder = new MediaRecorder(recordingStream, {mimeType:'video/webm;codecs=vp8',videoBitsPerSecond:2500000});
    recording = new Promise(resolve => { recorder.ondataavailable = event => { if(event.data.size) chunks.push(event.data); }; recorder.onstop = resolve; });
    recorder.start();
    await delay(650);
    const samples = Math.round(audio.sampleRate * 0.004), buffer = audio.createBuffer(1,samples,audio.sampleRate);
    const values = buffer.getChannelData(0); let seed = 23;
    for(let i=0;i<samples;i++){seed=(Math.imul(seed,1664525)+1013904223)>>>0;values[i]=(seed/2147483648-1)*0.18;}
    const burst = audio.createBufferSource(); burst.buffer = buffer; burst.connect(destination); burst.start();
    await wait(() => $('effect-label').textContent === 'Turn to dust', 'Snap did not select dust');
    await wait(() => $('notice').textContent.startsWith('Vanishing live.'), 'Automatic segmentation did not finish');
    await delay(1600); frames.during = canvas.toDataURL('image/png');
    await delay(1900); frames.after = canvas.toDataURL('image/png');
    const vanished = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    let changed = 0;
    for (let i=0;i<original.length;i+=4) if(Math.abs(vanished[i]-original[i])+Math.abs(vanished[i+1]-original[i+1])+Math.abs(vanished[i+2]-original[i+2])>45) changed++;
    assert(changed > canvas.width * canvas.height * 0.03, 'Person region disappears after the audio trigger');
    const backgroundColors = new Set();
    for(let i=0;i<10;i++) { const p=canvas.getContext('2d').getImageData(600,30,1,1).data; backgroundColors.add(p[0]>p[1]?'red':'green'); await delay(70); }
    assert(backgroundColors.size===2, 'Real-model disappearance keeps the moving background live after vanishing');
    const second = audio.createBufferSource(); second.buffer=buffer; second.connect(destination); second.start();
    await wait(() => $('effect-label').textContent === 'No effect', 'Second snap did not restore the camera'); await delay(150);
    assert($('effect-label').textContent === 'No effect', 'A second snap restores the live camera without another control');
    const reset = canvas.getContext('2d').getImageData(0,0,canvas.width,canvas.height).data;
    const current = source.getContext('2d').getImageData(0,0,source.width,source.height).data;
    let drift=0;for(let i=0;i<current.length;i+=4)drift+=Math.abs(reset[i]-current[i]);
    assert(drift/(canvas.width*canvas.height)<12, 'Reset pixels follow the current moving camera');
    await delay(250); recorder.stop(); await recording;
    const videoBytes = new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());
    let encoded = ''; for(let i=0;i<videoBytes.length;i+=8192) encoded+=String.fromCharCode(...videoBytes.subarray(i,i+8192));
    burst.disconnect(); second.disconnect();
    $('demo').click();$('camera').click();
    await wait(()=>$('source-label').textContent==='Your camera preview'&&$('dust-state').textContent.startsWith('Live dust is ready.'),'Photo survives camera restart');
    assert(!$('room-preview').hidden,'Room photo is retained across camera restarts');
    return {ok:true,checks,frames,video:btoa(encoded),changedFraction:changed/(canvas.width*canvas.height)};
  } catch(error) { return {ok:false,checks,error:error.stack}; }
  finally {
    clearInterval(sourceTimer); if(recorder?.state==='recording') recorder.stop();
    recordingStream?.getTracks().forEach(t=>t.stop());
    $('demo').click(); navigator.mediaDevices.getUserMedia=nativeGum;
    camera.getTracks().forEach(t=>t.stop());mic.getTracks().forEach(t=>t.stop());
    silence.stop();silence.disconnect();destination.disconnect();await audio.close();
  }
}
