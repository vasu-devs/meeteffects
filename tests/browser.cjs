// One isolated headless Chromium, built-in CDP client, no npm dependencies.
// CHROME_PATH can point to an installed Chromium / Chrome for Testing binary.
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const http = require('node:http');
const { spawn } = require('node:child_process');
const { once } = require('node:events');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const artifacts = process.env.ARTIFACT_DIR ? path.resolve(process.env.ARTIFACT_DIR) : path.join(root, 'artifacts');
const delay = ms => new Promise(r => setTimeout(r, ms));
const candidates = [process.env.CHROME_PATH, '/usr/bin/chromium', '/usr/bin/chromium-browser',
  ...['1248','1243','1208'].map(v=>path.join(os.homedir(),`.cache/ms-playwright/chromium-${v}/chrome-linux64/chrome`))];
const executable = candidates.find(p => p && fs.existsSync(p));
if (!executable) throw new Error('Set CHROME_PATH to an installed Chromium or Chrome for Testing. No browser is downloaded.');
class CDP {
  constructor(url) {
    this.socket = new WebSocket(url); this.next = 0; this.pending = new Map(); this.events = new Map();
    this.ready = new Promise((resolve,reject)=>{this.socket.onopen=resolve;this.socket.onerror=reject;});
    this.socket.onmessage = e => {
      const msg=JSON.parse(e.data);
      if(msg.id){const p=this.pending.get(msg.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(msg.id);msg.error?p.reject(new Error(JSON.stringify(msg.error))):p.resolve(msg.result);}
      else for(const f of this.events.get(msg.method)||[])f(msg.params);
    };
  }
  async call(method,params={}) {
    await this.ready;const id=++this.next;
    return new Promise((resolve,reject)=>{const timer=setTimeout(()=>{this.pending.delete(id);reject(new Error(`CDP timeout: ${method}`));},30000);this.pending.set(id,{resolve,reject,timer});this.socket.send(JSON.stringify({id,method,params}));});
  }
  on(event,fn){const list=this.events.get(event)||[];list.push(fn);this.events.set(event,list);}
  async evaluate(expression){const r=await this.call('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true,userGesture:true});if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;}
  close(){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(new Error('CDP closed'));}this.pending.clear();this.socket.close();}
}
function content(url) {
  const pathname = decodeURIComponent(new URL(url).pathname);
  if (pathname === '/tests/automatic-sample.jpg' && process.env.AUTOMATIC_SAMPLE) return {status:200,body:fs.readFileSync(process.env.AUTOMATIC_SAMPLE),type:'image/jpeg'};
  const relative=pathname==='/meeteffects-test'?'tests/fixture.html':pathname.slice(1);
  const resolved=path.resolve(root,relative);
  if(!resolved.startsWith(root+path.sep)||!['extension','tests'].includes(relative.split('/')[0])||!fs.existsSync(resolved)||!fs.statSync(resolved).isFile())return {status:404,body:Buffer.from('Not found'),type:'text/plain'};
  return {status:200,body:fs.readFileSync(resolved),type:({'.html':'text/html','.js':'text/javascript','.css':'text/css','.txt':'text/plain','.wasm':'application/wasm','.jpg':'image/jpeg','.png':'image/png'})[path.extname(resolved)]||'application/octet-stream'};
}
(async()=>{
  fs.mkdirSync(artifacts,{recursive:true});
  const profile=fs.mkdtempSync(path.join(os.tmpdir(),'meeteffects-browser-'));
  const server=http.createServer((req,res)=>{const c=content(`http://localhost${req.url}`);res.writeHead(c.status,{'Content-Type':c.type});res.end(c.body);});
  let browser,cdp,stderr='';
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const port=server.address().port;
    browser=spawn(executable,['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage',
      '--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update',
      '--remote-debugging-port=0',`--user-data-dir=${profile}`,
      '--use-fake-device-for-media-stream',
      `--disable-extensions-except=${path.join(root,'extension')}`,`--load-extension=${path.join(root,'extension')}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
    browser.stderr.on('data',data=>{stderr=(stderr+data).slice(-6000);});
    const started=new Date().toISOString();
    console.log(`Owned test browser PID ${browser.pid}, started ${started}; server 127.0.0.1:${port}`);
    const activePort=path.join(profile,'DevToolsActivePort');
    for(let i=0;!fs.existsSync(activePort)&&i<100;i++){if(browser.exitCode!==null)throw new Error(stderr);await delay(100);}
    if(!fs.existsSync(activePort))throw new Error(`Browser did not start: ${stderr}`);
    const debugPort=fs.readFileSync(activePort,'utf8').split('\n')[0];
    const targets=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    cdp=new CDP(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await cdp.ready;
    await cdp.call('Page.enable');await cdp.call('Runtime.enable');
    for (const origin of [`http://127.0.0.1:${port}`, 'https://meet.google.com']) {
      await cdp.call('Browser.grantPermissions',{origin,permissions:['audioCapture','videoCapture']});
    }
    const exceptions=[];cdp.on('Runtime.exceptionThrown',e=>exceptions.push(e.exceptionDetails));
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
    async function navigate(url){await cdp.call('Page.navigate',{url});for(let i=0;i<100;i++){if(await cdp.evaluate('document.readyState === "complete"'))return;await delay(50);}throw new Error('Page did not load');}
    if (process.argv.includes('--meet-page')) {
      // Actual Google page + actual extension; synthetic devices only. This does
      // not sign in, create or join a meeting and cannot prove call compatibility.
      await navigate('https://meet.google.com/home?pli=1');
      for(let i=0;i<100;i++){
        if(await cdp.evaluate('location.hostname === "meet.google.com" && !!document.getElementById("meeteffects-host")'))break;
        await delay(100);
      }
      const page=await cdp.evaluate('({url:location.href,title:document.title,hook:!!globalThis.__meetEffectsInstalled,panel:!!document.getElementById("meeteffects-host"),text:document.body.innerText.slice(0,1500)})');
      console.log('Real Meet page:',JSON.stringify(page));
      if (!page.hook || !page.panel) {
        const report={ok:false,blocked:true,url:page.url,title:page.title,testedAt:new Date().toISOString(),reason:'Signed-out browser redirected before the Meet app loaded. A real call requires a user-provided test meeting/sign-in; no call compatibility was verified.'};
        fs.writeFileSync(path.join(artifacts,'real-meet-page.json'),JSON.stringify(report,null,2));
        console.log('BLOCKED real-site test:',report.reason);process.exitCode=2;return;
      }
      const check=await cdp.evaluate(`(async()=>{
        let state;const listener=e=>{state=JSON.parse(e.detail)};
        document.addEventListener('meeteffects:status',listener);
        const send=(type,extra={})=>document.dispatchEvent(new CustomEvent('meeteffects:command',{detail:JSON.stringify({type,...extra})}));
        let stream;
        try{
          stream=await navigator.mediaDevices.getUserMedia({video:true,audio:false});
          send('effect',{effect:'cinema'});
          const video=document.createElement('video');video.muted=true;video.srcObject=stream;await video.play();
          await new Promise(r=>setTimeout(r,500));
          const c=document.createElement('canvas');c.width=video.videoWidth;c.height=video.videoHeight;c.getContext('2d').drawImage(video,0,0);
          const border=[...c.getContext('2d').getImageData(20,10,1,1).data];
          const result={effect:state.effect,cameras:state.cameras,border,settings:stream.getVideoTracks()[0].getSettings()};
          video.pause();video.srcObject=null;return result;
        }finally{stream?.getTracks().forEach(t=>t.stop());document.removeEventListener('meeteffects:status',listener);}
      })()`);
      assert.equal(check.cameras,1);assert.equal(check.effect,'cinema');assert.ok(check.border.slice(0,3).every(v=>v<5));
      const shot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(path.join(artifacts,'real-meet-page.png'),Buffer.from(shot.data,'base64'));
      const report={ok:true,page:{url:page.url,title:page.title,hook:page.hook,panel:page.panel},check,testedAt:new Date().toISOString(),browser:await cdp.call('Browser.getVersion'),limitation:'Actual Google Meet page/CSP and synthetic camera; no signed-in call or remote participant.'};
      fs.writeFileSync(path.join(artifacts,'real-meet-page.json'),JSON.stringify(report,null,2));
      console.log('PASS extension injection and cinema capture on the actual Google Meet page. No live call tested.');
      return;
    }
    await navigate(`http://127.0.0.1:${port}/extension/studio.html`);
    await cdp.evaluate('MeetEffects.memesReady');
    assert.equal(await cdp.evaluate('document.getElementById("effect-label").textContent'),'No effect');
    assert.equal(await cdp.evaluate('document.querySelectorAll(".meme-thumb").length'),3,'Real meme thumbnails missing');
    const capture=async name=>{const r=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});fs.writeFileSync(path.join(artifacts,name),Buffer.from(r.data,'base64'));};
    await capture('studio.png');
    await cdp.evaluate('document.querySelector("[data-effect=cinema]").click()');await delay(500);
    assert.equal(await cdp.evaluate('document.getElementById("effect-label").textContent'),'Absolute cinema');
    await capture('studio-cinema.png');
    await cdp.evaluate('document.querySelector("[data-effect=dust]").click()');await delay(1000);await capture('studio-dust.png');
    await delay(2300);await capture('studio-vanished.png');
    await cdp.evaluate('document.querySelector("[data-effect=none]").click()');
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:true});
    assert.ok(await cdp.evaluate('document.documentElement.scrollWidth <= innerWidth'),'Mobile horizontal overflow');
    await capture('studio-mobile.png');
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    console.log('PASS studio effect controls, reset, mobile overflow, screenshots');
    await cdp.evaluate(`globalThis.studioTracks=[];globalThis.studioSrc=Object.getOwnPropertyDescriptor(HTMLMediaElement.prototype,'srcObject');Object.defineProperty(HTMLMediaElement.prototype,'srcObject',{...studioSrc,set(value){if(value)studioTracks.push(...value.getTracks());studioSrc.set.call(this,value);}});document.getElementById('camera').click()`);
    for(let i=0;i<100;i++){if(await cdp.evaluate('document.getElementById("source-label").textContent === "Your camera preview"'))break;await delay(30);}
    assert.ok(await cdp.evaluate('studioTracks.length > 0 && studioTracks[0].readyState === "live"'),'Studio camera did not start');
    // Cancel after acquisition but before video.play resolves: both cameras must stop now.
    await cdp.evaluate('globalThis.nativePlay=HTMLMediaElement.prototype.play;HTMLMediaElement.prototype.play=function(){return new Promise(()=>{})};document.getElementById("camera").click()');
    for(let i=0;i<100;i++){if(await cdp.evaluate('studioTracks.length >= 2'))break;await delay(30);}
    assert.ok(await cdp.evaluate('studioTracks.length >= 2'),'Delayed camera did not acquire');
    await cdp.evaluate('document.getElementById("demo").click()');
    assert.ok(await cdp.evaluate('studioTracks.every(t=>t.readyState === "ended") && document.getElementById("output").width === 960'),'Returning to demo did not release camera/reset dimensions');
    await cdp.evaluate('HTMLMediaElement.prototype.play=nativePlay; true');
    console.log('PASS studio return-to-demo cancels an acquired camera while playback is pending');
    await cdp.evaluate(`globalThis.nativeResume=AudioContext.prototype.resume;globalThis.nativeClose=AudioContext.prototype.close;globalThis.nativeGum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);globalThis.studioMics=[];globalThis.resumeCount=0;globalThis.closeCount=0;AudioContext.prototype.resume=function(){resumeCount++;return new Promise(()=>{})};AudioContext.prototype.close=function(){closeCount++;return nativeClose.call(this)};navigator.mediaDevices.getUserMedia=async function(c){const s=await nativeGum(c);if(c.audio)studioMics.push(...s.getAudioTracks());return s};document.getElementById('snap').checked=true;document.getElementById('snap').dispatchEvent(new Event('change'));true`);
    for(let i=0;i<100;i++){if(await cdp.evaluate('resumeCount > 0'))break;await delay(30);}
    assert.ok(await cdp.evaluate('resumeCount > 0'),'Delayed microphone did not start');
    await cdp.evaluate('document.getElementById("snap").checked=false;document.getElementById("snap").dispatchEvent(new Event("change"));true');
    assert.ok(await cdp.evaluate('studioMics.length > 0 && studioMics.every(t=>t.readyState === "ended") && closeCount === 1'),'Cancelling pending audio leaked a track or context');
    await cdp.evaluate('AudioContext.prototype.resume=nativeResume;AudioContext.prototype.close=nativeClose;navigator.mediaDevices.getUserMedia=nativeGum;true');
    console.log('PASS studio cancels microphone and AudioContext while resume is pending');
    await cdp.evaluate('document.getElementById("camera").click()');
    for(let i=0;i<100;i++){if(await cdp.evaluate('document.getElementById("source-label").textContent === "Your camera preview"'))break;await delay(30);}
    await cdp.evaluate('globalThis.nativeRender=MeetEffects.Engine.prototype.render;MeetEffects.Engine.prototype.render=function(...args){if(this.source instanceof HTMLVideoElement){MeetEffects.Engine.prototype.render=nativeRender;throw new Error("Synthetic frame failure")};return nativeRender.apply(this,args)};true');
    for(let i=0;i<100;i++){if(await cdp.evaluate('document.getElementById("notice").textContent.includes("Camera rendering stopped")'))break;await delay(30);}
    assert.ok(await cdp.evaluate('studioTracks.every(t=>t.readyState === "ended") && document.getElementById("source-label").textContent === "Demo scene" && document.getElementById("notice").textContent.includes("Camera rendering stopped")'),'Studio render failure did not release camera and restore demo');
    await cdp.evaluate('Object.defineProperty(HTMLMediaElement.prototype,"srcObject",studioSrc);true');
    console.log('PASS studio rendering failure releases capture and restores a usable demo');
    await cdp.call('Browser.setPermission',{permission:{name:'camera'},setting:'denied',origin:`http://127.0.0.1:${port}`});
    await cdp.evaluate('document.getElementById("camera").click()');
    for(let i=0;i<100;i++){if(await cdp.evaluate('document.getElementById("notice").textContent.includes("Camera could not start")'))break;await delay(30);}
    const denied=await cdp.evaluate('(async()=>({notice:document.getElementById("notice").textContent,disabled:document.getElementById("camera").disabled,source:document.getElementById("source-label").textContent,permission:(await navigator.permissions.query({name:"camera"})).state}))()');
    assert.ok(denied.permission==='denied'&&denied.notice.includes('Camera could not start')&&!denied.disabled&&denied.source==='Demo scene',`Denied permission left a broken studio: ${JSON.stringify(denied)}`);
    console.log('PASS browser-level camera permission denial leaves demo and retry usable');
    let automatic = null;
    if (process.env.AUTOMATIC_SAMPLE) {
      await cdp.evaluate(fs.readFileSync(path.join(root,'tests/automatic-page.js'),'utf8'));
      automatic = await cdp.evaluate('runAutomaticStudioTest()');
      if (!automatic.ok) throw new Error(automatic.error);
      for (const [name,data] of Object.entries(automatic.frames)) fs.writeFileSync(path.join(artifacts,`automatic-${name}.png`),Buffer.from(data.split(',')[1],'base64'));
      if (automatic.video) fs.writeFileSync(path.join(artifacts,'live-dust-demo.webm'),Buffer.from(automatic.video,'base64'));
      delete automatic.video;
      delete automatic.frames;
      const shot=await cdp.call('Page.captureScreenshot',{format:'png',captureBeyondViewport:true});
      fs.writeFileSync(path.join(artifacts,'studio-automatic.png'),Buffer.from(shot.data,'base64'));
      console.log('PASS five-second capture → automatic room photo → real-model live snap dust → snap back');
    }
    // Fulfill every request to this origin locally. No Google account/call is used.
    cdp.on('Fetch.requestPaused',async e=>{
      try {
        const c=content(e.request.url);
        await cdp.call('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:c.status,responseHeaders:[
          {name:'Content-Type',value:c.type},
          {name:'Content-Security-Policy',value:"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; media-src 'self' blob:; require-trusted-types-for 'script'"}
        ],body:c.body.toString('base64')});
      }catch(error){exceptions.push({interceptionError:error.message});}
    });
    await cdp.call('Fetch.enable',{patterns:[{urlPattern:'https://meet.google.com/*'}]});
    await navigate('https://meet.google.com/meeteffects-test');
    for(let i=0;i<100;i++){if(await cdp.evaluate('typeof runIntegrationTests === "function" && !!document.getElementById("meeteffects-host")'))break;await delay(30);}
    await cdp.call('DOM.enable');
    const tree=await cdp.call('DOM.getDocument',{depth:-1,pierce:true});
    const findHost=node=>node.attributes?.includes('meeteffects-host')?node:[...(node.children||[]),...(node.shadowRoots||[])].map(findHost).find(Boolean);
    const shadowNode=findHost(tree.root).shadowRoots[0];
    const shadowObject=(await cdp.call('DOM.resolveNode',{nodeId:shadowNode.nodeId})).object.objectId;
    const panelEval=async body=>{
      const r=await cdp.call('Runtime.callFunctionOn',{objectId:shadowObject,functionDeclaration:`async function(){${body}}`,awaitPromise:true,returnByValue:true,userGesture:true});
      if(r.exceptionDetails)throw new Error(JSON.stringify(r.exceptionDetails));return r.result.value;
    };
    const panel=await panelEval(fs.readFileSync(path.join(root,'tests/panel-browser-page.js'),'utf8')+';return runPanelBrowserTests(this);');
    assert.ok(panel.ok,JSON.stringify(panel));
    const buttonBounds=await panelEval('const r=this.querySelector(".toggle").getBoundingClientRect();return {x:r.x+r.width/2,y:r.y+r.height/2};');
    await cdp.call('Input.dispatchMouseEvent',{type:'mousePressed',x:buttonBounds.x,y:buttonBounds.y,button:'left',buttons:1,clickCount:1});
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseMoved',x:120,y:250,button:'left',buttons:1});
    await cdp.call('Input.dispatchMouseEvent',{type:'mouseReleased',x:120,y:250,button:'left',buttons:0,clickCount:1});
    const moved=await panelEval('const r=this.querySelector(".toggle").getBoundingClientRect();return {x:r.x,y:r.y,closed:this.querySelector(".deck").hidden,saved:!!sessionStorage.getItem("meeteffects-position")};');
    assert.ok(moved.x<200&&moved.closed&&moved.saved,JSON.stringify(moved));
    panel.checks.push('Native pointer drag moves the button, remembers position and does not open the panel');
    await panelEval('this.querySelector(".toggle").click();');
    await capture('meet-panel-moved.png');
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:390,height:500,deviceScaleFactor:1,mobile:false});await delay(80);
    assert.ok(await panelEval('const r=this.querySelector(".deck").getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;'),'Moved panel escapes resized viewport');
    panel.checks.push('Moved panel remains reachable after viewport resize');
    await cdp.call('Emulation.setDeviceMetricsOverride',{width:1280,height:900,deviceScaleFactor:1,mobile:false});
    await panelEval('this.querySelector(".toggle").click();');
    console.log('PASS room-photo controls and movable Meet panel:',JSON.stringify(panel));
    await cdp.evaluate('(async()=>{globalThis.setupCamera=await navigator.mediaDevices.getUserMedia({video:true,audio:false});return true;})()');
    await cdp.evaluate(`globalThis.roomPhotoSaves=0;globalThis.roomPhotoMatches=false;globalThis.roomSetBackground=MeetEffects.Engine.prototype.setBackground;
      MeetEffects.Engine.prototype.setBackground=function(image){
        const c=document.createElement('canvas');c.width=image.width;c.height=image.height;c.getContext('2d').drawImage(this.source,0,0,c.width,c.height);
        const a=image.getContext('2d').getImageData(0,0,c.width,c.height).data,b=c.getContext('2d').getImageData(0,0,c.width,c.height).data;
        roomPhotoMatches=a.every((v,i)=>v===b[i]);roomPhotoSaves++;return roomSetBackground.call(this,image);
      };true`);
    const setupBegan=Date.now();
    await panelEval('this.querySelector(".toggle").click();this.querySelector(".room-capture").click();');
    assert.ok(await panelEval('return this.querySelector(".room-capture").textContent === "Cancel setup" && this.textContent.includes("Taking photo in 5");'),'Meet panel countdown did not start');
    await capture('meet-room-countdown.png');
    for(let i=0;i<100;i++) {
      if(await panelEval('return this.querySelector(".room-capture").textContent !== "Cancel setup";'))break;
      await delay(100);
    }
    assert.ok(await panelEval('return this.textContent.includes("Room ready—come back and snap") && !this.querySelector(".room-capture").disabled && !this.querySelector(".small.error");'),'Meet panel did not save the synthetic camera at the deadline');
    assert.ok(Date.now()-setupBegan<6500,'Room capture waited beyond its five-second countdown');
    panel.checks.push('Real Meet panel saves Chrome’s animated camera at five seconds despite model foreground detections');
    const immediateBegan=Date.now();
    await panelEval('this.querySelector(".room-capture").click();this.querySelector(".room-now").click();');
    for(let i=0;i<20;i++){if(await cdp.evaluate('roomPhotoSaves===2'))break;await delay(25);}
    assert.ok(await cdp.evaluate('roomPhotoSaves===2&&roomPhotoMatches'),'Take room photo did not copy the current raw camera');
    assert.ok(Date.now()-immediateBegan<1000,'Manual capture waited for a countdown');
    assert.ok(await panelEval('return this.querySelector(".room-capture").textContent === "5-second timer";'),'Immediate photo left a pending timer');
    panel.checks.push('Take room photo immediately saves exact raw-camera pixels and replaces a pending timer');
    await capture('meet-room-ready.png');
    await panelEval('this.querySelector(".room-capture").click();this.querySelector(".reset").click();');
    assert.ok(await panelEval('return this.querySelector(".room-capture").textContent !== "Cancel setup";'),'Reset did not clear the panel countdown');
    panel.checks.push('Reset clears the setup countdown immediately');
    await cdp.evaluate('setupCamera.getTracks().forEach(t=>t.stop()); true');
    await cdp.evaluate('MeetEffects.Engine.prototype.setBackground=roomSetBackground;true');
    await panelEval('this.querySelector(".toggle").click();');
    const result=await cdp.evaluate('runIntegrationTests()');
    for(const name of result.results)console.log(`PASS ${name}`);
    if(!result.ok)throw new Error(result.error + '\nBrowser diagnostics: ' + stderr);
    // The integration suite dispatches pagehide to test teardown. Reload for
    // independent live-effect and audio acceptance with fresh extension state.
    await navigate('https://meet.google.com/meeteffects-test');
    await cdp.evaluate(fs.readFileSync(path.join(root,'tests/room-capture-page.js'),'utf8'));
    const roomCapture=await cdp.evaluate('runRoomCaptureBridgeTests()');
    assert.ok(roomCapture.ok,JSON.stringify(roomCapture));
    console.log('PASS automatic room capture bridge:',JSON.stringify(roomCapture));
    let liveDust = null, memeAudio = null, photoBackground = null;
    await cdp.evaluate(fs.readFileSync(path.join(root,'tests/photo-background-page.js'),'utf8'));
    photoBackground=await cdp.evaluate('runPhotoBackgroundTests()');
    assert.ok(photoBackground.ok,JSON.stringify(photoBackground));
    console.log('PASS photo background:',JSON.stringify(photoBackground));
    if(fs.existsSync(path.join(root,'tests/live-dust-page.js'))) {
      await cdp.evaluate(fs.readFileSync(path.join(root,'tests/live-dust-page.js'),'utf8'));
      liveDust = await cdp.evaluate(`runLiveDustTests({actualModel:${!!process.env.AUTOMATIC_SAMPLE}})`);
      for(const [name,data] of Object.entries(liveDust.frames || {})) fs.writeFileSync(path.join(artifacts,`live-test-${name}.png`),Buffer.from(data.split(',')[1],'base64'));
      delete liveDust.frames;
      assert.ok(liveDust.ok,JSON.stringify(liveDust));
      console.log('PASS continuous dust:',JSON.stringify(liveDust));
    }
    if(fs.existsSync(path.join(root,'tests/meme-audio-page.js'))) {
      await navigate('https://meet.google.com/meeteffects-test');
      await cdp.evaluate(fs.readFileSync(path.join(root,'tests/meme-audio-page.js'),'utf8'));
      memeAudio = await cdp.evaluate('runMemeAudioTests()');
      assert.ok(memeAudio.ok,JSON.stringify(memeAudio));
      console.log('PASS outgoing meme audio:',JSON.stringify(memeAudio));
    }
    assert.equal(exceptions.length,0,JSON.stringify(exceptions));
    const report={...result,browser:await cdp.call('Browser.getVersion'),studio:true,automatic,liveDust,memeAudio,photoBackground,panel,roomCapture,exceptions,testedAt:new Date().toISOString(),limitation:'Mocked Meet origin and real local WebRTC loopback; not a live Google Meet call.'};
    fs.writeFileSync(path.join(artifacts,'verification.json'),JSON.stringify(report,null,2));
    console.log(`PASS ${result.results.length} integration checks. Screenshots and report: ${artifacts}`);
  } finally {
    if(cdp){try{await cdp.call('Browser.close');}catch{}cdp.close();}
    if(browser&&browser.exitCode===null){await Promise.race([once(browser,'exit'),delay(3000)]);if(browser.exitCode===null){browser.kill('SIGTERM');await Promise.race([once(browser,'exit'),delay(2000)]);}}
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(profile,{recursive:true,force:true,maxRetries:3});
  }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
