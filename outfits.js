/* outfits.js — 코디 만들기·착용 캘린더·옷장 검색/4열·옷 창 패널 (Claude Code, v4.0~)
   v5.1: 옷장 '고르기'로 여러 벌의 격식을 한꺼번에 바꾼다(되돌리기 있음).
   v5.0: 하단 탭 옷장·코디·추천·더보기, 옷장 3열(4열 전환), 옷 창 '오늘 입음'.
   v4.11: 코디 탭은 세 화면이다. 목록(view 'list', 모아보기는 outfit-list.js가 그림)·캘린더('cal')·만들기('builder', '+ 새 코디'·고치기·코디에 담기·추천 담기로 연다).
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
  const DRAFT_KEY='wardrobe.outfitDraft';
  let draft={...EMPTY},draftName='',editId=null,saving=false;
  // editBase: 고치는 코디를 불러오거나 저장한 때의 칸·이름. 그 코디가 지워지거나 다른 곳(합치기·복원)에서 바뀌었을 때
  // 초안이 그대로였는지(깨끗한지) 가르는 기준. 깨끗하면 초안을 비우거나 새 내용으로 맞추고, 고치던 중이면 새 코디로 남긴다
  let editBase=null;
  let pickSlot=null,pickAll=false,pickQuery='',pickType='',pickSort='recent';
  // view: 'list'(모아보기)·'cal'(캘린더)·'builder'(만들기 화면). 앱을 새로 열면 목록에서 시작하고, 저장 안 한 초안이 있으면 목록 위에 '이어서 만들기'를 띄운다
  let view='list',calMonth=null,calAutoMonth=null,calDay=null,addWornFor=null,wornQuery='';
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
  const slotVal=v=>typeof v==='string'||typeof v==='number'?v:null;
  function persistDraft(){try{localStorage.setItem(DRAFT_KEY,JSON.stringify({draft,name:draftName,editId,base:editBase}))}catch{}}
  function restoreDraft(){try{const s=JSON.parse(localStorage.getItem(DRAFT_KEY)||'null');if(s&&s.draft&&typeof s.draft==='object'){for(const k in EMPTY)draft[k]=slotVal(s.draft[k]);draftName=typeof s.name==='string'?s.name:'';editId=s.editId||null;
    const b=s.base&&typeof s.base==='object'&&s.base.slots&&typeof s.base.slots==='object'?s.base:null;editBase=editId&&b?{slots:Object.fromEntries(Object.keys(EMPTY).map(k=>[k,slotVal(b.slots[k])])),name:typeof b.name==='string'?b.name:''}:null}}catch{}}
  // 있는 옷만 남긴 칸(지운 옷이 든 코디를 불러와도 '고친 것'으로 보이지 않게)
  const liveOf=sl=>{const r={...EMPTY};for(const k in EMPTY){const v=sl&&sl[k];r[k]=v!==null&&v!==undefined&&byId(v)?v:null}return r};
  const draftClean=()=>!!editBase&&Object.keys(EMPTY).every(k=>(liveOf(draft)[k]||null)===(liveOf(editBase.slots)[k]||null))&&(!draftName.trim()||draftName.trim()===(editBase.name||'').trim()); // 빈 이름은 저장된 이름 그대로(hasDraft와 같은 규칙)
  function sanitizeDraft(){ // 데이터가 올라온 뒤에만(옷이 1벌 이상 읽힌 뒤): 사라진 옷·지워진 코디 참조를 정리한다
    if(!clothes.length)return;let changed=false;const clean=draftClean();
    for(const k in EMPTY)if(draft[k]&&!byId(draft[k])){draft[k]=null;changed=true}
    if(editId){const o=outfits.find(x=>x.id===editId);
      if(!o){if(clean){draft={...EMPTY};draftName=''}editId=null;editBase=null;changed=true} // 지운 코디: 그대로였으면 비우고, 고치던 중이면 새 코디로 남긴다
      else if(!editBase){const n=norm(o),sl=liveOf(n.slots);if(Object.keys(EMPTY).every(k=>sl[k]===(liveOf(draft)[k]||null))&&draftName.trim()===n.name.trim()){editBase={slots:{...sl},name:n.name};changed=true}} // v4.10에서 넘어온 초안: 저장본과 같으면 기준으로
      else if(clean){const n=norm(o),sl=liveOf(n.slots);if(!Object.keys(EMPTY).every(k=>sl[k]===(liveOf(editBase.slots)[k]||null))||n.name!==editBase.name){draft={...sl};draftName=n.name;editBase={slots:{...sl},name:n.name};changed=true}} // 다른 곳에서 바뀐 코디: 새 내용으로
    }
    if(changed){persistDraft();outfitDirty=true}
  }
  // id를 넘기면(불러오기·저장·새로 시작) 그때의 칸·이름을 고치는 기준으로 둔다
  function setDraft(next,name,id){draft={...EMPTY,...next};if(name!==undefined)draftName=name;if(id!==undefined){editId=id;editBase=id!==null&&id!==undefined?{slots:{...draft},name:draftName}:null}persistDraft();outfitDirty=true} // 화면에 반영되기 전까지 다시 그릴 대상

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
        ${list.length?list.map(o=>`<div class="of-item"><div class="of-thumb">${flatLayHTML(o.slots,{small:true})}</div><div class="of-info"><div class="title">${esc(o.name)}</div><div class="small muted">${o.worn.length}회 입음</div><div class="actions"><button type="button" class="ghost" onclick="OF.detail(${arg(o.id)})">보기</button><button type="button" class="ghost" onclick="OF.unwear(${arg(o.id)},${arg(calDay)})">기록 삭제</button></div></div></div>`).join(''):'<p class="small muted" style="text-align:center;padding:10px 0">기록이 없습니다.</p>'}</div>`;
    }else detail='<p class="small muted" style="text-align:center">날짜를 누르면 그날 입은 코디를 보고, 지난 날짜에 기록을 추가할 수 있습니다.</p>';
    return `<div class="row" style="align-items:center;margin-bottom:6px"><button type="button" class="ghost cal-nav" onclick="OF.month(-1)" aria-label="이전 달">‹</button><b style="flex:1;text-align:center">${Number(calMonth.slice(0,4))}년 ${Number(calMonth.slice(5))}월 <span class="small muted">${days}일 기록</span></b><button type="button" class="ghost cal-nav" onclick="OF.month(1)" aria-label="다음 달">›</button></div>
      <div class="cal head">${WEEK.map(w=>`<div>${w}</div>`).join('')}</div><div class="cal">${grid}</div>${detail}`;
  }
  // 만들기 화면: 목록 대신 코디 탭 전체를 쓴다. '‹ 목록'으로 돌아가도 초안은 기기에 남는다(DRAFT_KEY)
  function builderHTML(){
    const editing=editId?outfits.find(o=>o.id===editId):null;
    const btns=editing
      ?`<button type="button" ${saving?'disabled':''} onclick="OF.save()">덮어쓰기</button><button type="button" class="secondary" ${saving?'disabled':''} onclick="OF.saveNew()">새로 저장</button>`
      :`<button type="button" ${saving?'disabled':''} onclick="OF.save()">저장</button>`;
    return `<div class="card of-builder"><div class="of-bar"><button type="button" class="ghost of-back" onclick="OF.back()">‹ 목록</button><h2>${editing?'코디 고치기':'새 코디'}</h2></div>
        ${editing?`<p class="small of-editing">저장된 코디 <b>${esc(norm(editing).name)}</b>을(를) 고치는 중입니다. 칸을 바꾼 뒤 '덮어쓰기'를 누르세요. ${OF.hasDraft()?`<button type="button" class="ghost" onclick="OF.revert()">저장된 대로 되돌리기</button>`:''}<button type="button" class="ghost" onclick="OF.clearAll()">새 코디 시작</button></p>`:'<p class="small">칸을 눌러 옷을 고르세요. 옷장에서 옷 사진을 누르고 \'코디에 담기\'로도 넣을 수 있습니다. 아우터·가방·액세서리는 비워도 됩니다.</p>'}
        <div class="row" style="margin-bottom:10px"><button type="button" class="secondary" onclick="OF.fillRec()">추천으로 채우기</button></div>
        ${flatLayHTML(draft,{editable:true})}
        <input id="outfitName" style="margin-top:12px" placeholder="코디 이름 (비우면 날짜로)" value="${esc(draftName)}" oninput="OF.name(this.value)" aria-label="코디 이름">
        <div class="row of-save">${btns}<button type="button" class="secondary" onclick="OF.clearAll()">비우기</button></div>
      </div>`; // 저장 줄은 화면 아래(하단 탭 위)에 붙어 있어 칸을 고르다 바로 누를 수 있다
  }
  function resumeHTML(){
    if(!OF.hasDraft())return '';
    const n=Object.values(draft).filter(Boolean).length,editing=editId?outfits.find(o=>o.id===editId):null;
    return `<div class="of-resume"><span>${editing?`'${esc(norm(editing).name)}' 고치던 내용이 있습니다`:`만들던 코디가 있습니다 (${n}칸)`}</span><button type="button" class="ghost" onclick="OF.builder()">이어서 만들기</button></div>`;
  }
  function renderOutfitPage(){
    const sec=$('outfit');if(!sec)return;
    outfitDirty=false;
    if(!calMonth){calMonth=today().slice(0,7);calAutoMonth=calMonth}
    sanitizeDraft();
    if(view==='builder'){sec.innerHTML=builderHTML();return}
    const all=outfits.map(norm),live=all.filter(o=>!o.archived).length;
    let body='';
    if(view==='cal'){const wornByDate={};for(const o of all)for(const d of o.worn)(wornByDate[d]=wornByDate[d]||[]).push(o);body=calHTML(wornByDate)}
    else body=window.OFL?OFL.html():'<p class="small">코디 목록 기능 파일을 불러오지 못했습니다. 강제 새로고침 후 다시 시도해주세요.</p>';
    sec.innerHTML=`<div class="card"><div class="row of-head"><h2>저장한 코디 <span class="badge">${live}개</span></h2><button type="button" class="of-new" onclick="OF.newOutfit()">+ 새 코디</button></div>
        ${resumeHTML()}
        <div class="chips">${[['list','모아보기'],['cal','캘린더']].map(([k,l])=>`<button type="button" class="chip${view===k?' on':''}" onclick="OF.view(${arg(k)})">${l}</button>`).join('')}</div>
        ${body}
      </div>`;
  }
  function refreshOutfitView(){if(outfitVisible())renderOutfitPage();else outfitDirty=true;if(window.OFL&&OFL.isOpen())OFL.renderDetail()}

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
    const ofN=typeof outfitCountMap==='function'?outfitCountMap():new Map();
    box.innerHTML=list.length?`<div class="pgrid">${list.map(c=>`<button type="button" class="pitem${draft[pickSlot]===c.id?' sel':''}" onclick="OF.choose(${arg(c.id)})"><img src="${url(c.image)}" alt="" loading="lazy" decoding="async" draggable="false"><span>${esc(title(c))}</span>${ofN.get(c.id)?`<b class="pcount">코디 ${ofN.get(c.id)}</b>`:''}</button>`).join('')}</div>`
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
  // 지난 날짜에 입은 코디 고르기: 3열 격자와 검색(코디 이름·든 옷). 즐겨찾기 먼저, 보관한 코디는 뒤에
  function wornCandidates(){
    const ts=terms(wornQuery),h=o=>[o.name,...slotIds(o).map(id=>{const c=byId(id);return c?hay(c):''})].join(' ').toLowerCase();
    return outfits.map(norm).filter(o=>!ts.length||ts.every(t=>h(o).includes(t))).sort((a,b)=>(!!a.archived-!!b.archived)||(!!b.fav-!!a.fav)||(b.createdAt||0)-(a.createdAt||0));
  }
  function renderWornGrid(){
    const box=$('wornGrid');if(!box)return;const list=wornCandidates();
    box.innerHTML=list.length?`<div class="ofl-grid">${list.map(o=>{const done=o.worn.includes(addWornFor);return `<button type="button" class="ofl-card${done?' done':''}" ${done?'disabled':''} onclick="OF.chooseWorn(${arg(o.id)})">${window.OFL?OFL.coverHTML(o):flatLayHTML(o.slots,{small:true})}${o.fav?'<b class="ofl-star" aria-hidden="true">★</b>':''}<span class="ofl-name">${esc(o.name)}</span><span class="ofl-meta">${done?'이 날 기록됨':o.archived?'보관한 코디':o.worn.length?`${o.worn.length}회 입음`:'기록 없음'}</span></button>`}).join('')}</div>`
      :'<p class="small" style="padding:14px 0">맞는 코디가 없습니다.</p>';
  }
  function renderWornPick(){
    $('wornBody').innerHTML=`<div class="pick-head"><div class="row" style="align-items:center"><h2 style="margin:0;flex:1">${esc(fmtKo(addWornFor))} 입은 코디 고르기</h2><button type="button" class="pick-close" aria-label="닫기" onclick="OF.closeWorn()">×</button></div>
      <input id="wornSearch" type="search" placeholder="코디·옷 이름 검색" aria-label="코디 검색" autocomplete="off" value="${esc(wornQuery)}" oninput="OF.wornQuery(this.value)"></div><div id="wornGrid"></div>`;
    renderWornGrid();
    $('wornModal').classList.add('open');
  }

  // ---------- 저장(IndexedDB) ----------
  // index.html의 저장·백업 잠금(mutationBusy)을 함께 쓴다: 백업 중에 옷 레코드를 덧쓰면 WebKit에서 백업이 읽던 사진이 사라질 수 있다
  const appBusy=()=>typeof mutationBusy!=='undefined'&&mutationBusy;
  async function locked(fn){if(appBusy()){say('저장·백업이 끝난 뒤 다시 눌러주세요');return}mutationBusy=true;try{return await fn()}finally{mutationBusy=false}}
  // 코디만 바뀐 경우: 옷 전체를 다시 읽지 않고 outfits만 읽어 코디 화면과 개수만 갱신한다
  let closetDirty=false;
  async function refreshOutfits(){
    outfits=await all('outfits');closetDirty=true;sanitizeDraft(); // 옷장 카드의 '코디 n', 지워지거나 바뀐 코디를 고치던 초안
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
    if(target){const n=norm(target),was=liveOf(n.slots),changed=Object.keys(EMPTY).some(k=>(was[k]||null)!==(slots[k]||null));
      if(changed&&n.worn.length&&!confirm(`이 코디는 ${n.worn.length}번 입은 기록이 있습니다. 칸을 바꿔 덮어쓰면 그 기록이 새로 넣은 옷의 기록이 됩니다. 덮어쓸까요?\n기록을 지키려면 취소하고 '새로 저장'을 누르세요.`))return;}
    saving=true;refreshOutfitView();let shown=null;
    try{
      let savedId=target?target.id:null,overwrote=false;
      await transaction(['outfits'],'readwrite',tx=>{
        const os=tx.objectStore('outfits');
        if(target){const q=os.get(target.id);q.onsuccess=()=>{if(q.result){os.put({...q.result,name,slots,updatedAt:Date.now()});overwrote=true}else{savedId=crypto.randomUUID();os.add({id:savedId,name,slots,createdAt:Date.now(),updatedAt:Date.now(),worn:[]})}}}
        else{savedId=crypto.randomUUID();os.add({id:savedId,name,slots,createdAt:Date.now(),updatedAt:Date.now(),worn:[]})}
      });
      // 저장한 코디를 계속 편집 대상으로 둔다: 다시 고치면 복제가 아니라 덮어쓰기('+ 새 코디'는 빈 칸으로 시작)
      setDraft(slots,name,savedId);saving=false;view='list';await refreshOutfits(); // 저장하면 목록으로 돌아가 저장한 코디를 보여 준다
      shown=savedId;say(overwrote?'코디를 덮어썼습니다':'코디를 저장했습니다');
    }catch(e){reportError(e,'코디를 저장하지 못했습니다.')}
    finally{saving=false;refreshOutfitView();if(shown!==null&&view==='list'&&outfitVisible()&&window.OFL)OFL.reveal(shown)}
  }
  async function renameOutfit(id){
    const o=outfits.find(x=>x.id===id);if(!o)return;
    const v=prompt('코디 이름',norm(o).name);if(v===null)return;const name=v.trim();if(!name)return say('이름을 입력해주세요');
    try{await transaction(['outfits'],'readwrite',tx=>{const os=tx.objectStore('outfits'),q=os.get(id);q.onsuccess=()=>{if(q.result)os.put({...q.result,name,updatedAt:Date.now()})}});if(editId===id){const followed=!editBase||!draftName.trim()||draftName.trim()===(editBase.name||'').trim();if(editBase)editBase={...editBase,name};if(followed)draftName=name;persistDraft()}await refreshOutfits();say('이름을 바꿨습니다')} // 고치는 기준 이름도 함께(안 그러면 그 코디를 지울 때 고친 초안으로 남았다)
    catch(e){reportError(e,'이름을 바꾸지 못했습니다.')}
  }
  async function deleteOutfit(id){
    const o=outfits.find(x=>x.id===id);
    if(!confirm(`'${o?norm(o).name:'이 코디'}'를 삭제할까요? 옷은 그대로 남고, 이 코디의 착용 기록(캘린더)은 사라집니다.`))return;
    try{await transaction(['outfits'],'readwrite',tx=>{tx.objectStore('outfits').delete(id)});if(typeof addTomb==='function')addTomb('o',id);await refreshOutfits();say('삭제했습니다')} // 초안 정리는 sanitizeDraft
    catch(e){reportError(e,'삭제하지 못했습니다.')}
  }
  // 즐겨찾기·보관: 끌 때도 칸을 지우지 않고 false로 남기고, 칸마다 누른 시각(favAt·archivedAt)을 찍는다. updatedAt(이름·칸을 고친 시각)은 찍지 않는다:
  // 찍으면 다른 기기에서 먼저 고친 이름·칸이 합치기에서 별표 하나에 밀려 사라진다. 합치기는 이름·칸은 updatedAt, 별표·보관은 이 시각으로 고른다
  async function setFlag(id,key,on){
    let found=false;
    try{
      await transaction(['outfits'],'readwrite',tx=>{const os=tx.objectStore('outfits'),q=os.get(id);q.onsuccess=()=>{if(q.result){found=true;os.put({...q.result,[key]:!!on,[key+'At']:Date.now()})}}});
      await refreshOutfits();
      if(!found)return say('코디를 찾지 못했습니다');
      say(key==='fav'?(on?'즐겨찾기에 넣었습니다':'즐겨찾기를 풀었습니다'):(on?"보관했습니다. 목록의 '보관함'에서 볼 수 있습니다":'보관을 풀었습니다'));
    }catch(e){reportError(e,key==='fav'?'즐겨찾기를 바꾸지 못했습니다.':'보관을 바꾸지 못했습니다.')}
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
          os.put({...o,worn:[...new Set([...worn,date])].sort()});if(typeof clearTomb==='function')clearTomb('w',`${id}|${date}`);
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
      await transaction(['outfits'],'readwrite',tx=>{const os=tx.objectStore('outfits'),q=os.get(id);q.onsuccess=()=>{const o=q.result;if(o)os.put({...o,worn:(Array.isArray(o.worn)?o.worn:[]).filter(d=>d!==date)})}});if(typeof addTomb==='function')addTomb('w',`${id}|${date}`);
      await refreshOutfits();say('기록을 지웠습니다. 옷의 착용 횟수는 그대로 둡니다.');
    }catch(e){reportError(e,'기록을 지우지 못했습니다.')}
  }

  // ---------- 옷 수정 창: 코디에 담기 ----------
  function editFormDirty(c){
    const v=id=>{const el=$(id);return el?el.value:''};
    return v('editCategory')!==(c.category||'')||v('editType')!==(c.type||'')||v('editColor')!==(c.color||'기타')||v('editSeason')!==(c.season||'사계절')||String(v('editFormality'))!==String(typeof formalityLevel==='function'?formalityLevel(c.formality):((+c.formality||1)>=3?3:1))||v('editMemo').trim()!==(c.memo||'');
  }
  function addToOutfit(){
    const id=typeof editingId!=='undefined'?editingId:null,c=byId(id);if(!c)return;
    const slot=SLOT_BY_CAT[c.category];if(!slot)return say('이 분류는 코디 칸이 없습니다');
    if(typeof photoBusy!=='undefined'&&photoBusy)return say('사진 처리가 끝난 뒤 눌러주세요');
    const dirty=typeof editDirty==='function'?editDirty():editFormDirty(c);
    if(dirty&&!confirm('바꾼 사진과 수정 내용은 저장되지 않습니다. 저장하지 않고 코디에 담을까요?'))return;
    if(typeof closeEdit==='function'&&closeEdit()===false)return;
    // 만들기 화면 밖에서 담을 때 초안이 저장한 그대로(방금 저장·되돌아옴)면 그 코디를 고치지 않고 새 코디로 시작한다
    if(view!=='builder'&&!OF.hasDraft())setDraft({...EMPTY,[slot]:c.id},'',null);else setDraft({...draft,[slot]:c.id});view='builder';
    const btn=[...document.querySelectorAll('nav button')].find(b=>(b.getAttribute('onclick')||'').includes("'outfit'"));
    if(btn)showPage('outfit',btn);else refreshOutfitView();
    window.scrollTo(0,0);say(`${SLOTS.find(s=>s.key===slot).label} 칸에 담았습니다`);
  }
  // 코디 탭으로 가서 지금 view를 그린다(보이는 중이면 바로, 아니면 탭을 열 때 그림)
  function gotoOutfitTab(){outfitDirty=true;const btn=[...document.querySelectorAll('nav button')].find(b=>(b.getAttribute('onclick')||'').includes("'outfit'"));if(btn&&!outfitVisible())showPage('outfit',btn);else refreshOutfitView();window.scrollTo(0,0)}
  function useRec(slots,noAsk){
    const next={...EMPTY};for(const k in EMPTY){const id=slots&&slots[k];next[k]=id&&byId(id)?id:null}
    if(!Object.values(next).some(Boolean)){say('담을 추천 결과가 없습니다');return false}
    if(!noAsk&&OF.hasDraft()&&!confirm('만들던 코디 초안을 추천 결과로 바꿀까요?'))return false;
    setDraft(next,'',null);view='builder';gotoOutfitTab();say('추천을 코디 칸에 담았습니다. 바꿀 칸을 누른 뒤 저장하세요.');return true;
  }
  // 코디 탭 '추천으로 채우기': 코디 추천 탭의 목적·날씨 설정으로 가장 좋은 조합부터, 누를 때마다 상의·하의가 다른 조합(설정마다 따로 기억)
  let fill={key:'',seen:new Set(),avoid:{tops:new Set(),bottoms:new Set(),items:new Set()},last:null};
  const sameSlots=(a,b)=>!!a&&!!b&&Object.keys(EMPTY).every(k=>(a[k]||null)===(b[k]||null));
  function fillRec(){
    if(typeof recommendCombos!=='function')return say('추천 기능 파일을 불러오지 못했습니다. 강제 새로고침 후 다시 시도해주세요');
    const oc=$('occasion'),we=$('weather'),t=oc?+oc.value:2,w=we?we.value:'normal',key=t+'|'+w;
    if(fill.key!==key)fill={key,seen:new Set(),avoid:{tops:new Set(),bottoms:new Set(),items:new Set()},last:null};
    const ro=typeof recOpts==='function'?recOpts(t,w):{}; // 지난날 본 조합은 뒤로
    let r=recommendCombos(t,w,fill.seen,1,fill.avoid,ro);
    if(!r.length&&fill.seen.size){fill.seen=new Set();fill.avoid={tops:new Set(),bottoms:new Set(),items:new Set()};r=recommendCombos(t,w,fill.seen,1,fill.avoid,ro)}
    if(!r.length)return say('상의와 하의를 먼저 등록해주세요');
    const fromFill=sameSlots(draft,fill.last); // 방금 채운 그대로면 묻지 않고 바꾼다
    if(!useRec(r[0].slots,fromFill))return;
    const s=r[0].slots;fill.seen.add(r[0].key);fill.avoid.tops.add(s.top);fill.avoid.bottoms.add(s.bottom);for(const k of ['outer','shoes','bag'])if(s[k])fill.avoid.items.add(s[k]);fill.last={...EMPTY,...s};
    const lab=el=>el&&el.selectedOptions&&el.selectedOptions[0]?el.selectedOptions[0].textContent:'';say(`추천 조합을 채웠습니다(${lab(oc)} · ${lab(we)}). 다시 누르면 다른 조합입니다.`);
  }
  // v5.0: 옷장 카드의 '오늘 입음'을 옷 창으로 옮겼다(사용자: 카드 버튼은 쓰지 않음). 버튼 줄은 사진 바로 아래(코디 띠 다음)에 둔다(예전에는 창 맨 아래 저장 줄 위)
  function installEditButton(){
    const save=$('editSaveBtn');if(!save||$('ofAddBtn'))return;
    const wb=document.createElement('button');wb.id='ofWearBtn';wb.type='button';wb.textContent='오늘 입음';wb.onclick=()=>{const id=typeof editingId!=='undefined'?editingId:null;if(id!==null&&typeof wear==='function')wear(id)};
    const b=document.createElement('button');
    b.id='ofAddBtn';b.type='button';b.className='secondary';b.textContent='코디에 담기';b.onclick=addToOutfit;
    const rb=document.createElement('button');rb.id='ofRecBtn';rb.type='button';rb.className='secondary';rb.textContent='이 옷으로 추천';rb.onclick=()=>recWith();
    const wrap=document.createElement('div');wrap.className='actions of-acts';wrap.appendChild(wb);wrap.appendChild(b);wrap.appendChild(rb);
    const anchor=$('editPartial')||$('editImg');
    if(anchor)anchor.parentNode.insertBefore(wrap,anchor.nextSibling);else save.parentNode.parentNode.insertBefore(wrap,save.parentNode);
  }
  // '오늘 입음' 글자: 오늘 이미 입었으면 ✓(index.html wear()가 하루 한 번만 센다)
  function syncWearBtn(){const b=$('ofWearBtn');if(!b)return;const id=typeof editingId!=='undefined'?editingId:null,c=id===null?null:byId(id);b.textContent=c&&typeof isToday==='function'&&isToday(c.lastWorn)?'오늘 입음 ✓':'오늘 입음'}

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
  function closetOrder(){if(typeof closetFiltered==='function')return closetFiltered();const f=typeof filter!=='undefined'?filter:'전체';return (f==='보관함'?clothes.filter(c=>c.archived):clothes.filter(c=>!c.archived&&(f==='전체'||c.category===f))).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0))}
  function applyClosetTools(){
    const items=$('items');if(!items)return;
    items.classList.toggle('dense',dense);
    const btn=$('densityBtn');if(btn)btn.textContent=dense?'3열':'4열';
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

  // ---------- 옷장 고르기: 여러 벌 격식 한꺼번에 바꾸기(v5.1) ----------
  // 고르는 동안 카드를 누르면 옷 창 대신 고른다(카드의 dataset.ofId 기준, 검색·칩으로 걸러 고르기).
  // 한 트랜잭션에서 격식이 실제로 바뀌는 옷만 formality(1/3)·updatedAt을 쓴다. 되돌리기는 그 사이 다시 바뀌지 않은 옷만
  let selMode=false;const sel=new Set();
  function selectable(){return [...($('items')?.children||[])].filter(el=>el.dataset.ofId&&!el.hidden)}
  function syncSel(){
    const items=$('items');if(!items)return;
    const ids=new Set(clothes.map(c=>String(c.id)));for(const id of [...sel])if(!ids.has(id))sel.delete(id); // 지운 옷
    $('closet')?.classList.toggle('selecting',selMode);
    for(const el of items.children)el.classList.toggle('picked',selMode&&sel.has(el.dataset.ofId));
    const bar=$('selBar');if(!bar)return;bar.hidden=!selMode;
    const btn=$('selBtn');if(btn)btn.textContent=selMode?'끝내기':'고르기';
    $('selCount').textContent=`${sel.size}벌 선택`;
    for(const b of bar.querySelectorAll('[data-lv]'))b.disabled=!sel.size;
  }
  function setSelMode(on){selMode=on;sel.clear();syncSel()}
  function onItemsClick(e){
    if(!selMode)return;const el=e.target.closest('.item');if(!el||!$('items').contains(el))return;
    e.preventDefault();e.stopPropagation();
    const id=el.dataset.ofId;if(!id){say('이 카드는 고를 수 없습니다. 검색을 지우고 다시 해 보세요');return}
    if(sel.has(id))sel.delete(id);else sel.add(id);syncSel();
  }
  function selectVisible(){const vis=selectable().map(el=>el.dataset.ofId);if(vis.length&&vis.every(id=>sel.has(id)))vis.forEach(id=>sel.delete(id));else vis.forEach(id=>sel.add(id));syncSel()}
  async function bulkFormality(lv){
    const ids=clothes.filter(c=>sel.has(String(c.id))).map(c=>c.id);if(!ids.length)return;
    const name=lv===3?'포멀':'캐주얼',changed=[];
    await locked(async()=>{
      try{
        const ts=Date.now();
        await transaction(['clothes'],'readwrite',tx=>{const s=tx.objectStore('clothes');for(const id of ids){const q=s.get(id);q.onsuccess=()=>{const r=q.result;if(!r||formalityLevel(r.formality)===lv)return;changed.push({id,formality:r.formality,updatedAt:r.updatedAt,ts});s.put({...r,formality:lv,updatedAt:ts})}}});
        sel.clear();await refresh();
      }catch(e){changed.length=0;reportError(e,'격식을 바꾸지 못했습니다.');return}
      if(!changed.length){say(`고른 옷이 이미 모두 ${name}입니다`);return}
      const prev=changed.slice();
      window.toast(`${prev.length}벌을 ${name}(으)로 바꿨습니다`,'되돌리기',()=>undoBulk(prev,lv));
    });
  }
  async function undoBulk(prev,lv){
    let n=0;
    await locked(async()=>{
      try{
        await transaction(['clothes'],'readwrite',tx=>{const s=tx.objectStore('clothes');for(const p of prev){const q=s.get(p.id);q.onsuccess=()=>{const r=q.result;if(!r||r.formality!==lv||r.updatedAt!==p.ts)return;const next={...r,formality:p.formality};if(p.formality===undefined)delete next.formality;if(p.updatedAt===undefined)delete next.updatedAt;else next.updatedAt=p.updatedAt;s.put(next);n++}}});
        await refresh();
      }catch(e){reportError(e,'되돌리지 못했습니다.');return}
      say(n===prev.length?'되돌렸습니다':`${n}벌만 되돌렸습니다(그 사이 바뀐 옷은 그대로)`);
    });
  }
  function installSelect(){
    const tools=$('closetTools');if(!tools||$('selBtn'))return;
    const b=document.createElement('button');b.type='button';b.id='selBtn';b.className='secondary';b.style.flex='none';b.textContent='고르기';
    b.onclick=()=>setSelMode(!selMode);tools.appendChild(b);
    const bar=document.createElement('div');bar.id='selBar';bar.hidden=true;
    bar.innerHTML=`<span id="selCount" class="small">0벌 선택</span><button type="button" class="secondary" id="selAll">보이는 옷 모두</button><button type="button" data-lv="3">포멀로</button><button type="button" class="secondary" data-lv="1">캐주얼로</button>`;
    tools.parentNode.insertBefore(bar,tools.nextSibling);
    $('selAll').onclick=selectVisible;
    for(const x of bar.querySelectorAll('[data-lv]'))x.onclick=()=>bulkFormality(+x.dataset.lv);
    $('items')?.addEventListener('click',onItemsClick,true); // 카드의 onclick(옷 창)보다 먼저
  }

  // ---------- 초기화 ----------
  function injectCSS(){
    const s=document.createElement('style');s.textContent=`
#outfit .fl{display:flex;flex-direction:column;gap:8px;align-items:center;width:100%;max-width:340px;margin:auto}
.fl{display:flex;flex-direction:column;gap:8px;align-items:center;width:100%}
#selBar{position:sticky;top:0;z-index:5;display:flex;flex-wrap:wrap;gap:6px;align-items:center;background:#f6f5f2;padding:8px 0;margin-bottom:6px}
#selBar[hidden]{display:none}
#selBar button{flex:none;width:auto;margin:0;padding:8px 12px}
#selCount{flex:1 1 auto;font-weight:700}
#closet.selecting #addFab{display:none}
#closet.selecting .item{cursor:pointer}
#closet.selecting .item::after{content:'';position:absolute;top:6px;right:6px;width:22px;height:22px;border-radius:50%;border:2px solid #fff;background:rgba(0,0,0,.25);box-shadow:0 0 0 1px rgba(0,0,0,.2);pointer-events:none}
#closet.selecting .item.picked{outline:3px solid #111;outline-offset:-3px}
#closet.selecting .item.picked::after{content:'✓';background:#111;color:#fff;font-size:13px;font-weight:700;line-height:18px;text-align:center}
.fl-row{display:flex;gap:8px;justify-content:center;width:100%}
.fl-tile{flex:1 1 0;max-width:calc(50% - 4px);aspect-ratio:1;border-radius:14px;background:#eee;display:flex;align-items:center;justify-content:center;color:#888;font-size:13px;position:relative;overflow:hidden}
.fl-row.n3 .fl-tile{max-width:calc(33.333% - 6px)}
.fl-tile.editable.empty{border:1px dashed #aaa;background:#fafafa;cursor:pointer}
.fl-tile.editable{cursor:pointer}
.fl-tile img{width:100%;height:100%;object-fit:cover;display:block}
.fl-x{position:absolute;top:0;right:0;width:40px;height:40px;padding:0;background:transparent;border-radius:0}
.fl-x i{position:absolute;top:4px;right:4px;width:22px;height:22px;border-radius:50%;background:#171717;color:#fff;font-size:15px;line-height:22px;font-style:normal;text-align:center}
.fl.small{gap:4px;max-width:150px}.fl.small .fl-row{gap:4px}.fl.small .fl-tile{border-radius:8px;font-size:10px}.fl.small .fl-row.n3 .fl-tile{max-width:calc(33.333% - 3px)}
.of-item{display:flex;gap:10px;background:#f7f7f7;border-radius:15px;padding:9px;margin-top:8px}.of-related{margin:8px 0;background:#f7f7f7;border-radius:12px;padding:8px 10px}.of-related>summary{cursor:pointer;font-weight:700;font-size:14px}.of-rel-strip{display:flex;gap:8px;overflow-x:auto;padding:8px 0 2px;-webkit-overflow-scrolling:touch}.of-rel{flex:none;width:118px;background:#fff;border:1px solid #eee;border-radius:12px;padding:6px;color:#222;text-align:left;font-weight:400}.of-rel .of-thumb{width:100%}.of-flash{outline:3px solid #f59e0b;outline-offset:2px;transition:outline-color .4s}.of-rel-more p{margin:8px 0 0}.of-co{display:flex;gap:8px;overflow-x:auto;padding:2px 0}.of-co-item{flex:none;width:72px;font-size:11px;color:#555}.of-co-item img{width:72px;height:72px;object-fit:cover;border-radius:10px;display:block;background:#eee}.pitem{position:relative}.pitem .pcount{position:absolute;top:4px;left:4px;background:rgba(0,0,0,.62);color:#fff;font-size:10px;font-weight:700;padding:1px 6px;border-radius:8px}
.of-item.done{opacity:.45}
.of-thumb{width:150px;flex:none}.of-info{min-width:0;flex:1;display:flex;flex-direction:column}.of-info .actions{margin-top:auto;flex-wrap:wrap}.of-info .actions button{flex:1 1 auto;white-space:nowrap;padding:8px 6px;min-height:40px}
.of-head{align-items:center}.of-head h2{margin:0;flex:1;min-width:0}.of-head .badge{white-space:nowrap;display:inline-block;vertical-align:middle}.of-new{flex:none;padding:10px 14px;white-space:nowrap}
#oflSearch{flex:1 1 140px;min-width:0}#oflSort{flex:0 1 auto;max-width:46%}
.ofl-itemrow{display:flex;align-items:center;gap:8px;background:#f0f7f1;border-radius:12px;padding:6px 6px 6px 10px;margin:4px 0}.ofl-itemrow span{flex:1;min-width:0;font-size:13px;overflow-wrap:anywhere}.ofl-itemrow button{flex:none}
.of-resume{display:flex;align-items:center;gap:8px;background:#f0f7f1;border-radius:12px;padding:8px 10px;margin:10px 0 2px}.of-resume span{flex:1;font-size:13px}.of-resume button{flex:none}
.of-save{position:sticky;bottom:calc(54px + env(safe-area-inset-bottom));background:#fff;margin:4px -4px 0;padding:8px 4px 4px;z-index:3}
.of-bar{display:flex;align-items:center;gap:8px;margin-bottom:10px}.of-bar h2{margin:0;flex:1}.of-back{flex:none;min-height:44px;padding:8px 12px;font-size:14px}
.of-rel-all{display:flex;align-items:center;justify-content:center;text-align:center;font-weight:700;font-size:12px;color:#166534;width:96px}
.ofl-tools input,.ofl-tools select{margin:2px 0}.ofl-chips{margin-top:4px}
.ofl-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px;margin-top:8px}
.ofl-card{position:relative;display:flex;flex-direction:column;align-items:stretch;background:transparent;color:#222;padding:0;border-radius:12px;text-align:left;font-weight:400;min-width:0}
.ofl-card.done{opacity:.45}
.ofl-cover{aspect-ratio:1;display:grid;gap:2px;grid-template-columns:1fr 1fr;grid-template-rows:1fr 1fr;background:#e7e7e7;border-radius:12px;overflow:hidden;width:100%}
.ofl-cover img,.sheet .ofl-cover img{width:100%;height:100%;max-height:none;object-fit:contain;background:#fff;border-radius:0;display:block;min-width:0;min-height:0}
.ofl-cover.n1,.ofl-cover.n0{grid-template-columns:1fr;grid-template-rows:1fr}.ofl-cover.n2{grid-template-columns:1fr}.ofl-cover.n3 img:first-child{grid-column:span 2}
.ofl-cover.n0{place-items:center;color:#888;font-size:11px}
.ofl-name{display:block;font-size:12px;font-weight:600;margin-top:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ofl-meta{display:block;font-size:11px;color:#777;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.ofl-star{position:absolute;top:3px;left:5px;color:#f59e0b;font-size:16px;text-shadow:0 0 3px #fff,0 0 1px #fff}
.ofl-edit{position:absolute;top:4px;right:4px;background:#166534;color:#fff;font-size:10px;padding:1px 6px;border-radius:8px}
.ofl-more{width:100%;margin-top:10px}
.ofl-sec{margin-top:12px}.ofl-count{margin:4px 0 0}
.ofl-group{margin-top:6px;border-top:1px solid #eee}
.ofl-ghead{display:flex;align-items:center;gap:6px;width:100%;background:transparent;color:#222;padding:10px 2px;border-radius:0;text-align:left;font-weight:400;min-height:44px}.ofl-ghead i{margin-left:auto;font-style:normal;color:#888}
.ofl-favbtn{flex:none;width:44px;height:44px;padding:0;border-radius:50%;background:#f3f3f3;color:#999;font-size:22px;line-height:44px}.ofl-favbtn.on{color:#f59e0b}
.ofl-detail-fl .fl{max-width:220px;margin:8px auto 0}.sheet .fl-tile img{max-height:none;border-radius:0;background:none}
.ofl-main{margin-top:6px}.ofl-main button{flex:1}
.ofl-items{margin-top:10px;display:flex;flex-direction:column;gap:6px}
.ofl-it{display:flex;align-items:center;gap:10px;background:#f7f7f7;border-radius:12px;padding:6px 10px 6px 6px;color:#222;text-align:left;font-weight:400;min-height:56px;width:100%}
.ofl-it img,.sheet .ofl-it img,.ofl-noimg{width:44px;height:44px;max-height:none;border-radius:8px;object-fit:cover;background:#eee;flex:none;display:block}
.ofl-it>span:not(.ofl-noimg){flex:1;min-width:0;font-size:14px}.ofl-it i{font-style:normal;color:#999}.ofl-it.gone{opacity:.6}
.ofl-menu{margin-top:12px;border-top:1px solid #eee;padding-top:10px}
.ofl-archived{background:#fff7e6;border-radius:10px;padding:8px 10px;margin:8px 0 0}
#wornBody .pick-head input{margin:6px 0 2px}
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
#closetTools input{margin:0}#closetSearch{flex:1 1 120px;min-width:0}#closetSort{max-width:40%}
#items.dense{grid-template-columns:repeat(4,1fr);gap:6px}
#items.dense .item img{height:auto;aspect-ratio:1/1}
#items.dense .info{padding:3px 5px}
#items.dense .info>:not(.title){display:none}
#items.dense .info .title{font-size:11px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
#ofAddBtn{width:100%}.of-acts{margin:10px 0 4px}.of-acts button{font-size:14px;padding:11px 6px;min-height:44px}
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

  // ---------- 옷 수정 창: 이 옷이 든 코디 ----------
  // 사진 아래에 접힌 한 줄로 둔다(창이 이미 길어서). 펼치면 코디를 가로로 보여 주고, 누르면 코디 탭 목록에서 그 코디를 찾아 보여 준다
  function installRelated(){
    const img=$('editImg');if(!img||$('ofRelated'))return;
    const d=document.createElement('details');d.id='ofRelated';d.className='of-related';d.hidden=true;
    d.innerHTML='<summary onclick="OF.relatedToggle(!this.parentNode.open)"></summary><div class="of-rel-strip"></div><div class="of-rel-more"></div>';
    const anchor=$('editPartial')||img;anchor.parentNode.insertBefore(d,anchor.nextSibling);
    const sel=$('editCategory');if(sel)sel.addEventListener('change',()=>syncRecBtn());
  }
  // 보관한 코디까지 든 목록(입은 날·함께 입은 옷은 기록이라 보관한 코디도 센다). 띠와 '코디 n개'는 보관하지 않은 것만
  function relatedOf(id){return outfits.map(norm).filter(o=>Object.values(o.slots).some(v=>v===id)).sort((a,b)=>lastWorn(b)>lastWorn(a)?1:lastWorn(b)<lastWorn(a)?-1:(b.createdAt||0)-(a.createdAt||0))}
  // 이 옷을 입은 날: 이 옷이 든 코디의 착용 날짜(코디 탭 '오늘 입음'·캘린더 기록). 옷장 카드 '오늘 입음'은 날짜 목록이 없어 넣지 않는다
  function wornDaysOf(id,list){const days=new Set();for(const o of list)for(const d of o.worn)days.add(d);return [...days].sort().reverse()}
  // 자주 함께 입은 옷: 입은 기록이 있는 코디의 다른 칸 옷을 입은 횟수만큼 센다. 입은 코디가 없으면 '같은 코디에 든 옷'(안 입은 코디 기준)
  function coWornOf(id,list){
    const worn=list.filter(o=>o.worn.length),src=worn.length?worn:list,m=new Map();
    for(const o of src){const wgt=Math.max(1,o.worn.length);for(const v of new Set(Object.values(o.slots)))if(v&&v!==id){const c=byId(v);if(c&&!c.archived)m.set(v,(m.get(v)||0)+wgt)}}
    return {worn:worn.length>0,items:[...m.entries()].sort((a,b)=>b[1]-a[1]).slice(0,4).map(([v])=>byId(v))};
  }
  let relatedPref=null;
  function renderRelated(){
    const d=$('ofRelated');if(!d)return;
    const id=typeof editingId!=='undefined'?editingId:null,c=id===null?null:byId(id),every=c?relatedOf(id):[],list=every.filter(o=>!o.archived),days=c?wornDaysOf(id,every):[];
    syncRecBtn();syncWearBtn(); // '이 옷으로 추천'은 액세서리·보관한 옷, 분류를 바꾸고 저장하기 전에는 없음
    d.hidden=!list.length&&!days.length;
    if(d.hidden){d.querySelector('.of-rel-strip').innerHTML='';d.querySelector('.of-rel-more').innerHTML='';return}
    d.open=relatedPref===true;
    d.querySelector('summary').textContent=list.length?`이 옷이 든 코디 ${list.length}개${days.length?` · 입은 날 ${days.length}일`:''}`:`입은 날 ${days.length}일 (보관한 코디)`;
    d.querySelector('.of-rel-strip').innerHTML=list.map(o=>`<button type="button" class="of-rel" onclick="OF.showOutfit(${arg(o.id)})"><div class="of-thumb">${flatLayHTML(o.slots,{small:true})}</div><span class="small">${esc(o.name)}${o.worn.length?` · ${o.worn.length}회`:''}</span></button>`).join('')
      +(list.length>1?`<button type="button" class="of-rel of-rel-all" onclick="OF.showWith(${arg(id)})">이 옷이 든 코디<br>모두 보기 ›</button>`:'');
    const co=coWornOf(id,every),yr=today().slice(0,4),md=s=>`${s.slice(0,4)===yr?'':s.slice(2,4)+'/'}${Number(s.slice(5,7))}/${Number(s.slice(8))}`;
    d.querySelector('.of-rel-more').innerHTML=(days.length?`<p class="small"><b>입은 날</b> ${days.slice(0,8).map(md).join(', ')}${days.length>8?` 외 ${days.length-8}일`:''} <span class="muted">(코디 기록)</span></p>`:'')
      +(co.items.length?`<p class="small" style="margin-bottom:4px"><b>${co.worn?'자주 함께 입은 옷':'같은 코디에 든 옷'}</b></p><div class="of-co">${co.items.map(x=>`<div class="of-co-item"><img src="${url(x.image)}" alt="" loading="lazy" decoding="async"><span>${esc(title(x))}</span></div>`).join('')}</div>`:'');
  }
  function syncRecBtn(){const b=$('ofRecBtn');if(!b)return;const id=typeof editingId!=='undefined'?editingId:null,c=id===null?null:byId(id),sel=$('editCategory');b.hidden=!c||c.archived||!PIN_SLOT[c.category]||(sel&&sel.value&&sel.value!==c.category)}
  // '이 옷으로 추천': 이 옷을 고정하고 코디 추천 탭에서 나머지를 추천
  const PIN_SLOT={'아우터':'outer','상의':'top','하의':'bottom','신발':'shoes','가방':'bag'};
  function recWith(){
    const id=typeof editingId!=='undefined'?editingId:null,c=byId(id);if(!c)return;
    const slot=PIN_SLOT[c.category];if(!slot)return say('액세서리는 고정 추천을 하지 않습니다');if(c.archived)return say('보관한 옷은 추천에 쓰지 않습니다');
    if(typeof recommend!=='function'||typeof setRecPin!=='function')return say('추천 기능 파일을 불러오지 못했습니다. 강제 새로고침 후 다시 시도해주세요');
    const dirty=typeof editDirty==='function'?editDirty():editFormDirty(c);
    if(dirty&&!confirm('바꾼 사진과 수정 내용은 저장되지 않습니다. 저장하지 않고 추천을 볼까요?'))return;
    if(typeof closeEdit==='function'&&closeEdit()===false)return;
    setRecPin(slot,c.id);
    const btn=[...document.querySelectorAll('nav button')].find(b=>(b.getAttribute('onclick')||'').includes("'recommend'"));if(btn)showPage('recommend',btn);
    recommend();window.scrollTo(0,0);
  }
  // 옷 창을 닫아도 되는지(저장 안 한 수정 확인) 묻고 닫는다
  function leaveEdit(msg){
    const c=typeof editingId!=='undefined'?byId(editingId):null;
    const dirty=typeof editDirty==='function'?editDirty():c?editFormDirty(c):false;
    if(dirty&&!confirm(msg))return false;
    if(typeof closeEdit==='function'&&closeEdit()===false)return false;
    return true;
  }
  function showOutfit(id){
    if(!leaveEdit('바꾼 사진과 수정 내용은 저장되지 않습니다. 저장하지 않고 코디를 볼까요?'))return;
    view='list';gotoOutfitTab();
    if(window.OFL)OFL.open(id);
  }
  // '모두 보기': 코디 탭 목록을 이 옷이 든 코디로 거른다(칩 '이 옷: …'으로 풀 수 있음)
  function showWith(id){
    if(!leaveEdit('바꾼 사진과 수정 내용은 저장되지 않습니다. 저장하지 않고 코디를 볼까요?'))return;
    view='list';if(window.OFL)OFL.item(id);gotoOutfitTab();
  }

  window.OF={
    pick(k){if(view!=='builder'){view='builder';refreshOutfitView()}pickSlot=k;pickAll=false;pickQuery='';pickType='';renderPick()}, // 칸 고르기는 만들기 화면에서
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
    view(k){view=k==='cal'?'cal':'list';renderOutfitPage()},
    // '+ 새 코디': 저장 안 한 초안이 있으면 그것을 이어서(만들기 화면의 '비우기'로 새로 시작), 없으면 빈 칸으로
    newOutfit(){if(!OF.hasDraft())setDraft({...EMPTY},'',null);OF.builder()},
    builder(){view='builder';gotoOutfitTab()},
    back(){view='list';renderOutfitPage();window.scrollTo(0,0)},
    refreshList(){if(view==='list')refreshOutfitView()},
    detail(id){if(window.OFL)OFL.open(id);else OF.load(id)},
    // 고치기: 다른 코디를 만들던 중이면 먼저 묻는다
    load(id){const o=outfits.find(x=>x.id===id);if(!o)return false;
      if(editId===o.id&&OF.hasDraft()){view='builder';gotoOutfitTab();say("고치던 내용을 이어서 엽니다. 저장된 대로 돌리려면 '저장된 대로 되돌리기'를 누르세요.");return true}
      if(OF.hasDraft()&&!confirm('만들던 코디가 있습니다. 저장하지 않고 이 코디를 불러올까요?'))return false;
      const n=norm(o);setDraft(liveOf(n.slots),n.name,o.id);view='builder';gotoOutfitTab();say('코디를 불러왔습니다. 칸을 바꾼 뒤 덮어쓰기를 누르세요.');return true},
    revert(){const o=editId?outfits.find(x=>x.id===editId):null;if(!o)return;if(!confirm('고친 내용을 버리고 저장된 대로 되돌릴까요?'))return;const n=norm(o);setDraft(liveOf(n.slots),n.name,o.id);refreshOutfitView()},
    fav(id,on){locked(()=>setFlag(id,'fav',on))},
    archive(id,on){locked(()=>setFlag(id,'archived',on))},
    wear(id){locked(()=>markWorn(id,today()))},
    rename(id){locked(()=>renameOutfit(id))},
    del(id){locked(()=>deleteOutfit(id))},
    month(k){calMonth=shiftMonth(calMonth,k);calDay=null;renderOutfitPage()},
    day(d){calDay=calDay===d?null:d;renderOutfitPage()},
    unwear(id,d){locked(()=>unmarkWorn(id,d))},
    addWorn(d){if(d>today())return say('미래 날짜는 기록할 수 없습니다');addWornFor=d;wornQuery='';renderWornPick();const sh=$('wornModal').querySelector('.sheet');if(sh)sh.scrollTop=0},
    wornQuery(v){wornQuery=v;renderWornGrid()},
    chooseWorn(id){const d=addWornFor;addWornFor=null;$('wornModal').classList.remove('open');if(d)locked(()=>markWorn(id,d))},
    closeWorn(){addWornFor=null;$('wornModal').classList.remove('open')},
    addToOutfit,
    showOutfit,
    showWith,
    recWith,
    relatedToggle(v){relatedPref=v;try{localStorage.setItem('wardrobe.relatedOpen',v?'1':'0')}catch{}},
    editState(){return editId?{id:editId,clean:!OF.hasDraft()}:null},
    // 합치기 뒤: 고치던 코디가 바뀌었으면, 초안이 저장본 그대로였으면 새 내용으로 다시 채우고, 고치던 중이었으면 새 코디로 떼어 둔다
    afterMerge(ed,changed){if(!ed||!changed.has(ed.id)||editId!==ed.id)return;const o=outfits.find(x=>x.id===ed.id);if(!o)return;
      if(ed.clean){const n=norm(o);setDraft(liveOf(n.slots),n.name,o.id)}else{editId=null;persistDraft();say('다른 기기에서 바뀐 코디라, 고치던 내용은 새 코디로 두었습니다')}refreshOutfitView()},
    useRec,
    fillRec,
    // 업데이트·새로고침 전에 index.html이 물어볼 수 있게: 저장하지 않은 코디 초안이 있는지
    hasDraft(){sanitizeDraft();const saved=editId?outfits.find(o=>o.id===editId):null;if(!Object.values(draft).some(Boolean))return false;if(!saved)return true;const n=norm(saved),sl=liveOf(n.slots);return Object.keys(EMPTY).some(k=>(sl[k]||null)!==(draft[k]||null))||(draftName.trim()&&draftName.trim()!==n.name)},
    get errors(){return renderErrors},
    // outfit-list.js가 쓰는 도우미(읽기만)
    util:{SLOTS,norm,byId,title,hay,terms,today,fmtDate,lastWorn,flatLayHTML,say,get editingId(){return editId}}
  };

  function init(){
    try{dense=localStorage.getItem('wardrobe.dense')==='1';closetSort=localStorage.getItem('wardrobe.closetSort')||'recent';relatedPref=localStorage.getItem('wardrobe.relatedOpen')==='1';localStorage.removeItem('wardrobe.builderOpen')}catch{} // v4.8.6~4.10 만들기 칸 접기 설정은 v4.11에서 쓰지 않음
    injectCSS();ensureDOM();installClosetTools();installSelect();installEditButton();installRelated();restoreDraft();
    const baseOpenEdit=window.openEdit;if(typeof baseOpenEdit==='function')window.openEdit=function(){baseOpenEdit.apply(this,arguments);safe(renderRelated,'이 옷이 든 코디')};
    const baseRender=window.render;
    window.render=function(){
      closetDirty=false;baseRender.apply(this,arguments);safe(sanitizeDraft,'코디 초안');
      safe(applyClosetTools,'옷장 검색');safe(syncSel,'옷 고르기');
      if(outfitVisible())safe(renderOutfitPage,'코디 화면');else outfitDirty=true; // 숨겨진 코디 화면은 보일 때 그린다
      if(pickSlot&&$('pickModal').classList.contains('open'))safe(renderPickGrid,'옷 고르기');
      if(window.OFL&&OFL.isOpen())safe(()=>OFL.renderDetail(),'코디 상세');
      if(addWornFor&&$('wornModal').classList.contains('open'))safe(renderWornGrid,'코디 고르기');
      if($('editModal')&&$('editModal').classList.contains('open'))safe(syncWearBtn,'옷 창'); // 오늘 입음 뒤
    };
    const baseShow=window.showPage;
    window.showPage=function(id){if(id!=='closet'&&selMode)setSelMode(false);baseShow.apply(this,arguments);if(id==='outfit'&&outfitDirty)safe(renderOutfitPage,'코디 화면');if(id==='closet'&&closetDirty)render()};
    // 뒤로 가기 캐시에서 돌아오면 index.html이 URL을 모두 해제했으므로 열린 시트를 다시 그린다
    window.addEventListener('pageshow',e=>{if(!e.persisted)return;if(pickSlot)safe(renderPick,'옷 고르기');if(addWornFor)safe(renderWornPick,'코디 고르기');if(window.OFL&&OFL.isOpen())safe(()=>OFL.renderDetail(),'코디 상세')});
    // 앱을 켜 둔 채 날짜·달이 바뀌면 '오늘'과 달력을 맞춘다(사용자가 다른 달로 옮겨 둔 경우는 그대로)
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState!=='visible')return;const m=today().slice(0,7);if(calMonth===calAutoMonth&&calMonth!==m){calMonth=m;calAutoMonth=m;calDay=null}refreshOutfitView();if($('editModal')&&$('editModal').classList.contains('open'))safe(syncWearBtn,'옷 창')});
    // refresh()가 이미 끝나 첫 render가 지나갔으면 감싼 render로 다시 그린다. 아직이면 refresh가 감싼 render를 부른다
    const s=$('summary');if(dataReady()&&s&&!/불러오는/.test(s.textContent))render();else safe(renderOutfitPage,'코디 화면');
  }
  init();
})();
