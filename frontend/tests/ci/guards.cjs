// Verify fail-closed startup without a database, browser, or LiveKit server.
const {spawn}=require('node:child_process');
const net=require('node:net'),path=require('node:path'),assert=require('node:assert/strict');
const runner=path.join(__dirname,'run.cjs');
function run(mode,extra={}){return new Promise((resolve,reject)=>{
 const child=spawn(process.execPath,[runner,mode],{env:{...process.env,...extra},stdio:['ignore','pipe','pipe']});let output='';
 child.stdout.on('data',chunk=>output+=chunk);child.stderr.on('data',chunk=>output+=chunk);child.on('error',reject);child.on('close',code=>resolve({code,output}));
});}
(async()=>{
 const server=net.createServer(socket=>socket.end());await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(5173,'127.0.0.1',resolve);});
 try{const result=await run('browser');assert.equal(result.code,1);assert.match(result.output,/Port 5173 is already in use/);assert.equal(server.listening,true);console.log('PASS occupied service is rejected and left running');}
 finally{await new Promise(resolve=>server.close(resolve));}
 const result=await run('livekit',{FN_CI_DATABASE:'forge_nexus_dev',PGHOST:'localhost',PGPORT:'5432'});assert.equal(result.code,1);assert.match(result.output,/never a development\/production database/);console.log('PASS development database name is rejected before database access');
})().catch(error=>{console.error(error);process.exitCode=1;});
