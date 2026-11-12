/* Measure descriptions without changing card geometry on hover. */
(() => {
  let frame=0;
  function measure(){frame=0;document.querySelectorAll('#dirs .card').forEach(card=>{
    card.style.setProperty('--description-rise',Math.ceil(card.querySelector('.desc').getBoundingClientRect().height+8)+'px');
  });}
  function schedule(){if(!frame)frame=requestAnimationFrame(measure);}
  window.addEventListener('resize',schedule,{passive:true});document.fonts?.ready.then(schedule);schedule();
})();
