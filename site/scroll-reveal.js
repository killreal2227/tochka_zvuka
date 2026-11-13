/* Repeat only existing landing reveals; form and legal content are excluded. */
(() => {
 'use strict';
 if(document.body.classList.contains('documents-page'))return;
 const selector='main .rv:not(.card),main .step > .n,main .step > h3,main .step > p,main .path h3,main .path p,.hero h1,.hero .hero-copy,.hero-actions';
 const elements=[...document.querySelectorAll(selector)];
 if(!elements.length)return;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 const states=new Map(elements.map(element=>[element,{entry:null,timer:null}]));
 function show(element,visible){
  element.classList.toggle('is-revealed',visible);
  element.classList.toggle('in',visible);
 }
 function cancel(state){if(state.timer!==null){clearTimeout(state.timer);state.timer=null;}}
 function focused(element){return element.contains(document.activeElement);}
 function hideLater(element,state){
  cancel(state);
  element.style.setProperty('--reveal-offset',state.entry?.boundingClientRect.bottom<=0?'-20px':'20px');
  state.timer=setTimeout(()=>{
   state.timer=null;
   if(!reduced.matches&&!state.entry?.isIntersecting&&!focused(element))show(element,false);
  },100);
 }
 elements.forEach(element=>{element.classList.add('scroll-reveal');show(element,reduced.matches||!('IntersectionObserver' in window));});
 if(!('IntersectionObserver' in window))return;
 document.body.classList.toggle('reveal-enabled',!reduced.matches);
 const observer=new IntersectionObserver(entries=>{
  for(const entry of entries){
   const element=entry.target,state=states.get(element);
   state.entry=entry;cancel(state);
   if(reduced.matches||focused(element)){show(element,true);continue;}
   const enough=entry.intersectionRatio>=.14||entry.intersectionRect.height>=72;
   if(entry.isIntersecting&&enough)show(element,true);
   else if(!entry.isIntersecting)hideLater(element,state);
  }
 },{threshold:[0,.14],rootMargin:'0px'});
 elements.forEach(element=>observer.observe(element));
 document.addEventListener('focusin',()=>{
  for(const [element,state] of states)if(focused(element)){cancel(state);show(element,true);}
 });
 document.addEventListener('focusout',()=>{
  for(const [element,state] of states)if(state.entry&&!state.entry.isIntersecting)hideLater(element,state);
 });
 reduced.addEventListener('change',()=>{
  document.body.classList.toggle('reveal-enabled',!reduced.matches);
  for(const [element,state] of states){
   cancel(state);
   show(element,reduced.matches||focused(element)||!state.entry||state.entry.isIntersecting);
  }
 });
})();
