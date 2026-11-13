/* Public website -> fixed server-configured Telegram recipient. No credentials in HTML. */
const LEAD_ORIGINS = new Set(['https://tzvuka.ru','https://www.tzvuka.ru','https://killreal2227.github.io']);
const LEAD_BRANCHES = {troitsk:'Троицк',kaluga:'Калуга'};
const LEAD_DIRECTIONS = {vocal:'Вокал',guitar:'Гитара',drums:'Барабаны',piano:'Фортепиано',actor:'Актёрское мастерство',speech:'Ораторское искусство',unsure:'Пока не знаю'};
const leadJson=(body,status,origin)=>new Response(JSON.stringify(body),{status,headers:{'content-type':'application/json; charset=utf-8','cache-control':'no-store','vary':'Origin',...(origin?{'access-control-allow-origin':origin}:{})}});

async function leadBody(request){
  if(Number(request.headers.get('content-length'))>6000)throw new RangeError();
  const reader=request.body?.getReader();if(!reader)throw new SyntaxError();
  const parts=[];let size=0;
  try{while(true){const {value,done}=await reader.read();if(done)break;size+=value.byteLength;if(size>6000){await reader.cancel();throw new RangeError();}parts.push(value);}}
  finally{reader.releaseLock();}
  const buffer=new Uint8Array(size);let offset=0;for(const part of parts){buffer.set(part,offset);offset+=part.length;}
  return JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(buffer));
}

function leadValid(data,origin){
  if(!data||data.schemaVersion!==1||typeof data.requestId!=='string'||!/^[a-f0-9-]{36}$/i.test(data.requestId))return false;
  if(data.surname!==undefined&&(typeof data.surname!=='string'||data.surname.trim().length<2||data.surname.length>80||/[\x00-\x1f\x7f]/.test(data.surname)))return false;
  if(typeof data.name!=='string'||data.name.trim().length<2||data.name.length>80||/[\x00-\x1f\x7f]/.test(data.name))return false;
  if(typeof data.phone!=='string'||!/^\+7\d{10}$/.test(data.phone))return false;
  if(!Object.hasOwn(LEAD_BRANCHES,data.branch)||!Object.hasOwn(LEAD_DIRECTIONS,data.direction))return false;
  if(data.website!==''||typeof data.pagePath!=='string'||!['/','/troitsk/','/kaluga/','/tochka_zvuka/','/tochka_zvuka/troitsk/','/tochka_zvuka/kaluga/'].includes(data.pagePath))return false;
  const consent=data.consent;
  if(consent?.accepted!==true||consent.version!=='2026-11-10-v3'||!Number.isFinite(Date.parse(consent.acceptedAt))||!Number.isFinite(Date.parse(data.createdAt)))return false;
  if(Math.abs(Date.now()-Date.parse(consent.acceptedAt))>24*60*60*1000)return false;
  try{
    const doc=new URL(consent.documentUrl),privacy=new URL(consent.privacyUrl),prefix=origin==='https://killreal2227.github.io'?'/tochka_zvuka':'';
    if(doc.origin!==origin||privacy.origin!==origin||doc.pathname!==prefix+'/consent/'||privacy.pathname!==prefix+'/privacy/'||doc.search||privacy.search||doc.hash||privacy.hash)return false;
  }catch{return false;}
  return true;
}

export async function handleLeads(request,env,upstream=(...args)=>globalThis.fetch(...args)){
  const origin=request.headers.get('origin'),allowed=LEAD_ORIGINS.has(origin)?origin:null;
  const ready=/^\d{5,20}:[A-Za-z0-9_-]{20,}$/.test(env.BOT_TOKEN||'')&&/^-?\d{5,20}$/.test(env.LEADS_CHAT_ID||'')&&typeof env.LEADS_RATE_LIMITER?.limit==='function';
  if(new URL(request.url).pathname==='/leads/health'&&request.method==='GET')return leadJson({service:'website-leads',ready},200,allowed);
  if(new URL(request.url).pathname!=='/leads')return leadJson({error:'Not found'},404,allowed);
  if(!allowed)return leadJson({error:'Origin not allowed'},403,null);
  if(request.method==='OPTIONS')return new Response(null,{status:204,headers:{'access-control-allow-origin':allowed,'access-control-allow-methods':'POST, OPTIONS','access-control-allow-headers':'Content-Type','access-control-max-age':'600','vary':'Origin'}});
  if(request.method!=='POST')return leadJson({error:'Method not allowed'},405,allowed);
  if(!ready)return leadJson({error:'Service not configured'},503,allowed);
  if(!(request.headers.get('content-type')||'').toLowerCase().startsWith('application/json'))return leadJson({error:'JSON required'},415,allowed);
  try{
    const ip=request.headers.get('cf-connecting-ip');if(!ip)return leadJson({error:'Unavailable'},503,allowed);
    // Hashes are used only as ephemeral rate-limit keys. Do not log IPs or lead data.
    const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(env.BOT_TOKEN+'\0'+ip));
    const key=Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
    if(!(await env.LEADS_RATE_LIMITER.limit({key})).success)return leadJson({error:'Too many requests'},429,allowed);
    const data=await leadBody(request);
    if(!leadValid(data,allowed))return leadJson({error:'Invalid request'},400,allowed);
    const text=['Новая заявка с сайта «Точка звука»','',`Филиал: ${LEAD_BRANCHES[data.branch]}`,`Имя: ${data.name.trim()}${data.surname?" "+data.surname.trim():""}`,`Телефон: ${data.phone}`,`Направление: ${LEAD_DIRECTIONS[data.direction]}`,'',`Заявка: ${data.requestId}`,`Страница: ${data.pagePath}`,`Согласие: ${data.consent.version}, ${data.consent.acceptedAt}`,`Документ: ${data.consent.documentUrl}`].join('\n');
    const response=await upstream(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({chat_id:env.LEADS_CHAT_ID,text,link_preview_options:{is_disabled:true}}),redirect:'error',signal:AbortSignal.timeout(10000)});
    let telegram;try{telegram=await response.json();}catch{return leadJson({error:'Delivery not confirmed'},502,allowed);}
    if(!response.ok||telegram.ok!==true||!Number.isSafeInteger(telegram.result?.message_id))return leadJson({error:'Delivery not confirmed'},502,allowed);
    return leadJson({ok:true,requestId:data.requestId,leadId:String(telegram.result.message_id)},200,allowed);
  }catch(error){return leadJson({error:error instanceof RangeError?'Too large':'Delivery not confirmed'},error instanceof RangeError?413:error instanceof SyntaxError?400:502,allowed);}
}
