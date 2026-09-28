/* 오프라인에서도 홈 화면 앱이 열리게 하는 서비스워커.
   - 늘 네트워크를 먼저 쓴다(새 버전이 바로 반영됨). 네트워크가 안 될 때만 저장해 둔 사본을 쓴다.
   - 앱 화면(./, index.html)은 신호가 약해 4초 안에 오지 않으면 저장된 화면을 먼저 보여 주고, 도착한 새 화면은 다음을 위해 저장한다.
     단 업데이트·강제 새로고침으로 연 화면은 새 화면을 기다린다.
   - 사본의 키는 경로 + 버전(v) 값. t·refresh 같은 일회용 값은 뺀다. 버전이 다른 스크립트끼리 섞이지 않게 같은 v의 사본만 쓴다.
   - version.json(업데이트 확인)은 저장하지 않는다. 같은 사이트의 GET만 다루고, 모델 CDN 등 외부 요청과 옷장 데이터(IndexedDB)는 건드리지 않는다. */
const V = new URL(self.location).searchParams.get('v') || '0'; // 앱 버전(index.html이 sw.js?v=버전으로 등록). 버전이 바뀌면 서비스워커와 사본도 새로 만든다
const CACHE = 'wardrobe-shell-' + V;
const SHELL = ['./', `./outfits.js?v=${V}`, `./wardrobe-import.js?v=${V}`, './shortcut-help.html', './product-shortcut.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];
const isPage = u => u.pathname.endsWith('/') || u.pathname.endsWith('/index.html');
const keyOf = url => { const u = new URL(url), v = u.searchParams.get('v'); return u.origin + (isPage(u) ? new URL('./', self.location).pathname : u.pathname) + (v && !isPage(u) && !u.pathname.endsWith('.html') ? '?v=' + v : ''); };
const offlinePage = () => new Response('<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>오프라인</title><p style="font:16px -apple-system,sans-serif;padding:24px;line-height:1.6">오프라인이라 이 페이지를 열 수 없습니다. 인터넷에 연결된 뒤 다시 시도해 주세요.<br><a href="./">← 옷장으로 돌아가기</a></p>', { headers: { 'Content-Type': 'text/html; charset=utf-8' } });

self.addEventListener('install', e => {
  self.skipWaiting();
  e.waitUntil(caches.open(CACHE).then(c => Promise.all(SHELL.map(p => { const url = new URL(p, self.location).href; return fetch(url, { cache: 'no-store' }).then(r => r.ok ? c.put(keyOf(url), r) : null).catch(() => null); }))));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k.startsWith('wardrobe-shell-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin || url.pathname.endsWith('/version.json')) return;
  const key = keyOf(req.url);
  const save = res => { if (res.ok && res.type === 'basic') { const copy = res.clone(); try { e.waitUntil(caches.open(CACHE).then(c => c.put(key, copy)).catch(() => {})); } catch (_) { /* 응답이 끝난 뒤면 저장만 건너뜀 */ } } return res; };
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      const c = await caches.open(CACHE), net = fetch(req).then(save), cached = await c.match(key);
      if (!cached) return net.catch(() => isPage(url) ? Response.error() : offlinePage());
      // '업데이트'·'강제 새로고침'(t·refresh 값)은 새 화면을 원한 것이라 4초에 끊지 않고, 네트워크가 실패할 때만 사본을 쓴다
      if (url.searchParams.has('t') || url.searchParams.has('refresh')) return net.catch(() => cached);
      const late = new Promise(r => setTimeout(() => r(null), 4000));
      try { const res = await Promise.race([net, late]); if (res) return res; } catch (_) { /* 네트워크 실패 → 사본 */ }
      e.waitUntil(net.catch(() => {}));
      return cached;
    })());
    return;
  }
  e.respondWith(fetch(req).then(save).catch(async () => (await (await caches.open(CACHE)).match(key)) || Response.error()));
});
