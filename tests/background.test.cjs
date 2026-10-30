const {test}=require('node:test');
const assert=require('node:assert/strict');
require('../extension/engine.js');require('../extension/background.js');
const {estimateRoom}=MeetEffects;
test('automatic room fill removes a foreground that was present from the first frame',()=>{
 const w=32,h=24,frame=new Uint8ClampedArray(w*h*4),mask=new Uint8Array(w*h);
 for(let y=0;y<h;y++)for(let x=0;x<w;x++){
  const i=y*w+x,person=x>=10&&x<22&&y>=4;
  frame.set(person?[250,30,40,255]:[40,100,150,255],i*4);mask[i]=person?255:0;
 }
 const {pixels,hidden}=estimateRoom(frame,mask,w,h);
 for(let i=0;i<w*h;i++)assert.deepEqual([...pixels.slice(i*4,i*4+4)],[40,100,150,255]);
 assert.equal(hidden[12*w+9],1,'mask edge must be expanded');
});
test('automatic estimate preserves visible room and rejects a frame without any room',()=>{
 const w=12,h=12,frame=new Uint8ClampedArray(w*h*4),mask=new Uint8Array(w*h);
 for(let i=0;i<w*h;i++)frame.set([i%230,80,100,255],i*4);
 assert.deepEqual(estimateRoom(frame,mask,w,h).pixels,frame);
 mask.fill(255);assert.throws(()=>estimateRoom(frame,mask,w,h),/cannot see any room/);
 assert.throws(()=>estimateRoom(frame,new Uint8Array(3),w,h),/dimensions/);
});
