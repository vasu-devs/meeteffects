async function runPanelBrowserTests(shadow) {
  const checks = [], button = shadow.querySelector('.toggle'), deck = shadow.querySelector('.deck');
  const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  const wait = async predicate => { const start=performance.now();while(!predicate()){if(performance.now()-start>5000)throw new Error('Panel photo state timed out: '+JSON.stringify(state));await new Promise(r=>setTimeout(r,25));} };
  let state;
  const listener = event => { state=JSON.parse(event.detail); };
  document.addEventListener('meeteffects:status',listener);
  try {
    button.click(); assert(!deck.hidden, 'Click opens the effects panel');
    assert(shadow.querySelector('[aria-label="5-second room timer"]').disabled, 'Room capture waits for the Meet camera');
    assert(shadow.querySelector('details summary').textContent === 'Or use a photo', 'Photo upload remains an optional fallback');
    const before=button.getBoundingClientRect();
    button.dispatchEvent(new KeyboardEvent('keydown',{key:'ArrowLeft',altKey:true,bubbles:true}));
    assert(button.getBoundingClientRect().left < before.left-20, 'Alt-arrow keys move the MeetEffects button');
    const image=document.createElement('canvas');image.width=640;image.height=360;
    image.getContext('2d').fillStyle='#204060';image.getContext('2d').fillRect(0,0,640,360);
    const photoFile=new File([await new Promise(r=>image.toBlob(r))],'room.png',{type:'image/png'});
    const transfer=new DataTransfer();transfer.items.add(photoFile);
    const upload=shadow.querySelector('[aria-label="Empty-room before image"]');
    upload.files=transfer.files;upload.dispatchEvent(new Event('change'));
    await wait(()=>state?.background&&!state.backgroundLoading);
    assert(state.cameras===0&&state.effect==='none', 'Panel photo picker works before camera startup without activating dust');
    const invalid=new DataTransfer();invalid.items.add(new File(['invalid'],'broken.png',{type:'image/png'}));
    upload.files=invalid.files;upload.dispatchEvent(new Event('change'));
    await wait(()=>state.backgroundError&&!state.backgroundLoading);
    assert(state.background&&state.effect==='none', 'Invalid replacement keeps the previous room photo and effect');
    const replacement=new DataTransfer();replacement.items.add(photoFile);
    upload.files=replacement.files;upload.dispatchEvent(new Event('change'));
    await wait(()=>state.background&&!state.backgroundLoading&&!state.backgroundError);
    const bounds=deck.getBoundingClientRect();
    assert(bounds.left>=0&&bounds.right<=innerWidth&&bounds.bottom<=innerHeight,'Open panel stays inside the viewport');
    button.click();assert(deck.hidden,'Click still closes the panel after moving');
    return {ok:true,checks};
  } catch(error) {return {ok:false,checks,error:error.stack};}
  finally {document.removeEventListener('meeteffects:status',listener);}
}
