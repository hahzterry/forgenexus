// Real loopback Phoenix + LiveKit test. Uses generated audio, never a physical mic.
// Start a local LiveKit server and a backend configured for it before running.
// FN_VOICE_TONE_PATH must point to a generated PCM WAV file.
const { chromium, expect: baseExpect } = require('@playwright/test');
const fs = require('node:fs'), path = require('node:path');
const {execFileSync}=require('node:child_process');
const crypto=require('node:crypto');
const expect = baseExpect.configure({ timeout: 25000 });
const BASE = process.env.FN_LOCAL_UI_URL || 'http://localhost:5173';
const API = process.env.FN_LOCAL_API_URL || 'http://localhost:4001/api';
for (const url of [BASE, API]) if (!['localhost','127.0.0.1'].includes(new URL(url).hostname)) throw Error('Loopback services required');
const tone = process.env.FN_VOICE_TONE_PATH;
if (!tone || !fs.existsSync(tone)) throw Error('FN_VOICE_TONE_PATH must identify generated test audio');
const headers = process.env.FN_RATE_LIMIT_BYPASS_TOKEN ? { 'x-fn-ratelimit-bypass': process.env.FN_RATE_LIMIT_BYPASS_TOKEN } : {};
const out = path.resolve(__dirname, '../test-results/voice-live'); fs.mkdirSync(out, { recursive:true });
const member = JSON.parse(fs.readFileSync(path.resolve(__dirname,'../test-results/local-backend/live-state.json')));
const roomFile = path.join(out,'room.json');
let room = fs.existsSync(roomFile) ? JSON.parse(fs.readFileSync(roomFile)) : null;
const secondFile=path.join(out,'participant.json');
let second=fs.existsSync(secondFile)?JSON.parse(fs.readFileSync(secondFile)):null;
let expectedOutage=false;
const results=[], errors=[], controls=[], sockets=[];
async function pageJoinConfirm(page){await page.getByRole('dialog').getByRole('button',{name:'Join room',exact:true}).click();}
async function snapshot(page) { return page.evaluate(async()=> {
  const {voiceStore:v}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/voice.svelte.ts')?.name || '/src/lib/stores/voice.svelte.ts');
  const streams=[...v.remoteStreams.values()];
  const inbound=[];
  for(const pc of window.__voicePeers || []) if(pc.connectionState!=='closed') for(const stat of (await pc.getStats()).values()) if(stat.type==='inbound-rtp' && stat.kind==='audio') inbound.push({bytes:stat.bytesReceived,energy:stat.totalAudioEnergy});
  return { inRoom:v.isInRoom,roomId:v.activeRoom?.id,connecting:v.isConnecting,muted:v.isMuted,deafened:v.isDeafened,participants:v.participants.length,localTracks:v.localStream?.getAudioTracks().map(t=>({readyState:t.readyState,enabled:t.enabled}))||[],remoteTracks:streams.flatMap(s=>s.getAudioTracks().map(t=>({readyState:t.readyState,enabled:t.enabled}))),inbound,audio:[...document.querySelectorAll('audio[data-voice-user]')].map(a=>({paused:a.paused,time:a.currentTime,readyState:a.readyState,stream:!!a.srcObject}))};
}); }
async function leave(page) { await page.evaluate(async()=>{const {voiceStore}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/voice.svelte.ts')?.name || '/src/lib/stores/voice.svelte.ts');await voiceStore.leaveRoom();}); }
(async()=>{
 const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required',`--use-file-for-fake-audio-capture=${tone}`]});
 const contexts=[], pages=[];
 try {
  if(!room){
   const admin=await browser.newContext({extraHTTPHeaders:headers});
   try{expect((await admin.request.post(API+'/auth/login',{data:{email:process.env.FN_TEST_EMAIL||'admin@forgenexus.local',password:process.env.FN_TEST_PASSWORD||'admin123'}})).status()).toBe(200);
    const res=await admin.request.post(API+'/admin/voice/rooms',{data:{name:'Local voice integration check',slug:'local-voice-integration-check',type:'lounge'}});expect(res.status()).toBe(201);room=(await res.json()).room;fs.writeFileSync(roomFile,JSON.stringify(room,null,2));
   }finally{await admin.close();}
  }
  for(const index of [0,1]) {
   const context=await browser.newContext({extraHTTPHeaders:headers,viewport:{width:1440,height:1000},permissions:['microphone']});contexts.push(context);
   await context.addInitScript(()=>{
    localStorage.setItem('fn_cookie_consent','accepted');
    window.__voicePeers=[];
    const Original=window.RTCPeerConnection;
    window.RTCPeerConnection=class extends Original {constructor(...args){super(...args);window.__voicePeers.push(this);}};
   });
   if(index===1 && !second){
    const name='fnvoice_'+Date.now().toString(36);second={email:name+'@example.test',password:'Fn9!'+crypto.randomBytes(16).toString('hex')};
    const res=await context.request.post(API+'/auth/register',{data:{user:{username:name,...second}}});expect(res.status()).toBe(201);second.id=(await res.json()).user.id;
    if(!/^[0-9a-f-]{36}$/.test(second.id))throw Error('Invalid test user ID');
    execFileSync(process.env.PSQL_PATH||'C:/Program Files/PostgreSQL/17/bin/psql.exe',['-h','localhost','-U','postgres','-d','forge_nexus_dev','-w','-v','ON_ERROR_STOP=1','-c',`UPDATE users SET email_verified_at=timezone('UTC',now()) WHERE id='${second.id}' AND email='${second.email}'`],{env:{...process.env,PGPASSWORD:process.env.PGPASSWORD||'postgres'}});
    fs.writeFileSync(secondFile,JSON.stringify(second));await context.clearCookies();
   }
   const credentials=index===0?{email:member.email,password:member.password}:second;
   const login=await context.request.post(API+'/auth/login',{data:credentials});expect(login.status()).toBe(200);
   const page=await context.newPage();pages.push(page);
   page.on('pageerror',e=>errors.push({page:index,message:e.message}));
   page.on('requestfailed',r=>{const u=new URL(r.url());if(['localhost','127.0.0.1'].includes(u.hostname)&&!(expectedOutage&&u.port==='7880'))errors.push({page:index,path:u.pathname,failure:r.failure()?.errorText});});
   page.on('response',r=>{if(r.status()>=400&&!r.url().includes('/auth/'))errors.push({page:index,path:new URL(r.url()).pathname,status:r.status()});});
   page.on('websocket',ws=>{
    const u=new URL(ws.url());sockets.push({page:index,host:u.host,path:u.pathname});
    if(u.port==='4001')ws.on('framereceived',frame=>{try{const msg=JSON.parse(String(frame.payload));if(msg[3]==='phx_reply' && msg[4]?.response?.livekit?.enabled)controls.push({page:index,url:msg[4].response.livekit.url});}catch{}});
   });
   await page.goto(BASE+'/threads/'+member.threadSlug);await expect(page.locator('.btn-voice-lounge')).toBeVisible();
  }
  async function join(page){await page.locator('.btn-voice-lounge').click();await page.locator('.voice-room-card').filter({hasText:room.name}).click();await pageJoinConfirm(page);await expect(page.getByRole('button',{name:'📞 Disconnect',exact:true})).toBeVisible();await expect.poll(async()=>(await snapshot(page)).connecting).toBe(false);}
  await join(pages[0]);await join(pages[1]);
  await expect.poll(()=>controls.length).toBe(2);
  expect(controls.every(c=>new URL(c.url).hostname==='127.0.0.1')).toBe(true);
  await expect.poll(()=>sockets.filter(s=>s.host==='127.0.0.1:7880').length).toBeGreaterThanOrEqual(2);
  results.push('real Phoenix room joins select the local LiveKit transport');
  for(const page of pages){await expect.poll(async()=>(await snapshot(page)).participants).toBe(2);await expect.poll(async()=>(await snapshot(page)).remoteTracks.filter(t=>t.readyState==='live').length).toBeGreaterThan(0);await expect.poll(async()=>(await snapshot(page)).inbound.some(s=>s.bytes>1000&&s.energy>0)).toBe(true);}
  results.push('two real peers publish and receive non-silent SFU audio');
  for(const page of pages){await expect.poll(async()=>(await snapshot(page)).audio.some(a=>a.stream&&!a.paused&&a.time>0)).toBe(true);}
  results.push('received audio is attached to playing audio elements on the thread page');
  await pages[0].getByRole('button',{name:'🎙️ Mute',exact:true}).click();expect((await snapshot(pages[0])).localTracks.every(t=>!t.enabled)).toBe(true);
  await pages[0].getByRole('button',{name:'🔇 Unmute',exact:true}).click();expect((await snapshot(pages[0])).localTracks.every(t=>t.enabled)).toBe(true);results.push('mute and unmute control the published microphone track');
  await pages[0].getByRole('button',{name:'🎧 Deafen',exact:true}).click();let s=await snapshot(pages[0]);expect(s.remoteTracks.every(t=>!t.enabled)).toBe(true);expect(s.muted).toBe(true);
  await pages[0].getByRole('button',{name:'🔕 Undeafen',exact:true}).click();expect((await snapshot(pages[0])).remoteTracks.every(t=>t.enabled)).toBe(true);results.push('deafen and undeafen control received audio');
  await pages[0].getByRole('button',{name:'📞 Disconnect',exact:true}).click();await expect.poll(async()=>(await snapshot(pages[0])).inRoom).toBe(false);await expect.poll(async()=>(await snapshot(pages[1])).participants).toBe(1);expect((await snapshot(pages[0])).localTracks).toEqual([]);await expect.poll(async()=>(await snapshot(pages[0])).audio.length).toBe(0);results.push('leaving clears local tracks, audio elements, and peer presence');
  await pages[0].locator('.voice-room-card').filter({hasText:room.name}).click();await pageJoinConfirm(pages[0]);await expect.poll(async()=>(await snapshot(pages[0])).inRoom).toBe(true);await expect.poll(async()=>(await snapshot(pages[0])).audio.some(a=>!a.paused&&a.time>0)).toBe(true);results.push('rejoining restores SFU audio after cleanup');

  await pages[0].evaluate(async(roomId)=>{const {voiceStore:v}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/voice.svelte.ts')?.name || '/src/lib/stores/voice.svelte.ts');const {socketStore:s}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/socket.svelte.ts')?.name || '/src/lib/stores/socket.svelte.ts');await v.leaveRoom();await v.joinRoom(roomId,s.getSocket());},room.id);
  await expect.poll(async()=>(await snapshot(pages[0])).audio.some(a=>!a.paused&&a.time>0)).toBe(true);results.push('immediate leave/rejoin cannot tear down the new SFU connection');
  await leave(pages[0]);
  const denied=await pages[0].evaluate(async(roomId)=>{
    const {voiceStore:v}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/voice.svelte.ts')?.name || '/src/lib/stores/voice.svelte.ts');const {socketStore:s}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/socket.svelte.ts')?.name || '/src/lib/stores/socket.svelte.ts');
    const original=navigator.mediaDevices.getUserMedia.bind(navigator.mediaDevices);
    navigator.mediaDevices.getUserMedia=()=>Promise.reject(new DOMException('Test microphone denied','NotAllowedError'));
    try{await v.joinRoom(roomId,s.getSocket());return false;}catch{return !v.isInRoom&&!v.isConnecting&&!v.localStream;}finally{navigator.mediaDevices.getUserMedia=original;}
  },room.id);expect(denied).toBe(true);results.push('microphone permission failure rejects and releases all connection state');
  let release,tokenHeld=false;const gate=new Promise(resolve=>release=resolve);
  const tokenPattern='**/api/voice/rooms/'+room.id+'/token';
  await contexts[0].route(tokenPattern,async route=>{tokenHeld=true;await gate;await route.continue();});
  await pages[0].locator('.voice-room-card').filter({hasText:room.name}).click();await pageJoinConfirm(pages[0]);
  await expect.poll(()=>tokenHeld).toBe(true);expect((await snapshot(pages[0])).inRoom).toBe(false);expect((await snapshot(pages[0])).connecting).toBe(true);
  release();await expect.poll(async()=>(await snapshot(pages[0])).inRoom).toBe(true);await contexts[0].unroute(tokenPattern);
  await expect.poll(async()=>(await snapshot(pages[0])).audio.some(a=>!a.paused&&a.time>0)).toBe(true);results.push('connected state waits for actual SFU media initialization');
  await pages[0].locator('.logo').click();await expect(pages[0]).not.toHaveURL(/\/threads\//);
  await expect.poll(async()=>(await snapshot(pages[0])).inRoom).toBe(true);await expect.poll(async()=>(await snapshot(pages[0])).audio.some(a=>!a.paused&&a.time>0)).toBe(true);results.push('audio continues after client navigation away from the thread');
  if(process.env.FN_VOICE_OUTAGE_TRIGGER){
    expectedOutage=true;
    fs.writeFileSync(process.env.FN_VOICE_OUTAGE_TRIGGER,'ready');
    console.log('READY_FOR_LOCAL_LIVEKIT_STOP');
    for(const page of pages){
      await expect.poll(async()=>(await snapshot(page)).inRoom,{timeout:90000}).toBe(false);
      expect((await snapshot(page)).localTracks).toEqual([]);
      await expect.poll(async()=>(await snapshot(page)).audio.length).toBe(0);
    }
    await expect.poll(async()=>{const r=await contexts[0].request.get(API+'/voice/rooms');return (await r.json()).rooms.find(r=>r.id===room.id)?.participant_count;}).toBe(0);
    results.push('a real LiveKit server outage releases microphone, playback, and Phoenix room presence');
  }
  expect(errors).toEqual([]);
  await pages[0].screenshot({path:path.join(out,'voice-lounge.png')});
  console.log('PASSED',results);
 } catch(error){const states=await Promise.all(pages.map(p=>snapshot(p).catch(e=>({error:e.message}))));fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors,controls,sockets,states,error:error.stack},null,2));throw error;}
 finally{for(const page of pages)await leave(page).catch(()=>{});await browser.close();}
 fs.writeFileSync(path.join(out,'results.json'),JSON.stringify({results,errors,controls,sockets},null,2));
})().catch(e=>{console.error(e);process.exitCode=1});
