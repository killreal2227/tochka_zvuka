/* A single, non-modal invitation per browser session; never above an open form. */
(() => {
  'use strict';
  if(document.body?.dataset.city==='troitsk')return;
  const box = document.getElementById('lessonNudge');
  if (!box) return;
  const key = 'tz.lesson-invitation.seen';
  const modal = document.getElementById('leadModal');
  let eligible = false, consumed = false, storage;
  try { storage = window.sessionStorage; consumed = storage.getItem(key) === '1'; }
  catch { return; } // If session persistence is unavailable, do not risk repeat prompts.
  function mark() {
    consumed = true;
    try { storage.setItem(key, '1'); } catch { /* No repeated prompt on this page. */ }
  }
  function close(restore = false) {
    const inside = box.contains(document.activeElement);
    box.hidden = true;
    if (restore && inside) document.querySelector('.top .openForm')?.focus({ preventScroll: true });
  }
  function maybeShow() {
    if (!eligible || consumed || document.hidden || !modal?.hidden) return;
    if (window.scrollY < Math.min(window.innerHeight * .7, 400)) return;
    try { storage.setItem(key, '1'); } catch { return; }
    consumed = true; box.hidden = false;
  }
  box.querySelector('.lesson-nudge-close').addEventListener('click', () => close(true));
  document.addEventListener('keydown', e => {
    if (!box.hidden && e.key === 'Escape') { e.preventDefault(); close(true); }
  });
  document.addEventListener('pointerdown', e => { if (!box.hidden && !box.contains(e.target)) close(); });
  document.addEventListener('tz:lead-open', () => { mark(); close(); });
  document.addEventListener('visibilitychange', () => { if (document.hidden) close(); else maybeShow(); });
  let frame = 0;
  window.addEventListener('scroll', () => {
    if (!frame) frame = requestAnimationFrame(() => { frame = 0; maybeShow(); });
  }, { passive: true });
  if (!consumed) window.setTimeout(() => { eligible = true; maybeShow(); }, 25000);
})();
