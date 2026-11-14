/* Local WebKit layout check. Never submits forms or calls the leads backend. */
const {webkit}=require(process.env.PLAYWRIGHT_CORE||'playwright-core');
const http=require('node:http'),fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../site');
const server=http.createServer((req,res)=>{
 let file=path.join(root,decodeURIComponent(new URL(req.url,'http://localhost').pathname));
 if(!file.startsWith(root+path.sep)){res.writeHead(403).end();return;}
 if(fs.existsSync(file)&&fs.statSync(file).isDirectory())file=path.join(file,'index.html');
 const types={'.html':'text/html','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.ttf':'font/ttf'};
 if(!fs.existsSync(file)){res.writeHead(404).end();return;}
 res.setHeader('Content-Type',types[path.extname(file)]||'application/octet-stream');fs.createReadStream(file).pipe(res);
});
(async()=>{
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 const browser=await webkit.launch({headless:true});
 try{
  for(const branch of ['kaluga','troitsk'])for(const width of [320,375,390,430]){
   const context=await browser.newContext({viewport:{width,height:844},isMobile:true,hasTouch:true,deviceScaleFactor:3});
   const page=await context.newPage();
   await page.route('**/*',route=>route.request().url().startsWith(base)?route.continue():route.abort());
   await page.goto(base+'/'+branch+'/',{waitUntil:'load'});await page.evaluate(()=>document.fonts.ready);
   await page.locator('#how').scrollIntoViewIfNeeded();await page.waitForTimeout(80);
   const result=await page.evaluate(async()=>{
    const how=document.querySelector('#how'),steps=document.querySelector('#steps');let measurements=0;
    addEventListener('tz:module-layout',()=>measurements++);
    const start=how.getBoundingClientRect().top+scrollY;
    for(let i=0;i<12;i++){scrollBy(0,3);dispatchEvent(new Event('resize'));await new Promise(requestAnimationFrame);}
    const items=[...steps.children].map(el=>el.getBoundingClientRect());
    const gaps=items.slice(1).map((r,i)=>r.top-items[i].bottom);
    const line=getComputedStyle(steps,'::after');
    return {measurements,drift:Math.abs(how.getBoundingClientRect().top+scrollY-start),gaps,
      lineHeight:parseFloat(line.height),expectedHeight:steps.lastElementChild.offsetTop-steps.firstElementChild.offsetTop,
      lineTransition:line.transitionDuration,overflow:document.documentElement.scrollWidth>document.documentElement.clientWidth,
      stepOpacity:getComputedStyle(steps.querySelector('p')).opacity};
   });
   assert.equal(result.measurements,0,'height-only resize must not remeasure live sections');
   assert(result.drift<1,'section moved during slow scrolling');
   assert(result.gaps.every(gap=>gap>=23&&gap<=37),'stretched gaps between steps');
   assert(Math.abs(result.lineHeight-result.expectedHeight)<1,'line does not connect end dots');
   assert.equal(result.lineTransition,'0s');assert.equal(result.stepOpacity,'1');assert.equal(result.overflow,false);
   console.log(branch,width,'WebKit OK');await context.close();
  }
 }finally{await browser.close();server.close();}
})().catch(error=>{console.error(error);server.close();process.exitCode=1;});
