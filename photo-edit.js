/* photo-edit.js — 사진 다듬기: 자르기·회전·배경 지우기 (Claude Code, v5.3)
   PHOTO.edit(blob) → 다듬은 사진 Blob(JPEG, 긴 변 1200px 이하, 흰 바탕) 또는 null(취소).
   - 자르기: 사각형 네 모서리를 끌어 크기를, 가운데를 끌어 위치를 바꾼다. 회전은 90도씩.
   - 배경 지우기: bg-remove.js(BGR.remove)가 있으면 버튼을 보여 준다. 지운 배경은 흰색으로 채우고 옷 둘레로 자르기 상자를 맞춘다.
   - 등록 목록·옷 창이 부른다(index.html editPendingPhoto·editEditPhoto). index.html의 blobImage·toast를 부른다. */
(function(){
  const MAX_SRC=2048,OUT=1200,Q=.84,MIN=40;
  let st=null; // {src: canvas, orig: canvas, crop:{x,y,w,h}, resolve, busy}
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
#peBox i{position:absolute;width:30px;height:30px;border:4px solid #fff;touch-action:none}
#peBox i[data-h=nw]{left:-6px;top:-6px;border-right:0;border-bottom:0}
#peBox i[data-h=ne]{right:-6px;top:-6px;border-left:0;border-bottom:0}
#peBox i[data-h=sw]{left:-6px;bottom:-6px;border-right:0;border-top:0}
#peBox i[data-h=se]{right:-6px;bottom:-6px;border-left:0;border-top:0}
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
    $('peBox').addEventListener('pointerdown',down);
    window.addEventListener('resize',()=>{if(st)draw()});
  }
  const say=t=>{const e=$('peMsg');if(e)e.textContent=t||''};
  function canvasOf(w,h){const c=document.createElement('canvas');c.width=Math.max(1,Math.round(w));c.height=Math.max(1,Math.round(h));return c}
  function copy(c){const n=canvasOf(c.width,c.height);n.getContext('2d').drawImage(c,0,0);return n}
  function full(c){return {x:0,y:0,w:c.width,h:c.height}}
  async function act(fn){if(!st||st.busy)return;st.busy=true;sync();try{await fn()}catch(e){console.error(e);say(`처리하지 못했습니다: ${e&&e.message||e}`)}finally{if(st){st.busy=false;sync()}}}
  function sync(){for(const id of ['peRot','peBg','peReset','peOk'])if($(id))$(id).disabled=!!(st&&st.busy);const b=$('peBg');if(b)b.hidden=!(window.BGR&&BGR.supported())}
  // 화면 배치: 사진을 무대에 맞춰 그리고 자르기 상자를 겹친다
  function view(){const sg=$('peStage'),W=sg.clientWidth-24,H=sg.clientHeight-24,s=Math.min(W/st.src.width,H/st.src.height);return {s,ox:(sg.clientWidth-st.src.width*s)/2,oy:(sg.clientHeight-st.src.height*s)/2}}
  function draw(){
    const v=view(),cv=$('peCanvas'),dpr=Math.min(2,window.devicePixelRatio||1);
    cv.width=Math.round(st.src.width*v.s*dpr);cv.height=Math.round(st.src.height*v.s*dpr);cv.style.width=st.src.width*v.s+'px';cv.style.height=st.src.height*v.s+'px';cv.style.left=v.ox+'px';cv.style.top=v.oy+'px';
    cv.getContext('2d').drawImage(st.src,0,0,cv.width,cv.height);box();
  }
  function box(){const v=view(),b=$('peBox'),c=st.crop;b.style.left=v.ox+c.x*v.s+'px';b.style.top=v.oy+c.y*v.s+'px';b.style.width=c.w*v.s+'px';b.style.height=c.h*v.s+'px'}
  function down(e){
    if(!st||st.busy)return;e.preventDefault();
    const h=e.target.dataset&&e.target.dataset.h,v=view(),start={x:e.clientX,y:e.clientY,c:{...st.crop}},W=st.src.width,H=st.src.height;
    const move=ev=>{
      const dx=(ev.clientX-start.x)/v.s,dy=(ev.clientY-start.y)/v.s,c={...start.c};
      if(!h){c.x=Math.min(Math.max(0,c.x+dx),W-c.w);c.y=Math.min(Math.max(0,c.y+dy),H-c.h)}
      else{
        let l=c.x,t=c.y,r=c.x+c.w,b=c.y+c.h;
        if(h.includes('w'))l=Math.min(Math.max(0,l+dx),r-MIN);if(h.includes('e'))r=Math.max(Math.min(W,r+dx),l+MIN);
        if(h.includes('n'))t=Math.min(Math.max(0,t+dy),b-MIN);if(h.includes('s'))b=Math.max(Math.min(H,b+dy),t+MIN);
        Object.assign(c,{x:l,y:t,w:r-l,h:b-t});
      }
      st.crop=c;box();
    };
    const up=()=>{window.removeEventListener('pointermove',move);window.removeEventListener('pointerup',up);window.removeEventListener('pointercancel',up)};
    window.addEventListener('pointermove',move);window.addEventListener('pointerup',up);window.addEventListener('pointercancel',up);
  }
  function rotate(){
    const s=st.src,n=canvasOf(s.height,s.width),x=n.getContext('2d');x.translate(n.width,0);x.rotate(Math.PI/2);x.drawImage(s,0,0);
    const c=st.crop;st.crop={x:s.height-(c.y+c.h),y:c.x,w:c.h,h:c.w};st.src=n;st.turns=(st.turns+1)%4;draw();
  }
  function reset(){st.src=copy(st.orig);st.crop=full(st.src);st.turns=0;st.bg=false;say('');draw()}
  async function removeBg(){
    if(!(window.BGR&&BGR.supported()))return;
    if(st.bg){say('이미 배경을 지웠습니다. 다시 하려면 처음대로를 누르세요');return}
    const r=await BGR.remove(st.src,say);if(!r||!st)return; // {canvas(흰 바탕), box:{x,y,w,h}|null}
    st.src=r.canvas;st.bg=true;
    if(r.box){const m=Math.round(Math.max(r.box.w,r.box.h)*.08),W=st.src.width,H=st.src.height,x=Math.max(0,r.box.x-m),y=Math.max(0,r.box.y-m);st.crop={x,y,w:Math.min(W,r.box.x+r.box.w+m)-x,h:Math.min(H,r.box.y+r.box.h+m)-y}}
    say(r.box?'배경을 지우고 옷 둘레로 맞췄습니다. 상자를 고쳐도 됩니다':'옷을 찾지 못했습니다. 다른 사진으로 해 보세요');draw();
  }
  async function apply(){
    const c=st.crop,sc=Math.min(1,OUT/Math.max(c.w,c.h)),o=canvasOf(c.w*sc,c.h*sc),x=o.getContext('2d');
    x.fillStyle='#fff';x.fillRect(0,0,o.width,o.height);x.drawImage(st.src,c.x,c.y,c.w,c.h,0,0,o.width,o.height);
    const b=await new Promise(r=>o.toBlob(r,'image/jpeg',Q));o.width=o.height=0;
    if(!b)throw new Error('사진을 만들지 못했습니다');
    close(b);
  }
  function close(v){const s=st;st=null;$('peModal').classList.remove('open');say('');if(s){s.src.width=s.src.height=0;s.orig.width=s.orig.height=0;s.resolve(v)}}
  async function edit(blob){
    if(st)return null;dom();
    const im=await blobImage(blob),w=im.naturalWidth||im.width,h=im.naturalHeight||im.height;if(!w||!h)throw new Error('사진 크기를 읽을 수 없습니다.');
    const sc=Math.min(1,MAX_SRC/Math.max(w,h)),src=canvasOf(w*sc,h*sc),x=src.getContext('2d');x.fillStyle='#fff';x.fillRect(0,0,src.width,src.height);x.drawImage(im,0,0,src.width,src.height);
    return new Promise(resolve=>{st={src,orig:copy(src),crop:full(src),turns:0,bg:false,busy:false,resolve};$('peModal').classList.add('open');sync();requestAnimationFrame(draw)});
  }
  window.PHOTO={edit,isOpen:()=>!!st};
})();
