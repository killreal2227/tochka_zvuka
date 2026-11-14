// Local-only browser integration. All network requests are intercepted; no real leads are sent.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium,webkit}=require(process.env.TZ_PLAYWRIGHT_MODULE||'playwright');
(async()=>{
 const root=path.resolve(__dirname,'../site'),saved=new Map();
 const profiles=[{width:320,height:568},{width:390,height:844},{width:430,height:932},{width:768,height:1024},{width:1024,height:768},{width:1440,height:900}];
 for(const [engineName,engine]of[['Chrome',chromium],['WebKit',webkit]]){
  const browser=await engine.launch(engineName==='Chrome'?{channel:'chrome',headless:true}:{headless:true});
  try{for(const viewport of profiles){
   const mobile=viewport.width<500,branch=viewport.width%3?'kaluga':'troitsk';
   const context=await browser.newContext({viewport,isMobile:mobile,hasTouch:mobile,reducedMotion:'reduce'});
   const page=await context.newPage(),errors=[],payloads=[];page.on('pageerror',e=>errors.push(e.message));
   let loseFirst=true;
   await page.route('**/*',async route=>{
    const request=route.request(),u=new URL(request.url());
    if(u.hostname==='tzvuka.ru'&&u.pathname==='/lead-config.js')return route.fulfill({contentType:'text/javascript',body:"window.TZ_LEADS={enabled:true,endpoint:'https://fixture.apigw.yandexcloud.net/leads',siteKey:'fixture-key',privacyNoticeVersion:'2026-11-14-v2'};"});
    if(u.hostname==='smartcaptcha.cloud.yandex.ru'){
     return route.fulfill({contentType:'text/javascript',body:"window.smartCaptcha={render:(host,options)=>{window.fixtureChallenge=options;return 'fixture-widget';},subscribe:()=>()=>{},reset:()=>{},destroy:()=>{},execute:()=>setTimeout(()=>window.fixtureChallenge.callback('fixture-proof'),50)};window.TZSmartCaptchaReady?.();"});
    }
    if(u.hostname==='fixture.apigw.yandexcloud.net'){
     if(request.method()==='OPTIONS')return route.fulfill({status:204,headers:{'access-control-allow-origin':'https://tzvuka.ru','access-control-allow-methods':'POST','access-control-allow-headers':'Content-Type'}});
     const payload=request.postDataJSON();payloads.push(payload);
     assert.equal(payload.captchaToken,'fixture-proof');assert.equal(payload.schemaVersion,2);assert.equal(payload.privacyNoticeVersion,'2026-11-14-v2');assert.equal('consent' in payload,false);if(mobile)assert.equal(payload.surname,'');
     if(!saved.has(payload.requestId))saved.set(payload.requestId,{id:'fixture-'+payload.requestId,branch:payload.branch});
     if(loseFirst){loseFirst=false;return route.abort('failed');}
     return route.fulfill({status:200,headers:{'access-control-allow-origin':'https://tzvuka.ru','content-type':'application/json'},body:JSON.stringify({ok:true,saved:true,requestId:payload.requestId,leadId:saved.get(payload.requestId).id})});
    }
    if(u.hostname!=='tzvuka.ru'){errors.push('Unexpected external network request: '+u.hostname);return route.abort();}
    let file=path.resolve(root,'.'+decodeURIComponent(u.pathname));
    if(!file.startsWith(root+path.sep)&&file!==root)return route.abort();
    try{if(fs.statSync(file).isDirectory())file=path.join(file,'index.html');return route.fulfill({path:file});}catch{return route.fulfill({status:404,body:''});}
   });
   await page.addInitScript(()=>{window.TZ_LEADS={enabled:true,endpoint:'https://fixture.apigw.yandexcloud.net/public/lead',siteKey:'fixture-key'};});
   await page.goto('https://tzvuka.ru/'+branch+'/');await page.evaluate(()=>document.fonts.ready);
   await page.locator('#join .openForm').click();
   const before=await page.evaluate(()=>({y:-parseFloat(document.body.style.top),body:document.body.getBoundingClientRect().height}));
   await page.locator('[name=name]').fill('тест');
   if(!mobile)await page.locator('[name=surname]').fill('вымышленный');
   await page.locator('[name=phone]').fill('89990000000');
   await page.locator('#d-vocal').check({force:true});
   if(mobile){
    await page.evaluate(()=>{
     const v=visualViewport;window.fixtureViewport={height:v.height,top:v.offsetTop,full:v.height};
     Object.defineProperty(v,'height',{configurable:true,get:()=>window.fixtureViewport.height});
     Object.defineProperty(v,'offsetTop',{configurable:true,get:()=>window.fixtureViewport.top});
     window.fixtureViewport.height*=.4;window.fixtureViewport.top=20;visualViewport.dispatchEvent(new Event('resize'));
    });
    for(const name of ['name','surname','phone']){
     await page.locator('[name='+name+']').focus();await page.waitForTimeout(80);
     const visible=await page.evaluate(()=>{const r=document.activeElement.getBoundingClientRect(),s=document.querySelector('.sheet-body').getBoundingClientRect(),x=document.querySelector('.lead-close').getBoundingClientRect();return r.top>=x.bottom-1&&r.bottom<=s.bottom+1&&x.top>=visualViewport.offsetTop-1;});
     assert(visible,engineName+' active field above keyboard at '+viewport.width);
    }
    assert.equal(await page.evaluate(()=>Math.round(document.body.getBoundingClientRect().height)),Math.round(before.body));
    await page.evaluate(()=>{window.fixtureViewport.height=window.fixtureViewport.full;window.fixtureViewport.top=0;visualViewport.dispatchEvent(new Event('resize'));});
   }
   await page.evaluate(()=>{document.getElementById('leadForm').requestSubmit();document.getElementById('leadForm').requestSubmit();});
   await page.waitForFunction(()=>!document.getElementById('submitBtn').disabled&&document.getElementById('leadStatus').textContent.length>0);
   assert.equal(payloads.length,1);assert.equal(await page.locator('#done').isVisible(),false);
   // Simulate a repeated autofill input with unchanged data: requestId must survive.
   await page.locator('[name=name]').dispatchEvent('input');
   await page.locator('#submitBtn').click();await page.locator('.success-confirm').waitFor();
   assert.equal(payloads.length,2);assert.equal(payloads[0].requestId,payloads[1].requestId);
   assert.equal(payloads[1].branch,branch);assert.equal(payloads[1].direction,'vocal');assert.equal(payloads[1].name,'Тест');
   await page.locator('.success-confirm').click();await page.waitForTimeout(80);
   assert.equal(await page.evaluate(()=>document.body.style.position),'');
   assert(Math.abs(await page.evaluate(()=>scrollY)-before.y)<=2);
   assert.equal(errors.length,0,errors.join('; '));
   console.log(engineName,viewport.width,branch,'keyboard, retry, one mock lead, success and scroll restoration: OK');
   await context.close();
  }}finally{await browser.close();}
 }
 assert.equal(saved.size,12);
 console.log('12 browser profiles passed with mocked SmartCaptcha and API; NO YDB compatibility claim.');
})().catch(e=>{console.error(e.message);process.exitCode=1;});
