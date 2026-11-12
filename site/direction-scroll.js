/* Direction effects run only on a deliberate hover, focus or preview tap. No scroll autoplay. */
(() => {
  'use strict';
  window.createDirectionInteractions=({ready,prepare})=>{
    const grid=document.querySelector('#dirs .grid');if(!grid)return;
    const cards=[...grid.querySelectorAll('.card[data-dir]')],modal=document.getElementById('leadModal');
    const fine=matchMedia('(hover:hover) and (pointer:fine)'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const previews=document.body?.dataset.city==='troitsk';let active=null,preview=null;
    const player=window.createDirectionPlayer({ready,prepare,eligible:card=>card===active,
      reduced:()=>reduced.matches,blocked:()=>document.hidden||!modal.hidden});
    function select(card,restart=false){
      if(card===active&&!restart)return;player.stop();active=card;
      cards.forEach(item=>item.classList.toggle('is-active',item===card));
      if(card)player.request(card);
    }
    function clearPreview(){
      if(previews)cards.forEach(card=>{card.classList.remove('is-preview');card.setAttribute('aria-expanded','false');card.removeAttribute('aria-label');});preview=null;
    }
    function stop(){clearPreview();select(null);}
    if(previews){
      cards.forEach(card=>{const desc=card.querySelector('.desc');desc.id='direction-description-'+card.dataset.dir;card.setAttribute('aria-controls',desc.id);card.setAttribute('aria-expanded','false');});
      document.addEventListener('tz:direction-preview',event=>{
        const card=event.detail?.card;if(!cards.includes(card))return;
        clearPreview();preview=card;card.classList.add('is-preview');card.setAttribute('aria-expanded','true');
        card.setAttribute('aria-label',card.querySelector('.name').textContent+' — нажмите ещё раз, чтобы записаться');select(card,true);
      });
      document.addEventListener('pointerdown',event=>{if(preview&&!preview.contains(event.target)&&!modal.contains(event.target))stop();});
    }
    cards.forEach(card=>{
      card.addEventListener('pointerenter',event=>{if(fine.matches&&event.pointerType!=='touch')select(card);});
      const leave=()=>{if(active===card&&!preview)select(null);};
      card.addEventListener('pointerleave',leave);card.addEventListener('pointercancel',leave);
      card.addEventListener('focusin',()=>{if(fine.matches)select(card);});
      card.addEventListener('focusout',leave);
    });
    document.addEventListener('tz:lead-open',stop);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
    let viewportWidth=window.innerWidth;
    window.addEventListener('resize',()=>{if(window.innerWidth!==viewportWidth){viewportWidth=window.innerWidth;stop();}},{passive:true});
    [fine,reduced].forEach(query=>query.addEventListener('change',stop));
  };
})();
