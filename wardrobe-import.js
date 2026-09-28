/* Static product import and optional care details. No DB migration or remote service. */
let productDraft=null, productBusy=false, editDetails={}, detailsBusy=false, detailsSession=0;
const PRODUCT_LIMIT=16*1024*1024;
function plainProductText(v,max=500){return typeof v==='string'?v.trim().slice(0,max):''}
// 광고·추적용 꼬리표(utm_*, fbclid, gclid 등)는 빼고 저장한다
const TRACK_KEY=/^(utm_[a-z_]*|fbclid|gclid|igshid|mc_[a-z_]*|_hs[a-z_]*|ref_?src|srsltid)$/i;
function cleanProductURL(value){try{const u=new URL(value);if(!u.search)return u.href;const kept=u.search.slice(1).split('&').filter(p=>p&&!TRACK_KEY.test((k=>{try{return decodeURIComponent(k)}catch{return k}})(p.split('=')[0])));u.search=kept.length?'?'+kept.join('&'):'';return u.href}catch{return value}}
function productURL(value){
  if(!value)return '';
  try{const u=new URL(value);if(!/^https?:$/.test(u.protocol)||u.username||u.password)throw 0;u.hash='';return u.href}catch{throw new Error('상품·사진 주소는 http 또는 https 주소여야 합니다.')}
}
function productMetadata(p){
  if(!p||typeof p!=='object'||Array.isArray(p))throw new Error('상품 정보 형식이 잘못되었습니다.');
  const result={};
  for(const k of ['name','brand','material','color','size','sku','listedPrice','currency','description'])result[k]=plainProductText(p[k],k==='description'?4000:500);
  result.url=productURL(plainProductText(p.url,4096));if(result.url)result.url=cleanProductURL(result.url);return result;
}
function parseProductPackage(text){
  if(text.length>PRODUCT_LIMIT)throw new Error('등록 파일이 너무 큽니다. 사진 크기를 줄여주세요.');
  let p;try{p=JSON.parse(text)}catch{throw new Error('단축어에서 복사한 상품 정보를 붙여 넣어주세요. URL만으로는 가져올 수 없습니다.')}
  // The Shortcut envelope keeps metadata JSON separate from native image bytes.
  if(p&&p.metadata!==undefined){
    const metadata=typeof p.metadata==='string'?JSON.parse(p.metadata):p.metadata;p={...metadata,imageBase64:p.imageBase64};
  }
  if(p?.app!=='my-wardrobe-product'||p.version!==1)throw new Error('상품 등록용 파일이 아닙니다. 옷장 백업은 백업 복원을 이용해주세요.');
  const result={product:productMetadata(p.product),imageUrl:productURL(plainProductText(p.imageUrl,4096)),image:null};
  if(p.imageData){
    if(typeof p.imageData!=='string'||!/^data:image\/(jpeg|png|webp);base64,/i.test(p.imageData))throw new Error('JPEG·PNG·WebP 사진만 가져올 수 있습니다.');
    result.image=blob(p.imageData);
  }else if(p.imageBase64){
    const encoded=String(p.imageBase64).replace(/\s/g,'');
    if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw new Error('사진 인코딩을 확인해주세요.');
    // The documented Shortcut explicitly converts downloaded images to JPEG.
    result.image=blob('data:image/jpeg;base64,'+encoded);
  }
  return result;
}
async function readProductImage(imageUrl){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const response=await fetch(productURL(imageUrl),{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!response.ok)throw new Error('사진 다운로드 실패');
    if(Number(response.headers.get('content-length'))>10*1024*1024)throw new Error('사진이 너무 큽니다.');
    const image=await response.blob();
    if(image.size>10*1024*1024||!/^image\/(jpeg|png|webp)$/i.test(image.type))throw new Error('지원하지 않는 사진입니다.');
    return await f2b(image);
  }finally{clearTimeout(timer)}
}
function productForm(p){
  return `<label>상품명<input id="productName" maxlength="500" value="${esc(p.name)}"></label>
    <label>브랜드<input id="productBrand" maxlength="500" value="${esc(p.brand)}"></label>
    <label>상품 주소<input id="productURL" type="url" value="${esc(p.url)}"></label>
    <label>소재·혼용률<input id="productMaterial" maxlength="500" value="${esc(p.material)}"></label>
    <div class="row"><label>구매 색상<input id="productColor" maxlength="500" value="${esc(p.color)}"></label><label>구매 사이즈<input id="productSize" maxlength="500" value="${esc(p.size)}"></label></div>
    ${p.listedPrice?`<p class="small">페이지 표시 가격: ${esc(p.listedPrice)} ${esc(p.currency)} · 실제 결제 금액과 다를 수 있습니다.</p>`:''}
    <details><summary>상품 설명 확인</summary><p class="product-description">${esc(p.description||'제공된 상품 설명이 없습니다.')}</p></details>`;
}
async function previewProduct(){
  if(productBusy)return;productBusy=true;$('productPreviewBtn').disabled=true;$('productQueueBtn').disabled=true;
  $('productStatus').textContent='상품 정보를 준비하고 있습니다…';
  try{
    const draft=parseProductPackage($('productPayload').value.trim());
    if(draft.image)draft.image=await f2b(draft.image);
    else if(draft.imageUrl){try{draft.image=await readProductImage(draft.imageUrl)}catch{draft.image=null}}
    productDraft=draft;$('productFields').innerHTML=productForm(draft.product);$('productReview').hidden=false;
    $('productPhoto').value='';renderProductPhoto();
    $('productStatus').textContent=draft.image?'사진·상품 정보와 구매한 옵션이 맞는지 확인해주세요.':'사진을 가져오지 못했습니다. 상품 사진을 선택하면 정보를 함께 등록할 수 있습니다.';
  }catch(e){$('productStatus').textContent=e.message;productDraft=null;$('productReview').hidden=true}
  finally{productBusy=false;$('productPreviewBtn').disabled=false;$('productQueueBtn').disabled=false;pruneURLs()}
}
function renderProductPhoto(){
  const im=$('productImage');im.hidden=!productDraft?.image;
  if(productDraft?.image)im.src=url(productDraft.image);else im.removeAttribute('src');
}
async function chooseProductPhoto(file){
  if(!file||!productDraft||productBusy)return;const draft=productDraft;productBusy=true;$('productQueueBtn').disabled=true;
  try{const image=await f2b(file);if(productDraft!==draft)return;draft.image=image;renderProductPhoto();$('productStatus').textContent='선택한 사진으로 등록합니다.'}
  catch(e){$('productStatus').textContent=e.message}finally{productBusy=false;$('productQueueBtn').disabled=false;pruneURLs()}
}
// 상품명으로 분류 참고값을 채운다. 상품명에서 '가장 뒤에 나오는 옷 이름'을 그 상품으로 본다(니트 가디건 → 가디건, 데님 셔츠 → 셔츠,
// 패딩 부츠 → 부츠, 니트 조거 팬츠 → 팬츠). 같은 자리에서 끝나면 더 긴 이름(티셔츠 > 셔츠, 폴로 셔츠 > 셔츠)을 쓴다. 아우터이고 '패딩'이 들어 있으면 세부종류는 패딩.
// 아무 옷 이름도 없으면 보류한다. MobileNet 결과나 사용자 확정값이 아니며, 등록 목록에서 확인을 요청한다.
function productTitleSuggestion(name){
  const s=String(name||'').toLowerCase();
  const rules=[[/티\s?셔츠|\bt-?shirts?\b|\btees?\b/g,'상의','티셔츠'],[/폴로\s?셔츠|폴로|\bpolo(?: shirt)?s?\b/g,'상의','폴로'],[/스웨트\s?셔츠|스웻\s?셔츠|맨투맨|\bsweat ?shirts?\b/g,'상의','맨투맨'],[/셔츠|\bshirts?\b/g,'상의','셔츠'],[/니트|스웨터|\b(?:knit|sweater)s?\b/g,'상의','니트'],[/후드(?:티)?|\bhood(?:ie|y)s?\b/g,'상의','후드'],
    [/가디건|\bcardigans?\b/g,'아우터','가디건'],[/블레이저|\bblazers?\b/g,'아우터','블레이저'],[/코트|\bcoats?\b/g,'아우터','코트'],[/자켓|재킷|점퍼|\bjackets?\b/g,'아우터','재킷'],[/패딩|\bpuffers?\b/g,'아우터','패딩'],
    [/청바지|데님\s?(?:팬츠|바지)|\bjeans\b/g,'하의','데님'],[/슬랙스|\bslacks\b/g,'하의','슬랙스'],[/쇼츠|반바지|\bshorts\b/g,'하의','쇼츠'],[/팬츠|바지|조거|\b(?:pants|trousers|joggers)\b/g,'하의',''],[/데님|\bdenim\b/g,'하의','데님'],
    [/첼시|부츠|\bboots?\b/g,'신발','부츠'],[/로퍼|\bloafers?\b/g,'신발','로퍼'],[/스니커즈|운동화|\b(?:sneakers?|running shoes?)\b/g,'신발','스니커즈'],
    [/크로스백|\bcross ?body(?: bag)?\b/g,'가방','크로스백'],[/백팩|\bbackpacks?\b/g,'가방','백팩'],[/토트(?:백)?|\btotes?(?: bag)?\b/g,'가방','토트']];
  let best=null;
  for(const [re,c,t] of rules)for(const m of s.matchAll(re)){const end=m.index+m[0].length,len=m[0].length;if(!best||end>best.end||(end===best.end&&len>best.len))best={end,len,c,t}}
  if(!best)return {category:'',type:''};
  return {category:best.c,type:best.c==='아우터'&&/패딩|\bpuffer/.test(s)?'패딩':best.t};
}
async function queueProduct(){
  if(productBusy||processing||mutationBusy||batch.some(x=>x.analyzing)||!productDraft)return;
  if(!productDraft.image)return alert('등록할 상품 사진을 선택해주세요.');
  productBusy=true;processing=true;updateBatchButtons();$('productQueueBtn').disabled=true;
  try{
    const p=productMetadata({...productDraft.product,name:$('productName').value,brand:$('productBrand').value,url:$('productURL').value,material:$('productMaterial').value,color:$('productColor').value,size:$('productSize').value});
    const image=productDraft.image,col=await estimateColor(image),suggestion=productTitleSuggestion(p.name);
    const x={image,...suggestion,color:'',manual:{},requestId:0,aiStatus:suggestion.category?'상품명 참고 · 속성을 확인해주세요.':'상품 가져옴 · 분류 확인 필요',season:'사계절',formality:2,memo:p.name,wardrobeDetails:{product:p}};
    applyColorResult(x,col);batch.push(x);productDraft=null;$('productReview').hidden=true;$('productPayload').value='';
    $('productStatus').textContent='위 등록 목록에 추가했습니다. 분류·색을 확인한 뒤 모두 저장을 눌러주세요.';renderQueue();
    {const last=$('queue').lastElementChild;if(last)last.scrollIntoView({block:'center'});const pc=$('productCard');if(pc)pc.open=false}
  }catch(e){reportError(e,'상품을 추가하지 못했습니다.')}finally{productBusy=false;processing=false;updateBatchButtons();$('productQueueBtn').disabled=false}
}
async function validateWardrobeDetails(details){
  if(details===undefined)return;
  if(!details||typeof details!=='object'||Array.isArray(details))throw new Error('추가 옷 정보 형식이 잘못되었습니다.');
  if(details.product!==undefined)productMetadata(details.product);
  if(details.care!==undefined){
    const c=details.care;if(!c||typeof c!=='object'||Array.isArray(c))throw new Error('세탁 정보 형식이 잘못되었습니다.');
    for(const k of ['instructions','notes','lastWashed','labelImage'])if(c[k]!==undefined&&typeof c[k]!=='string')throw new Error('세탁 정보 형식이 잘못되었습니다.');
    if(c.labelImage){if(c.labelImage.length>PRODUCT_LIMIT||!/^data:image\/(jpeg|png|webp);base64,/i.test(c.labelImage))throw new Error('세탁 라벨 사진 형식이 잘못되었습니다.');await blobImage(blob(c.labelImage))}
  }
}
function loadWardrobeDetails(c){
  detailsSession++;detailsBusy=false;$('editSaveBtn').disabled=false;
  editDetails=structuredClone(c.wardrobeDetails||{});
  const p=editDetails.product||{},care=editDetails.care||{};
  for(const [id,key] of [['detailName','name'],['detailBrand','brand'],['detailURL','url'],['detailMaterial','material'],['detailColor','color'],['detailSize','size']])$(id).value=p[key]||'';
  $('detailDescription').textContent=[p.sku?'상품 코드: '+p.sku:'',p.listedPrice?'페이지 표시 가격: '+p.listedPrice+' '+(p.currency||''):'',p.description||''].filter(Boolean).join('\n');
  $('careInstructions').value=care.instructions||'';$('careNotes').value=care.notes||'';$('careLastWashed').value=care.lastWashed||'';
  $('carePhoto').value='';$('careStatus').textContent='';renderCarePhoto();
}
function renderCarePhoto(){
  const data=editDetails.care?.labelImage,im=$('careImage');
  im.hidden=!data;$('removeCarePhoto').hidden=!data;
  if(data&&/^data:image\/(jpeg|png|webp);base64,/i.test(data))im.src=data;else im.removeAttribute('src');
}
async function chooseCarePhoto(file){
  if(!file||detailsBusy||mutationBusy||editingId===null)return;
  const session=detailsSession;detailsBusy=true;$('editSaveBtn').disabled=true;$('careStatus').textContent='라벨 사진을 준비하고 있습니다…';
  try{
    const data=await b64(await f2b(file));if(session!==detailsSession||editingId===null)return;
    editDetails.care={...editDetails.care,labelImage:data};renderCarePhoto();
    $('careStatus').textContent='사진이 첨부되었습니다. 내용을 확인하고 저장해주세요.';
  }catch(e){if(session===detailsSession)$('careStatus').textContent=e.message}
  finally{if(session===detailsSession){detailsBusy=false;$('editSaveBtn').disabled=false}}
}
function removeCarePhoto(){if(detailsBusy||mutationBusy)return;editDetails.care={...editDetails.care,labelImage:''};renderCarePhoto()}
function collectWardrobeDetails(){
  const p=productMetadata({...editDetails.product,name:$('detailName').value,brand:$('detailBrand').value,url:$('detailURL').value,material:$('detailMaterial').value,color:$('detailColor').value,size:$('detailSize').value});
  const care={...editDetails.care,instructions:$('careInstructions').value.trim().slice(0,8000),notes:$('careNotes').value.trim().slice(0,4000),lastWashed:$('careLastWashed').value};
  return {...editDetails,product:{...editDetails.product,...p},care};
}
let shortcutCodeCache=null;
function prefetchShortcutCode(){if(shortcutCodeCache)return;fetch('./product-shortcut.js').then(r=>r.ok?r.text():null).then(t=>{if(t)shortcutCodeCache=t}).catch(()=>{})}
async function copyShortcutScript(){
  const box=$('shortcutCode'),st=$('shortcutStatus');
  const show=code=>{box.value=code;box.hidden=false;box.readOnly=false;box.focus();box.setSelectionRange(0,code.length);box.readOnly=true};
  try{
    if(shortcutCodeCache){
      const code=shortcutCodeCache;
      if(navigator.clipboard&&navigator.clipboard.writeText){try{await navigator.clipboard.writeText(code);st.textContent='단축어 코드를 복사했습니다.';return}catch{}}
      show(code);let ok=false;try{ok=document.execCommand('copy')}catch{}
      st.textContent=ok?'단축어 코드를 복사했습니다.':'아래 칸의 코드가 선택되어 있습니다. 길게 눌러 복사하세요.';return;
    }
    const r=await fetch('./product-shortcut.js');if(!r.ok)throw new Error('단축어 코드를 불러오지 못했습니다.');
    shortcutCodeCache=await r.text();show(shortcutCodeCache);st.textContent='코드를 불러왔습니다. 한 번 더 누르면 복사합니다(또는 아래 칸을 길게 눌러 복사).';
  }catch(e){st.textContent=e.message}
}
function initWardrobeExtras(){
  const det=$('shortcutCode')&&$('shortcutCode').closest('details');if(det)det.addEventListener('toggle',()=>{if(det.open)prefetchShortcutCode()});
  $('productPhoto').onchange=e=>chooseProductPhoto(e.target.files[0]);
  $('carePhoto').onchange=e=>chooseCarePhoto(e.target.files[0]);
  $('productFile').onchange=async e=>{
    if(productBusy)return;const f=e.target.files[0];if(!f)return;
    try{if(f.size>PRODUCT_LIMIT)throw new Error('상품 파일이 너무 큽니다.');$('productPayload').value=await f.text();await previewProduct()}
    catch(error){$('productStatus').textContent=error.message}finally{e.target.value=''}
  };
}
