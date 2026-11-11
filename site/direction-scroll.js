/* Ordinary cards: mouse hover on desktop, a one-time visible-card effect on touch. */
(() => {
  'use strict';
  window.createDirectionInteractions=({ready,prepare})=>{
    const grid=document.querySelector('#dirs .grid');if(!grid)return;
    const cards=[...grid.querySelectorAll('.card[data-dir]')],modal=document.getElementById('leadModal');
    const fine=matchMedia('(hover:hover) and (pointer:fine)'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const played=new WeakSet();let active=null,manual=null,frame=0,lastRow=null,lastIndex=-1;
    const player=window.createDirectionPlayer({ready,
      prepare:card=>{if(!fine.matches)played.add(card);return prepare(card);},
      eligible:card=>card===active&&(fine.matches||!played.has(card)),
      reduced:()=>reduced.matches,blocked:()=>document.hidden||!modal.hidden});
    function select(card){
      if(card===active)return;player.stop();active=card;
      cards.forEach(item=>item.classList.toggle('is-active',item===card));
      if(card)player.request(card);
    }
    function update(){
      frame=0;
      if(document.hidden||!modal.hidden){manual=null;select(null);return;}
      if(fine.matches){select(manual);return;}
      const rows=new Map();
      cards.forEach(card=>{
        const rect=card.getBoundingClientRect(),key=card.offsetTop;
        if(!rows.has(key))rows.set(key,{key,top:rect.top,bottom:rect.bottom,cards:[]});
        const row=rows.get(key);row.bottom=Math.max(row.bottom,rect.bottom);row.cards.push(card);
      });
      let winner=null,distance=Infinity;
      rows.forEach(row=>{
        if(row.bottom<=innerHeight*.15||row.top>=innerHeight*.85)return;
        const d=Math.abs((row.top+row.bottom)/2-innerHeight*.5);
        if(d<distance){winner=row;distance=d;}
      });
      if(!winner){lastRow=null;lastIndex=-1;select(null);return;}
      if(winner.key!==lastRow){lastRow=winner.key;lastIndex=-1;}
      const progress=(innerHeight*.85-winner.top)/(Math.min(winner.bottom-winner.top,innerHeight*.6)+innerHeight*.25);
      lastIndex=window.getDirectionScrollIndex(progress,winner.cards.length,lastIndex);
      select(winner.cards[lastIndex]);
    }
    function schedule(){if(!frame)frame=requestAnimationFrame(update);}
    cards.forEach(card=>{
      card.addEventListener('pointerenter',event=>{if(!fine.matches||event.pointerType==='touch')return;manual=card;select(card);});
      const leave=()=>{if(manual===card){manual=null;schedule();}};
      card.addEventListener('pointerleave',leave);card.addEventListener('pointercancel',leave);
      card.addEventListener('focusin',()=>{manual=card;select(card);});
      card.addEventListener('focusout',()=>{manual=null;schedule();});
    });
    window.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule,{passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden){manual=null;select(null);}schedule();});
    document.addEventListener('tz:lead-open',()=>{manual=null;select(null);});
    document.addEventListener('tz:lead-close',schedule);
    fine.addEventListener('change',()=>{manual=null;select(null);schedule();});
    reduced.addEventListener('change',()=>{player.stop();schedule();});
    schedule();
  };
})();
