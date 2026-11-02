// Diagnostic DS : image native du cœur, jamais la bordure ou les boutons du lanceur.
// Argument facultatif : ROM personnelle lue localement, sans transfert vers un serveur.
import { startTestServer } from './server.mjs';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE || 'playwright');
const server=await startTestServer();
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--autoplay-policy=no-user-gesture-required']});
let failures=0;
try {
  for (const core of (process.env.DS_CORES || 'desmume2015,desmume').split(',')) {
    const context=await browser.newContext();
    const page=await context.newPage();
    page.on('dialog',d=>d.accept());
    try {
      await page.goto(server.url);
      await page.waitForFunction(()=>document.body.dataset.ready==='true');
      await page.getByRole('tab',{name:'Moteur',exact:true}).click();
      await page.locator('#ds-'+core).check();
      if (process.argv[2]) await page.locator('#romInput').setInputFiles(process.argv[2]);
      else await page.locator('[data-portable-demo="nds"]').click();
      const button=page.frameLocator('iframe.player-frame').locator('.ejs_start_button');
      await button.waitFor({timeout:120000});
      let running=false;
      for(let attempt=0;attempt<8 && !running;attempt++) {
        await button.click({timeout:5000}).catch(()=>{});
        running=await page.waitForFunction(()=>document.body.dataset.state==='running',null,{timeout:4000}).then(()=>true,()=>false);
      }
      if(!running)throw new Error('Le cœur ne démarre pas après huit appuis.');
      const sample=()=>page.evaluate(async()=>{
        const c=Object.values(window.__portablesBoots)[0].control;
        const bmp=await createImageBitmap(new Blob([await c.screenshot()],{type:'image/png'}));
        const g=new OffscreenCanvas(bmp.width,bmp.height).getContext('2d'); g.drawImage(bmp,0,0);
        const d=g.getImageData(0,0,bmp.width,bmp.height).data, colors=new Set();
        for(let i=0;i<d.length;i+=4)colors.add((d[i]<<16)|(d[i+1]<<8)|d[i+2]);
        const w=document.querySelector('iframe.player-frame').contentWindow;
        return {colors:colors.size,width:bmp.width,height:bmp.height,frame:w.EJS_emulator.gameManager.getFrameNum()};
      });
      await page.waitForTimeout(12000);
      const first=await sample();
      await page.waitForTimeout(8000);
      const second=await sample();
      const ok=first.colors>1 && second.colors>1 && second.frame>first.frame;
      if(!ok)failures++;
      console.log(JSON.stringify({core,ok,first,second,source:process.argv[2]?'ROM locale':'Pong-NDS'}));
    } catch(e) {failures++; console.log(JSON.stringify({core,error:e.message,status:await page.locator('#status').textContent()}));}
    finally {await context.close();}
  }
} finally {await browser.close();await server.close();}
process.exitCode=failures?1:0;
