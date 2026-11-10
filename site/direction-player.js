/* One active animation and at most one current candidate; no hover event queue. */
(() => {
  'use strict';
  window.createDirectionPlayer = ({ ready, prepare, eligible, blocked = () => false,
    reduced = () => false, clock = window }) => {
    let active = null, desired = null, timer = 0, loaded = false;
    const reset = card => card?.classList.remove('play');
    function flush() {
      if (!loaded || active || !desired || reduced() || blocked() || !eligible(desired)) return;
      const card = desired; desired = null; active = card;
      const duration = Math.min(3.2, Math.max(.5, prepare(card)));
      reset(card); void card.offsetWidth; card.classList.add('play');
      timer = clock.setTimeout(() => {
        reset(active); active = null; timer = 0;
        flush();
      }, duration * 1000 + 50);
    }
    const api = {
      request(card) {
        if (card === active) { desired = null; return; }
        desired = card; flush();
      },
      leave(card) { if (desired === card) desired = null; },
      stop() {
        if (timer) clock.clearTimeout(timer);
        timer = 0; reset(active); active = null; desired = null;
      }
    };
    Promise.resolve(ready).then(() => { loaded = true; flush(); });
    return api;
  };
})();
