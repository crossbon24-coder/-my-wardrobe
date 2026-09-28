/* outfits.js — 코디 만들기·저장 코디·착용 캘린더·옷장 검색/4열 (Claude Code, v4.0~)
   index.html의 전역(clothes, outfits, db, filter, editingId, $, esc, arg, url, transaction, refresh, render, showPage, closeEdit, reportError)을
   호출만 하고 고치지 않는다. render·showPage는 감싸서 뒤에 코디 화면을 이어 그린다.
   데이터 계약은 COLLAB.md 3절: outfits {id, name, slots:{outer,top,bottom,shoes,bag,acc}, createdAt(ms), worn:['YYYY-MM-DD']}.
   bag은 v4.3에서 추가한 선택 칸이다(없으면 null). 옛 코디의 acc에는 가방이 들어 있을 수 있고 그대로 보여 준다.
   "오늘 입음"은 같은 날짜가 이미 있으면 아무것도 바꾸지 않는다(idempotent). 같은 날 이미 센 옷은 wearCount를 다시 올리지 않는다.
   기록 삭제는 worn만 지우고 clothes.wearCount는 건드리지 않는다. 미래 날짜는 기록하지 않는다. */
(function(){
  const SLOTS=[
    {key:'outer',label:'아우터',cats:['아우터']},
    {key:'top',label:'상의',cats:['상의']},
    {key:'bottom',label:'하의',cats:['하의']},
    {key:'shoes',label:'신발',cats:['신발']},
    {key:'bag',label:'가방',cats:['가방']},
    {key:'acc',label:'액세서리',cats:['액세서리']}
  ];
  const SLOT_BY_CAT={'아우터':'outer','상의':'top','하의':'bottom','신발':'shoes','가방':'bag','액세서리':'acc'};
  const ROWS=[['outer','top'],['bottom'],['shoes','bag','acc']];
  const EMPTY={outer:null,top:null,bottom:null,shoes:null,bag:null,acc:null};
  const WEEK=['일','월','화','수','목','금','토'];
  const DRAFT_KEY='wardrobe.outfitDraft',LIST_STEP=30;
  let draft={...EMPTY},draftName='',editId=null,saving=false;
  let pickSlot=null,pickAll=false,pickQuery='',pickType='',pickSort='recent';
  let view='list',sortKey='recent',listLimit=LIST_STEP,calMonth=null,calAutoMonth=null,calDay=null,addWornFor=null;
  let closetQuery='',closetSort='recent',dense=false,toastTimer=null,outfitDirty=true;

  const pad=n=>String(n).padStart(2,'0');
  const fmtDate=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; // 현지 날짜. toISOString은 UTC라 쓰지 않는다
  const today=()=>fmtDate(new Date());
  const isDate=s=>typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s);
  const dateMs=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12).getTime()};
  const fmtKo=s=>{const [y,m,d]=s.split('-').map(Number);return `${m}월 ${d}일 (${WEEK[new Date(y,m-1,d).getDay()]})`};
  const shiftMonth=(ym,k)=>{const [y,m]=ym.split('-').map(Number);return fmtDate(new Date(y,m-1+k,1)).slice(0,7)};
  const monthCells=ym=>{const [y,m]=ym.split('-').map(Number);const cells=Array(new Date(y,m-1,1).getDay()).fill(null);const days=new Date(y,m,0).getDate();for(let d=1;d<=days;d++)cells.push(`${ym}-${pad(d)}`);while(cells.length%7)cells.push(null);return cells};
  const dataReady=()=>typeof db!=='undefined'&&!!db;
  const byId=id=>id?clothes.find(c=>c.id===id)||null:null;
  const slotIds=o=>SLOTS.map(s=>o.slots&&o.slots[s.key]).filter(Boolean);
  // 백업에서 들어온 값이 어긋나도 화면이 멈추지 않도록 읽을 때만 정리한다(저장된 레코드는 바꾸지 않음)
  const norm=o=>{
    const slots={...EMPTY};const src=o&&o.slots&&typeof o.slots==='object'?o.slots:{};
    for(const k in EMPTY){const v=src[k];slots[k]=typeof v==='string'||typeof v==='number'?v:null}
    const worn=[...new Set((Array.isArray(o&&o.worn)?o.worn:[]).filter(isDate))].sort();
    return {...o,name:typeof o.name==='string'&&o.name.trim()?o.name:'코디',slots,worn,createdAt:Number(o.createdAt)||0};
  };
  const lastWorn=o=>o.worn.length?o.worn[o.worn.length-1]:'';
  const repItem=o=>['top','outer','bottom','shoes','bag','acc'].map(k=>byId(o.slots[k])).find(Boolean)||null;
  const title=c=>c.memo||c.type||c.category||'';
  const hay=c=>{const p=(c.wardrobeDetails&&c.wardrobeDetails.product)||{};return [c.memo,c.type,c.category,c.color,c.season,p.brand,p.name,p.color].filter(Boolean).join(' ').toLowerCase()};
  const terms=q=>q.trim().toLowerCase().split(/\s+/).filter(Boolean);
  const outfitVisible=()=>{const s=$('outfit');return !!s&&s.classList.contains('active')};
  const keyAttr=`onkeydown="if(event.key==='Enter'||event.key===' '){event.preventDefault();this.click()}"`;

  function say(m){if(typeof window.toast==='function')return window.toast(m);const t=$('ofToast');if(!t)return;t.textContent=m;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2600)}
  let renderErrors=0; // 검사가 확인할 수 있게 센다(OF.errors)
  function safe(fn,label){try{fn()}catch(e){renderErrors++;console.error('outfits.js '+label,e);say(`${label} 오류: ${e&&e.message||e}`)}}

  // ---------- 초안 보존(옷 id·이름만 localStorage에) ----------
  function persistDraft(){try{localStorage.setItem(DRAFT_KEY,JSON.stringify({draft,name:draftName,editId}))}catch{}}
  function restoreDraft(){try{const s=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');if(s&&s.draft&&typeof s.draft==='object'){for(const k in EMPTY){const v=s.draft[k];draft[k]=typeof v==='string'||typeof v==='number'?v:null}draftName=typeof s.name==='string'?s.name:'';editId=s.editId||null}}catch{}}
  function sanitizeDraft(){ // 데이터가 올라온 뒤에만(옷이 1벌 이상 읽힌 뒤): 사라진 옷·지워진 코디 참조를 비운다
    if(!clothes.length)return;let changed=false;
    for(const k in EMPTY)if(draft[k]&&!byId(draft[k])){draft[k]=null;changed=true}
    if(editId&&!outfits.some(o=>o.id===editId)){editId=null;changed=true}
    if(changed)persistDraft();
  }
  function setDraft(next,name,id){draft={...EMPTY,...next};if(name!==undefined)draftName=name;if(id!==undefined)editId=id;persistDraft()}

  // ---------- 화면 조각 ----------
  function tileHTML(slotKey,label,item,opts){
    const editable=!!opts.editable;
    const lazy=opts.small?' loading="lazy" decoding="async"':'';
    const inner=item?`<img src="${url(item.image)}" alt="${esc(title(item))}" draggable="false"${lazy}>`:`<span>${esc(label)}</span>`;
    const act=editable?` role="button" tabindex="0" aria-label="${esc(label)} ${item?'바꾸기':'고르기'}" onclick="OF.pick(${arg(slotKey)})" ${keyAttr}`:'';
    const x=editable&&item?`<button type="button" class="fl-x" aria-label="${esc(label)} 비우기" onclick="event.stopPropagation();OF.clear(${arg(slotKey)})"><i>×</i></button>`:'';
    return `<div class="fl-tile${item?'':' empty'}${editable?' editable':''}"${act}>${inner}${x}</div>`;
  }
  function flatLayHTML(slots,opts={}){
    const body=ROWS.map(keys=>{
      const cells=keys.map(k=>({k,it:byId(slots[k]),meta:SLOTS.find(s=>s.key===k)})).filter(c=>opts.editable||c.it);
      return cells.length?`<div class="fl-row n${cells.length}">${cells.map(c=>tileHTML(c.k,c.meta.label,c.it,opts)).join('')}</div>`:'';
    }).join('');
    return `<div class="fl${opts.small?' small':''}">${body||'<div class="fl-row"><div class="fl-tile empty"><span>옷 없음</span></div></div>'}</div>`;
  }
  function itemHTML(o){
    return `<div class="of-item">
      <div class="of-thumb">${flatLayHTML(o.slots,{small:true})}</div>
      <div class="of-info"><div class="title">${esc(o.name)}${o.id===editId?' <span class="badge">편집 중</span>':''}</div>
        <div class="small muted">${esc(fmtDate(new Date(o.createdAt||Date.now())))}${o.worn.length?` · ${o.worn.length}회 입음 · 마지막 ${esc(lastWorn(o).slice(5).replace('-','/'))}`:''}</div>
        <div class="actions"><button type="button" class="ghost" onclick="OF.load(${arg(o.id)})">불러오기</button><button type="button" class="ghost" onclick="OF.wear(${arg(o.id)})">오늘 입음</button><button type="button" class="ghost" onclick="OF.rename(${arg(o.id)})">이름</button><button type="button" class="ghost" onclick="OF.del(${arg(o.id)})">삭제</button></div>
      </div></div>`;
  }
  function listHTML(sorted){
    if(!sorted.length)return '<div class="empty">저장한 코디가 없습니다.<br>위에서 옷을 골라 저장하세요.</div>';
    const chips=[['recent','최근 저장'],['most','많이 입은 순'],['last','최근 입은 순']].map(([k,l])=>`<button type="button" class="chip${sortKey===k?' on':''}" onclick="OF.sort(${arg(k)})">${l}</button>`).join('');
    const shown=sorted.slice(0,listLimit),rest=sorted.length-shown.length;
    return `<div class="chips">${chips}</div>`+shown.map(o=>{try{return itemHTML(o)}catch(e){console.error('outfit item',e);return '<div class="of-item small muted">읽을 수 없는 코디입니다.</div>'}}).join('')
      +(rest>0?`<button type="button" class="secondary of-more" onclick="OF.more()">더 보기 (${rest}개 남음)</button>`:'');
  }
  function calHTML(wornByDate){
    const cells=monthCells(calMonth),t=today(),days=Object.keys(wornByDate).filter(d=>d.startsWith(calMonth)).length;
    const grid=cells.map(d=>{
      if(!d)return '<div></div>';
      const list=wornByDate[d]||[],rep=list.length?repItem(list[0]):null;
      const cls=`cal-cell${calDay===d?' sel':''}${d===t?' today':''}${list.length?' has':''}${d>t?' future':''}`;
      return `<button type="button" class="${cls}" aria-label="${esc(fmtKo(d))}${list.length?` 기록 ${list.length}개`:''}" onclick="OF.day(${arg(d)})">${rep?`<img src="${url(rep.image)}" alt="" draggable="false" loading="lazy" decoding="async">`:''}<span class="${rep?'onimg':''}">${Number(d.slice(8))}</span>${list.length>1?`<b class="n">${list.length}</b>`:''}</button>`;
    }).join('');
    let detail='';
    if(calDay){
      const list=wornByDate[calDay]||[],future=calDay>t;
      detail=`<div class="cal-day"><div class="row" style="align-items:center"><b style="flex:1">${esc(fmtKo(calDay))}</b>${future?'<span class="small muted" style="flex:none">미래 날짜는 기록할 수 없습니다</span>':`<button type="button" class="ghost" style="flex:none" ${outfits.length?'':'disabled'} onclick="OF.addWorn(${arg(calDay)})">이 날 기록 추가</button>`}</div>
        ${list.length?list.map(o=>`<div class="of-item"><div class="of-thumb">${flatLayHTML(o.slots,{small:true})}</div><div class="of-info"><div class="title">${esc(o.name)}</div><div class="small muted">${o.worn.length}회 입음</div><div class="actions"><button type="button" class="ghost" onclick="OF.load(${arg(o.id)})">불러오기</button><button type="button" class="ghost" onclick="OF.unwear(${arg(o.id)},${arg(calDay)})">기록 삭제</button></div></div></div>`).join(''):'<p class="small muted" style="text-align:center;padding:10px 0">기록이 없습니다.</p>'}</div>`;
    }else detail='<p class="small muted" style="text-align:center">날짜를 누르면 그날 입은 코디를 보고, 지난 날짜에 기록을 추가할 수 있습니다.</p>';
    return `<div class="row" style="align-items:center;margin-bottom:6px"><button type="button" class="ghost cal-nav" onclick="OF.month(-1)" aria-label="이전 달">‹</button><b style="flex:1;text-align:center">${Number(calMonth.slice(0,4))}년 ${Number(calMonth.slice(5))}월 <span class="small muted">${days}일 기록</span></b><button type="button" class="ghost cal-nav" onclick="OF.month(1)" aria-label="다음 달">›</button></div>
      <div class="cal head">${WEEK.map(w=>`<div>${w}</div>`).join('')}</div><div class="cal">${grid}</div>${detail}`;
  }
  function builderHTML(){
    const editing=editId?outfits.find(o=>o.id===editId):null;
    const btns=editing
      ?`<button type="button" ${saving?'disabled':''} onclick="OF.save()">덮어쓰기</button><button type="button" class="secondary" ${saving?'disabled':''} onclick="OF.saveNew()">새로 저장</button>`
      :`<button type="button" ${saving?'disabled':''} onclick="OF.save()">저장</button>`;
    return `<div class="card"><h2>코디 만들기</h2>
        ${editing?`<p class="small of-editing">저장된 코디 <b>${esc(norm(editing).name)}</b>을(를) 고치는 중입니다. 칸을 바꾼 뒤 '덮어쓰기'를 누르세요. <button type="button" class="ghost" onclick="OF.clearAll()">새 코디 시작</button></p>`:'<p class="small">칸을 눌러 옷을 고르세요. 옷장에서 옷 사진을 누르고 \'코디에 담기\'로도 넣을 수 있습니다. 아우터·가방·액세서리는 비워도 됩니다.</p>'}
        ${flatLayHTML(draft,{editable:true})}
        <input id="outfitName" style="margin-top:12px" placeholder="코디 이름 (비우면 날짜로)" value="${esc(draftName)}" oninput="OF.name(this.value)" aria-label="코디 이름">
        <div class="row" style="margin-top:4px">${btns}<button type="button" class="secondary" onclick="OF.clearAll()">비우기</button></div>
      </div>`;
  }
  function renderOutfitPage(){
    const sec=$('outfit');if(!sec)return;
    outfitDirty=false;
    if(!calMonth){calMonth=today().slice(0,7);calAutoMonth=calMonth}
    sanitizeDraft();
    const sorted=outfits.map(norm);
    if(sortKey==='most')sorted.sort((a,b)=>b.worn.length-a.worn.length);
    else if(sortKey==='last')sorted.sort((a,b)=>lastWorn(b)>lastWorn(a)?1:lastWorn(b)<lastWorn(a)?-1:0);
    else sorted.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    const wornByDate={};for(const o of sorted)for(const d of o.worn)(wornByDate[d]=wornByDate[d]||[]).push(o);
    sec.innerHTML=builderHTML()+`<div class="card"><h2>저장한 코디 <span class="badge">${outfits.length}개</span></h2>
        <div class="chips">${[['list','목록'],['cal','캘린더']].map(([k,l])=>`<button type="button" class="chip${view===k?' on':''}" onclick="OF.view(${arg(k)})">${l}</button>`).join('')}</div>
        ${view==='list'?listHTML(sorted):calHTML(wornByDate)}
      </div>`;
  }
  function refreshOutfitView(){if(outfitVisible())renderOutfitPage();else outfitDirty=true}

  // ---------- 고르기 시트 ----------
  function pickCandidates(){
    const meta=SLOTS.find(s=>s.key===pickSlot);if(!meta)return [];
    let list=clothes.filter(c=>!c.archived&&(pickAll||meta.cats.includes(c.category)));
    if(pickType)list=list.filter(c=>(c.type||'기타')===pickType);
    const ts=terms(pickQuery);if(ts.length)list=list.filter(c=>{const h=hay(c);return ts.every(t=>h.includes(t))});
    list=list.slice();
    if(pickSort==='stale')list.sort((a,b)=>(a.lastWorn||0)-(b.lastWorn||0)||(b.createdAt||0)-(a.createdAt||0));
    else if(pickSort==='most')list.sort((a,b)=>(b.wearCount||0)-(a.wearCount||0)||(b.createdAt||0)-(a.createdAt||0));
    else if(pickSort==='color')list.sort((a,b)=>String(a.color||'').localeCompare(String(b.color||''),'ko')||(b.createdAt||0)-(a.createdAt||0));
    else list.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    return list;
  }
  function renderPickGrid(){
    const box=$('pickGrid');if(!box)return;
    const list=pickCandidates(),cnt=$('pickCount');if(cnt)cnt.textContent=`${list.length}벌`;
    box.innerHTML=list.length?`<div class="pgrid">${list.map(c=>`<button type="button" class="pitem${draft[pickSlot]===c.id?' sel':''}" onclick="OF.choose(${arg(c.id)})"><img src="${url(c.image)}" alt="" loading="lazy" decoding="async" draggable="false"><span>${esc(title(c))}</span></button>`).join('')}</div>`
      :`<p class="small" style="padding:14px 0">조건에 맞는 옷이 없습니다.${pickAll?'':' 위의 \'전체 분류\'를 누르면 모든 옷에서 고를 수 있습니다.'}</p>`;
  }
  function renderPick(){
    const meta=SLOTS.find(s=>s.key===pickSlot);if(!meta)return;
    const base=clothes.filter(c=>!c.archived&&(pickAll||meta.cats.includes(c.category)));
    const types=[...new Set(base.map(c=>c.type||'기타'))].sort((a,b)=>a.localeCompare(b,'ko'));
    if(pickType&&!types.includes(pickType))pickType='';
    const typeChips=types.length>1?`<div class="chips pick-chips"><button type="button" class="chip${pickType?'':' on'}" onclick="OF.pickType('')">전체</button>${types.map(t=>`<button type="button" class="chip${pickType===t?' on':''}" onclick="OF.pickType(${arg(t)})">${esc(t)}</button>`).join('')}</div>`:'';
    const sortOpts=[['recent','최근 등록순'],['stale','오래 안 입은 순'],['most','많이 입은 순'],['color','색상순']].map(([k,l])=>`<option value="${k}"${pickSort===k?' selected':''}>${l}</option>`).join('');
    $('pickBody').innerHTML=`<div class="pick-head">
        <div class="row" style="align-items:center"><h2 style="margin:0;flex:1">${esc(meta.label)} 고르기 <span class="badge" id="pickCount"></span></h2>${draft[pickSlot]?`<button type="button" class="ghost" style="flex:none" onclick="OF.clear(${arg(pickSlot)});OF.closePick()">칸 비우기</button>`:''}<button type="button" class="pick-close" aria-label="닫기" onclick="OF.closePick()">×</button></div>
        <div class="row" style="align-items:center"><input id="pickSearch" type="search" placeholder="검색: 이름·종류·색·브랜드" aria-label="옷 검색" autocomplete="off" value="${esc(pickQuery)}" oninput="OF.pickQuery(this.value)"><select aria-label="정렬" style="flex:none;width:auto" onchange="OF.pickSort(this.value)">${sortOpts}</select></div>
        <div class="chips pick-chips"><button type="button" class="chip${pickAll?' on':''}" onclick="OF.pickAll()">전체 분류</button></div>
        ${typeChips}
      </div><div id="pickGrid"></div>`;
    renderPickGrid();
    $('pickModal').classList.add('open');
  }
  function renderWornPick(){
    const sorted=outfits.map(norm).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    $('wornBody').innerHTML=`<div class="pick-head"><div class="row" style="align-items:center"><h2 style="margin:0;flex:1">${esc(fmtKo(addWornFor))} 입은 코디 고르기</h2><button type="button" class="pick-close" aria-label="닫기" onclick="OF.closeWorn()">×</button></div></div>`+sorted.map(o=>{const done=o.worn.includes(addWornFor);return `<div class="of-item${done?' done':''}" ${done?'':`role="button" tabindex="0" ${keyAttr} onclick="OF.chooseWorn(${arg(o.id)})"`}><div class="of-thumb">${flatLayHTML(o.slots,{small:true})}</div><div class="of-info"><div class="title">${esc(o.name)}</div><div class="small muted">${o.worn.length?`${o.worn.length}회 입음`:'기록 없음'}${done?' · 이 날 기록됨':''}</div></div></div>`}).join('');
    $('wornModal').classList.add('open');
  }

  // ---------- 저장(IndexedDB) ----------
  // index.html의 저장·백업 잠금(mutationBusy)을 함께 쓴다: 백업 중에 옷 레코드를 덧쓰면 WebKit에서 백업이 읽던 사진이 사라질 수 있다
  const appBusy=()=>typeof mutationBusy!=='undefined'&&mutationBusy;
  async function locked(fn){if(appBusy()){say('저장·백업이 끝난 뒤 다시 눌러주세요');return}mutationBusy=true;try{return await fn()}finally{mutationBusy=false}}
  // 코디만 바뀐 경우: 옷 전체를 다시 읽지 않고 outfits만 읽어 코디 화면과 개수만 갱신한다
  async function refreshOutfits(){
    outfits=await all('outfits');
    if(typeof invalidateBackupShare==='function')invalidateBackupShare();
    if(typeof renderCounts==='function')renderCounts();else{const sv=$('saved');if(sv)sv.textContent=outfits.length}
    refreshOutfitView();
  }
  function defaultName(){
    const d=new Date(),base=`${d.getMonth()+1}/${d.getDate()} 코디`,names=new Set(outfits.map(o=>o.name));
    if(!names.has(base))return base;let n=2;while(names.has(`${base} ${n}`))n++;return `${base} ${n}`;
  }
  function liveSlots(){const s={...EMPTY};for(const k in EMPTY)s[k]=byId(draft[k])?draft[k]:null;return s}
  async function saveOutfit(asNew){
    if(saving)return;
    sanitizeDraft();const slots=liveSlots();
    if(!Object.values(slots).some(Boolean))return say('옷을 먼저 골라주세요');
    const target=!asNew&&editId?outfits.find(o=>o.id===editId):null;
    const name=draftName.trim()||(target?norm(target).name:defaultName());
    saving=true;refreshOutfitView();
    try{
      let savedId=target?target.id:null,overwrote=false;
      await transaction(['outfits'],'readwrite',tx=>{
        const os=tx.objectStore('outfits');
        if(target){const q=os.get(target.id);q.onsuccess=()=>{if(q.result){os.put({...q.result,name,slots});overwrote=true}else{savedId=crypto.randomUUID();os.add({id:savedId,name,slots,createdAt:Date.now(),worn:[]})}}}
        else{savedId=crypto.randomUUID();os.add({id:savedId,name,slots,createdAt:Date.now(),worn:[]})}
      });
      // 저장한 코디를 계속 편집 대상으로 둔다: 다시 누르면 복제가 아니라 덮어쓰기
      setDraft(slots,name,savedId);saving=false;await refreshOutfits();
      say(overwrote?'코디를 덮어썼습니다':'코디를 저장했습니다');
    }catch(e){reportError(e,'코디를 저장하지 못했습니다.')}
    finally{saving=false;refreshOutfitView()}
  }
  async function renameOutfit(id){
    const o=outfits.find(x=>x.id===id);if(!o)return;
    const v=prompt('코디 이름',norm(o).name);if(v===null)return;const name=v.trim();if(!name)return say('이름을 입력해주세요');
    try{await transaction(['outfits'],'readwrite',tx=>{const os=tx.objectStore('outfits'),q=os.get(id);q.onsuccess=()=>{if(q.result)os.put({...q.result,name})}});if(editId===id){draftName=name;persistDraft()}await refreshOutfits();say('이름을 바꿨습니다')}
    catch(e){reportError(e,'이름을 바꾸지 못했습니다.')}
  }
  async function deleteOutfit(id){
    const o=outfits.find(x=>x.id===id);
    if(!confirm(`'${o?norm(o).name:'이 코디'}'를 삭제할까요? 옷은 그대로 남고, 이 코디의 착용 기록(캘린더)은 사라집니다.`))return;
    try{await transaction(['outfits'],'readwrite',tx=>{tx.objectStore('outfits').delete(id)});if(editId===id){editId=null;persistDraft()}await refreshOutfits();say('삭제했습니다')}
    catch(e){reportError(e,'삭제하지 못했습니다.')}
  }
  async function markWorn(id,date){
    if(!isDate(date))return;
    if(date>today())return say('미래 날짜는 기록할 수 없습니다');
    let dup=false,found=false;
    try{
      await transaction(['outfits','clothes'],'readwrite',tx=>{
        const os=tx.objectStore('outfits'),cs=tx.objectStore('clothes'),q=os.getAll();
        q.onsuccess=()=>{
          const all=q.result||[],o=all.find(x=>x.id===id);if(!o)return;found=true;
          const worn=Array.isArray(o.worn)?o.worn.filter(isDate):[];
          if(worn.includes(date)){dup=true;return} // 같은 날 재기록은 아무것도 바꾸지 않는다
          os.put({...o,worn:[...new Set([...worn,date])].sort()});
          // 같은 날 다른 코디로 이미 센 옷은 wearCount를 다시 올리지 않는다
          const counted=new Set();for(const x of all)if(x.id!==id&&Array.isArray(x.worn)&&x.worn.includes(date))slotIds(norm(x)).forEach(c=>counted.add(c));
          const ts=date===today()?Date.now():dateMs(date);
          for(const cid of slotIds(norm(o))){const g=cs.get(cid);g.onsuccess=()=>{const c=g.result;if(!c)return;
            const sameDay=counted.has(cid)||(c.lastWorn&&fmtDate(new Date(c.lastWorn))===date);
            cs.put({...c,wearCount:(c.wearCount||0)+(sameDay?0:1),lastWorn:Math.max(c.lastWorn||0,ts)})}}
        };
      });
      if(found&&!dup)await refresh(); // 옷의 착용 횟수가 바뀌었을 때만 전체를 다시 읽는다
      say(!found?'코디를 찾지 못했습니다':dup?(date===today()?'오늘은 이미 기록되어 있습니다':'이미 기록된 날입니다'):(date===today()?'오늘 입은 것으로 기록했습니다':`${fmtKo(date)}에 기록했습니다`));
    }catch(e){reportError(e,'착용 기록을 저장하지 못했습니다.')}
  }
  async function unmarkWorn(id,date){
    try{
      await transaction(['outfits'],'readwrite',tx=>{const os=tx.objectStore('outfits'),q=os.get(id);q.onsuccess=()=>{const o=q.result;if(o)os.put({...o,worn:(Array.isArray(o.worn)?o.worn:[]).filter(d=>d!==date)})}});
      await refreshOutfits();say('기록을 지웠습니다. 옷의 착용 횟수는 그대로 둡니다.');
    }catch(e){reportError(e,'기록을 지우지 못했습니다.')}
  }

  // ---------- 옷 수정 창: 코디에 담기 ----------
  function editFormDirty(c){
    const v=id=>{const el=$(id);return el?el.value:''};
    return v('editCategory')!==(c.category||'')||v('editType')!==(c.type||'')||v('editColor')!==(c.color||'기타')||v('editSeason')!==(c.season||'사계절')||String(v('editFormality'))!==String(c.formality||2)||v('editMemo').trim()!==(c.memo||'');
  }
  function addToOutfit(){
    const id=typeof editingId!=='undefined'?editingId:null,c=byId(id);if(!c)return;
    const slot=SLOT_BY_CAT[c.category];if(!slot)return say('이 분류는 코디 칸이 없습니다');
    if(typeof photoBusy!=='undefined'&&photoBusy)return say('사진 처리가 끝난 뒤 눌러주세요');
    const dirty=typeof editDirty==='function'?editDirty():editFormDirty(c);
    if(dirty&&!confirm('바꾼 사진과 수정 내용은 저장되지 않습니다. 저장하지 않고 코디에 담을까요?'))return;
    if(typeof closeEdit==='function'&&closeEdit()===false)return;
    setDraft({...draft,[slot]:c.id});
    const btn=[...document.querySelectorAll('nav button')].find(b=>(b.getAttribute('onclick')||'').includes("'outfit'"));
    if(btn)showPage('outfit',btn);else refreshOutfitView();
    window.scrollTo(0,0);say(`${SLOTS.find(s=>s.key===slot).label} 칸에 담았습니다`);
  }
  function recommendationToOutfit(){
    const ids=typeof currentRecommendation!=='undefined'&&Array.isArray(currentRecommendation)?currentRecommendation:[];
    const next={...EMPTY};for(const id of ids){const c=byId(id);const k=c&&SLOT_BY_CAT[c.category];if(k&&!next[k])next[k]=id}
    if(!Object.values(next).some(Boolean))return say('담을 추천 결과가 없습니다');
    if(OF.hasDraft()&&!confirm('만들던 코디 초안을 추천 결과로 바꿀까요?'))return;
    setDraft(next,'',null);
    const btn=[...document.querySelectorAll('nav button')].find(b=>(b.getAttribute('onclick')||'').includes("'outfit'"));
    if(btn)showPage('outfit',btn);else refreshOutfitView();
    window.scrollTo(0,0);say('추천을 코디 칸에 담았습니다. 바꿀 칸을 누른 뒤 저장하세요.');
  }
  function installRecommendHook(){
    if(typeof window.recommend!=='function'||window.recommend.ofWrapped)return;
    const base=window.recommend;
    const wrapped=function(){const r=base.apply(this,arguments);safe(()=>{const box=$('result');if(!box||!box.querySelector('.recgrid'))return;const b=document.createElement('button');b.type='button';b.id='ofRecBtn';b.textContent='코디 탭에 담기';b.style.width='100%';b.style.marginTop='10px';b.onclick=recommendationToOutfit;box.appendChild(b)},'추천 연결');return r};
    wrapped.ofWrapped=true;window.recommend=wrapped;
  }
  function installEditButton(){
    const save=$('editSaveBtn');if(!save||$('ofAddBtn'))return;
    const row=save.parentNode,b=document.createElement('button');
    b.id='ofAddBtn';b.type='button';b.className='secondary';b.textContent='코디에 담기';b.onclick=addToOutfit;
    const wrap=document.createElement('div');wrap.className='actions';wrap.appendChild(b);
    row.parentNode.insertBefore(wrap,row);
  }

  // ---------- 옷장 탭 보조: 검색·4열 ----------
  function installClosetTools(){
    const filters=$('filters');if(!filters||$('closetTools'))return;
    const div=document.createElement('div');div.id='closetTools';div.className='row';div.style.alignItems='center';
    div.innerHTML=`<input id="closetSearch" type="search" placeholder="검색: 이름·종류·색·브랜드" aria-label="옷장 검색" autocomplete="off"><span id="closetSearchStat" class="small muted" style="flex:none" hidden></span><select id="closetSort" aria-label="옷장 정렬" style="flex:none;width:auto;margin:0"><option value="recent">최근 등록</option><option value="stale">오래 안 입은</option><option value="most">많이 입은</option><option value="color">색상</option></select><button type="button" id="densityBtn" class="secondary" style="flex:none">4열</button>`;
    filters.parentNode.insertBefore(div,filters);
    const items=$('items');
    if(items&&!$('closetNoMatch')){const p=document.createElement('p');p.id='closetNoMatch';p.className='empty';p.hidden=true;items.parentNode.insertBefore(p,items.nextSibling)}
    $('closetSearch').oninput=e=>{closetQuery=e.target.value;safe(applyClosetTools,'옷장 검색')};
    $('densityBtn').onclick=()=>{dense=!dense;try{localStorage.setItem('wardrobe.dense',dense?'1':'')}catch{}safe(applyClosetTools,'옷장 검색')};
    const so=$('closetSort');so.value=closetSort;so.onchange=e=>{closetSort=e.target.value;try{localStorage.setItem('wardrobe.closetSort',closetSort)}catch{}safe(applyClosetTools,'옷장 정렬')};
  }
  // index.html render()와 같은 기준으로 카드 순서를 재현해 카드마다 옷 데이터를 대응시킨다(버튼 글자 대신 데이터로 검색)
  function closetOrder(){const f=typeof filter!=='undefined'?filter:'전체';return (f==='보관함'?clothes.filter(c=>c.archived):clothes.filter(c=>!c.archived&&(f==='전체'||c.category===f))).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))}
  function applyClosetTools(){
    const items=$('items');if(!items)return;
    items.classList.toggle('dense',dense);
    const btn=$('densityBtn');if(btn)btn.textContent=dense?'2열':'4열';
    const kids=[...items.children];
    if(kids.some(el=>!el.dataset.ofId)){ // render 직후: 카드 순서로 옷을 대응시켜 표시해 둔다(이후 정렬·검색은 이 표시로)
      const list=closetOrder();
      const aligned=list.length===kids.length&&kids.every((el,i)=>{const im=el.querySelector('img');return !!im&&im.alt===String(title(list[i]))});
      if(aligned)kids.forEach((el,i)=>{el.dataset.ofId=String(list[i].id)});
    }
    const itemOf=el=>el.dataset.ofId?clothes.find(c=>String(c.id)===el.dataset.ofId)||null:null;
    const ts=terms(closetQuery);let n=0;
    kids.forEach(el=>{
      const c=itemOf(el),text=c?hay(c):[...el.querySelectorAll('.title,.muted')].map(x=>x.textContent).join(' ').toLowerCase();
      const hit=!ts.length||ts.every(t=>text.includes(t));el.hidden=!hit;if(hit)n++;
    });
    const so=$('closetSort');if(so&&so.value!==closetSort)so.value=closetSort;
    if(kids.every(el=>itemOf(el))){ // 모든 카드가 대응될 때만 순서를 바꾼다
      const by={recent:(a,b)=>(b.createdAt||0)-(a.createdAt||0),stale:(a,b)=>(a.lastWorn||0)-(b.lastWorn||0)||(b.createdAt||0)-(a.createdAt||0),most:(a,b)=>(b.wearCount||0)-(a.wearCount||0)||(b.createdAt||0)-(a.createdAt||0),color:(a,b)=>String(a.color||'').localeCompare(String(b.color||''),'ko')||(b.createdAt||0)-(a.createdAt||0)}[closetSort]||null;
      if(by){const sorted=kids.slice().sort((x,y)=>by(itemOf(x),itemOf(y)));if(sorted.some((el,i)=>el!==kids[i])){const frag=document.createDocumentFragment();sorted.forEach(el=>frag.appendChild(el));items.appendChild(frag)}}
    }
    const st=$('closetSearchStat');if(st){st.hidden=!ts.length;st.textContent=`${n}벌`}
    const empty=$('empty');if(empty)empty.style.display=kids.length?'none':'block'; // render()의 원래 규칙: 현재 필터 결과가 0일 때만
    const nm=$('closetNoMatch');if(nm){const show=ts.length>0&&kids.length>0&&n===0;nm.hidden=!show;if(show)nm.textContent=`'${closetQuery.trim()}'에 맞는 옷이 없습니다.`}
  }

  // ---------- 초기화 ----------
  function injectCSS(){
    const s=document.createElement('style');s.textContent=`
#outfit .fl{display:flex;flex-direction:column;gap:8px;align-items:center;width:100%;max-width:340px;margin:auto}
.fl{display:flex;flex-direction:column;gap:8px;align-items:center;width:100%}
.fl-row{display:flex;gap:8px;justify-content:center;width:100%}
.fl-tile{flex:1 1 0;max-width:calc(50% - 4px);aspect-ratio:1;border-radius:14px;background:#eee;display:flex;align-items:center;justify-content:center;color:#888;font-size:13px;position:relative;overflow:hidden}
.fl-row.n3 .fl-tile{max-width:calc(33.333% - 6px)}
.fl-tile.editable.empty{border:1px dashed #aaa;background:#fafafa;cursor:pointer}
.fl-tile.editable{cursor:pointer}
.fl-tile img{width:100%;height:100%;object-fit:cover;display:block}
.fl-x{position:absolute;top:0;right:0;width:40px;height:40px;padding:0;background:transparent;border-radius:0}
.fl-x i{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:#171717;color:#fff;font-size:15px;line-height:22px;font-style:normal;text-align:center}
.fl.small{gap:4px;max-width:150px}.fl.small .fl-row{gap:4px}.fl.small .fl-tile{border-radius:8px;font-size:10px}.fl.small .fl-row.n3 .fl-tile{max-width:calc(33.333% - 3px)}
.of-item{display:flex;gap:10px;background:#f7f7f7;border-radius:15px;padding:9px;margin-top:8px}
.of-item.done{opacity:.45}
.of-thumb{width:150px;flex:none}.of-info{min-width:0;flex:1;display:flex;flex-direction:column}.of-info .actions{margin-top:auto;flex-wrap:wrap}.of-info .actions button{flex:1 1 auto;white-space:nowrap;padding:8px 6px;min-height:40px}
.of-more{width:100%;margin-top:10px}
.of-editing{background:#f0f7f1;border-radius:10px;padding:8px 10px}
.of-editing .ghost{padding:4px 8px;margin-left:4px}
@media (max-width:430px){.of-thumb{width:118px}.fl.small{max-width:118px}}
.pick-head{position:sticky;top:-18px;background:#fff;z-index:2;margin:-18px -16px 0;padding:18px 16px 6px}
.pick-head input,.pick-head select{margin:4px 0}
.pick-chips{padding-bottom:4px;margin-top:4px}
.pick-close{flex:none;width:44px;height:44px;padding:0;border-radius:50%;background:#eee;color:#333;font-size:22px;line-height:44px}
.pgrid{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-top:8px}
.pitem{background:transparent;color:#333;padding:0;border-radius:10px;text-align:left;font-weight:400;min-width:0}
.pitem img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#eee;display:block;max-height:none}
.pitem span{display:block;font-size:11px;line-height:1.3;margin-top:3px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pitem.sel img{outline:3px solid #166534;outline-offset:-3px}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.cal.head div{text-align:center;font-size:11px;color:#888;padding:2px 0}
.cal-nav{flex:none;min-width:44px;min-height:44px;font-size:18px}
.cal-cell{position:relative;aspect-ratio:1;border-radius:10px;background:#fff;border:1px solid #eee;padding:0;overflow:hidden;color:#333;font-size:12px;font-weight:600;text-align:left}
.cal-cell.has{background:#eee;border-color:transparent}
.cal-cell.future{color:#bbb}
.cal-cell img{width:100%;height:100%;object-fit:cover;display:block}
.cal-cell span{position:absolute;left:4px;top:2px;font-size:11px}
.cal-cell span.onimg{color:#fff;text-shadow:0 0 3px rgba(0,0,0,.9)}
.cal-cell.sel{outline:2px solid #166534}.cal-cell.today{border:1px solid #166534;color:#166534}
.cal-cell .n{position:absolute;right:3px;bottom:2px;background:#171717;color:#fff;border-radius:999px;padding:0 5px;font-size:10px}
.cal-day{margin-top:12px;border-top:1px solid #eee;padding-top:10px}
#closetTools input{margin:0}
#items.dense{grid-template-columns:repeat(4,1fr);gap:6px}
#items.dense .item img{height:auto;aspect-ratio:1/1}
#items.dense .info{padding:3px 5px}
#items.dense .info>:not(.title){display:none}
#items.dense .info .title{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ofAddBtn{width:100%}
#closetTools select{padding:10px 8px;font-size:16px}
#ofToast{position:fixed;left:50%;bottom:calc(74px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#171717;color:#fff;border-radius:999px;padding:9px 14px;font-size:13px;z-index:60;max-width:90vw;display:none}
#ofToast.show{display:block}`;
    document.head.appendChild(s);
  }
  function ensureDOM(){
    if(!$('pickModal')){const m=document.createElement('div');m.id='pickModal';m.className='modal';m.onclick=e=>{if(e.target===m)OF.closePick()};m.innerHTML='<div class="sheet" role="dialog" aria-modal="true" aria-label="옷 고르기"><div id="pickBody"></div></div>';document.body.appendChild(m)}
    if(!$('wornModal')){const m=document.createElement('div');m.id='wornModal';m.className='modal';m.onclick=e=>{if(e.target===m)OF.closeWorn()};m.innerHTML='<div class="sheet" role="dialog" aria-modal="true" aria-label="입은 코디 고르기"><div id="wornBody"></div></div>';document.body.appendChild(m)}
    if(!$('ofToast')){const t=document.createElement('div');t.id='ofToast';t.setAttribute('role','status');document.body.appendChild(t)}
  }

  window.OF={
    pick(k){pickSlot=k;pickAll=false;pickQuery='';pickType='';renderPick()},
    pickAll(){pickAll=!pickAll;pickType='';renderPick()},
    pickType(t){pickType=t;renderPick()},
    pickQuery(v){pickQuery=v;renderPickGrid()},
    pickSort(v){pickSort=v;renderPickGrid()},
    choose(id){if(pickSlot)setDraft({...draft,[pickSlot]:id});pickSlot=null;$('pickModal').classList.remove('open');refreshOutfitView()},
    closePick(){pickSlot=null;$('pickModal').classList.remove('open')},
    clear(k){setDraft({...draft,[k]:null});refreshOutfitView()},
    clearAll(){setDraft({...EMPTY},'',null);refreshOutfitView()},
    name(v){draftName=v;persistDraft()},
    save(){locked(()=>saveOutfit(false))},
    saveNew(){locked(()=>saveOutfit(true))},
    view(k){view=k;renderOutfitPage()},
    sort(k){sortKey=k;listLimit=LIST_STEP;renderOutfitPage()},
    more(){listLimit+=LIST_STEP;renderOutfitPage()},
    load(id){const o=outfits.find(x=>x.id===id);if(!o)return;const n=norm(o),s={...EMPTY};for(const k in EMPTY)s[k]=byId(n.slots[k])?n.slots[k]:null;setDraft(s,n.name,o.id);renderOutfitPage();window.scrollTo(0,0);say('코디를 불러왔습니다. 칸을 바꾼 뒤 덮어쓰기를 누르세요.')},
    wear(id){locked(()=>markWorn(id,today()))},
    rename(id){locked(()=>renameOutfit(id))},
    del(id){locked(()=>deleteOutfit(id))},
    month(k){calMonth=shiftMonth(calMonth,k);calDay=null;renderOutfitPage()},
    day(d){calDay=calDay===d?null:d;renderOutfitPage()},
    unwear(id,d){locked(()=>unmarkWorn(id,d))},
    addWorn(d){if(d>today())return say('미래 날짜는 기록할 수 없습니다');addWornFor=d;renderWornPick()},
    chooseWorn(id){const d=addWornFor;addWornFor=null;$('wornModal').classList.remove('open');if(d)locked(()=>markWorn(id,d))},
    closeWorn(){addWornFor=null;$('wornModal').classList.remove('open')},
    addToOutfit,
    // 업데이트·새로고침 전에 index.html이 물어볼 수 있게: 저장하지 않은 코디 초안이 있는지
    hasDraft(){const saved=editId?outfits.find(o=>o.id===editId):null;if(!Object.values(draft).some(Boolean))return false;if(!saved)return true;const n=norm(saved);return Object.keys(EMPTY).some(k=>(n.slots[k]||null)!==(draft[k]||null))||(draftName.trim()&&draftName.trim()!==n.name)},
    get errors(){return renderErrors}
  };

  function init(){
    try{dense=localStorage.getItem('wardrobe.dense')==='1';closetSort=localStorage.getItem('wardrobe.closetSort')||'recent'}catch{}
    injectCSS();ensureDOM();installClosetTools();installEditButton();installRecommendHook();restoreDraft();
    const baseRender=window.render;
    window.render=function(){
      baseRender.apply(this,arguments);
      safe(applyClosetTools,'옷장 검색');
      if(outfitVisible())safe(renderOutfitPage,'코디 화면');else outfitDirty=true; // 숨겨진 코디 화면은 보일 때 그린다
      if(pickSlot&&$('pickModal').classList.contains('open'))safe(renderPickGrid,'옷 고르기');
    };
    const baseShow=window.showPage;
    window.showPage=function(id){baseShow.apply(this,arguments);if(id==='outfit'&&outfitDirty)safe(renderOutfitPage,'코디 화면')};
    // 뒤로 가기 캐시에서 돌아오면 index.html이 URL을 모두 해제했으므로 열린 시트를 다시 그린다
    window.addEventListener('pageshow',e=>{if(!e.persisted)return;if(pickSlot)safe(renderPick,'옷 고르기');if(addWornFor)safe(renderWornPick,'코디 고르기')});
    // 앱을 켜 둔 채 날짜·달이 바뀌면 '오늘'과 달력을 맞춘다(사용자가 다른 달로 옮겨 둔 경우는 그대로)
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')return;const m=today().slice(0,7);if(calMonth===calAutoMonth&&calMonth!==m){calMonth=m;calAutoMonth=m;calDay=null}refreshOutfitView()});
    // refresh()가 이미 끝나 첫 render가 지나갔으면 감싼 render로 다시 그린다. 아직이면 refresh가 감싼 render를 부른다
    const s=$('summary');if(dataReady()&&s&&!/불러오는/.test(s.textContent))render();else safe(renderOutfitPage,'코디 화면');
  }
  init();
})();
