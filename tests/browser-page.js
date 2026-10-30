/* Executed under an intercepted meet.google.com origin with the real extension
 * loaded. Test traffic is fulfilled by the runner, never by Google's servers. */
globalThis.runIntegrationTests = async () => {
  const results = [], streams = [], connections = [];
  const assert = (value, message) => { if (!value) throw new Error(message); };
  const pass = name => results.push(name);
  const delay = ms => new Promise(r => setTimeout(r, ms));
  const waitFor = async (predicate, label, timeout = 5000) => {
    const start = performance.now();
    while (!await predicate()) { if(performance.now()-start>timeout)throw new Error(`Timed out: ${label}`);await delay(30); }
  };
  let state;
  document.addEventListener('meeteffects:status', e => { state = JSON.parse(e.detail); });
  const send = (type, extra = {}) => document.dispatchEvent(new CustomEvent('meeteffects:command',{detail:JSON.stringify({type,...extra})}));
  const sourceTracks = [];
  const srcDescriptor = Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype, 'srcObject');
  Object.defineProperty(HTMLMediaElement.prototype, 'srcObject', {
    ...srcDescriptor,
    set(value) { if(value?.getVideoTracks)sourceTracks.push(...value.getVideoTracks());srcDescriptor.set.call(this,value); }
  });
  const pixel = (video,x,y) => {
    const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;
    c.getContext('2d').drawImage(video,0,0);return [...c.getContext('2d').getImageData(x,y,1,1).data];
  };
  try {
    assert(globalThis.__meetEffectsInstalled, 'Real extension did not inject into MAIN world');
    assert(document.getElementById('meeteffects-host'), 'Isolated-world panel did not mount');
    pass('Actual MV3 MAIN and ISOLATED injection under strict CSP / Trusted Types');
    const roomPhoto=document.createElement('canvas');roomPhoto.width=640;roomPhoto.height=360;
    roomPhoto.getContext('2d').fillStyle='#204060';roomPhoto.getContext('2d').fillRect(0,0,640,360);
    send('background',{data:roomPhoto.toDataURL()});
    await waitFor(()=>state.background&&!state.backgroundLoading,'Room photo before camera startup');
    assert(state.cameras===0&&state.effect==='none','Loading a room photo activated an effect or camera');
    pass('Room photo loads before camera startup without changing the active effect');
    const audio=await navigator.mediaDevices.getUserMedia({audio:true,video:false});streams.push(audio);
    assert(audio.getAudioTracks().length===1&&!audio.getVideoTracks().length,'Audio-only acquisition changed');
    const audioClone=audio.clone();streams.push(audioClone);
    assert(audioClone.getAudioTracks()[0].readyState==='live','Unrelated stream cloning broken');
    pass('Audio-only acquisition and native stream cloning');
    const stream=await navigator.mediaDevices.getUserMedia({video:{width:640,height:360},audio:true});streams.push(stream);
    const track=stream.getVideoTracks()[0], raw=sourceTracks[0], mic=stream.getAudioTracks()[0];
    assert(raw&&track!==raw&&raw.readyState==='live','Camera was not replaced with a processed track');
    assert(mic.kind==='audio'&&mic.readyState==='live','Microphone not preserved');
    assert(track.getSettings().width===640,'Output dimensions wrong');
    send('status');assert(state.cameras===1,'Session not tracked');
    pass('Processed camera acquisition with live original audio');
    await track.applyConstraints({width:{exact:320},height:{exact:240}});
    assert(raw.getSettings().width===320&&raw.getSettings().height===240,
      `Camera constraints did not change input resolution: ${JSON.stringify(raw.getSettings())}; constraints: ${JSON.stringify(raw.getConstraints())}`);
    pass('Camera constraints reach the physical input track');
    const preview=document.createElement('video');preview.muted=true;preview.srcObject=stream;await preview.play();
    send('effect',{effect:'cinema'});await delay(450);
    assert(pixel(preview,20,10).slice(0,3).every(v=>v<5),'Cinema letterbox missing from capture stream');
    assert(stream.getAudioTracks()[0]===mic,'Effect replaced the microphone');
    pass('Cinema pixels appear in captured video; audio identity preserved');

    const a=new RTCPeerConnection({iceServers:[]}), b=new RTCPeerConnection({iceServers:[]});connections.push(a,b);
    a.onicecandidate=e=>{if(e.candidate)b.addIceCandidate(e.candidate).catch(()=>{});};
    b.onicecandidate=e=>{if(e.candidate)a.addIceCandidate(e.candidate).catch(()=>{});};
    const remote=document.createElement('video');remote.muted=true;
    b.ontrack=e=>{if(e.track.kind==='video')remote.srcObject=new MediaStream([e.track]);};
    for(const t of stream.getTracks())a.addTrack(t,stream);
    await a.setLocalDescription(await a.createOffer());await b.setRemoteDescription(a.localDescription);
    await b.setLocalDescription(await b.createAnswer());await a.setRemoteDescription(b.localDescription);
    await waitFor(()=>remote.srcObject,'WebRTC remote track');await remote.play();
    await waitFor(()=>remote.videoWidth>0,'WebRTC remote frame');await delay(450);
    assert(pixel(remote,20,10).slice(0,3).every(v=>v<15),'Remote receiver did not receive cinema overlay');
    const report=await b.getStats();assert([...report.values()].some(r=>r.type==='inbound-rtp'&&r.kind==='audio'&&r.packetsReceived>0),'Remote audio missing');
    pass('Real WebRTC loopback receives processed video and audio packets');
    const interruptionClone=track.clone();streams.push(new MediaStream([interruptionClone]));
    raw.dispatchEvent(new Event('mute'));await delay(120);
    assert(state.interrupted&&track.enabled&&interruptionClone.enabled,'Input interruption changed caller mute or went unreported');
    assert(pixel(preview,20,10).slice(0,3).every(v=>v<5),'Input interruption did not blank the outgoing picture');
    raw.dispatchEvent(new Event('unmute'));await delay(120);
    assert(!state.interrupted&&state.effect==='cinema'&&track.enabled,'Input recovery lost the effect or caller mute setting');
    interruptionClone.stop();
    pass('Source interruption/recovery is reported and preserves effects and clone mute settings');

    send('effect',{effect:'none'});await delay(80);send('plate');assert(state.plate,'Plate not saved');
    send('effect',{effect:'dust'});assert(state.effect==='dust','Dust did not start');
    await track.applyConstraints({width:{exact:640},height:{exact:360}});
    await waitFor(()=>track.getSettings().width===640&&state.autoReady,'Live detection recovery after camera resize');
    assert(state.effect==='dust'&&!state.message,'Live camera resize left a stale error or reset disappearance');
    pass('Live camera resize recovers without a stale hold message or resetting dust');
    send('effect',{effect:'none'});
    const clone=track.clone(), streamClone=stream.clone(), wrappedClone=new MediaStream([track]).clone();
    streams.push(new MediaStream([clone]),streamClone,wrappedClone);
    track.enabled=false;assert(raw.enabled,'Muting one consumer muted active clones');
    clone.enabled=false;streamClone.getVideoTracks()[0].enabled=false;wrappedClone.getVideoTracks()[0].enabled=false;
    assert(!raw.enabled,'All-disabled consumers did not disable raw camera');
    wrappedClone.getVideoTracks()[0].enabled=true;assert(raw.enabled,'Re-enabling clone did not re-enable camera');
    track.stop();clone.stop();streamClone.getVideoTracks()[0].stop();
    assert(raw.readyState==='live','Raw camera stopped while re-containerized clone still live');
    wrappedClone.getVideoTracks()[0].stop();assert(raw.readyState==='ended','Last consumer did not stop raw camera');
    assert(mic.readyState==='live','Camera cleanup stopped meeting audio');
    pass('Track, stream and re-containerized clones preserve camera ownership and mute');
    send('status');assert(state.cameras===0,'Camera session leaked');
    pass('Camera teardown releases input and retains independent microphone');

    for(let i=0;i<5;i++){
      const s=await navigator.mediaDevices.getUserMedia({video:true,audio:false});streams.push(s);
      s.getTracks().forEach(t=>t.stop());send('status');assert(state.cameras===0,'Camera toggle leaked');
    }
    pass('Five camera on/off cycles release sessions');

    const concurrentA=await navigator.mediaDevices.getUserMedia({video:true});streams.push(concurrentA);
    const concurrentB=await navigator.mediaDevices.getUserMedia({video:true});streams.push(concurrentB);
    send('status');assert(state.cameras===2,'Concurrent acquisitions were not independent');
    concurrentA.getTracks().forEach(t=>t.stop());send('status');assert(state.cameras===1&&concurrentB.active,'One camera stopped another session');
    send('effect',{effect:'cinema'});
    const imageCanvas=document.createElement('canvas');imageCanvas.width=10;imageCanvas.height=10;
    send('image',{data:imageCanvas.toDataURL()});send('effect',{effect:'none'});await delay(100);
    assert(state.effect==='none','Pending image undid a newer reset');
    concurrentB.getTracks().forEach(t=>t.stop());
    pass('Concurrent cameras and late upload/reset ordering');
    const unplugged=await navigator.mediaDevices.getUserMedia({video:true,audio:true});streams.push(unplugged);
    const unpluggedRaw=sourceTracks.at(-1),unpluggedClone=unplugged.getVideoTracks()[0].clone();streams.push(new MediaStream([unpluggedClone]));
    unpluggedRaw.dispatchEvent(new Event('ended'));send('status');
    assert(unplugged.getVideoTracks()[0].readyState==='ended'&&unpluggedClone.readyState==='ended'&&state.cameras===0,'Source-ended left output or clone alive');
    assert(unplugged.getAudioTracks()[0].readyState==='live','Source-ended stopped independent microphone');
    pass('Source-ended event terminates all owned video consumers without stopping audio');

    const captureStream=HTMLCanvasElement.prototype.captureStream;
    HTMLCanvasElement.prototype.captureStream=function(){throw new Error('Synthetic compositor failure');};
    try{
      const fallback=await navigator.mediaDevices.getUserMedia({video:true});streams.push(fallback);
      assert(!fallback.getVideoTracks()[0].label.includes('capture'),'Failed compositor did not fall back to original camera');
      send('status');assert(state.cameras===0&&state.message.includes('original camera'),'Fallback was not reported');
      fallback.getTracks().forEach(t=>t.stop());
    }finally{HTMLCanvasElement.prototype.captureStream=captureStream;}
    let rejected=false;
    try{await navigator.mediaDevices.getUserMedia({video:{deviceId:{exact:'nonexistent-meeteffects-camera'}}});}catch(error){rejected=error.name==='OverconstrainedError'||error.name==='NotFoundError';}
    assert(rejected,'Native invalid-camera rejection was lost');
    pass('Compositor startup failure falls back visibly; native camera errors reject');

    const source=document.createElement('canvas');source.width=160;source.height=90;
    const ctx=source.getContext('2d');ctx.fillStyle='#204060';ctx.fillRect(0,0,160,90);
    const canvas=document.createElement('canvas');canvas.width=160;canvas.height=90;
    const engine=new MeetEffects.Engine(source,canvas);engine.capturePlate();
    ctx.fillStyle='#ffcc99';ctx.fillRect(60,20,40,60);
    engine.trigger('dust',0);engine.render(4000);
    let data=canvas.getContext('2d').getImageData(80,45,1,1).data;
    assert(data[0]===32&&data[1]===64&&data[2]===96,'Dust did not end at the clean plate');
    ctx.fillStyle='red';ctx.fillRect(0,0,160,90);engine.resize(320,180);engine.render(5000);
    data=canvas.getContext('2d').getImageData(160,90,1,1).data;
    assert(data[0]===32&&engine.effect==='dust','Resize revealed live camera');
    engine.reset();engine.render();assert(canvas.getContext('2d').getImageData(160,90,1,1).data[0]===255,'Reset did not restore camera');
    pass('Dust holds clean room, survives camera resize, and resets explicitly');
    await engine.setImage(source.toDataURL('image/png'));engine.trigger('custom');engine.render();
    await engine.setImage(await (await fetch('/tests/two-frame.gif.txt')).text());engine.trigger('custom');
    const first=engine.gifFrame;engine.render();await delay(100);engine.render();
    assert(engine.gifFrame!==first&&engine.decoder.tracks.selectedTrack.frameCount===2,'GIF did not animate');
    engine.stop();assert(engine.decoder===null&&engine.gifFrame===null,'GIF decoder leaked');
    pass('Local PNG and animated GIF load; decoders close at teardown');

    // Continuous inference/reset/resize/failure ownership is exercised by
    // runLiveDustTests on a fresh page; the old trigger-snapshot contract no
    // longer applies to automatic cameras.

    // Real Web Audio samples through the production analyser and detector.
    // These generated pulses never connect to speakers.
    const generator = new AudioContext(); await generator.resume();
    try {
      for (const [duration, offset] of [[2,0],[2,5],[2,11],[4,7],[8,13]]) {
        const destination = generator.createMediaStreamDestination();
        const generatedTrack = destination.stream.getAudioTracks()[0];
        // Keep the generated capture stream clocked even between brief bursts.
        const silence = generator.createConstantSource(); silence.offset.value = 0; silence.connect(destination); silence.start();
        let hits = 0;
        const stopDetector = await MeetEffects.listenForSnap(generatedTrack, () => { hits++; });
        try {
          const samples = Math.round(generator.sampleRate * duration / 1000);
          const buffer = generator.createBuffer(1, samples, generator.sampleRate);
          const channel = buffer.getChannelData(0); let seed = 137;
          for (let i = 0; i < samples; i++) { seed = (Math.imul(seed,1664525)+1013904223)>>>0; channel[i] = (seed / 2147483648 - 1) * 0.12; }
          const burst = generator.createBufferSource(); burst.buffer = buffer; burst.connect(destination);
          burst.start(generator.currentTime + 0.65 + offset / 1000);
          await delay(1400);
          assert(hits === 1, `${duration}ms snap at offset ${offset} produced ${hits} detections: track muted=${generatedTrack.muted}, audio=${generator.state}`);
          burst.disconnect();
        } finally { stopDetector(); generatedTrack.stop(); silence.stop(); silence.disconnect(); destination.disconnect(); }
      }
      const destination = generator.createMediaStreamDestination(), generatedTrack = destination.stream.getAudioTracks()[0];
      let hits = 0;
      const tone = generator.createOscillator(), gain = generator.createGain();
      tone.frequency.value = 180; gain.gain.value = 0.2; tone.connect(gain).connect(destination); tone.start();
      const stopDetector = await MeetEffects.listenForSnap(generatedTrack, () => { hits++; });
      try { await delay(800); assert(hits === 0, 'Steady bass tone falsely triggered dust'); }
      finally { stopDetector(); generatedTrack.stop(); tone.stop(); tone.disconnect(); gain.disconnect(); destination.disconnect(); }
    } finally { await generator.close(); }
    pass('Real Web Audio detects 2–8ms quiet broadband bursts across polling offsets and rejects steady bass');

    const snapTrack=audio.getAudioTracks()[0];let ended=false;
    const stop=await MeetEffects.listenForSnap(snapTrack,()=>{},()=>{ended=true;});snapTrack.stop();
    await waitFor(()=>ended,'snap cleanup after track.stop');stop();
    pass('Snap sampler cleans up when microphone.stop() emits no ended event');
    const leaving=await navigator.mediaDevices.getUserMedia({video:true});streams.push(leaving);
    const rawLeaving=sourceTracks.at(-1);dispatchEvent(new Event('pagehide'));
    assert(leaving.getVideoTracks()[0].readyState==='ended'&&rawLeaving.readyState==='ended','Page exit leaked camera');
    pass('Page exit stops owned output and input tracks');
    return {ok:true,results};
  } catch(error) { return {ok:false,results,error:error.stack}; }
  finally {Object.defineProperty(HTMLMediaElement.prototype,'srcObject',srcDescriptor);for(const p of connections)p.close();for(const s of streams)s.getTracks().forEach(t=>t.stop());}
};
