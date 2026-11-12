/* One invitation per page visit, with one owner for the mobile signup button. */
(() => {
 'use strict';
 const box=document.getElementById('lessonNudge'),modal=document.getElementById('leadModal');
 if(!box)return;
 const sticky=document.getElementById('stick');
 const hero=document.querySelector('.hero-actions .openForm'),join=document.querySelector('#join');
 const mobile=window.matchMedia?.('(max-width:700px), (max-height:500px) and (pointer:coarse)');
 let eligible=false,consumed=false,passed=false,nearJoin=false,frame=0;
 function sync(){
  if(!sticky||!mobile)return;
  const show=mobile.matches&&passed&&!nearJoin&&modal?.hidden&&box.hidden;
  sticky.classList.toggle('show',show);sticky.inert=!show;sticky.setAttribute('aria-hidden',String(!show));
 }
 function close(restore=false){
  const inside=box.contains(document.activeElement);box.hidden=true;sync();
  if(restore&&inside)document.querySelector('.top .openForm')?.focus({preventScroll:true});
 }
 function maybeShow(){
  if(nearJoin){close();return;}
  if(!eligible||consumed||document.hidden||!modal?.hidden)return;
  if(window.scrollY<Math.min(window.innerHeight*.5,300))return;
  consumed=true;box.hidden=false;sync();
 }
 box.querySelector('.lesson-nudge-close').addEventListener('click',()=>close(true));
 document.addEventListener('keydown',e=>{if(!box.hidden&&e.key==='Escape'){e.preventDefault();close(true);}});
 document.addEventListener('pointerdown',e=>{if(!box.hidden&&!box.contains(e.target))close();});
 document.addEventListener('tz:lead-open',()=>{consumed=true;close();});
 document.addEventListener('tz:lead-close',sync);
 document.addEventListener('visibilitychange',()=>{if(document.hidden)close();else maybeShow();});
 function update(){frame=0;
  {
   passed=!!hero&&hero.getBoundingClientRect().bottom<=0;
   nearJoin=!!join&&join.getBoundingClientRect().top<=window.innerHeight+100;
  }
  maybeShow();sync();
 }
 const schedule=()=>{if(!frame)frame=requestAnimationFrame(update);};
 window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});
 if('IntersectionObserver' in window){
  if(hero)new window.IntersectionObserver(entries=>{const e=entries.at(-1);passed=e.boundingClientRect.bottom<=0&&!e.isIntersecting;sync();},{threshold:0}).observe(hero);
  if(join)new window.IntersectionObserver(entries=>{const e=entries.at(-1);nearJoin=e.boundingClientRect.top<=window.innerHeight+100;maybeShow();sync();},{rootMargin:'0px 0px 100px 0px',threshold:0}).observe(join);
 }
 mobile?.addEventListener('change',sync);window.setTimeout(()=>{eligible=true;maybeShow();},12000);sync();
})();
