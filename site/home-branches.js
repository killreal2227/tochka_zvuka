/* Header branch navigation, with keyboard support and outside dismissal. */
(() => {
  'use strict';
  const root=document.getElementById('homeBranch');
  if(!root)return;
  const button=document.getElementById('homeBranchButton'),list=document.getElementById('homeBranchList');
  const links=[...list.querySelectorAll('a')];
  function close(restore=false){list.hidden=true;button.setAttribute('aria-expanded','false');if(restore)button.focus();}
  function open(index){list.hidden=false;button.setAttribute('aria-expanded','true');if(index!==undefined)links[index]?.focus();}
  button.addEventListener('click',()=>list.hidden?open():close());
  button.addEventListener('keydown',e=>{
    if(e.key==='ArrowDown'||e.key==='ArrowUp'){e.preventDefault();open(e.key==='ArrowDown'?0:links.length-1);}
    if(e.key==='Escape')close(true);
  });
  list.addEventListener('keydown',e=>{
    const i=links.indexOf(document.activeElement);
    if(e.key==='Escape'){e.preventDefault();close(true);}
    if(e.key==='ArrowDown'||e.key==='ArrowUp'||e.key==='Home'||e.key==='End'){
      e.preventDefault();const next=e.key==='Home'?0:e.key==='End'?links.length-1:(i+(e.key==='ArrowDown'?1:-1)+links.length)%links.length;
      links[next]?.focus();
    }
  });
  document.addEventListener('pointerdown',e=>{if(!root.contains(e.target))close();});
  root.addEventListener('focusout',e=>{if(!root.contains(e.relatedTarget))close();});
  document.addEventListener('tz:lead-open',()=>close());
})();
