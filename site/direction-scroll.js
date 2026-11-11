/* Native sticky rows. Scroll distance selects cards; the page is never locked or repositioned. */
(() => {
  'use strict';
  window.createStickyDirections=({ready,prepare})=>{
    const grid=document.querySelector('#dirs .grid');
    if(!grid)return;
    const cards=[...grid.querySelectorAll('.card[data-dir]')];
    const modal=document.getElementById('leadModal'),header=document.querySelector('.top');
    const reduced=matchMedia('(prefers-reduced-motion: reduce)'),fine=matchMedia('(hover:hover) and (pointer:fine)');
    let rows=[],columns=0,active=null,manual=null,frame=0,layoutDirty=true;
    const player=window.createDirectionPlayer({ready,prepare,eligible:card=>card===active,
      reduced:()=>reduced.matches,blocked:()=>document.hidden||!modal.hidden});
    function select(card){
      if(card===active)return;
      player.stop();active=card;
      cards.forEach(item=>item.classList.toggle('is-active',item===card));
      if(card)player.request(card);
    }
    function layout(){
      const count=matchMedia('(max-width:680px)').matches?1:matchMedia('(max-width:1000px)').matches?2:3;
      if(count!==columns){
        select(null);manual=null;columns=count;
        const fragment=document.createDocumentFragment();rows=[];
        for(let i=0;i<cards.length;i+=count){
          const element=document.createElement('div'),stage=document.createElement('div');
          element.className='direction-scroll-row';stage.className='direction-row-stage';
          stage.style.setProperty('--direction-columns',count);
          const members=cards.slice(i,i+count);members.forEach(card=>stage.append(card));
          element.append(stage);fragment.append(element);rows.push({element,stage,cards:members,index:-1,span:0,top:0});
        }
        grid.replaceChildren(fragment);grid.classList.add('is-scroll-sequenced');
      }
      const headerHeight=header.getBoundingClientRect().height;
      rows.forEach(row=>{
        const height=row.stage.getBoundingClientRect().height;
        const fits=height+headerHeight+48<=innerHeight;
        row.top=Math.max(headerHeight+20,(innerHeight-height)/2);
        row.span=fits?Math.round(Math.max(150,Math.min(280,innerHeight*.28))*row.cards.length):0;
        row.element.classList.toggle('is-static',!fits);
        row.stage.style.setProperty('--direction-sticky-top',row.top+'px');
        row.element.style.height=row.span?(height+row.span)+'px':'';
      });
      layoutDirty=false;
    }
    function update(){
      frame=0;if(layoutDirty)layout();
      if(document.hidden||!modal.hidden){manual=null;select(null);return;}
      if(manual){select(manual);return;}
      let winner=null,distance=Infinity;
      const headerHeight=header.getBoundingClientRect().height;
      rows.forEach(row=>{
        const rect=row.stage.getBoundingClientRect();
        if(rect.bottom<=headerHeight+12||rect.top>=innerHeight*.88)return;
        const d=Math.abs((rect.top+rect.bottom)/2-(innerHeight+headerHeight)/2);
        if(d<distance){distance=d;winner=row;}
      });
      if(!winner){select(null);return;}
      const rect=winner.element.getBoundingClientRect();
      const progress=winner.span?(winner.top-rect.top)/winner.span:
        (innerHeight*.7-rect.top)/Math.max(1,winner.stage.getBoundingClientRect().height);
      winner.index=window.getDirectionScrollIndex(progress,winner.cards.length,winner.index);
      select(winner.cards[winner.index]);
    }
    function schedule(){if(!frame)frame=requestAnimationFrame(update);}
    function resize(){layoutDirty=true;schedule();}
    cards.forEach(card=>{
      card.addEventListener('pointerenter',event=>{
        if(!fine.matches||event.pointerType==='touch')return;
        manual=card;select(card);
      });
      const leave=()=>{if(manual===card){manual=null;schedule();}};
      card.addEventListener('pointerleave',leave);card.addEventListener('pointercancel',leave);
      card.addEventListener('focusin',()=>{manual=card;select(card);});
      card.addEventListener('focusout',()=>{manual=null;schedule();});
    });
    window.addEventListener('scroll',()=>{manual=null;schedule();},{passive:true});
    window.addEventListener('resize',resize,{passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)select(null);schedule();});
    document.addEventListener('tz:lead-open',()=>{manual=null;select(null);});
    document.addEventListener('tz:lead-close',schedule);
    reduced.addEventListener('change',()=>{player.stop();const card=active;active=null;select(card);});
    fine.addEventListener('change',()=>{manual=null;schedule();});
    document.fonts?.ready.then(resize);
    if('ResizeObserver' in window)new ResizeObserver(resize).observe(header);
    schedule();
  };
})();
