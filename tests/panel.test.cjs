const {test} = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');

// Deterministic UI event harness: deliberately hold FileReader completion.
// Real DOM/extension rendering is covered separately by the Chromium runner.
function panel() {
  class Element extends EventTarget {
    constructor(tag) { super();this.tagName=tag;this.children=[];this.textContent='';this.classList={toggle(){}}; }
    append(child) { this.children.push(child); }
    setAttribute(name,value) { this[name]=value; }
    attachShadow() { this.shadow=new Element('shadow');return this.shadow; }
    matches() { return false; }
  }
  const document=new EventTarget(), commands=[], readers=[];
  document.documentElement=new Element('html');document.getElementById=()=>null;
  document.createElement=tag=>new Element(tag);document.createTextNode=text=>({textContent:text});
  document.addEventListener('meeteffects:command',event=>{
    const command=JSON.parse(event.detail);commands.push(command);
    if(command.type==='status')document.dispatchEvent(new CustomEvent('meeteffects:status',{detail:JSON.stringify({cameras:1,plate:true,effect:'none',snap:false})}));
  });
  class FileReader {
    constructor(){readers.push(this);this.result='data:image/png;base64,AAAA';}
    readAsDataURL(){}
    abort(){this.aborted=true;}
  }
  vm.runInNewContext(fs.readFileSync(path.join(__dirname,'../extension/panel.js'),'utf8'),{
    document,Element,FileReader,CustomEvent,CSSStyleSheet:class{replaceSync(){}},
    addEventListener(){},setInterval(){return 1;},clearInterval(){}
  });
  const nodes=[];
  function walk(node){nodes.push(node);for(const child of node.children||[])walk(child);if(node.shadow)walk(node.shadow);}
  walk(document.documentElement);
  const file=nodes.find(n=>n.type==='file'&&n.accept.includes('gif'));
  return {commands,readers,file,room:nodes.find(n=>n.type==='file'&&!n.accept.includes('gif')),reset:nodes.find(n=>n.tagName==='button'&&n.textContent==='Back to reality')};
}
test('reset cancels a file read before it can become a new image command',async()=>{
  const p=panel();p.file.files=[{size:10,type:'image/png'}];await p.file.onchange();
  p.reset.onclick();assert.equal(p.readers[0].aborted,true);
  p.readers[0].onload();
  assert.equal(p.commands.filter(c=>c.type==='image').length,0);
  assert.equal(p.commands.at(-1).effect,'none');
});
test('older file reads cannot override the latest selected upload',async()=>{
  const p=panel();p.file.files=[{size:10,type:'image/png'}];await p.file.onchange();await p.file.onchange();
  p.readers[1].result='data:image/png;base64,BBBB';p.readers[1].onload();p.readers[0].onload();
  assert.deepEqual(p.commands.filter(c=>c.type==='image').map(c=>c.data),['data:image/png;base64,BBBB']);
});
test('room uploads cancel older reads and never issue an effect command',()=>{
  const p=panel();p.room.files=[{size:10,type:'image/png'}];p.room.onchange();p.room.onchange();
  assert.equal(p.readers[0].aborted,true);
  p.readers[1].result='data:image/png;base64,BBBB';p.readers[1].onload();p.readers[0].onload();
  assert.deepEqual(p.commands.filter(c=>c.type==='background').map(c=>c.data),['data:image/png;base64,BBBB']);
  assert.equal(p.commands.filter(c=>c.type==='effect').length,0);
});
