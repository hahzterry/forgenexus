// Run against the local frontend: npm run dev -- --host 127.0.0.1 --port 5173
// Then: node tests/ui-refresh.cjs
// All API and Phoenix socket traffic uses isolated fixtures; no backend writes.
// Optional FN_UI_REPORT_DIR selects the screenshots and JSON report directory.
const {chromium,expect:baseExpect}=require('@playwright/test');
const expect=baseExpect.configure({timeout:15000});
const fs=require('node:fs');
const BASE=process.env.FN_UI_BASE_URL || 'http://127.0.0.1:5173';
if(!['localhost','127.0.0.1'].includes(new URL(BASE).hostname))throw new Error('UI checks require a local server');
const path=require('node:path');
const out=process.env.FN_UI_REPORT_DIR || path.resolve(__dirname,'../test-results/ui-refresh');
fs.mkdirSync(out,{recursive:true});
const results=[];
const user={id:'u1',username:'Builder',slug:'builder',display_name:'Builder',email:'builder@example.test',inserted_at:'2026-10-16T12:00:00Z',post_count:0,thread_count:0,reputation:0,points:0,trust_level:1,status:'active',email_verified:true,is_staff:false};
const thread={id:'t1',title:'Build something together',slug:'build-together',reply_count:0,view_count:1,is_locked:false,is_pinned:false,inserted_at:'2026-10-17T00:00:00Z',user,forum:{id:'f1',name:'Creator Workshop',slug:'creator-workshop'},tags:[]};
const post=(body,id='p1')=>({id,body,body_html:body,user,inserted_at:'2026-10-17T00:00:00Z',like_count:0,ratings:[],attachments:[]});
const forum={id:'f1',name:'Creator Workshop',slug:'creator-workshop',description:'Share ideas and build together',thread_count:3,post_count:7,last_post_at:null,last_post_user:null,viewers_count:0,parent_id:null,children:[],rules:[]};
const stats={total_members:42,total_threads:3,total_posts:7,online_count:12,newest_member:null,recent_threads:[],new_members_this_week:[],posts_today:0,threads_today:0,new_members_today:0};
async function setup(browser,{width=1440,light=false,role='guest',presence=12,hold=false}={}){
 const context=await browser.newContext({viewport:{width,height:1000}});let release;const gate=new Promise(r=>release=r);const calls=[];const sockets=[];const joins=[];
 await context.addInitScript(({light})=>{if(localStorage.getItem('fn-light-mode')===null)localStorage.setItem('fn-light-mode',light?'1':'0');localStorage.setItem('fn_cookie_consent','accepted');}, {light});
 await context.route('**/api/**',async route=>{
  const req=route.request();const url=new URL(req.url());if(!url.pathname.startsWith('/api/')) return route.continue();const path=url.pathname.replace(/^\/api/,'');calls.push({path,method:req.method()});let data={};let status=200;
  if(path==='/auth/me')data={user:role==='guest'?null:{...user,is_staff:role==='staff'}};
  else if(path==='/auth/refresh')data={token:'local-fixture-token'};
  else if(path==='/stats/welcome'){if(hold)await gate;if(presence==='error'){data={error:'Unavailable'};status=503}else data={welcome:{stats:{total_members:42,total_threads:3,total_posts:7,posts_today:0,threads_today:0,new_members_today:0},online_count:presence,newest_member:null,recent_threads:[{id:'recent1',title:'A recent community conversation',slug:'recent-conversation',user,inserted_at:'2026-10-17T00:00:00Z',last_post_at:null,reply_count:1}],new_members_this_week:[]}};}
  else if(path==='/forums')data={categories:[{id:'c1',name:'Community',description:'A place to create',color:'#239675',forums:[forum]}],unread_counts:role==='guest'?{}:{f1:2}};
  else if(path==='/settings/public')data={settings:{welcome_center_enabled:true,chat_bar_enabled:false,shoutbox_enabled:false}};
  else if(path==='/themes')data={themes:[]};
  else if(path==='/preferences')data={preferences:{}};
  else if(path==='/users/online')data={users:[],stats:{members:0,guests:0,total:0,record_count:0},groups:[]};
  else if(path==='/notifications')data={notifications:[],unread_count:0};
  else if(path==='/voice/rooms')data={rooms:[]};
  else if(path==='/threads/build-together')data={thread,posts:[post('Welcome to the workshop')]};
  else if(path==='/threads/build-together/reply')data={post:post(req.postDataJSON().post.body,'p2')};
  else if(path==='/feed')data={items:[]};
  else if(path==='/forums/creator-workshop/threads')data={forum,threads:[thread],total_pages:1};
  await route.fulfill({status,json:data,headers:{'access-control-allow-origin':BASE,'access-control-allow-credentials':'true'}});
 });
 await context.routeWebSocket('**/socket/**',ws=>{
  sockets.push(ws);ws.onMessage(raw=>{const [join,ref,topic,event,payload]=JSON.parse(String(raw));if(event==='phx_join')joins.push({join,ref,topic,ws});if(event==='phx_join'||event==='heartbeat')ws.send(JSON.stringify([join,ref,topic,'phx_reply',{status:'ok',response:{}}]));});
 });
 const page=await context.newPage();const errors=[];page.on('pageerror',e=>{errors.push(e.message);console.log('PAGE ERROR',e.message)});page.on('requestfailed',r=>console.log('FAILED',r.url(),r.failure()));
 await page.goto(BASE+'/home');await expect(page.locator('.nexus-hero')).toBeVisible();
 return {context,page,calls,errors,release,sockets,joins};
}
(async()=>{const browser=await chromium.launch();try{
 for(const role of ['guest','member','staff'])for(const width of [1440,1024,390])for(const light of [false,true]){
  const x=await setup(browser,{role,width,light});const {page}=x;
  await expect(page.locator('.hero-presence')).toContainText('12 online');
  await expect(page.locator('.nexus-hero h1')).toContainText(role==='guest'?'Find your people.':'Your people.');
  await expect(page.locator('.hero-primary')).toHaveAttribute('href',role==='guest'?'/auth/register':'/forums');
  await expect(page.locator('.welcome-center')).toContainText(role==='guest'?'Community snapshot':'Welcome back,');
  if(role==='guest'){await expect(page.locator('.welcome-center .cta-content')).toHaveCount(0);await expect(page.locator('.mini-stat').first()).toContainText('42');await expect(page.locator('.recent-threads')).toContainText('Builder');}
  if(role!=='guest')await expect(page.locator('.welcome-center')).toContainText('Set your avatar');
  const nav=page.locator(width<=1280?'.mobile-menu':'.main-nav');
  if(width<=1280)await page.getByRole('button',{name:'Toggle menu',exact:true}).click();
  for(const href of ['/', '/chat','/messages','/live','/discover','/marketplace','/trending','/members','/search',...(role==='guest'?[]:['/creator','/following']),...(role==='staff'?['/mod','/admin']:[])])await expect(nav.locator(`a[href="${href}"]`)).toBeVisible();
  if(width<=1280){await page.keyboard.press('Escape');await expect(page.getByRole('button',{name:'Toggle menu',exact:true})).toHaveAttribute('aria-expanded','false');}
  await expect(page.locator('.hero-primary')).toHaveCSS('background-color',light?'rgb(0, 122, 100)':'rgb(98, 226, 191)');
  const contrast=await page.locator('.hero-primary').evaluate(el=>{const c=getComputedStyle(el);const lum=s=>{const x=s.match(/[0-9.]+/g).slice(0,3).map(Number).map(v=>{v/=255;return v<=.04045?v/12.92:((v+.055)/1.055)**2.4});return x[0]*.2126+x[1]*.7152+x[2]*.0722};const a=lum(c.color),b=lum(c.backgroundColor);return(Math.max(a,b)+.05)/(Math.min(a,b)+.05)});expect(contrast).toBeGreaterThanOrEqual(4.5);
  const overflow=await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth);expect(overflow).toBe(false);
  const colors=await page.locator('.category-block').evaluate(el=>({background:getComputedStyle(el).backgroundColor,text:getComputedStyle(el.querySelector('.forum-name')).color}));
  expect(colors.background).toBe(light?'rgb(255, 255, 255)':'rgb(17, 26, 32)');
  if(role==='guest')await page.screenshot({path:`${out}/refresh-${width}-${light?'light':'dark'}.png`,fullPage:true});
  expect(x.errors).toEqual([]);results.push({role,width,light,status:'passed',colors});await x.context.close();console.log('PASS',role,width,light?'light':'dark');
 }
 for(const presence of [0,1,'error',null,-1]){
  const x=await setup(browser,{presence});const text=presence===0?'Be the first':presence===1?'One member':'Activity unavailable';await expect(x.page.locator('.hero-presence')).toContainText(text);expect(x.errors).toEqual([]);results.push({presence,status:'passed'});await x.context.close();
 }
 const loading=await setup(browser,{hold:true});await expect(loading.page.locator('.hero-presence')).toContainText('Checking activity');await expect(loading.page.locator('.hero-presence')).not.toContainText('0 online');loading.release();await expect(loading.page.locator('.hero-presence')).toContainText('12 online');await loading.context.close();results.push({loading:'passed'});
 const theme=await setup(browser);await expect(theme.page.locator('.hero-presence')).toContainText('12 online');await theme.page.getByRole('button',{name:'Toggle theme',exact:true}).click();await expect(theme.page.locator('body')).toHaveClass(/light-mode/);await expect(theme.page.locator('.hero-primary')).toHaveCSS('color','rgb(255, 255, 255)');await theme.page.reload();await expect(theme.page.locator('body')).toHaveClass(/light-mode/);await theme.context.close();results.push({themeTogglePersistence:'passed'});
 const x=await setup(browser,{role:'member'});await expect(x.page.locator('.forum-table')).toContainText('Creator Workshop');
 await expect.poll(()=>x.joins.some(j=>j.topic==='forums:index')).toBe(true);
 const indexJoin=x.joins.find(j=>j.topic==='forums:index');indexJoin.ws.send(JSON.stringify([indexJoin.join,null,'forums:index','forum_updated',{forum_id:'f1',delta:{thread_count:1,post_count:2},last_post_at:'2026-10-17T00:00:00Z',last_post_user_id:'u1'}]));
 await expect(x.page.locator('.stat-cell .count').first()).toHaveText('4');await expect(x.page.locator('.stat-cell .count').nth(1)).toHaveText('9');
 await x.page.getByRole('button',{name:/Mark All Read/i}).click();await expect(x.page.locator('.unread-badge')).toHaveCount(0);expect(x.calls.some(c=>c.path==='/forums/read-all'&&c.method==='PUT')).toBe(true);
 await x.page.getByRole('button',{name:/Feed/}).click();await expect(x.page.locator('.social-feed')).toBeVisible();await x.page.getByRole('button',{name:/Forums/}).click();await expect(x.page.locator('.forum-table')).toBeVisible();
 await x.page.locator('.forum-name').click();await expect(x.page).toHaveURL(/\/forums\/creator-workshop/);await expect(x.page.locator('h1')).toContainText('Creator Workshop');await x.page.getByRole('link',{name:'Build something together',exact:true}).click();await expect(x.page.locator('.post-body').first()).toContainText('Welcome to the workshop');await x.page.locator('.reply-textarea').fill('A new collaboration idea');await x.page.getByRole('button',{name:'Post Reply',exact:true}).click();await expect(x.page.locator('.post-body').last()).toContainText('A new collaboration idea');expect(x.errors).toEqual([]);await x.context.close();results.push({forumNavigationReplyLiveUpdateAndReadState:'passed'});
 fs.writeFileSync(`${out}/verification.json`,JSON.stringify(results,null,2));console.log('ALL PASSED',results.length);
}finally{await browser.close()}})().catch(e=>{fs.writeFileSync(`${out}/verification.json`,JSON.stringify({results,error:e.stack},null,2));console.error(e);process.exitCode=1;});
