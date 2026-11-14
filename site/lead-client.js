/* Public settings only. Activation requires a separate deployment approval. */
window.TZ_LEADS=Object.assign({
 enabled:false,
 endpoint:null,
 siteKey:'',
 consentVersion:'2026-11-10-v3'
},window.TZ_LEADS||{});
(()=>{
 'use strict';
 let loading=null,widget=null,host=null,waiting=null,open=false,subscriptions=[];
 const fail=message=>Object.assign(new Error(message),{publicMessage:message});
 function settle(error,token){
  if(!waiting)return;
  const task=waiting;waiting=null;clearTimeout(task.timer);
  error?task.reject(error):task.resolve(token);
 }
 function load(){
  if(window.smartCaptcha)return Promise.resolve(window.smartCaptcha);
  if(loading)return loading;
  loading=new Promise((resolve,reject)=>{
   const script=document.createElement('script');
   const timer=setTimeout(()=>{script.remove();loading=null;reject(fail('Не удалось загрузить проверку. Попробуйте ещё раз.'));},12000);
   window.TZSmartCaptchaReady=()=>{if(window.smartCaptcha){clearTimeout(timer);resolve(window.smartCaptcha);}};
   script.src='https://smartcaptcha.cloud.yandex.ru/captcha.js?render=onload&onload=TZSmartCaptchaReady';script.async=true;script.defer=true;
   script.onload=()=>{clearTimeout(timer);if(window.smartCaptcha)resolve(window.smartCaptcha);else{loading=null;reject(fail('Проверка недоступна. Попробуйте ещё раз.'));}};
   script.onerror=()=>{clearTimeout(timer);script.remove();loading=null;reject(fail('Не удалось загрузить проверку. Проверьте соединение.'));};
   document.head.append(script);
  });
  return loading;
 }
 function layout(){document.dispatchEvent(new CustomEvent('tz:lead-layout'));}
 async function prepare(){
  const api=await load();
  if(!open)throw fail('Форма закрыта.');
  if(widget!==null)return api;
  host=document.createElement('div');host.className='lead-smartcaptcha';host.setAttribute('aria-label','Проверка безопасности');
  const status=document.getElementById('leadStatus');status.before(host);
  widget=api.render(host,{
   sitekey:window.TZ_LEADS.siteKey,invisible:true,hl:'ru',shieldPosition:'bottom-left',hideShield:false,
   callback:token=>{if(typeof token==='string'&&token.length)settle(null,token);else settle(fail('Проверка не пройдена. Попробуйте ещё раз.'));layout();}
  });
  for(const event of ['network-error','javascript-error','token-expired']){
   subscriptions.push(api.subscribe(widget,event,()=>{settle(fail('Проверка не пройдена. Попробуйте ещё раз.'));layout();}));
  }
  subscriptions.push(api.subscribe(widget,'challenge-visible',()=>{
   document.dispatchEvent(new CustomEvent('tz:captcha-open'));layout();
  }));
  subscriptions.push(api.subscribe(widget,'challenge-hidden',()=>{
   document.dispatchEvent(new CustomEvent('tz:captcha-close'));layout();
  }));
  return api;
 }
 async function token(){
  const api=await prepare();
  if(waiting)throw fail('Дождитесь окончания проверки.');
  return new Promise((resolve,reject)=>{
   waiting={resolve,reject,timer:setTimeout(()=>settle(fail('Проверка не завершилась. Попробуйте ещё раз.')),90000)};
   try{api.reset(widget);api.execute(widget);}catch{settle(fail('Не удалось запустить проверку. Попробуйте ещё раз.'));}
  });
 }
 document.addEventListener('tz:lead-open',()=>{
  open=true;if(window.TZ_LEADS.enabled===true)prepare().catch(()=>{});
 });
 document.addEventListener('tz:lead-close',()=>{
  open=false;settle(fail('Форма закрыта.'));
  subscriptions.forEach(unsubscribe=>unsubscribe());subscriptions=[];
  if(widget!==null&&window.smartCaptcha){window.smartCaptcha.destroy(widget);widget=null;}host?.remove();host=null;
  document.dispatchEvent(new CustomEvent('tz:captcha-close'));
 });
 window.TZLeadClient={
  async submit(payload){
   const config=window.TZ_LEADS;
   if(config.enabled!==true)throw fail('Отправка заявки пока недоступна. Пожалуйста, позвоните в школу.');
   let url;try{url=new URL(config.endpoint);}catch{throw fail('Сервис недоступен. Пожалуйста, позвоните в школу.');}
   if(!config.siteKey||url.protocol!=='https:')throw fail('Сервис недоступен. Пожалуйста, позвоните в школу.');
   const proof=await token(),controller=new AbortController(),timer=setTimeout(()=>controller.abort(),65000);
   try{
    let response;
    try{response=await fetch(url.href,{method:'POST',headers:{'Content-Type':'application/json'},
     body:JSON.stringify({...payload,captchaToken:proof}),credentials:'omit',redirect:'error',signal:controller.signal});}
    catch{throw fail('Не удалось получить подтверждение. Повторите отправку: повторная попытка использует тот же номер заявки.');}
    let data;try{data=await response.json();}catch{throw fail('Сервис не подтвердил сохранение. Попробуйте ещё раз.');}
    if(!response.ok){
     const message=response.status===429?'Слишком много попыток. Подождите минуту.':
      response.status===403?'Проверка не пройдена. Попробуйте ещё раз.':
      response.status===409?'Данные заявки изменились. Проверьте поля и отправьте снова.':'Не удалось сохранить заявку. Попробуйте ещё раз или позвоните в школу.';
     throw fail(message);
    }
    if(data.ok!==true||data.saved!==true||data.requestId!==payload.requestId||typeof data.leadId!=='string'||!data.leadId.length)throw fail('Сервис не подтвердил сохранение. Попробуйте ещё раз.');
    return data;
   }finally{clearTimeout(timer);if(widget!==null)window.smartCaptcha?.reset(widget);}
  }
 };
})();
