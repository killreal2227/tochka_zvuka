/* Home rhythm shapes; bounded paint rate, no per-frame geometry reads or timers. */
(() => {
  'use strict';
  const svg = document.querySelector('.page-pattern svg');
  if (!svg) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const narrow = matchMedia('(max-width: 1000px)');
  const lines = [...svg.querySelectorAll('[data-f]')];
  const shapes = [...svg.querySelectorAll('[data-d]')];
  const knobs = [...svg.querySelectorAll('.nd')];
  const all = [...lines, ...shapes, ...knobs];
  const period = el => 8 + ((+el.dataset.t * 1.37) % 6);
  const wave = (el, seconds) => Math.sin(seconds * 2 * Math.PI / period(el) + +el.dataset.p);
  let scale = 1, frameId = 0, visible = false, lastTime = null, lastPaint = null, seconds = 0;
  const turns = knobs.map((_, i) => ({ next: .7 + i * .45, angle: 0 }));
  function measure() { scale = Math.abs(svg.getScreenCTM()?.a || 1); }
  function frame(now) {
    frameId = 0;
    if (reduce.matches || document.hidden || !visible) return;
    if (lastTime !== null) seconds += Math.min((now - lastTime) / 1000, .1);
    lastTime = now;
    const interval = 1000 / (narrow.matches ? 12 : 24);
    if (lastPaint === null || now - lastPaint >= interval) {
      lastPaint = now;
      lines.forEach(line => {
        const amplitude = 32, w = wave(line, seconds);
        const x = line.dataset.f === 'l' ? -amplitude * (1-w)/2
          : line.dataset.f === 'r' ? amplitude * (1-w)/2 : amplitude * w;
        line.style.transform = `translateX(${x.toFixed(2)}px)`;
      });
      shapes.forEach(shape => {
        const v = (16 * wave(shape, seconds)).toFixed(2);
        const zoom = (1 + .05 * Math.sin(seconds * 2 * Math.PI / (period(shape)*1.3) + +shape.dataset.p*2)).toFixed(4);
        shape.style.transform = (shape.dataset.d === 'x' ? `translateX(${v}px)` : `translateY(${v}px)`) + ` scale(${zoom})`;
      });
      knobs.forEach((knob, i) => {
        if (seconds < turns[i].next) return;
        turns[i].angle += i % 2 ? 90 : -90;
        turns[i].next = seconds + 2.5 + i * .08;
        knob.style.transform = `rotate(${turns[i].angle}deg)`;
      });
    }
    frameId = requestAnimationFrame(frame);
  }
  function sync() {
    if (reduce.matches || document.hidden || !visible) {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0; lastTime = null; lastPaint = null;
      if (reduce.matches) all.forEach(el => { el.style.transform = ''; });
      return;
    }
    if (!frameId) { measure(); frameId = requestAnimationFrame(frame); }
  }
  reduce.addEventListener('change', sync);
  narrow.addEventListener('change', () => { measure(); sync(); });
  document.addEventListener('visibilitychange', sync);
  window.addEventListener('resize', measure, { passive: true });
  if ('ResizeObserver' in window) new ResizeObserver(measure).observe(svg);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }).observe(svg);
  } else { visible = true; sync(); }
})();
