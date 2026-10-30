/* Bridge ownership checks. Studio/panel suites exercise actual camera capture. */
async function runRoomCaptureBridgeTests() {
  const checks = [], requests = [], saved = [];
  const assert = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  const capture = MeetEffects.captureEmptyRoom, setBackground = MeetEffects.Engine.prototype.setBackground;
  let state, stream, second;
  const listener = event => { state = JSON.parse(event.detail); };
  const send = (type, extra = {}) => document.dispatchEvent(new CustomEvent('meeteffects:command', {detail:JSON.stringify({type,...extra})}));
  document.addEventListener('meeteffects:status', listener);
  MeetEffects.Engine.prototype.setBackground = function (image) { saved.push({engine:this,image}); return setBackground.call(this,image); };
  MeetEffects.captureEmptyRoom = (engine, {signal,onProgress}) => new Promise((resolve,reject) => {
    requests.push({engine,signal,resolve,reject}); onProgress({phase:'countdown',seconds:5});
  });
  const photo = document.createElement('canvas'); photo.width=640;photo.height=360;
  photo.getContext('2d').fillStyle='#608090';photo.getContext('2d').fillRect(0,0,640,360);
  try {
    stream = await navigator.mediaDevices.getUserMedia({video:true,audio:false});
    send('effect',{effect:'cinema'}); await delay(30);
    send('background-capture');
    assert(state.backgroundCapturing&&state.backgroundCapture.seconds===5&&requests.length===1,'Meet bridge exposes the five-second capture countdown');
    requests[0].resolve(photo); await delay(30);
    assert(state.background&&!state.backgroundCapturing&&state.effect==='cinema'&&saved.at(-1).image===photo,'Captured room reaches the live engine without changing its effect');
    send('background-capture');send('effect',{effect:'none'});
    assert(requests[1].signal.aborted&&!state.backgroundCapturing,'Reset cancels room capture immediately');
    const before=saved.length;requests[1].resolve(document.createElement('canvas'));await delay(30);
    assert(saved.length===before&&state.effect==='none','Late canceled capture cannot replace the saved room or reset');
    send('background-capture');send('background-capture-cancel');
    assert(requests[2].signal.aborted&&!state.backgroundCapturing&&state.background,'Cancel setup keeps the previous room');
    requests[2].resolve(photo);await delay(10);
    send('background-capture');
    second=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
    assert(requests[3].signal.aborted&&!state.backgroundCapturing,'Switching camera cancels the old camera capture');
    requests[3].resolve(photo);await delay(10);
    send('background-capture');
    second.getTracks().forEach(t=>t.stop());
    assert(requests[4].signal.aborted&&!state.backgroundCapturing,'Stopping the capture owner cancels setup');
    requests[4].resolve(photo);await delay(10);
    send('background-capture');requests[5].reject(new Error('Camera interrupted. Restart room setup.'));await delay(20);
    assert(!state.backgroundCapturing&&state.backgroundError.includes('interrupted')&&state.background,'Capture failure is visible and retains the previous room');
    send('background-capture');send('background-start');
    assert(requests[6].signal.aborted&&state.backgroundLoading,'Choosing a photo supersedes pending automatic capture');
    requests[6].resolve(photo);send('background',{data:photo.toDataURL()});await delay(50);
    return {ok:true,checks};
  } catch(error) {return {ok:false,checks,error:error.stack};}
  finally {
    send('background-capture-cancel');stream?.getTracks().forEach(t=>t.stop());second?.getTracks().forEach(t=>t.stop());
    MeetEffects.captureEmptyRoom=capture;MeetEffects.Engine.prototype.setBackground=setBackground;
    document.removeEventListener('meeteffects:status',listener);
  }
}
