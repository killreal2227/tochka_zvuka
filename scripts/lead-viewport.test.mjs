import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../site/lead-viewport.js',import.meta.url),'utf8');
function scene({withViewport=true}={}){
 const handlers=()=>({listeners:new Map(),addEventListener(k,fn){const list=this.listeners.get(k)||[];list.push(fn);this.listeners.set(k,list);},emit(k,event={}){for(const fn of this.listeners.get(k)||[])fn(event);},dispatchEvent(e){this.emit(e.type,e);return !e.defaultPrevented;}});
 const style=()=>({values:new Map(),getPropertyValue(k){return this.values.get(k)?.[0]||'';},getPropertyPriority(k){return this.values.get(k)?.[1]||'';},setProperty(k,v,p=''){this.values.set(k,[v,p]);},removeProperty(k){this.values.delete(k);}});
 const classes=()=>({values:new Set(),contains(k){return this.values.has(k);},add(k){this.values.add(k);},toggle(k,on){if(on)this.values.add(k);else this.values.delete(k);}});
 const node=extra=>Object.assign(handlers(),{style:style(),classList:classes()},extra);
 const root=node({scrollHeight:5000}),body=node({scrollHeight:5000,getBoundingClientRect:()=>({width:390,height:5000})});
 root.style.setProperty('scroll-behavior','smooth','important');body.style.setProperty('overflow','clip');
 const frames=[node({getBoundingClientRect:()=>({height:1000})}),node({getBoundingClientRect:()=>({height:4000})})];
 const sheet=node(),form=node(),close=node({getBoundingClientRect:()=>({bottom:54})});
 const scroller=node({scrollHeight:700,clientHeight:340,scrollTop:0,getBoundingClientRect:()=>({top:10,bottom:350}),scrollTo(options){this.scrollTop=options.top;}});
 const field=node({parentElement:form,getBoundingClientRect:()=>({top:320,bottom:364}),matches:()=>true,blur(){document.activeElement=null;}});
 form.parentElement=scroller;form.contains=e=>e===field;scroller.contains=e=>e===field||e===form||e===scroller;
 const modal=node({hidden:false,querySelector:s=>({'.lead-sheet':sheet,'.sheet-body':scroller,'.lead-close':close})[s]});
 const document=Object.assign(handlers(),{documentElement:root,body,activeElement:null,getElementById:id=>id==='leadModal'?modal:form,querySelectorAll:()=>frames});
 const viewport=Object.assign(handlers(),{height:800,width:390,offsetTop:0,offsetLeft:0});
 const window=Object.assign(handlers(),{innerHeight:800,innerWidth:390,scrollX:0,scrollY:1700,scrollTo(x,y){this.scrollX=x;this.scrollY=y;this.restores=(this.restores||0)+1;},visualViewport:withViewport?viewport:undefined});
 const timers=new Map(),rafs=new Map();let next=0;
 const Event=class{constructor(type){this.type=type;}};
 vm.runInNewContext(source,{window,document,matchMedia:()=>({matches:false}),getComputedStyle:e=>({getPropertyValue:()=> '1',overflowY:e===scroller?'auto':'visible'}),
  Event,queueMicrotask:fn=>fn(),requestAnimationFrame:fn=>{rafs.set(++next,fn);return next;},cancelAnimationFrame:id=>rafs.delete(id),
  setTimeout:(fn,ms)=>{timers.set(++next,{fn,ms});return next;},clearTimeout:id=>timers.delete(id)});
 const flush=()=>{for(let i=0;rafs.size&&i<10;i++){const pending=[...rafs.values()];rafs.clear();pending.forEach(fn=>fn());}};
 return{document,root,body,frames,field,form,scroller,modal,window,viewport,timers,flush,
  open(){modal.hidden=false;document.emit('tz:lead-open');flush();},
  close(){modal.hidden=true;document.emit('tz:lead-close');flush();},
  keyboard(){document.activeElement=field;if(withViewport){viewport.height=300;viewport.offsetTop=30;viewport.emit('resize');}else{window.innerHeight=300;window.emit('resize');}flush();},
  restored(){if(withViewport){viewport.height=800;viewport.offsetTop=0;viewport.emit('resize');}else{window.innerHeight=800;window.emit('resize');}flush();}};
}
test('locks the original page dimensions and restores the exact position and styles',()=>{
 const s=scene();s.open();
 assert.equal(s.body.style.getPropertyValue('position'),'fixed');assert.equal(s.body.style.getPropertyValue('top'),'-1700px');
 assert.equal(s.body.style.getPropertyValue('width'),'390px');assert.equal(s.body.style.getPropertyValue('height'),'5000px');
 assert.equal(s.root.style.getPropertyValue('min-height'),'5000px');assert.equal(s.frames[0].style.getPropertyValue('--lead-frame-height'),'1000px');
 s.body.style.setProperty('--unrelated','preserve');s.close();
 assert.equal(s.body.style.getPropertyValue('position'),'');assert.equal(s.body.style.getPropertyValue('overflow'),'clip');
 assert.equal(s.body.style.getPropertyValue('--unrelated'),'preserve');
 assert.equal(s.root.style.getPropertyValue('scroll-behavior'),'smooth');assert.equal(s.root.style.getPropertyPriority('scroll-behavior'),'important');
 assert.equal(s.root.classList.contains('lead-scroll-locked'),false);assert.equal(s.window.scrollY,1700);
 assert.equal(s.frames[0].classList.contains('lead-page-frame'),false);
});
test('visualViewport constrains the modal and only the internal scroller follows the field',()=>{
 const s=scene();s.open();s.keyboard();
 assert.equal(s.modal.style.getPropertyValue('--form-viewport-height'),'300px');
 assert.equal(s.modal.style.getPropertyValue('--form-viewport-top'),'30px');
 assert.equal(s.scroller.scrollTop,26);assert.equal(s.window.scrollY,1700);
 assert.equal(s.body.style.getPropertyValue('height'),'5000px');
});
test('close waits for keyboard dismissal and reopening cancels the delayed unlock',()=>{
 const s=scene();s.open();s.keyboard();s.close();
 assert.equal(s.root.classList.contains('lead-scroll-locked'),true);assert.equal([...s.timers.values()][0].ms,450);
 s.open();assert.equal(s.timers.size,0);s.restored();
 assert.equal(s.root.classList.contains('lead-scroll-locked'),true);
 s.close();assert.equal(s.root.classList.contains('lead-scroll-locked'),false);assert.equal(s.window.scrollY,1700);
});
test('keyboard restoration releases a closed modal and a missing visualViewport uses resize',()=>{
 for(const withViewport of [true,false]){
  const s=scene({withViewport});s.open();s.keyboard();s.close();s.restored();
  assert.equal(s.root.classList.contains('lead-scroll-locked'),false);assert.equal(s.timers.size,0);assert.equal(s.window.scrollY,1700);
 }
});
test('touch scroll cannot chain to the background at either edge',()=>{
 const s=scene();s.open();
 function move(target,top,from,to){
  s.scroller.scrollTop=top;s.document.emit('touchstart',{target,touches:[{clientY:from}]});
  let blocked=false;s.document.emit('touchmove',{cancelable:true,touches:[{clientY:to}],preventDefault(){blocked=true;}});
  return blocked;
 }
 assert.equal(move({},20,100,80),true);
 assert.equal(move(s.scroller,20,100,80),false);
 assert.equal(move(s.scroller,0,100,120),true);
 assert.equal(move(s.scroller,360,100,80),true);
});
