/* outfit-list.js — 코디 탭의 모아보기(3열 격자·검색·칩·월별 묶음)와 코디 상세 창 (Claude Code, v4.11~)
   불러올 때는 함수·상태만 만들고 아무것도 실행하지 않는다(outfits.js보다 먼저 불러온다). 그릴 때 outfits.js의 OF.util과
   index.html 전역(outfits, clothes, $, esc, arg, url)을 부른다. 저장(오늘 입음·즐겨찾기·보관·이름·삭제)은 OF의 함수가 한다.
   재설계 계획(PROJECT.md): 이 화면은 v5 화면 정리 때도 그대로 쓰도록 처음부터 따로 둔다.
   - 보관한 코디(archived)는 '보관함' 칩에서만 보인다. 즐겨찾기(fav)는 맨 위 묶음에 고정한다(그 아래 목록에는 다시 넣지 않음).
   - 날짜순(최근 저장·최근 입은 순)은 달마다 묶고 이번 달·지난달만 펼친다. 묶음·목록마다 30개씩 보여 주고 '더 보기'로 잇는다. */
(function(){
  const STEP=30,STALE_DAYS=30,SORT_KEY='wardrobe.outfitSort';
  const SORTS=[['recent','최근 저장'],['last','최근 입은 순'],['most','많이 입은 순'],['stale','오래 안 입은 순']];
  const CHIPS=[['all','전체'],['fav','★ 즐겨찾기'],['stale','오래 안 입음'],['archived','보관함']];
  const COVER=['outer','top','bottom','shoes','bag','acc'];
  const st={q:'',chip:'all',sort:'recent',item:null,limits:new Map(),open:new Map(),loaded:false};
  let detailId=null;
  const U=()=>window.OF&&OF.util;
  const loadPref=()=>{if(st.loaded)return;st.loaded=true;try{const s=localStorage.getItem(SORT_KEY);if(SORTS.some(([k])=>k===s))st.sort=s}catch{}};
  const lim=k=>st.limits.get(k)||STEP;
  const sameId=(a,b)=>a!==null&&a!==undefined&&b!==null&&b!==undefined&&String(a)===String(b);
  const hasItem=(o,id)=>Object.values(o.slots).some(v=>sameId(v,id));
  // 오래 안 입음: 마지막으로 입은 날이 30일보다 전이거나 입은 기록이 없는 코디
  function staleCut(){const d=new Date();d.setDate(d.getDate()-STALE_DAYS);return U().fmtDate(d)}
  const md=s=>{const yr=U().today().slice(0,4);return `${s.slice(0,4)===yr?'':s.slice(2,4)+'/'}${Number(s.slice(5,7))}/${Number(s.slice(8))}`};
  const hayOf=o=>{const u=U();return [o.name,...Object.values(o.slots).map(id=>{const c=u.byId(id);return c?u.hay(c):''})].join(' ').toLowerCase()};

  // ---------- 고르기·정렬 ----------
  // '오래 안 입음' 칩을 켜면 정렬은 오래 안 입은 순으로 고정한다(입은 적 없는 코디 먼저)
  const sortKey=()=>st.chip==='stale'?'stale':st.sort;
  function sorted(list){
    const u=U(),lw=u.lastWorn,by={
      recent:(a,b)=>(b.createdAt||0)-(a.createdAt||0),
      last:(a,b)=>lw(b)>lw(a)?1:lw(b)<lw(a)?-1:(b.createdAt||0)-(a.createdAt||0),
      most:(a,b)=>b.worn.length-a.worn.length||(lw(b)>lw(a)?1:lw(b)<lw(a)?-1:0)||(b.createdAt||0)-(a.createdAt||0),
      // 입은 기록이 없는 코디가 먼저, 그다음 오래전에 입은 순
      stale:(a,b)=>lw(a)>lw(b)?1:lw(a)<lw(b)?-1:(b.createdAt||0)-(a.createdAt||0)
    }[sortKey()]||((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    return list.slice().sort(by);
  }
  function pickList(all){
    let list=all.filter(o=>st.chip==='archived'?o.archived:!o.archived);
    if(st.chip==='fav')list=list.filter(o=>o.fav);
    if(st.chip==='stale'){const cut=staleCut();list=list.filter(o=>{const l=U().lastWorn(o);return !l||l<cut})}
    if(st.item!==null)list=list.filter(o=>hasItem(o,st.item));
    const ts=U().terms(st.q);if(ts.length)list=list.filter(o=>{const h=hayOf(o);return ts.every(t=>h.includes(t))});
    return sorted(list);
  }
  const plain=()=>st.chip==='all'&&!U().terms(st.q).length&&st.item===null;

  // ---------- 화면 조각 ----------
  // 코디 사진: 옷 사진을 최대 4장까지 정사각형 안에 모은다(1장 전체, 2장 위아래, 3장 위 1장·아래 2장, 4장 2x2). 사진은 잘리지 않게 contain
  function coverHTML(o){
    const u=U(),its=COVER.map(k=>u.byId(o.slots[k])).filter(Boolean).slice(0,4);
    return `<span class="ofl-cover n${its.length}">${its.length?its.map(c=>`<img ${tsrc(c)} alt="" loading="lazy" decoding="async" draggable="false">`).join(''):'<span>옷 없음</span>'}</span>`; // 버튼(카드) 안이라 span
  }
  const metaOf=o=>o.worn.length?`${o.worn.length}회 · ${md(U().lastWorn(o))}`:'안 입음';
  function cardHTML(o){
    const u=U(),ed=u.editingId===o.id&&window.OF&&OF.hasDraft();
    return `<button type="button" class="ofl-card" data-of="${esc(String(o.id))}" onclick="OFL.open(${arg(o.id)})" aria-label="${esc(o.name)}, ${esc(metaOf(o))}${o.fav?', 즐겨찾기':''}">${coverHTML(o)}${o.fav?'<b class="ofl-star" aria-hidden="true">★</b>':''}${ed?'<b class="ofl-edit" aria-hidden="true">고치는 중</b>':''}<span class="ofl-name">${esc(o.name)}</span><span class="ofl-meta">${esc(metaOf(o))}</span></button>`;
  }
  function gridHTML(list,key){
    const n=lim(key),shown=list.slice(0,n),rest=list.length-shown.length;
    return `<div class="ofl-grid">${shown.map(o=>{try{return cardHTML(o)}catch(e){console.error('outfit card',e);return '<div class="ofl-card small muted">읽을 수 없는 코디</div>'}}).join('')}</div>`
      +(rest>0?`<button type="button" class="secondary ofl-more" onclick="OFL.more(${arg(key)})">더 보기 (${rest}개 남음)</button>`:'');
  }
  function groupKeyOf(o){
    if(st.sort==='last'){const l=U().lastWorn(o);return l?l.slice(0,7):'none'}
    return o.createdAt>0?U().fmtDate(new Date(o.createdAt)).slice(0,7):'none';
  }
  const groupLabel=k=>k==='none'?(st.sort==='last'?'입은 기록 없음':'날짜 모름'):`${Number(k.slice(0,4))}년 ${Number(k.slice(5))}월`;
  function groupsHTML(list){
    const order=[],g=new Map();for(const o of list){const k=groupKeyOf(o);if(!g.has(k)){g.set(k,[]);order.push(k)}g.get(k).push(o)}
    const now=U().today().slice(0,7),d=new Date();d.setDate(1);d.setMonth(d.getMonth()-1);const prev=U().fmtDate(d).slice(0,7);
    const def=k=>k===now||k===prev,anyDef=order.some(def);
    // 이번 달·지난달 묶음이 없으면 맨 앞 묶음을 펼쳐 첫 화면이 비지 않게 한다. 사용자가 누른 것은 이번 실행 동안 기억한다
    const isOpen=(k,i)=>{const id=st.sort+'|'+k;return st.open.has(id)?st.open.get(id):def(k)||(!anyDef&&i===0)};
    return order.map((k,i)=>{const open=isOpen(k,i),items=g.get(k);
      return `<div class="ofl-group${open?' open':''}"><button type="button" class="ofl-ghead" aria-expanded="${open}" onclick="OFL.toggle(${arg(k)},${open?'false':'true'})"><b>${esc(groupLabel(k))}</b> <span class="small muted">${items.length}개</span><i aria-hidden="true">${open?'▾':'▸'}</i></button>${open?gridHTML(items,'g|'+st.sort+'|'+k):''}</div>`}).join('');
  }
  function bodyHTML(){
    const u=U(),all=outfits.map(u.norm);
    if(!all.length)return '<div class="empty">저장한 코디가 없습니다.<br>오른쪽 위 \'+ 새 코디\'로 만들어 보세요.</div>';
    const list=pickList(all);
    if(!list.length&&plain()&&all.some(o=>o.archived))return `<div class="empty">모든 코디가 보관함에 있습니다.<br><button type="button" class="secondary" style="margin-top:10px" onclick="OFL.chip('archived')">보관함 보기</button></div>`;
    if(!list.length)return `<div class="empty">${st.chip==='archived'&&!u.terms(st.q).length&&st.item===null?'보관한 코디가 없습니다.<br>코디를 누르고 \'보관\'을 고르면 목록에서 숨깁니다.':st.chip==='fav'&&!u.terms(st.q).length&&st.item===null?'즐겨찾기한 코디가 없습니다.<br>코디를 누르고 ☆를 누르세요.':'조건에 맞는 코디가 없습니다.'}</div>`;
    if(!plain()){ // 검색·칩·이 옷 거르기: 묶지 않고 한 목록(보관함 밖에서는 즐겨찾기 먼저)
      const l=st.chip==='archived'?list:[...list.filter(o=>o.fav),...list.filter(o=>!o.fav)];
      return `<p class="small muted ofl-count">${l.length}개</p>`+gridHTML(l,'flat');
    }
    const favs=list.filter(o=>o.fav),rest=list.filter(o=>!o.fav);
    return (favs.length?`<div class="ofl-sec"><b>★ 즐겨찾기</b> <span class="small muted">${favs.length}개</span></div>${gridHTML(favs,'fav')}`:'')
      +(rest.length?(st.sort==='recent'||st.sort==='last'?(favs.length?'<div class="ofl-sec"><b>전체</b></div>':'')+groupsHTML(rest):(favs.length?'<div class="ofl-sec"><b>전체</b></div>':'')+gridHTML(rest,'rest')):'');
  }
  function toolsHTML(){
    const u=U(),all=outfits.map(u.norm),nArch=all.filter(o=>o.archived).length,nFav=all.filter(o=>o.fav&&!o.archived).length;
    const it=st.item!==null?u.byId(st.item):null;
    const chips=CHIPS.map(([k,l])=>`<button type="button" class="chip${st.chip===k?' on':''}" aria-pressed="${st.chip===k}" onclick="OFL.chip(${arg(k)})">${l}${k==='fav'&&nFav?` ${nFav}`:k==='archived'&&nArch?` ${nArch}`:''}</button>`).join('');
    // '이 옷' 거르기는 칩 줄 끝(가로로 밀려 안 보임)이 아니라 검색칸 위 한 줄로 보여 준다
    const itemRow=st.item!==null?`<div class="ofl-itemrow"><span>이 옷이 든 코디만: <b>${esc(it?u.title(it):'지운 옷')}</b></span><button type="button" class="ghost" onclick="OFL.item(null)">풀기</button></div>`:'';
    return `<div class="ofl-tools">${itemRow}<div class="row" style="align-items:center"><input id="oflSearch" type="search" placeholder="코디·옷 이름 검색" aria-label="코디 검색" autocomplete="off" value="${esc(st.q)}" oninput="OFL.query(this.value)"><select id="oflSort" aria-label="코디 정렬" style="flex:none;width:auto" ${st.chip==='stale'?'disabled':''} onchange="OFL.sort(this.value)">${SORTS.map(([k,l])=>`<option value="${k}"${sortKey()===k?' selected':''}>${l}</option>`).join('')}</select></div><div class="chips ofl-chips">${chips}</div></div>`;
  }
  // 목록 화면 전체(검색칸 포함). 검색 글자를 칠 때는 renderBody만 다시 그려 입력칸 포커스를 지킨다
  function html(){loadPref();return toolsHTML()+`<div id="oflBody">${bodyHTML()}</div>`}
  function renderBody(){const b=$('oflBody');if(b)b.innerHTML=bodyHTML()}
  function rerender(){if(typeof window.OF?.refreshList==='function')OF.refreshList();else renderBody()}

  // ---------- 코디 상세 ----------
  function ensureModal(){
    if($('oflModal'))return;
    const m=document.createElement('div');m.id='oflModal';m.className='modal';m.onclick=e=>{if(e.target===m)OFL.close()};
    m.innerHTML='<div class="sheet" role="dialog" aria-modal="true" aria-label="코디 상세"><div id="oflDetail"></div></div>';document.body.appendChild(m);
  }
  function detailHTML(o){
    const u=U(),t=u.today(),wornToday=o.worn.includes(t),days=o.worn.slice().reverse();
    const rows=u.SLOTS.filter(s=>o.slots[s.key]!==null&&o.slots[s.key]!==undefined).map(s=>{const c=u.byId(o.slots[s.key]);
      return c?`<button type="button" class="ofl-it" onclick="OFL.garment(${arg(c.id)})"><img ${tsrc(c)} alt="" loading="lazy" decoding="async"><span><b>${esc(s.label)}</b> ${esc(u.title(c))}${c.archived?' <span class="muted">(보관한 옷)</span>':''}</span><i aria-hidden="true">›</i></button>`
        :`<div class="ofl-it gone"><span class="ofl-noimg"></span><span><b>${esc(s.label)}</b> <span class="muted">지운 옷</span></span></div>`}).join('');
    return `<div class="pick-head"><div class="row" style="align-items:center"><h2 style="margin:0;flex:1;min-width:0;overflow-wrap:anywhere">${esc(o.name)}</h2><button type="button" class="ofl-favbtn${o.fav?' on':''}" aria-pressed="${!!o.fav}" aria-label="${o.fav?'즐겨찾기 해제':'즐겨찾기'}" onclick="OF.fav(${arg(o.id)},${o.fav?'false':'true'})">${o.fav?'★':'☆'}</button><button type="button" class="pick-close" aria-label="닫기" onclick="OFL.close()">×</button></div></div>
      ${o.archived?'<p class="small ofl-archived">보관한 코디입니다. 목록에서는 \'보관함\' 칩에서만 보입니다.</p>':''}
      <div class="ofl-detail-fl">${u.flatLayHTML(o.slots)}</div>
      <p class="small muted" style="margin:10px 0 4px">${o.createdAt>0?`저장 ${esc(u.fmtDate(new Date(o.createdAt)))} · `:''}${o.worn.length?`${o.worn.length}회 입음 · 마지막 ${esc(md(u.lastWorn(o)))}`:'아직 입은 기록이 없습니다'}</p>
      ${days.length?`<p class="small" style="margin:0 0 6px"><b>입은 날</b> ${days.slice(0,8).map(d=>esc(md(d))).join(', ')}${days.length>8?` 외 ${days.length-8}일`:''}</p>`:''}
      <div class="row ofl-main"><button type="button" ${wornToday?'disabled':''} onclick="OF.wear(${arg(o.id)})">${wornToday?'오늘 입음 ✓':'오늘 입음'}</button><button type="button" class="secondary" onclick="OFL.edit(${arg(o.id)})">고치기</button></div>
      <div class="ofl-items">${rows||'<p class="small muted">든 옷이 없습니다.</p>'}</div>
      <div class="actions ofl-menu"><button type="button" class="ghost" onclick="OF.rename(${arg(o.id)})">이름 바꾸기</button><button type="button" class="ghost" onclick="OF.archive(${arg(o.id)},${o.archived?'false':'true'})">${o.archived?'보관 해제':'보관'}</button><button type="button" class="ghost danger" onclick="OF.del(${arg(o.id)})">삭제</button></div>`;
  }
  function renderDetail(){
    if(detailId===null)return;
    const raw=outfits.find(x=>sameId(x.id,detailId));
    if(!raw){close();return} // 지웠거나 합치기로 사라짐
    ensureModal();$('oflDetail').innerHTML=detailHTML(U().norm(raw));$('oflModal').classList.add('open');
  }
  function open(id){if(!outfits.some(x=>sameId(x.id,id)))return;detailId=outfits.find(x=>sameId(x.id,id)).id;renderDetail();const sh=$('oflModal')&&$('oflModal').querySelector('.sheet');if(sh)sh.scrollTop=0} // 다른 코디의 스크롤 위치로 열리지 않게
  function close(){detailId=null;const m=$('oflModal');if(m)m.classList.remove('open')}

  // 저장한 코디를 목록에서 찾아 보이게 한다(가리는 거르기를 풀고, 묶음을 펼치고, '더 보기' 범위를 늘린 뒤 가운데로 스크롤·강조)
  function reveal(id){
    const raw=outfits.find(x=>sameId(x.id,id));if(!raw)return;const o=U().norm(raw);
    if(!pickList(outfits.map(U().norm)).some(x=>sameId(x.id,id))){st.q='';st.item=null;st.chip=o.archived?'archived':'all'}
    if(plain()&&!o.fav&&(st.sort==='recent'||st.sort==='last')){const k=groupKeyOf(o);st.open.set(st.sort+'|'+k,true);const list=pickList(outfits.map(U().norm)).filter(x=>!x.fav&&groupKeyOf(x)===k),i=list.findIndex(x=>sameId(x.id,id));if(i>=lim('g|'+st.sort+'|'+k))st.limits.set('g|'+st.sort+'|'+k,Math.ceil((i+1)/STEP)*STEP)}
    else{const key=plain()?(o.fav?'fav':'rest'):'flat',all=pickList(outfits.map(U().norm)),l=plain()?all.filter(x=>!!x.fav===!!o.fav):st.chip==='archived'?all:[...all.filter(x=>x.fav),...all.filter(x=>!x.fav)],i=l.findIndex(x=>sameId(x.id,id));if(i>=lim(key))st.limits.set(key,Math.ceil((i+1)/STEP)*STEP)}
    rerender();
    const el=[...document.querySelectorAll('#outfit .ofl-card[data-of]')].find(x=>x.dataset.of===String(id));
    if(el){el.scrollIntoView({block:'center'});el.classList.add('of-flash');setTimeout(()=>el.classList.remove('of-flash'),2200)}
  }

  window.OFL={
    html,renderBody,coverHTML,open,close,reveal,
    isOpen(){return detailId!==null},
    renderDetail(){try{renderDetail()}catch(e){console.error('outfit detail',e)}},
    query(v){st.q=v;st.limits.clear();renderBody()},
    sort(k){if(!SORTS.some(([x])=>x===k))return;st.sort=k;st.limits.clear();try{localStorage.setItem(SORT_KEY,k)}catch{}rerender()},
    chip(k){st.chip=st.chip===k&&k!=='all'?'all':k;if(k==='all')st.item=null;st.limits.clear();rerender()}, // '전체'는 이 옷 거르기도 푼다
    item(id){st.item=id===undefined?null:id;if(id!==null&&id!==undefined){st.q='';st.chip='all'}st.limits.clear();rerender()},
    more(key){st.limits.set(key,lim(key)+STEP);rerender()},
    toggle(k,v){st.open.set(st.sort+'|'+k,!!v);rerender()},
    edit(id){if(OF.load(id))close()}, // 묻는 창에서 취소하면 상세 창을 그대로 둔다
    garment(id){close();if(typeof openEdit==='function')openEdit(id)},
    state(){return {q:st.q,chip:st.chip,sort:st.sort,item:st.item,detail:detailId}}
  };
})();
