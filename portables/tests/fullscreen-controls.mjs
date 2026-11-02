// Vrai moteur GBA, entrée tactile et vraie API Fullscreen. Aucun téléphone physique revendiqué.
import assert from 'node:assert/strict';
import {startTestServer} from './server.mjs';
import {mkdir} from 'node:fs/promises';
const {chromium}=await import(process.env.PLAYWRIGHT_MODULE||'playwright');
const server=process.env.TEST_URL?{url:process.env.TEST_URL,close:async()=>{}}:await startTestServer();
const browser=await chromium.launch({headless:true,executablePath:process.env.CHROMIUM_PATH,args:['--autoplay-policy=no-user-gesture-required']});
const output=process.env.EVIDENCE_DIR; if(output)await mkdir(output,{recursive:true});
try{
 for(const [name,viewport]of [['paysage',{width:844,height:390}],['portrait',{width:390,height:844}],['tablette',{width:1024,height:768}]]){
  const context=await browser.newContext({viewport,isMobile:true,hasTouch:true,userAgent:'Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Mobile Safari/537.36'});
  const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));page.on('dialog',d=>d.accept());
  await page.goto(server.url);await page.waitForFunction(()=>document.body.dataset.ready==='true');
  if(process.argv[2])await page.locator('#romInput').setInputFiles(process.argv[2]);
  else await page.locator('[data-portable-demo="gba"]').click();
  const frame=()=>page.frames().find(f=>f.url().includes('player.html'));
  const button=page.frameLocator('iframe.player-frame').locator('.ejs_start_button');await button.waitFor({timeout:120000});
  for(let i=0;i<8;i++){await button.click({timeout:5000}).catch(()=>{});if(await page.waitForFunction(()=>document.body.dataset.state==='running',null,{timeout:4000}).then(()=>true,()=>false))break;}
  await frame().waitForFunction(()=>document.querySelector('.ejs_parent[data-portable-touch-controls]'));
  await frame().evaluate(()=>{
    window.inputCalls=[];const gm=EJS_emulator.gameManager,original=gm.simulateInput.bind(gm);
    gm.simulateInput=(...args)=>{inputCalls.push(args);return original(...args);};
    const b=document.createElement('button');b.id='test-enter-fullscreen';b.textContent='Test plein écran';b.style='position:fixed;top:0;left:0;z-index:999999';
    b.onclick=()=>EJS_emulator.elements.parent.requestFullscreen();document.body.append(b);
  });
  const geometry=()=>frame().evaluate(()=>{
    const rect=n=>{const r=n.getBoundingClientRect();return {x:r.x,y:r.y,width:r.width,height:r.height,bottom:r.bottom,right:r.right};};
    const game=rect(document.querySelector('.ejs_canvas_parent'));
    const buttons=[...document.querySelectorAll('.ejs_virtualGamepad_bottom .ejs_virtualGamepad_button')].map(n=>({label:n.textContent,rect:rect(n),background:getComputedStyle(n).backgroundColor,color:getComputedStyle(n).color}));
    const pad=getComputedStyle(document.querySelector('.ejs_virtualGamepad_parent'));
    return {fullscreen:!!document.fullscreenElement,width:innerWidth,height:innerHeight,game,buttons,padVisible:pad.display!=='none'&&Number(pad.opacity)>0.9};
  });
  const check=g=>{
    assert.equal(g.padVisible,true,'Manette réellement visible');
    assert.equal(g.buttons.length,4);
    for(const b of g.buttons){assert.ok(b.rect.height>=44);assert.ok(b.rect.width>=44);assert.ok(b.rect.y>=g.game.bottom-1,`${b.label} recouvre le jeu`);assert.ok(b.rect.bottom<=g.height+1);assert.ok(b.rect.x>=-1&&b.rect.right<=g.width+1);assert.equal(b.color,'rgb(255, 255, 255)');assert.equal(b.background,'rgb(36, 52, 76)');}
  };
  await page.waitForTimeout(300);
  check(await geometry());
  await frame().locator('#test-enter-fullscreen').click();await frame().waitForFunction(()=>!!document.fullscreenElement);await frame().locator('#test-enter-fullscreen').evaluate(n=>n.remove());
  await page.waitForTimeout(1200);const full=await geometry();check(full);assert.equal(full.fullscreen,true);
  for(const [className,index]of [['b_start',3],['b_select',2],['b_speed_fast',27],['b_speed_slow',29]]){
    const box=await frame().locator('.ejs_virtualGamepad_bottom .'+className).boundingBox();assert.ok(box);
    await page.touchscreen.tap(box.x+box.width/2,box.y+box.height/2);await page.waitForTimeout(100);
    const calls=await frame().evaluate(()=>inputCalls);
    assert.ok(calls.some(c=>c[1]===index&&c[2]===1),className+' press');assert.ok(calls.some(c=>c[1]===index&&c[2]===0),className+' release');
  }
  if(output)await page.screenshot({path:output+'/'+name+'-plein-ecran.png'});
  await frame().evaluate(()=>document.exitFullscreen());await frame().waitForFunction(()=>!document.fullscreenElement);await page.waitForTimeout(250);check(await geometry());
  assert.deepEqual(errors,[]);console.log('PASS plein écran '+name+' : bande hors image, 4 cibles tactiles >=44 px, entrée/sortie, press/release Start Select Fast Slow.');
  await context.close();
 }
}finally{await browser.close();await server.close();}
