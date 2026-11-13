import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { CliAdapter } from '../adapters/cli.mjs';
import { apply } from '../dsh-to-antigravity/index.mjs';

test('DSH tools bind real executor session, never a model-supplied source ID', async () => {
 const tools = new Map(), requests = [];
 await apply({tools:{register: tool => tools.set(tool.name, tool)}}, {connect:async()=>{},request:async(...args)=>{requests.push(args);return {id:'task'};},settings:()=>({allowedWorkspaces:['/configured/workspace']})});
 const tool = tools.get('antigravity_submit_task');
 assert(!('conversation_id' in tool.parameters.properties));
 await assert.rejects(tool.execute({task:'hello'},{}),/real calling/);
 await tool.execute({task:'hello',conversation_id:'forged-source'}, {agent:{session:{id:'actual-session'}}});
 assert.equal(requests[0][2].conversation_id,'actual-session');
 assert.equal(requests[0][2].workspace,'/configured/workspace');
 assert.equal(requests[0][0],'dsh');
});

test('CLI parses split UTF-8 events and trusts only terminal protocol result', async t => {
 const root = fs.mkdtempSync(path.join(os.tmpdir(),'ag-cli-test-')); t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const exe = path.join(root,'fake-cli');
 fs.writeFileSync(exe,`#!${process.execPath}\nconst b=Buffer.from(JSON.stringify({event:'result',result:{status:'SUCCESS',response:'你好',conversation_id:'actual-cli-session',usage:{input_tokens:2}}})+'\\n');process.stdout.write(b.subarray(0,b.length-8));setTimeout(()=>process.stdout.end(b.subarray(b.length-8)),10);`,{mode:0o700});
 const adapter = new CliAdapter({executable:exe});const events=[];
 const value = await new Promise((resolve,reject)=>adapter.run({id:'cli-task',task:'hello',model:'gemini-4-hydrogen-high',effort:'high',workspace:root,timeout_seconds:10},(type,event)=>events.push(event),(error,result)=>error?reject(error):resolve(result)));
 assert.equal(value.summary,'你好');assert.equal(value.session_id,'actual-cli-session');assert.equal(events.length,1);
 fs.writeFileSync(exe,`#!${process.execPath}\nconsole.log('I claim success without a result event');`,{mode:0o700});
 await assert.rejects(new Promise((resolve,reject)=>adapter.run({id:'cli-fake',task:'hello',model:'x',workspace:root,timeout_seconds:10},()=>{},error=>error?reject(error):resolve())),/without final result/);
});

test('CLI cancellation terminates its owned process', async t => {
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ag-cli-cancel-'));t.after(()=>fs.rmSync(root,{recursive:true,force:true}));
 const exe=path.join(root,'fake-cli');fs.writeFileSync(exe,`#!${process.execPath}\nconsole.log(JSON.stringify({event:'init'}));setInterval(()=>{},1000);`,{mode:0o700});
 const adapter=new CliAdapter({executable:exe});
 await new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>{adapter.cancel('cancel-owned');reject(new Error('Cancellation did not finish'));},5000);
  adapter.run({id:'cancel-owned',task:'hello',model:'x',workspace:root,timeout_seconds:10},()=>adapter.cancel('cancel-owned'),error=>{clearTimeout(timer);try{assert(error);assert.equal(adapter.children.size,0);resolve();}catch(e){reject(e);}});
 });
});
