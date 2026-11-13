/* Direction effects run only on a deliberate hover, focus or preview tap. No scroll autoplay. */
(() => {
  'use strict';
  window.createDirectionInteractions=({ready,prepare})=>{
    const grid=document.querySelector('#dirs .grid');if(!grid)return;
    const cards=[...grid.querySelectorAll('.card[data-dir]')],modal=document.getElementById('leadModal');
    const fine=matchMedia('(hover:hover) and (pointer:fine)'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
    if(grid.dataset?.interaction==='disclosure'){
      let active=null,expandedCard=null;
      const player=window.createDirectionPlayer({ready,prepare,
        eligible:card=>card===active&&card.classList.contains('is-expanded'),
        reduced:()=>reduced.matches,blocked:()=>document.hidden||!modal.hidden});
      const stop=()=>{player.stop();active=null;cards.forEach(card=>card.classList.remove('is-active'));};
      cards.forEach(card=>{
        const toggle=card.querySelector('.direction-toggle'),signup=card.querySelector('.direction-signup');
        signup.setAttribute('aria-label','Записаться: '+card.querySelector('.name').textContent);
        const setExpanded=(target,expanded)=>{
          target.querySelector('.direction-toggle').setAttribute('aria-expanded',String(expanded));
          target.classList.toggle('is-expanded',expanded);
          const action=target.querySelector('.direction-signup');
          action.inert=!expanded;action.setAttribute('aria-hidden',String(!expanded));
        };
        toggle.addEventListener('click',()=>{
          const opening=expandedCard!==card;
          stop();
          if(expandedCard)setExpanded(expandedCard,false);
          expandedCard=opening?card:null;
          if(opening){setExpanded(card,true);active=card;card.classList.add('is-active');player.request(card);
            document.dispatchEvent(new CustomEvent('tz:direction-preview',{detail:{card}}));
          }
        });
      });
      document.addEventListener('tz:lead-open',stop);
      document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
      reduced.addEventListener('change',stop);
      window.addEventListener('scroll',()=>{
        if(!active)return;
        const r=active.getBoundingClientRect(),top=document.querySelector('#top')?.getBoundingClientRect().bottom||0;
        if(r.bottom<=top||r.top>=window.innerHeight)stop();
      },{passive:true});
      return;
    }

    const previews=!!document.body?.dataset.city;let active=null,preview=null;
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
        const card=event.detail?.card;if(!cards.includes(card)||preview===card)return;
        clearPreview();preview=card;card.classList.add('is-preview');card.setAttribute('aria-expanded','true');
        card.setAttribute('aria-label',card.querySelector('.name').textContent+' — нажмите на стрелку, чтобы записаться');select(card,true);
      });
      window.addEventListener('scroll',()=>{
        if(!preview)return;
        const r=preview.getBoundingClientRect(),header=document.querySelector('#top');
        const top=header?.getBoundingClientRect().bottom||0;
        if(r.bottom<=top||r.top>=window.innerHeight)stop();
      },{passive:true});
    }
    cards.forEach(card=>{
      card.addEventListener('pointerenter',event=>{
        if(Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)){
          const r=card.getBoundingClientRect();
          if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)return;
        }
        if(!preview&&fine.matches&&event.pointerType!=='touch')select(card);
      });
      const leave=()=>{if(active===card&&!preview)select(null);};
      card.addEventListener('pointerleave',leave);card.addEventListener('pointercancel',leave);
      card.addEventListener('focusin',()=>{if(!preview&&fine.matches&&card.matches(':focus-visible'))select(card);});
      card.addEventListener('focusout',leave);
    });
    document.addEventListener('tz:lead-open',stop);
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stop();});
    let viewportWidth=window.innerWidth;
    window.addEventListener('resize',()=>{if(window.innerWidth!==viewportWidth){viewportWidth=window.innerWidth;stop();}},{passive:true});
    [fine,reduced].forEach(query=>query.addEventListener('change',stop));
  };
})();
