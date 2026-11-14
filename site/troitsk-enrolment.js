/* Measure natural descriptions and the rendered CTA, independently of open state. */
(() => {
 const cards=[...document.querySelectorAll('#dirs .card')],headerAction=document.querySelector('#top .header-enrol');let frame=0;
 function measure(){frame=0;if(headerAction)document.body.style.setProperty('--header-action-size',headerAction.getBoundingClientRect().height+'px');cards.forEach(card=>{
  const action=card.querySelector('.direction-signup');
  if(action){const rect=action.getBoundingClientRect();card.style.setProperty('--direction-action-width',rect.width+'px');card.style.setProperty('--direction-action-height',rect.height+'px');}
  card.style.setProperty('--description-rise',Math.ceil(card.querySelector('.desc').getBoundingClientRect().height+8)+'px');
 });}
 function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
 if('ResizeObserver' in window){const observer=new ResizeObserver(schedule);if(headerAction)observer.observe(headerAction);cards.forEach(card=>{observer.observe(card);const action=card.querySelector('.direction-signup');if(action)observer.observe(action);});}
 window.addEventListener('resize',schedule,{passive:true});window.visualViewport?.addEventListener('resize',schedule,{passive:true});document.fonts?.ready.then(schedule);schedule();
})();

/* Give the two final mobile sections the taller natural content height, or one screen. */
(() => {
 if(!document.body.dataset.city)return;
 const modules=['how','join'].map(id=>document.getElementById(id));
 if(modules.some(section=>!section))return;
 const mobile=matchMedia('(max-width:1000px)');
 let frame=0,lastLayoutWidth=-1;
 function measure(){
  frame=0;
  // Safari toolbar motion resizes height while scrolling. Do not collapse/re-measure
  // live sections for those events: scroll anchoring otherwise moves the page.
  const viewport=window.visualViewport;
  const layoutWidth=Math.round(viewport?viewport.width*viewport.scale:window.innerWidth);
  if(layoutWidth===lastLayoutWidth)return;
  lastLayoutWidth=layoutWidth;
  const body=document.body;
  if(!mobile.matches){
   body.style.removeProperty('--mobile-module-natural');
   body.style.removeProperty('--mobile-module-header');
   return;
  }
  body.style.setProperty('--mobile-module-header',document.getElementById('top').getBoundingClientRect().height+'px');
  const previous=modules.map(section=>section.style.minHeight);
  modules.forEach(section=>section.style.minHeight='0px');
  // Keep the already agreed section height when tablet content is rearranged.
  body.classList.add('measure-module-baseline');
  const baseline=Math.max(...modules.map(section=>section.getBoundingClientRect().height));
  body.classList.remove('measure-module-baseline');
  // The illustration fits the free row; only text can demand extra module height.
  body.classList.add('measure-module-content');
  const contentHeight=Math.max(...modules.map(section=>section.getBoundingClientRect().height));
  body.classList.remove('measure-module-content');
  const natural=Math.ceil(Math.max(baseline,contentHeight));
  body.style.setProperty('--mobile-module-natural',natural+'px');
  modules.forEach((section,i)=>section.style.minHeight=previous[i]);
  window.dispatchEvent(new CustomEvent('tz:module-layout'));
 }
 function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
 window.addEventListener('resize',schedule,{passive:true});
 document.fonts?.ready.then(()=>{lastLayoutWidth=-1;schedule();});
 schedule();
})();
