/* year-review.js — 올해 옷장 결산 (Claude Code, v6.2)
   더보기 '통계' 칸의 '2026 옷장 결산 보기'로 여는 전체 화면. 옆으로 넘기는 장(슬라이드) 일곱 장:
   표지 → 많이 입은 옷 TOP 3 → 많이 입은 코디 TOP 3 → 올해의 색 → 월별 착용 → 올해 안 입은 옷 → 마무리.
   - 새 데이터 칸은 없다. 기기 안에서 clothes·outfits(index.html 전역)를 읽기만 하고 아무것도 저장하지 않는다.
   - 옷에는 입은 날짜 목록이 없다(lastWorn 하나와 전체 기간 wearCount뿐). 그래서 '올해' 옷별·색별 집계는 코디 착용 기록
     (코디 탭 '오늘 입음'·캘린더·추천 '입었어요')으로 센 날 수다. 같은 날 같은 옷이 든 코디가 둘이면 하루로 센다.
     올해 코디 기록이 하나도 없으면 전체 기간 wearCount로 순위를 매기고 화면에 그 기준을 밝힌다.
   - '올해 안 입은 옷': 보관하지 않은 옷 중 마지막으로 입은 날(lastWorn)이 올해가 아니고 올해 코디 기록에도 없는 옷.
     옷장 카드 '오늘 입음'도 lastWorn을 바꾸므로 이것은 코디 기록 없이도 정확하다.
   - 보관한 옷·코디도 올해 입었으면 순위에 넣는다(결산이라). 지운 옷은 뺀다.
   부르는 전역: clothes, outfits, esc, tsrc, localDate, OUTFIT_SLOTS, OF.util.norm, OFL.coverHTML(없으면 사진 한 장). */
(function(){
  const COLOR_HEX={'검정':'#1f1f1f','흰색':'#ffffff','아이보리/크림':'#f1e8d2','네이비':'#1f2d4f','회색':'#9b9b9b','베이지':'#d6c09a','브라운':'#7a5234','카키/올리브':'#6c6b3a','블루':'#4a7cc7','그린':'#3d8b50','와인/버건디':'#7b2238','기타':'#c9c4bb'};
  const SLOT_KEYS=['outer','top','bottom','shoes','bag','acc'];
  let idx=0,count=0;
  const $=id=>document.getElementById(id);
  const nameOfItem=c=>c.memo||c.type||c.category||'이름 없음';
  const thisYear=()=>new Date().getFullYear();

  // ---------- 계산 ----------
  function compute(y){
    const pre=`${y}-`,today=typeof localDate==='function'?localDate():'';
    const norm=window.OF&&OF.util&&OF.util.norm?OF.util.norm:(o=>({...o,worn:Array.isArray(o.worn)?o.worn:[],slots:o.slots||{}}));
    const byId=new Map(clothes.map(c=>[String(c.id),c]));
    const days=new Set(),itemDays=new Map(),outfitRank=[];
    for(const raw of outfits){
      if(!raw)continue;const o=norm(raw);
      const ds=[...new Set(o.worn.filter(d=>typeof d==='string'&&d.startsWith(pre)&&(!today||d<=today)))].sort();
      if(!ds.length)continue;
      outfitRank.push({o,n:ds.length,last:ds[ds.length-1]});
      for(const d of ds)days.add(d);
      const ids=new Set((typeof OUTFIT_SLOTS!=='undefined'?OUTFIT_SLOTS:SLOT_KEYS).map(k=>o.slots[k]).filter(v=>v!==null&&v!==undefined&&byId.has(String(v))).map(String));
      for(const id of ids){let s=itemDays.get(id);if(!s)itemDays.set(id,s=new Set());for(const d of ds)s.add(d)}
    }
    const byOutfit=days.size>0; // 올해 코디 기록이 있으면 그것으로, 없으면 전체 기간 착용 횟수로
    const score=c=>byOutfit?(itemDays.get(String(c.id))||{size:0}).size:(+c.wearCount||0);
    const ranked=clothes.filter(c=>score(c)>0).sort((a,b)=>score(b)-score(a)||(+b.wearCount||0)-(+a.wearCount||0)||(+b.lastWorn||0)-(+a.lastWorn||0));
    outfitRank.sort((a,b)=>b.n-a.n||(a.last<b.last?1:a.last>b.last?-1:0));
    const colors=new Map();for(const c of ranked){const k=COLOR_HEX[c.color]?c.color:'기타';colors.set(k,(colors.get(k)||0)+score(c))}
    const colorRank=[...colors].sort((a,b)=>b[1]-a[1]);
    const months=Array(12).fill(0);for(const d of days)months[+d.slice(5,7)-1]++;
    const yStart=new Date(y,0,1).getTime();
    const unworn=clothes.filter(c=>!c.archived&&!(+c.lastWorn>=yStart)&&!itemDays.has(String(c.id))).sort((a,b)=>(+a.createdAt||0)-(+b.createdAt||0));
    const active=clothes.filter(c=>!c.archived);
    const addedThisYear=active.filter(c=>+c.createdAt>=yStart).length;
    return {y,byOutfit,score,ranked,outfitRank,colorRank,months,days:days.size,unworn,active:active.length,addedThisYear,outfitsLive:outfits.filter(o=>o&&!o.archived).length};
  }

  // ---------- 장(슬라이드) ----------
  const photo=(c,cls='')=>`<img class="${cls}" ${tsrc(c)} alt="${esc(nameOfItem(c))}" loading="lazy" decoding="async" draggable="false">`;
  const unit=r=>r.byOutfit?'일':'회';
  const basis=r=>r.byOutfit?'코디 착용 기록으로 센 날 수예요. 옷장 카드의 \'착용 n회\'는 전체 기간이라 다를 수 있어요.':`올해 코디 착용 기록이 없어 전체 기간 착용 횟수로 셌어요.`;
  function slides(r){
    const out=[];
    out.push(`<section class="yr-slide yr-cover"><p class="yr-kicker">MY WARDROBE</p><h2><span>${r.y}</span>옷장 결산</h2>
      <div class="yr-big3"><div><b>${r.active}</b><span>벌의 옷</span></div><div><b>${r.days}</b><span>일 코디 기록</span></div><div><b>${r.outfitsLive}</b><span>개 저장 코디</span></div></div>${r.addedThisYear?`<p class="yr-hint">올해 새로 들인 옷 ${r.addedThisYear}벌</p>`:''}
      <p class="yr-hint yr-swipe">옆으로 넘겨 보세요 →</p></section>`);
    const top=r.ranked.slice(0,3);
    out.push(`<section class="yr-slide"><p class="yr-kicker">${r.byOutfit?'올해':'지금까지'} 가장 많이 입은 옷</p><h3>TOP 3</h3>
      ${top.length?`<ol class="yr-top">${top.map((c,i)=>`<li><i>${i+1}</i>${photo(c)}<div><b>${esc(nameOfItem(c))}</b><span>${esc(c.category||'')} · ${r.score(c)}${unit(r)}</span></div></li>`).join('')}</ol>`:'<p class="yr-empty">아직 입은 기록이 없어요.<br>코디 탭에서 \'오늘 입음\'을 눌러 기록해 보세요.</p>'}
      <p class="yr-note">${basis(r)}</p></section>`);
    const tops=r.outfitRank.slice(0,3),cover=o=>window.OFL&&OFL.coverHTML?OFL.coverHTML(o):'';
    out.push(`<section class="yr-slide"><p class="yr-kicker">올해 가장 많이 입은 코디</p><h3>TOP 3</h3>
      ${tops.length?`<ol class="yr-otop">${tops.map((x,i)=>`<li><i>${i+1}</i><div class="yr-cov">${cover(x.o)}</div><div><b>${esc(x.o.name)}</b><span>${x.n}일 입음${x.o.archived?' · 보관함':''}</span></div></li>`).join('')}</ol>`:'<p class="yr-empty">올해 입은 코디 기록이 없어요.<br>추천의 \'입었어요\'나 코디 탭 \'오늘 입음\'으로 남길 수 있어요.</p>'}</section>`);
    const total=r.colorRank.reduce((a,x)=>a+x[1],0),c0=r.colorRank[0];
    out.push(`<section class="yr-slide"><p class="yr-kicker">올해의 색</p>
      ${c0?`<div class="yr-swatch" style="background:${COLOR_HEX[c0[0]]}"></div><h3>${esc(c0[0])}</h3><p class="yr-sub">입은 기록의 ${Math.round(c0[1]/total*100)}%</p>
      <ul class="yr-colors">${r.colorRank.slice(0,5).map(([k,n])=>`<li><span class="yr-dot" style="background:${COLOR_HEX[k]}"></span><b>${esc(k)}</b><span class="yr-bar"><span style="width:${Math.max(4,Math.round(n/c0[1]*100))}%"></span></span><em>${Math.round(n/total*100)}%</em></li>`).join('')}</ul>`:'<p class="yr-empty">입은 기록이 쌓이면 가장 많이 입은 색을 알려 드려요.</p>'}
      <p class="yr-note">옷마다 입은 ${unit(r)==='일'?'날 수':'횟수'}를 그 옷의 색에 더해 나눴어요.</p></section>`);
    const max=Math.max(...r.months),nowM=r.y===thisYear()?new Date().getMonth():11,best=max?r.months.indexOf(max):-1;
    out.push(`<section class="yr-slide"><p class="yr-kicker">월별 착용</p><h3>${best>=0?`${best+1}월에 가장 많이 입었어요`:'아직 기록이 없어요'}</h3>
      <div class="yr-chart" role="img" aria-label="월별 코디 기록한 날 수: ${r.months.map((n,i)=>`${i+1}월 ${n}일`).join(', ')}">${r.months.map((n,i)=>`<div class="yr-col${i>nowM?' future':''}${i===best?' best':''}"><em>${i>nowM||!n?'':n}</em><span style="height:${max?Math.round(n/max*100):0}%"></span><i>${i+1}</i></div>`).join('')}</div>
      <p class="yr-note">달마다 코디를 기록한 날 수예요(하루에 여러 코디를 기록해도 하루).</p></section>`);
    const un=r.unworn,show=un.slice(0,9);
    out.push(`<section class="yr-slide"><p class="yr-kicker">올해 한 번도 안 입은 옷</p><h3>${un.length?`${un.length}벌`:'없어요!'}</h3>
      ${un.length?`<div class="yr-grid">${show.map(c=>`<figure>${photo(c)}<figcaption>${esc(nameOfItem(c))}</figcaption></figure>`).join('')}</div>${un.length>show.length?`<p class="yr-sub">외 ${un.length-show.length}벌 · 오래전에 등록한 옷부터</p>`:''}<p class="yr-note">보관하지 않은 옷 중 올해 입은 기록(옷장 '오늘 입음'·코디 기록)이 없는 옷이에요.</p>`:`<p class="yr-empty">보관하지 않은 모든 옷을 올해 한 번 이상 입었어요.</p>`}</section>`);
    const fav=r.ranked[0];
    out.push(`<section class="yr-slide yr-end"><p class="yr-kicker">${r.y} 올해의 옷</p>
      ${fav?`${photo(fav,'yr-hero')}<h3>${esc(nameOfItem(fav))}</h3><p class="yr-sub">${r.score(fav)}${unit(r)} 함께했어요</p>`:'<h3>내년에는 더 많이 기록해 봐요</h3>'}
      <p class="yr-line">${un.length?`안 입은 옷 ${un.length}벌, 내년엔 꺼내 볼까요?`:'옷장을 알뜰하게 다 입은 한 해였어요.'}</p>
      <button type="button" class="yr-done" onclick="YR.close()">닫기</button></section>`);
    return out;
  }

  // ---------- 화면 ----------
  function ensure(){
    if($('yrModal'))return;
    style();
    const m=document.createElement('div');m.id='yrModal';m.className='yr-modal';m.hidden=true;m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');
    m.innerHTML=`<div class="yr-top-bar"><div class="yr-prog" id="yrProg"></div><button type="button" class="yr-x" aria-label="결산 닫기" onclick="YR.close()">✕</button></div><div class="yr-track" id="yrTrack"></div><div class="yr-nav"><button type="button" id="yrPrev" class="secondary" onclick="YR.go(-1)" aria-label="이전 장">‹ 이전</button><span id="yrPage" class="small muted"></span><button type="button" id="yrNext" onclick="YR.go(1)" aria-label="다음 장">다음 ›</button></div>`;
    document.body.appendChild(m);
    let t=null;$('yrTrack').addEventListener('scroll',()=>{clearTimeout(t);t=setTimeout(()=>{const tr=$('yrTrack');if(!tr.clientWidth)return;const i=Math.round(tr.scrollLeft/tr.clientWidth);if(i!==idx){idx=i;syncNav()}},60)},{passive:true});
    document.addEventListener('keydown',e=>{if($('yrModal').hidden)return;if(e.key==='Escape')close();else if(e.key==='ArrowRight')go(1);else if(e.key==='ArrowLeft')go(-1)});
  }
  function syncNav(){
    $('yrProg').innerHTML=Array.from({length:count},(_,i)=>`<span class="${i<=idx?'on':''}"></span>`).join('');
    $('yrPage').textContent=`${idx+1} / ${count}`;
    $('yrPrev').disabled=idx===0;const n=$('yrNext');n.disabled=idx>=count-1;
  }
  function go(d){const i=Math.max(0,Math.min(count-1,idx+d));if(i===idx)return;idx=i;const tr=$('yrTrack');tr.scrollTo({left:i*tr.clientWidth,behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'auto':'smooth'});syncNav()}
  function open(){
    ensure();const r=compute(thisYear()),s=slides(r);count=s.length;idx=0;
    const m=$('yrModal');m.setAttribute('aria-label',`${r.y} 옷장 결산`);
    $('yrTrack').innerHTML=s.join('');m.hidden=false;document.documentElement.classList.add('yr-lock');
    $('yrTrack').scrollLeft=0;syncNav();
  }
  function close(){const m=$('yrModal');if(m){m.hidden=true;$('yrTrack').replaceChildren()}document.documentElement.classList.remove('yr-lock')}
  function style(){if($('yrStyle'))return;const st=document.createElement('style');st.id='yrStyle';st.textContent=CSS;document.head.appendChild(st)}
  function label(){const b=$('yrOpen');if(b)b.textContent=`${thisYear()} 옷장 결산 보기`}

  const CSS=`
.yr-open{width:100%;background:#166534;color:#fff;border-radius:999px;min-height:48px}
.yr-lock,.yr-lock body{overflow:hidden}
.yr-modal{position:fixed;inset:0;z-index:30;background:#f6f5f2;display:flex;flex-direction:column;padding:calc(10px + env(safe-area-inset-top)) 0 calc(12px + env(safe-area-inset-bottom))}
.yr-modal[hidden]{display:none}
.yr-top-bar{display:flex;align-items:center;gap:10px;padding:0 12px 8px 16px;max-width:560px;width:100%;margin:0 auto}
.yr-prog{flex:1;display:flex;gap:4px}.yr-prog span{flex:1;height:4px;border-radius:2px;background:#e4e1da}.yr-prog span.on{background:#166534}
.yr-x{flex:none;width:44px;height:44px;padding:0;border-radius:50%;background:#ece9e3;color:#171717;font-size:16px}
.yr-track{flex:1;min-height:0;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;overscroll-behavior:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch;max-width:560px;width:100%;margin:0 auto}
.yr-track::-webkit-scrollbar{display:none}
.yr-slide{flex:0 0 100%;scroll-snap-align:center;scroll-snap-stop:always;box-sizing:border-box;margin:0;padding:0 16px;overflow-y:auto;display:flex;flex-direction:column}
.yr-slide>*{flex:none}
.yr-slide::before{content:"";display:block;flex:1 1 0;max-height:40px}
.yr-slide::after{content:"";display:block;flex:1 1 0}
.yr-kicker{margin:0 0 4px;font-size:13px;font-weight:700;color:#166534;letter-spacing:.2px}
.yr-slide h3{margin:0 0 14px;font-size:26px;font-weight:800;letter-spacing:-.4px}
.yr-sub{margin:-8px 0 12px;color:#6b6862;font-size:14px}
.yr-note{margin:14px 2px 0;color:#6b6862;font-size:12px;line-height:1.5}
.yr-empty{background:#fff;border-radius:18px;padding:22px 16px;text-align:center;color:#6b6862;font-size:14px;line-height:1.6;margin:0}
.yr-cover{background:#166534;color:#fff;border-radius:26px;margin:0 16px;flex-basis:calc(100% - 32px);padding:28px 22px}
.yr-cover::before,.yr-cover::after{max-height:none}
.yr-cover .yr-kicker{color:#bbf7d0}
.yr-cover h2{margin:0 0 26px;font-size:40px;line-height:1.1;font-weight:800;letter-spacing:-1px}.yr-cover h2 span{display:block;font-size:64px;letter-spacing:-2px}
.yr-big3{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.yr-big3 div{background:#ffffff1f;border-radius:16px;padding:12px 8px}.yr-big3 b{display:block;font-size:26px;font-weight:800}.yr-big3 span{font-size:12px;line-height:1.4;color:#dcfce7}
.yr-hint{margin:14px 0 0;font-size:14px;color:#dcfce7}.yr-swipe{margin-top:26px;font-size:13px;color:#bbf7d0}
.yr-top,.yr-otop{list-style:none;margin:0;padding:0;display:grid;gap:10px}
.yr-top li,.yr-otop li{display:flex;align-items:center;gap:12px;background:#fff;border-radius:18px;padding:10px}
.yr-top li>i,.yr-otop li>i{flex:none;width:28px;font-style:normal;font-size:22px;font-weight:800;color:#166534;text-align:center}
.yr-top img{flex:none;width:92px;height:92px;object-fit:contain;background:#fff;border:1px solid #ece9e3;border-radius:14px}
.yr-top li:first-child img{width:116px;height:116px}
.yr-top li>div,.yr-otop li>div:last-child{min-width:0;flex:1}
.yr-top b,.yr-otop b{display:block;font-size:16px;font-weight:750;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.yr-top span,.yr-otop span{font-size:13px;color:#6b6862}
.yr-cov{flex:none;width:96px}.yr-cov .ofl-cover{display:grid}
.yr-swatch{width:120px;height:120px;border-radius:50%;margin:6px 0 14px;box-shadow:inset 0 0 0 1px #0000001a,0 8px 22px #0000001f}
.yr-colors{list-style:none;margin:0;padding:12px;display:grid;gap:10px;background:#fff;border-radius:18px}
.yr-colors li{display:grid;grid-template-columns:18px 76px 1fr 44px;align-items:center;gap:8px;font-size:13px}
.yr-dot{width:16px;height:16px;border-radius:50%;box-shadow:inset 0 0 0 1px #0000001f}
.yr-colors b{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.yr-bar{height:10px;background:#f1efe9;border-radius:5px;overflow:hidden}.yr-bar span{display:block;height:100%;background:#166534;border-radius:5px}
.yr-colors em{font-style:normal;text-align:right;color:#6b6862}
.yr-chart{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:4px;align-items:end;height:220px;background:#fff;border-radius:18px;padding:14px 10px 8px}
.yr-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}
.yr-col span{width:100%;max-width:22px;background:#c8d9cd;border-radius:6px 6px 2px 2px;min-height:2px}
.yr-col.best span{background:#166534}
.yr-col em{font-style:normal;font-size:10.5px;color:#6b6862;margin-bottom:3px}
.yr-col i{font-style:normal;font-size:11px;color:#6b6862;margin-top:5px}
.yr-col.future span{background:#ece9e3}.yr-col.future i{color:#b8b4ac}
.yr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:8px}
.yr-grid figure{margin:0;background:#fff;border-radius:14px;overflow:hidden;min-width:0}
.yr-grid img{display:block;width:100%;aspect-ratio:1;object-fit:contain;background:#fff}
.yr-grid figcaption{font-size:11px;padding:4px 7px 6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#3f3d39}
.yr-end{align-items:center;text-align:center}
.yr-hero{width:min(64vw,240px);aspect-ratio:1;object-fit:contain;background:#fff;border-radius:24px;margin:8px 0 16px;box-shadow:0 10px 28px #0000001a}
.yr-end h3{margin-bottom:12px}
.yr-line{margin:4px 0 18px;font-size:15px;font-weight:600}
.yr-done{min-width:160px;border-radius:999px;min-height:48px}
.yr-nav{display:flex;align-items:center;gap:10px;padding:10px 16px 0;max-width:560px;width:100%;margin:0 auto;box-sizing:border-box}
.yr-nav button{flex:1;border-radius:999px;min-height:48px}.yr-nav button:disabled{opacity:.35}
.yr-nav span{flex:none;min-width:44px;text-align:center}
`;
  window.YR={open,close,go,compute,state:()=>({open:!!$('yrModal')&&!$('yrModal').hidden,idx,count})};
  style();label();
})();
