const {chromium}=require('@playwright/test');
const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{
 const checks=[];const check=(name,ok)=>{assert.ok(ok,name);checks.push(name);};
 const base=process.env.FN_LOCAL_API_URL;
 async function search(params){const response=await fetch(base+'/search?'+new URLSearchParams(params));assert.equal(response.status,200);return response.json();}
 const first=await search({q:'SearchReliability',type:'posts'});
 check('real database fallback is active',first.fallback===true);
 check('hidden post excluded and exact total',first.total===27);
 check('first page has 25 posts',first.results.length===25);
 const second=await search({q:'SearchReliability',type:'posts',page:2});
 check('second page has remaining two posts',second.results.length===2&&second.total_pages===2);
 check('pages have no duplicates',new Set([...first.results,...second.results].map(p=>p.id)).size===27);
 check('post metadata and destination',first.results.every(p=>p.excerpt.includes('SearchReliability')&&p.url.includes('#post-')&&p.user.username==='fncheck_ci'));
 check('author filter is case insensitive',(await search({q:'SearchReliability',type:'posts',author:'FNCHECK_CI'})).total===27);
 check('unknown author returns no matches',(await search({q:'SearchReliability',type:'posts',author:'missing'})).total===0);
 check('thread search does not search post body',(await search({q:'SearchReliability',type:'threads'})).total===0);
 // A reachable but nonresponsive Meilisearch endpoint must also fail over promptly.
 const sockets=new Set();
 const stalled=require('node:http').createServer(()=>{});
 stalled.on('connection',socket=>{sockets.add(socket);socket.on('close',()=>sockets.delete(socket));});
 await new Promise((resolve,reject)=>{stalled.once('error',reject);stalled.listen(17700,'127.0.0.1',resolve);});
 try{
 const at=Date.now(),slow=await search({q:'SearchReliability',type:'posts'});
 check('nonresponsive search service falls back to real database',slow.fallback===true&&slow.total===27);
 check('nonresponsive service does not cause a long retry delay',Date.now()-at<5000);
 }finally{for(const socket of sockets)socket.destroy();await new Promise(resolve=>stalled.close(resolve));}
 const browser=await chromium.launch({headless:true});
 try{
 const page=await browser.newPage();
 await page.goto(process.env.FN_UI_BASE_URL+'/search?q=SearchReliability&type=posts');
 await page.getByRole('status').filter({hasText:'basic search'}).waitFor();
 await page.locator('.result-item').first().waitFor();
 check('browser renders post excerpts',await page.locator('.result-excerpt').count()===25);
 check('browser omits thread-only counters',!(await page.locator('.results-list').innerText()).includes('undefined'));
 await page.getByRole('button',{name:'Next',exact:false}).click();
 await page.waitForURL(/page=2/);await page.waitForFunction(()=>document.querySelectorAll('.result-item').length===2);
 check('browser pagination follows URL',await page.locator('.result-item').count()===2);
 await page.reload();await page.waitForFunction(()=>document.querySelectorAll('.result-item').length===2);
 check('pagination survives refresh',true);
 await page.getByLabel('Type:',{exact:true}).selectOption('threads');
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.locator('.no-results').waitFor();check('same query with changed type refreshes results',true);
 await page.getByLabel('Type:',{exact:true}).selectOption('posts');
 await page.getByRole('button',{name:'Search',exact:true}).click();await page.locator('.result-title').first().waitFor();
 // Controlled browser failures test recovery; successful responses still come from the real backend.
 await page.route('**/api/search?**',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Temporary search failure'})}),{times:1});
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.getByRole('alert').waitFor();check('failed requests display an accessible error',true);
 await page.getByRole('button',{name:'Search',exact:true}).click();
 await page.locator('.result-title').first().waitFor();check('retry clears the error and restores real results',await page.getByRole('alert').count()===0);
 let release,held;
 const started=new Promise(resolve=>{held=resolve;});
 const gate=new Promise(resolve=>{release=resolve;});
 await page.route('**/api/search?**',async route=>{const response=await route.fetch();held();await gate;await route.fulfill({response});},{times:1});
 await page.goto(process.env.FN_UI_BASE_URL+'/search?q=SearchReliability&type=posts&author=fncheck_ci');
 await started;
 await page.evaluate(()=>{const link=document.createElement('a');link.href='/search?q=zzNoMatchingSearchzz&type=posts';document.body.append(link);link.click();link.remove();});
 await page.locator('.no-results').waitFor();release();
 await page.waitForLoadState('networkidle');
 check('late response cannot replace a newer search',await page.locator('.result-item').count()===0);
 await page.goto(process.env.FN_UI_BASE_URL+'/search?q=SearchReliability&type=posts');
 await page.locator('.result-title').first().waitFor();
 const href=await page.locator('.result-title').first().getAttribute('href');
 await page.locator('.result-title').first().click();
 await page.locator(href.slice(href.indexOf('#'))).waitFor();check('post link opens the correct thread page and matching post',true);
 }finally{await browser.close();}
 fs.mkdirSync('test-results/search-live',{recursive:true});fs.writeFileSync('test-results/search-live/results.json',JSON.stringify({passed:checks.length,checks},null,2));
 console.log(checks.length+' real backend search checks passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
