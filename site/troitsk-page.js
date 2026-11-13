/* Troitsk: a single, dismissible invitation. */
(() => {
 'use strict';
 if(!document.body.dataset.city)return;
 const directionLink=document.querySelector('.hero-actions .link[href="#dirs"]');
 directionLink?.addEventListener?.('click',async event=>{
  event.preventDefault();
  if(document.fonts?.ready)await document.fonts.ready;
  const heading=document.querySelector('#dirs .kicker'),header=document.getElementById('top');
  if(!heading)return;
  const scale=window.visualViewport?.scale||1;
  const top=Math.max(0,window.scrollY+heading.getBoundingClientRect().top-(header?.getBoundingClientRect().bottom||0)-22/scale);
  window.scrollTo({top,behavior:window.matchMedia?.('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
 });
 const box=document.getElementById('lessonNudge'),modal=document.getElementById('leadModal');
 if(!box)return;
 const key='tz:'+document.body.dataset.city+':invitation-dismissed-until',week=7*24*60*60*1000;
 let ready=false,shown=false,blocked=false;
 const read=()=>{try{return Number(window.localStorage.getItem(key))||0;}catch{return 0;}};
 function hide(){box.hidden=true;}
 function dismiss(restore=false){
  const focused=box.contains(document.activeElement);blocked=true;hide();
  try{window.localStorage.setItem(key,String(Date.now()+week));}catch{}
  if(restore&&focused)document.querySelector('#top .openForm')?.focus({preventScroll:true});
 }
 function update(){
  const viewport=window.visualViewport;
  const keyboard=!!document.activeElement?.matches?.('input,textarea,select,[contenteditable="true"]')||
   !!viewport&&viewport.height*viewport.scale<window.innerHeight*viewport.scale*.72;
  if(keyboard||document.hidden||!modal?.hidden){hide();return;}
  if(!ready||shown||blocked||read()>Date.now())return;
  shown=true;box.hidden=false;
 }
 box.querySelector('.lesson-nudge-close').addEventListener('click',()=>dismiss(true));
 box.addEventListener('keydown',e=>{if(e.key==='Escape'){e.preventDefault();dismiss(true);}});
 document.addEventListener('tz:lead-open',()=>{blocked=true;hide();});
 document.addEventListener('tz:lead-success',()=>dismiss());
 const engaging=event=>{if(event.target?.closest?.('#dirs .card')){blocked=true;hide();}};
 document.addEventListener('pointerdown',engaging,{passive:true});
 document.addEventListener('pointerover',engaging,{passive:true});
 document.addEventListener('focusin',engaging);
 document.addEventListener('tz:direction-preview',()=>{blocked=true;hide();});
 document.addEventListener('focusin',update);
 document.addEventListener('visibilitychange',update);
 window.visualViewport?.addEventListener('resize',update,{passive:true});
 window.addEventListener('storage',e=>{if(e.key===key&&read()>Date.now()){blocked=true;hide();}});
 window.setTimeout(()=>{ready=true;update();},18000);
})();
