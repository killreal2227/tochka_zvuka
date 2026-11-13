import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
const source=fs.readFileSync(new URL('../site/scroll-reveal.js',import.meta.url),'utf8');
function scene({legal=false,reduced=false,observer=true}={}){
 const classes=()=>({set:new Set(),add(name){this.set.add(name);},contains(name){return this.set.has(name);},toggle(name,on){if(on)this.set.add(name);else this.set.delete(name);}});
 const timers=new Map(),listeners=new Map(),media={matches:reduced,addEventListener(_,fn){this.change=fn;}};
 let callback,id=0,queries=0;
 const element={classList:classes(),style:{setProperty(){}},contains(node){return node===this;}};
 const body={classList:classes()};if(legal)body.classList.add('documents-page');
 const document={body,activeElement:null,querySelectorAll(){queries++;return[element];},addEventListener(k,fn){listeners.set(k,fn);}};
 class Observer{constructor(fn,options){callback=fn;assert.deepEqual([...options.threshold],[0,.14]);}observe(node){assert.equal(node,element);}}
 vm.runInNewContext(source,{document,window:observer?{IntersectionObserver:Observer}:{},IntersectionObserver:Observer,matchMedia:()=>media,
  setTimeout(fn,ms){assert.equal(ms,100);timers.set(++id,fn);return id;},clearTimeout(token){timers.delete(token);}});
 return{element,document,body,media,listeners,timers,get queries(){return queries;},
 emit(inside,ratio=0,height=0){callback([{target:element,isIntersecting:inside,intersectionRatio:ratio,intersectionRect:{height},boundingClientRect:{bottom:inside?100:-10}}]);},
 flush(){const pending=[...timers.values()];timers.clear();pending.forEach(fn=>fn());}};
}
test('reveals restart in both directions and ignore minor intersection changes',()=>{
 const s=scene();assert.equal(s.element.classList.contains('is-revealed'),false);
 s.emit(true,.2,30);assert.equal(s.element.classList.contains('is-revealed'),true);
 s.emit(true,.03,3);assert.equal(s.element.classList.contains('is-revealed'),true);
 s.emit(false);s.emit(true,.05,5);s.flush();assert.equal(s.element.classList.contains('is-revealed'),true);
 s.emit(false);s.flush();assert.equal(s.element.classList.contains('is-revealed'),false);
 s.emit(true,.2,30);assert.equal(s.element.classList.contains('is-revealed'),true);
});
test('focused controls and reduced motion remain visible',()=>{
 const s=scene();s.emit(false);s.document.activeElement=s.element;s.listeners.get('focusin')();s.flush();
 assert.equal(s.element.classList.contains('is-revealed'),true);
 s.document.activeElement=null;s.emit(false);s.flush();assert.equal(s.element.classList.contains('is-revealed'),false);
 s.media.matches=true;s.media.change();assert.equal(s.element.classList.contains('is-revealed'),true);
 assert.equal(s.body.classList.contains('reveal-enabled'),false);
});
test('documents are never queried or animated and unsupported browsers keep content visible',()=>{
 const legal=scene({legal:true});assert.equal(legal.queries,0);
 assert.equal(scene({observer:false}).element.classList.contains('is-revealed'),true);
 assert.equal(scene({reduced:true}).element.classList.contains('is-revealed'),true);
});
