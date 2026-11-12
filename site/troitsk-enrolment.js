/* One enrolment action and one moving touch card. No persistence or dependencies. */
(() => {
  'use strict';
  const hero=document.querySelector('.hero-actions .openForm'),sticky=document.getElementById('stick'),modal=document.getElementById('leadModal');
  const mobile=matchMedia('(max-width:700px)'),fine=matchMedia('(hover:hover) and (pointer:fine)'),reduce=matchMedia('(prefers-reduced-motion:reduce)');
  let passed=false,frame=0,moving=null;
  const cards=[...document.querySelectorAll('#dirs .card')];
  function syncSticky(){
    const show=mobile.matches&&passed&&modal.hidden;
    sticky.classList.toggle('show',show);sticky.inert=!show;sticky.setAttribute('aria-hidden',String(!show));
  }
  if('IntersectionObserver' in window)new IntersectionObserver(entries=>{
    const entry=entries.at(-1);passed=entry.boundingClientRect.bottom<=0&&!entry.isIntersecting;syncSticky();
  },{threshold:0}).observe(hero);
  function update(){
    frame=0;
    if(!('IntersectionObserver' in window)){passed=hero.getBoundingClientRect().bottom<=0;syncSticky();}
    let nearest=null,distance=Infinity;
    if(!fine.matches&&!reduce.matches&&modal.hidden&&!document.hidden){
      const header=Math.max(0,document.querySelector('.top').getBoundingClientRect().bottom);
      cards.forEach(card=>{const r=card.getBoundingClientRect();
        if(r.bottom<=header||r.top>=innerHeight||r.right<=0||r.left>=innerWidth)return;
        const d=((r.left+r.right)/2-innerWidth/2)**2+((r.top+r.bottom)/2-innerHeight/2)**2;
        if(d<distance){distance=d;nearest=card;}
      });
    }
    if(nearest!==moving){moving?.classList.remove('is-motion');moving=nearest;moving?.classList.add('is-motion');}
  }
  function schedule(){if(!frame)frame=requestAnimationFrame(update);}
  window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',()=>{syncSticky();schedule();},{passive:true});
  document.addEventListener('tz:lead-open',()=>{syncSticky();schedule();});document.addEventListener('tz:lead-close',()=>{syncSticky();schedule();});
  document.addEventListener('visibilitychange',schedule);
  [mobile,fine,reduce].forEach(q=>q.addEventListener('change',()=>{syncSticky();schedule();}));
  const sheet=modal.querySelector('.lead-sheet');
  const focused=()=>sheet.classList.toggle('field-focused',sheet.contains(document.activeElement)&&document.activeElement.matches('input:not([type="radio"])'));
  sheet.addEventListener('focusin',focused);sheet.addEventListener('focusout',()=>queueMicrotask(focused));
  syncSticky();schedule();
})();
