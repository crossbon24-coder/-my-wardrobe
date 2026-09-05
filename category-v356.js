/* Wardrobe v3.5.2 - on-device category/type suggestion. No network calls. */
(function(){
  function median(a){a.sort((x,y)=>x-y);return a[Math.floor(a.length/2)]||240}
  function shapeEstimate(blob,colorName){
    return new Promise((resolve,reject)=>{
      const im=new Image(),u=URL.createObjectURL(blob),W=96,H=96;
      im.onload=()=>{
        const c=document.createElement('canvas');c.width=W;c.height=H;
        const ctx=c.getContext('2d');ctx.drawImage(im,0,0,W,H);
        const d=ctx.getImageData(0,0,W,H).data;
        const edge=[[],[],[]];
        for(let y=0;y<H;y+=3)for(let x=0;x<W;x+=3){
          if(x<9||x>W-10||y<9||y>H-10){let i=(y*W+x)*4;edge[0].push(d[i]);edge[1].push(d[i+1]);edge[2].push(d[i+2]);}
        }
        const bg=[median(edge[0]),median(edge[1]),median(edge[2])];
        const mask=new Uint8Array(W*H);let minX=W,maxX=0,minY=H,maxY=0,count=0;
        for(let y=1;y<H-1;y++)for(let x=1;x<W-1;x++){
          let i=(y*W+x)*4,r=d[i],g=d[i+1],b=d[i+2];
          let dist=Math.hypot(r-bg[0],g-bg[1],b-bg[2]);
          if(dist>34 && !(r>248&&g>248&&b>248)){
            mask[y*W+x]=1;count++;if(x<minX)minX=x;if(x>maxX)maxX=x;if(y<minY)minY=y;if(y>maxY)maxY=y;
          }
        }
        URL.revokeObjectURL(u);
        if(count<120)return resolve({category:'상의',type:'',confidence:.30,reason:'형태 인식이 어려움'});
        const bw=maxX-minX+1,bh=maxY-minY+1,ratio=bw/bh,hFrac=bh/H,wFrac=bw/W;
        function rowOcc(y0,y1,x0=minX,x1=maxX){let n=0,t=0;for(let y=Math.max(minY,Math.floor(y0));y<=Math.min(maxY,Math.floor(y1));y++)for(let x=Math.max(minX,Math.floor(x0));x<=Math.min(maxX,Math.floor(x1));x++){t++;n+=mask[y*W+x]}return t?n/t:0}
        const lowerY=minY+bh*.62;
        const leftOcc=rowOcc(lowerY,maxY,minX,minX+bw*.38);
        const centerOcc=rowOcc(lowerY,maxY,minX+bw*.42,minX+bw*.58);
        const rightOcc=rowOcc(lowerY,maxY,minX+bw*.62,maxX);
        const legGap=(leftOcc>0.18&&rightOcc>0.18&&centerOcc<Math.min(leftOcc,rightOcc)*.55);
        const fill=count/(bw*bh);
        const topOcc=rowOcc(minY,minY+bh*.22),midOcc=rowOcc(minY+bh*.35,minY+bh*.62),botOcc=rowOcc(minY+bh*.75,maxY);
        let category='상의',type='',confidence=.48,reason='상의형 실루엣';
        if(ratio>1.45 && hFrac<.72){
          category='신발';type=(bh/bw>.52)?'부츠':'스니커즈';confidence=.86;reason='가로로 긴 신발형 실루엣';
        }else if((bh/bw>1.28 && legGap) || (bh/bw>1.65 && centerOcc<.14)){
          category='하의';type=(colorName==='블루'||colorName==='네이비')?'데님':'';confidence=.86;reason='하단 두 다리 형태 감지';
        }else if(ratio>.78 && ratio<1.48 && hFrac<.78 && fill>.42 && botOcc>.35 && !legGap){
          category='가방';type='';confidence=.68;reason='사각형에 가까운 밀집 실루엣';
        }else if(bh/bw>1.15 && topOcc>midOcc*.8 && botOcc<midOcc*.85){
          category='상의';type='';confidence=.58;reason='상체 의류형 실루엣';
        }else if(bh/bw>1.2 && fill>.48 && botOcc>midOcc*.7){
          category='아우터';type='';confidence=.55;reason='길고 밀집된 상체 실루엣';
        }
        resolve({category,type,confidence,reason,metrics:{ratio,hFrac,wFrac,fill,legGap}});
      };
      im.onerror=reject;im.src=u;
    });
  }

  const oldRenderQueue=renderQueue;
  window.shapeEstimate=shapeEstimate;
  document.getElementById('photo').onchange=async e=>{
    batch=[];
    for(const f of e.target.files){
      const image=await f2b(f);
      const est=await estimateColor(image);
      const shape=await shapeEstimate(image,est.name);
      batch.push({image,category:shape.category,type:shape.type,color:est.name,autoColor:est.name,autoRgb:est.rgb,autoCategory:shape.category,autoType:shape.type,autoConfidence:shape.confidence,autoReason:shape.reason,season:'사계절',formality:2,memo:''});
    }
    renderQueue();
  };

  renderQueue=function(){
    $('batchBtn').style.display=batch.length?'block':'none';
    $('queue').innerHTML=batch.map((x,i)=>`<div class="q"><img src="${url(x.image)}"><div><div class="autoline">형태 추천: <b>${x.autoCategory||'상의'}${x.autoType?' · '+x.autoType:''}</b> <span class="muted">(${Math.round((x.autoConfidence||0)*100)}%)</span></div><div class="small" style="margin-bottom:4px">${x.autoReason||''}</div><div class="quick">${C.map(c=>`<button class="${x.category===c?'on':''}" onclick="qset(${i},'category','${c}')">${c}</button>`).join('')}</div><div class="autoline"><span class="dot" style="background:rgb(${(x.autoRgb||[160,160,160]).join(',')})"></span>색상 추천: <b>${x.autoColor||'기타'}</b><button class="ghost" onclick="reestimateAll(${i})">다시 추정</button></div><select onchange="qset(${i},'type',this.value)"><option value="">세부 종류</option>${opts(T[x.category],x.type)}</select><div class="row"><select onchange="qset(${i},'color',this.value)">${opts(COL,x.color)}</select><select onchange="qset(${i},'season',this.value)">${opts(SEA,x.season)}</select></div><select onchange="qset(${i},'formality',+this.value)">${opts(FOR,x.formality)}</select><input placeholder="메모" value="${x.memo||''}" onchange="qset(${i},'memo',this.value)"></div></div>`).join('');
  };

  window.reestimateAll=async function(i){
    const est=await estimateColor(batch[i].image);
    const shape=await shapeEstimate(batch[i].image,est.name);
    Object.assign(batch[i],{color:est.name,autoColor:est.name,autoRgb:est.rgb,category:shape.category,type:shape.type,autoCategory:shape.category,autoType:shape.type,autoConfidence:shape.confidence,autoReason:shape.reason});
    renderQueue();
  };
})();