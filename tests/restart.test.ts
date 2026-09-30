import {test,after} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync} from 'node:fs';import {tmpdir} from 'node:os';import path from 'node:path';import {DatabaseSync} from 'node:sqlite';import {execFileSync,spawn,ChildProcess} from 'node:child_process';import {createServer} from 'node:net';
const temp=mkdtempSync(path.join(tmpdir(),'bd-restart-'));process.env.DATABASE_URL='file:'+path.join(temp,'test.db').replaceAll('\\','/');process.env.APP_MODE='demo';process.env.STORAGE_DIR=path.join(temp,'storage');new DatabaseSync(path.join(temp,'test.db')).close();execFileSync(process.execPath,['node_modules/prisma/build/index.js','db','push','--skip-generate'],{env:process.env,stdio:'pipe'});
const {db}=await import('../server/db');const {seed}=await import('../server/seed');await seed();let child:ChildProcess|undefined;
async function stop(){if(child&&child.exitCode===null){const p=child;await new Promise<void>(resolve=>{p.once('exit',()=>resolve());p.kill();});}child=undefined;}
after(async()=>{await stop();await db.$disconnect();});
test('真实服务进程重启：业务持久化、会话保留与中断AI任务恢复', {timeout:90000},async()=>{
 const port=await new Promise<number>(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const port=(s.address() as any).port;s.close(()=>resolve(port));});});
 const base='http://127.0.0.1:'+port;
 async function start(){child=spawn(process.execPath,['--import','tsx','server/index.ts'],{env:{...process.env,HOST:'127.0.0.1',PORT:String(port)},stdio:['ignore','pipe','pipe']});await new Promise<void>((resolve,reject)=>{const timer=setTimeout(()=>reject(Error('服务启动超时')),45000);child!.once('exit',()=>{clearTimeout(timer);reject(Error('服务启动退出'));});child!.stdout!.on('data',b=>{if(b.toString().includes('BD Flow')){clearTimeout(timer);resolve();}});});}
 await start();
 const login=await fetch(base+'/api/v1/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'bd',password:'Demo2026!'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie')!.split(';')[0];
 const response=await fetch(base+'/api/v1/records',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify({kind:'lead',title:'重启前保存的业务',data:{company:'重启演练客户'}})});assert.equal(response.status,201);const record=await response.json();
 await stop();
 const task=await db.aiTask.create({data:{recordId:record.id,tool:'radar',input:'中断恢复测试',status:'processing'}});
 await start();
 const detail=await fetch(base+'/api/v1/records/'+record.id,{headers:{Cookie:cookie}});assert.equal(detail.status,200);const restored=await detail.json();assert.equal(restored.title,record.title);assert.equal(restored.tasks.find((t:any)=>t.id===task.id).status,'failed');
 const retry=await fetch(base+'/api/v1/ai/'+task.id+'/retry',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:'{}'});assert.equal(retry.status,200);
});
