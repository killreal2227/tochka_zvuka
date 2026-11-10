import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = p => fs.readFileSync(new URL('../site/'+p,import.meta.url),'utf8');
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function playerScene(ready = Promise.resolve()) {
  const window = {}, timers = new Map(), eligible = new Set();
  let sequence=0, reduced=false;
  vm.runInNewContext(source('direction-player.js'),{window,Promise});
  const make = id => ({id,offsetWidth:10,classList:{playing:false,add(){this.playing=true;},remove(){this.playing=false;}}});
  const cards=[make('a'),make('b'),make('c')];
  const player=window.createDirectionPlayer({ready,prepare:()=>2.9,eligible:c=>eligible.has(c),reduced:()=>reduced,
    clock:{setTimeout(fn){const id=++sequence;timers.set(id,fn);return id;},clearTimeout(id){timers.delete(id);}}});
  const finish=()=>{const batch=[...timers.values()];timers.clear();batch.forEach(fn=>fn());};
  return {cards,eligible,player,timers,finish,setReduced(v){reduced=v;}};
}
test('direction player runs one animation and keeps only latest eligible hover',async()=>{
  const s=playerScene();await settle();const [a,b,c]=s.cards;
  s.eligible.add(a);s.player.request(a);
  s.eligible.add(b);s.player.request(b);s.eligible.delete(b);s.player.leave(b);
  s.eligible.add(c);s.player.request(c);
  assert.equal(s.cards.filter(c=>c.classList.playing).length,1);
  s.finish();assert.equal(a.classList.playing,false);assert.equal(c.classList.playing,true);
  assert.equal(b.classList.playing,false);assert.equal(s.timers.size,1);
});
test('repeat active hover does not restart; leaving last candidate prevents playback',async()=>{
  const s=playerScene();await settle();const [a,b]=s.cards;
  s.eligible.add(a);s.player.request(a);const timer=[...s.timers.keys()][0];
  s.player.request(a);assert.equal([...s.timers.keys()][0],timer);
  s.eligible.add(b);s.player.request(b);s.eligible.delete(b);s.player.leave(b);
  s.finish();assert.equal(s.cards.some(c=>c.classList.playing),false);
});
test('requests while assets load collapse to last choice; reduced-motion stops all',async()=>{
  let load;const s=playerScene(new Promise(r=>{load=r;}));const [a,b]=s.cards;
  s.eligible.add(a);s.player.request(a);s.eligible.add(b);s.player.request(b);
  assert.equal(s.timers.size,0);load();await settle();assert.equal(b.classList.playing,true);
  s.setReduced(true);s.player.stop();assert.equal(s.cards.some(c=>c.classList.playing),false);
  s.player.request(a);assert.equal(s.timers.size,0);
});
function events(object={}) {
  object.listeners=new Map();object.addEventListener=(k,fn)=>{const a=object.listeners.get(k)||[];a.push(fn);object.listeners.set(k,a);};
  object.emit=(k,e={})=>Promise.all((object.listeners.get(k)||[]).map(fn=>fn(e)));
  return object;
}
function nudgeScene(store=new Map(),blocked=false) {
  const close=events(), trigger={focused:false,focus(){this.focused=true;}};
  const modal={hidden:true};
  const box={hidden:true,querySelector:()=>close,contains:el=>el===close};
  const document=events({hidden:false,activeElement:null,getElementById:id=>id==='lessonNudge'?box:modal,querySelector:()=>trigger});
  const timers=[],frames=[];
  const window=events({scrollY:0,innerHeight:800,setTimeout:fn=>timers.push(fn)});
  Object.defineProperty(window,'sessionStorage',{get(){if(blocked)throw Error('blocked');return{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};}});
  vm.runInNewContext(source('city-ui.js'),{document,window,requestAnimationFrame:fn=>{frames.push(fn);return 1;}});
  return {box,modal,document,window,close,trigger,timers,async scroll(){await window.emit('scroll');frames.splice(0).forEach(fn=>fn());},delay(){timers.splice(0).forEach(fn=>fn());}};
}
test('invitation waits for time and scroll, shows once across pages in a session',async()=>{
  const store=new Map(),s=nudgeScene(store);s.delay();assert.equal(s.box.hidden,true);
  s.window.scrollY=500;await s.scroll();assert.equal(s.box.hidden,false);
  await s.close.emit('click');assert.equal(s.box.hidden,true);await s.scroll();assert.equal(s.box.hidden,true);
  const next=nudgeScene(store);next.window.scrollY=500;next.delay();await next.scroll();assert.equal(next.box.hidden,true);
});
test('invitation never overlays open form; Escape and outside pointer dismiss',async()=>{
  const s=nudgeScene();s.window.scrollY=500;s.modal.hidden=false;s.delay();assert.equal(s.box.hidden,true);
  await s.document.emit('tz:lead-open');s.modal.hidden=true;await s.scroll();assert.equal(s.box.hidden,true);
  const other=nudgeScene();other.window.scrollY=500;other.delay();other.document.activeElement=other.close;
  await other.document.emit('keydown',{key:'Escape',preventDefault(){}});assert.equal(other.box.hidden,true);assert.equal(other.trigger.focused,true);
  const outside=nudgeScene();outside.window.scrollY=500;outside.delay();await outside.document.emit('pointerdown',{target:{}});assert.equal(outside.box.hidden,true);
});
test('invitation stays disabled if session storage is unavailable',()=>{
  const s=nudgeScene(new Map(),true);s.window.scrollY=500;s.delay();assert.equal(s.box.hidden,true);assert.equal(s.timers.length,0);
});

function formScene(endpoint=null,reply='success') {
  const element=()=>events({hidden:false,disabled:false,offsetParent:{},tabIndex:0,style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){document.activeElement=this;}});
  const input=()=>Object.assign(element(),{value:'',setCustomValidity(v){this.validity=v;},reportValidity(){return !this.validity;}});
  const name=input(),phone=input(),website=input(),direction=input(),branch=input();
  Object.defineProperty(branch,'selectedOptions',{get:()=>[{value:branch.value,textContent:branch.value||'choose'}]});
  const submit=element(),status=element(),sheet=element(),success=element(),close=element(),dismiss=element(),trigger=element();
  success.hidden=true;
  const chips=element(),caption=element(),branchCaption=element(),branchLabel=element();
  let calls=0,uuids=0,payload;
  const form=Object.assign(element(),{elements:{name,phone,website,direction,branch},reportValidity:()=>name.value.trim().length>=2&&!!branch.value,
    reset(){for(const e of Object.values(this.elements))e.value='';},querySelector:s=>s==='.lead-submit'?submit:s==='.lead-branch-label'?branchLabel:null});
  const svg={setAttribute(){},querySelectorAll:()=>[],getScreenCTM:()=>({a:1})};
  const art={querySelector:()=>svg,closest:()=>sheet};
  const map={'.lead-sheet':sheet,'.lead-success':success,'.lead-close':close,'[data-lead-dismiss]':dismiss,'.sheet-art':art,'#chips':chips,'#pickCap':caption,'#leadBranchCaption':branchCaption};
  const modal=Object.assign(element(),{hidden:true,querySelector:s=>map[s],querySelectorAll:s=>s==='a,button,input,select'?[close,name,phone,submit]:[]});
  const link=href=>({getAttribute:()=>href});
  const document=events({body:{dataset:{},style:{}},activeElement:trigger,
    getElementById:id=>({leadModal:modal,leadForm:form,leadStatus:status})[id],
    querySelector:s=>s==='.lead-consent a'?link('./consent/'):null,
    querySelectorAll:s=>s==='.openForm'?[trigger]:s==='.lead-consent a'?[link('./consent/'),link('./privacy/')]:[]});
  document.dispatchEvent=e=>{document.emit(e.type);};
  const window=events({TZ_LEADS:{endpoint}});
  vm.runInNewContext(source('lead-form.js'),{window,document,matchMedia:()=>({matches:true,addEventListener(){}}),
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:()=>1,clearTimeout(){},URL,AbortController,
    location:{href:'https://killreal2227.github.io/tochka_zvuka/',pathname:'/tochka_zvuka/'},
    crypto:{randomUUID(){uuids++;return'00000000-0000-4000-8000-000000000001';}},
    CustomEvent:class{constructor(type){this.type=type;}},
    fetch:async(_,options)=>{calls++;payload=JSON.parse(options.body);return{ok:reply==='success',status:reply==='success'?200:502,
      json:async()=>reply==='success'?{ok:true,requestId:payload.requestId,leadId:'1'}:{ok:false}};}});
  const fill=()=>{name.value='Иван';phone.value='+79950000000';branch.value='kaluga';};
  return {trigger,form,success,modal,phone,status,fill,get calls(){return calls;},get uuids(){return uuids;},get payload(){return payload;}};
}
test('unconfigured form gives requested feedback without request, storage or lead ID',async()=>{
  const s=formScene();await s.trigger.emit('click');s.fill();await s.form.emit('submit',{preventDefault(){}});
  assert.equal(s.calls,0);assert.equal(s.uuids,0);assert.equal(s.success.hidden,false);assert.equal(s.form.hidden,true);
  assert.equal(s.phone.value,'');await s.trigger.emit('click');assert.equal(s.form.hidden,false);assert.equal(s.success.hidden,true);
});
test('configured form uses transport acknowledgement and includes button-consent metadata',async()=>{
  const s=formScene('https://example.invalid/leads');await s.trigger.emit('click');s.fill();await s.form.emit('submit',{preventDefault(){}});
  assert.equal(s.calls,1);assert.equal(s.success.hidden,false);assert.equal(s.payload.consent.accepted,true);assert.equal(s.payload.consent.version,'2026-11-10-v3');
  const bad=formScene('https://example.invalid/leads','failure');bad.fill();await bad.form.emit('submit',{preventDefault(){}});
  assert.equal(bad.success.hidden,true);assert.ok(bad.status.textContent);
});
test('invalid phone is rejected before any external request',async()=>{
  const s=formScene('https://example.invalid/leads');s.fill();s.phone.value='123';await s.form.emit('submit',{preventDefault(){}});
  assert.equal(s.calls,0);assert.ok(s.phone.validity);
});
