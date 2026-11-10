/* Public configuration contains no credentials. The server owns the bot token. */
window.TZ_LEADS = Object.assign({endpoint:null,consentVersion:'2026-11-10-v2'},window.TZ_LEADS||{});
(()=>{
  'use strict';
  const modal=document.getElementById('leadModal');
  if(!modal)return;
  const sheet=modal.querySelector('.lead-sheet'),form=document.getElementById('leadForm'),status=document.getElementById('leadStatus');
  const success=modal.querySelector('.lead-success'),button=form.querySelector('.lead-submit'),phone=form.elements.phone;
  const pageCity=document.body.dataset.city||'';
  let lastFocus=null,pending=null,sending=false;
  function open(direction){
    lastFocus=document.activeElement;
    if(pageCity)form.elements.branch.value=pageCity;
    if(direction){const radio=form.querySelector('input[name="direction"][value="'+direction+'"]');if(radio)radio.checked=true;}
    if(!window.TZ_LEADS.endpoint)status.textContent='Подключаем онлайн-запись. Пока можно записаться по телефону: +7 995 790-76-70.';
    modal.hidden=false;document.body.style.overflow='hidden';sheet.focus({preventScroll:true});
  }
  function close(){if(sending)return;modal.hidden=true;document.body.style.overflow='';lastFocus?.focus({preventScroll:true});}
  document.querySelectorAll('.openForm').forEach(el=>el.addEventListener('click',()=>open()));
  document.querySelectorAll('.card[data-dir]').forEach(el=>el.addEventListener('click',()=>open(el.dataset.dir)));
  modal.querySelector('.lead-close').addEventListener('click',close);
  modal.addEventListener('click',event=>{if(event.target===modal)close();});
  document.addEventListener('keydown',event=>{
    if(modal.hidden)return;
    if(event.key==='Escape')close();
    if(event.key==='Tab'){
      const items=[...modal.querySelectorAll('a,button,input,select')].filter(el=>!el.disabled&&el.offsetParent!==null&&el.tabIndex!==-1&&(el.type!=='radio'||el.checked));
      const first=items[0],last=items.at(-1);
      if(event.shiftKey&&(document.activeElement===first||document.activeElement===sheet)){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    }
  });
  const normalisePhone=value=>{let digits=value.replace(/\D/g,'');if(digits[0]==='8')digits='7'+digits.slice(1);if(digits.length===10)digits='7'+digits;return /^7\d{10}$/.test(digits)?'+'+digits:null;};
  phone.addEventListener('input',()=>phone.setCustomValidity(''));
  form.addEventListener('input',()=>{pending=null;status.textContent='';});
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(sending)return;
    const normalized=normalisePhone(phone.value);
    if(!normalized){phone.setCustomValidity('Введи номер из 11 цифр, начиная с +7 или 8.');phone.reportValidity();return;}
    if(!form.reportValidity())return;
    if(form.elements.website.value)return;
    const endpoint=window.TZ_LEADS.endpoint;
    if(!endpoint){status.textContent='Онлайн-запись ещё подключается. Позвони нам: +7 995 790-76-70 — поможем записаться.';return;}
    const url=new URL(endpoint,location.href);
    if(url.protocol!=='https:'&&!(url.protocol==='http:'&&url.hostname==='127.0.0.1')){status.textContent='Не удалось открыть запись. Позвони: +7 995 790-76-70.';return;}
    const stamp=new Date().toISOString();
    const raw={name:form.elements.name.value.trim(),phone:normalized,branch:form.elements.branch.value,direction:form.elements.direction.value,website:'',pagePath:location.pathname};
    if(raw.name.length<2){form.elements.name.setCustomValidity('Напиши имя: минимум 2 символа.');form.elements.name.reportValidity();return;}
    if(!pending)pending={schemaVersion:1,requestId:crypto.randomUUID(),createdAt:stamp,...raw,consent:{accepted:true,acceptedAt:stamp,version:window.TZ_LEADS.consentVersion,documentUrl:new URL(document.querySelector('.lead-consent a').getAttribute('href'),location.href).href,privacyUrl:new URL(document.querySelectorAll('.lead-consent a')[1].getAttribute('href'),location.href).href}};
    sending=true;button.disabled=true;status.textContent='Отправляем заявку…';
    const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),15000);
    try{
      const response=await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(pending),credentials:'omit',redirect:'error',signal:controller.signal});
      let data;try{data=await response.json();}catch{throw new Error('Сервис не подтвердил приём. Позвони нам, чтобы уточнить запись.');}
      if(!response.ok||data.ok!==true||data.requestId!==pending.requestId||typeof data.leadId!=='string'){
        throw new Error(response.status===429?'Слишком много попыток. Подожди минуту или позвони нам.':'Сервис не подтвердил приём. Позвони нам, чтобы уточнить запись.');
      }
      form.hidden=true;success.hidden=false;status.textContent='';pending=null;
    }catch(error){status.textContent=error.name==='AbortError'?'Не дождались подтверждения. Заявка могла дойти — уточни запись по телефону, чтобы не дублировать обращение.':error.message||'Нет подтверждения приёма заявки. Позвони нам.';}
    finally{clearTimeout(timer);sending=false;button.disabled=false;}
  });
  form.elements.name.addEventListener('input',()=>form.elements.name.setCustomValidity(''));
})();
