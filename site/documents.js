/* Legal content is always visible. In-page navigation does not fill the Back history. */
(() => {
 const back=document.getElementById('legalBack');
 if(!back)return;
 const reduced=matchMedia('(prefers-reduced-motion: reduce)');
 function moveTo(hash,behavior){
  const target=document.getElementById(hash.slice(1));
  if(!target)return;
  target.scrollIntoView({behavior,block:'start'});
 }
 document.querySelectorAll('a[href^="#"]').forEach(link=>link.addEventListener('click',event=>{
  if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  if(!document.getElementById(link.hash.slice(1)))return;
  event.preventDefault();history.replaceState(history.state,'',link.hash);
  moveTo(link.hash,reduced.matches?'instant':'smooth');
  const title=document.querySelector(link.hash+' h2');
  if(title){title.tabIndex=-1;title.focus({preventScroll:true});}
 }));
 if(location.hash)document.fonts?.ready.then(()=>moveTo(location.hash,'instant'));
 back.addEventListener('click',event=>{
  if(event.button!==0||event.ctrlKey||event.metaKey||event.shiftKey||event.altKey)return;
  let previous;
  try{previous=new URL(document.referrer);}catch{return;}
  const legal=/(?:^|\/)(?:documents|privacy|consent|details|requisites)(?:\/|\.html|$)/;
  if(previous.origin!==location.origin||legal.test(previous.pathname)||history.length<2)return;
  event.preventDefault();history.back();
 });
})();
