/* Public configuration contains no credentials. The server owns the bot token. */
(()=>{
  'use strict';
  const modal=document.getElementById('leadModal');
  if(!modal)return;
  const sheet=modal.querySelector('.lead-sheet'),form=document.getElementById('leadForm'),status=document.getElementById('leadStatus');
  const success=modal.querySelector('.lead-success'),button=form.querySelector('.lead-submit'),phone=form.elements.phone;
  const $=(selector,root=modal)=>root.querySelector(selector),$$=(selector,root=modal)=>[...root.querySelectorAll(selector)];
  const reduceQuery=matchMedia('(prefers-reduced-motion: reduce)');
  let reduce=reduceQuery.matches;
  const directionLabels={vocal:'Вокал',guitar:'Гитара',drums:'Барабаны',piano:'Фортепиано',actor:'Актёрское мастерство',speech:'Ораторское искусство',unsure:'Пока не знаю'};
  function positionDirectionNames(){
    const row=$('.pick-row');
    if(!row||modal.hidden)return;
    const bounds=row.getBoundingClientRect();
    $$('.pk:not(.choice-unsure) .choice-name').forEach(name=>{
      name.style.setProperty('--caption-shift','0px');
      const rect=name.getBoundingClientRect();
      const shift=Math.max(bounds.left-rect.left,Math.min(0,bounds.right-rect.right));
      name.style.setProperty('--caption-shift',shift+'px');
    });
  }
  window.addEventListener('resize',positionDirectionNames,{passive:true});
  document.fonts?.ready.then(positionDirectionNames);

const formArt=(()=>{
  const box=$('.sheet-art'), svg=box?$('svg',box):null, mob=matchMedia('(max-width:1000px)');
  const col={vocal:'--vocal',guitar:'--guitar',drums:'--drums',piano:'--piano',actor:'--orange',speech:'--pink',unsure:'--grey'};
  const sheet=box?box.closest('.sheet'):modal.querySelector('.lead-sheet');
  let actorNextBlue=false;
  function tint(advanceActor=false){   // актёрский акцент меняется при новом выборе, без мигания во время ввода
    const v=form.elements.direction.value;
    if(col[v]) sheet.dataset.dir=v; else delete sheet.dataset.dir;
    if(v==='actor' && advanceActor){sheet.dataset.actorColor=actorNextBlue?'blue':'orange';actorNextBlue=!actorNextBlue;}
    $('#chips').classList.toggle('has',!!col[v]);
    $('#pickCap').textContent = col[v] ? directionLabels[v].toLocaleLowerCase('ru') : '';
    const title=$('#directionTitle'),reset=$('#directionReset');
    if(title) title.textContent=col[v]?directionLabels[v]:'Что тебе интересно?';
    if(reset) reset.hidden=!col[v];
    positionDirectionNames();
  }
  form.addEventListener('change',e=>{ if(e.target.name==='direction') tint(true); });
  if(!svg)return {tint,resize(){},start(){},stop(){}};
  const setVB=()=>svg.setAttribute('viewBox', mob.matches ? '0 0 706.05 366.67' : '34 0 183 366.67');
  setVB(); if(mob.addEventListener) mob.addEventListener('change',setVB);
  const F=$$('[data-f]',svg), D=$$('[data-d]',svg), N=$$('.nd',svg);
  const per=el=>8+((+el.dataset.t*1.37)%6);            // период 8–14 с, у каждого свой
  const wave=(el,s)=>Math.sin(s*2*Math.PI/per(el) + +el.dataset.p);
  let id=0, t0=0, run=0, scale=1, lastPaint=null;
  const timers=new Set();
  const later=(fn,ms)=>{const token=setTimeout(()=>{timers.delete(token);fn();},ms);timers.add(token);};
  const measure=()=>{scale=Math.abs(svg.getScreenCTM()?.a||1);};
  function knob(n){   // ручка: рывок на 90–180° за 0.5 с, затем пауза 2–3 с
    const r=(+n.dataset.r||0)+(Math.random()<.5?90:180)*(Math.random()<.35?-1:1);
    n.dataset.r=r; n.style.transform=`rotate(${r}deg)`;
    later(()=>knob(n),2000+Math.random()*1000);
  }
  function frame(t){
    if(lastPaint!==null&&t-lastPaint<1000/(mob.matches?12:24)){id=requestAnimationFrame(frame);return;}
    lastPaint=t;
    const k=scale, s=(t-t0)/1000;    // k — пикселей в единице SVG
    F.forEach(l=>{ const a=32/k, w=wave(l,s), mode=l.dataset.f;
      const x = mode==='l' ? -a*(1-w)/2 : mode==='r' ? a*(1-w)/2 : a*w;   // у края линия от него не отрывается
      l.style.transform=`translateX(${x.toFixed(2)}px)`; });
    D.forEach(d=>{ const v=(16/k*wave(d,s)).toFixed(2), sc=(1+.05*Math.sin(s*2*Math.PI/(per(d)*1.3) + +d.dataset.p*2)).toFixed(4);
      d.style.transform=(d.dataset.d==='x' ? `translateX(${v}px)` : `translateY(${v}px)`)+` scale(${sc})`; });
    id=requestAnimationFrame(frame);
  }
  return {
    tint, resize:measure,
    start(){ if(reduce||mob.matches||window.innerHeight<=500||id) return; measure();lastPaint=null;t0=performance.now()-run; id=requestAnimationFrame(frame);   // продолжаем с того же места
      N.forEach((n,i)=>later(()=>knob(n),700+i*450)); },
    stop(){ if(!id) return; cancelAnimationFrame(id); id=0; run=performance.now()-t0; timers.forEach(clearTimeout);timers.clear(); }
  };
})();
  $('#directionReset')?.addEventListener('click',()=>{
    form.elements.direction.value='';
    $$('input[name="direction"]').forEach(r=>{r.checked=false;});
    formArt.tint();
    form.dispatchEvent(new Event('input',{bubbles:true}));
    $('.pk input')?.focus({preventScroll:true});
  });
  window.addEventListener('resize',()=>{formArt.resize();if(window.innerHeight<=500)formArt.stop();else if(!modal.hidden)formArt.start();},{passive:true});
  reduceQuery.addEventListener('change',()=>{reduce=reduceQuery.matches;if(reduce)formArt.stop();else if(!modal.hidden)formArt.start();});
  $$('.pk input').forEach(r=>{
    let was=false;
    const notify=()=>{formArt.tint();r.dispatchEvent(new Event('input',{bubbles:true}));r.dispatchEvent(new Event('change',{bubbles:true}));};
    r.closest('.pk').addEventListener('pointerdown',()=>{was=r.checked;});
    r.addEventListener('click',()=>{if(was){r.checked=false;was=false;notify();}});
    r.addEventListener('keydown',event=>{
      if(event.key===' '){event.preventDefault();if(event.repeat)return;r.checked=!r.checked;was=false;notify();}
    });
  });
  const pageCity=document.body.dataset.city||'';
  const contactPhone=document.body.dataset.contactPhone||'+7 995 790-76-70';
  const fieldFocused=()=>sheet.classList.toggle('field-focused',sheet.contains(document.activeElement)&&document.activeElement.matches('input:not([type="radio"])'));
  sheet.addEventListener('focusin',fieldFocused);sheet.addEventListener('focusout',()=>queueMicrotask(fieldFocused));
  let lastFocus=null,pending=null,sending=false,captchaActive=false;
  document.addEventListener('tz:captcha-open',()=>{captchaActive=true;});
  document.addEventListener('tz:captcha-close',()=>{captchaActive=false;});
  const branchPicker=(()=>{
    const picker=$('.lead-branch-picker');
    if(!picker)return {sync(){},close(){}};
    const native=form.elements.branch,control=$('#leadBranchControl'),list=$('#leadBranchList'),value=$('#leadBranchValue');
    const options=[...native.options];
    let active=0,search='',searchTimer;
    const items=options.map((option,index)=>{
      const item=document.createElement('li');
      item.id='leadBranchOption'+index;item.role='option';item.textContent=option.textContent;
      item.addEventListener('pointerdown',event=>event.preventDefault());
      item.addEventListener('click',()=>choose(index));list.append(item);return item;
    });
    function highlight(index){
      active=(index+items.length)%items.length;
      items.forEach((item,i)=>item.classList.toggle('is-active',i===active));
      control.setAttribute('aria-activedescendant',items[active].id);
      items[active].scrollIntoView({block:'nearest'});
    }
    function hide(){list.hidden=true;control.setAttribute('aria-expanded','false');control.removeAttribute('aria-activedescendant');}
    function show(){list.hidden=false;control.setAttribute('aria-expanded','true');highlight(Math.max(0,native.selectedIndex));}
    function sync(){value.textContent=native.selectedOptions[0]?.textContent||'Выбери город';items.forEach((item,i)=>item.setAttribute('aria-selected',String(i===native.selectedIndex)));if(native.value)control.removeAttribute('aria-invalid');}
    function choose(index){native.value=options[index].value;sync();hide();native.dispatchEvent(new Event('input',{bubbles:true}));native.dispatchEvent(new Event('change',{bubbles:true}));control.focus();}
    control.addEventListener('click',()=>list.hidden?show():hide());
    control.addEventListener('keydown',event=>{
      const key=event.key;
      if(key==='Escape'&&!list.hidden){event.preventDefault();event.stopPropagation();hide();return;}
      if(key==='Tab'){hide();return;}
      if(['ArrowDown','ArrowUp','Home','End','Enter',' '].includes(key)){
        event.preventDefault();
        if(list.hidden){show();if(key==='Home')highlight(0);if(key==='End')highlight(items.length-1);return;}
        if(key==='Enter'||key===' ')choose(active);
        else highlight(key==='Home'?0:key==='End'?items.length-1:active+(key==='ArrowDown'?1:-1));
      }else if(key.length===1&&!event.ctrlKey&&!event.metaKey&&!event.altKey){
        event.preventDefault();if(list.hidden)show();search+=key.toLocaleLowerCase('ru');clearTimeout(searchTimer);searchTimer=setTimeout(()=>search='',700);
        const index=options.findIndex(option=>option.textContent.toLocaleLowerCase('ru').startsWith(search));if(index>=0)highlight(index);
      }
    });
    document.addEventListener('pointerdown',event=>{if(!picker.contains(event.target))hide();});
    control.addEventListener('blur',hide);
    native.addEventListener('invalid',event=>{event.preventDefault();control.setAttribute('aria-invalid','true');control.focus();show();status.textContent='Выбери свою точку.';});
    native.addEventListener('change',sync);
    native.hidden=true;picker.hidden=false;$('#leadBranchLabel').htmlFor=control.id;sync();
    return {sync,close:hide};
  })();
  function open(direction){
    lastFocus=document.activeElement;
    if(!direction) $$('input[name="direction"]').forEach(r=>{r.checked=false;});
    if(pageCity){form.elements.branch.value=pageCity;form.querySelector('.lead-branch-label').hidden=true;}
    if(direction){const radio=form.querySelector('input[name="direction"][value="'+direction+'"]');if(radio)radio.checked=true;}
    modal.classList.remove('is-success');form.hidden=false;success.hidden=true;sheet.setAttribute('aria-labelledby','leadTitle');status.textContent='';
    modal.hidden=false;modal.classList.remove('open');void sheet.offsetWidth;modal.classList.add('open');modal.setAttribute('aria-hidden','false');formArt.tint(true);formArt.start();sheet.focus({preventScroll:true});syncBranch();document.dispatchEvent(new CustomEvent('tz:lead-open'));
  }
  function close(){if(sending)return;branchPicker.close();formArt.stop();modal.classList.remove('open');modal.setAttribute('aria-hidden','true');modal.hidden=true;lastFocus?.focus({preventScroll:true});document.dispatchEvent(new CustomEvent('tz:lead-close'));}
  document.querySelectorAll('.openForm').forEach(el=>el.addEventListener('click',()=>open()));
  /* Preview and signup are separate actions on touch screens. */
  document.querySelectorAll('.card[data-dir]').forEach(el=>el.addEventListener('click',event=>{
    if(el.dataset.disclosure==='true'){
      if(event.target.closest?.('.direction-signup'))open(el.dataset.dir);
      return;
    }

    if(event.detail!==0&&Number.isFinite(event.clientX)&&Number.isFinite(event.clientY)){
      const r=el.getBoundingClientRect();
      if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)return;
    }
    const touch=matchMedia('(hover:none), (pointer:coarse)').matches;
    if(pageCity&&(matchMedia('(max-width:1000px)').matches||touch)&&event.detail!==0){
      const arrow=el.querySelector('.go');
      if(arrow?.contains(event.target)){open(el.dataset.dir);return;}
      if(!el.classList.contains('is-preview'))document.dispatchEvent(new CustomEvent('tz:direction-preview',{detail:{card:el}}));
      return;
    }
    open(el.dataset.dir);
  }));
  modal.querySelector('.lead-close').addEventListener('click',close);
  $('[data-lead-dismiss]')?.addEventListener('click',close);
  function scheduleFormFit(){document.dispatchEvent(new CustomEvent('tz:lead-layout'));}
  document.fonts?.ready.then(scheduleFormFit);
  form.addEventListener('change',scheduleFormFit);
  function syncFooterLines(){
    if(modal.hidden)return;
    const caption=modal.querySelector('#leadBranchCaption');
    if(!caption||caption.hidden)return;
    const line=parseFloat(getComputedStyle(caption).lineHeight);
    sheet.classList.toggle('has-wrapped-address',Number.isFinite(line)&&caption.getBoundingClientRect().height>line*1.5);
  }
  const scheduleFooterLines=()=>requestAnimationFrame(syncFooterLines);
  window.addEventListener('resize',scheduleFooterLines,{passive:true});
  document.fonts?.ready.then(scheduleFooterLines);
  if(window.ResizeObserver){const footerObserver=new window.ResizeObserver(scheduleFooterLines);footerObserver.observe(modal.querySelector('#leadBranchCaption'));}
  function syncBranch(){
    branchPicker.sync();
    const option=form.elements.branch.selectedOptions[0],caption=modal.querySelector('#leadBranchCaption');
    const label=option?.value?option.textContent:'Выбери город';
    const full=caption.querySelector?.('.lead-address-full'),short=caption.querySelector?.('.lead-address-short');
    if(full&&short){
      full.textContent=label;
      short.textContent=label.replace(/^([^,]+),\s*(?:ул\.\s*)?/,'$1 · ').replace(/(\d+)-ая(?=\s)/g,'$1-я');
    }else caption.textContent=label;
    caption.hidden=!option?.value;
    caption.href=option?.value?'https://yandex.ru/maps/?text='+encodeURIComponent(option.textContent.replace('·',',')):'#';
    scheduleFooterLines();scheduleFormFit();
  }
  form.elements.branch.addEventListener('change',syncBranch);
  let backdropStart=null,backdropDragged=false;
  modal.addEventListener('pointerdown',event=>{backdropStart={x:event.clientX,y:event.clientY};backdropDragged=false;});
  modal.addEventListener('pointermove',event=>{if(backdropStart&&Math.hypot(event.clientX-backdropStart.x,event.clientY-backdropStart.y)>10)backdropDragged=true;});
  modal.addEventListener('pointercancel',()=>{backdropDragged=true;backdropStart=null;});
  modal.addEventListener('click',event=>{if(event.target===modal&&!backdropDragged)close();});
  document.addEventListener('keydown',event=>{
    if(modal.hidden||captchaActive)return;
    if(event.key==='Escape')close();
    if(event.key==='Tab'){
      const items=[...modal.querySelectorAll('a,button,input,select,iframe')].filter(el=>!el.disabled&&el.offsetParent!==null&&el.tabIndex!==-1&&(el.type!=='radio'||el.checked||(!form.elements.direction.value&&el===$('.pk input'))));
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===sheet)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
function fmtPhone(v){
  let d=v.replace(/\D/g,'');
  if(d[0]==='8') d='7'+d.slice(1);
  if(d && d[0]!=='7') d='7'+d;
  d=d.slice(0,11);
  let o = d ? '+7' : '';
  if(d.length>1) o+=' ('+d.slice(1,4);
  if(d.length>=4) o+=')';
  if(d.length>4) o+=' '+d.slice(4,7);
  if(d.length>7) o+='-'+d.slice(7,9);
  if(d.length>9) o+='-'+d.slice(9,11);
  return o;
}
function maskPhone(el){
  const digitsBefore=(value,end)=>value.slice(0,end).replace(/\D/g,'').length;
  function render(value,count){
    el.value=fmtPhone(value);
    let caret=0,seen=0;
    while(caret<el.value.length&&seen<count){if(/\d/.test(el.value[caret]))seen++;caret++;}
    el.setSelectionRange?.(caret,caret);
  }
  el.addEventListener('beforeinput',event=>{
    if(!['deleteContentBackward','deleteContentForward'].includes(event.inputType)||!event.cancelable)return;
    const value=el.value,start=el.selectionStart,end=el.selectionEnd;
    if(start===null||end===null)return;
    const digits=value.replace(/\D/g,'');
    let first=digitsBefore(value,start),last=digitsBefore(value,end);
    if(start===end){
      if(event.inputType==='deleteContentBackward')first=Math.max(0,first-1);
      else last=Math.min(digits.length,last+1);
    }
    event.preventDefault();
    render(digits.slice(0,first)+digits.slice(last),first);
    el.dispatchEvent(new Event('input',{bubbles:true}));
  });
  el.addEventListener('input',()=>{
    const value=el.value,position=el.selectionStart??value.length;
    let count=digitsBefore(value,position);
    if(value.replace(/\D/g,'')&&!/^[78]/.test(value.replace(/\D/g,'')))count++;
    render(value,count);
  });
  el.addEventListener('blur',()=>{ if(el.value.replace(/\D/g,'').length<2) el.value=''; });
}
maskPhone(phone);
  const normalisePhone=value=>{let digits=value.replace(/\D/g,'');if(digits[0]==='8')digits='7'+digits.slice(1);if(digits.length===10)digits='7'+digits;return /^7\d{10}$/.test(digits)?'+'+digits:null;};
  phone.addEventListener('input',()=>phone.setCustomValidity(''));
  form.addEventListener('input',()=>{if(!sending)status.textContent='';});
  function showSuccess(){
    modal.classList.add('is-success');sheet.style.zoom='';sheet.style.width='';sheet.style.maxWidth='';sheet.style.maxHeight='';form.hidden=true;success.hidden=false;sheet.setAttribute('aria-labelledby','doneText');formArt.stop();status.textContent='';pending=null;
    form.reset();syncBranch();success.setAttribute('tabindex','-1');success.focus({preventScroll:true});
    document.dispatchEvent(new CustomEvent('tz:lead-success'));
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(sending)return;
    const normalized=normalisePhone(phone.value);
    if(!normalized){phone.setCustomValidity('Введи номер из 11 цифр, начиная с +7 или 8.');phone.reportValidity();return;}
    if(!form.reportValidity())return;
    if(form.elements.website.value)return;
    if(form.elements.name.value.trim().length<2){form.elements.name.setCustomValidity('Напиши имя: минимум 2 символа.');form.elements.name.reportValidity();return;}
    if(form.elements.surname.value.trim()&&form.elements.surname.value.trim().length<2){form.elements.surname.setCustomValidity('Введи фамилию: минимум 2 символа.');form.elements.surname.reportValidity();return;}
    const stamp=new Date().toISOString();
    const raw={name:form.elements.name.value.trim(),surname:form.elements.surname.value.trim(),phone:normalized,branch:form.elements.branch.value,direction:form.elements.direction.value||'unsure',website:'',pagePath:location.pathname};
    if(raw.name.length<2){form.elements.name.setCustomValidity('Напиши имя: минимум 2 символа.');form.elements.name.reportValidity();return;}
    if(pending&&Object.keys(raw).some(key=>pending[key]!==raw[key]))pending=null;
    if(!pending)pending={schemaVersion:2,requestId:crypto.randomUUID(),createdAt:stamp,...raw,privacyNoticeVersion:window.TZ_LEADS.privacyNoticeVersion};
    sending=true;button.disabled=true;status.textContent='Отправляем заявку…';
    const submission=pending;
    try{
      if(!window.TZLeadClient)throw new Error('Сервис недоступен. Пожалуйста, позвоните в школу.');
      await window.TZLeadClient.submit(submission);
      showSuccess();
    }catch(error){status.textContent=error.publicMessage||'Не удалось сохранить заявку. Попробуйте ещё раз или позвоните в школу.';}
    finally{sending=false;button.disabled=false;}
  });
  for(const field of [form.elements.name,form.elements.surname]){
    field.addEventListener('input',event=>{field.setCustomValidity('');if(!event.isComposing)capitalize(field);});
    field.addEventListener('compositionend',()=>capitalize(field));
  }
  function capitalize(field){
    const before=field.value,after=before.replace(/\p{L}/u,letter=>letter.toLocaleUpperCase('ru'));
    if(before===after)return;
    const start=field.selectionStart,end=field.selectionEnd;field.value=after;
    if(typeof start==='number')field.setSelectionRange(start,end);
  }
})();
