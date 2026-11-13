/* Modal geometry and scroll ownership only. Field values and submission stay in lead-form.js. */
(() => {
 'use strict';
 const modal=document.getElementById('leadModal');
 if(!modal)return;
 const sheet=modal.querySelector('.lead-sheet'),scroller=modal.querySelector('.sheet-body');
 const form=document.getElementById('leadForm'),close=modal.querySelector('.lead-close'),root=document.documentElement;
 if(!sheet||!scroller||!form||!close)return;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 let lock=null,frame=0,focusFrame=0,unlockTimer=null,keyboard=false,touchY=0,touchHost=null;
 const viewport=()=>{const v=window.visualViewport;return {height:v?.height||window.innerHeight,width:v?.width||window.innerWidth,top:v?.offsetTop||0,left:v?.offsetLeft||0};};
 const save=(element,names)=>names.map(name=>[name,element.style.getPropertyValue(name),element.style.getPropertyPriority(name)]);
 const restore=(element,values)=>values.forEach(([name,value,priority])=>{if(value)element.style.setProperty(name,value,priority);else element.style.removeProperty(name);});
 const textField=()=>form.contains(document.activeElement)&&document.activeElement.matches('input:not([type="radio"]):not([type="checkbox"]),textarea,select')?document.activeElement:null;
 function lockPage(){
  if(lock)return;
  const body=document.body,rect=body.getBoundingClientRect(),v=viewport();
  const frames=[...document.querySelectorAll('main > section,.home-gateway,.intro-panel,.city-choice')].map(element=>({
   element,height:element.getBoundingClientRect().height,values:save(element,['--lead-frame-height']),hadClass:element.classList.contains('lead-page-frame')
  }));
  lock={x:window.scrollX,y:window.scrollY,height:v.height,width:v.width,
   body:save(body,['position','top','left','width','height','overflow']),
   root:save(root,['overflow','min-height','scroll-behavior']),hadClass:root.classList.contains('lead-scroll-locked'),frames};
  const pageHeight=Math.max(root.scrollHeight,body.scrollHeight,rect.height);
  root.style.setProperty('min-height',pageHeight+'px');root.style.setProperty('overflow','hidden');root.style.setProperty('scroll-behavior','auto');
  body.style.setProperty('position','fixed');body.style.setProperty('top',-lock.y+'px');body.style.setProperty('left',-lock.x+'px');
  body.style.setProperty('width',rect.width+'px');body.style.setProperty('height',rect.height+'px');body.style.setProperty('overflow','hidden');
  frames.forEach(({element,height})=>{element.style.setProperty('--lead-frame-height',height+'px');element.classList.add('lead-page-frame');});
  root.classList.add('lead-scroll-locked');
 }
 function unlockPage(){
  clearTimeout(unlockTimer);unlockTimer=null;
  if(!lock)return;
  const saved=lock;lock=null;keyboard=false;
  saved.frames.forEach(({element,values,hadClass})=>{restore(element,values);element.classList.toggle('lead-page-frame',hadClass);});
  restore(document.body,saved.body);
  // Restore scrolling instantly even when the site normally uses smooth anchor navigation.
  restore(root,saved.root.filter(([name])=>name!=='scroll-behavior'));
  root.classList.toggle('lead-scroll-locked',saved.hadClass);
  root.style.setProperty('scroll-behavior','auto');window.scrollTo(saved.x,saved.y);
  restore(root,saved.root.filter(([name])=>name==='scroll-behavior'));
  window.dispatchEvent(new Event('resize'));
  // Focus restoration and viewport reflow can apply native scroll anchoring after unlock.
  requestAnimationFrame(()=>{if(lock||!modal.hidden)return;root.style.setProperty('scroll-behavior','auto');window.scrollTo(saved.x,saved.y);restore(root,saved.root.filter(([name])=>name==='scroll-behavior'));});
 }
 function revealField(smooth=false){
  if(modal.hidden)return;
  const field=textField();if(!field)return;
  const box=scroller.getBoundingClientRect(),input=field.getBoundingClientRect(),cross=close.getBoundingClientRect();
  const unit=parseFloat(getComputedStyle(modal).getPropertyValue('--form-scale'))||1;
  const top=Math.max(box.top+8*unit,cross.bottom+8*unit),bottom=box.bottom-12*unit;
  let delta=0;
  if(input.bottom>bottom)delta=input.bottom-bottom;
  else if(input.top<top)delta=input.top-top;
  if(Math.abs(delta)<1)return;
  const target=Math.max(0,Math.min(scroller.scrollHeight-scroller.clientHeight,scroller.scrollTop+delta));
  scroller.scrollTo({top:target,behavior:smooth&&!reduced.matches?'smooth':'auto'});
 }
 function update(){
  frame=0;
  if(!lock)return;
  const v=viewport();
  if(modal.hidden){
   if(v.height>=lock.height*.9)unlockPage();
   return;
  }
  if(v.height<lock.height*.8&&textField())keyboard=true;
  else if(v.height>=lock.height*.9)keyboard=false;
  modal.style.setProperty('--form-viewport-height',v.height+'px');
  modal.style.setProperty('--form-viewport-width',v.width+'px');
  modal.style.setProperty('--form-viewport-top',v.top+'px');
  modal.style.setProperty('--form-viewport-left',v.left+'px');
  revealField();
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(update);}
 function focusField(){
  schedule();if(focusFrame)cancelAnimationFrame(focusFrame);
  focusFrame=requestAnimationFrame(()=>{focusFrame=0;revealField(true);});
 }
 function open(){
  clearTimeout(unlockTimer);unlockTimer=null;
  lockPage();modal.classList.add('viewport-managed');
  sheet.style.zoom='';sheet.style.width='';sheet.style.maxWidth='';sheet.style.maxHeight='';
  scroller.scrollTop=0;update();
 }
 function closed(){
  if(frame)cancelAnimationFrame(frame);frame=0;
  if(focusFrame)cancelAnimationFrame(focusFrame);focusFrame=0;
  const field=textField();
  if(field){if(lock&&viewport().height<lock.height*.8)keyboard=true;field.blur();}
  if(keyboard&&lock&&viewport().height<lock.height*.9){
   // Keep the background still while iOS dismisses its keyboard.
   unlockTimer=setTimeout(unlockPage,450);
  }else unlockPage();
 }
 function findHost(target){
  if(!scroller.contains(target))return null;
  for(let node=target;node&&node!==scroller;node=node.parentElement){
   if(node.scrollHeight>node.clientHeight+1&&/auto|scroll/.test(getComputedStyle(node).overflowY))return node;
  }
  return scroller;
 }
 function blocks(host,delta){
  if(!host)return true;
  if(host.scrollHeight<=host.clientHeight+1)return true;
  return delta<0&&host.scrollTop<=0||delta>0&&host.scrollTop>=host.scrollHeight-host.clientHeight-1;
 }
 document.addEventListener('touchstart',event=>{
  if(!lock||event.touches.length!==1)return;
  touchY=event.touches[0].clientY;touchHost=modal.hidden?null:findHost(event.target);
 },{passive:true});
 document.addEventListener('touchmove',event=>{
  if(!lock||!event.cancelable||event.touches.length!==1)return;
  const y=event.touches[0].clientY,delta=touchY-y;touchY=y;
  if(blocks(touchHost,delta))event.preventDefault();
 },{passive:false});
 document.addEventListener('wheel',event=>{
  if(lock&&event.cancelable&&blocks(modal.hidden?null:findHost(event.target),event.deltaY))event.preventDefault();
 },{passive:false});
 document.addEventListener('tz:lead-open',open);
 document.addEventListener('tz:lead-close',closed);
 document.addEventListener('tz:lead-layout',schedule);
 document.addEventListener('tz:lead-success',()=>{scroller.scrollTop=0;schedule();});
 sheet.addEventListener('focusin',focusField);
 sheet.addEventListener('focusout',()=>queueMicrotask(schedule));
 form.addEventListener('input',schedule);form.addEventListener('change',schedule);
 window.addEventListener('resize',schedule,{passive:true});
 window.visualViewport?.addEventListener('resize',schedule,{passive:true});
 window.visualViewport?.addEventListener('scroll',schedule,{passive:true});
 if(window.ResizeObserver)new ResizeObserver(schedule).observe(scroller);
})();
