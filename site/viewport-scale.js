/* One 500px composition on narrower touch screens; the browser scales every element. */
(() => {
 'use strict';
 const meta=document.querySelector('meta[name="viewport"]');
 if(!meta||!window.matchMedia('(pointer:coarse)').matches)return;
 const original=meta.getAttribute('content');let lastWidth=-1;
 function update(){
  const viewport=window.visualViewport;
  const width=Math.round(viewport?viewport.width*viewport.scale:window.innerWidth);
  if(!width||Math.abs(width-lastWidth)<2)return;
  lastWidth=width;
  meta.setAttribute('content',width<500?'width=500, initial-scale='+String(width/500):original);
 }
 update();window.addEventListener('resize',update,{passive:true});
 window.visualViewport?.addEventListener('resize',update,{passive:true});
})();
