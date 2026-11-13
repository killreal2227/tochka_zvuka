/* Measure natural descriptions and the rendered CTA, independently of open state. */
(() => {
 const cards=[...document.querySelectorAll('#dirs .card')];let frame=0;
 function measure(){frame=0;cards.forEach(card=>{
  const action=card.querySelector('.direction-signup');
  if(action){const rect=action.getBoundingClientRect();card.style.setProperty('--direction-action-width',rect.width+'px');card.style.setProperty('--direction-action-height',rect.height+'px');}
  card.style.setProperty('--description-rise',Math.ceil(card.querySelector('.desc').getBoundingClientRect().height+8)+'px');
 });}
 function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
 if('ResizeObserver' in window){const observer=new ResizeObserver(schedule);cards.forEach(card=>{observer.observe(card);const action=card.querySelector('.direction-signup');if(action)observer.observe(action);});}
 window.addEventListener('resize',schedule,{passive:true});window.visualViewport?.addEventListener('resize',schedule,{passive:true});document.fonts?.ready.then(schedule);schedule();
})();
