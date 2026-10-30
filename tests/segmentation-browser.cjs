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
// Supply Google's public segmentation_input_rotation0.jpg locally. Never uploads it.
const samplePath = process.env.SEGMENTATION_SAMPLE;
if (!samplePath || !fs.existsSync(samplePath)) throw new Error('Set SEGMENTATION_SAMPLE to the official public sample (see docs/THIRD-PARTY.md).');
const crypto = require('node:crypto');
const sample = fs.readFileSync(samplePath);
assert.equal(crypto.createHash('sha256').update(sample).digest('hex'), '5bf58d8af1f1c33224f3f3bc0ce451c8daf0739cc15a86d59d8c3bf2879afb97');
const scriptPaths = ['vendor/vision-bundle.js', 'vendor/vision_wasm_internal.js', 'segment-inference.js', 'segment-host.js'];
const strictCSP = "default-src 'self'; script-src 'self'; require-trusted-types-for 'script'";
const studioCSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; object-src 'self'; require-trusted-types-for 'script'";
const mainHTML = '<!doctype html><title>Segmentation gate</title><link rel="icon" href="sample.jpg"><script src="/segmentation-page.js"></script>';
const studioHTML = '<!doctype html><title>Segmentation studio gate</title>' +
  ['engine.js','segment-client.js',...scriptPaths,'segmentation-page.js'].map(p=>`<script src="${p}"></script>`).join('');
(async()=>{
  const work = fs.mkdtempSync(path.join(os.tmpdir(),'meeteffects-segmentation-'));
  const ext = path.join(work,'extension'), profile = path.join(work,'profile');
  fs.mkdirSync(ext); fs.mkdirSync(profile);
  for (const name of ['engine.js','segment-client.js','segment-host.js','segment-inference.js','segment-worker.js','vendor']) fs.cpSync(path.join(root,'extension',name),path.join(ext,name),{recursive:true});
  fs.copyFileSync(path.join(root,'tests/segmentation-page.js'),path.join(ext,'segmentation-page.js'));
  fs.writeFileSync(path.join(ext,'sample.jpg'),sample);
  fs.writeFileSync(path.join(ext,'segmentation-studio.html'),studioHTML);
  const manifest = {
    manifest_version:3, name:'MeetEffects segmentation gate', version:'1.0.0', minimum_chrome_version:'111',
    content_scripts:[
      {matches:['https://meet.google.com/*'],js:['engine.js','segment-client.js'],run_at:'document_start',world:'MAIN'},
      {matches:['https://meet.google.com/*'],js:['segment-host.js'],run_at:'document_start',world:'ISOLATED'}
    ],
    background:{service_worker:'segment-worker.js'},
    content_security_policy:{extension_pages:"script-src 'self' 'wasm-unsafe-eval'; object-src 'self'"}
  };
  fs.writeFileSync(path.join(ext,'manifest.json'),JSON.stringify(manifest));
  function content(url) {
    const name=new URL(url).pathname;
    if(name==='/gate') return {body:Buffer.from(mainHTML),type:'text/html',csp:strictCSP};
    const relative=name.slice(1);
    const resolved=path.resolve(ext,relative);
    if(!resolved.startsWith(ext+path.sep)||!fs.existsSync(resolved)||!fs.statSync(resolved).isFile())return {status:404,body:Buffer.from('Not found'),type:'text/plain'};
    return {body:fs.readFileSync(resolved),type:({'.html':'text/html','.js':'text/javascript','.wasm':'application/wasm','.jpg':'image/jpeg'})[path.extname(resolved)]||'application/octet-stream',csp:studioCSP};
  }
  const server=http.createServer((req,res)=>{const c=content(`http://localhost${req.url}`);res.writeHead(c.status||200,{'Content-Type':c.type,'Content-Security-Policy':c.csp||strictCSP});res.end(c.body);});
  let browser,cdp,workerCDP,stderr='';
  const reports=[],exceptions=[],blocked=[],requests=[],contexts=[];
  try {
    server.listen(0,'127.0.0.1');await once(server,'listening');
    const port=server.address().port;
    browser=spawn(executable,['--headless=new','--no-sandbox','--disable-dev-shm-usage','--disable-gpu',
      '--no-first-run','--no-default-browser-check','--disable-background-networking','--disable-component-update',
      '--remote-debugging-port=0',`--user-data-dir=${profile}`,
      `--disable-extensions-except=${ext}`,`--load-extension=${ext}`,'about:blank'],{stdio:['ignore','ignore','pipe']});
    browser.stderr.on('data',data=>{stderr=(stderr+data).slice(-12000);});
    console.log(`Owned segmentation browser PID ${browser.pid}, created ${new Date().toISOString()}; server 127.0.0.1:${port}; ${work}`);
    const activePort=path.join(profile,'DevToolsActivePort');
    for(let i=0;!fs.existsSync(activePort)&&i<100;i++){if(browser.exitCode!==null)throw new Error(stderr);await delay(100);}
    if(!fs.existsSync(activePort))throw new Error(`Browser did not start: ${stderr}`);
    const debugPort=fs.readFileSync(activePort,'utf8').split('\n')[0];
    const targets=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
    cdp=new CDP(targets.find(t=>t.type==='page').webSocketDebuggerUrl);await cdp.ready;
    cdp.on('Runtime.executionContextCreated',e=>contexts.push(e.context));
    cdp.on('Runtime.exceptionThrown',e=>exceptions.push(e.exceptionDetails));
    cdp.on('Runtime.consoleAPICalled',e=>{if(e.type==='error')console.log('Browser console:',e.args.map(a=>a.value||a.description).join(' '));});
    await cdp.call('Page.enable');await cdp.call('Runtime.enable');
    function observeRequests(connection) {
      connection.on('Network.requestWillBeSent', e=>requests.push({url:e.request.url,method:e.request.method,hasBody:!!e.request.postData}));
      connection.on('Fetch.requestPaused',async e=>{
      try {
        if(e.request.url.startsWith('chrome-extension://')||e.request.url.startsWith(`http://127.0.0.1:${port}/`)) {
          await connection.call('Fetch.continueRequest',{requestId:e.requestId});return;
        }
        if(e.request.url.startsWith('https://meet.google.com/')) {
          const c=content(e.request.url);
          await connection.call('Fetch.fulfillRequest',{requestId:e.requestId,responseCode:c.status||200,responseHeaders:[
            {name:'Content-Type',value:c.type},{name:'Content-Security-Policy',value:strictCSP}
          ],body:c.body.toString('base64')});return;
        }
        blocked.push(e.request.url);await connection.call('Fetch.failRequest',{requestId:e.requestId,errorReason:'BlockedByClient'});
      }catch(error){exceptions.push({interception:error.message});}
    }); }
    observeRequests(cdp);
    await cdp.call('Network.enable');
    await cdp.call('Fetch.enable',{patterns:['gate','sample.jpg','segmentation-page.js'].map(name=>({urlPattern:'https://meet.google.com/'+name}))});
    async function navigate(url){
      await cdp.call('Page.navigate',{url});
      for(let i=0;i<100;i++){if(await cdp.evaluate('location.href === '+JSON.stringify(url)+' && typeof runSegmentationTests === "function"'))return;await delay(50);}
      throw new Error('Page did not load: '+url+' '+JSON.stringify(exceptions));
    }
    await navigate('https://meet.google.com/gate');
    assert.equal(await cdp.evaluate('typeof MeetEffects.segmentFrame'),'function');
    assert.ok(await cdp.evaluate('typeof ModuleFactory === "undefined" && typeof MeetEffectsVision === "undefined"'),'ML runtime leaked into MAIN');
    const isolated = contexts.find(c=>c.origin.startsWith('chrome-extension://'));
    assert.ok(isolated,'Actual MV3 isolated world missing');
    const extId=(await cdp.call('Runtime.evaluate',{contextId:isolated.id,expression:'chrome.runtime.id',returnByValue:true})).result.value;
    console.log('Actual isolated extension',extId,await cdp.call('Browser.getVersion'));
    let workerTarget;
    for(let i=0;i<100;i++){
      const list=await(await fetch(`http://127.0.0.1:${debugPort}/json/list`)).json();
      workerTarget=list.find(t=>t.type==='service_worker' && t.url===`chrome-extension://${extId}/segment-worker.js`);
      if(workerTarget)break; await delay(50);
    }
    assert.ok(workerTarget,'Segmentation service worker missing');
    workerCDP=new CDP(workerTarget.webSocketDebuggerUrl);await workerCDP.ready;
    workerCDP.on('Network.requestWillBeSent', e=>requests.push({url:e.request.url,method:e.request.method,hasBody:!!e.request.postData}));
    await workerCDP.call('Network.enable');
    workerCDP.on('Runtime.exceptionThrown',e=>exceptions.push(e.exceptionDetails));
    await workerCDP.call('Runtime.enable');
    for (const [name,url] of [
      ['strict MV3 MAIN → ISOLATED','https://meet.google.com/gate'],
      ['extension studio',`chrome-extension://${extId}/segmentation-studio.html`],
      ['localhost studio',`http://127.0.0.1:${port}/segmentation-studio.html`]
    ]) {
      if(url!=='https://meet.google.com/gate')await navigate(url);
      const report=await cdp.evaluate(`runSegmentationTests(${JSON.stringify(name)})`);
      reports.push(report);console.log(JSON.stringify(report));
      assert.ok(report.ok,report.error+'\n'+stderr);
    }
    assert.ok(reports.every(r=>r.ok),'Every host must pass');
    assert.equal(exceptions.length,0,JSON.stringify(exceptions));
    assert.deepEqual(blocked,[],'Runtime attempted a remote URL');
    assert.ok(requests.every(r=>r.url.startsWith(`chrome-extension://${extId}/`) || r.url.startsWith(`http://127.0.0.1:${port}/`) || ['gate','sample.jpg','segmentation-page.js'].some(name=>r.url==='https://meet.google.com/'+name)), 'Unexpected runtime resource URL');
    assert.ok(requests.every(r=>r.method==='GET'&&!r.hasBody),'Unexpected frame upload');
    const workerHeap=await workerCDP.call('Runtime.getHeapUsage');
    const report={ok:true,workerHeap,browser:await cdp.call('Browser.getVersion'),reports,requests,exceptions,blocked,testedAt:new Date().toISOString(),limitation:'Local public image; strict-CSP mocked Meet origin, actual MV3 injection. No live meeting or camera capture.'};
    if(process.env.SEGMENTATION_REPORT)fs.writeFileSync(process.env.SEGMENTATION_REPORT,JSON.stringify(report,null,2));
    console.log('PASS actual ML segmentation in all three hosts; no remote fetches or uploads');
  } finally {
    workerCDP?.close();
    if(cdp){try{await cdp.call('Browser.close');}catch{}cdp.close();}
    if(browser&&browser.exitCode===null){await Promise.race([once(browser,'exit'),delay(3000)]);if(browser.exitCode===null){browser.kill('SIGTERM');await Promise.race([once(browser,'exit'),delay(2000)]);}}
    await new Promise(resolve=>server.close(resolve));
    fs.rmSync(work,{recursive:true,force:true,maxRetries:3});
  }
})().catch(error=>{console.error(error.stack);process.exitCode=1;});
