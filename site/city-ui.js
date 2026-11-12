/* One invitation per page visit, after four seconds without requiring a scroll. */
(() => {
 'use strict';
 const box=document.getElementById('lessonNudge'),modal=document.getElementById('leadModal');
 if(!box)return;
 const join=document.querySelector('#join');
 let eligible=false,consumed=false,nearJoin=false,frame=0;
 function close(restore=false){
  const inside=box.contains(document.activeElement);box.hidden=true;
  if(restore&&inside)document.querySelector('.top .openForm')?.focus({preventScroll:true});
 }
 function maybeShow(){
  if(nearJoin){close();return;}
  if(!eligible||consumed||document.hidden||!modal?.hidden)return;
  consumed=true;box.hidden=false;
 }
 box.querySelector('.lesson-nudge-close').addEventListener('click',()=>close(true));
 document.addEventListener('keydown',e=>{if(!box.hidden&&e.key==='Escape'){e.preventDefault();close(true);}});
 document.addEventListener('pointerdown',e=>{if(!box.hidden&&!box.contains(e.target))close();});
 document.addEventListener('tz:lead-open',()=>{consumed=true;close();});
 document.addEventListener('visibilitychange',()=>{if(document.hidden)close();else update();});
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
