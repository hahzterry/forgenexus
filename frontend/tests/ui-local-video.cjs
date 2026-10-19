// Real loopback Phoenix/LiveKit test. Camera/mic are generated; screen capture
// uses only the uniquely named synthetic browser tab, never the desktop.
const {chromium,expect:baseExpect}=require('@playwright/test');
const fs=require('node:fs'),path=require('node:path');
const expect=baseExpect.configure({timeout:25000});
const BASE=process.env.FN_LOCAL_UI_URL||'http://localhost:5173';
const API=process.env.FN_LOCAL_API_URL||'http://localhost:4001/api';
for(const url of [BASE,API])if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Loopback services required');
const headers=process.env.FN_RATE_LIMIT_BYPASS_TOKEN?{'x-fn-ratelimit-bypass':process.env.FN_RATE_LIMIT_BYPASS_TOKEN}:{};
const out=path.resolve(__dirname,'../test-results/video-live');fs.mkdirSync(out,{recursive:true});
const state=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../test-results/local-backend/live-state.json')));
const peer=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../test-results/voice-live/participant.json')));
const room=JSON.parse(fs.readFileSync(path.resolve(__dirname,'../test-results/voice-live/room.json')));
const title='ForgeNexus isolated screen-share test';
const results=[],errors=[]; const push=results.push.bind(results);results.push=(s)=>{console.log('PASS',s);return push(s);};
async function info(page){return page.evaluate(async()=>{
 const {voiceStore:v}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/voice.svelte.ts')?.name||'/src/lib/stores/voice.svelte.ts');
 const stats=[];for(const pc of window.__mediaPeers)if(pc.connectionState!=='closed')for(const s of (await pc.getStats()).values())if(s.type==='inbound-rtp'&&s.kind==='video')stats.push({bytes:s.bytesReceived,frames:s.framesDecoded,width:s.frameWidth,height:s.frameHeight});
 return {inRoom:v.isInRoom,connecting:v.isConnecting,video:v.isVideoOn,sharing:v.isScreenSharing,camera:v.localStream?.getVideoTracks().map(t=>({id:t.id,state:t.readyState}))||[],screen:v.screenStream?.getVideoTracks().map(t=>({id:t.id,state:t.readyState,surface:t.getSettings().displaySurface}))||[],stats,tiles:[...document.querySelectorAll('.video-tile')].map(el=>{const video=el.querySelector('video');return {label:el.textContent.trim(),self:el.classList.contains('self'),width:video.videoWidth,height:video.videoHeight,time:video.currentTime,paused:video.paused,tracks:video.srcObject?.getVideoTracks().length||0};})};
});}
async function act(page,name,args){return page.evaluate(async({name,args})=>{const {voiceStore:v}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/voice.svelte.ts')?.name||'/src/lib/stores/voice.svelte.ts');return v[name](...(args||[]));},{name,args});}
(async()=>{
 const browser=await chromium.launch({headless:false,args:['--use-fake-device-for-media-stream','--auto-accept-camera-and-microphone-capture','--autoplay-policy=no-user-gesture-required',`--auto-select-tab-capture-source-by-title=${title}`]});
 const pages=[],contexts=[];
 try{
  for(const credentials of [state,peer]){
   const context=await browser.newContext({serviceWorkers:'block',extraHTTPHeaders:headers,permissions:['microphone','camera'],viewport:{width:1440,height:1000}});contexts.push(context);
   await context.addInitScript(()=>{
    localStorage.setItem('fn_cookie_consent','accepted');window.__mediaPeers=[];
    window.__capturedTracks=[];const gum=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=async options=>{const stream=await gum(options);window.__capturedTracks.push(...stream.getTracks());return stream;};
    const Native=window.RTCPeerConnection;window.RTCPeerConnection=class extends Native{constructor(...args){super(...args);window.__mediaPeers.push(this);}};
const capture=navigator.mediaDevices.getDisplayMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getDisplayMedia=async options=>{
     const stream=await capture({...options,audio:false,monitorTypeSurfaces:'exclude',selfBrowserSurface:'exclude',video:{...(typeof options?.video==='object'?options.video:{}),displaySurface:'browser'}}).catch(e=>{console.error('Capture failed:',e.name,e.message);throw e;});
     if(stream.getVideoTracks()[0]?.getSettings().displaySurface!=='browser'){stream.getTracks().forEach(t=>t.stop());throw Error('Only the synthetic browser tab may be shared');}
     window.__lastDisplayStream=stream;return stream;
    };
   });
   expect((await context.request.post(API+'/auth/login',{data:{email:credentials.email,password:credentials.password}})).status()).toBe(200);
   const token=await context.request.post(API+'/voice/rooms/'+room.id+'/token');expect(token.status()).toBe(200);expect(['localhost','127.0.0.1']).toContain(new URL((await token.json()).url).hostname);
   const page=await context.newPage();pages.push(page);page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('font')&&!m.text().includes('Failed to load resource'))console.log(m.text());});
   await page.goto(BASE+'/threads/'+state.threadSlug);await expect(page.locator('.btn-voice-lounge')).toBeVisible();
   await page.locator('.btn-voice-lounge').click();const card=page.locator('.voice-room-card').filter({hasText:room.name});await card.click();
   const setup=page.getByRole('dialog',{name:'Join '+room.name});await expect(setup).toBeVisible();await expect(setup.getByRole('button',{name:'Join room',exact:true})).toBeEnabled();expect((await info(page)).inRoom).toBe(false);
   if(pages.length===1){
    await page.keyboard.press('Escape');await expect(setup).not.toBeVisible();await expect.poll(()=>page.evaluate(()=>window.__capturedTracks.every(t=>t.readyState==='ended'))).toBe(true);await expect(card).toBeFocused();results.push('cancelling pre-join releases preview tracks and restores focus without joining');
    await page.evaluate(()=>{window.__previewGum=navigator.mediaDevices.getUserMedia;navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Preview microphone denied','NotAllowedError'));});
    await card.click();await expect(setup.getByRole('alert')).toContainText('Preview microphone denied');await expect(setup.getByRole('button',{name:'Join room',exact:true})).toBeDisabled();expect((await info(page)).inRoom).toBe(false);
    await page.evaluate(()=>navigator.mediaDevices.getUserMedia=window.__previewGum);await setup.getByRole('button',{name:'Retry preview'}).click();await expect(setup.getByRole('button',{name:'Join room',exact:true})).toBeEnabled();results.push('denied preview permission blocks entry and recovers through retry');
    const devices=await page.evaluate(()=>navigator.mediaDevices.enumerateDevices().then(ds=>({mic:ds.find(d=>d.kind==='audioinput'&&d.deviceId!=='default')?.deviceId,cam:ds.find(d=>d.kind==='videoinput')?.deviceId})));
    await setup.getByLabel('Microphone',{exact:true}).selectOption(devices.mic);await expect(setup.getByRole('button',{name:'Join room',exact:true})).toBeEnabled();await setup.getByLabel('Camera',{exact:true}).selectOption(devices.cam);await setup.getByRole('checkbox',{name:'Turn on camera',exact:true}).check();
    await expect.poll(()=>setup.locator('video').evaluate(v=>v.videoWidth)).toBeGreaterThan(0);await expect.poll(()=>setup.getByLabel('Microphone level',{exact:true}).evaluate(m=>m.value)).toBeGreaterThan(0);await setup.screenshot({path:path.join(out,'prejoin.png')});expect((await info(page)).inRoom).toBe(false);results.push('selected camera preview plays and microphone meter responds before joining');
    await setup.getByRole('checkbox',{name:'Turn on camera',exact:true}).uncheck();await setup.getByRole('checkbox',{name:'Join with microphone muted'}).check();
   }
   if(pages.length===2){await setup.getByRole('checkbox',{name:'Turn on camera',exact:true}).check();await expect.poll(()=>setup.locator('video').evaluate(v=>v.videoWidth)).toBeGreaterThan(0);}
   await setup.getByRole('button',{name:'Join room',exact:true}).click();await expect(setup).not.toBeVisible();await expect.poll(async()=>(await info(page)).inRoom).toBe(true);
   if(pages.length===1){const choice=await page.evaluate(async()=>{const {voiceStore:v}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/voice.svelte.ts').name);return {muted:v.isMuted,enabled:v.localStream.getAudioTracks()[0].enabled,device:v.localStream.getAudioTracks()[0].getSettings().deviceId,saved:JSON.parse(localStorage.getItem('fn-voice-devices'))};});expect(choice.muted).toBe(true);expect(choice.enabled).toBe(false);expect(choice.device).toBe(choice.saved.microphoneId);results.push('joining uses the selected microphone and starts muted, remembering device choices');}
   await page.locator('.main-nav a[href="/chat"]').click();await expect(page.locator('.voice-control-bar')).toBeVisible();if(pages.length===2){expect((await info(page)).video).toBe(true);await expect.poll(async()=>(await info(pages[0])).tiles.some(t=>!t.self&&t.width>0)).toBe(true);await page.getByTitle('Turn off camera',{exact:true}).click();await expect.poll(async()=>(await info(pages[0])).tiles.length).toBe(0);results.push('joining with camera enabled publishes video to the other participant');}
  }
  const source=await contexts[0].newPage();
  await source.route('**/__synthetic-share-source',route=>route.fulfill({contentType:'text/html',body:`<!doctype html><title>${title}</title><canvas width="960" height="540"></canvas><script>const c=document.querySelector('canvas'),x=c.getContext('2d');let n=0;setInterval(()=>{x.fillStyle='hsl('+((n++*7)%360)+' 80% 40%)';x.fillRect(0,0,960,540);x.fillStyle='white';x.font='40px sans-serif';x.fillText('ForgeNexus generated screen test '+n,40,240);},100);</script>`}));
  await source.goto(BASE+'/__synthetic-share-source'); await contexts[0].clearPermissions();expect(await source.title()).toBe(title);console.log('Synthetic tab ready:',await source.title());
  await pages[0].getByTitle('Turn on camera',{exact:true}).click();
  await expect.poll(async()=>(await info(pages[0])).video).toBe(true);
  await expect.poll(async()=>(await info(pages[0])).tiles.some(t=>t.self&&t.width>0&&t.time>0)).toBe(true);results.push('generated camera produces a playing local preview');
  await expect.poll(async()=>(await info(pages[1])).tiles.some(t=>!t.self&&t.width>0&&t.time>0)).toBe(true);
  await expect.poll(async()=>(await info(pages[1])).stats.some(s=>s.bytes>1000&&s.frames>5)).toBe(true);results.push('the second peer decodes real LiveKit camera video');
  await pages[0].bringToFront();await pages[0].getByTitle('Share screen',{exact:true}).click();await expect.poll(async()=>(await info(pages[0])).sharing).toBe(true);
  await expect.poll(async()=>(await info(pages[0])).screen[0]?.surface).toBe('browser');results.push('screen share captures the synthetic tab through native getDisplayMedia');
  await expect.poll(async()=>(await info(pages[1])).tiles.filter(t=>!t.self&&t.width>0&&t.time>0).length).toBe(2);results.push('camera and screen share render as separate remote video tiles');
  const shared=pages[1].locator('[data-video-source=screen_share]');const before=await shared.boundingBox();await pages[1].getByRole('button',{name:'Enlarge screen share',exact:true}).click();await expect(shared).toHaveClass(/expanded/);const focused=pages[1].getByRole('dialog',{name:'Screen share',exact:true});await expect(focused).toBeVisible();await expect.poll(()=>focused.locator('video').evaluate(v=>v.videoWidth)).toBeGreaterThan(0);await focused.screenshot({path:path.join(out,'expanded-share.png')});await expect.poll(async()=>(await focused.boundingBox()).width).toBeGreaterThan(before.width*2);await focused.getByRole('button',{name:'Reduce screen share',exact:true}).click();await expect(focused).not.toBeVisible();await expect(shared).not.toHaveClass(/expanded/);results.push('remote screen share enlarges and reduces through accessible controls');
  await expect.poll(async()=>(await info(pages[0])).tiles.filter(t=>t.self&&t.width>0&&t.time>0).length).toBe(2);results.push('camera and screen share both have local previews');
  await pages[0].getByTitle('Turn off camera',{exact:true}).click();await expect.poll(async()=>(await info(pages[0])).camera.length).toBe(0);await expect.poll(async()=>(await info(pages[1])).tiles.filter(t=>!t.self&&t.width>0).length).toBe(1);expect((await info(pages[0])).sharing).toBe(true);results.push('stopping the camera preserves the screen share');
  await pages[1].getByRole('button',{name:'Enlarge screen share',exact:true}).click();await pages[0].getByTitle('Stop sharing',{exact:true}).click();await expect(pages[1].getByRole('dialog',{name:'Screen share',exact:true})).not.toBeVisible();await expect.poll(async()=>(await info(pages[0])).screen.length).toBe(0);await expect.poll(async()=>(await info(pages[1])).tiles.length).toBe(0);results.push('stopping screen share clears capture tracks and remote tiles');
  await pages[0].bringToFront();await pages[0].getByTitle('Share screen',{exact:true}).click();await expect.poll(async()=>(await info(pages[0])).sharing).toBe(true);
  await source.close();await expect.poll(async()=>(await info(pages[0])).sharing).toBe(false);await expect.poll(async()=>(await info(pages[1])).tiles.length).toBe(0);results.push('closing the captured tab clears sharing state and remote video');
  const denied=await pages[0].evaluate(async()=>{
   const {voiceStore:v}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/voice.svelte.ts')?.name||'/src/lib/stores/voice.svelte.ts');
   const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Test camera denied','NotAllowedError'));
   try{await v.toggleVideo();return !v.isVideoOn&&!v.localStream?.getVideoTracks().length;}finally{navigator.mediaDevices.getUserMedia=original;}
  });expect(denied).toBe(true);results.push('denied camera permission leaves no false camera state');
  await pages[0].getByTitle('Turn on camera',{exact:true}).click();await expect.poll(async()=>(await info(pages[1])).tiles.some(t=>t.width>0)).toBe(true);
  await act(pages[0],'leaveRoom');await expect.poll(async()=>(await info(pages[0])).camera.length).toBe(0);await expect.poll(async()=>(await info(pages[1])).tiles.length).toBe(0);results.push('leaving a video call clears capture tracks and remote tiles');
  expect(errors).toEqual([]);console.log('PASSED',results);
 }catch(error){const states=await Promise.all(pages.map(p=>info(p).catch(e=>({error:e.message}))));fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors,states,error:error.stack},null,2));throw error;}
 finally{for(const page of pages)await act(page,'leaveRoom').catch(()=>{});await browser.close();}
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
