/* outfits.js — 코디 만들기·저장 코디·착용 캘린더·옷장 검색/4열 (Claude Code, v4.0)
   index.html의 전역(clothes, outfits, db, $, esc, arg, url, transaction, refresh, render, showPage)을 호출만 하고 고치지 않는다.
   데이터 계약은 COLLAB.md 3절: outfits {id, name, slots:{outer,top,bottom,shoes,acc}, createdAt(ms), worn:['YYYY-MM-DD']}.
   "오늘 입음"은 같은 날짜가 이미 있으면 아무것도 바꾸지 않는다(idempotent). 기록 삭제는 worn만 지우고 clothes.wearCount는 건드리지 않는다. */
(function(){
  const SLOTS=[
    {key:'outer',label:'아우터',cats:['아우터']},
    {key:'top',label:'상의',cats:['상의']},
    {key:'bottom',label:'하의',cats:['하의']},
    {key:'shoes',label:'신발',cats:['신발']},
    {key:'acc',label:'가방·액세서리',cats:['가방','액세서리']}
  ];
  const EMPTY={outer:null,top:null,bottom:null,shoes:null,acc:null};
  const WEEK=['일','월','화','수','목','금','토'];
  let draft={...EMPTY},draftName='',pickSlot=null,pickAll=false,view='list',sortKey='recent',calMonth=null,calDay=null,addWornFor=null,closetQuery='',dense=false,toastTimer=null;

  const pad=n=>String(n).padStart(2,'0');
  const fmtDate=d=>`${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`; // 현지 날짜. toISOString은 UTC라 쓰지 않는다
  const today=()=>fmtDate(new Date());
  const dateMs=s=>{const [y,m,d]=s.split('-').map(Number);return new Date(y,m-1,d,12).getTime()};
  const fmtKo=s=>{const [y,m,d]=s.split('-').map(Number);return `${m}월 ${d}일 (${WEEK[new Date(y,m-1,d).getDay()]})`};
  const shiftMonth=(ym,k)=>{const [y,m]=ym.split('-').map(Number);return fmtDate(new Date(y,m-1+k,1)).slice(0,7)};
  const monthCells=ym=>{const [y,m]=ym.split('-').map(Number);const cells=Array(new Date(y,m-1,1).getDay()).fill(null);const days=new Date(y,m,0).getDate();for(let d=1;d<=days;d++)cells.push(`${ym}-${pad(d)}`);while(cells.length%7)cells.push(null);return cells};
  const byId=id=>id?clothes.find(c=>c.id===id)||null:null;
  const slotIds=o=>SLOTS.map(s=>o.slots&&o.slots[s.key]).filter(Boolean);
  const norm=o=>({...o,name:o.name||'코디',slots:{...EMPTY,...(o.slots||{})},worn:Array.isArray(o.worn)?o.worn.slice().sort():[]});
  const lastWorn=o=>o.worn.length?o.worn[o.worn.length-1]:'';
  const repItem=o=>['top','outer','bottom','shoes','acc'].map(k=>byId(o.slots[k])).find(Boolean)||null;
  const title=c=>c.memo||c.type||c.category;

  function say(m){const t=$('ofToast');if(!t)return;t.textContent=m;t.classList.add('show');clearTimeout(toastTimer);toastTimer=setTimeout(()=>t.classList.remove('show'),2600)}

  // ---------- 화면 조각 ----------
  function tileHTML(slotKey,label,item,opts){
    const editable=!!opts.editable;
    const inner=item?`<img src="${url(item.image)}" alt="${esc(title(item))}" draggable="false">`:`<span>${esc(label)}</span>`;
    const click=editable?` onclick="OF.pick(${arg(slotKey)})"`:'';
    const x=editable&&item?`<button type="button" class="fl-x" aria-label="비우기" onclick="event.stopPropagation();OF.clear(${arg(slotKey)})">×</button>`:'';
    return `<div class="fl-tile${item?'':' empty'}${editable?' editable':''}"${click}>${inner}${x}</div>`;
  }
  function flatLayHTML(slots,opts={}){
    const rows=[['outer','top'],['bottom'],['shoes','acc']];
    const body=rows.map(keys=>{
      const cells=keys.map(k=>({k,it:byId(slots[k]),meta:SLOTS.find(s=>s.key===k)})).filter(c=>opts.editable||c.it);
      return cells.length?`<div class="fl-row">${cells.map(c=>tileHTML(c.k,c.meta.label,c.it,opts)).join('')}</div>`:'';
    }).join('');
    return `<div class="fl${opts.small?' small':''}">${body||'<div class="fl-row"><div class="fl-tile empty"><span>옷 없음</span></div></div>'}</div>`;
  }
  function listHTML(sorted){
    if(!sorted.length)return '<div class="empty">저장한 코디가 없습니다.<br>위에서 옷을 골라 저장하세요.</div>';
    const chips=[['recent','최근 저장'],['most','많이 입은 순'],['last','최근 입은 순']].map(([k,l])=>`<button type="button" class="chip${sortKey===k?' on':''}" onclick="OF.sort(${arg(k)})">${l}</button>`).join('');
    return `<div class="chips">${chips}</div>`+sorted.map(o=>`<div class="of-item">
      <div class="of-thumb">${flatLayHTML(o.slots,{small:true})}</div>
      <div class="of-info"><div class="title">${esc(o.name)}</div>
        <div class="small muted">${fmtDate(new Date(o.createdAt||Date.now()))}${o.worn.length?` · ${o.worn.length}회 입음 · 마지막 ${lastWorn(o).slice(5).replace('-','/')}`:''}</div>
        <div class="actions"><button type="button" class="ghost" onclick="OF.load(${arg(o.id)})">불러오기</button><button type="button" class="ghost" onclick="OF.wear(${arg(o.id)})">오늘 입음</button><button type="button" class="ghost" onclick="OF.del(${arg(o.id)})">삭제</button></div>
      </div></div>`).join('');
  }
  function calHTML(wornByDate){
    const cells=monthCells(calMonth),t=today(),days=Object.keys(wornByDate).filter(d=>d.startsWith(calMonth)).length;
    const grid=cells.map((d,i)=>{
      if(!d)return `<div key="e${i}"></div>`;
      const list=wornByDate[d]||[],rep=list.length?repItem(list[0]):null;
      const cls=`cal-cell${calDay===d?' sel':''}${d===t?' today':''}${list.length?' has':''}`;
      return `<button type="button" class="${cls}" onclick="OF.day(${arg(d)})">${rep?`<img src="${url(rep.image)}" alt="" draggable="false">`:''}<span class="${rep?'onimg':''}">${Number(d.slice(8))}</span>${list.length>1?`<b class="n">${list.length}</b>`:''}</button>`;
    }).join('');
    let detail='';
    if(calDay){
      const list=wornByDate[calDay]||[];
      detail=`<div class="cal-day"><div class="row" style="align-items:center"><b style="flex:1">${fmtKo(calDay)}</b><button type="button" class="ghost" style="flex:none" ${outfits.length?'':'disabled'} onclick="OF.addWorn(${arg(calDay)})">이 날 기록 추가</button></div>
        ${list.length?list.map(o=>`<div class="of-item"><div class="of-thumb">${flatLayHTML(o.slots,{small:true})}</div><div class="of-info"><div class="title">${esc(o.name)}</div><div class="small muted">${o.worn.length}회 입음</div><div class="actions"><button type="button" class="ghost" onclick="OF.load(${arg(o.id)})">불러오기</button><button type="button" class="ghost" onclick="OF.unwear(${arg(o.id)},${arg(calDay)})">기록 삭제</button></div></div></div>`).join(''):'<p class="small muted" style="text-align:center;padding:10px 0">기록이 없습니다.</p>'}</div>`;
    }else detail='<p class="small muted" style="text-align:center">날짜를 누르면 그날 입은 코디를 보고, 지난 날짜에 기록을 추가할 수 있습니다.</p>';
    return `<div class="row" style="align-items:center;margin-bottom:6px"><button type="button" class="ghost" style="flex:none" onclick="OF.month(-1)" aria-label="이전 달">‹</button><b style="flex:1;text-align:center">${Number(calMonth.slice(0,4))}년 ${Number(calMonth.slice(5))}월 <span class="small muted">${days}일 기록</span></b><button type="button" class="ghost" style="flex:none" onclick="OF.month(1)" aria-label="다음 달">›</button></div>
      <div class="cal head">${WEEK.map(w=>`<div>${w}</div>`).join('')}</div><div class="cal">${grid}</div>${detail}`;
  }
  function renderOutfitPage(){
    const sec=$('outfit');if(!sec)return;
    if(!calMonth)calMonth=today().slice(0,7);
    const sorted=outfits.map(norm);
    if(sortKey==='most')sorted.sort((a,b)=>b.worn.length-a.worn.length);
    else if(sortKey==='last')sorted.sort((a,b)=>lastWorn(b)>lastWorn(a)?1:lastWorn(b)<lastWorn(a)?-1:0);
    else sorted.sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    const wornByDate={};for(const o of sorted)for(const d of o.worn)(wornByDate[d]=wornByDate[d]||[]).push(o);
    sec.innerHTML=`<div class="card"><h2>코디 만들기</h2><p class="small">칸을 눌러 옷을 고르세요. 아우터·가방은 비워도 됩니다.</p>
        ${flatLayHTML(draft,{editable:true})}
        <div class="row" style="margin-top:12px;align-items:center"><input id="outfitName" placeholder="코디 이름 (선택)" value="${esc(draftName)}" oninput="OF.name(this.value)" aria-label="코디 이름"><button type="button" style="flex:none" onclick="OF.save()">저장</button><button type="button" class="secondary" style="flex:none" onclick="OF.clearAll()">비우기</button></div>
      </div>
      <div class="card"><h2>저장한 코디 <span class="badge">${outfits.length}개</span></h2>
        <div class="chips">${[['list','목록'],['cal','캘린더']].map(([k,l])=>`<button type="button" class="chip${view===k?' on':''}" onclick="OF.view(${arg(k)})">${l}</button>`).join('')}</div>
        ${view==='list'?listHTML(sorted):calHTML(wornByDate)}
      </div>`;
  }

  // ---------- 고르기 시트 ----------
  function renderPick(){
    const meta=SLOTS.find(s=>s.key===pickSlot);if(!meta)return;
    const list=clothes.filter(c=>pickAll||meta.cats.includes(c.category)).slice().sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    $('pickBody').innerHTML=`<div class="row" style="align-items:center"><h2 style="margin:0;flex:1">${esc(meta.label)} 고르기 <span class="badge">${list.length}벌</span></h2><button type="button" class="chip${pickAll?' on':''}" style="flex:none" onclick="OF.pickAll()">전체 보기</button></div>
      ${list.length?`<div class="pgrid">${list.map(c=>`<img src="${url(c.image)}" alt="${esc(title(c))}" class="${draft[pickSlot]===c.id?'sel':''}" loading="lazy" draggable="false" onclick="OF.choose(${arg(c.id)})">`).join('')}</div>`:'<p class="small">이 분류에 등록된 옷이 없습니다. 전체 보기를 누르면 모든 옷에서 고를 수 있습니다.</p>'}`;
    $('pickModal').classList.add('open');
  }
  function renderWornPick(){
    const sorted=outfits.map(norm).sort((a,b)=>(b.createdAt||0)-(a.createdAt||0));
    $('wornBody').innerHTML=`<h2 style="margin:0 0 8px">${esc(fmtKo(addWornFor))} 입은 코디 고르기</h2>`+sorted.map(o=>{const done=o.worn.includes(addWornFor);return `<div class="of-item${done?' done':''}" ${done?'':`onclick="OF.chooseWorn(${arg(o.id)})"`}><div class="of-thumb">${flatLayHTML(o.slots,{small:true})}</div><div class="of-info"><div class="title">${esc(o.name)}</div><div class="small muted">${o.worn.length?`${o.worn.length}회 입음`:'기록 없음'}${done?' · 이 날 기록됨':''}</div></div></div>`}).join('');
    $('wornModal').classList.add('open');
  }

  // ---------- 저장(IndexedDB) ----------
  async function saveOutfit(){
    if(!Object.values(draft).some(Boolean))return say('옷을 먼저 골라주세요');
    const rec={id:crypto.randomUUID(),name:draftName.trim()||`코디 ${outfits.length+1}`,slots:{...draft},createdAt:Date.now(),worn:[]};
    try{await transaction(['outfits'],'readwrite',tx=>{tx.objectStore('outfits').add(rec)});draftName='';await refresh();say('코디를 저장했습니다')}
    catch(e){reportError(e,'코디를 저장하지 못했습니다.')}
  }
  async function deleteOutfit(id){
    if(!confirm('이 코디를 삭제할까요? 옷은 그대로 남습니다.'))return;
    try{await transaction(['outfits'],'readwrite',tx=>{tx.objectStore('outfits').delete(id)});await refresh();say('삭제했습니다')}
    catch(e){reportError(e,'삭제하지 못했습니다.')}
  }
  async function markWorn(id,date){
    let dup=false,found=false;
    try{
      await transaction(['outfits','clothes'],'readwrite',tx=>{
        const os=tx.objectStore('outfits'),cs=tx.objectStore('clothes'),q=os.get(id);
        q.onsuccess=()=>{
          const o=q.result;if(!o)return;found=true;
          const worn=Array.isArray(o.worn)?o.worn:[];
          if(worn.includes(date)){dup=true;return} // 같은 날 재기록은 아무것도 바꾸지 않는다
          os.put({...o,worn:[...worn,date].sort()});
          const ts=date===today()?Date.now():dateMs(date);
          for(const cid of slotIds(o)){const g=cs.get(cid);g.onsuccess=()=>{if(g.result)cs.put({...g.result,wearCount:(g.result.wearCount||0)+1,lastWorn:Math.max(g.result.lastWorn||0,ts)})}}
        };
      });
      await refresh();
      say(!found?'코디를 찾지 못했습니다':dup?(date===today()?'오늘은 이미 기록되어 있습니다':'이미 기록된 날입니다'):(date===today()?'오늘 입은 것으로 기록했습니다':`${fmtKo(date)}에 기록했습니다`));
    }catch(e){reportError(e,'착용 기록을 저장하지 못했습니다.')}
  }
  async function unmarkWorn(id,date){
    try{
      await transaction(['outfits'],'readwrite',tx=>{const os=tx.objectStore('outfits'),q=os.get(id);q.onsuccess=()=>{const o=q.result;if(o)os.put({...o,worn:(Array.isArray(o.worn)?o.worn:[]).filter(d=>d!==date)})}});
      await refresh();say('기록을 지웠습니다. 옷의 착용 횟수는 그대로 둡니다.');
    }catch(e){reportError(e,'기록을 지우지 못했습니다.')}
  }

  // ---------- 옷장 탭 보조: 검색·4열 ----------
  function installClosetTools(){
    const filters=$('filters');if(!filters||$('closetTools'))return;
    const div=document.createElement('div');div.id='closetTools';div.className='row';div.style.alignItems='center';
    div.innerHTML=`<input id="closetSearch" placeholder="검색: 이름·종류·색" aria-label="옷장 검색" autocomplete="off"><span id="closetSearchStat" class="small muted" style="flex:none" hidden></span><button type="button" id="densityBtn" class="secondary" style="flex:none">4열</button>`;
    filters.parentNode.insertBefore(div,filters);
    $('closetSearch').oninput=e=>{closetQuery=e.target.value.trim().toLowerCase();applyClosetTools()};
    $('densityBtn').onclick=()=>{dense=!dense;try{localStorage.setItem('wardrobe.dense',dense?'1':'')}catch{}applyClosetTools()};
  }
  function applyClosetTools(){
    const items=$('items');if(!items)return;
    items.classList.toggle('dense',dense);
    const btn=$('densityBtn');if(btn)btn.textContent=dense?'2열':'4열';
    let n=0;for(const el of items.children){const hit=!closetQuery||el.textContent.toLowerCase().includes(closetQuery);el.hidden=!hit;if(hit)n++}
    const st=$('closetSearchStat');if(st){st.hidden=!closetQuery;st.textContent=`${n}벌`}
    const empty=$('empty');if(empty&&closetQuery&&items.children.length)empty.style.display=n?'none':'block';
  }

  // ---------- 초기화 ----------
  function injectCSS(){
    const s=document.createElement('style');s.textContent=`
#outfit .fl{display:flex;flex-direction:column;gap:8px;align-items:center;width:100%;max-width:340px;margin:auto}
.fl{display:flex;flex-direction:column;gap:8px;align-items:center;width:100%}
.fl-row{display:flex;gap:8px;justify-content:center;width:100%}
.fl-tile{flex:1 1 0;max-width:calc(50% - 4px);aspect-ratio:1;border-radius:14px;background:#eee;display:flex;align-items:center;justify-content:center;color:#888;font-size:13px;position:relative;overflow:hidden}
.fl-tile.editable.empty{border:1px dashed #aaa;background:#fafafa;cursor:pointer}
.fl-tile.editable{cursor:pointer}
.fl-tile img{width:100%;height:100%;object-fit:cover;display:block}
.fl-x{position:absolute;top:3px;right:3px;width:22px;height:22px;border-radius:50%;background:#171717;color:#fff;font-size:15px;line-height:22px;padding:0;text-align:center}
.fl.small{gap:4px;max-width:150px}.fl.small .fl-row{gap:4px}.fl.small .fl-tile{border-radius:8px;font-size:10px}
.of-item{display:flex;gap:10px;background:#f7f7f7;border-radius:15px;padding:9px;margin-top:8px}
.of-item.done{opacity:.45}
.of-thumb{width:150px;flex:none}.of-info{min-width:0;flex:1;display:flex;flex-direction:column}.of-info .actions{margin-top:auto;flex-wrap:wrap}.of-info .actions button{flex:1 1 auto;white-space:nowrap;padding:8px 6px}
@media (max-width:430px){.of-thumb{width:118px}.fl.small{max-width:118px}}
.pgrid{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;margin-top:10px}
.pgrid img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:10px;background:#eee;cursor:pointer;max-height:none}
.pgrid img.sel{outline:3px solid #166534}
.cal{display:grid;grid-template-columns:repeat(7,1fr);gap:4px}
.cal.head div{text-align:center;font-size:11px;color:#888;padding:2px 0}
.cal-cell{position:relative;aspect-ratio:1;border-radius:10px;background:#fff;border:1px solid #eee;padding:0;overflow:hidden;color:#333;font-size:12px;font-weight:600;text-align:left}
.cal-cell.has{background:#eee;border-color:transparent}
.cal-cell img{width:100%;height:100%;object-fit:cover;display:block}
.cal-cell span{position:absolute;left:4px;top:2px;font-size:11px}
.cal-cell span.onimg{color:#fff;text-shadow:0 0 3px rgba(0,0,0,.9)}
.cal-cell.sel{outline:2px solid #166534}.cal-cell.today{border:1px solid #166534;color:#166534}
.cal-cell .n{position:absolute;right:3px;bottom:2px;background:#171717;color:#fff;border-radius:999px;padding:0 5px;font-size:10px}
.cal-day{margin-top:12px;border-top:1px solid #eee;padding-top:10px}
#closetTools input{margin:0}
#items.dense{grid-template-columns:repeat(4,1fr);gap:6px}
#items.dense .item img{height:auto;aspect-ratio:1/1}
#items.dense .info{display:none}
#ofToast{position:fixed;left:50%;bottom:calc(74px + env(safe-area-inset-bottom));transform:translateX(-50%);background:#171717;color:#fff;border-radius:999px;padding:9px 14px;font-size:13px;z-index:60;max-width:90vw;display:none}
#ofToast.show{display:block}`;
    document.head.appendChild(s);
  }
  function ensureDOM(){
    if(!$('pickModal')){const m=document.createElement('div');m.id='pickModal';m.className='modal';m.onclick=e=>{if(e.target===m)OF.closePick()};m.innerHTML='<div class="sheet"><div id="pickBody"></div></div>';document.body.appendChild(m)}
    if(!$('wornModal')){const m=document.createElement('div');m.id='wornModal';m.className='modal';m.onclick=e=>{if(e.target===m)OF.closeWorn()};m.innerHTML='<div class="sheet"><div id="wornBody"></div></div>';document.body.appendChild(m)}
    if(!$('ofToast')){const t=document.createElement('div');t.id='ofToast';t.setAttribute('role','status');document.body.appendChild(t)}
  }

  window.OF={
    pick(k){pickSlot=k;pickAll=false;renderPick()},
    pickAll(){pickAll=!pickAll;renderPick()},
    choose(id){if(pickSlot)draft={...draft,[pickSlot]:id};pickSlot=null;$('pickModal').classList.remove('open');renderOutfitPage()},
    closePick(){pickSlot=null;$('pickModal').classList.remove('open')},
    clear(k){draft={...draft,[k]:null};renderOutfitPage()},
    clearAll(){draft={...EMPTY};draftName='';renderOutfitPage()},
    name(v){draftName=v},
    save(){saveOutfit()},
    view(k){view=k;renderOutfitPage()},
    sort(k){sortKey=k;renderOutfitPage()},
    load(id){const o=outfits.find(x=>x.id===id);if(!o)return;const s={...EMPTY};for(const k in EMPTY)s[k]=byId(o.slots&&o.slots[k])?o.slots[k]:null;draft=s;renderOutfitPage();window.scrollTo(0,0);say('코디를 불러왔습니다. 칸을 눌러 바꿀 수 있습니다.')},
    wear(id){markWorn(id,today())},
    del(id){deleteOutfit(id)},
    month(k){calMonth=shiftMonth(calMonth,k);calDay=null;renderOutfitPage()},
    day(d){calDay=calDay===d?null:d;renderOutfitPage()},
    unwear(id,d){unmarkWorn(id,d)},
    addWorn(d){addWornFor=d;renderWornPick()},
    chooseWorn(id){const d=addWornFor;addWornFor=null;$('wornModal').classList.remove('open');if(d)markWorn(id,d)},
    closeWorn(){addWornFor=null;$('wornModal').classList.remove('open')}
  };

  function init(){
    injectCSS();ensureDOM();installClosetTools();
    try{dense=localStorage.getItem('wardrobe.dense')==='1'}catch{}
    const base=window.render;
    window.render=function(){base.apply(this,arguments);try{renderOutfitPage();applyClosetTools()}catch(e){console.error('outfits.js render',e)}};
    if(typeof db!=='undefined'&&db)render();else renderOutfitPage();
  }
  init();
})();
