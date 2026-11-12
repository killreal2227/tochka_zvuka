/* Keep the original label in flow; position its visible copy by actual glyph bounds. */
(() => {
  'use strict';
  const ns = 'http://www.w3.org/2000/svg';
  const entries = [];
  const init = () => {
    // Native text avoids SVG glyph-metric offsets on touch browsers.
    if (window.matchMedia?.('(pointer:coarse)').matches) return;
    document.querySelectorAll('.btn, .header-cta, .branch-btn').forEach(button => {
      const arrow = button.querySelector(':scope > i, :scope > svg');
      if (!arrow) return;
      let source = button.querySelector(':scope > span');
      if (!source) {
        const nodes = [...button.childNodes].filter(n => n.nodeType === 3 && n.textContent.trim());
        if (!nodes.length) return;
        source = document.createElement('span');
        nodes[0].before(source); nodes.forEach(n => source.append(n));
      }
      const svg = document.createElementNS(ns, 'svg');
      svg.classList.add('capsule-caption'); svg.setAttribute('aria-hidden', 'true');
      svg.style.visibility = 'hidden';
      svg.setAttribute('focusable', 'false');
      const text = document.createElementNS(ns, 'text'); svg.append(text); button.append(svg);
      const update = () => {
        if (!button.getClientRects().length || !button.clientWidth) return;
        const style = getComputedStyle(button), bounds = button.getBoundingClientRect();
        const arrowBounds = arrow.getBoundingClientRect();
        const scale = bounds.width / button.offsetWidth;
        const right = arrow.offsetParent === button ? arrow.offsetLeft :
          (arrowBounds.left - bounds.left) / scale - button.clientLeft;
        if (!(right > 0)) return;
        const label = source.textContent.trim();
        text.textContent = style.textTransform === 'uppercase' ? label.toLocaleUpperCase('ru') : label;
        text.style.fontFamily = style.fontFamily; text.style.fontSize = style.fontSize;
        text.style.fontWeight = style.fontWeight; text.style.fontStyle = style.fontStyle;
        text.style.letterSpacing = style.letterSpacing;
        text.setAttribute('x', '0'); text.setAttribute('y', '0');
        let ink;
        try { ink = text.getBBox(); } catch { return; }
        text.setAttribute('x', String(right / 2 - ink.x - ink.width / 2));
        text.setAttribute('y', String(button.clientHeight / 2 - ink.y - ink.height / 2));
        source.classList.add('capsule-source');
        svg.style.visibility = 'visible';
      };
      entries.push({button, update});
      new MutationObserver(update).observe(source, {childList: true, subtree: true, characterData: true});
      if ('ResizeObserver' in window) new ResizeObserver(update).observe(button);
      update();
    });
    const updateAll = () => entries.forEach(entry => entry.update());
    window.addEventListener('resize', updateAll, {passive: true});
    document.addEventListener('tz:lead-open', () => requestAnimationFrame(updateAll));
    document.fonts?.ready.then(updateAll);
    // Hidden dialogs/success panels need a measurement after they become visible.
    new MutationObserver(updateAll).observe(document.body, {
      attributes: true, subtree: true, attributeFilter: ['hidden']
    });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, {once: true});
  else init();
})();
