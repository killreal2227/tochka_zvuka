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
  return {trigger,form,success,modal,phone,status,caption,branchCaption,directionTitle,directionReset,fill,get calls(){return calls;},get uuids(){return uuids;},get payload(){return payload;}};
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
  assert.equal(s.directionTitle.textContent,'Не знаешь? Поможем выбрать');
  assert.equal(s.directionReset.hidden,true);
  s.form.elements.direction.value='speech';
  await s.form.emit('change',{target:{name:'direction'}});
  assert.equal(s.directionTitle.textContent,'Ораторское искусство');
  assert.equal(s.directionReset.hidden,false);
  await s.directionReset.emit('click');
  assert.equal(s.form.elements.direction.value,'');
  assert.equal(s.directionTitle.textContent,'Не знаешь? Поможем выбрать');
  assert.equal(s.directionReset.hidden,true);
  assert.equal(s.caption.textContent,'');
  assert.equal(s.form.elements.name.value,'Иван');
  assert.equal(s.form.elements.branch.value,'kaluga');
});
