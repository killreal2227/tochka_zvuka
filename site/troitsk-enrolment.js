/* Preserve the established form and artwork; only measure layout and mobile affordances. */
(() => {
  'use strict';
  const hero=document.querySelector('.hero-actions .openForm'),sticky=document.getElementById('stick'),modal=document.getElementById('leadModal');
  const mobile=matchMedia('(max-width:700px)');let passed=false,frame=0;
  const syncSticky=()=>{
    const show=mobile.matches&&passed&&modal.hidden;
    sticky.classList.toggle('show',show);sticky.inert=!show;sticky.setAttribute('aria-hidden',String(!show));
  };
  if('IntersectionObserver' in window)new IntersectionObserver(entries=>{
    const entry=entries.at(-1);passed=entry.boundingClientRect.bottom<=0&&!entry.isIntersecting;syncSticky();
  },{threshold:0}).observe(hero);
  function measure(){
    frame=0;
    document.querySelectorAll('#dirs .card').forEach(card=>{
      const description=card.querySelector('.desc');
      card.style.setProperty('--description-rise',Math.ceil(description.getBoundingClientRect().height+8)+'px');
    });
    if(!('IntersectionObserver' in window)){passed=hero.getBoundingClientRect().bottom<=0;syncSticky();}
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
  window.addEventListener('resize',()=>{schedule();syncSticky();},{passive:true});
  if(!('IntersectionObserver' in window))window.addEventListener('scroll',schedule,{passive:true});
  document.addEventListener('tz:lead-open',syncSticky);document.addEventListener('tz:lead-close',syncSticky);mobile.addEventListener('change',syncSticky);
  const sheet=modal.querySelector('.lead-sheet');
  const focused=()=>sheet.classList.toggle('field-focused',sheet.contains(document.activeElement)&&document.activeElement.matches('input:not([type="radio"])'));
  sheet.addEventListener('focusin',focused);sheet.addEventListener('focusout',()=>queueMicrotask(focused));
  document.fonts?.ready.then(schedule);syncSticky();schedule();
})();
