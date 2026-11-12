/* Two invitations at most: early, then a delayed reminder in the middle of the page. */
(() => {
 'use strict';
 const box=document.getElementById('lessonNudge'),modal=document.getElementById('leadModal');
 if(!box)return;
 const join=document.querySelector('#join');
 let eligible=false,disabled=false,nearJoin=false,frame=0,shown=0,repeatReady=false,repeatScheduled=false;
 function close(restore=false){
  const wasVisible=!box.hidden,inside=box.contains(document.activeElement);box.hidden=true;
  if(wasVisible&&shown===1&&!repeatScheduled&&!disabled){
   repeatScheduled=true;
   window.setTimeout(()=>{repeatReady=true;update();},25000+Math.floor(Math.random()*10001));
  }
  if(restore&&inside)document.querySelector('.top .openForm')?.focus({preventScroll:true});
 }
 function maybeShow(){
  if(nearJoin)return;
  if(!eligible||disabled||!box.hidden||shown>=2||document.hidden||!modal?.hidden)return;
  if(shown===1){
   const range=(document.documentElement?.scrollHeight||0)-window.innerHeight;
   const progress=range>0?window.scrollY/range:0;
   if(!repeatReady||progress<.35||progress>.7)return;
  }
  shown++;box.hidden=false;
 }
 box.querySelector('.lesson-nudge-close').addEventListener('click',()=>close(true));
 document.addEventListener('tz:lead-open',()=>{disabled=true;close();});
 document.addEventListener('visibilitychange',()=>{if(!document.hidden)update();});
 function update(){frame=0;
  nearJoin=!!join&&join.getBoundingClientRect().top<=window.innerHeight+100;
  maybeShow();
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});
 if(join&&'IntersectionObserver' in window){
  new window.IntersectionObserver(entries=>{const e=entries.at(-1);nearJoin=e.boundingClientRect.top<=window.innerHeight+100;maybeShow();},{rootMargin:'0px 0px 100px 0px',threshold:0}).observe(join);
 }
 window.setTimeout(()=>{eligible=true;update();},4000);
})();
