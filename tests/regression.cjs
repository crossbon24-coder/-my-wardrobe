/* Isolated Chromium integration checks. Synthetic images/model outputs only.
 * Run: node tests/regression.cjs (requires Playwright + its Chromium binary).
 * Never connects to GitHub Pages or the user's IndexedDB.
 */
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const assert = require('node:assert/strict');
const root = join(__dirname, '..');
const server = createServer((req, res) => {
  const path = req.url.split('?')[0];
  const file = path === '/version.json' ? 'version.json' : path === '/' ? 'index.html' : null;
  if (!file) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : 'text/html; charset=utf-8');
  res.end(readFileSync(join(root, file)));
});
let browser, passed = 0;
const errors = [];
async function check(name, fn) { await fn(); console.log('PASS', name); passed++; }
(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, ...(process.env.WARDROBE_TEST_CHROMIUM ? { executablePath: process.env.WARDROBE_TEST_CHROMIUM, args: ['--no-sandbox','--disable-dev-shm-usage'] } : {}) });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  // No real user photos, paid APIs or remote models are used by this suite.
  await page.route('https://**/*', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => document.getElementById('summary').textContent.includes('옷 0벌'));
  await page.evaluate(() => {
    window.alerts = []; window.alert = text => alerts.push(text); window.confirm = () => true;
    window.fixture = async (id='legacy', color='#65704c') => {
      const c=document.createElement('canvas');c.width=c.height=96;
      const ctx=c.getContext('2d');ctx.fillStyle='#fff';ctx.fillRect(0,0,96,96);ctx.fillStyle=color;ctx.fillRect(20,14,56,68);
      const image=await new Promise(r=>c.toBlob(r,'image/png'));
      return {id,image,category:'아우터',type:'패딩',color:'카키/올리브',season:'겨울',formality:2,memo:'기존 메모',createdAt:1000,wearCount:3,lastWorn:500,legacyExtra:{keep:true}};
    };
    window.gridPixels = (foreground, background=[255,255,255]) => {
      const d=new Uint8ClampedArray(96*96*4);
      for(let y=0;y<96;y++)for(let x=0;x<96;x++){
        const rgb=x>=20&&x<76&&y>=14&&y<82?foreground:background;
        d.set([...rgb,255],(y*96+x)*4);
      }return d;
    };
  });
  await check('DB name/version/stores stay compatible; startup needs no model', async () => {
    assert.deepEqual(await page.evaluate(() => [db.name, db.version, [...db.objectStoreNames],typeof window.tf]), ['wardrobeDB',1,['clothes','outfits'],'undefined']);
    assert.equal(await page.evaluate(() => APP_VERSION), JSON.parse(readFileSync(join(root,'version.json'))).version);
  });
  await check('Generic coat labels never force a padded coat into subtype coat', async () => {
    const r=await page.evaluate(()=>mapPredictions([{className:'trench coat',probability:.65},{className:'fur coat',probability:.15}]));
    assert.equal(r.category,'아우터');assert.equal(r.type,'');
  });
  await check('Category combines shoe evidence while subtype remains uncertain', async () => {
    const r=await page.evaluate(()=>mapPredictions([{className:'running shoe',probability:.11},{className:'loafer',probability:.10},{className:'cowboy boot',probability:.09}]));
    assert.equal(r.category,'신발');assert.equal(r.type,'');
  });
  await check('Strong boot evidence can suggest boots', async () => {
    const r=await page.evaluate(()=>mapPredictions([{className:'cowboy boot',probability:.8},{className:'running shoe',probability:.06}]));
    assert.equal(r.category,'신발');assert.equal(r.type,'부츠');
  });
  await check('Competing categories and dominant unmapped classes cause abstention', async () => {
    for(const preds of [[{className:'trench coat',probability:.4},{className:'cowboy boot',probability:.36}],[{className:'chair',probability:.7},{className:'trench coat',probability:.26}]]){
      assert.equal(await page.evaluate(p=>mapPredictions(p).category,preds),'');
    }
    assert.equal(await page.evaluate(()=>mapPredictions([{className:'book jacket, dust cover, dust jacket, dust wrapper',probability:.99}]).category),'');
  });
  await check('Manual category, subtype and color survive late AI and reanalysis', async () => {
    const r=await page.evaluate(()=>{
      const x={category:'아우터',type:'패딩',color:'카키/올리브',manual:{category:true,type:true,color:true}};
      applyCategoryResult(x,mapPredictions([{className:'cowboy boot',probability:.9}]));
      applyColorResult(x,{name:'회색',rgb:[100,100,100],reliable:true});return [x.category,x.type,x.color];
    });assert.deepEqual(r,['아우터','패딩','카키/올리브']);
  });
  await check('Zero median and white foreground are retained correctly', async () => {
    const r=await page.evaluate(()=>[median([0,0,0]),analyzeColorPixels(gridPixels([250,250,250],[50,50,50]))]);
    assert.equal(r[0],0);assert.equal(r[1].name,'흰색');assert.equal(r[1].reliable,true);
  });
  await check('Low-saturation olive abstains; true grey and olive remain usable', async () => {
    const r=await page.evaluate(()=>[[125,128,120],[100,100,100],[100,104,96]].map(rgb=>analyzeColorPixels(gridPixels(rgb))));
    assert.equal(r[0].reliable,false);assert.match(r[0].reason,/카키/);
    assert.equal(r[1].name,'회색');assert.equal(r[1].reliable,true);
    assert.equal(r[2].name,'카키/올리브');assert.equal(r[2].reliable,true);
  });
  await check('Unsupported dominant color and missing foreground do not force a supported color', async () => {
    const r=await page.evaluate(()=>[analyzeColorPixels(gridPixels([255,0,0])),analyzeColorPixels(gridPixels([255,255,255]))]);
    assert.equal(r[0].name,'기타');assert.equal(r[0].reliable,false);assert.equal(r[1].reliable,false);
  });
  await check('Weather preference changes summer/winter ranking', async () => {
    const r=await page.evaluate(()=>{
      const summer={season:'여름',formality:2},winter={season:'겨울',formality:2};
      return [itemScore(summer,2,'hot')>itemScore(winter,2,'hot'),itemScore(winter,2,'cold')>itemScore(summer,2,'cold')];
    });assert.deepEqual(r,[true,true]);
  });
  await check('Legacy backup preserves image bytes, wear counts, unknown properties and outfits', async () => {
    const r=await page.evaluate(async()=>{
      const c=await fixture(),legacy={app:'my-wardrobe',version:'3.1',clothes:[{...c,image:await b64(c.image)}],outfits:[{id:42,legacyShape:{clothIds:['legacy']},note:'keep'}]};
      await replaceWardrobe(await prepareRestore(legacy));await refresh();const back=await makeBackup();
      return {original:legacy.clothes[0],actual:back.clothes[0],outfits:back.outfits};
    });assert.deepEqual(r.actual,r.original);assert.deepEqual(r.outfits,[{id:42,legacyShape:{clothIds:['legacy']},note:'keep'}]);
  });
  await check('Malformed backup image and duplicate ID reject before any existing records are cleared', async () => {
    const r=await page.evaluate(async()=>{
      const backup=await makeBackup(),before=JSON.stringify(backup.clothes);let caught=0;
      for(const bad of [{...backup,clothes:[{...backup.clothes[0],image:'data:image/png;base64,YmFk'}]},{...backup,clothes:[backup.clothes[0],backup.clothes[0]]},{...backup,outfits:{}}]){
        try{await replaceWardrobe(await prepareRestore(bad))}catch{caught++}
      }
      return [caught,JSON.stringify((await makeBackup()).clothes)===before];
    });assert.deepEqual(r,[3,true]);
  });
  await check('Transaction failure rolls both stores back, including clears and earlier successful writes', async () => {
    const r=await page.evaluate(async()=>{
      const before=await makeBackup();let caught=false;
      try{await replaceWardrobe({clothes:[await fixture('new')],outfits:[{id:'duplicate'},{id:'duplicate'}]})}catch{caught=true}
      const after=await makeBackup();return [caught,JSON.stringify(before.clothes)===JSON.stringify(after.clothes),JSON.stringify(before.outfits)===JSON.stringify(after.outfits)];
    });assert.deepEqual(r,[true,true,true]);
  });
  await check('Synchronous write error also aborts queued changes', async () => {
    const r=await page.evaluate(async()=>{
      let caught=false;try{await replaceWardrobe({clothes:[await fixture('new')],outfits:[{}]})}catch{caught=true}
      return [caught,(await all('clothes'))[0].id,(await all('outfits'))[0].id];
    });assert.deepEqual(r,[true,'legacy',42]);
  });
  await check('Wear and edit commit safely and preserve legacy extras', async () => {
    const r=await page.evaluate(async()=>{
      await wear('legacy');openEdit('legacy');$('editMemo').value='changed';await saveEdit();const c=(await all('clothes'))[0];return [c.wearCount,c.memo,c.legacyExtra.keep];
    });assert.deepEqual(r,[4,'changed',true]);
  });
  await check('Escaped memo and ID cannot create executable HTML', async () => {
    const r=await page.evaluate(async()=>{
      const c=await fixture('a\'"<>&');c.memo='<img src=x onerror="window.injected=true">';await put('clothes',c);await refresh();
      return [$('items').querySelectorAll('img').length,$('items').textContent.includes(c.memo),window.injected||false];
    });assert.deepEqual(r,[2,true,false]);
  });
  await check('Object URLs are reused and obsolete records are released', async () => {
    const r=await page.evaluate(async()=>{const c=clothes[0],first=url(c.image);render();const same=url(c.image)===first;batch=[];await refresh();return [same,imageURLs.size===clothes.length]});assert.deepEqual(r,[true,true]);
  });
  await check('Model failure permits a successful retry on the same page', async () => {
    const r=await page.evaluate(async()=>{
      let calls=0;window.tf={ready:async()=>{}};window.mobilenet={load:async()=>{calls++;if(calls===1)throw new Error('offline');return {classify:async()=>[{className:'trench coat',probability:.8}],dispose(){}}}};
      visionModel=null;modelPromise=null;const first=await loadVisionModel(),second=await loadVisionModel();return [first===null,!!second,calls];
    });assert.deepEqual(r,[true,true,2]);
  });
  await check('Batch upload, confirmation, save and diagnostic export share no photo/memo data', async () => {
    const r=await page.evaluate(async()=>{
      const c=await fixture();const file=new File([c.image],'test.png',{type:'image/png'});
      await $('photo').onchange({target:{files:[file],value:''}});
      const hasCategory=batch[0].category==='아우터'&&batch[0].type==='';
      qset(0,'category','아우터');qset(0,'type','패딩');qset(0,'color','카키/올리브');qset(0,'memo','private memo');
      const before=(await all('clothes')).length;await saveBatch();
      const rows=diagnosticRows([]);const data=lastDiagnostics[0];return [hasCategory,(await all('clothes')).length===before+1,batch.length,data.selection,data.userConfirmed,JSON.stringify(lastDiagnostics).includes('private memo'),JSON.stringify(lastDiagnostics).includes('data:image')];
    });assert.deepEqual(r,[true,true,0,{category:'아우터',type:'패딩',color:'카키/올리브'},{category:true,type:true,color:true},false,false]);
  });
  await check('Restore cancellation preserves the current wardrobe', async () => {
    const r=await page.evaluate(async()=>{const before=(await all('clothes')).length;window.confirm=()=>false;await restoreBackup(new File([JSON.stringify({app:'my-wardrobe',version:'3.6',clothes:[],outfits:[]})],'backup.json'));window.confirm=()=>true;return [(await all('clothes')).length===before,mutationBusy]});assert.deepEqual(r,[true,false]);
  });
  await check('Edits made during actual asynchronous reanalysis survive its completion', async () => {
    const r=await page.evaluate(async()=>{
      const image=(await fixture()).image;
      batch=[{image,category:'',type:'',color:'',manual:{},requestId:0,aiStatus:'대기',season:'사계절',formality:2,memo:''}];
      applyColorResult(batch[0],await estimateColor(image));renderQueue();
      let release;const waiting=new Promise(resolve=>{release=resolve});visionModel={classify:()=>waiting};
      const pending=reanalyze(0);qset(0,'category','아우터');qset(0,'type','패딩');qset(0,'color','카키/올리브');
      release([{className:'cowboy boot',probability:.95}]);await pending;
      const result=[batch[0].category,batch[0].type,batch[0].color,$('batchBtn').disabled];batch=[];renderQueue();return result;
    });assert.deepEqual(r,['아우터','패딩','카키/올리브',false]);
  });
  await check('Overlapping batch-save requests create each garment only once', async () => {
    const r=await page.evaluate(async()=>{
      const image=(await fixture()).image,col=await estimateColor(image);
      batch=[{image,category:'아우터',type:'패딩',color:'카키/올리브',manual:{category:true},colorAnalysis:col,autoRgb:col.rgb,autoColor:col.name,season:'겨울',formality:2,memo:''}];
      const before=(await all('clothes')).length;await Promise.all([saveBatch(),saveBatch()]);return (await all('clothes')).length-before;
    });assert.equal(r,1);
  });
  await check('Unavailable CDN leaves upload usable for manual registration', async () => {
    const r=await page.evaluate(async()=>{
      visionModel=null;modelPromise=null;scriptLoads.clear();delete window.tf;delete window.mobilenet;
      const image=(await fixture()).image;
      await $('photo').onchange({target:{files:[new File([image],'offline.png',{type:'image/png'})],value:''}});
      return [batch.length,batch[0].category,processing,$('photo').disabled,$('modelStatus').textContent];
    });assert.deepEqual(r.slice(0,4),[1,'',false,false]);assert.match(r[4],/직접 선택/);
  });
  await check('No unexpected runtime errors', async () => assert.deepEqual(errors,[]));
  console.log(`\n${passed} checks passed. Real garment accuracy and iPhone Safari remain unverified.`);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close()});
