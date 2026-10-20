/* bg-remove.js — 사진 배경 지우기 (Claude Code, v5.3)
   기기 안에서만 처리한다(사진을 보내지 않음). 무료 모델 U²-Netp(Apache-2.0, rembg가 만든 ONNX, models/u2netp.onnx 4.6MB, models/README.md)를
   onnxruntime-web 1.30.0(버전 고정, 무결성 해시)으로 한 스레드로 돌린다(GitHub Pages는 여러 스레드에 필요한 헤더를 못 단다).
   처음 누를 때 라이브러리·실행 파일(약 14MB, jsDelivr)과 모델을 받고, 그다음부터는 브라우저 사본을 쓴다.
   BGR.remove(canvas, say) → {canvas: 배경을 흰색으로 채운 새 캔버스, box: 옷 둘레 {x,y,w,h} 또는 null}. 실패하면 오류를 던진다.
   photo-edit.js가 부른다. index.html의 loadScript·SRI를 쓴다. */
(function(){
  const ORT='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/ort.wasm.min.js',ORT_DIR='https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/';
  const MODEL='./models/u2netp.onnx',S=320,MEAN=[.485,.456,.406],STD=[.229,.224,.225];
  let session=null,loading=null;
  const HASH='sha384-Bw6URI+Gvoadw0do7/QrSHUC9D1vCYYK5OSqChFyhyV5mzPL4oe2rOAFljAnS8Sq';
  const supported=()=>typeof WebAssembly==='object'&&typeof loadScript==='function';
  function load(say){
    if(session)return Promise.resolve(session);
    if(!loading)loading=(async()=>{
      say('배경 지우기 도구를 받는 중… (처음 한 번, 약 19MB)');
      if(typeof SRI==='object')SRI[ORT]=HASH; // index.html 본문보다 먼저 읽히므로 쓸 때 넣는다
      await loadScript(ORT);
      const ort=window.ort;if(!ort)throw new Error('배경 지우기 도구를 불러오지 못했습니다');
      ort.env.wasm.numThreads=1;ort.env.wasm.wasmPaths=ORT_DIR;
      session=await ort.InferenceSession.create(MODEL,{executionProviders:['wasm']});return session;
    })().catch(e=>{loading=null;throw e});
    return loading;
  }
  // 긴 변을 320에 맞춰 왼쪽 위에 놓고 나머지는 0으로 채운다(모델 설정의 keep_aspect_ratio·pad)
  function input(src){
    const sc=S/Math.max(src.width,src.height),w=Math.max(1,Math.round(src.width*sc)),h=Math.max(1,Math.round(src.height*sc));
    const c=document.createElement('canvas');c.width=S;c.height=S;const x=c.getContext('2d',{willReadFrequently:true});x.drawImage(src,0,0,w,h);
    const px=x.getImageData(0,0,S,S).data,t=new Float32Array(3*S*S);
    for(let y=0;y<h;y++)for(let xx=0;xx<w;xx++){const i=(y*S+xx),p=i*4;for(let k=0;k<3;k++)t[k*S*S+i]=(px[p+k]/255-MEAN[k])/STD[k]}
    c.width=c.height=0;return {t,w,h};
  }
  async function remove(src,say=()=>{}){
    const s=await load(say);say('배경을 지우는 중…');
    const {t,w,h}=input(src),ort=window.ort;
    const out=await s.run({[s.inputNames[0]]:new ort.Tensor('float32',t,[1,3,S,S])});
    const d=out[s.outputNames[0]].data;
    // 마스크를 0~1로(실수면 최소·최대로 펼치고, 0~255 정수면 나눈다)
    let mi=Infinity,ma=-Infinity;const isInt=!(d instanceof Float32Array);
    if(!isInt)for(let y=0;y<h;y++)for(let x=0;x<w;x++){const v=d[y*S+x];if(v<mi)mi=v;if(v>ma)ma=v}
    const m=document.createElement('canvas');m.width=w;m.height=h;const mx=m.getContext('2d'),md=mx.createImageData(w,h);
    let bx0=w,by0=h,bx1=-1,by1=-1;
    for(let y=0;y<h;y++)for(let x=0;x<w;x++){
      const raw=d[y*S+x],v=isInt?raw/255:(ma>mi?(raw-mi)/(ma-mi):0),a=Math.min(1,Math.max(0,(v-.15)/.7)),p=(y*w+x)*4;
      md.data[p]=md.data[p+1]=md.data[p+2]=0;md.data[p+3]=Math.round(a*255);
      if(v>.5){if(x<bx0)bx0=x;if(y<by0)by0=y;if(x>bx1)bx1=x;if(y>by1)by1=y}
    }
    mx.putImageData(md,0,0);
    // 원래 크기로 늘린 마스크로 옷만 남기고 흰 바탕 위에 올린다
    const W=src.width,H=src.height,cut=document.createElement('canvas');cut.width=W;cut.height=H;const cx=cut.getContext('2d');
    cx.drawImage(src,0,0);cx.globalCompositeOperation='destination-in';cx.imageSmoothingEnabled=true;cx.drawImage(m,0,0,W,H);
    const res=document.createElement('canvas');res.width=W;res.height=H;const rx=res.getContext('2d');rx.fillStyle='#fff';rx.fillRect(0,0,W,H);rx.drawImage(cut,0,0);
    cut.width=cut.height=0;m.width=m.height=0;
    const k=W/w,box=bx1<0||(bx1-bx0+1)*(by1-by0+1)<w*h*.01?null:{x:Math.floor(bx0*k),y:Math.floor(by0*(H/h)),w:Math.ceil((bx1-bx0+1)*k),h:Math.ceil((by1-by0+1)*(H/h))};
    return {canvas:res,box};
  }
  window.BGR={supported,remove};
})();
