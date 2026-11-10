import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const root = new URL('../', import.meta.url);
const motion = fs.readFileSync(new URL('site/home-motion.js', root), 'utf8');

function scene({ reduced = false, mobile = false } = {}) {
  const events = new Map(), frames = new Map();
  const signal = matches => ({ matches, addEventListener(_, fn) { this.change = fn; } });
  const reduce = signal(reduced), narrow = signal(mobile);
  let sequence = 0, reads = 0, writes = 0, observer;
  const node = data => ({ dataset: data, style: { set transform(v) { this.value = v; writes++; }, get transform() { return this.value; } } });
  const line = node({ f: 'c', t: '7.2', p: '0' });
  const shape = node({ d: 'x', t: '11', p: '0' });
  const knob = node({ t: '5.2' });
  const svg = {
    querySelectorAll: s => s === '[data-f]' ? [line] : s === '[data-d]' ? [shape] : [knob],
    getScreenCTM() { reads++; return { a: 2 }; }
  };
  const document = { hidden: false, querySelector: () => svg, addEventListener(k, fn) { events.set(k, fn); } };
  const context = {
    document, matchMedia: q => q.includes('reduced-motion') ? reduce : narrow,
    requestAnimationFrame(fn) { const id = ++sequence; frames.set(id, fn); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    ResizeObserver: class { constructor(fn) { events.set('resize-observer', fn); } observe() {} },
    IntersectionObserver: class { constructor(fn) { observer = fn; } observe() {} }
  };
  context.window = { addEventListener(k, fn) { events.set(k, fn); }, ResizeObserver: context.ResizeObserver, IntersectionObserver: context.IntersectionObserver };
  vm.runInNewContext(motion, context);
  observer([{ isIntersecting: true }]);
  function tick(t) { const batch = [...frames.values()]; frames.clear(); batch.forEach(fn => fn(t)); }
  return { document, reduce, narrow, frames, events, line, tick, observer,
    get reads() { return reads; }, get writes() { return writes; } };
}

test('reduced motion starts static and responds to setting changes', () => {
  const s = scene({ reduced: true });
  assert.equal(s.frames.size, 0);
  s.reduce.matches = false; s.reduce.change(); s.tick(0);
  assert.equal(s.frames.size, 1);
  s.reduce.matches = true; s.reduce.change();
  assert.equal(s.frames.size, 0); assert.equal(s.line.style.transform, '');
});
test('hidden/offscreen animation stops and resumes without duplicate loops', () => {
  const s = scene(); s.tick(0);
  s.document.hidden = true; s.events.get('visibilitychange')(); assert.equal(s.frames.size, 0);
  s.document.hidden = false; s.events.get('visibilitychange')(); s.events.get('visibilitychange')();
  assert.equal(s.frames.size, 1);
  s.observer([{ isIntersecting: false }]); assert.equal(s.frames.size, 0);
});
test('mobile paint rate is capped and geometry is not read every frame', () => {
  const s = scene({ mobile: true }); const reads = s.reads, writes = s.writes;
  for (let t = 0; t <= 2000; t += 10) s.tick(t);
  assert.equal(s.reads, reads);
  // Two moving elements plus one occasional knob, at no more than 12 paints/s.
  assert.ok(s.writes - writes <= 51);
  s.events.get('resize')(); assert.equal(s.reads, reads + 1);
});

/* Declaration-cascade regression, NOT a browser/layout engine. */
function splitSelectors(s) {
  const result = []; let depth = 0, start = 0;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '(') depth++; if (s[i] === ')') depth--;
    if (!depth && s[i] === ',') { result.push(s.slice(start, i).trim()); start = i + 1; }
  }
  result.push(s.slice(start).trim()); return result;
}
function rules(css, viewport, active = true) {
  const out = []; css = css.replace(/\/\*[\s\S]*?\*\//g, '');
  for (let pos = 0; pos < css.length;) {
    const open = css.indexOf('{', pos); if (open < 0) break;
    const head = css.slice(pos, open).trim(); let depth = 1, end = open + 1;
    while (end < css.length && depth) { if (css[end] === '{') depth++; if (css[end] === '}') depth--; end++; }
    const body = css.slice(open + 1, end - 1); pos = end;
    if (head.startsWith('@media')) {
      let yes = active;
      for (const [, op, n] of head.matchAll(/(max|min)-width\s*:\s*(\d+)px/g)) yes &&= op === 'max' ? viewport <= +n : viewport >= +n;
      for (const [, op, n] of head.matchAll(/\(width\s*(<|>)\s*(\d+)px\)/g)) yes &&= op === '<' ? viewport < +n : viewport > +n;
      if (head.includes('prefers-reduced-motion')) yes = false;
      if (yes) out.push(...rules(body, viewport));
    } else if (active && !head.startsWith('@')) out.push({ selectors: splitSelectors(head), body });
  }
  return out;
}
const sheets = ['experience.css', 'home.css'].map(p => fs.readFileSync(new URL('site/' + p, root), 'utf8')).join('\n');
function resolve(viewport, target, state = '') {
  const properties = new Map(); let order = 0;
  for (const rule of rules(sheets, viewport)) for (const selector of rule.selectors) {
    order++;
    if (selector.includes(':is(') || selector.includes(':not(')) continue;
    if (selector.includes(':hover') && state !== 'hover') continue;
    if (selector.includes(':focus-visible') && state !== 'focus-visible') continue;
    const plain = selector.replace(/:(?:hover|focus-visible|visited)/g, '');
    const wanted = target === 'card' ? /\.city-line(?:\s*\+\s*\.city-line)?$/
      : target === 'title' ? /\.city-line\s+h3$/
      : target === 'cities' ? /(?:^|\s)\.header-cities$/
      : target === 'legal' ? /(?:^|\s)\.footer-details$/
      : target === 'documents' ? /\.footer-bottom\s+nav$/
      : target === 'brand' ? /(?:^|\s)\.home-brand$/
      : target === 'cta' ? /(?:^|\s)\.header-cta$/
      : target === 'grid' ? /(?:^|\s)\.city-lines$/ : /(?:^|\s)\.home-header$/;
    if (!wanted.test(plain)) continue;
    const score = (selector.match(/\.[\w-]+|:(?:hover|focus-visible|visited)/g) || []).length * 100;
    for (const declaration of rule.body.split(';')) {
      const colon = declaration.indexOf(':'); if (colon < 0) continue;
      const name = declaration.slice(0, colon).trim(), raw = declaration.slice(colon + 1).trim();
      const important = raw.includes('!important'), value = raw.replace(/\s*!important/, '');
      const rank = score + (important ? 100000 : 0);
      const assignments = [[name, value]];
      if (name === 'margin' || name === 'padding') {
        const v = value.split(/\s+(?![^()]*\))/);
        ['top','right','bottom','left'].forEach((side,i) => assignments.push([name+'-'+side,[v[0],v[1]||v[0],v[2]||v[0],v[3]||v[1]||v[0]][i]]));
      }
      for (const [property, resolved] of assignments) {
        const old = properties.get(property);
        if (!old || rank > old.rank || rank === old.rank && order >= old.order) properties.set(property, { value: resolved, rank, order });
      }
    }
  }
  return Object.fromEntries([...properties].map(([k, v]) => [k, v.value]));
}
const widths = [320, 375, 768, 999.5, 1000, 1001, 1440, 2560];
test('card/title geometry declarations are identical through hover and focus', () => {
  const geometry = /^(?:font|line-height|letter-spacing|margin|padding|width|min-width|max-width|height|min-height|max-height|gap|display|grid-template|transform|border-width)/;
  for (const width of widths) for (const target of ['card', 'title']) {
    const select = o => Object.fromEntries(Object.entries(o).filter(([k]) => geometry.test(k)).map(([k,v]) => [k,v.replace(/\s+/g,'')]));
    for (const state of ['hover', 'focus-visible']) assert.deepEqual(select(resolve(width, target, state)), select(resolve(width, target)), `${width}px ${target} ${state}`);
  }
});
test('1000px is narrow; 1001px remains desktop; header cities hide strictly below 1000px', () => {
  for (const width of widths.filter(w => w <= 1000)) {
    assert.equal(resolve(width, 'header').display, width < 1000 ? 'flex' : 'grid');
    assert.equal(resolve(width, 'grid')['grid-template-columns'], 'minmax(0, 1fr)');
    assert.equal(resolve(width, 'cities')['justify-content'], 'space-between');
    assert.equal(resolve(width, 'cities').display, width < 1000 ? 'none' : 'flex');
    assert.equal(resolve(width, 'header').height, width < 1000 ? '72px' : '112px');
  }
  assert.equal(resolve(1001, 'header').display, 'flex');
  assert.equal(resolve(1001, 'grid')['grid-template-columns'], 'repeat(2, minmax(0, 1fr))');
});
test('footer legal row and document row stack without changing content on narrow screens', () => {
  assert.equal(resolve(1440, 'legal')['grid-row'], '1');
  assert.equal(resolve(1440, 'documents')['grid-row'], '2');
  assert.equal(resolve(1440, 'legal')['justify-content'], 'flex-end');
  for (const width of [320, 375, 760]) {
    assert.equal(resolve(width, 'legal')['grid-row'], '2');
    assert.equal(resolve(width, 'documents')['grid-row'], '3');
    assert.equal(resolve(width, 'documents')['flex-wrap'], 'wrap');
    assert.equal(resolve(width, 'legal')['font-size'], '14px');
  }
});

test('document links stay a compact left-aligned wrapping group at every width', () => {
  for (const width of [320, 375, 760, 1000, 1001, 1440, 2560]) {
    const links = resolve(width, 'documents');
    assert.equal(links['justify-content'], 'flex-start', `${width}px alignment`);
    assert.equal(links.gap, '8px 20px', `${width}px gap`);
    assert.equal(links['flex-wrap'], 'wrap', `${width}px wrap`);
    assert.equal(links['flex-direction'], 'row', `${width}px direction`);
  }
});
test('hidden-navigation header keeps both items fixed-size and aligned at narrow widths', () => {
  for (const width of [280, 300, 320, 360, 375, 390, 393, 680]) {
    const header = resolve(width, 'header'), brand = resolve(width, 'brand'), cta = resolve(width, 'cta');
    assert.equal(header['flex-wrap'], 'nowrap');
    assert.equal(header['justify-content'], 'space-between');
    assert.equal(header['align-items'], 'center');
    assert.equal(brand.flex, '0 0 auto'); assert.equal(cta.flex, '0 0 auto');
    const number = v => Number.parseFloat(v);
    const reserved = number(header['padding-left']) + number(brand.width) + number(header.gap)
      + number(cta.width) + number(header['padding-right']);
    assert.ok(reserved <= width, `${width}px: reserved header widths ${reserved}`);
  }
});
