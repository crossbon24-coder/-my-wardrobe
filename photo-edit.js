/* photo-edit.js — 사진 다듬기: 자르기·회전·배경 지우기 (Claude Code, v5.3)
   PHOTO.edit(blob) → 다듬은 사진 Blob(JPEG, 긴 변 1200px 이하, 흰 바탕) 또는 null(취소).
   - 자르기: 사각형 네 모서리를 끌어 크기를, 가운데를 끌어 위치를 바꾼다. 회전은 90도씩.
   - 배경 지우기: bg-remove.js(BGR.remove)가 있으면 버튼을 보여 준다. 지운 배경은 흰색으로 채우고 옷 둘레로 자르기 상자를 맞춘다.
   - 등록 목록·옷 창이 부른다(index.html editPendingPhoto·editEditPhoto). index.html의 blobImage·toast를 부른다. */
(function(){
  const MAX_SRC=2048,OUT=1200,Q=.84,MIN_PX=40;
  let st=null,seq=0; // {sid, src: canvas, orig: canvas, crop:{x,y,w,h}, pre: 배경 지우기 전 {src,crop}, resolve, busy, drag: 끌고 있는 손가락 pointerId}
  const $=id=>document.getElementById(id);
  function css(){
    if($('peCSS'))return;const s=document.createElement('style');s.id='peCSS';s.textContent=`
#peModal{position:fixed;inset:0;z-index:59;background:#111;display:none;flex-direction:column;color:#fff;padding:env(safe-area-inset-top) 0 env(safe-area-inset-bottom)}
#peModal.open{display:flex}
#peModal .pe-bar{display:flex;gap:8px;padding:10px 12px;align-items:center;flex-wrap:wrap}
#peModal .pe-bar button{flex:none;width:auto;margin:0;padding:9px 13px;font-size:14px;background:#2a2a2a;color:#fff;border-radius:11px}
#peModal .pe-bar button.pe-ok{background:#fff;color:#111}
#peModal .pe-bar button:disabled{opacity:.45}
#peModal .pe-title{flex:1 1 auto;font-weight:700}
#peStage{flex:1 1 auto;position:relative;overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
#peCanvas{position:absolute;left:0;top:0}
#peBox{position:absolute;border:2px solid #fff;box-shadow:0 0 0 9999px rgba(0,0,0,.55);cursor:move;touch-action:none}
#peBox i{position:absolute;width:48px;height:48px;touch-action:none}
#peBox i::after{content:"";position:absolute;width:24px;height:24px;border:4px solid #fff;pointer-events:none}
#peBox i[data-h=nw]{left:-22px;top:-22px}#peBox i[data-h=nw]::after{left:16px;top:16px;border-right:0;border-bottom:0}
#peBox i[data-h=ne]{right:-22px;top:-22px}#peBox i[data-h=ne]::after{right:16px;top:16px;border-left:0;border-bottom:0}
#peBox i[data-h=sw]{left:-22px;bottom:-22px}#peBox i[data-h=sw]::after{left:16px;bottom:16px;border-right:0;border-top:0}
#peBox i[data-h=se]{right:-22px;bottom:-22px}#peBox i[data-h=se]::after{right:16px;bottom:16px;border-left:0;border-top:0}
#peMsg{min-height:20px;padding:0 12px 6px;font-size:13px;color:#ddd}`;document.head.appendChild(s);
  }
  function dom(){
    if($('peModal'))return;css();
    const m=document.createElement('div');m.id='peModal';m.setAttribute('role','dialog');m.setAttribute('aria-label','사진 다듬기');
    m.innerHTML=`<div class="pe-bar"><span class="pe-title">사진 다듬기</span><button type="button" id="peRot">↻ 회전</button><button type="button" id="peBg" hidden>배경 지우기</button><button type="button" id="peReset">처음대로</button></div>
<div id="peStage"><canvas id="peCanvas"></canvas><div id="peBox"><i data-h="nw"></i><i data-h="ne"></i><i data-h="sw"></i><i data-h="se"></i></div></div>
<div id="peMsg" role="status"></div>
<div class="pe-bar"><button type="button" id="peCancel">취소</button><span class="pe-title"></span><button type="button" class="pe-ok" id="peOk">적용</button></div>`;
    document.body.appendChild(m);
    $('peRot').onclick=()=>act(rotate);$('peReset').onclick=()=>act(reset);$('peBg').onclick=()=>act(removeBg);
    $('peCancel').onclick=()=>close(null);$('peOk').onclick=()=>act(apply);
    $('peStage').addEventListener('pointerdown',down);
    window.addEventListener('resize',()=>{if(st)draw()});
    // 버튼 글자·안내가 바뀌어 위아래 줄이 늘면 무대 크기가 바뀐다: 사진과 상자를 함께 다시 그린다(상자만 다시 계산하면 사진과 어긋남)
    if(typeof ResizeObserver==='function')new ResizeObserver(()=>{if(st)draw()}).observe($('peStage'));
  }
  const say=t=>{const e=$('peMsg');if(e)e.textContent=t||''};
  function canvasOf(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c}
  function copy(c){const n=canvasOf(c.width,c.height);n.getContext('2d').drawImage(c,0,0);return n}
  function full(c){return {x:0,y:0,w:c.width,h:c.height}}
  // 취소로 창을 닫은 뒤 끝난 작업은 새로 연 다른 사진(st)을 건드리지 않는다(sid로 같은 편집인지 확인)
  async function act(fn){if(!st||st.busy)return;const s=st;s.busy=true;sync();try{await fn(s)}catch(e){console.error(e);if(st===s)say(`처리하지 못했습니다: ${e&&e.message||e}`)}finally{if(st===s){s.busy=false;sync()}}}
  function sync(){for(const id of ['peRot','peBg','peReset','peOk'])if($(id))$(id).disabled=!!(st&&st.busy);const b=$('peBg');if(b){b.hidden=!(window.BGR&&BGR.supported());b.textContent=st&&st.bg?'배경 되돌리기':'배경 지우기'}}
  // 화면 배치: 사진을 무대에 맞춰 그리고 자르기 상자를 겹친다
  function view(){const sg=$('peStage'),W=sg.clientWidth-24,H=sg.clientHeight-24,s=Math.min(W/st.src.width,H/st.src.height);return {s,ox:(sg.clientWidth-st.src.width*s)/2,oy:(sg.clientHeight-st.src.height*s)/2}}
  function draw(){
    const v=view(),cv=$('peCanvas'),dpr=Math.min(2,window.devicePixelRatio||1);
    cv.width=Math.round(st.src.width*v.s*dpr);cv.height=Math.round(st.src.height*v.s*dpr);cv.style.width=st.src.width*v.s+'px';cv.style.height=st.src.height*v.s+'px';cv.style.left=v.ox+'px';cv.style.top=v.oy+'px';
    cv.getContext('2d').drawImage(st.src,0,0,cv.width,cv.height);box();
  }
  function box(){const v=view(),b=$('peBox'),c=st.crop;b.style.left=v.ox+c.x*v.s+'px';b.style.top=v.oy+c.y*v.s+'px';b.style.width=c.w*v.s+'px';b.style.height=c.h*v.s+'px'}
  function down(e){
    if(!st||st.busy||st.drag!=null)return;e.preventDefault(); // 두 번째 손가락은 무시(끌던 손가락만 따른다)
    const h=e.target.dataset&&e.target.dataset.h,v=view(),start={x:e.clientX,y:e.clientY,c:{...st.crop}},W=st.src.width,H=st.src.height,id=e.pointerId,s=st;
    const MIN=Math.min(W,H,Math.max(MIN_PX,60/v.s)); // 화면에서 60px보다 작아지지 않게(모서리 손잡이가 가운데를 덮지 않게)
    s.drag=id;
    const move=ev=>{if(ev.pointerId!==id||st!==s)return;
      const dx=(ev.clientX-start.x)/v.s,dy=(ev.clientY-start.y)/v.s,c={...start.c};
      if(!h){c.x=Math.min(Math.max(0,c.x+dx),W-c.w);c.y=Math.min(Math.max(0,c.y+dy),H-c.h)}
      else{
        let l=c.x,t=c.y,r=c.x+c.w,b=c.y+c.h;
        // 상자가 최소보다 좁게 시작해도(배경 지우기가 맞춘 상자 등) 사진 밖으로 나가지 않게 양쪽 끝을 사진 안으로 묶는다
        if(h.includes('w'))l=Math.min(Math.max(0,l+dx),Math.max(0,r-MIN));if(h.includes('e'))r=Math.max(Math.min(W,r+dx),Math.min(W,l+MIN));
        if(h.includes('n'))t=Math.min(Math.max(0,t+dy),Math.max(0,b-MIN));if(h.includes('s'))b=Math.max(Math.min(H,b+dy),Math.min(H,t+MIN));
        Object.assign(c,{x:l,y:t,w:r-l,h:b-t});
      }
      st.crop=c;box();
    };
    const up=ev=>{if(ev&&ev.pointerId!==id)return;s.drag=null;window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up)};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
  }
  function turn(s){const n=canvasOf(s.height,s.width),x=n.getContext('2d');x.translate(n.width,0);x.rotate(Math.PI/2);x.drawImage(s,0,0);return n}
  const turnCrop=(c,h)=>({x:h-(c.y+c.h),y:c.x,w:c.h,h:c.w});
  function rotate(){
    const s=st.src;st.crop=turnCrop(st.crop,s.height);st.src=turn(s);s.width=s.height=0;st.turns=(st.turns+1)%4;
    if(st.pre){const p=st.pre.src;st.pre={src:turn(p),crop:turnCrop(st.pre.crop,p.height)};p.width=p.height=0}
    draw();
  }
  function dropPre(){if(st&&st.pre){st.pre.src.width=st.pre.src.height=0;st.pre=null}}
  function reset(){dropPre();st.src=copy(st.orig);st.crop=full(st.src);st.turns=0;st.bg=false;say('');draw()}
  // 배경 지우기: 옷을 찾지 못하면 사진을 바꾸지 않는다. 지운 뒤에는 같은 버튼이 '배경 되돌리기'(지우기 전 사진·상자로, 그 뒤 회전도 따라감)
  async function removeBg(s){
    if(!(window.BGR&&BGR.supported()))return;
    if(s.bg){const p=s.pre;if(p){s.src.width=s.src.height=0;s.src=p.src;s.crop=p.crop;s.pre=null}s.bg=false;say('배경을 되돌렸습니다');draw();return}
    const r=await BGR.remove(s.src,t=>{if(st===s)say(t)}); // {canvas(흰 바탕), box:{x,y,w,h}|null}
    if(!r)return;if(st!==s){r.canvas.width=r.canvas.height=0;return} // 그 사이 취소했다
    if(!r.box){r.canvas.width=r.canvas.height=0;say('옷을 찾지 못해 사진을 그대로 두었습니다. 배경과 옷 색이 다른 사진으로 해 보세요');return}
    s.pre={src:s.src,crop:s.crop};s.src=r.canvas;s.bg=true;
    const m=Math.round(Math.max(r.box.w,r.box.h)*.08),W=s.src.width,H=s.src.height,x=Math.max(0,r.box.x-m),y=Math.max(0,r.box.y-m);s.crop={x,y,w:Math.min(W,r.box.x+r.box.w+m)-x,h:Math.min(H,r.box.y+r.box.h+m)-y};
    say('배경을 지우고 옷 둘레로 맞췄습니다. 상자를 고쳐도 됩니다');draw();
  }
  async function apply(s){
    const c=s.crop,sc=Math.min(1,OUT/Math.max(c.w,c.h)),o=canvasOf(c.w*sc,c.h*sc),x=o.getContext('2d');
    x.fillStyle='#fff';x.fillRect(0,0,o.width,o.height);x.drawImage(s.src,c.x,c.y,c.w,c.h,0,0,o.width,o.height);
    const b=await new Promise(r=>o.toBlob(r,'image/jpeg',Q));o.width=o.height=0;
    if(st!==s)return; // 그 사이 취소했다(새로 연 사진을 닫지 않는다)
    if(!b)throw new Error('사진을 만들지 못했습니다');
    close(b,s);
  }
  function close(v,s=st){if(!s||s!==st)return;dropPre();st=null;$('peModal').classList.remove('open');say('');if(s){if(!s.busy){s.src.width=s.src.height=0}s.orig.width=s.orig.height=0;s.resolve(v)}} // 처리 중인 사진은 작업이 끝나며 버려진다
  async function edit(blob){
    if(st)return null;dom();
    const im=await blobImage(blob),w=im.naturalWidth||im.width,h=im.naturalHeight||im.height;if(!w||!h)throw new Error('사진 크기를 읽을 수 없습니다.');
    const sc=Math.min(1,MAX_SRC/Math.max(w,h)),src=canvasOf(w*sc,h*sc),x=src.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,src.width,src.height);x.drawImage(im,0,0,src.width,src.height);
    return new Promise(resolve=>{st={sid:++seq,src,orig:copy(src),crop:full(src),turns:0,bg:false,pre:null,busy:false,drag:null,resolve};$('peModal').classList.add('open');sync();requestAnimationFrame(draw)});
  }
  window.PHOTO={edit,isOpen:()=>!!st};
})();
