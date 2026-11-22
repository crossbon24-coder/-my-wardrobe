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
    const out=[],tile=(c,cls='')=>`<div class="yr-tile ${cls}">${photo(c)}</div>`;
    const top4=r.ranked.slice(0,4);
    out.push(`<section class="yr-slide yr-cover"><p class="yr-kicker">WARDROBE REVIEW</p><h2>${r.y}</h2><p class="yr-lede">올해 내 옷장은 이랬어요</p>
      <div class="yr-big3"><div><b>${r.active}</b><span>옷</span></div><div><b>${r.days}</b><span>코디 기록한 날</span></div><div><b>${r.outfitsLive}</b><span>저장 코디</span></div></div>
      ${top4.length?`<div class="yr-strip">${top4.map(c=>tile(c)).join('')}</div><p class="yr-cap">올해 가장 많이 입은 옷${top4.length>1?` ${top4.length}벌`:''}</p>`:''}
      ${r.addedThisYear?`<p class="yr-cap">올해 새로 들인 옷 ${r.addedThisYear}벌</p>`:''}<p class="yr-swipe">옆으로 넘겨 보세요 →</p></section>`);
    const top=r.ranked.slice(0,3),n2=i=>String(i+1).padStart(2,'0');
    out.push(`<section class="yr-slide"><p class="yr-kicker">MOST WORN</p><h3>${r.byOutfit?'올해':'지금까지'} 가장 많이 입은 옷</h3>
      ${top.length?`<div class="yr-first">${tile(top[0],'big')}<div class="yr-rank"><i>01</i><div><b>${esc(nameOfItem(top[0]))}</b><span>${esc(top[0].category||'')} · ${r.score(top[0])}${unit(r)}</span></div></div></div>
      ${top.length>1?`<ol class="yr-rest">${top.slice(1).map((c,i)=>`<li>${tile(c)}<div><i>${n2(i+1)}</i><b>${esc(nameOfItem(c))}</b><span>${r.score(c)}${unit(r)}</span></div></li>`).join('')}</ol>`:''}`:'<p class="yr-empty">아직 입은 기록이 없어요.<br>코디 탭에서 \'오늘 입음\'을 눌러 기록해 보세요.</p>'}
      <p class="yr-note">${basis(r)}</p></section>`);
    const tops=r.outfitRank.slice(0,3),cover=o=>window.OFL&&OFL.coverHTML?OFL.coverHTML(o):'';
    out.push(`<section class="yr-slide"><p class="yr-kicker">MOST WORN LOOKS</p><h3>올해 가장 많이 입은 코디</h3>
      ${tops.length?`<ol class="yr-otop">${tops.map((x,i)=>`<li><i>${n2(i)}</i><div class="yr-cov">${cover(x.o)}</div><div><b>${esc(x.o.name)}</b><span>${x.n}일 입음${x.o.archived?' · 보관함':''}</span></div></li>`).join('')}</ol>`:'<p class="yr-empty">올해 입은 코디 기록이 없어요.<br>추천의 \'입었어요\'나 코디 탭 \'오늘 입음\'으로 남길 수 있어요.</p>'}</section>`);
    const total=r.colorRank.reduce((a,x)=>a+x[1],0),c0=r.colorRank[0];
    out.push(`<section class="yr-slide"><p class="yr-kicker">COLOR OF THE YEAR</p>
      ${c0?`<div class="yr-swatch" style="background:${COLOR_HEX[c0[0]]}"></div><h3>${esc(c0[0])}</h3><p class="yr-sub">입은 기록의 ${Math.round(c0[1]/total*100)}%</p>
      <ul class="yr-colors">${r.colorRank.slice(0,5).map(([k,n])=>`<li><span class="yr-dot" style="background:${COLOR_HEX[k]}"></span><b>${esc(k)}</b><span class="yr-bar"><span style="width:${Math.max(4,Math.round(n/c0[1]*100))}%"></span></span><em>${Math.round(n/total*100)}%</em></li>`).join('')}</ul>`:'<h3>올해의 색</h3><p class="yr-empty">입은 기록이 쌓이면 가장 많이 입은 색을 알려 드려요.</p>'}
      <p class="yr-note">옷마다 입은 ${unit(r)==='일'?'날 수':'횟수'}를 그 옷의 색에 더해 나눴어요.</p></section>`);
    const max=Math.max(...r.months),nowM=r.y===thisYear()?new Date().getMonth():11,best=max?r.months.indexOf(max):-1;
    out.push(`<section class="yr-slide"><p class="yr-kicker">MONTHLY</p><h3>${best>=0?`${best+1}월에 가장 많이 입었어요`:'아직 기록이 없어요'}</h3>
      <div class="yr-chart" role="img" aria-label="월별 코디 기록한 날 수: ${r.months.map((n,i)=>`${i+1}월 ${n}일`).join(', ')}">${r.months.map((n,i)=>`<div class="yr-col${i>nowM?' future':''}${i===best?' best':''}"><em>${i>nowM||!n?'':n}</em><span style="height:${max?Math.round(n/max*100):0}%"></span><i>${i+1}</i></div>`).join('')}</div>
      <p class="yr-note">달마다 코디를 기록한 날 수예요(하루에 여러 코디를 기록해도 하루).</p></section>`);
    const un=r.unworn,show=un.slice(0,9);
    out.push(`<section class="yr-slide"><p class="yr-kicker">NOT WORN</p><h3>${un.length?`올해 안 입은 옷 ${un.length}벌`:'안 입은 옷이 없어요'}</h3>
      ${un.length?`<div class="yr-grid">${show.map(c=>`<figure>${tile(c)}<figcaption>${esc(nameOfItem(c))}</figcaption></figure>`).join('')}</div>${un.length>show.length?`<p class="yr-cap">외 ${un.length-show.length}벌 · 오래전에 등록한 옷부터</p>`:''}<p class="yr-note">보관하지 않은 옷 중 올해 입은 기록(옷장 '오늘 입음'·코디 기록)이 없는 옷이에요.</p>`:`<p class="yr-empty">보관하지 않은 모든 옷을 올해 한 번 이상 입었어요.</p>`}</section>`);
    const fav=r.ranked[0];
    out.push(`<section class="yr-slide yr-end"><p class="yr-kicker">${r.y} ITEM OF THE YEAR</p>
      ${fav?`${tile(fav,'hero')}<h3>${esc(nameOfItem(fav))}</h3><p class="yr-sub">${r.score(fav)}${unit(r)} 함께했어요</p>`:'<h3>내년에는 더 많이 기록해 봐요</h3>'}
      <p class="yr-line">${un.length?`안 입은 옷 ${un.length}벌, 내년엔 꺼내 볼까요?`:'옷장을 알뜰하게 다 입은 한 해였어요.'}</p>
      <button type="button" class="yr-done" onclick="YR.close()">닫기</button></section>`);
    return out;
  }

  // ---------- 화면 ----------
  function ensure(){
    if($('yrModal'))return;
    style();
    const m=document.createElement('div');m.id='yrModal';m.className='yr-modal';m.hidden=true;m.setAttribute('role','dialog');m.setAttribute('aria-modal','true');
    m.innerHTML=`<div class="yr-top-bar"><div class="yr-prog" id="yrProg"></div><button type="button" class="yr-x" aria-label="결산 닫기" onclick="YR.close()"><svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" aria-hidden="true"><path d="M6 6 L18 18 M18 6 L6 18"/></svg></button></div><div class="yr-track" id="yrTrack"></div><div class="yr-nav"><button type="button" id="yrPrev" class="secondary" onclick="YR.go(-1)" aria-label="이전 장">‹ 이전</button><span id="yrPage" class="small muted"></span><button type="button" id="yrNext" onclick="YR.go(1)" aria-label="다음 장">다음 ›</button></div>`;
    document.body.appendChild(m);
    let t=null;$('yrTrack').addEventListener('scroll',()=>{clearTimeout(t);t=setTimeout(()=>{const tr=$('yrTrack');if(!tr.clientWidth)return;const i=Math.round(tr.scrollLeft/tr.clientWidth);if(i!==idx){idx=i;syncNav()}},60)},{passive:true});
    document.addEventListener('keydown',e=>{if($('yrModal').hidden)return;if(e.key==='Escape')close();else if(e.key==='ArrowRight')go(1);else if(e.key==='ArrowLeft')go(-1)});
  }
  function syncNav(){
    $('yrProg').innerHTML=Array.from({length:count},(_,i)=>`<span class="${i<=idx?'on':''}"></span>`).join('');
    const p2=n=>String(n).padStart(2,'0');$('yrPage').textContent=`${p2(idx+1)} / ${p2(count)}`;
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

  // v7(29CM풍): 흰 바탕·검정, 영문 소제목, 아주 가는 큰 숫자, 사진은 회색 칸(흰 배경은 곱하기로 녹임), 사진 위에 글자 없음
  const CSS=`
.yr-open{width:100%;background:#111;color:#fff;border-radius:0;min-height:48px}
.yr-lock,.yr-lock body{overflow:hidden}
.yr-modal{position:fixed;inset:0;z-index:30;background:#fff;color:#111;display:flex;flex-direction:column;padding:calc(8px + env(safe-area-inset-top)) 0 calc(14px + env(safe-area-inset-bottom))}
.yr-modal[hidden]{display:none}
.yr-top-bar{display:flex;align-items:center;gap:12px;padding:0 8px 6px 20px;max-width:560px;width:100%;margin:0 auto;box-sizing:border-box}
.yr-prog{flex:1;display:flex;gap:4px}.yr-prog span{flex:1;height:2px;background:#e4e4e4}.yr-prog span.on{background:#111}
.yr-x{flex:none;width:44px;height:44px;min-height:44px;padding:0;border-radius:0;background:transparent;color:#111;font-size:18px;font-weight:300;box-shadow:none}
.yr-track{flex:1;min-height:0;display:flex;overflow-x:auto;overflow-y:hidden;scroll-snap-type:x mandatory;overscroll-behavior:contain;scrollbar-width:none;-webkit-overflow-scrolling:touch;max-width:560px;width:100%;margin:0 auto}
.yr-track::-webkit-scrollbar{display:none}
.yr-slide{flex:0 0 100%;scroll-snap-align:center;scroll-snap-stop:always;box-sizing:border-box;margin:0;padding:18px 20px 8px;overflow-y:auto;display:flex;flex-direction:column}
.yr-slide>*{flex:none}
.yr-kicker{margin:0 0 6px;font-size:11px;font-weight:600;letter-spacing:2.2px;color:#767676}
.yr-slide h3{margin:0 0 16px;font-size:22px;font-weight:300;letter-spacing:-.5px;line-height:1.3}
.yr-sub{margin:-10px 0 14px;color:#767676;font-size:13px}
.yr-cap{margin:8px 0 0;color:#767676;font-size:11px}
.yr-note{margin:16px 0 0;color:#767676;font-size:11px;line-height:1.6}
.yr-empty{border-top:1px solid #111;border-bottom:1px solid #ebebeb;padding:22px 0;color:#767676;font-size:13px;line-height:1.7;margin:0}
.yr-tile{position:relative;overflow:hidden;background:#f4f4f2;aspect-ratio:4/5;min-width:0}
.yr-tile img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;mix-blend-mode:multiply;display:block;border-radius:0;max-height:none;background:transparent}
.yr-cover{padding-top:30px}
.yr-cover h2{margin:4px 0 0;font-size:104px;line-height:1;font-weight:200;letter-spacing:-6px}
.yr-lede{margin:12px 0 0;font-size:20px;font-weight:300;letter-spacing:-.4px}
.yr-big3{margin-top:28px;display:grid;grid-template-columns:repeat(3,minmax(0,1fr));border-top:1px solid #111;border-bottom:1px solid #ebebeb}
.yr-big3 div{padding:14px 0 14px 12px;display:flex;flex-direction:column;gap:4px;box-shadow:inset 1px 0 0 #ebebeb;min-width:0}
.yr-big3 div:first-child{padding-left:0;box-shadow:none}
.yr-big3 b{font-size:30px;font-weight:300;letter-spacing:-1px}.yr-big3 span{font-size:11px;color:#767676}
.yr-strip{margin-top:24px;display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:2px}
.yr-swipe{margin:auto 0 0;padding-top:20px;font-size:11px;letter-spacing:.4px;color:#767676}
.yr-first .yr-tile.big{aspect-ratio:auto;height:min(46vh,300px)}
.yr-rank{display:flex;align-items:baseline;gap:12px;margin-top:12px}
.yr-rank i,.yr-rest i,.yr-otop li>i{font-style:normal;font-weight:200;letter-spacing:-1px;color:#111}
.yr-rank i{font-size:28px}
.yr-rank div{min-width:0;display:flex;flex-direction:column;gap:2px}
.yr-rank b{font-size:15px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.yr-rank span,.yr-rest span,.yr-otop span{font-size:12px;color:#767676}
.yr-rest{list-style:none;margin:18px 0 0;padding:16px 0 0;border-top:1px solid #ebebeb;display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}
.yr-rest li{display:flex;gap:10px;min-width:0}
.yr-rest .yr-tile{flex:none;width:64px}
.yr-rest li>div:last-child{min-width:0;display:flex;flex-direction:column;gap:1px}
.yr-rest i{font-size:18px}
.yr-rest b{font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.yr-otop{list-style:none;margin:0;padding:0;border-top:1px solid #111}
.yr-otop li{display:flex;align-items:center;gap:14px;padding:12px 0;border-bottom:1px solid #ebebeb}
.yr-otop li>i{flex:none;width:30px;font-size:22px}
.yr-otop li>div:last-child{min-width:0;flex:1;display:flex;flex-direction:column;gap:2px}
.yr-otop b{font-size:15px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.yr-cov{flex:none;width:96px}.yr-cov .ofl-cover{display:grid}
.yr-swatch{width:96px;height:96px;border-radius:50%;margin:10px 0 18px;box-shadow:inset 0 0 0 1px #0000001a}
.yr-colors{list-style:none;margin:0;padding:0;border-top:1px solid #111;display:grid}
.yr-colors li{display:grid;grid-template-columns:16px 84px 1fr 40px;align-items:center;gap:10px;font-size:13px;padding:11px 0;border-bottom:1px solid #ebebeb}
.yr-dot{width:14px;height:14px;border-radius:50%;box-shadow:inset 0 0 0 1px #00000026}
.yr-colors b{font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.yr-bar{height:2px;background:#ebebeb}.yr-bar span{display:block;height:100%;background:#111}
.yr-colors em{font-style:normal;text-align:right;color:#767676;font-size:12px}
.yr-chart{display:grid;grid-template-columns:repeat(12,minmax(0,1fr));gap:5px;align-items:end;height:230px;border-top:1px solid #111;border-bottom:1px solid #ebebeb;padding:16px 0 8px}
.yr-col{display:flex;flex-direction:column;align-items:center;justify-content:flex-end;height:100%;min-width:0}
.yr-col span{width:100%;max-width:18px;background:#d6d6d6;min-height:1px}
.yr-col.best span{background:#111}
.yr-col em{font-style:normal;font-size:10px;color:#767676;margin-bottom:4px}
.yr-col.best em{color:#111;font-weight:600}
.yr-col i{font-style:normal;font-size:10px;color:#767676;margin-top:6px}
.yr-col.future span{background:#f0f0f0}.yr-col.future i{color:#bdbdbd}
.yr-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));column-gap:6px;row-gap:12px}
.yr-grid figure{margin:0;min-width:0}
.yr-grid figcaption{font-size:11px;padding-top:6px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#111}
.yr-end{align-items:center;text-align:center}
.yr-end .yr-tile.hero{width:min(64vw,240px);margin:10px 0 18px}
.yr-end h3{margin-bottom:10px;font-weight:400}
.yr-line{margin:4px 0 22px;font-size:14px;font-weight:500}
.yr-done{min-width:160px;border-radius:0;min-height:48px;background:#111;color:#fff}
.yr-nav{display:flex;align-items:center;gap:8px;padding:10px 20px 0;max-width:560px;width:100%;margin:0 auto;box-sizing:border-box}
.yr-nav span{flex:1;order:-1;text-align:left;font-size:11px;letter-spacing:1px}
.yr-nav button{flex:none;border-radius:0;min-height:48px;padding:0 22px}
.yr-nav #yrPrev{background:#fff;color:#111;box-shadow:inset 0 0 0 1px #111;padding:0 16px}
.yr-nav #yrNext{background:#111;color:#fff}
.yr-nav button:disabled{opacity:.3}
`;
  window.YR={open,close,go,compute,state:()=>({open:!!$('yrModal')&&!$('yrModal').hidden,idx,count})};
  style();label();
})();
