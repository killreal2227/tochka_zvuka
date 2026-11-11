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
  // Scroll position selects a card in either direction; hysteresis avoids boundary jitter.
  window.getDirectionScrollIndex=(progress,count,previous=-1)=>{
    if(count<=1)return 0;
    const p=Math.max(0,Math.min(1,progress));
    if(previous<0||previous>=count)return Math.min(count-1,Math.floor(p*count));
    let index=previous;const margin=.035;
    while(index<count-1&&p>(index+1)/count+margin)index++;
    while(index>0&&p<index/count-margin)index--;
    return index;
  };
})();
