/* Isolated Chromium checks. Synthetic images and controlled/recorded model outputs.
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
  const file = path === '/version.json' ? 'version.json' : path === '/' ? 'index.html' : ['/wardrobe-import.js','/product-shortcut.js'].includes(path) ? path.slice(1) : null;
  if (!file) { res.writeHead(404).end(); return; }
  res.setHeader('Content-Type', file.endsWith('.json') ? 'application/json' : file.endsWith('.js') ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
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
    window.makeTfStub=()=>({ready:async()=>{},setBackend:async name=>{window.selectedBackend=name;return true},getBackend:()=>window.selectedBackend||'cpu',tensor3d:(data,shape,dtype)=>({data,shape,dtype,dispose(){window.disposedInputs=(window.disposedInputs||0)+1}})});
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
      let calls=0;window.tf=makeTfStub();window.mobilenet={load:async()=>{calls++;if(calls===1)throw new Error('offline');return {classify:async()=>[{className:'trench coat',probability:.8}],dispose(){}}}};
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
  await check('RGB input is nonempty, image-specific and uses 0..255 numeric tensors', async () => {
    const r=await page.evaluate(async()=>{
      const a=await fixture('a','#215c99'),b=await fixture('b','#b32828');
      const aa=await prepareVisionInput(a.image),bb=await prepareVisionInput(b.image);let received;
      window.tf=makeTfStub();visionModel={classify:async tensor=>{received={shape:tensor.shape,dtype:tensor.dtype,min:Math.min(...tensor.data.slice(0,300)),max:Math.max(...tensor.data.slice(0,300))};return [{className:'jean, blue jean, denim',probability:.9}]}};
      const before=window.disposedInputs||0,result=await classifyGarment(a.image);await Promise.resolve();
      return [aa.input.sha256!==bb.input.sha256,aa.input.stdDev>1,bb.input.stdDev>1,aa.rgb.length,received,result.category,result.backend,(window.disposedInputs||0)>before];
    });assert.deepEqual(r,[true,true,true,224*224*3,{shape:[224,224,3],dtype:'int32',min:255,max:255},'하의','cpu',true]);
  });
  await check('Repeated predictions across different inputs block auto-values but preserve manual choices', async () => {
    const r=await page.evaluate(()=>{
      const preds=[{className:'cowboy boot',probability:.9}],ai=id=>({...mapPredictions(preds),input:{sha256:id}});
      batch=[{manual:{},category:'',type:''},{manual:{category:true,type:true},category:'아우터',type:'패딩'}];
      applyCategoryResult(batch[0],ai('a'));applyCategoryResult(batch[1],ai('b'));
      const result=[batch[0].category,batch[0].type,!!batch[0].ai.runtimeWarning,batch[1].category,batch[1].type];
      applyCategoryResult(batch[1],{...mapPredictions([{className:'trench coat',probability:.7}]),input:{sha256:'b'}});
      result.push(batch[0].category,!batch[0].ai.runtimeWarning);batch=[];return result;
    });assert.deepEqual(r,['','',true,'아우터','패딩','',false]);
  });
  await check('Repeated copies of the same image are not treated as an inference failure', async () => {
    const r=await page.evaluate(()=>{
      const ai={...mapPredictions([{className:'cowboy boot',probability:.9}]),input:{sha256:'same'}};
      batch=[{manual:{}},{manual:{}}];applyCategoryResult(batch[0],{...ai});applyCategoryResult(batch[1],{...ai});const result=batch.map(x=>[x.category,!!x.ai.runtimeWarning]);batch=[];return result;
    });assert.deepEqual(r,[['신발',false],['신발',false]]);
  });
  await check('Black/grey leather boundary and mixed neutrals ask for confirmation', async () => {
    const r=await page.evaluate(()=>[analyzeColorPixels(gridPixels([70,70,72])),analyzeColorPixels(gridPixels([120,120,120]))]);
    assert.equal(r[0].reliable,false);assert.match(r[0].reason,/검정/);assert.equal(r[1].reliable,true);
  });
  await check('Failed inference still disposes the numeric input and permits manual entry', async () => {
    const r=await page.evaluate(async()=>{window.tf=makeTfStub();visionModel={classify:async()=>{throw new Error('test failure')}};const before=window.disposedInputs||0;const result=await classifyGarment((await fixture()).image);await Promise.resolve();return [result.category,!!result.input.sha256,(window.disposedInputs||0)>before]});assert.deepEqual(r,['',true,true]);
  });
  await check('Unavailable CDN leaves upload usable for manual registration', async () => {
    const r=await page.evaluate(async()=>{
      visionModel=null;modelPromise=null;scriptLoads.clear();delete window.tf;delete window.mobilenet;
      const image=(await fixture()).image;
      await $('photo').onchange({target:{files:[new File([image],'offline.png',{type:'image/png'})],value:''}});
      return [batch.length,batch[0].category,processing,$('photo').disabled,$('modelStatus').textContent];
    });assert.deepEqual(r.slice(0,4),[1,'',false,false]);assert.match(r[4],/직접 선택/);
  });
  await check('Actual v3.7 repeated-output fixture is identified as abnormal across all six inputs', async () => {
    const fixture=JSON.parse(readFileSync(join(__dirname,'fixtures/v37-repeated-output.json'),'utf8'));
    const r=await page.evaluate(f=>{
      batch=f.cases.map((x,i)=>({manual:{},category:'',type:''}));
      for(let i=0;i<batch.length;i++)applyCategoryResult(batch[i],{...mapPredictions(f.commonPredictions),input:{sha256:'distinct-input-'+i}});
      const result=batch.map(x=>[x.category,!!x.ai.runtimeWarning]);batch=[];return result;
    },fixture);assert.equal(r.length,6);for(const row of r)assert.deepEqual(row,['',true]);
  });
  // Optional private diagnostic replay: never check user diagnostics into this repository.
  if(process.env.WARDROBE_DIAGNOSTICS)await check('Local diagnostic replay preserves recorded suggestions and abstentions', async () => {
    const diagnostic=JSON.parse(readFileSync(process.env.WARDROBE_DIAGNOSTICS,'utf8'));
    assert.equal(diagnostic.app,'my-wardrobe-diagnostics');
    assert.ok(Array.isArray(diagnostic.cases)&&diagnostic.cases.length>0);
    const cases=diagnostic.cases.filter(c=>c.categoryAnalysis?.predictions?.length&&!c.categoryAnalysis.runtimeWarning);
    assert.ok(cases.length>0,'No usable recorded predictions');
    const actual=await page.evaluate(cases=>{
      batch=cases.map(()=>({manual:{},category:'',type:'',color:''}));
      for(let i=0;i<batch.length;i++){
        const c=cases[i];
        applyCategoryResult(batch[i],{...mapPredictions(c.categoryAnalysis.predictions),input:{sha256:c.inputId}});
        applyColorResult(batch[i],c.colorAnalysis);
      }
      const result=batch.map(x=>({category:x.category,type:x.type,color:x.color,warning:!!x.ai.runtimeWarning}));
      batch=[];return result;
    },cases);
    for(let i=0;i<actual.length;i++){
      const c=cases[i];
      assert.deepEqual(actual[i],{category:c.categoryAnalysis.category,type:c.categoryAnalysis.type,color:c.colorAnalysis.reliable?c.colorAnalysis.name:'',warning:false},`case ${c.caseIndex}`);
    }
  });
  await check('Safari extractor handles Product graphs, ignores unrelated page text and ambiguous lists', async () => {
    const p=await context.newPage(),code=readFileSync(join(root,'product-shortcut.js'),'utf8');
    await p.goto(`http://127.0.0.1:${server.address().port}/`);
    await p.setContent('<meta property="og:title" content="페이지 제목"><meta property="og:image" content="https://example.test/photo.jpg"><div>Account secret must not be extracted</div>');
    await p.evaluate(()=>{const s=document.createElement('script');s.type='application/ld+json';s.textContent=JSON.stringify({'@graph':[{'@type':'Product',name:'테스트 패딩',brand:{name:'테스트 브랜드'},material:'나일론',image:'https://example.test/padded.jpg',offers:{price:'100',priceCurrency:'KRW'}}]});document.head.append(s)});
    const output=await p.evaluate(code=>new Promise(resolve=>{window.completion=resolve;(0,eval)(code)}),code),result=JSON.parse(output.metadata);
    assert.equal(result.product.name,'테스트 패딩');assert.equal(result.product.material,'나일론');assert.equal(output.imageUrl,'https://example.test/padded.jpg');assert.ok(!output.metadata.includes('secret'));
    await p.evaluate(()=>{document.querySelector('script[type="application/ld+json"]').textContent=JSON.stringify([{'@type':'Product',name:'A'},{'@type':'Product',name:'B'}])});
    const ambiguous=await p.evaluate(code=>new Promise(resolve=>{window.completion=resolve;(0,eval)(code)}),code);
    assert.equal(JSON.parse(ambiguous.metadata).product.name,'페이지 제목');await p.close();
  });
  await check('Product import rejects backup files and unsafe URLs without modifying existing clothes', async () => {
    const r=await page.evaluate(async()=>{
      const before=(await all('clothes')).length,errors=[];
      for(const obj of [{app:'my-wardrobe',version:'3.8',clothes:[]},{app:'my-wardrobe-product',version:1,product:{url:'javascript:alert(1)'}},{app:'my-wardrobe-product',version:1,product:{name:'X'},imageData:'data:image/svg+xml;base64,PHN2Zz4='}]){
        try{parseProductPackage(JSON.stringify(obj))}catch(e){errors.push(e.message)}
      }return [errors.length,before,(await all('clothes')).length];
    });assert.equal(r[0],3);assert.equal(r[1],r[2]);
  });
  await check('Product title hints abstain when a title mentions conflicting garment kinds', async () => {
    const r=await page.evaluate(()=>['테스트 다운 패딩','Chelsea boots','패딩 부츠','가방'].map(productTitleSuggestion));
    assert.deepEqual(r,[{category:'아우터',type:'패딩'},{category:'신발',type:'부츠'},{category:'',type:''},{category:'',type:''}]);
  });
  await check('Native image envelope previews safely and adds one garment without replacing the wardrobe', async () => {
    const r=await page.evaluate(async()=>{
      batch=[];processing=false;mutationBusy=false;
      const base=await fixture('kept-product-test');await put('clothes',base);await refresh();
      const before=(await all('clothes')).length,outfitsBefore=JSON.stringify(await all('outfits'));
      const imageData=await b64(base.image),metadata={app:'my-wardrobe-product',version:1,product:{name:'<img src=x onerror="window.productInjected=true"> 패딩',brand:'테스트',material:'나일론',url:'https://example.test/product',color:'olive',size:'M'}};
      $('productPayload').value=JSON.stringify({metadata,imageBase64:imageData.split(',')[1]});await previewProduct();
      const previewOnly=(await all('clothes')).length===before;
      await queueProduct();const queued=batch.length;batch[0].color='카키/올리브';await saveBatch();
      window.importedGarment=(await all('clothes')).find(c=>c.wardrobeDetails?.product?.brand==='테스트');
      return [previewOnly,queued,(await all('clothes')).length-before,!!(await all('clothes')).find(c=>c.id===base.id),JSON.stringify(await all('outfits'))===outfitsBefore,importedGarment.wardrobeDetails.product.size,!!window.productInjected];
    });assert.deepEqual(r,[true,1,1,true,true,'M',false]);
  });
  await check('Blocked remote photo retains metadata and supports an explicit local image replacement', async () => {
    const r=await page.evaluate(async()=>{
      $('productPayload').value=JSON.stringify({app:'my-wardrobe-product',version:1,product:{name:'테스트 상품'},imageUrl:'https://example.test/blocked.jpg'});await previewProduct();
      const fallback=!productDraft.image&&!$('productReview').hidden&&$('productName').value==='테스트 상품';
      await chooseProductPhoto((await fixture()).image);const ready=productDraft.image instanceof Blob;
      productDraft=null;$('productReview').hidden=true;return [fallback,ready];
    });assert.deepEqual(r,[true,true]);
  });
  await check('Care photo and instructions round-trip in backup while legacy fields survive editing', async () => {
    const r=await page.evaluate(async()=>{
      const id=importedGarment.id;await put('clothes',{...importedGarment,unknownField:{keep:true}});await refresh();openEdit(id);
      await chooseCarePhoto((await fixture()).image);$('careInstructions').value='제조사 안내 테스트';$('careNotes').value='내 메모';$('careLastWashed').value='2026-09-07';
      const label=editDetails.care.labelImage;await saveEdit();const c=(await all('clothes')).find(c=>c.id===id);
      const backup=await makeBackup(),prepared=await prepareRestore(backup),restored=prepared.clothes.find(c=>c.id===id);
      return [c.unknownField.keep,c.wardrobeDetails.product.brand,c.wardrobeDetails.care.instructions,restored.wardrobeDetails.care.labelImage===label,restored.wardrobeDetails.care.lastWashed];
    });assert.deepEqual(r,[true,'테스트','제조사 안내 테스트',true,'2026-09-07']);
  });
  await check('Invalid care image aborts restore preparation and cancelling a care edit keeps saved values', async () => {
    const r=await page.evaluate(async()=>{
      const before=await makeBackup(),bad=structuredClone(before),target=bad.clothes.find(c=>c.wardrobeDetails?.care?.labelImage);
      target.wardrobeDetails.care.labelImage='data:image/jpeg;base64,YmFk';let failed=false;
      try{await prepareRestore(bad)}catch{failed=true}
      const c=clothes.find(c=>c.id===target.id);openEdit(c.id);$('careInstructions').value='취소할 변경';removeCarePhoto();closeEdit();
      const after=await makeBackup();return [failed,JSON.stringify(before.clothes)===JSON.stringify(after.clothes),JSON.stringify(before.outfits)===JSON.stringify(after.outfits)];
    });assert.deepEqual(r,[true,true,true]);
  });
  await check('No unexpected runtime errors', async () => assert.deepEqual(errors,[]));
  console.log(`\n${passed} checks passed. This suite does not run pretrained inference or verify iPhone Safari.`);
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close()});
