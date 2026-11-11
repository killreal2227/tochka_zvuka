/* Original branch orbital artwork; display-synchronized motion, no per-frame geometry reads or timers. */
(() => {
  'use strict';
  const svg = document.querySelector('.page-pattern svg');
  if (!svg) return;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)');
  const lines = [...svg.querySelectorAll('[data-f]')];
  const shapes = [...svg.querySelectorAll('[data-d]')];
  const knobs = [...svg.querySelectorAll('.nd')];
  const all = [...lines, ...shapes, ...knobs];
  const period = el => (8 + ((+el.dataset.t * 1.37) % 6)) * 1.45;
  const wave = (el, seconds) => Math.sin(seconds * 2 * Math.PI / period(el) + +el.dataset.p);
  let frameId = 0, visible = false, lastTime = null, seconds = 0;
  const turns = knobs.map((_, i) => ({ next: .7 + i * .45, angle: 0 }));
  function frame(now) {
    frameId = 0;
    if (reduce.matches || document.hidden || !visible) return;
    if (lastTime !== null) seconds += Math.min((now - lastTime) / 1000, .1);
    lastTime = now;
    lines.forEach(line => {
      const amplitude = 28, w = wave(line, seconds);
      const x = line.dataset.f === 'l' ? -amplitude * (1-w)/2
        : line.dataset.f === 'r' ? amplitude * (1-w)/2 : amplitude * w;
      line.style.transform = `translateX(${x.toFixed(2)}px)`;
    });
    shapes.forEach(shape => {
      const v = (14 * wave(shape, seconds)).toFixed(2);
      const zoom = (1 + .04 * Math.sin(seconds * 2 * Math.PI / (period(shape)*1.3) + +shape.dataset.p*2)).toFixed(4);
      shape.style.transform = (shape.dataset.d === 'x' ? `translateX(${v}px)` : `translateY(${v}px)`) + ` scale(${zoom})`;
    });
    knobs.forEach((knob, i) => {
      if (seconds < turns[i].next) return;
      turns[i].angle += i % 2 ? 90 : -90;
      turns[i].next = seconds + 2.5 + i * .08;
      knob.style.transform = `rotate(${turns[i].angle}deg)`;
    });
    frameId = requestAnimationFrame(frame);
  }
  function sync() {
    if (reduce.matches || document.hidden || !visible) {
      if (frameId) cancelAnimationFrame(frameId);
      frameId = 0; lastTime = null;
      if (reduce.matches) all.forEach(el => { el.style.transform = ''; });
      return;
    }
    if (!frameId) { frameId = requestAnimationFrame(frame); }
  }
  reduce.addEventListener('change', sync);
  document.addEventListener('visibilitychange', sync);
  if ('IntersectionObserver' in window) {
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; sync(); }).observe(svg);
  } else { visible = true; sync(); }
})();
