/* Real-photo pixel/TensorFlow input checks only; no pretrained model inference.
 * Photos remain local and are not bundled in this repository.
 * WARDROBE_PHOTO_DIR=/path/to/photos node tests/photo-input.cjs
 */
const {chromium}=require('playwright');
const fs=require('node:fs'),http=require('node:http'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'..'),photoDir=process.env.WARDROBE_PHOTO_DIR;
if(!photoDir)throw new Error('Set WARDROBE_PHOTO_DIR to a local photo directory.');
const names=fs.readdirSync(photoDir).filter(n=>/\.(jpe?g|png)$/i.test(n));
if(!names.length)throw new Error('No JPEG/PNG inputs.');
const tfjs=process.env.WARDROBE_TEST_TFJS||require.resolve('@tensorflow/tfjs/dist/tf.min.js');
const server=http.createServer((q,r)=>{
 const p=decodeURIComponent(new URL(q.url,'http://local').pathname);let file;
 if(p==='/')file=path.join(root,'index.html');
 else if(p==='/version.json')file=path.join(root,'version.json');
 else if(p==='/tf.js')file=tfjs;
 else if(names.includes(p.slice(1)))file=path.join(photoDir,p.slice(1));
 if(!file){r.writeHead(404).end();return}
 r.setHeader('Content-Type',p==='/tf.js'?'application/javascript':/\.jpe?g$/i.test(p)?'image/jpeg':p.endsWith('.png')?'image/png':p==='/version.json'?'application/json':'text/html; charset=utf-8');r.end(fs.readFileSync(file));
});
let browser;
(async()=>{
 await new Promise(r=>server.listen(0,'127.0.0.1',r));
 browser=await chromium.launch({headless:true,...(process.env.WARDROBE_TEST_CHROMIUM?{executablePath:process.env.WARDROBE_TEST_CHROMIUM,args:['--no-sandbox']}: {})});
 const page=await browser.newPage();await page.route('https://**/*',r=>r.abort());
 await page.goto('http://127.0.0.1:'+server.address().port);await page.waitForFunction(()=>!!db);await page.addScriptTag({url:'/tf.js'});await page.evaluate(()=>tf.setBackend('cpu'));
 const records=[];
 for(const name of names){
  const record=await page.evaluate(async name=>{
   const file=await(await fetch('/'+encodeURIComponent(name))).blob(),image=await f2b(file),color=await estimateColor(image),prepared=await prepareVisionInput(image);
   let received,shape,dtype;visionModel={classify:async tensor=>{received=await tensor.data();shape=tensor.shape;dtype=tensor.dtype;return []}};
   const result=await classifyGarment(image);await Promise.resolve();
   return {name,sourceId:await sha256(await file.arrayBuffer()),input:result.input,backend:result.backend,shape,dtype,
    exact:received?.length===prepared.rgb.length&&received.every((n,i)=>n===prepared.rgb[i]),color};
  },name);
  assert(record.exact);assert(record.input.stdDev>1);assert.equal(record.backend,'cpu');assert.deepEqual(record.shape,[224,224,3]);assert.equal(record.dtype,'int32');records.push(record);
 }
 // Identical copies are allowed, but distinct source files must not collapse into one input.
 if(new Set(records.map(x=>x.sourceId)).size>1)assert(new Set(records.map(x=>x.input.sha256)).size>1);
 assert.equal(await page.evaluate(()=>tf.memory().numTensors),0);
 console.log(JSON.stringify({scope:'pixel-and-input-only; no pretrained inference',photos:records},null,2));
})().catch(e=>{console.error(e);process.exitCode=1}).finally(async()=>{if(browser)await browser.close();server.close()});
