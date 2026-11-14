import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../site/lead-client.js',import.meta.url),'utf8');
function scene({enabled=true,status=200,result,network=false,proof='fixture-proof',confirmation=true}={}){
 const listeners=new Map(),calls=[],tasks=[];let options;
 const document={head:{append(script){tasks.push(script);}},createElement(){return {setAttribute(){},remove(){}};},
  getElementById(){return {before(){}};},addEventListener(key,fn){listeners.set(key,fn);},dispatchEvent(){}};
 const api={render(host,config){options=config;return 'widget';},reset(){},destroy(){},subscribe(){return()=>{};},
  execute(){if(proof)options.callback(proof);else options.callback('');}};
 const window={TZ_LEADS:{enabled,endpoint:'https://fixture.apigw.yandexcloud.net/public/lead',siteKey:'fixture-key'},smartCaptcha:api};
 const payload={requestId:crypto.randomUUID(),name:'Fixture'};
 vm.runInNewContext(source,{window,document,CustomEvent:class{},URL,Error,Promise,AbortController,
  setTimeout,clearTimeout,fetch:async(url,init)=>{calls.push({url,init});if(network)throw Error('private internal details');return {ok:status>=200&&status<300,status,json:async()=>result??{ok:true,saved:confirmation,requestId:payload.requestId,leadId:'fixture-id'}};}});
 listeners.get('tz:lead-open')();
 return {client:window.TZLeadClient,payload,calls,window,close:()=>listeners.get('tz:lead-close')(),getOptions:()=>options};
}
test('production switch stays off and no demo success is possible',async()=>{
 const s=scene({enabled:false});await assert.rejects(s.client.submit(s.payload),/пока недоступна/);assert.equal(s.calls.length,0);
 assert.match(source,/enabled:false/);
 const form=fs.readFileSync(new URL('../site/lead-form.js',import.meta.url),'utf8');
 assert.doesNotMatch(form,/demoSubmit|demoDelayMs|demoFailure|leadId:'demo/);
 for(const secret of ['LEAD_API_KEY','TURNSTILE_SECRET','TELEGRAM_BOT_TOKEN'])assert(!source.includes(secret));
});
test('client sends public payload with token, omits credentials and demands persistence acknowledgement',async()=>{
 const s=scene();const r=await s.client.submit(s.payload);
 assert.equal(r.saved,true);assert.equal(s.calls.length,1);
 assert.equal(s.calls[0].url,'https://fixture.apigw.yandexcloud.net/public/lead');
 assert.equal(JSON.parse(s.calls[0].init.body).captchaToken,'fixture-proof');assert.equal(s.calls[0].init.credentials,'omit');
 assert.equal(s.getOptions().invisible,true);assert.equal(s.getOptions().hideShield,false);
});
test('unconfirmed, malformed, server and network errors never produce success and retain requestId',async()=>{
 for(const config of [{confirmation:false},{result:{ok:true,saved:true,requestId:'wrong',leadId:'x'}},{result:{ok:true,saved:true,leadId:'x'}},{result:{ok:true}},{status:403},{status:429},{status:500},{network:true}]){
  const s=scene(config),id=s.payload.requestId;await assert.rejects(s.client.submit(s.payload));assert.equal(s.payload.requestId,id);
 }
});
test('invalid SmartCaptcha stops the request before any network transmission',async()=>{
 const s=scene({proof:null});await assert.rejects(s.client.submit(s.payload),/Проверка не пройдена/);assert.equal(s.calls.length,0);
});
test('sequential retry retains the same requestId and acquires proof again',async()=>{
 const s=scene();await s.client.submit(s.payload);await s.client.submit(s.payload);
 const ids=s.calls.map(c=>JSON.parse(c.init.body).requestId);assert.deepEqual(ids,[s.payload.requestId,s.payload.requestId]);
});

test('deleted request explains terminal state without manufacturing a new application',async()=>{
 const s=scene({status:409,result:{error:'request_deleted'}}),before=s.payload.requestId;
 await assert.rejects(s.client.submit(s.payload),/заявка удалена/);
 assert.equal(s.payload.requestId,before);assert.equal(s.calls.length,1);
});
