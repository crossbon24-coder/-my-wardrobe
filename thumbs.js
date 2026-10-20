/* thumbs.js — 목록용 작은 사진(썸네일) (Claude Code, v5.2)
   옷장 카드·코디 목록·고르기 창처럼 작은 칸에는 긴 변 360px 사본을 쓴다(큰 사진을 많이 그리면 iPhone이 느리고 메모리를 많이 쓴다).
   - 따로 둔 IndexedDB 'wardrobeThumbs'(store thumbs, keyPath id)에 {id,size,type,blob}로 저장한다. wardrobeDB·백업 형식은 그대로다(백업에 넣지 않고, 없으면 다시 만든다).
   - 원본 사진의 크기·형식(size·type)이 같을 때만 쓴다. 다르거나 없으면 그동안 원본을 보여 주고, 화면이 그려진 뒤 하나씩 만들어 그 자리의 사진만 바꾼다(img[data-tid]).
   - 원본이 이미 작으면(60KB 미만, 옮겨 온 240px 사진 등) 만들지 않고 원본을 쓴다.
   - 저장소를 못 열거나 만들기에 실패해도 원본으로 동작한다. 옷 창·코디 플랫레이는 원본을 쓴다.
   - WebKit은 IndexedDB에서 읽은 Blob을 레코드에 묶어 두므로(index.html stabilizeImages와 같은 이유) 읽은 썸네일은 메모리 사본으로 바꿔 쓴다.
   index.html의 url()·blobImage()를 부른다. */
(function(){
  const SMALL=60*1024,EDGE=360,NAME='wardrobeThumbs';
  const mem=new Map(); // id → {size,type,blob|null(원본 사용),u}
  let tdb=null,loaded=null,off=false,queue=[],busy=false,made=0,failed=0;
  const key=id=>String(id);
  function open(){return new Promise(res=>{
    try{const r=indexedDB.open(NAME,1);r.onupgradeneeded=()=>{if(!r.result.objectStoreNames.contains('thumbs'))r.result.createObjectStore('thumbs',{keyPath:'id'})};r.onsuccess=()=>{tdb=r.result;tdb.onclose=()=>{tdb=null};res(tdb)};r.onerror=()=>res(null);r.onblocked=()=>res(null)}catch{res(null)}
  })}
  function store(mode,fn){return new Promise(res=>{
    if(!tdb){res(null);return}
    try{const tx=tdb.transaction('thumbs',mode),s=tx.objectStore('thumbs');let out=null;const r=fn(s);if(r&&typeof r==='object'&&'onsuccess' in r)r.onsuccess=()=>{out=r.result};tx.oncomplete=()=>res(out);tx.onerror=tx.onabort=()=>res(null)}catch{res(null)}
  })}
  async function load(){
    if(!await open()){off=true;return}
    const rows=await store('readonly',s=>s.getAll())||[];
    for(const r of rows){
      if(!r||typeof r.size!=='number')continue;
      if(!(r.blob instanceof Blob)){mem.set(key(r.id),{size:r.size,type:r.type,blob:null});continue}
      try{mem.set(key(r.id),{size:r.size,type:r.type,blob:new Blob([await r.blob.arrayBuffer()],{type:r.blob.type})})}catch{}
    }
  }
  function forget(id){const m=mem.get(id);if(m&&m.u)URL.revokeObjectURL(m.u);mem.delete(id)}
  const fits=(m,img)=>!!m&&img instanceof Blob&&m.size===img.size&&m.type===img.type;
  // refresh()가 render() 전에 부른다: 처음에 저장된 썸네일을 읽고, 지운 옷·바뀐 사진의 썸네일을 버린다
  async function sync(rows){
    try{
      if(!loaded)loaded=load();await loaded;
      const live=new Map(rows.filter(c=>c&&c.image instanceof Blob).map(c=>[key(c.id),c])),gone=[];
      for(const [id,m] of [...mem])if(!live.has(id)||!fits(m,live.get(id).image)){forget(id);gone.push(id)}
      if(gone.length&&!off)store('readwrite',s=>{for(const id of gone)s.delete(id)});
      queue=queue.filter(id=>live.has(id));
    }catch(e){console.warn('thumbs',e)}
  }
  // 작은 칸의 사진 주소. 아직 없으면 원본 주소를 주고 만들 차례에 넣는다
  function src(c){
    if(!c||!(c.image instanceof Blob))return '';
    const id=key(c.id),m=mem.get(id);
    if(fits(m,c.image)){if(!m.blob)return url(c.image);if(!m.u)m.u=URL.createObjectURL(m.blob);return m.u}
    if(c.image.size<SMALL){mem.set(id,{size:c.image.size,type:c.image.type,blob:null});save(id,c.image,null);return url(c.image)}
    if(!off&&!queue.includes(id))queue.push(id);schedule();
    return url(c.image);
  }
  function attr(c){return `src="${src(c)}" data-tid="${esc(key(c&&c.id))}"`}
  function save(id,img,blob){if(off)return;store('readwrite',s=>s.put({id,size:img.size,type:img.type,...(blob?{blob}:{})}))}
  function schedule(){if(busy||!queue.length)return;busy=true;setTimeout(step,30)}
  async function make(img){
    const im=await blobImage(img),w=im.naturalWidth||im.width,h=im.naturalHeight||im.height;
    if(!w||!h)return null;
    const sc=Math.min(1,EDGE/Math.max(w,h));if(sc>=1)return null; // 이미 작음
    const cv=document.createElement('canvas');cv.width=Math.max(1,Math.round(w*sc));cv.height=Math.max(1,Math.round(h*sc));
    const x=cv.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,cv.width,cv.height);x.drawImage(im,0,0,cv.width,cv.height);
    const b=await new Promise(r=>cv.toBlob(r,'image/jpeg',.82));cv.width=cv.height=0;
    return b&&b.size<img.size?b:null;
  }
  async function step(){
    try{
      const id=queue.shift();if(id===undefined)return;
      const c=(typeof clothes!=='undefined'?clothes:[]).find(x=>key(x.id)===id);
      if(!c||!(c.image instanceof Blob)||fits(mem.get(id),c.image))return;
      const img=c.image;let b=null;
      let bad=false;try{b=await make(img)}catch{failed++;bad=true}
      if(c.image!==img)return; // 그사이 사진이 바뀜
      mem.set(id,{size:img.size,type:img.type,blob:b});if(!bad)save(id,img,b);if(b)made++; // 실패는 저장하지 않아 다음 실행에 다시 만든다
      const u=src(c);for(const el of document.querySelectorAll('img[data-tid]'))if(el.dataset.tid===id&&el.getAttribute('src')!==u)el.src=u;
    }catch(e){console.warn('thumbs',e)}
    finally{busy=false;if(queue.length)schedule()}
  }
  function stats(){let n=0;for(const m of mem.values())if(m.blob)n++;return {thumbs:n,waiting:queue.length,made,failed,off}}
  window.THUMB={sync,src,attr,drop:id=>{forget(key(id));if(!off)store('readwrite',s=>s.delete(key(id)))},stats};
})();
