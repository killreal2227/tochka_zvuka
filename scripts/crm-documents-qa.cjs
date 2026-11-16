const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.TZ_PLAYWRIGHT_MODULE);
(async()=>{
 const root=path.resolve(__dirname,'../site'),out=path.resolve(__dirname,'../../tmp/crm-browser-qa');
 const browser=await chromium.launch({channel:'chrome',headless:true});
 try{for(const width of [390,1440]){
  const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
  await page.route('**/*',async route=>{
   const u=new URL(route.request().url());
   if(u.hostname!=='tzvuka.ru')return route.abort();
   const name=u.pathname.endsWith('/')?u.pathname+'index.html':u.pathname;
   const file=path.join(root,name);
   if(!file.startsWith(root)||!fs.existsSync(file))return route.fulfill({status:404,body:''});
   return route.fulfill({path:file});
  });
  await page.goto('https://tzvuka.ru/documents/');await page.evaluate(()=>document.fonts.ready);
  assert.ok((await page.locator('body').innerText()).includes('AlfaCRM'));
  assert.equal(await page.locator('body').evaluate(el=>el.scrollWidth>innerWidth+1),false);
  assert.equal(await page.locator('a[href="mailto:tzvuka@yandex.ru"]').count()>0,true);
  await page.screenshot({path:path.join(out,'documents-'+width+'.png')});
  await page.locator('#details').scrollIntoViewIfNeeded();
  await page.screenshot({path:path.join(out,'contacts-'+width+'.png')});
  console.log(JSON.stringify({width,documents:true,contacts:true,horizontalOverflow:false}));await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
