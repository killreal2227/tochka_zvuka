import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

test('direction captions keep their center unless their actual width crosses the row edge',()=>{
  const source=fs.readFileSync(new URL('../site/lead-form.js',import.meta.url),'utf8');
  const fn=source.slice(source.indexOf('  function positionDirectionNames()'),source.indexOf("  window.addEventListener('resize',positionDirectionNames"));
  const name=(left,right)=>({style:{setProperty(_,v){this.shift=v;}},getBoundingClientRect:()=>({left,right})});
  const centered=name(180,260),right=name(310,460),left=name(10,120);
  const context={modal:{hidden:false},$:()=>({getBoundingClientRect:()=>({left:20,right:430})}),$$:()=>[centered,right,left]};
  vm.runInNewContext(fn+'positionDirectionNames();',context);
  assert.equal(centered.style.shift,'0px');assert.equal(right.style.shift,'-30px');assert.equal(left.style.shift,'10px');
  context.$=()=>({getBoundingClientRect:()=>({left:0,right:500})});
  vm.runInNewContext('positionDirectionNames();',context);
  assert.equal(right.style.shift,'0px');assert.equal(left.style.shift,'0px');
});

function scene(){
  const element=()=>({hidden:false,attrs:{},handlers:{},children:[],classList:{toggle(){}},
    setAttribute(k,v){this.attrs[k]=v;},removeAttribute(k){delete this.attrs[k];},
    addEventListener(k,fn){this.handlers[k]=fn;},append(item){this.children.push(item);},
    scrollIntoView(){},focus(){this.focused=true;},contains(target){return target===this;}});
  const picker=element(),control=element(),list=element(),value=element(),label=element(),native=element();
  control.id='leadBranchControl';list.hidden=true;native.value='';
  native.options=[{value:'',textContent:'Выбери город'},{value:'troitsk',textContent:'Троицк'},{value:'kaluga',textContent:'Калуга'}];
  Object.defineProperty(native,'selectedIndex',{get:()=>native.options.findIndex(o=>o.value===native.value)});
  Object.defineProperty(native,'selectedOptions',{get:()=>[native.options[native.selectedIndex]]});
  native.dispatchEvent=event=>native.handlers[event.type]?.(event);
  const document=element();document.createElement=element;
  const status={textContent:''};
  const nodes={'.lead-branch-picker':picker,'#leadBranchControl':control,'#leadBranchList':list,'#leadBranchValue':value,'#leadBranchLabel':label};
  const source=fs.readFileSync(new URL('../site/lead-form.js',import.meta.url),'utf8');
  const start=source.indexOf('  const branchPicker=');
  const end=source.indexOf('  function open(',start);
  vm.runInNewContext(source.slice(start,end),{document,form:{elements:{branch:native}},$:s=>nodes[s],status,Event:class{constructor(type){this.type=type;}},setTimeout:()=>1,clearTimeout(){}});
  const key=k=>{const e={key:k,preventDefault(){this.prevented=true;},stopPropagation(){this.stopped=true;}};control.handlers.keydown(e);return e;};
  return {control,list,value,native,status,key,document};
}
test('branch picker keyboard selection updates native form value and accessible state',()=>{
  const s=scene();assert.equal(s.native.hidden,true);
  s.key('Enter');assert.equal(s.control.attrs['aria-expanded'],'true');
  s.key('ArrowDown');s.key('Enter');
  assert.equal(s.native.value,'troitsk');assert.equal(s.value.textContent,'Троицк');
  assert.equal(s.list.children[1].attrs['aria-selected'],'true');assert.equal(s.list.hidden,true);
  s.key('Enter');s.key('End');s.key('Enter');assert.equal(s.native.value,'kaluga');
});
test('Escape cancels navigation without closing modal, Tab and outside pointer dismiss',()=>{
  const s=scene();s.key('Enter');s.key('ArrowDown');const escape=s.key('Escape');
  assert.equal(escape.stopped,true);assert.equal(s.native.value,'');assert.equal(s.list.hidden,true);
  s.key('Enter');s.key('Tab');assert.equal(s.list.hidden,true);
  s.key('Enter');s.document.handlers.pointerdown({target:{}});assert.equal(s.list.hidden,true);
});
test('branch picker supports Russian typeahead and required-field focus recovery',()=>{
  const s=scene();s.native.handlers.invalid({preventDefault(){}});
  assert.equal(s.control.focused,true);assert.equal(s.control.attrs['aria-invalid'],'true');
  s.key('к');s.key('Enter');assert.equal(s.native.value,'kaluga');
  assert.equal(s.control.attrs['aria-invalid'],undefined);
});
