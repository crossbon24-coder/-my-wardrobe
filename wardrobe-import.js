/* Static product import and optional care details. No DB migration or remote service. */
let productDraft=null, productBusy=false, editDetails={}, detailsBusy=false, detailsSession=0;
const PRODUCT_LIMIT=16*1024*1024,PAGE_LIMIT=4*1024*1024; // 사진이 든 JSON은 16MB, 상품 페이지 원문(HTML·Base64)은 4MB까지
function plainProductText(v,max=500){return typeof v==='string'?v.trim().slice(0,max):''}
// 광고·공유 추적값은 빼고 저장·요청한다(utm_*, 페이스북·구글·네이버·MS 광고, AppsFlyer 공유 링크의 af_*·reward_key 등). 상품 번호 같은 나머지 값은 원문 그대로.
// pid는 상품 번호로 쓰는 쇼핑몰이 있어 AppsFlyer 값(af_*)과 함께 있을 때만 뺀다
const TRACK_KEY=/^(utm_[a-z_]*|fbclid|gclid|gbraid|wbraid|gad_source|dclid|msclkid|ttclid|twclid|yclid|igshid|igsh|mc_[a-z_]*|_hs[a-z_]*|_ga|_gl|ref_?src|srsltid|af_[a-z_]*|reward_key|shortlink|deep_link_value|deep_link_sub\d*|is_retargeting|onelink_[a-z_]*|source_caller|NaPm|n_[a-z_]*)$/i;
function cleanProductURL(value){try{const u=new URL(value);if(!u.search)return u.href;const key=p=>{const k=p.split('=')[0];try{return decodeURIComponent(k)}catch{return k}};const parts=u.search.slice(1).split('&').filter(Boolean),af=parts.some(p=>/^af_/i.test(key(p)));const kept=parts.filter(p=>!TRACK_KEY.test(key(p))&&!(af&&/^pid$/i.test(key(p))));u.search=kept.length?'?'+kept.join('&'):'';return u.href}catch{return value}}
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
const PASTE_HELP='상품 정보를 읽지 못했습니다. 단축어의 Base64 인코딩 줄바꿈이 "없음"인지, 텍스트 동작의 metadata 변수 양쪽에 따옴표가 없는지 확인해주세요.';
const LINK_HELP='주소만으로는 이 쇼핑몰 정보를 가져올 수 없습니다. Safari에서 상품 페이지를 열고 공유 → 단축어를 실행하거나, 쇼핑몰 앱에서는 앱용 단축어를 실행해주세요.';
const B64_HELP='단축어가 넘긴 글이 상품 페이지 원문이 아닙니다. 앱용 단축어에서 두 번째 "URL의 콘텐츠 가져오기" 뒤에 "이름 설정(page.txt)"과 "Base64 인코딩"이 차례로 있는지 확인해주세요.';
const SHARE_PAGE='상품 페이지가 아니라 공유 링크 안내 페이지를 받았습니다. 앱용 단축어의 "텍스트 일치" 단계를 확인해주세요.';
const PAGE_BIG='상품 페이지가 너무 큽니다. 상품 상세 페이지에서 다시 시도해주세요.';
function parseProductPackage(text){
  if(text.length>PRODUCT_LIMIT)throw new Error('등록 파일이 너무 큽니다. 사진 크기를 줄여주세요.');
  let p;try{p=JSON.parse(text)}catch{try{p=JSON.parse(text.replace(/[\r\n]+/g,''))}catch{throw new Error(/^\s*\{/.test(text)?PASTE_HELP:LINK_HELP)}}
  // The Shortcut envelope keeps metadata JSON separate from native image bytes.
  if(p&&p.metadata!==undefined){
    let metadata;try{metadata=typeof p.metadata==='string'?JSON.parse(p.metadata):p.metadata}catch{throw new Error(PASTE_HELP)}
    p={...metadata,imageBase64:p.imageBase64};
  }
  if(p?.app!=='my-wardrobe-product'||p.version!==1)throw new Error('상품 등록용 파일이 아닙니다. 옷장 백업은 백업 복원을 이용해주세요.');
  const product=refineProduct(productMetadata(p.product)),mall=product._mall||'';delete product._mall;
  // 쇼핑몰 앱 공유 링크의 안내 페이지(AppsFlyer)를 상품으로 받지 않는다(Safari·붙여넣기 두 경로 모두)
  const host=(()=>{try{return new URL(product.url).hostname}catch{return ''}})();
  if(/^Launching App/i.test(product.name)||/^(온라인 패션 스토어 무신사|무신사|29CM|감도 깊은 취향 셀렉트샵 29CM)$/i.test(product.name)||/(^|\.)(onelink\.me|app\.link)$/.test(host))throw new Error(SHARE_PAGE);
  const result={product,mall,imageUrl:productURL(plainProductText(p.imageUrl,4096).replace(/&amp;/g,'&')),image:null,imageNote:''};
  if(p.imageData){
    if(typeof p.imageData!=='string'||!/^data:image\/(jpeg|png|webp);base64,/i.test(p.imageData))throw new Error('JPEG·PNG·WebP 사진만 가져올 수 있습니다.');
    result.image=blob(p.imageData);
  }else if(p.imageBase64){
    const encoded=String(p.imageBase64).replace(/\s/g,'');
    // 사진 글자가 깨졌으면 정보는 살리고 사진 주소로 다시 받는다
    try{if(!/^[A-Za-z0-9+/]+={0,2}$/.test(encoded))throw 0;result.image=blob('data:image/jpeg;base64,'+encoded)}catch{result.image=null;result.imageNote='단축어가 넘긴 사진을 읽지 못했습니다'}
  }
  return result;
}
// 상품명 다듬기: 쇼핑몰이 제목 끝에 붙이는 꼬리표를 떼고, 가격은 숫자만 남긴다(이미 깨끗한 값은 그대로)
const SHOP_TITLE_TAILS=[/\s*[-|]\s*사이즈\s*&\s*후기\s*\|\s*무신사\s*$/,/\s*\|\s*무신사(?:\s*스토어)?\s*$/,/\s*-\s*감도 깊은 취향 셀렉트샵 29CM\s*$/,/\s*\|\s*29CM\s*$/i,/\s*\|\s*UNIQLO KR\s*$/i,/\s*-\s*에이블리\s*$/,/\s*\|\s*스파오닷컴 공식 스토어\s*$/,/\s*\|\s*W컨셉\s*$/];
const reEscape=s=>s.replace(/[.*+?^${}()|[\]\\]/g,'\\$&');
function refineProduct(p){
  const r={...p};let name=r.name;
  for(const re of SHOP_TITLE_TAILS)name=name.replace(re,'');
  // 이름 앞 브랜드: 바로 뒤에 영문 표기 괄호가 있거나('무신사 스탠다드(MUSINSA STANDARD) 셔츠'), 떼고 남은 이름에 옷 이름이 있을 때만 뗀다('New Balance 993'은 그대로)
  if(r.brand){const m=new RegExp('^'+reEscape(r.brand)+'\\s*(\\([^)]*\\))?\\s+','i').exec(name);if(m){const cut=name.slice(m[0].length);if(cut.trim()&&(m[1]||productTitleSuggestion(cut).category))name=cut}}
  if(name.trim())r.name=name.trim();
  const price=String(r.listedPrice||'').replace(/\s*(원|₩|KRW)\s*/gi,'');
  if(/^\d{1,3}(,\d{3})+(\.\d+)?$/.test(price))r.listedPrice=price.replace(/,/g,'');else if(/^\d+(\.\d+)?$/.test(price))r.listedPrice=price;
  // Cafe24 상품 코드(cafe24_몰ID_1_상품번호[_옵션]): 몰ID는 사진 서버 주소에 쓰고, 보여 줄 코드는 상품번호
  const m=/^cafe24_([A-Za-z0-9-]+)_\d+_(\d+)(?:_.+)?$/.exec(r.sku||'');if(m){r._mall=m[1];r.sku=m[2]}
  return r;
}
// 상품명·구매 색상 글자로 12색을 참고한다. 낱말 단위로만 맞추고(블루종·샌드워시·블랙워치·크림슨은 색이 아님), 라이트·다크·삭스 같은 꾸밈말은 떼고 본다.
// 구매 색상 칸 → 이름 끝의 [색]·(색)·_색·- 색 → 이름 전체(뜻이 하나뿐인 색 낱말만) 순서. 두 색으로 읽히거나 구매 색상 칸이 12색 밖이면 비워 사진 판정을 쓴다
const COLOR_WORDS={검정:['블랙','black','검정','검정색','검은색','흑색'],흰색:['화이트','white','흰색','백색','하얀색'],'아이보리/크림':['아이보리','ivory','크림','cream','에크루','ecru','오프화이트','offwhite','내추럴','natural','미색'],
  네이비:['네이비','navy','남색','곤색','인디고','indigo','진청','생지'],회색:['그레이','grey','gray','회색','차콜','charcoal','멜란지','melange','실버','silver'],베이지:['베이지','beige','샌드','sand','오트밀','oatmeal','탄','tan'],
  브라운:['브라운','brown','갈색','카멜','camel','모카','mocha','초코','chocolate','커피','coffee'],'카키/올리브':['카키','khaki','올리브','olive'],블루:['블루','blue','청색','하늘색','연청','중청','스카이','sky'],
  그린:['그린','green','녹색','초록','민트','mint','포레스트','forest'],'와인/버건디':['와인','wine','버건디','burgundy','마룬','maroon','자주색']};
const AMBIGUOUS_COLOR=new Set(['내추럴','natural','크림','cream','샌드','sand','탄','tan','실버','silver','커피','coffee','모카','mocha','초코','스카이','sky','민트','mint','포레스트','forest','와인','wine','멜란지','melange','생지','인디고','indigo']);
const COLOR_MODS=/^(라이트|다크|딥|페일|소프트|더스티|빈티지|워시드|밝은|어두운|연한|진한|삭스|스카이|베이비|멜란지|헤더|light|dark|deep|pale|soft|dusty|vintage|washed|sax|sky|baby|heather)(?=.)/i;
const COLOR_OF=new Map(Object.entries(COLOR_WORDS).flatMap(([c,ws])=>ws.map(w=>[w.toLowerCase(),c])));
function tokenColor(tok,strict){const raw=tok.toLowerCase();let t=raw;for(let i=0;i<3&&!COLOR_OF.has(t);i++){const m=COLOR_MODS.exec(t);if(!m)break;t=t.slice(m[0].length)}const c=COLOR_OF.get(t);return c&&!(strict&&t===raw&&AMBIGUOUS_COLOR.has(t))?c:''}
function colorsOf(text,strict){const out=[];for(const tok of String(text||'').split(/[\s[\](){}_\-/·,|+&:;.'"!?#]+/))if(tok){const c=tokenColor(tok,strict);if(c&&!out.includes(c))out.push(c)}return out}
function nameColor(p){
  const field=String(p?.color||'').trim();
  if(field){const c=colorsOf(field,false);return c.length===1?c[0]:''}
  let name=String(p?.name||'');const brand=String(p?.brand||'').trim();
  if(brand)name=name.replace(new RegExp(reEscape(brand),'ig'),' '); // 브랜드 이름 속 색 글자(블랙야크 등)는 보지 않는다
  const tail=(/[[(]([^\])]+)[\])]\s*$/.exec(name)||/(?:_|\s-\s)([^_]+?)\s*$/.exec(name)||[])[1]||'';
  if(tail){const c=colorsOf(tail,false);if(c.length===1)return c[0];if(c.length>1)return ''}
  const c=colorsOf(name,true);return c.length===1?c[0]:'';
}
// 붙여 넣은 내용이 HTML(단축어 'URL의 콘텐츠 가져오기' 결과)이면 단축어와 같은 추출 코드(product-shortcut.js)를 그 문서에 돌린다
const looksHTML=t=>/^\s*</.test(t)&&/<(html|head|meta)\b/i.test(t.slice(0,200000));
const looksB64=t=>t.length>200&&/^[A-Za-z0-9+/=\s]+$/.test(t);
async function loadExtractor(){
  if(shortcutCodeCache)return shortcutCodeCache;
  let r;try{r=await fetch('./product-shortcut.js')}catch{r=null}
  if(!r||!r.ok)throw new Error('추출 코드를 불러오지 못했습니다. 인터넷 연결을 확인해주세요.');
  return shortcutCodeCache=await r.text();
}
// 글자 인코딩: 서버가 알려 준 charset → 문서 앞부분의 <meta charset> → UTF-8. EUC-KR 쇼핑몰도 읽는다
function decodeHTML(bytes,charset){
  let cs=String(charset||'').toLowerCase();
  if(!cs){const head=new TextDecoder('latin1').decode(bytes.slice(0,8192)),m=/<meta[^>]+charset\s*=\s*["']?([\w-]+)/i.exec(head);cs=m?m[1].toLowerCase():'utf-8'}
  let dec;try{dec=new TextDecoder(cs)}catch{dec=new TextDecoder('utf-8')}
  const text=dec.decode(bytes);if((text.match(/�/g)||[]).length>50)throw new Error('페이지 글자 인코딩을 읽지 못했습니다.');
  return text;
}
async function productFromHTML(html,hint){
  const doc=new DOMParser().parseFromString(html,'text/html');
  const attr=(sel,k)=>doc.querySelector(sel)?.getAttribute(k)||'';
  // 페이지 주소: canonical → og:url → JSON-LD 상품의 @id·url → 붙여 넣은 주소 순(포터리처럼 앞의 둘이 없는 곳이 있다)
  const ldIds=[];for(const sc of doc.querySelectorAll('script[type="application/ld+json"]')){try{for(const n of [].concat(JSON.parse(sc.textContent)))if(n&&/Product/.test([].concat(n['@type']||[]).join(' ')))ldIds.push(n.url||n['@id']||'')}catch{}}
  let page='';for(const v of [attr('link[rel="canonical"]','href'),attr('meta[property="og:url"]','content'),...ldIds,hint||''])if(!page&&typeof v==='string'&&v){try{const u=new URL(v);if(/^https?:$/.test(u.protocol))page=u.href}catch{}}
  if(page&&doc.head){const b=doc.createElement('base');b.href=page;doc.head.prepend(b)}
  const code=await loadExtractor();
  const out=await new Promise((resolve,reject)=>{const timer=setTimeout(()=>reject(new Error('상품 정보를 찾지 못했습니다.')),3000);try{new Function('document','location','completion',code)(doc,{href:page||undefined},r=>{clearTimeout(timer);resolve(r)})}catch(e){clearTimeout(timer);reject(e)}});
  const name=(()=>{try{return JSON.parse(out.metadata).product.name||''}catch{return ''}})();
  if(!name)throw new Error('상품 정보를 찾지 못했습니다. 상품 상세 페이지인지 확인해주세요.');
  return JSON.stringify({metadata:out.metadata});
}
// 응답을 조금씩 읽다가 한도를 넘으면 바로 끊는다(서버가 크기를 알려 주지 않아도 메모리를 지킨다)
async function readLimited(response,limit,controller,msg){
  if(Number(response.headers.get('content-length'))>limit)throw new Error(msg);
  if(!response.body||!response.body.getReader){const b=new Uint8Array(await response.arrayBuffer());if(b.length>limit)throw new Error(msg);return b}
  const reader=response.body.getReader(),chunks=[];let n=0;
  for(;;){const {done,value}=await reader.read();if(done)break;n+=value.length;if(n>limit){try{controller.abort()}catch{}throw new Error(msg)}chunks.push(value)}
  const out=new Uint8Array(n);let o=0;for(const c of chunks){out.set(c,o);o+=c.length}return out;
}
// 주소만 붙여 넣었을 때: 쇼핑몰이 허용하면 앱이 페이지를 직접 받는다(쿠키·보낸 페이지 정보 없이, 추적값은 지운 주소로). 막혀 있으면 단축어를 안내한다
async function fetchProductPage(link){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    const r=await fetch(productURL(cleanProductURL(link)),{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'});
    if(!r.ok||!/html/i.test(r.headers.get('content-type')||''))throw 0;
    const bytes=await readLimited(r,PAGE_LIMIT,controller,PAGE_BIG);
    return decodeHTML(bytes,(/charset=([\w-]+)/i.exec(r.headers.get('content-type')||'')||[])[1]);
  }finally{clearTimeout(timer)}
}
async function productFromText(raw){
  const text=String(raw||'').trim();
  if(!text)throw new Error('붙여 넣은 내용이 없습니다. 단축어를 실행한 뒤 다시 붙여 넣어주세요.');
  if(text.length>PRODUCT_LIMIT)throw new Error('등록 파일이 너무 큽니다. 사진 크기를 줄여주세요.');
  if(looksHTML(text)){if(text.length>PAGE_LIMIT)throw new Error(PAGE_BIG);return parseProductPackage(await productFromHTML(text))}
  if(text.startsWith('{')){try{return parseProductPackage(text)}catch(e){const b=text.lastIndexOf('}');if(b>0&&b<text.length-1){try{return parseProductPackage(text.slice(0,b+1))}catch{}}throw e}} // 뒤에 사진 주소 줄 등이 붙은 경우도 살린다
  // 쇼핑몰 앱 공유용 단축어는 상품 페이지 원문을 Base64로 넘긴다(단축어가 원문을 바꾸지 않게)
  if(looksB64(text)){
    if(text.length>PAGE_LIMIT*1.4)throw new Error(PAGE_BIG);
    let bytes;try{bytes=Uint8Array.from(atob(text.replace(/\s/g,'')),ch=>ch.charCodeAt(0))}catch{throw new Error(B64_HELP)}
    if(!looksHTML(new TextDecoder('latin1').decode(bytes.slice(0,8192))))throw new Error(B64_HELP);
    return parseProductPackage(await productFromHTML(decodeHTML(bytes)));
  }
  // 주소(또는 '[무신사] 상품명 https://…' 같은 공유 문구)
  const link=(text.match(/https?:\/\/[^\s"'<>]+/)||[])[0];
  if(link){
    let html;try{html=await fetchProductPage(link)}catch(e){throw new Error(e?.message&&/인코딩|너무 큽니다/.test(e.message)?e.message:LINK_HELP)}
    return parseProductPackage(await productFromHTML(html,cleanProductURL(link)));
  }
  // 앞뒤에 다른 글이 붙은 JSON(예: '사전 값 가져오기'를 '모든 값'으로 두어 사진 주소 줄이 붙은 경우)
  const a=text.indexOf('{'),b=text.lastIndexOf('}');
  if(a>=0&&b>a){try{return parseProductPackage(text.slice(a,b+1))}catch{}}
  throw new Error(shortcutMistake(text));
}
// 단축어 설정 실수를 글 모양으로 알아본다. 받은 글 앞부분도 보여 줘 사용자가 무엇이 복사됐는지 알 수 있게 한다
function shortcutMistake(text){
  const head=text.replace(/\s+/g,' ').slice(0,60),seen=` (받은 글 ${text.length}자: "${head}${text.length>60?'…':''}")`;
  if(/^(metadata|imageUrl)(\s+(metadata|imageUrl))*$/i.test(text.replace(/\s+/g,' ').trim()))return "단축어의 '사전 값 가져오기'가 '모든 키'로 되어 있습니다. '값'을 고르고 키에 metadata를 넣어주세요."+seen;
  if(/^(true|false|null|undefined|\d+)$/i.test(text.trim()))return "단축어의 '사전 값 가져오기' 키가 metadata인지, 입력이 'JavaScript 결과'인지 확인해주세요."+seen;
  return "상품 정보가 아닙니다. 단축어의 '클립보드에 복사' 입력이 '사전 값'(metadata)인지 확인해주세요."+seen;
}
// 사진 받기: 서버가 알려 주는 형식 대신 파일 앞부분으로 JPEG·PNG·WebP를 판별한다(형식을 잘못 알려 주는 서버가 있음)
function sniffImage(b){
  if(b[0]===0xFF&&b[1]===0xD8&&b[2]===0xFF)return 'image/jpeg';
  if(b[0]===0x89&&b[1]===0x50&&b[2]===0x4E&&b[3]===0x47)return 'image/png';
  if(b[0]===0x52&&b[1]===0x49&&b[2]===0x46&&b[3]===0x46&&b[8]===0x57&&b[9]===0x45&&b[10]===0x42&&b[11]===0x50)return 'image/webp';
  return '';
}
async function fetchProductImage(u){
  const controller=new AbortController(),timer=setTimeout(()=>controller.abort(),12000);
  try{
    let response;try{response=await fetch(u,{signal:controller.signal,credentials:'omit',referrerPolicy:'no-referrer'})}
    catch(e){throw new Error(e?.name==='AbortError'?'사진 서버 응답이 늦습니다':'이 쇼핑몰은 앱이 사진을 직접 받는 것을 막아 두었습니다')}
    if(!response.ok)throw new Error(`사진 서버가 거절했습니다(${response.status})`);
    let bytes;try{bytes=await readLimited(response,10*1024*1024,controller,'사진이 너무 큽니다')}catch(e){throw new Error(e?.name==='AbortError'?'사진 서버 응답이 늦습니다':e.message)}
    const type=sniffImage(bytes);if(!type)throw new Error('지원하지 않는 사진 형식입니다(JPEG·PNG·WebP만)');
    return await f2b(new Blob([bytes],{type}));
  }finally{clearTimeout(timer)}
}
// 사진 주소 후보: 무신사는 _500 대신 큰 사진(_big)과 사진 서버 원래 경로(/thumbnails 없이)를 먼저,
// Cafe24 쇼핑몰 자체 도메인 사진은 Cafe24 사진 서버 주소(앱이 받도록 허용)를 먼저 쓴다
function imageCandidates(imageUrl,mall){
  const out=[],add=v=>{if(v&&!out.includes(v))out.push(v)};let x;
  try{x=new URL(productURL(String(imageUrl).replace(/&amp;/g,'&')))}catch{return []}
  if(/(^|\.)msscdn\.net$/.test(x.hostname)){
    const base=new URL(x.href);base.pathname=x.pathname.replace(/^\/thumbnails(?=\/images\/)/,'');base.search='';
    if(/_500\.(jpe?g|png)$/i.test(base.pathname)){const b=new URL(base.href);b.pathname=base.pathname.replace(/_500\.(jpe?g|png)$/i,'_big.$1');add(b.href)}
    if(base.href!==x.href)add(base.href);
  }
  if(mall&&x.hostname!=='cafe24img.poxo.com'&&x.pathname.startsWith('/web/product/'))add(`https://cafe24img.poxo.com/${mall}${x.pathname}`);
  if(location.protocol==='https:'&&x.protocol==='http:')add(x.href.replace(/^http:/,'https:')); // https 앱에서 http 사진은 막히므로 https로 먼저
  add(x.href);return out;
}
async function readProductImage(imageUrl,mall){
  const tries=imageCandidates(imageUrl,mall);if(!tries.length)throw new Error('사진 주소가 올바르지 않습니다');let last;
  for(const t of tries){try{return await fetchProductImage(t)}catch(e){last=e}}
  throw last;
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
async function previewProduct(text){
  if(productBusy){$('productStatus').textContent='앞 상품을 준비하는 중입니다. 끝난 뒤 다시 붙여 넣어주세요.';return}
  productBusy=true;$('productPreviewBtn').disabled=true;$('productQueueBtn').disabled=true;
  $('productStatus').textContent='상품 정보를 준비하고 있습니다…';
  try{
    const draft=await productFromText(typeof text==='string'?text:$('productPayload').value);
    let note=draft.imageNote;
    if(draft.image){try{draft.image=await f2b(draft.image)}catch{draft.image=null;note='단축어가 넘긴 사진을 열지 못했습니다'}}
    if(!draft.image&&draft.imageUrl){try{draft.image=await readProductImage(draft.imageUrl,draft.mall)}catch(e){draft.image=null;note=e.message}}
    productDraft=draft;$('productFields').innerHTML=productForm(draft.product);$('productReview').hidden=false;
    $('productPhoto').value='';renderProductPhoto();
    $('productStatus').textContent=draft.image?'사진·상품 정보와 구매한 옵션이 맞는지 확인해주세요.':`사진을 가져오지 못했습니다${note?`(${note})`:''}. 상품 사진을 선택하면 정보를 함께 등록할 수 있습니다.`;
    const card=$('productCard');if(card)card.open=true;$('productReview').scrollIntoView({block:'start'});
  }catch(e){$('productStatus').textContent=e.message;productDraft=null;$('productReview').hidden=true;productDiag(e.name&&e.name!=='Error'?e.name+': '+e.message:'')}
  finally{productBusy=false;$('productPreviewBtn').disabled=false;$('productQueueBtn').disabled=false;pruneURLs()}
}
// '붙여넣기' 버튼: 입력칸을 거치지 않고 클립보드를 바로 읽어 미리보기.
// iPhone은 readText()를 부르면 앱을 멈추고 누른 버튼 위에 작은 '붙여넣기' 말풍선을 띄운다(그 뒤 코드는 답한 다음에 실행된다).
// 버튼 폭이 넓으면(300pt 초과) 말풍선이 손가락 바로 위에 떠 가려지므로 버튼 폭을 줄였고, 안내 문구는 버튼 아래에 늘 보이게 둔다.
// 말풍선이 닫히거나 거절되면 입력칸에 길게 눌러 붙여 넣는 방법으로 안내한다
function openProductCard(){if(!$('add').classList.contains('active')&&typeof goAdd==='function')goAdd();const card=$('productCard');if(card){card.open=true;card.scrollIntoView({block:'start'})}}
function pasteByHand(msg){openProductCard();$('productStatus').textContent=msg||'아래 칸을 길게 눌러 붙여넣기를 누르세요. 붙여 넣으면 바로 미리보기가 시작됩니다.';$('productPayload').focus()}
function pasteProduct(){
  if(productBusy){if(typeof toast==='function')toast('앞 상품을 준비하는 중입니다');return Promise.resolve()}
  const read=navigator.clipboard&&navigator.clipboard.readText?navigator.clipboard.readText():Promise.reject(new Error('unsupported'));
  return read.then(t=>{openProductCard();if(!String(t||'').trim()){$('productStatus').textContent='클립보드가 비어 있습니다. 쇼핑몰에서 단축어를 먼저 실행해주세요.';return}return previewProduct(t)},
    e=>{productDiag(e&&e.name?e.name:'');pasteByHand("'붙여넣기' 말풍선이 닫혔습니다. 버튼을 다시 누르고 버튼 위의 작은 '붙여넣기'를 누르거나, 아래 칸을 길게 눌러 붙여 넣어주세요.")});
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
    const x={image,...suggestion,color:'',manual:{},requestId:0,aiStatus:suggestion.category?'상품명 참고 · 속성을 확인해주세요.':'상품 가져옴 · 분류 확인 필요',season:'사계절',formality:1,memo:p.name,wardrobeDetails:{product:p}};
    applyColorResult(x,col);{const nc=nameColor(p);if(nc){x.color=nc;x.colorSource='name';x.aiStatus+=' · 색은 상품명 참고'}}batch.push(x);productDraft=null;$('productReview').hidden=true;$('productPayload').value='';
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
    const data=await b64(await f2b(file,{trim:false}));if(session!==detailsSession||editingId===null)return; // 세탁 라벨은 자르지 않는다
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
// 가져오기 상태 표시줄: 이 파일이 돌았는지, 클립보드 읽기 지원·보안 연결 여부, 최근 오류를 보여 준다(사용자가 화면만 보고 원인을 알릴 수 있게)
function productDiag(err){const d=$('productDiag');if(!d)return;const clip=!!(navigator.clipboard&&navigator.clipboard.readText);d.textContent=`가져오기 준비됨 · v${typeof APP_VERSION!=='undefined'?APP_VERSION:'?'} · 클립보드 읽기 ${clip?'지원':'미지원'} · 보안 연결 ${window.isSecureContext?'예':'아니오'}${err?` · 최근 오류: ${String(err).slice(0,160)}`:''}`}
window.addEventListener('error',e=>{if(/wardrobe-import|product/i.test(String(e.filename||'')+String(e.message||'')))productDiag(e.message)});
window.addEventListener('unhandledrejection',e=>{const m=String(e.reason?.message||e.reason||'');if(m)productDiag(m)});
function initWardrobeExtras(){
  productDiag();
  const det=$('shortcutCode')&&$('shortcutCode').closest('details');if(det)det.addEventListener('toggle',()=>{if(det.open)prefetchShortcutCode()});
  $('productPhoto').onchange=e=>chooseProductPhoto(e.target.files[0]);
  const box=$('productPayload'),isPkg=s=>s.startsWith('{')||looksHTML(s)||looksB64(s);
  box.addEventListener('paste',e=>{
    if(productBusy){$('productStatus').textContent='앞 상품을 준비하는 중입니다. 끝난 뒤 다시 붙여 넣어주세요.';e.preventDefault();return}
    const t=e.clipboardData&&e.clipboardData.getData('text'),s=String(t||'').trim();
    if(s&&isPkg(s)){e.preventDefault();previewProduct(t);return} // 주소 같은 짧은 글은 칸에 그대로 둔다
    $('productStatus').textContent=s?`붙여 넣은 글 ${s.length}자를 확인합니다…`:'붙여 넣은 글을 확인합니다…';
  });
  // iPhone에서 붙여넣기 이벤트가 글을 주지 않을 때: 칸에 들어간 글로 판단한다
  box.addEventListener('input',()=>{const s=box.value.trim();if(!s||productBusy)return;if(isPkg(s)){const t=box.value;box.value='';previewProduct(t)}else $('productStatus').textContent=`붙여 넣은 글 ${s.length}자 · 상품 미리보기를 누르세요.`});
  $('carePhoto').onchange=e=>chooseCarePhoto(e.target.files[0]);
  $('productFile').onchange=async e=>{
    if(productBusy)return;const f=e.target.files[0];if(!f)return;
    try{if(f.size>PRODUCT_LIMIT)throw new Error('상품 파일이 너무 큽니다.');$('productPayload').value=await f.text();await previewProduct()}
    catch(error){$('productStatus').textContent=error.message}finally{e.target.value=''}
  };
}
