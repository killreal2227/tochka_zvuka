/* Desktop hover; compact/touch cards play once when fully visible below the header. */
(() => {
  'use strict';
  function troitskInteractions({ready,prepare}){
    const cards=[...document.querySelectorAll('#dirs .card[data-dir]')],modal=document.getElementById('leadModal');
    const fine=matchMedia('(hover:hover) and (pointer:fine)'),reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const played=new WeakSet();let active=null,manual=null,frame=0;
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
      frame=0;if(document.hidden||!modal.hidden||reduced.matches){select(null);return;}
      if(fine.matches){select(manual);return;}
      const top=Math.max(0,document.querySelector('.top').getBoundingClientRect().bottom);
      let nearest=null,distance=Infinity;
      cards.forEach(card=>{const r=card.getBoundingClientRect();if(r.bottom<=top||r.top>=innerHeight)return;
        const d=((r.left+r.right)/2-innerWidth/2)**2+((r.top+r.bottom)/2-innerHeight/2)**2;
        if(d<distance){nearest=card;distance=d;}
      });select(nearest);
    }
    function schedule(){if(!frame)frame=requestAnimationFrame(update);}
    cards.forEach(card=>{
      card.addEventListener('pointerenter',e=>{if(!fine.matches||e.pointerType==='touch')return;manual=card;select(card);});
      const leave=()=>{if(manual===card){manual=null;schedule();}};
      card.addEventListener('pointerleave',leave);card.addEventListener('pointercancel',leave);
      card.addEventListener('focusin',()=>{if(fine.matches){manual=card;select(card);}});
      card.addEventListener('focusout',()=>{manual=null;schedule();});
    });
    window.addEventListener('scroll',schedule,{passive:true});window.addEventListener('resize',schedule,{passive:true});
    document.addEventListener('tz:lead-open',()=>{manual=null;select(null);});document.addEventListener('tz:lead-close',schedule);
    document.addEventListener('visibilitychange',schedule);
    [fine,reduced].forEach(q=>q.addEventListener('change',()=>{manual=null;select(null);schedule();}));schedule();
  }
  window.createDirectionInteractions=({ready,prepare})=>{
    if(document.body?.dataset.city==='troitsk')return troitskInteractions({ready,prepare});
    const grid=document.querySelector('#dirs .grid');if(!grid)return;
    const cards=[...grid.querySelectorAll('.card[data-dir]')],modal=document.getElementById('leadModal');
    const header=document.querySelector('header.top');
    const fine=matchMedia('(hover:hover) and (pointer:fine)'),compact=matchMedia('(max-width:1000px)'),
      reduced=matchMedia('(prefers-reduced-motion: reduce)');
    const played=new WeakSet();let active=null,manual=null,frame=0;
    const automatic=()=>compact.matches||!fine.matches;
    const blocked=()=>document.hidden||!modal.hidden;
    const fullyVisible=card=>{
      const rect=card.getBoundingClientRect(),top=header?header.getBoundingClientRect().bottom:0;
      return rect.top>=top&&rect.bottom<=innerHeight;
    };
    const player=window.createDirectionPlayer({ready,prepare,
      eligible:card=>!automatic()&&card===active,reduced:()=>reduced.matches,blocked});
    const autoPlayers=new Map(cards.map(card=>[card,window.createDirectionPlayer({ready,
      prepare:item=>{played.add(item);return prepare(item);},
      eligible:item=>automatic()&&!played.has(item)&&fullyVisible(item),
      reduced:()=>reduced.matches,blocked})]));
    function select(card){
      if(card===active)return;player.stop();active=card;
      cards.forEach(item=>item.classList.toggle('is-active',item===card));
      if(card)player.request(card);
    }
    function stopAll(){
      manual=null;select(null);autoPlayers.forEach(item=>item.stop());
      cards.forEach(card=>card.classList.toggle('is-active',false));
    }
    function update(){
      frame=0;
      if(blocked()){stopAll();return;}
      if(!automatic()){select(manual);return;}
      select(null);
      const top=header?header.getBoundingClientRect().bottom:0;
      cards.forEach(card=>{
        const rect=card.getBoundingClientRect(),full=rect.top>=top&&rect.bottom<=innerHeight;
        const playback=autoPlayers.get(card);
        card.classList.toggle('is-active',full);
        if(full&&!played.has(card))playback.request(card);
        else if(rect.bottom<=top||rect.top>=innerHeight||!played.has(card))playback.stop();
      });
    }
    function schedule(){if(!frame)frame=requestAnimationFrame(update);}
    cards.forEach(card=>{
      card.addEventListener('pointerenter',event=>{
        if(automatic()||event.pointerType==='touch')return;manual=card;select(card);
      });
      const leave=()=>{if(manual===card){manual=null;schedule();}};
      card.addEventListener('pointerleave',leave);card.addEventListener('pointercancel',leave);
      card.addEventListener('focusin',()=>{if(automatic()){schedule();return;}manual=card;select(card);});
      card.addEventListener('focusout',()=>{manual=null;schedule();});
    });
    window.addEventListener('scroll',schedule,{passive:true});
    window.addEventListener('resize',schedule,{passive:true});
    document.addEventListener('visibilitychange',()=>{if(document.hidden)stopAll();schedule();});
    document.addEventListener('tz:lead-open',stopAll);
    document.addEventListener('tz:lead-close',schedule);
    [fine,compact,reduced].forEach(query=>query.addEventListener('change',()=>{stopAll();schedule();}));
    schedule();
  };
})();
