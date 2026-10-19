// Real local backend entry-point checks; generated media only, no physical devices.
const {chromium,expect:baseExpect}=require('@playwright/test');
const expect=baseExpect.configure({timeout:25000});
const fs=require('node:fs'),path=require('node:path');
const BASE=process.env.FN_LOCAL_UI_URL||'http://localhost:5173',API=process.env.FN_LOCAL_API_URL||'http://localhost:4001/api';
for(const url of [BASE,API])if(!['localhost','127.0.0.1'].includes(new URL(url).hostname))throw Error('Loopback services required');
const member=JSON.parse(fs.readFileSync(path.join(__dirname,'../test-results/local-backend/live-state.json')));
const room=JSON.parse(fs.readFileSync(path.join(__dirname,'../test-results/voice-live/room.json')));
const headers=process.env.FN_RATE_LIMIT_BYPASS_TOKEN?{'x-fn-ratelimit-bypass':process.env.FN_RATE_LIMIT_BYPASS_TOKEN}:{};
const results=[],errors=[];
async function active(page){return page.evaluate(async()=>{const {voiceStore}=await import(performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/voice.svelte.ts').name);return voiceStore.isInRoom;});}
(async()=>{
 const browser=await chromium.launch({args:['--use-fake-device-for-media-stream','--use-fake-ui-for-media-stream','--autoplay-policy=no-user-gesture-required']});
 const context=await browser.newContext({serviceWorkers:'block',permissions:['microphone','camera'],extraHTTPHeaders:headers,viewport:{width:1440,height:1000}});
 await context.addInitScript(()=>localStorage.setItem('fn_cookie_consent','accepted'));
 const page=await context.newPage();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error'&&!m.text().includes('font')&&!m.text().includes('Failed to load resource'))console.log(m.text());});
 try{
  expect((await context.request.post(API+'/auth/login',{data:{email:member.email,password:member.password}})).status()).toBe(200);
  await page.goto(BASE+'/chat');
  const chatRoom=page.locator('.voice-room').filter({hasText:room.name});await expect(chatRoom).toBeVisible();await chatRoom.click();
  const dialog=page.getByRole('dialog',{name:'Join '+room.name});await expect(dialog).toBeVisible();await expect(dialog.getByRole('button',{name:'Join room',exact:true})).toBeEnabled();expect(await active(page)).toBe(false);
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();await expect(dialog).not.toBeVisible();await expect(chatRoom).toBeFocused();results.push('chat entry opens setup and cancellation keeps the user outside the room');
  await page.locator('.main-nav a[href="/live"]').click();const liveRoom=page.locator('.room-card').filter({hasText:room.name});await expect(liveRoom).toBeVisible();await liveRoom.click();await expect(dialog).toBeVisible();
  await page.setViewportSize({width:375,height:812});const box=await dialog.boundingBox();expect(box.x).toBeGreaterThanOrEqual(0);expect(box.width).toBeLessThanOrEqual(375);await expect(dialog.getByRole('button',{name:'Cancel',exact:true})).toBeVisible();await dialog.screenshot({path:path.join(__dirname,'../test-results/video-live/prejoin-mobile.png')});results.push('setup fits a narrow mobile viewport');
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();expect(await active(page)).toBe(false);results.push('live directory setup cancels without joining');
  await page.setViewportSize({width:1440,height:1000});await liveRoom.click();await dialog.getByRole('button',{name:'Join room',exact:true}).click();await expect(page).toHaveURL(BASE+'/chat');await expect.poll(()=>active(page)).toBe(true);results.push('live directory confirmation joins the real backend and opens chat');
  expect(errors).toEqual([]);console.log('PASSED',results);
 }catch(error){console.log('Visible errors:',await page.locator('.error,[role=alert]').allTextContents());throw error;}finally{
  await page.evaluate(async()=>{const resource=performance.getEntriesByType('resource').find(e=>new URL(e.name).pathname==='/src/lib/stores/voice.svelte.ts');if(resource){const {voiceStore}=await import(resource.name);await voiceStore.leaveRoom();}}).catch(()=>{});
  await browser.close();
 }
 fs.writeFileSync(path.join(__dirname,'../test-results/video-live/prejoin-entry-results.json'),JSON.stringify({results,errors},null,2));
})().catch(error=>{console.error(error);process.exitCode=1;});
