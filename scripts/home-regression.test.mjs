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
  return { document, reduce, narrow, frames, events, line, knob, tick, observer,
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
test('every display frame updates motion at 60 and 120Hz on desktop and mobile without geometry reads', () => {
  for(const mobile of [false,true]) for(const hz of [60,120]) {
    const s=scene({mobile});s.tick(0);
    for(let n=1;n<=hz;n++) {
      const previous=s.writes;s.tick(n*1000/hz);
      assert.ok(s.writes>=previous+2,`${hz}Hz frame ${n} must update both moving elements`);
    }
    assert.equal(s.reads,0);assert.equal(s.events.has('resize'),false);
    assert.equal(s.frames.size,1);
  }
});

test('partial-circle turns are quarter turns separated by a pause',()=>{
  const s=scene();s.tick(0);
  for(let t=100;t<=1000;t+=100)s.tick(t);
  assert.equal(s.knob.style.transform,'rotate(-90deg)');
  for(let t=1100;t<=3000;t+=100)s.tick(t);
  assert.equal(s.knob.style.transform,'rotate(-90deg)');
  for(let t=3100;t<=3500;t+=100)s.tick(t);
  assert.equal(s.knob.style.transform,'rotate(-180deg)');
});

test('opening the lead dialog pauses the background and closing resumes without a time jump',()=>{
  const s=scene();s.tick(0);s.tick(16);
  const value=s.line.style.transform,writes=s.writes;
  s.events.get('tz:lead-open')();assert.equal(s.frames.size,0);
  s.tick(100000);assert.equal(s.writes,writes);
  s.events.get('tz:lead-close')();assert.equal(s.frames.size,1);
  s.tick(100016);assert.equal(s.line.style.transform,value);
  s.tick(100032);assert.notEqual(s.line.style.transform,value);
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
const sheets = ['experience.css', 'home.css', 'narrow-header.css', 'responsive.css'].map(p => fs.readFileSync(new URL('site/' + p, root), 'utf8')).join('\n');
function resolve(viewport, target, state = '') {
  const properties = new Map(); let order = 0;
  for (const rule of rules(sheets, viewport)) for (const selector of rule.selectors) {
    order++;
    if (selector.includes(':is(') || selector.includes(':not(') || selector.includes('[data-city]')) continue;
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
test('1000px is narrow and hides header cities; 1001px remains desktop', () => {
  for (const width of widths.filter(w => w <= 1000)) {
    assert.equal(resolve(width, 'header').display, 'flex');
    assert.equal(resolve(width, 'grid')['grid-template-columns'], 'repeat(2, minmax(0, 1fr))');
    assert.equal(resolve(width, 'cities')['justify-content'], 'space-between');
    assert.equal(resolve(width, 'cities').display, 'none');
    assert.equal(resolve(width, 'header').height, 'var(--header-height)');
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
    assert.equal(resolve(width, 'legal')['font-size'], '11px');
  }
});

test('document links stay a compact left-aligned wrapping group at every width', () => {
  for (const width of [320, 375, 760, 1000, 1001, 1440, 2560]) {
    const links = resolve(width, 'documents');
    assert.equal(links['justify-content'], 'flex-start', `${width}px alignment`);
    assert.equal(links.gap, '2px 16px', `${width}px gap`);
    assert.equal(links['flex-wrap'], 'wrap', `${width}px wrap`);
    assert.equal(links['flex-direction'], 'row', `${width}px direction`);
  }
});
test('compact home header keeps both actions together on the circle centerline', () => {
  for (const width of [320, 360, 375, 390, 571, 600, 601, 760, 768, 816, 999, 1000]) {
    const header = resolve(width, 'header'), brand = resolve(width, 'brand'), cta = resolve(width, 'cta');
    assert.equal(header.display, 'flex', `${width}px header`);
    assert.equal(header['flex-wrap'], 'nowrap');
    assert.equal(header['align-items'], 'center');
    assert.equal(header['justify-content'], 'space-between');
    assert.equal(header.height, 'var(--header-height)');
    assert.equal(brand.width, 'var(--narrow-logo)');
    assert.equal(brand['min-width'], brand.width);
    assert.equal(cta.width, 'var(--narrow-cta)');
    assert.equal(cta['min-width'], cta.width);
    assert.equal(cta.height, 'var(--narrow-button-height)');
    for (const state of ['hover', 'focus-visible']) {
      const active = resolve(width, 'cta', state);
      assert.equal(active.width, cta.width);
      assert.equal(active.height, cta.height);
    }
  }
});

test('desktop header retains its original logo and button dimensions above 1000px', () => {
  for (const width of [1001, 1440, 2560]) {
    assert.equal(resolve(width, 'brand').width, '260px');
    assert.equal(resolve(width, 'cta').width, '230px');
    assert.equal(resolve(width, 'cta').height, '54px');
    assert.equal(resolve(width, 'header').height, 'calc(260px * 240 / 567)');
  }
});
test('home branch menu supports keyboard navigation, Escape and outside dismissal',()=>{
  const handlers=()=>({handlers:{},addEventListener(k,fn){this.handlers[k]=fn;}});
  const document=handlers(),button=handlers(),list=handlers(),root=handlers();
  button.attrs={};button.setAttribute=(k,v)=>button.attrs[k]=v;button.focus=()=>document.activeElement=button;
  const links=[{},{}];links.forEach(link=>link.focus=()=>document.activeElement=link);
  list.hidden=true;list.querySelectorAll=()=>links;
  root.contains=target=>[root,button,list,...links].includes(target);
  document.getElementById=id=>({homeBranch:root,homeBranchButton:button,homeBranchList:list})[id];
  vm.runInNewContext(fs.readFileSync(new URL('site/home-branches.js',rootURL()),'utf8'),{document});
  button.handlers.keydown({key:'ArrowDown',preventDefault(){}});
  assert.equal(list.hidden,false);assert.equal(document.activeElement,links[0]);
  list.handlers.keydown({key:'ArrowDown',preventDefault(){}});assert.equal(document.activeElement,links[1]);
  list.handlers.keydown({key:'Escape',preventDefault(){}});assert.equal(list.hidden,true);assert.equal(document.activeElement,button);
  button.handlers.click();document.handlers.pointerdown({target:{}});assert.equal(list.hidden,true);
  assert.equal(button.attrs['aria-expanded'],'false');
});
function rootURL(){return new URL('../',import.meta.url);}
