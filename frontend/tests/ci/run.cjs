// Shared local/CI entry point. Services are loopback-only and owned by this process.
const {spawn,spawnSync}=require('node:child_process');
const fs=require('node:fs'),path=require('node:path'),net=require('node:net'),crypto=require('node:crypto');
const frontend=path.resolve(__dirname,'../..'),backend=path.resolve(frontend,'../backend');
const mode=process.argv[2];
if(!['browser','livekit'].includes(mode))throw Error('Use browser or livekit');
const privateDir=path.join(frontend,'test-results/ci-private',mode);
const reportDir=path.join(frontend,'test-results/ci-report',mode);
fs.mkdirSync(privateDir,{recursive:true});
const reportBase=path.resolve(frontend,'test-results/ci-report');
if(!reportDir.startsWith(reportBase+path.sep))throw Error('Report cleanup escaped its generated directory');
fs.rmSync(reportDir,{recursive:true,force:true});fs.mkdirSync(reportDir,{recursive:true});
const children=new Set(),results=[];let stopping=false;
const startedAt=Date.now();
const env={...process.env,FN_UI_BASE_URL:'http://localhost:5173',FN_LOCAL_UI_URL:'http://localhost:5173',FN_LOCAL_API_URL:'http://localhost:4001/api',VITE_API_BASE:'http://localhost:4001/api'};
// Never inherit production integrations, credentials, or prior local fixture overrides.
for(const key of ['DATABASE_URL','SENTRY_DSN','LIVEKIT_URL','LIVEKIT_API_KEY','LIVEKIT_API_SECRET','FN_VOICE_OUTAGE_TRIGGER','FN_TEST_FIXTURE_DIR'])delete env[key];
function start(name,command,args,cwd=frontend){
 if(process.platform==='win32'&&command==='mix'){
  const quoted=args.map(value=>"'"+value.replaceAll("'","''")+"'").join(' ');
  command='powershell.exe';args=['-NoLogo','-NoProfile','-NonInteractive','-Command','& mix.bat '+quoted+'; exit $LASTEXITCODE'];
 }
 const fd=fs.openSync(path.join(privateDir,name+'.log'),'w');
 const child=spawn(command,args,{cwd,env,shell:false,detached:process.platform!=='win32',stdio:['ignore',fd,fd]});fs.closeSync(fd);
 children.add(child);child.on('error',error=>{child.startError=error;});
 return child;
}
function waitExit(child,name,timeout=600000){return new Promise((resolve,reject)=>{
 const timer=setTimeout(()=>{stop(child);reject(Error(name+' timed out'));},timeout);
 child.once('error',error=>{clearTimeout(timer);reject(error);});
 child.once('close',code=>{clearTimeout(timer);children.delete(child);code===0?resolve():reject(Error(name+' exited '+code+'; see private service/test logs'));});
});}
function stop(child){
 if(child.exitCode!==null||!child.pid)return;
 if(process.platform==='win32')spawnSync('taskkill.exe',['/PID',String(child.pid),'/T','/F'],{stdio:'ignore'});
 else{try{process.kill(-child.pid,'SIGTERM');}catch{}}
}
async function cleanup(){
 if(stopping)return;stopping=true;
 const owned=[...children];for(const child of owned)stop(child);
 await new Promise(resolve=>setTimeout(resolve,700));
 if(process.platform!=='win32')for(const child of owned)if(child.exitCode===null){try{process.kill(-child.pid,'SIGKILL');}catch{}}
 if(env.FN_TEST_FIXTURE_DIR)for(const name of ['member.json','participant.json','room.json'])fs.rmSync(path.join(env.FN_TEST_FIXTURE_DIR,name),{force:true});
}
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{void cleanup().then(()=>process.exit(130));});
async function freePort(port){await new Promise((resolve,reject)=>{const server=net.createServer();server.once('error',()=>reject(Error('Port '+port+' is already in use; no existing service will be reused')));server.listen(port,'127.0.0.1',()=>server.close(resolve));});}
async function ready(url,child){
 const deadline=Date.now()+120000;
 while(Date.now()<deadline){
  if(child.startError||child.exitCode!==null)throw child.startError||Error('Service exited before readiness: '+url);
  try{const response=await fetch(url,{signal:AbortSignal.timeout(3000)});if(response.ok)return;}catch{}
  await new Promise(resolve=>setTimeout(resolve,500));
 }
 throw Error('Service readiness timed out: '+url);
}
async function command(name,program,args,cwd){await waitExit(start(name,program,args,cwd),name);}
async function suite(name,args){
 const result={name,status:'running'};results.push(result);const at=Date.now();console.log('Running '+name);
 try{await command(name,process.execPath,args);result.status='passed';}catch(error){result.status='failed';throw error;}finally{result.elapsedSeconds=Math.round((Date.now()-at)/1000);}
}
function copyRecent(source,target){
 const stat=fs.statSync(source);
 if(stat.isDirectory()){for(const name of fs.readdirSync(source))copyRecent(path.join(source,name),path.join(target,name));}
 else if(stat.mtimeMs>=startedAt){fs.mkdirSync(path.dirname(target),{recursive:true});fs.copyFileSync(source,target);}
}
function tone(target){
 const samples=48000*4,data=Buffer.alloc(44+samples*2);data.write('RIFF');data.writeUInt32LE(data.length-8,4);data.write('WAVEfmt ',8);data.writeUInt32LE(16,16);data.writeUInt16LE(1,20);data.writeUInt16LE(1,22);data.writeUInt32LE(48000,24);data.writeUInt32LE(96000,28);data.writeUInt16LE(2,32);data.writeUInt16LE(16,34);data.write('data',36);data.writeUInt32LE(samples*2,40);
 for(let i=0;i<samples;i++)data.writeInt16LE(Math.round(10000*Math.sin(2*Math.PI*440*i/48000)),44+i*2);fs.writeFileSync(target,data);
}
(async()=>{
 let passed=false;
 try{
  await freePort(5173);
  if(mode==='livekit'){
   for(const port of [4001,7880,7881,7882])await freePort(port);
   const host=env.PGHOST||'localhost';if(!['localhost','127.0.0.1'].includes(host))throw Error('Only loopback PostgreSQL is allowed');
   if(env.PGPORT&&env.PGPORT!=='5432')throw Error('The development backend currently uses PostgreSQL port 5432');
   const database=env.FN_CI_DATABASE||'forge_nexus_ci_'+Date.now().toString(36);
   if(!/^forge_nexus_ci(?:_[a-z0-9]+)?$/.test(database))throw Error('Use a forge_nexus_ci database name, never a development/production database');
   Object.assign(env,{MIX_ENV:'dev',PGHOST:host,PGDATABASE:database,FN_CI_DATABASE:database,PORT:'4001',FN_RATE_LIMIT_BYPASS_TOKEN:crypto.randomBytes(24).toString('hex'),FN_TEST_FIXTURE_DIR:path.join(privateDir,'fixtures'),FN_VOICE_TONE_PATH:path.join(privateDir,'tone.wav')});
   delete env.PHX_SERVER;
   const livekit=env.LIVEKIT_SERVER_PATH;if(!livekit||!fs.existsSync(livekit))throw Error('Set LIVEKIT_SERVER_PATH to the pinned local LiveKit server binary');
   await command('database-create','mix',['ecto.create'],backend);
   await command('database-migrate','mix',['ecto.migrate'],backend);
   await command('fixtures','mix',['run',path.join(__dirname,'seed.exs')],backend);
   const server=start('livekit',livekit,['--dev','--bind','127.0.0.1','--node-ip','127.0.0.1']);await ready('http://127.0.0.1:7880',server);
   env.PHX_SERVER='true';const api=start('backend','mix',['phx.server'],backend);await ready('http://localhost:4001/api/voice/rooms',api);
   tone(env.FN_VOICE_TONE_PATH);
  }else await freePort(5174);
  const ui=start('frontend',process.execPath,['node_modules/vite/bin/vite.js','dev','--host','localhost','--port','5173','--strictPort']);await ready('http://localhost:5173/auth/login',ui);
  if(mode==='browser'){
   const fixture=start('fixture',process.execPath,['node_modules/vite/bin/vite.js','--config','tests/fixtures/accessibility/vite.config.mjs','--host','localhost','--port','5174','--strictPort']);await ready('http://localhost:5174',fixture);
   await suite('forum',['node_modules/@playwright/test/cli.js','test','--project=forum-features','--retries=0']);
   await suite('refresh',['tests/ui-refresh.cjs']);
   await suite('accessibility',['tests/ui-accessibility.cjs']);
   await suite('accessibility-routes',['tests/ui-accessibility-routes.cjs']);
  }else{
   // These use the same accounts and room: run sequentially, never in parallel.
   await suite('voice',['tests/ui-local-voice.cjs']);
   await suite('video',['tests/ui-local-video.cjs']);
   await suite('prejoin',['tests/ui-local-prejoin.cjs']);
  }
  passed=true;console.log('All '+mode+' suites passed');
 }catch(error){console.error(error.message);process.exitCode=1;}
 finally{
  await cleanup();
  // Only allowlisted non-credential reports are publishable; raw service logs stay private.
  fs.writeFileSync(path.join(reportDir,'summary.json'),JSON.stringify({mode,passed,results},null,2));
  const allowed=mode==='browser'?['playwright','ui-refresh','accessibility','accessibility-routes']:['voice-live/results.json','video-live/results.json','video-live/prejoin-entry-results.json','video-live/prejoin.png','video-live/prejoin-mobile.png','video-live/expanded-share.png'];
  for(const relative of allowed){const source=path.join(frontend,'test-results',relative);if(fs.existsSync(source))copyRecent(source,path.join(reportDir,relative));}
 }
})();
