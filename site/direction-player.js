/* Pointer-only playback: leave resets immediately; no queue or background playback. */
(() => {
  'use strict';
  window.createDirectionPlayer = ({ ready, prepare, eligible, blocked = () => false,
    reduced = () => false, clock = window }) => {
    let active = null, hovered = null, timer = 0, loaded = false;
    const reset = card => card?.classList.remove('play');
    function clearActive() {
      if (timer) clock.clearTimeout(timer);
      timer = 0; reset(active); active = null;
    }
    function start() {
      if (!loaded || active || !hovered || reduced() || blocked() || !eligible(hovered)) return;
      const card = hovered; active = card;
      const duration = Math.min(3.2, Math.max(.5, prepare(card)));
      reset(card); void card.offsetWidth; card.classList.add('play');
      timer = clock.setTimeout(() => {
        reset(active); active = null; timer = 0;
      }, duration * 1000 + 50);
    }
    const api = {
      request(card) {
        if (card === hovered) return;
        clearActive(); hovered = card; start();
      },
      leave(card) {
        if (hovered === card) hovered = null;
        if (active === card) clearActive();
      },
      stop() {
        clearActive(); hovered = null;
      }
    };
    Promise.resolve(ready).then(() => { loaded = true; start(); }).catch(() => api.stop());
    return api;
  };
  // A single left-to-right pass; changing rows cancels every pending continuation.
  window.createDirectionRowTour=({ready,prepare,playerFor,activate,blocked=()=>false,onStart=()=>{},onFinish=()=>{},clock=window})=>{
    let row=[],timer=0,generation=0,started=false;
    function stop(){
      generation++;if(timer)clock.clearTimeout(timer);timer=0;
      row.forEach(card=>playerFor(card).stop());row=[];activate(null);
      if(started){started=false;onFinish();}
    }
    function request(cards){
      if(cards.length===row.length&&cards.every((card,i)=>card===row[i]))return;
      stop();if(!cards.length||blocked())return;
      row=[...cards];const token=generation;
      Promise.resolve(ready).then(()=>{
        function play(index){
          timer=0;if(token!==generation||blocked()){if(token===generation)stop();return;}
          if(index)playerFor(row[index-1]).stop();
          const card=row[index];activate(card);playerFor(card).request(card);
          const duration=Math.min(3.2,Math.max(.5,prepare(card)));
          timer=clock.setTimeout(()=>{
            timer=0;if(token!==generation)return;
            if(index+1<row.length)play(index+1);
            else if(started){started=false;onFinish();}
          },duration*1000+250);
        }
        if(token===generation&&!blocked()){started=true;onStart(row);play(0);}
      }).catch(()=>{if(token===generation)stop();});
    }
    return {request,stop};
  };
})();
