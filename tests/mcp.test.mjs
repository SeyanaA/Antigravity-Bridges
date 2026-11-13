import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { randomBytes, randomUUID } from 'node:crypto';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ROOT, childEnvironment } from '../core/settings.mjs';
import { Storage } from '../core/storage.mjs';
import { clientKey } from '../core/service.mjs';
const pause=()=>new Promise(r=>setTimeout(r,30));
const listen=s=>new Promise(r=>s.listen(0,'127.0.0.1',()=>r(s.address().port)));
test('real stdio MCP submit, deferred reporter result and persisted native session survive MCP client restart', async t=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'ag-mcp-test-'));
 const key=randomBytes(32).toString('hex'), session=randomUUID(), source=randomUUID();
 for(const dir of ['core','adapters','codex-to-antigravity'])fs.cpSync(path.join(ROOT,dir),path.join(root,dir),{recursive:true});
 fs.symlinkSync(path.join(ROOT,'node_modules'),path.join(root,'node_modules'),'dir');
 for(const dir of ['config','data','workspace'])fs.mkdirSync(path.join(root,dir));
 fs.writeFileSync(path.join(root,'package.json'),'{"type":"module"}');fs.writeFileSync(path.join(root,'data/bridge.key'),key,{mode:0o600});
 const reserve=http.createServer();const port=await listen(reserve);await new Promise(r=>reserve.close(r));
 const connector=http.createServer(async(req,res)=>{
  if(req.headers.authorization!=='Bearer '+key){res.writeHead(401);return res.end('{}');}
  let raw='';for await(const c of req)raw+=c;
  res.setHeader('content-type','application/json');
  res.end(JSON.stringify(req.url==='/health'?{ok:true}:{ok:true,data:{conversationId:session}}));
 });
 const nativePort=await listen(connector);
 fs.writeFileSync(path.join(root,'data/native-connection.json'),JSON.stringify({url:`http://127.0.0.1:${nativePort}/`}));
 fs.writeFileSync(path.join(root,'config/local.json'),JSON.stringify({port,backend:'native',allowedWorkspaces:[path.join(root,'workspace')],target:{approved:true,model:'gemini-4-hydrogen-high',effort:'high'}}));
 const clients=[];let storage;
 async function connect(entry){const c=new Client({name:'protocol-test',version:'1'});clients.push(c);await c.connect(new StdioClientTransport({command:process.execPath,args:[path.join(root,entry)],env:childEnvironment({AG_BRIDGE_ROOT:root,CODEX_THREAD_ID:source}),stderr:'pipe'}));return c;}
 async function admin(route){return fetch(`http://127.0.0.1:${port}/api`+route,{method:'POST',headers:{authorization:'Bearer '+clientKey('admin',key),'content-type':'application/json'},body:'{}'});}
 t.after(async()=>{for(const c of clients)await c.close();try{await admin('/admin/stop');}catch{}storage?.close();await new Promise(r=>connector.close(r));fs.rmSync(root,{recursive:true,force:true});});
 const caller=await connect('codex-to-antigravity/mcp.mjs');
 const invalid=await caller.callTool({name:'ag_submit_task',arguments:{task:'hello',conversation_id:randomUUID(),workspace:path.join(root,'workspace')}});assert(invalid.isError);
 const submit=await caller.callTool({name:'ag_submit_task',arguments:{task:'hello',conversation_id:source,workspace:path.join(root,'workspace')}});
 assert(!submit.isError, JSON.stringify(submit)+"\n"+(fs.existsSync(path.join(root,"data/service.log"))?fs.readFileSync(path.join(root,"data/service.log"),"utf8"):"no log"));const job=JSON.parse(submit.content[0].text);assert.equal(job.status,'QUEUED');assert(!job.report_token);
 storage=new Storage(path.join(root,'data'));
 let record;for(let i=0;i<100;i++){record=storage.get(job.id);if(record?.session_id)break;await pause();}
 assert.equal(record.session_id,session);
 const reporter=await connect('adapters/reporter-mcp.mjs');
 assert.deepEqual((await reporter.listTools()).tools.map(x=>x.name),['ag_report_result']);
 const report=await reporter.callTool({name:'ag_report_result',arguments:{task_id:job.id,report_token:record.report_token,status:'completed',summary:'你好'}});assert(!report.isError);
 await caller.close();const resumed=await connect('codex-to-antigravity/mcp.mjs');
 const output=await resumed.callTool({name:'ag_get_result',arguments:{task_id:job.id}});const task=JSON.parse(output.content[0].text).task;
 assert.equal(task.result,'你好');assert.equal(task.status,'COMPLETED');assert.equal(task.session_id,session);
});
