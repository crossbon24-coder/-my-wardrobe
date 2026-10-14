/* 코디 추천 점수와 조합 고르기(v4.9에서 index.html에서 옮김). index.html 전역(clothes, formalityLevel, localDate)을 부를 때 쓴다.
 * 불러올 때는 함수·상수만 만들고 아무것도 실행하지 않는다(index.html 본문보다 먼저 불러온다). */
const neutral=['검정','흰색','아이보리/크림','네이비','회색','베이지','브라운'],NEUTRAL=new Set(neutral),COLOR_PAIRS=[['카키/올리브','네이비'],['카키/올리브','블루'],['카키/올리브','아이보리/크림'],['블루','브라운'],['블루','베이지']];
// 같은 무채색끼리(올블랙·톤온톤)는 무채색 조합과 같은 3점, 같은 유채색끼리는 2점
function colorScore(a,b){if(!a||!b)return 1;if(a===b)return NEUTRAL.has(a)?3:2;if(NEUTRAL.has(a)||NEUTRAL.has(b))return 3;return COLOR_PAIRS.some(p=>p.includes(a)&&p.includes(b))?3:1}function weatherScore(c,w){
  if(w==='hot')return c.season==='겨울'?-8:c.season==='여름'?3:c.season==='봄/가을'?-2:1;
  if(w==='cold')return c.season==='여름'?-8:c.season==='겨울'?3:c.season==='봄/가을'?1:1;
  return c.season==='사계절'?2:c.season==='봄/가을'?2:0;
}
// 같은 조합 안에서 격식이 다르면 1점 뺀다(데이트처럼 격식을 가리지 않는 목적에서 정장 바지+샌들 같은 조합이 앞에 오지 않게)
const fitScore=(a,b)=>formalityLevel(a.formality)===formalityLevel(b.formality)?0:-1;
// 세부종류 힌트: 데이트·출근이면 셔츠·니트·폴로·슬랙스·치노·블레이저·코트·로퍼·구두·토트·브리프케이스는 조금 올리고, 후드·맨투맨·쇼츠·카고·샌들은 조금 내린다(주말은 그대로)
const DRESSY=new Set(['셔츠','니트','폴로','슬랙스','치노','블레이저','코트','로퍼','구두','토트','브리프케이스']),SPORTY=new Set(['후드','맨투맨','쇼츠','카고','샌들']);
const typeHint=(c,t)=>t<2?0:(DRESSY.has(c.type)?1:SPORTY.has(c.type)?-1:0)*(t===2?.5:1);
function itemScore(c,t,w){return 5-Math.abs(formalityLevel(c.formality)-t)*2+typeHint(c,t)+weatherScore(c,w)+(c.lastWorn?Math.max(0,Math.min(2,(Date.now()-c.lastWorn)/604800000)):2)}
// 서로 다른 조합을 점수 순으로 고른다. 옷마다 점수를 한 번만 계산하고, 신발은 하의마다 한 번만 골라 쌍 점수에 쓴다(상의×하의 + 하의×신발).
// avoid={tops,bottoms,items}: 앞에서 보여 준 옷. 그 옷이 든 쌍·그 아우터·신발·가방을 먼저 건너뛰고, 모자라면 다시 쓴다
// 추천 다양성(v4.8.6): 점수가 같은 조합이 수천 개라 등록 순서대로 줄을 서 첫 화면이 늘 같았다. 날짜로 정해지는 작은 흔들기(옷마다 0~REC_JITTER점)로
// 동점 순서를 날마다 바꾼다(같은 날은 같은 결과라 검사로 확인할 수 있다). 옷당 0.15점 이하라 종류·격식·색 가점(0.5점 이상)은 뒤집지 않는다. REC_SEED는 검사용(비우면 오늘 날짜)
let REC_JITTER=0.15,REC_SEED=null;const ACC_BAND=3,ACC_FIT=3,PAIR_FIT=2,PEN_CAP=1.5; // 신발·아우터·가방 후보 범위. 실데이터 263벌 시뮬레이션: 2점은 더운 주말에 샌들 2켤레만 돌았고, 4점은 주말에 구두가 끼었다
function recJitter(id){if(!REC_JITTER)return 0;const seed=REC_SEED??Number(recDay().replace(/-/g,''));let h=2166136261^seed;for(const ch of String(id))h=Math.imul(h^ch.charCodeAt(0),16777619);return ((h>>>0)%1000)/1000*REC_JITTER}
// opts.pen: 지난날 본 것의 감점(recOpts), opts.novelty: 마지막 한 조합을 덜 입고 덜 본 옷으로('새로운 시도')
function recommendCombos(t,w,seen=new Set(),count=3,avoid={},opts={}){
  const pen=opts.pen||null;
  const act=clothes.filter(c=>!c.archived),by=cat=>act.filter(c=>c.category===cat);
  const Tp=by('상의'),Bp=by('하의'),Sp=by('신발'),Op=by('아우터'),Gp=by('가방');
  if(!Tp.length||!Bp.length)return [];
  // S: 감점 전 점수(격식·날씨·종류·착용일 + 날짜 흔들기). 지난날 본 감점(pen)은 따로 빼고 상한을 둔다:
  // 상의·하의 조합은 조합+옷 감점 합 PEN_CAP(1.5)점까지, 신발·아우터·가방은 1점까지. 조합 격식 맞춤(PAIR_FIT 2점)을 감점이 뒤집지 못한다
  const memo=new Map(),S=c=>{let v=memo.get(c);if(v===undefined){v=itemScore(c,t,w)+recJitter(c.id);memo.set(c,v)}return v},PI=c=>pen?pen.item(c.id):0;
  const avT=avoid.tops||new Set(),avB=avoid.bottoms||new Set(),avI=avoid.items||new Set();
  // 신발·아우터·가방 고르기: 이 조합에 가장 잘 맞는 것에서 ACC_BAND(3)점 안의 후보만 쓴다. 조합의 상의·하의와 격식이 다르면 ACC_FIT(3)점씩 깎아
  // 반바지 조합에 구두, 정장 조합에 샌들 같은 것이 범위에 들지 않게 한다(목적 격식만 보면 출근 반바지 조합에도 구두가 붙었다).
  // 앞에서 보여 준 것(exclude=avoid.items)과 이 화면에서 쓴 것(used)은 건너뛰고, 범위 안을 다 보여 줬으면 그 범위만 처음부터 다시 돈다
  // (예전에는 전체 1등으로 돌아가 신발 한 켤레·가방 하나로 몰렸다). 이 화면에서 범위 안 후보를 다 썼으면(포멀 가방이 하나뿐인 출근 등) 두 배 범위의 차선을 쓴다.
  // 주의: exclude(avoid.items)는 범위를 다 돌면 지워지므로 '반드시 뺄 옷' 목록으로 쓰지 않는다. extra는 추가 점수(추운 날 아우터의 날씨)
  const bestFor=(list,refs,exclude,used,extra,noPen)=>{
    if(!list.length)return null;
    const sc=list.map(x=>({x,v:S(x)+refs.reduce((a,r)=>a+colorScore(x.color,r.color),0)/refs.length+refs.reduce((a,r)=>a+fitScore(x,r),0)*ACC_FIT+(extra?extra(x):0)-(noPen?0:Math.min(1,PI(x))),l:x.lastWorn||0}));
    // 기준 옷(신발·가방은 하의, 아우터는 상의)과 격식이 같은 후보가 있으면 그 안에서 고른다(반바지에 구두, 슬랙스에 샌들 방지)
    const lv=refs.length?formalityLevel(refs[0].formality):null,same=lv===null?[]:sc.filter(q=>formalityLevel(q.x.formality)===lv),base=same.length?same:sc;
    const top=Math.max(...base.map(q=>q.v)),band=base.filter(q=>q.v>=top-ACC_BAND),free=q=>!(used&&used.has(q.x.id)),ok=q=>free(q)&&!(exclude&&exclude.has(q.x.id));
    let pool=band.filter(ok);
    if(!pool.length&&exclude){for(const q of band)exclude.delete(q.x.id);pool=band.filter(ok)}
    if(!pool.length)pool=sc.filter(q=>q.v>=top-ACC_BAND*2&&free(q));
    if(!pool.length)pool=band;
    pool.sort((a,b)=>b.v-a.v||a.l-b.l);return {item:pool[0].x,score:pool[0].v};
  };
  const shoeFor=new Map(Bp.map(b=>[b,bestFor(Sp,[b],null,null,null,true)])),pairs=[];
  Tp.forEach((a,ia)=>Bp.forEach((b,ib)=>{const sh=shoeFor.get(b),raw=S(a)+S(b)+colorScore(a.color,b.color)+fitScore(a,b)*PAIR_FIT+(sh?sh.score:0),cut=pen?Math.min(PEN_CAP,pen.pair(a.id+'|'+b.id)+PI(a)+PI(b)):0;
    pairs.push({a,b,ia,ib,sh:sh&&sh.item,raw,score:raw-cut,worn:(a.lastWorn||0)+(b.lastWorn||0)})}));
  pairs.sort((x,y)=>y.score-x.score||x.worn-y.worn||x.ia-y.ia||x.ib-y.ib);
  const needOuter=w==='cold'||(t>=3&&w!=='hot'),wantBag=t>=3,out=[],usedT=new Set(),usedB=new Set(),usedI=new Set();
  const take=(p,kind)=>{
    const key=p.a.id+'|'+p.b.id;usedT.add(p.a.id);usedB.add(p.b.id);
    const o=needOuter&&Op.length?bestFor(Op,[p.a],avI,usedI,w==='cold'?x=>weatherScore(x,w):undefined):null,sh=Sp.length?bestFor(Sp,[p.b,p.a],avI,usedI):null,g=wantBag&&Gp.length?bestFor(Gp,[p.b],avI,usedI):null;
    for(const x of [o,sh,g])if(x)usedI.add(x.item.id);
    out.push({key,score:p.score,kind:kind||'',slots:{outer:o?o.item.id:null,top:p.a.id,bottom:p.b.id,shoes:sh?sh.item.id:null,bag:g?g.item.id:null}});
  };
  const free=(p,strict)=>{const key=p.a.id+'|'+p.b.id;return !seen.has(key)&&!usedT.has(p.a.id)&&!usedB.has(p.b.id)&&!(strict&&(avT.has(p.a.id)||avB.has(p.b.id)))};
  const fill=n=>{for(const strict of [true,false]){for(const p of pairs){if(out.length>=n)return;if(free(p,strict))take(p)}}};
  const main=opts.novelty&&count>=3?count-1:count;
  fill(main);
  // 새로운 시도: 감점 전 1등에서 NOVEL_BAND점 안의 조합 중, 최근에 덜 입고 덜 본 옷으로. 계절이 안 맞는 옷(날씨 점수 0 이하), 데이트·출근의 운동복 종류,
  // 출근의 캐주얼 옷, 상의·하의 격식이 다른 조합은 뺀다(감점 후 점수로 범위를 잡았더니 며칠 뒤 출근에 티셔츠·쇼츠·샌들, 보통 날씨에 여름 옷이 나왔다).
  // 덜 입은 정도는 최근 14일 착용(2점) + 지난날 본 감점×3 + 누적 착용(10회까지 0.1점씩). 일반 다음 조합보다 실제로 덜 입었을 때만 '새로운 시도'라고 표시한다
  if(out.length===main&&main<count&&pairs.length){
    const rawBest=Math.max(...pairs.map(p=>p.raw)),okItem=x=>weatherScore(x,w)>0&&!(t>=2&&typeHint(x,t)<0)&&!(t===3&&formalityLevel(x.formality)!==3);
    const fam=x=>(x.lastWorn&&Date.now()-x.lastWorn<14*864e5?2:0)+PI(x)*3+Math.min(x.wearCount||0,10)*.1,famP=p=>fam(p.a)+fam(p.b);
    const cand=pairs.filter(p=>p.raw>=rawBest-NOVEL_BAND&&fitScore(p.a,p.b)===0&&okItem(p.a)&&okItem(p.b)&&free(p,true)).sort((x,y)=>famP(x)-famP(y)||y.score-x.score);
    const normal=pairs.find(p=>free(p,true));
    if(cand.length)take(cand[0],!normal||famP(cand[0])<famP(normal)?'new':'');
  }
  fill(count);
  return out;
}

// ---------- 본 조합 기억(v4.9, 기기 안 localStorage, 최근 14일) ----------
// 날짜 → '목적|날씨' → {keys:[상의|하의], items:[옷 id], last:[마지막 화면]}. 지워져도 괜찮은 정보라 백업에 넣지 않는다.
// 지난날 본 조합·옷은 다음 날부터 조금씩 뒤로 미루고(하루 지날 때마다 약해짐), 오늘 본 것은 이번 실행의 '다른 추천 보기' 회피 목록이 맡는다.
// 같은 날 추천 탭을 다시 열면 마지막 화면을 그대로 보여 준다(restoreRecommendation)
const REC_MEM_KEY='wardrobe.recMemory',REC_MEM_DAYS=14,NOVEL_BAND=5;
// 추천의 하루는 새벽 4시에 바뀐다(밤에 본 내일 옷 추천이 아침에도 그대로 이어지게)
const recDay=()=>localDate(new Date(Date.now()-4*3600e3));
const dayGap=(a,b)=>Math.round((new Date(b+'T00:00:00')-new Date(a+'T00:00:00'))/86400000);
// 기억 읽기: 형식이 어긋난 항목은 버린다(손상된 항목 하나로 추천이 멈추지 않게)
function recMemLoad(){
  let m=null;try{m=JSON.parse(localStorage.getItem(REC_MEM_KEY)||'null')}catch{}
  const out={v:1,days:{}},ids=a=>Array.isArray(a)?a.filter(x=>typeof x==='string'||typeof x==='number'):[];
  if(!m||m.v!==1||!m.days||typeof m.days!=='object'||Array.isArray(m.days))return out;
  for(const [day,byKey] of Object.entries(m.days)){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(day)||!byKey||typeof byKey!=='object'||Array.isArray(byKey))continue;
    const d={};for(const [k,e] of Object.entries(byKey)){if(!e||typeof e!=='object')continue;d[k]={keys:ids(e.keys).map(String),items:ids(e.items),last:Array.isArray(e.last)?e.last.filter(c=>c&&typeof c==='object'&&c.slots&&typeof c.slots==='object'):[]}}
    out.days[day]=d;
  }
  return out;
}
// 오늘 기준 지난 14일만 남긴다(기기 시계를 앞으로 돌려 생긴 미래 날짜가 오늘 기록을 밀어내지 않게)
function recMemSave(m){try{const today=recDay(),d={};for(const k of Object.keys(m.days)){const g=dayGap(k,today);if(g>=0&&g<REC_MEM_DAYS)d[k]=m.days[k]}localStorage.setItem(REC_MEM_KEY,JSON.stringify({v:1,days:d}))}catch{}}
function recMemRecord(t,w,combos){
  const m=recMemLoad(),day=recDay(),k=t+'|'+w,byKey=m.days[day]=m.days[day]||{},e=byKey[k]=byKey[k]||{keys:[],items:[],last:[]};
  for(const c of combos){if(!e.keys.includes(c.key))e.keys.push(c.key);for(const id of Object.values(c.slots))if(id!==null&&id!==undefined&&!e.items.includes(id))e.items.push(id)}
  const at=Date.now();e.keys=e.keys.slice(-300);e.items=e.items.slice(-600);e.last=combos.map(c=>({key:c.key,score:c.score,kind:c.kind||'',at,slots:{...c.slots}}));recMemSave(m);
}
function recMemToday(t,w){const e=recMemLoad().days[recDay()];return e&&e[t+'|'+w]||null}
// 지난날 본 것의 감점: 어제 본 조합 2점·옷 0.6점, 하루 지날 때마다 0.6배. 다른 목적·날씨에서 본 것은 절반. 상한 조합 4점·옷 2점
// (조합에 실제로 빼는 양은 recommendCombos에서 PEN_CAP·1점으로 한 번 더 묶는다)
function recMemPenalty(t,w){
  const m=recMemLoad(),today=recDay(),k=t+'|'+w,pair=new Map(),item=new Map();
  for(const [day,byKey] of Object.entries(m.days)){
    const age=dayGap(day,today);if(!(age>=1))continue;
    for(const [kk,e] of Object.entries(byKey||{})){
      const f=Math.pow(0.6,age-1)*(kk===k?1:.5);
      for(const key of e.keys||[])pair.set(key,(pair.get(key)||0)+2*f);
      for(const id of e.items||[])item.set(id,(item.get(id)||0)+.6*f);
    }
  }
  return {pair:key=>Math.min(4,pair.get(key)||0),item:id=>Math.min(2,item.get(id)||0)};
}
function recOpts(t,w){try{return {pen:recMemPenalty(t,w)}}catch(e){console.warn('추천 기억을 읽지 못해 지웁니다',e);try{localStorage.removeItem(REC_MEM_KEY)}catch{}return {}}}
// 출근 추천에 쓸 포멀 옷이 모자라면 안내 문구(없으면 빈 글)
function formalShortage(){
  const n=cat=>clothes.filter(c=>!c.archived&&c.category===cat&&formalityLevel(c.formality)===3).length,ft=n('상의'),fb=n('하의');
  return ft<3||fb<3?`출근용 포멀 옷이 상의 ${ft}벌·하의 ${fb}벌뿐이라 같은 옷이 자주 나옵니다. 출근에 입는 옷은 옷 수정 창에서 격식을 '포멀'로 바꿔 주세요.`:'';
}
