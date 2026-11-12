import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const source = p => fs.readFileSync(new URL('../site/'+p,import.meta.url),'utf8');
const settle = async () => { await Promise.resolve(); await Promise.resolve(); };
function captionScene() {
  const callbacks = [], handlers = {}, ink = {x: -2, y: -12, width: 80, height: 16};
  const label = {textContent: 'Book', classList: {add(){}}};
  const arrow = {offsetLeft: 140, getBoundingClientRect: () => ({left: 140})};
  let text, visible = true;
  const button = {clientWidth: 200, offsetWidth: 200, clientHeight: 48, clientLeft: 0,
    getClientRects: () => visible ? [{}] : [], getBoundingClientRect: () => ({left: 0, width: 200}),
    querySelector: selector => selector.includes('i,') ? arrow : label, append(){}};
  arrow.offsetParent = button;
  const document = {readyState: 'complete', body: {}, fonts: {ready: Promise.resolve()},
    querySelectorAll: () => [button], addEventListener(){},
    createElementNS(_, tag) {
      const node = {style: {}, attrs: {}, classList: {add(){}}, append(){},
        setAttribute(k,v){this.attrs[k]=v;}, getBBox: () => ink};
      if (tag === 'text') text = node;
      return node;
    }};
  const window = {addEventListener: (name, fn) => {handlers[name] = fn;}};
  vm.runInNewContext(source('button-labels.js'), {document, window,
    getComputedStyle: () => ({fontFamily:'Arial',fontSize:'16px',fontWeight:'400',fontStyle:'normal',letterSpacing:'0px',textTransform:'none'}),
    MutationObserver: class {constructor(fn){callbacks.push(fn);} observe(){}},
    requestAnimationFrame: fn => fn()});
  return {text, button, arrow, handlers, callbacks, ink, setVisible(v){visible=v;}};
}
test('capsule label centers the ink inside the area before the unchanged arrow', async () => {
  const s = captionScene(); await settle();
  assert.equal(Number(s.text.attrs.x) + s.ink.x + s.ink.width/2, 70);
  assert.equal(Number(s.text.attrs.y) + s.ink.y + s.ink.height/2, 24);
  assert.equal(s.arrow.offsetLeft, 140); assert.equal(s.button.clientWidth, 200);
  s.arrow.offsetLeft = 120; s.handlers.resize();
  assert.equal(Number(s.text.attrs.x) + s.ink.x + s.ink.width/2, 60);
});
test('capsule label recomputes visible glyph bounds after font or panel changes', async () => {
  const s = captionScene(); await settle();
  s.setVisible(false); s.ink.height = 20; s.callbacks.at(-1)();
  s.setVisible(true); s.callbacks.at(-1)();
  assert.equal(Number(s.text.attrs.y) + s.ink.y + s.ink.height/2, 24);
});
test('vocal pulse touches only visible horizontal background bands and leaves other artwork alone', () => {
  const template = fs.readFileSync(new URL('../templates/city.html', import.meta.url), 'utf8');
  const fn = template.slice(template.indexOf('function prepCard(card)'), template.indexOf('/* Pointer-only playback;'));
  const band = rect => {
    rect.width = rect.right - rect.left; rect.height = rect.bottom - rect.top;
    const group = {classes: [], delays: {}, querySelectorAll: () => Array(12).fill({})};
    group.classList = {add: name => group.classes.push(name)};
    group.style = {setProperty: (k,v) => {group.delays[k] = v;}};
    const path = {group, transform: 'matrix(2.7777777,0,0,-2.7777777,5333.333,131.97225)',
      getBoundingClientRect: () => rect, closest: () => group,
      before(wrapper){this.group=wrapper;}};
    path.attrs={}; path.classes=[]; path.delays={};
    path.setAttribute=(k,v)=>{path.attrs[k]=v;};
    path.classList={add:(...names)=>path.classes.push(...names)};
    path.style={setProperty:(k,v)=>{path.delays[k]=v;}};
    return path;
  };
  const lines = [band({left:10,right:200,top:20,bottom:22}),
    band({left:10,right:12,top:20,bottom:200}),
    band({left:400,right:600,top:20,bottom:22})];
  const card = {dataset: {dir:'vocal'}, getBoundingClientRect: () => ({left:0,right:300,top:0,bottom:400})};
  const context = {card, SPREAD:.7, AFTER:.95, $$: () => lines, document: {createElementNS(){
    const wrapper={classes:[],delays:{},appendChild(path){this.path=path;}};
    wrapper.classList={add:name=>wrapper.classes.push(name)};
    wrapper.style={setProperty:(k,v)=>{wrapper.delays[k]=v;}};
    return wrapper;
  }}};
  assert.equal(vm.runInNewContext(fn+'; prepCard(card)', context), 2.6);
  assert.deepEqual(lines[0].group.classes, ['voice-pulse']);
  assert.deepEqual(lines[1].group.classes, []); assert.deepEqual(lines[2].group.classes, []);
  assert.equal(lines[0].group.delays['--voice-delay'], '0.950s');
  assert.deepEqual(lines[0].classes,['ap','rev']);
  assert.equal(lines[0].attrs.pathLength,1);
  assert.equal(lines[0].group.path, lines[0]);
  assert.equal(lines[0].transform, 'matrix(2.7777777,0,0,-2.7777777,5333.333,131.97225)');
  vm.runInNewContext(fn+'; prepCard(card)', context);
  assert.equal(lines[0].group.classes.length, 1);
});
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
test('direction playback switches immediately and never queues old cards',async()=>{
  const s=playerScene();await settle();const [a,b,c]=s.cards;
  s.eligible.add(a);s.player.request(a);assert.equal(a.classList.playing,true);
  s.eligible.add(b);s.player.request(b);assert.equal(a.classList.playing,false);assert.equal(b.classList.playing,true);
  s.eligible.add(c);s.player.request(c);assert.equal(b.classList.playing,false);assert.equal(c.classList.playing,true);
  assert.equal(s.cards.filter(c=>c.classList.playing).length,1);assert.equal(s.timers.size,1);
  s.finish();assert.equal(s.cards.some(c=>c.classList.playing),false);assert.equal(s.timers.size,0);
});
test('pointer leave stops synchronously and re-entry starts from the beginning',async()=>{
  const s=playerScene();await settle();const [a]=s.cards;
  s.eligible.add(a);s.player.request(a);const first=[...s.timers.keys()][0];
  s.player.request(a);assert.equal([...s.timers.keys()][0],first);
  s.player.leave(a);assert.equal(a.classList.playing,false);assert.equal(s.timers.size,0);
  s.player.request(a);assert.equal(a.classList.playing,true);assert.notEqual([...s.timers.keys()][0],first);
});
test('assets loading never starts a card already left; no autoplay without a pointer request',async()=>{
  let load;const s=playerScene(new Promise(r=>{load=r;}));const [a]=s.cards;
  s.eligible.add(a);s.player.request(a);s.player.leave(a);load();await settle();assert.equal(s.timers.size,0);
  const untouched=playerScene();await settle();untouched.eligible.add(untouched.cards[0]);assert.equal(untouched.timers.size,0);
});
test('reduced motion stops/reset all playback and blocks new requests',async()=>{
  const s=playerScene();await settle();const [a]=s.cards;s.eligible.add(a);s.player.request(a);
  s.setReduced(true);s.player.stop();assert.equal(a.classList.playing,false);assert.equal(s.timers.size,0);
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
  const document=events({documentElement:{scrollHeight:3000},hidden:false,activeElement:null,getElementById:id=>id==='lessonNudge'?box:id==='leadModal'?modal:null,querySelector:selector=>selector==='.top .openForm'?trigger:null});
  const timers=[],frames=[];
  const window=events({scrollY:0,innerHeight:800,setTimeout:(fn,ms)=>{assert.ok(ms===4000||(ms>=25000&&ms<=35000));return timers.push(fn);}});
  Object.defineProperty(window,'sessionStorage',{get(){if(blocked)throw Error('blocked');return{getItem:k=>store.get(k),setItem:(k,v)=>store.set(k,v)};}});
  vm.runInNewContext(source('city-ui.js'),{document,window,requestAnimationFrame:fn=>{frames.push(fn);return 1;}});
  return {box,modal,document,window,close,trigger,timers,async scroll(){await window.emit('scroll');frames.splice(0).forEach(fn=>fn());},delay(){timers.splice(0).forEach(fn=>fn());}};
}
test('invitation waits four seconds without scrolling, does not repeat immediately',async()=>{
  const store=new Map(),s=nudgeScene(store);assert.equal(s.box.hidden,true);s.delay();assert.equal(s.box.hidden,false);
  s.window.scrollY=500;await s.scroll();assert.equal(s.box.hidden,false);
  await s.close.emit('click');assert.equal(s.box.hidden,true);await s.scroll();assert.equal(s.box.hidden,true);
  const next=nudgeScene(store);next.window.scrollY=500;next.delay();await next.scroll();assert.equal(next.box.hidden,false);
});
test('invitation never overlays open form; only its close control dismisses it',async()=>{
  const s=nudgeScene();s.window.scrollY=500;s.modal.hidden=false;s.delay();assert.equal(s.box.hidden,true);
  await s.document.emit('tz:lead-open');s.modal.hidden=true;await s.scroll();assert.equal(s.box.hidden,true);
  const other=nudgeScene();other.window.scrollY=500;other.delay();other.document.activeElement=other.close;
  await other.document.emit('keydown',{key:'Escape',preventDefault(){}});assert.equal(other.box.hidden,false);await other.close.emit('click');assert.equal(other.box.hidden,true);assert.equal(other.trigger.focused,true);
  const outside=nudgeScene();outside.window.scrollY=500;outside.delay();await outside.document.emit('click',{target:{}});assert.equal(outside.box.hidden,false);
});
test('invitation works if session storage is unavailable',()=>{
  const s=nudgeScene(new Map(),true);s.window.scrollY=500;s.delay();assert.equal(s.box.hidden,false);assert.equal(s.timers.length,0);
});

test('repeat waits after dismissal, requires middle page, stops after two or form opening',async()=>{
 const s=nudgeScene();s.delay();await s.close.emit('click');
 s.window.scrollY=1100;await s.scroll();assert.equal(s.box.hidden,true);
 s.window.scrollY=0;s.delay();assert.equal(s.box.hidden,true);
 s.window.scrollY=1100;await s.scroll();assert.equal(s.box.hidden,false);
 await s.close.emit('click');s.delay();await s.scroll();assert.equal(s.box.hidden,true);
 const other=nudgeScene();other.delay();await other.close.emit('click');
 await other.document.emit('tz:lead-open');other.window.scrollY=1100;other.delay();await other.scroll();assert.equal(other.box.hidden,true);
});
test('invitation ignores swipes and outside taps',async()=>{
 const s=nudgeScene();s.delay();await s.document.emit('pointerdown',{target:{}});assert.equal(s.box.hidden,false);
 await s.document.emit('click',{target:{}});assert.equal(s.box.hidden,false);
});

function formScene(endpoint=null,reply='success',withoutArt=false,pageCity='',combinedDocs=false) {
  const element=()=>events({hidden:false,disabled:false,offsetParent:{},tabIndex:0,style:{},dataset:{},classList:{add(){},remove(){},toggle(){}},setAttribute(){},focus(){document.activeElement=this;}});
  const input=()=>Object.assign(element(),{value:'',setCustomValidity(v){this.validity=v;},reportValidity(){return !this.validity;}});
  const name=input(),phone=input(),website=input(),direction=input(),branch=input();
  Object.defineProperty(branch,'selectedOptions',{get:()=>[{value:branch.value,textContent:branch.value||'choose'}]});
  const submit=element(),status=element(),sheet=element(),success=element(),close=element(),dismiss=element(),trigger=element();
  success.hidden=true;
  const chips=element(),caption=element(),branchCaption=element(),branchLabel=element(),directionTitle=element(),directionReset=element();
  let calls=0,uuids=0,payload;
  const form=Object.assign(element(),{elements:{name,phone,website,direction,branch},reportValidity:()=>name.value.trim().length>=2&&!!branch.value,
    reset(){for(const e of Object.values(this.elements))e.value='';},querySelector:s=>s==='.lead-submit'?submit:s==='.lead-branch-label'?branchLabel:null});
  form.dispatchEvent=e=>{form.emit(e.type,e);};
  const svg={setAttribute(){},querySelectorAll:()=>[],getScreenCTM:()=>({a:1})};
  const art={querySelector:()=>svg,closest:()=>sheet};
  const map={'.lead-sheet':sheet,'.lead-success':success,'.lead-close':close,'[data-lead-dismiss]':dismiss,'.sheet-art':withoutArt?null:art,'#chips':chips,'#pickCap':caption,'#directionTitle':directionTitle,'#directionReset':directionReset,'#leadBranchCaption':branchCaption};
  const modal=Object.assign(element(),{hidden:true,querySelector:s=>map[s],querySelectorAll:s=>s==='a,button,input,select'?[close,name,phone,submit]:[]});
  const link=href=>({getAttribute:()=>href,dataset:combinedDocs?{consentUrl:'./documents/#consent',policyUrl:'./documents/#privacy'}:{}});
  const document=events({body:{dataset:{city:pageCity},style:{}},activeElement:trigger,
    getElementById:id=>({leadModal:modal,leadForm:form,leadStatus:status})[id],
    querySelector:s=>s==='.lead-consent a'?link('./consent/'):null,
    querySelectorAll:s=>s==='.openForm'?[trigger]:s==='.lead-consent a'?[link('./consent/'),link('./privacy/')]:[]});
  document.dispatchEvent=e=>{document.emit(e.type);};
  const window=events({TZ_LEADS:{endpoint}});
  vm.runInNewContext(source('lead-form.js'),{window,document,matchMedia:()=>({matches:true,addEventListener(){}}),
    requestAnimationFrame:()=>1,cancelAnimationFrame(){},setTimeout:()=>1,clearTimeout(){},URL,AbortController,Event,
    location:{href:'https://killreal2227.github.io/tochka_zvuka/',pathname:'/tochka_zvuka/'},
    crypto:{randomUUID(){uuids++;return'00000000-0000-4000-8000-000000000001';}},
    CustomEvent:class{constructor(type){this.type=type;}},
    fetch:async(_,options)=>{calls++;payload=JSON.parse(options.body);return{ok:reply==='success',status:reply==='success'?200:502,
      json:async()=>reply==='success'?{ok:true,requestId:payload.requestId,leadId:'1'}:{ok:false}};}});
  const fill=()=>{name.value='Иван';phone.value='+79950000000';branch.value='kaluga';};
  return {trigger,close,form,success,modal,phone,status,caption,branchCaption,directionTitle,directionReset,fill,get calls(){return calls;},get uuids(){return uuids;},get payload(){return payload;}};
}
test('address link searches the selected branch and hides when no branch is selected',async()=>{
  for(const city of ['kaluga','troitsk']){
    const s=formScene(null,'success',false,city);await s.trigger.emit('click');
    assert.equal(s.branchCaption.href,'https://yandex.ru/maps/?text='+city);
    assert.equal(s.branchCaption.hidden,false);
    s.form.elements.branch.value='';await s.form.elements.branch.emit('change');
    assert.equal(s.branchCaption.hidden,true);
  }
});
test('selected direction caption is lowercase and clears without permanent helper text',async()=>{
  const s=formScene();s.form.elements.direction.value='vocal';
  await s.form.emit('change',{target:{name:'direction'}});
  assert.equal(s.caption.textContent,'вокал');
  s.form.elements.direction.value='';await s.form.emit('change',{target:{name:'direction'}});
  assert.equal(s.caption.textContent,'');
});
test('unconfigured form gives requested feedback without request, storage or lead ID',async()=>{
  const s=formScene();await s.trigger.emit('click');s.fill();await s.form.emit('submit',{preventDefault(){}});
  assert.equal(s.calls,0);assert.equal(s.uuids,0);assert.equal(s.success.hidden,false);assert.equal(s.form.hidden,true);
  assert.equal(s.phone.value,'');await s.trigger.emit('click');assert.equal(s.form.hidden,false);assert.equal(s.success.hidden,true);
});
test('single-column branch form opens and confirms locally without decorative SVG',async()=>{
  for(const city of ['kaluga','troitsk']){
    const s=formScene(null,'success',true,city);await s.trigger.emit('click');
    assert.equal(s.modal.hidden,false);assert.equal(s.form.elements.branch.value,city);
    s.fill();s.form.elements.branch.value=city;
    await s.form.emit('submit',{preventDefault(){}});
    assert.equal(s.success.hidden,false);assert.equal(s.calls,0);assert.equal(s.uuids,0);
  }
});
test('configured form uses transport acknowledgement and includes button-consent metadata',async()=>{
  const s=formScene('https://example.invalid/leads');await s.trigger.emit('click');s.fill();await s.form.emit('submit',{preventDefault(){}});
  assert.equal(s.calls,1);assert.equal(s.success.hidden,false);assert.equal(s.payload.consent.accepted,true);assert.equal(s.payload.consent.version,'2026-11-10-v3');
  const bad=formScene('https://example.invalid/leads','failure');bad.fill();await bad.form.emit('submit',{preventDefault(){}});
  assert.equal(bad.success.hidden,true);assert.ok(bad.status.textContent);
});
test('combined legal page keeps consent and policy module URLs in future submission metadata',async()=>{
  const s=formScene('https://example.invalid/leads','success',false,'',true);
  await s.trigger.emit('click');s.fill();await s.form.emit('submit',{preventDefault(){}});
  assert.equal(s.payload.consent.documentUrl,'https://killreal2227.github.io/tochka_zvuka/documents/#consent');
  assert.equal(s.payload.consent.privacyUrl,'https://killreal2227.github.io/tochka_zvuka/documents/#privacy');
});
test('invalid phone is rejected before any external request',async()=>{
  const s=formScene('https://example.invalid/leads');s.fill();s.phone.value='123';await s.form.emit('submit',{preventDefault(){}});
  assert.equal(s.calls,0);assert.ok(s.phone.validity);
});

test('direction title and reset button follow selection and reset only the direction',async()=>{
  const s=formScene();await s.trigger.emit('click');s.fill();
  assert.equal(s.directionTitle.textContent,'Выбери направление. Не знаешь какое — поможем');
  assert.equal(s.directionReset.hidden,true);
  s.form.elements.direction.value='speech';
  await s.form.emit('change',{target:{name:'direction'}});
  assert.equal(s.directionTitle.textContent,'Ораторское искусство');
  assert.equal(s.directionReset.hidden,false);
  await s.directionReset.emit('click');
  assert.equal(s.form.elements.direction.value,'');
  assert.equal(s.directionTitle.textContent,'Выбери направление. Не знаешь какое — поможем');
  assert.equal(s.directionReset.hidden,true);
  assert.equal(s.caption.textContent,'');
  assert.equal(s.form.elements.name.value,'Иван');
  assert.equal(s.form.elements.branch.value,'kaluga');
});

test('the single corner close control dismisses both form and confirmation',async()=>{
  const s=formScene();await s.trigger.emit('click');
  await s.close.emit('click');assert.equal(s.modal.hidden,true);
  await s.trigger.emit('click');s.fill();await s.form.emit('submit',{preventDefault(){}});
  assert.equal(s.success.hidden,false);assert.equal(s.modal.hidden,false);
  await s.close.emit('click');assert.equal(s.modal.hidden,true);
});

test('mobile steps connect actual dot positions and progress in scroll order',()=>{
  const template=fs.readFileSync(new URL('../templates/city.html',import.meta.url),'utf8');
  const fn=template.slice(template.indexOf('function stepsUpdate(){'),template.indexOf('let stepsFrame=0;'));
  const props={},items=[0,200,400].map(top=>({offsetTop:top,offsetLeft:top,on:false,current:false,classList:{toggle(name,value){this.owner[name]=value;}}}));
  items.forEach(x=>x.classList.owner=x);
  let top=200;
  const context={stepsEl:{getBoundingClientRect:()=>({top}),style:{setProperty:(k,v)=>props[k]=v}},stepItems:items,
    matchMedia:()=>({matches:true}),innerHeight:800,reduce:false};
  vm.createContext(context);vm.runInContext(fn,context);context.stepsUpdate();
  assert.equal(props['--steps-track'],'400px');assert.equal(props['--steps-fill'],'298px');
  assert.deepEqual(items.map(x=>x.on),[true,true,false]);
  top=-100;context.stepsUpdate();assert.equal(props['--steps-fill'],'400px');assert.ok(items.every(x=>x.on));
});

test('branch header shows only its current address without a branch switching control',()=>{
  const template=fs.readFileSync(new URL('../templates/city.html',import.meta.url),'utf8');
  const header=template.slice(template.indexOf('<header class="top"'),template.indexOf('</header>'));
  assert.ok(header.includes('class="branch-current"'));assert.ok(header.includes('{{address}}'));
  assert.ok(!header.includes('branchBtn'));assert.ok(!header.includes('branch-opt'));
  assert.ok(!template.includes("const bBtn="));assert.ok(header.includes('header-cta openForm'));
});

function ordinaryScene(finePointer=false,compactWidth=false,withPreviews=false){
  const events=()=>({handlers:new Map(),addEventListener(k,fn,options){const list=this.handlers.get(k)||[];list.push({fn,options});this.handlers.set(k,list);},emit(k,e={}){(this.handlers.get(k)||[]).forEach(x=>x.fn(e));}});
  const cards=Array.from({length:6},(_,i)=>Object.assign(events(),{rect:{top:900+i*160,bottom:1040+i*160},classes:new Set(),keyboardFocus:false,matches(){return this.keyboardFocus;},getBoundingClientRect(){return this.rect;}}));
  cards.forEach((card,i)=>{
    card.dataset={dir:String(i)};card.querySelector=()=>({textContent:'direction'});card.setAttribute=()=>{};card.removeAttribute=()=>{};
    card.classList={add:k=>card.classes.add(k),remove:k=>card.classes.delete(k),toggle(k,v){v?card.classes.add(k):card.classes.delete(k);}};
  });
  const grid={querySelectorAll:()=>cards},header={getBoundingClientRect:()=>({bottom:76})},modal={hidden:true};
  const document=Object.assign(events(),{body:{dataset:withPreviews?{city:'troitsk'}:{}},hidden:false,querySelector:s=>s==='#dirs .grid'?grid:header,getElementById:()=>modal});
  const window=Object.assign(events(),{innerHeight:800}),frames=new Map(),played=[];let sequence=0;
  const fine=Object.assign(events(),{matches:finePointer}),compact=Object.assign(events(),{matches:compactWidth}),reduced=Object.assign(events(),{matches:false});
  const context={window,document,innerHeight:800,Promise,WeakSet,Map,
    matchMedia:q=>q.includes('pointer:fine')?fine:q.includes('max-width')?compact:reduced,
    requestAnimationFrame:fn=>{const id=++sequence;frames.set(id,fn);return id;}};
  vm.runInNewContext(source('direction-player.js'),context);
  window.createDirectionPlayer=options=>({stop(){},request(card){if(options.eligible(card)&&!options.reduced()&&!options.blocked()){options.prepare(card);played.push(card);}}});
  vm.runInNewContext(source('direction-scroll.js'),context);window.createDirectionInteractions({ready:Promise.resolve(),prepare:()=>2.9});
  const tick=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn());};tick();
  return {cards,grid,modal,document,window,played,tick,reduced,scroll(top){cards.forEach((c,i)=>c.rect={top:top+i*160,bottom:top+i*160+140});window.emit('scroll');tick();}};
}

test('touch scrolling and resize never start direction playback',()=>{
  const s=ordinaryScene();for(const top of [700,660,500,340,0])s.scroll(top);
  s.window.emit('resize');s.tick();assert.equal(s.played.length,0);
  assert.equal(s.cards.filter(c=>c.classes.has('is-active')).length,0);
});

test('narrow mouse viewport starts effects only on intentional hover',()=>{
  const s=ordinaryScene(true,true);s.scroll(340);assert.equal(s.played.length,0);
  s.cards[2].emit('pointerenter',{pointerType:'mouse'});assert.deepEqual(s.played,[s.cards[2]]);
  s.cards[2].emit('pointerleave');assert.ok(s.cards.every(c=>!c.classes.has('is-active')));
});

test('desktop cards use hover and retain their existing grid DOM',()=>{
  const s=ordinaryScene(true);assert.equal(s.played.length,0);
  s.cards[2].emit('pointerenter',{pointerType:'mouse'});assert.ok(s.cards[2].classes.has('is-active'));
  s.cards[2].emit('pointerleave');s.tick();assert.ok(s.cards.every(c=>!c.classes.has('is-active')));
  s.cards[2].emit('pointerenter',{pointerType:'mouse'});assert.equal(s.played.length,2);
  s.modal.hidden=false;s.document.emit('tz:lead-open');assert.ok(s.cards.every(c=>!c.classes.has('is-active')));
});
test('direction interactions add no sticky wrappers, extra height or scroll interception',()=>{
  const controller=source('direction-scroll.js'),css=source('city-ui.css');
  for(const forbidden of ['scrollTo(','preventDefault(','setTimeout(','createElement(','replaceChildren(','style.height'])assert.ok(!controller.includes(forbidden),forbidden);
  assert.ok(!css.includes('direction-row-stage'));assert.ok(!css.includes('direction-tour-held'));
  assert.ok(css.includes('@media(width < 1400px)'));assert.ok(css.includes('font-size:17px; line-height:1.35;'));
});

function eyeScene(){
  const template=fs.readFileSync(new URL('../templates/city.html',import.meta.url),'utf8');
  const start=template.indexOf("const stage=$('#stage');"),end=template.indexOf('\n/*',start);
  const handlers=new Map(),frames=new Map(),dot={style:{}};let next=0;
  const on=(name,fn)=>{const list=handlers.get(name)||[];list.push(fn);handlers.set(name,list);};
  const emit=(name,value={})=>(handlers.get(name)||[]).forEach(fn=>fn(value));
  const pointer={matches:true,addEventListener:(_,fn)=>on('pointer-change',fn)},reduced={matches:false,addEventListener:(_,fn)=>on('reduce-change',fn)};
  const document={hidden:false,addEventListener:on};
  vm.runInNewContext(template.slice(start,end),{dot,document,innerWidth:1000,innerHeight:800,
    $:()=>({getBoundingClientRect:()=>({left:0,top:0,width:100,height:100})}),
    matchMedia:q=>q.includes('pointer:fine')?pointer:reduced,addEventListener:on,
    requestAnimationFrame:fn=>{const id=++next;frames.set(id,fn);return id;},cancelAnimationFrame:id=>frames.delete(id)});
  const tick=()=>{const batch=[...frames.values()];frames.clear();batch.forEach(fn=>fn());};
  return {emit,tick,frames,dot,document,reduced};
}

test('hero eye restarts after blur/focus even when the old frame was discarded',()=>{
  const s=eyeScene();s.emit('pointermove',{clientX:900,clientY:700});assert.equal(s.frames.size,1);
  s.frames.clear();s.emit('blur');s.emit('focus');assert.equal(s.frames.size,1);
  s.tick();const before=s.dot.style.transform;
  s.emit('pointermove',{clientX:0,clientY:0});for(let i=0;i<60;i++)s.tick();
  assert.notEqual(s.dot.style.transform,before);assert.ok(!s.dot.style.transform.includes('NaN'));assert.equal(s.frames.size,0);
});

test('hero eye pauses while hidden and resumes with only one pending frame',()=>{
  const s=eyeScene();s.emit('pointermove',{clientX:900,clientY:700});
  s.document.hidden=true;s.emit('visibilitychange');assert.equal(s.frames.size,0);
  s.document.hidden=false;s.emit('visibilitychange');s.emit('focus');assert.equal(s.frames.size,1);
  s.tick();assert.match(s.dot.style.transform,/translate\(/);
});

test('hero eye ignores invalid pointer coordinates and respects reduced motion after returning',()=>{
  const s=eyeScene();s.emit('pointermove',{clientX:NaN,clientY:Infinity});assert.equal(s.frames.size,0);
  s.emit('pointermove',{clientX:900,clientY:700});s.tick();
  s.reduced.matches=true;s.emit('reduce-change');s.emit('focus');assert.equal(s.frames.size,0);assert.equal(s.dot.style.transform,'');
  s.reduced.matches=false;s.emit('reduce-change');s.emit('pointermove',{clientX:0,clientY:0});s.tick();
  assert.match(s.dot.style.transform,/translate\(/);assert.ok(!s.dot.style.transform.includes('NaN'));
});

test('lead form backdrop ignores swipes but accepts a stationary tap',async()=>{
 const s=formScene();await s.trigger.emit('click');
 await s.modal.emit('pointerdown',{clientX:10,clientY:300});
 await s.modal.emit('pointermove',{clientX:10,clientY:100});
 await s.modal.emit('click',{target:s.modal});assert.equal(s.modal.hidden,false);
 await s.modal.emit('pointerdown',{clientX:10,clientY:100});
 await s.modal.emit('click',{target:s.modal});assert.equal(s.modal.hidden,true);
});

test('direction hover ignores points outside card bounds and focus requires keyboard visibility',()=>{
 const s=ordinaryScene(true),card=s.cards[0];card.rect={left:20,right:300,top:100,bottom:400};
 card.emit('pointerenter',{pointerType:'mouse',clientX:340,clientY:200});assert.equal(s.played.length,0);
 card.emit('focusin');assert.equal(s.played.length,0);
 card.emit('pointerenter',{pointerType:'mouse',clientX:200,clientY:200});assert.deepEqual(s.played,[card]);
 card.emit('pointerleave');card.keyboardFocus=true;card.emit('focusin');assert.equal(s.played.length,2);
});


test('touch card reveals once, arrow opens immediately, and preview can be viewed again',()=>{
 const js=source('lead-form.js');
 const handler=js.slice(js.indexOf('/* Preview and signup'),js.indexOf("modal.querySelector('.lead-close')"));
 const callbacks=[],opened=[],previews=[];
 const arrows=[{},{}];arrows.forEach(a=>a.contains=t=>t===a);
 const cards=['vocal','guitar'].map((dir,i)=>({preview:false,dataset:{dir},classList:{contains:()=>cards[i].preview},querySelector:()=>arrows[i],addEventListener:(_,fn)=>callbacks.push(fn),getBoundingClientRect:()=>({left:20,right:300,top:100,bottom:400})}));
 const document={querySelectorAll:()=>cards,dispatchEvent:e=>{e.detail.card.preview=true;previews.push(e.detail.card);}};
 vm.runInNewContext(handler,{document,pageCity:'troitsk',matchMedia:()=>({matches:true}),open:dir=>opened.push(dir),CustomEvent:class{constructor(type,options){this.detail=options.detail;}}});
 const tap={detail:1,clientX:100,clientY:200,target:cards[0]};
 callbacks[0](tap);callbacks[0](tap);callbacks[0](tap);assert.deepEqual(previews,[cards[0]]);assert.equal(opened.length,0);
 callbacks[0]({...tap,target:arrows[0]});assert.deepEqual(opened,['vocal']);
 cards[0].preview=false;callbacks[0](tap);assert.equal(previews.length,2);
 callbacks[1]({...tap,target:arrows[1]});assert.deepEqual(opened,['vocal','guitar']);
 callbacks[1]({...tap,clientX:350,target:arrows[1]});assert.equal(opened.length,2);
 callbacks[0]({...tap,detail:0});assert.equal(opened.length,3);
});

test('touch preview survives outside taps, focus changes and visible scrolling',()=>{
 const s=ordinaryScene(true,true,true),card=s.cards[0];
 card.rect={left:20,right:300,top:100,bottom:400};
 s.document.emit('tz:direction-preview',{detail:{card}});assert.equal(s.played.length,1);
 s.document.emit('pointerdown',{target:{}});assert.ok(card.classes.has('is-preview'));
 s.cards[1].emit('pointerenter',{pointerType:'mouse'});s.cards[1].keyboardFocus=true;s.cards[1].emit('focusin');
 assert.equal(s.played.length,1);assert.ok(card.classes.has('is-active'));
 s.window.emit('scroll');assert.ok(card.classes.has('is-preview'));
 s.document.emit('tz:direction-preview',{detail:{card}});assert.equal(s.played.length,1);
 card.rect={left:20,right:300,top:-400,bottom:0};s.window.emit('scroll');assert.ok(!card.classes.has('is-preview'));
});

test('reassurance gets two lines exactly when the address wraps',()=>{
 const js=source('lead-form.js');const fn=js.slice(js.indexOf('function syncFooterLines(){'),js.indexOf('const scheduleFooterLines='));
 let height=17,wrapped=false;
 const caption={hidden:false,getBoundingClientRect:()=>({height})};
 const ctx={modal:{hidden:false,querySelector:()=>caption},sheet:{classList:{toggle:(name,value)=>{wrapped=value;}}},getComputedStyle:()=>({lineHeight:'17px'})};
 vm.runInNewContext(fn+'syncFooterLines();',ctx);assert.equal(wrapped,false);
 height=34;ctx.syncFooterLines();assert.equal(wrapped,true);
 height=17;ctx.syncFooterLines();assert.equal(wrapped,false);
});

test('short landscape form shrinks only when necessary and restores after rotation',()=>{
 const js=source('lead-form.js');const fn=js.slice(js.indexOf('let fitFrame=0;'),js.indexOf('function scheduleFormFit()'));
 const body={style:{maxHeight:''}},sheet={style:{},getBoundingClientRect:()=>({height:500})};
 const window={innerWidth:844,innerHeight:390,visualViewport:{height:390}};
 const ctx={window,modal:{hidden:false,querySelector:()=>body},form:{contains:()=>false},document:{activeElement:null},sheet,syncFooterLines(){}};
 vm.runInNewContext(fn+'fitShortForm();',ctx);assert.equal(Number(sheet.style.zoom),362/500);
 window.innerHeight=600;window.visualViewport.height=600;ctx.fitShortForm();assert.equal(sheet.style.zoom,'1');
 window.innerWidth=800;window.innerHeight=667;window.visualViewport.height=667;ctx.fitShortForm();assert.equal(sheet.style.zoom,'0.9');
 window.innerWidth=390;window.innerHeight=844;ctx.fitShortForm();assert.equal(sheet.style.zoom,'');assert.equal(sheet.style.maxHeight,'');
});
