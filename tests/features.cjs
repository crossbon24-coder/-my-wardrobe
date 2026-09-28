/* 앱 기능 회귀 검사(v4.4): 옷 삭제·보관, 사진 바꾸기, 수정 창 실수 방지, 옷장 '오늘 입음' 중복 방지·되돌리기, 업데이트 전 확인,
 * 사진 추가 이어 붙이기, 백업(사진 확인·조각 Blob·iPhone 공유 시트·현지 날짜), Safari 탭·백업 안내, 입력칸 16px, 뒤로 가기 캐시.
 * 합성 이미지만 쓰고 사용자 사진·실제 IndexedDB·GitHub Pages에 접근하지 않는다. 검사마다 새 브라우저 컨텍스트(빈 DB).
 * 실행: node tests/features.cjs   (Playwright 필요. WARDROBE_TEST_CHROMIUM으로 Chromium 실행 파일 지정 가능)
 */
const { chromium } = require('playwright');
const { createServer } = require('node:http');
const { readFileSync, existsSync } = require('node:fs');
const { join, normalize, extname } = require('node:path');
const assert = require('node:assert/strict');
const root = normalize(join(__dirname, '..'));
let slowMs = 0; // >0이면 앱 화면(/, /index.html) 응답을 그만큼 늦춘다(약한 신호 흉내)
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  if (slowMs && (path === '/' || path === '/index.html')) { const ms = slowMs; setTimeout(() => { if (!res.destroyed) { res.setHeader('Content-Type', 'text/html; charset=utf-8'); res.end(readFileSync(join(root, 'index.html'))); } }, ms); return; }
  const file = normalize(join(root, path === '/' ? 'index.html' : path.slice(1)));
  if (!file.startsWith(root) || file.includes(`${root}\\.git`) || file.includes(`${root}/.git`) || !existsSync(file)) { res.writeHead(404).end(); return; }
  const ext = extname(file);
  res.setHeader('Content-Type', ext === '.json' ? 'application/json' : ext === '.js' ? 'text/javascript; charset=utf-8' : ext === '.png' ? 'image/png' : ext === '.webmanifest' ? 'application/manifest+json' : 'text/html; charset=utf-8');
  res.end(readFileSync(file));
});
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
let browser, passed = 0, failed = 0;
async function fresh(opts = {}) {
  const context = await browser.newContext({ serviceWorkers: opts.sw ? 'allow' : 'block', viewport: { width: 390, height: 844 }, ...(opts.iphone ? { userAgent: IPHONE } : {}), ...(opts.tz ? { timezoneId: opts.tz } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // 외부 https(모델 CDN 등)는 일부러 막고, 오프라인 검사는 일부러 실패할 요청을 보내므로 그 '불러오기 실패' 콘솔 메시지만 예상된 것으로 거른다
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: net::(ERR_FAILED|ERR_INTERNET_DISCONNECTED)/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('https://**/*', route => route.abort());
  for (const b of opts.block || []) await page.route(u => u.pathname === b, route => route.abort());
  if (opts.standalone) await page.addInitScript(() => Object.defineProperty(navigator, 'standalone', { configurable: true, value: true }));
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => /옷 \d+벌/.test(document.getElementById('summary').textContent) && window.OF);
  await page.evaluate(() => {
    window.alerts = []; window.confirms = []; window.confirmAnswer = true;
    window.confirmQueue = []; window.onConfirm = null;
    window.alert = t => alerts.push(String(t)); window.confirm = t => { confirms.push(String(t)); if (window.onConfirm) window.onConfirm(String(t)); return window.confirmQueue.length ? window.confirmQueue.shift() : window.confirmAnswer; };
    window.sleep = ms => new Promise(r => setTimeout(r, ms));
    window.goto = name => [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === name).click();
    window.jpeg = async (color, size = 64) => { const c = document.createElement('canvas'); c.width = c.height = size; const x = c.getContext('2d'); x.fillStyle = color; x.fillRect(0, 0, size, size); x.fillStyle = '#fff'; x.fillRect(size / 4, size / 4, size / 2, size / 2); return new Promise(r => c.toBlob(r, 'image/jpeg', .8)); };
    window.seed = async specs => {
      const rows = [];
      for (const [i, s] of specs.entries()) rows.push({ id: s.id, image: s.image || await jpeg(`hsl(${(i * 47) % 360},60%,50%)`), category: s.category, type: s.type || '', color: s.color || '회색', season: s.season || '사계절', formality: 2, memo: s.memo || '', createdAt: 1000 + i, wearCount: s.wearCount || 0, lastWorn: s.lastWorn || null, ...(s.partial ? { partial: true } : {}) });
      await transaction(['clothes'], 'readwrite', tx => { const st = tx.objectStore('clothes'); for (const r of rows) st.put(r); });
      await refresh();
    };
    window.basic = () => seed([
      { id: 't1', category: '상의', memo: '그레이 니트', partial: true }, { id: 't2', category: '상의', memo: '화이트 셔츠' }, { id: 't3', category: '상의', memo: '블랙 티셔츠' },
      { id: 'b1', category: '하의', memo: '인디고 데님' }, { id: 's1', category: '신발', memo: '뉴발란스' }, { id: 'g1', category: '가방', memo: '포터 토트' },
    ]);
    window.clothesDB = () => transaction(['clothes'], 'readonly', tx => { const q = tx.objectStore('clothes').getAll(); return () => q.result; });
    window.outfitsDB = () => transaction(['outfits'], 'readonly', tx => { const q = tx.objectStore('outfits').getAll(); return () => q.result; });
    window.visibleCards = () => [...document.querySelectorAll('#items .item')].filter(e => !e.hidden).map(e => e.querySelector('.title').textContent);
    window.toastText = () => { const t = document.getElementById('appToast'); return t && t.classList.contains('show') ? t.textContent : ''; };
    window.localDateStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  });
  return { context, page, errors };
}
async function check(name, fn, opts) {
  const t = await fresh(opts);
  try { await fn(t.page, t.context); assert.deepEqual(t.errors, [], 'runtime errors'); console.log('PASS', name); passed++; }
  catch (e) { console.log('FAIL', name, '\n  ', e.message.split('\n').slice(0, 8).join('\n   ')); failed++; }
  finally { await t.context.close(); }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, ...(process.env.WARDROBE_TEST_CHROMIUM ? { executablePath: process.env.WARDROBE_TEST_CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });

  await check('Delete: cancel keeps the garment; confirm deletes it and empties that slot in saved outfits in one step', async page => {
    const r = await page.evaluate(async () => {
      await basic();
      await transaction(['outfits'], 'readwrite', tx => { const s = tx.objectStore('outfits'); s.put({ id: 'o1', name: 'A', slots: { top: 't1', bottom: 'b1' }, createdAt: 1, worn: [] }); s.put({ id: 'o2', name: 'B', slots: { top: 't2', bottom: 'b1' }, createdAt: 2, worn: [] }); });
      await refresh();
      openEdit('t1'); confirmAnswer = false; await deleteGarment(); const kept = (await clothesDB()).some(c => c.id === 't1');
      const askedAboutOutfits = confirms[0].includes('저장 코디 1개');
      confirmAnswer = true; await deleteGarment();
      const os = await outfitsDB();
      return { kept, askedAboutOutfits, gone: !(await clothesDB()).some(c => c.id === 't1'), o1: os.find(o => o.id === 'o1').slots, o2top: os.find(o => o.id === 'o2').slots.top, modalOpen: document.getElementById('editModal').classList.contains('open'), toast: toastText() };
    });
    assert.equal(r.kept, true); assert.equal(r.askedAboutOutfits, true); assert.equal(r.gone, true);
    assert.deepEqual(r.o1, { top: null, bottom: 'b1' }); assert.equal(r.o2top, 't2'); assert.equal(r.modalOpen, false); assert.match(r.toast, /삭제했습니다/);
  });

  await check('Archive hides a garment from the closet, pick sheet and recommendations; 보관함 shows it; unarchive restores', async page => {
    const r = await page.evaluate(async () => {
      await basic(); openEdit('t2'); await toggleArchive();
      const rec = (await clothesDB()).find(c => c.id === 't2');
      const grid = visibleCards(), summary = document.getElementById('summary').textContent, chip = [...document.querySelectorAll('#filters .chip')].map(c => c.textContent).includes('보관함');
      filter = '보관함'; render(); const archivedView = visibleCards();
      goto('코디'); OF.pick('top'); const pick = document.querySelectorAll('#pickGrid .pitem').length; OF.closePick();
      for (const id of ['t1', 't3']) { openEdit(id); await toggleArchive(); }
      goto('코디 추천'); recommend(); const recMsg = document.getElementById('result').innerText;
      goto('옷장'); filter = '보관함'; render(); openEdit('t2'); await toggleArchive(); const back = (await clothesDB()).find(c => c.id === 't2');
      return { archived: rec.archived, grid, summary, chip, archivedView, pick, recMsg, back: 'archived' in back };
    });
    assert.equal(r.archived, true); assert.ok(!r.grid.includes('화이트 셔츠')); assert.match(r.summary, /옷 5벌 · 보관 1벌/); assert.equal(r.chip, true);
    assert.deepEqual(r.archivedView, ['화이트 셔츠']); assert.equal(r.pick, 2); assert.match(r.recMsg, /상의와 하의를 먼저/); assert.equal(r.back, false);
  });

  await check('Photo replace: preview only until saved; cancel discards; save swaps image, clears partial, keeps id and history', async page => {
    const r = await page.evaluate(async () => {
      await basic(); await transaction(['clothes'], 'readwrite', tx => { const s = tx.objectStore('clothes'), q = s.get('t1'); q.onsuccess = () => s.put({ ...q.result, wearCount: 7 }); }); await refresh();
      const before = (await clothesDB()).find(c => c.id === 't1').image.size;
      openEdit('t1'); const partialShown = !document.getElementById('editPartial').hidden;
      const big = new File([await jpeg('#c00', 300)], 'new.jpg', { type: 'image/jpeg' });
      await chooseEditPhoto(big); const preview = document.getElementById('editImg').src.startsWith('blob:') && !!pendingImage;
      closeEdit(); const afterCancel = (await clothesDB()).find(c => c.id === 't1').image.size;
      openEdit('t1'); await chooseEditPhoto(big); await saveEdit();
      const rec = (await clothesDB()).find(c => c.id === 't1'), shown = clothes.find(c => c.id === 't1');
      const loads = await new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth >= 150 && im.naturalWidth <= 300); im.onerror = () => res(false); im.src = url(shown.image); }); // v4.7부터 단색 둘레는 여백을 자른다
      return { partialShown, preview, unchanged: afterCancel === before, changed: rec.image.size !== before, partial: rec.partial, wearCount: rec.wearCount, shownSize: shown.image.size === rec.image.size, loads, toast: toastText() };
    });
    assert.deepEqual(r, { partialShown: true, preview: true, unchanged: true, changed: true, partial: false, wearCount: 7, shownSize: true, loads: true, toast: '사진을 바꿨습니다' });
  });

  await check('Edit sheet backdrop tap asks before discarding changes; unchanged sheet closes silently', async page => {
    const r = await page.evaluate(async () => {
      await basic(); const modal = document.getElementById('editModal');
      openEdit('t2'); modal.click(); const closedClean = !modal.classList.contains('open'), asked0 = confirms.length;
      openEdit('t2'); document.getElementById('editMemo').value = '바뀐 메모'; confirmAnswer = false; modal.click(); const stayed = modal.classList.contains('open') && document.getElementById('editMemo').value === '바뀐 메모';
      confirmAnswer = true; modal.click(); const closed = !modal.classList.contains('open');
      return { closedClean, asked0, stayed, closed, memo: (await clothesDB()).find(c => c.id === 't2').memo };
    });
    assert.deepEqual(r, { closedClean: true, asked0: 0, stayed: true, closed: true, memo: '화이트 셔츠' });
  });

  await check("Closet-card 오늘 입음: once per day, undo restores the previous count and date, card shows 입음 ✓", async page => {
    const r = await page.evaluate(async () => {
      await seed([{ id: 'x', category: '상의', memo: '셔츠', wearCount: 2, lastWorn: 1000 }]);
      await wear('x'); const first = (await clothesDB())[0].wearCount, label = document.querySelector('#items .item .actions button:last-child').textContent;
      document.querySelector('#appToast button').click(); await sleep(300); const undone = (await clothesDB())[0];
      await wear('x'); await wear('x'); const twice = (await clothesDB())[0].wearCount, dupToast = toastText();
      return { first, label, undoneCount: undone.wearCount, undoneLast: undone.lastWorn, twice, dupToast };
    });
    assert.deepEqual(r, { first: 3, label: '입음 ✓', undoneCount: 2, undoneLast: 1000, twice: 3, dupToast: '오늘은 이미 기록되어 있습니다' });
  });

  await check('Update/reload asks before discarding the registration list or edits', async page => {
    const r = await page.evaluate(async () => {
      await basic(); const none = confirmLeave(), askedNone = confirms.length;
      batch = [{}]; confirmAnswer = false; const blocked = confirmLeave(); const msg = confirms.at(-1); confirmAnswer = true; const allowed = confirmLeave(); batch = [];
      openEdit('t2'); document.getElementById('editMemo').value = 'x'; confirmAnswer = false; const editBlocked = confirmLeave(); closeEdit();
      return { none, askedNone, blocked, msg, allowed, editBlocked };
    });
    assert.equal(r.none, true); assert.equal(r.askedNone, 0); assert.equal(r.blocked, false); assert.match(r.msg, /등록 목록 1벌/); assert.equal(r.allowed, true); assert.equal(r.editBlocked, false);
  });

  await check('Choosing more photos appends to the registration list instead of replacing it; saved batch keeps chosen order', async page => {
    const r = await page.evaluate(async () => {
      visionModel = null; modelPromise = null; scriptLoads.clear(); delete window.tf; delete window.mobilenet;
      const f = async (c, n) => new File([await jpeg(c)], n, { type: 'image/jpeg' });
      await $('photo').onchange({ target: { files: [await f('#036', 'a.jpg')], value: '' } });
      await $('photo').onchange({ target: { files: [await f('#630', 'b.jpg')], value: '' } });
      const n = batch.length, noReplaceConfirm = confirms.length;
      batch.forEach((x, i) => { x.category = '상의'; x.color = '회색'; x.memo = i ? '두번째' : '첫번째'; });
      await saveBatch(); const order = visibleCards();
      return { n, noReplaceConfirm, order };
    });
    assert.deepEqual(r, { n: 2, noReplaceConfirm: 0, order: ['첫번째', '두번째'] });
  });

  await check('Backup (desktop): validated, streamed Blob equals makeBackup, local-date file name, last-backup date recorded', async page => {
    const r = await page.evaluate(async () => {
      await basic(); let got = null; window.downloadBlob = (b, name) => { got = { b, name }; };
      await exportBackup(); const parsed = JSON.parse(await got.b.text()), direct = await makeBackup();
      const same = JSON.stringify(parsed.clothes) === JSON.stringify(direct.clothes) && JSON.stringify(parsed.outfits) === JSON.stringify(direct.outfits) && parsed.app === 'my-wardrobe';
      const restorable = (await prepareRestore(parsed)).clothes.length;
      return { name: got.name, expected: new RegExp(`^wardrobe-backup-${localDateStr()}-\\d{4}-pc\\.json$`), same, restorable, last: localStorage.getItem('wardrobe.lastBackup') === localDateStr(), info: document.getElementById('backupInfo').textContent };
    });
    assert.match(r.name, r.expected); assert.equal(r.same, true); assert.equal(r.restorable, 6); assert.equal(r.last, true); assert.match(r.info, /마지막 백업: \d{4}-\d{2}-\d{2} \(오늘\)/);
  });

  await check('Backup with an unreadable photo: cancel makes nothing; confirm excludes that garment so the file stays restorable', async page => {
    const r = await page.evaluate(async () => {
      await basic(); await transaction(['clothes'], 'readwrite', tx => tx.objectStore('clothes').put({ id: 'bad', image: new Blob(['not an image'], { type: 'image/jpeg' }), category: '상의', type: '', color: '회색', season: '사계절', formality: 2, memo: '깨진 사진', createdAt: 5, wearCount: 0, lastWorn: null }));
      await refresh(); let got = null; window.downloadBlob = (b, name) => { got = { b, name }; };
      confirmAnswer = false; await exportBackup(); const cancelled = got === null, status1 = document.getElementById('backupStatus').textContent, asked = confirms.at(-1);
      confirmAnswer = true; await exportBackup(); const parsed = JSON.parse(await got.b.text());
      return { cancelled, status1, asked, n: parsed.clothes.length, hasBad: parsed.clothes.some(c => c.id === 'bad'), restorable: (await prepareRestore(parsed)).clothes.length };
    });
    assert.equal(r.cancelled, true); assert.match(r.status1, /취소/); assert.match(r.asked, /깨진 사진/); assert.equal(r.n, 6); assert.equal(r.hasBad, false); assert.equal(r.restorable, 6);
  });

  await check('Backup on iPhone uses the share sheet from a tap; cancelling the share does not count as a backup', async page => {
    const r = await page.evaluate(async () => {
      await basic(); let shared = [], mode = 'abort'; let downloaded = 0; window.downloadBlob = () => { downloaded++; };
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: d => !!(d && d.files && d.files.length) });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async d => { if (mode === 'abort') { const e = new Error('cancel'); e.name = 'AbortError'; throw e; } shared.push(d.files[0].name); } });
      await exportBackup(); const btn = document.querySelector('#backupShare button'), visible = !document.getElementById('backupShare').hidden;
      btn.click(); await sleep(50); const afterAbort = { last: localStorage.getItem('wardrobe.lastBackup'), status: document.getElementById('backupStatus').textContent };
      mode = 'ok'; btn.click(); await sleep(50);
      return { visible, afterAbort, shared, downloaded, last: localStorage.getItem('wardrobe.lastBackup') === localDateStr(), hidden: document.getElementById('backupShare').hidden };
    });
    assert.equal(r.visible, true); assert.equal(r.afterAbort.last, null); assert.match(r.afterAbort.status, /취소/);
    assert.equal(r.shared.length, 1); assert.match(r.shared[0], /^wardrobe-backup-\d{4}-\d{2}-\d{2}-\d{4}-safari\.json$/); assert.equal(r.downloaded, 0); assert.equal(r.last, true); assert.equal(r.hidden, true);
  }, { iphone: true });

  await check('Safari-tab and backup warnings on iPhone; each can be dismissed; a fresh backup clears the backup warning', async page => {
    const r = await page.evaluate(async () => {
      const empty = document.getElementById('safety').hidden; await basic();
      const text0 = document.getElementById('safety').innerText;
      dismissSafety('tab'); const text1 = document.getElementById('safety').innerText;
      markBackedUp(); const hiddenAfterBackup = document.getElementById('safety').hidden;
      return { empty, tab: text0.includes('Safari 탭'), nag: text0.includes('백업한 기록이 없습니다'), tabGone: !text1.includes('Safari 탭') && text1.includes('백업'), hiddenAfterBackup, where: document.getElementById('backupInfo').textContent.includes('Safari 탭') };
    });
    assert.deepEqual(r, { empty: true, tab: true, nag: true, tabGone: true, hiddenAfterBackup: true, where: true });
  }, { iphone: true });

  await check('Desktop shows only the backup reminder (no Safari-tab warning); 나중에 hides it', async page => {
    const r = await page.evaluate(async () => { await basic(); const t = document.getElementById('safety').innerText; dismissSafety('nag'); return { tab: t.includes('Safari 탭'), nag: t.includes('백업'), hidden: document.getElementById('safety').hidden }; });
    assert.deepEqual(r, { tab: false, nag: true, hidden: true });
  });

  await check('A prepared iPhone backup button is withdrawn when the closet changes, and refuses a stale file if tapped', async page => {
    const r = await page.evaluate(async () => {
      await basic(); let shared = 0;
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: async () => { shared++; } });
      await exportBackup(); const btn = document.querySelector('#backupShare button');
      await wear('t2'); const hidden = document.getElementById('backupShare').hidden, status = document.getElementById('backupStatus').textContent;
      btn.click(); await sleep(50);
      return { hidden, status, shared, last: localStorage.getItem('wardrobe.lastBackup') };
    });
    assert.equal(r.hidden, true); assert.match(r.status, /다시 만들어/); assert.equal(r.shared, 0); assert.equal(r.last, null);
  }, { iphone: true });

  await check('코디에 담기 asks before dropping a newly chosen photo; declining keeps the sheet and the photo', async page => {
    const r = await page.evaluate(async () => {
      await basic(); openEdit('t2'); await chooseEditPhoto(new File([await jpeg('#0a0', 200)], 'n.jpg', { type: 'image/jpeg' }));
      confirmAnswer = false; OF.addToOutfit(); const asked = confirms.length, open = document.getElementById('editModal').classList.contains('open'), kept = !!pendingImage;
      confirmAnswer = true; OF.addToOutfit(); await sleep(50);
      return { asked, open, kept, closed: !document.getElementById('editModal').classList.contains('open'), tab: document.getElementById('outfit').classList.contains('active') };
    });
    assert.deepEqual(r, { asked: 1, open: true, kept: true, closed: true, tab: true });
  });

  await check('Re-choosing the same photo is skipped; 목록 비우기 clears the list after confirmation', async page => {
    const r = await page.evaluate(async () => {
      visionModel = null; modelPromise = null; scriptLoads.clear(); delete window.tf; delete window.mobilenet;
      const blob = await jpeg('#036'), f = n => new File([blob], n, { type: 'image/jpeg' }), other = new File([await jpeg('#630')], 'c.jpg', { type: 'image/jpeg' });
      await $('photo').onchange({ target: { files: [f('a.jpg'), other], value: '' } });
      await $('photo').onchange({ target: { files: [f('a-again.jpg')], value: '' } });
      const n = batch.length, toast = toastText(), btnShown = document.getElementById('clearBatchBtn').style.display;
      confirmAnswer = false; clearBatch(); const kept = batch.length; confirmAnswer = true; clearBatch();
      return { n, toast, btnShown, kept, after: batch.length };
    });
    assert.deepEqual(r, { n: 2, toast: '이미 등록 목록에 있는 사진 1장은 건너뛰었습니다', btnShown: 'block', kept: 2, after: 0 });
  });

  await check('Undo of a closet 오늘 입음 is refused if the record changed in between, and says so', async page => {
    const r = await page.evaluate(async () => {
      await seed([{ id: 'x', category: '상의', memo: '셔츠', wearCount: 2, lastWorn: 1000 }]);
      await wear('x'); const undoBtn = document.querySelector('#appToast button');
      await transaction(['clothes'], 'readwrite', tx => { const s = tx.objectStore('clothes'), q = s.get('x'); q.onsuccess = () => s.put({ ...q.result, lastWorn: q.result.lastWorn + 5 }); });
      undoBtn.click(); await sleep(300);
      return { count: (await clothesDB())[0].wearCount, toast: toastText() };
    });
    assert.deepEqual(r, { count: 3, toast: '그 사이 다른 착용 기록이 생겨 되돌리지 않았습니다' });
  });

  await check('Archive toast offers undo; 보관함 chip sits right after 전체', async page => {
    const r = await page.evaluate(async () => {
      await basic(); openEdit('t3'); await toggleArchive();
      const chips = [...document.querySelectorAll('#filters .chip')].map(c => c.textContent);
      document.querySelector('#appToast button').click(); await sleep(300);
      return { second: chips[1], restored: !('archived' in (await clothesDB()).find(c => c.id === 't3')) };
    });
    assert.deepEqual(r, { second: '보관함', restored: true });
  });

  await check('Outfit writes wait for the app lock (e.g. during a backup) instead of racing it', async page => {
    const r = await page.evaluate(async () => {
      await basic(); goto('코디'); OF.pick('top'); OF.choose('t1'); OF.pick('bottom'); OF.choose('b1');
      mutationBusy = true; OF.save(); await sleep(200); const during = (await outfitsDB()).length, msg = toastText();
      mutationBusy = false; OF.save(); await sleep(300);
      return { during, msg, after: (await outfitsDB()).length };
    });
    assert.deepEqual(r, { during: 0, msg: '저장·백업이 끝난 뒤 다시 눌러주세요', after: 1 });
  });

  await check('Every text input, select and textarea is at least 16px (iPhone zooms on smaller ones), incl. sheets and closet tools', async page => {
    const r = await page.evaluate(async () => {
      await basic(); const q = document.createElement('div'); q.className = 'q'; q.innerHTML = '<div><select><option>a</option></select><input></div>'; document.getElementById('queue').appendChild(q);
      goto('코디'); OF.pick('top'); openEdit('t2');
      const small = [...document.querySelectorAll('input:not([type=file]):not([type=checkbox]):not([type=radio]),select,textarea')].map(e => [e.id || e.getAttribute('aria-label') || e.tagName, parseFloat(getComputedStyle(e).fontSize)]).filter(([, px]) => px < 16);
      q.remove(); return small;
    });
    assert.deepEqual(r, []);
  });

  await check('iPhone share: a tap while sharing is ignored, InvalidStateError is not a backup, other errors offer a manual download', async page => {
    const r = await page.evaluate(async () => {
      await basic(); let calls = 0, finish = null, mode = 'pending', downloaded = 0; window.downloadBlob = () => { downloaded++; };
      Object.defineProperty(navigator, 'canShare', { configurable: true, value: () => true });
      Object.defineProperty(navigator, 'share', { configurable: true, value: () => { calls++; if (mode === 'pending') return new Promise((_, rej) => { finish = () => { const e = new Error('x'); e.name = 'AbortError'; rej(e); }; }); const e = new Error('x'); e.name = mode; return Promise.reject(e); } });
      await exportBackup(); const btn = document.querySelector('#backupShare button');
      btn.click(); btn.click(); await sleep(20); const callsWhilePending = calls; finish(); await sleep(50);
      const afterAbort = { last: localStorage.getItem('wardrobe.lastBackup'), downloaded };
      mode = 'InvalidStateError'; btn.click(); await sleep(50); const afterInvalid = { last: localStorage.getItem('wardrobe.lastBackup'), downloaded, dl: !!document.querySelector('#backupShare .dl') };
      mode = 'NotAllowedError'; btn.click(); await sleep(50); const dlBtn = document.querySelector('#backupShare .dl'); const beforeDl = { last: localStorage.getItem('wardrobe.lastBackup'), downloaded };
      dlBtn.click(); await sleep(20);
      return { callsWhilePending, afterAbort, afterInvalid, beforeDl, afterDl: { downloaded, last: localStorage.getItem('wardrobe.lastBackup') === localDateStr() } };
    });
    assert.deepEqual(r, { callsWhilePending: 1, afterAbort: { last: null, downloaded: 0 }, afterInvalid: { last: null, downloaded: 0, dl: false }, beforeDl: { last: null, downloaded: 0 }, afterDl: { downloaded: 1, last: true } });
  }, { iphone: true });

  await check('With an archived garment, closet sort and data search still map every card (전체 and 보관함); counts survive outfit-only refresh', async page => {
    const r = await page.evaluate(async () => {
      await seed([{ id: 'x1', category: '상의', memo: '가', wearCount: 1 }, { id: 'x2', category: '상의', memo: '나', wearCount: 5 }, { id: 'x3', category: '하의', memo: '다', wearCount: 3 }]);
      await setArchived('x2', true); await refresh();
      const so = document.getElementById('closetSort'); so.value = 'most'; so.dispatchEvent(new Event('change'));
      const order = visibleCards(), mapped = [...document.querySelectorAll('#items .item')].every(e => e.dataset.ofId);
      const inp = document.getElementById('closetSearch'); inp.value = '하의'; inp.dispatchEvent(new Event('input')); const search = visibleCards(); inp.value = ''; inp.dispatchEvent(new Event('input'));
      filter = '보관함'; render(); const arch = visibleCards(), archMapped = [...document.querySelectorAll('#items .item')].every(e => e.dataset.ofId);
      goto('코디'); OF.pick('top'); OF.choose('x1'); OF.save(); await sleep(300); const summary = document.getElementById('summary').textContent;
      goto('옷장'); openEdit('x2'); await toggleArchive(); const f = filter;
      return { order, mapped, search, arch, archMapped, summary, f };
    });
    assert.deepEqual(r, { order: ['다', '가'], mapped: true, search: ['다'], arch: ['나'], archMapped: true, summary: '옷 2벌 · 보관 1벌 · 저장 코디 1개', f: '전체' });
  });

  await check('Update bar: 닫기 is remembered for that version, manual check shows it again; 업데이트 asks before discarding work', async page => {
    await page.route(u => u.pathname === '/version.json', r => r.fulfill({ contentType: 'application/json', body: '{"version":"9.9"}' }));
    const r = await page.evaluate(async () => {
      const shown = () => document.getElementById('updateBar').classList.contains('show');
      await checkUpdate(false); const a = shown(); document.querySelector('#updateBar button:last-child').click(); const b = shown();
      await checkUpdate(false); const c = shown(); await checkUpdate(true); const d = shown();
      batch = [{}]; confirmAnswer = false; window.__stay = 1; document.querySelector('#updateBar button').click(); await sleep(300);
      return { a, b, c, d, stayed: window.__stay === 1, asked: confirms.at(-1) };
    });
    assert.deepEqual([r.a, r.b, r.c, r.d, r.stayed], [true, false, false, true, true]); assert.match(r.asked, /등록 목록 1벌/);
    await page.evaluate(() => { confirmAnswer = true; setTimeout(() => document.querySelector('#updateBar button').click(), 0); });
    await page.waitForURL(/\?v=9\.9/);
  });

  await check('Backdrop tap after choosing a new photo asks first; declining an archive with unsaved edits changes nothing', async page => {
    const r = await page.evaluate(async () => {
      await basic(); const modal = document.getElementById('editModal');
      openEdit('t2'); await chooseEditPhoto(new File([await jpeg('#909', 120)], 'p.jpg', { type: 'image/jpeg' }));
      confirmAnswer = false; modal.click(); const photoKept = modal.classList.contains('open') && !!pendingImage;
      closeEdit(); openEdit('t3'); document.getElementById('editMemo').value = '고침'; await toggleArchive(); const rec = (await clothesDB()).find(c => c.id === 't3');
      return { photoKept, archived: 'archived' in rec, memo: rec.memo, asked: confirms.at(-1) };
    });
    assert.equal(r.photoKept, true); assert.equal(r.archived, false); assert.equal(r.memo, '블랙 티셔츠'); assert.match(r.asked, /보관할까요/);
  });

  await check('Backup file name and last-backup date use the local (Korea) date even between 00:00 and 09:00', async page => {
    await page.clock.setFixedTime(new Date('2026-09-27T00:30:00+09:00'));
    const r = await page.evaluate(async () => { await basic(); let name = ''; window.downloadBlob = (b, n) => { name = n; }; await exportBackup(); return { name, last: localStorage.getItem('wardrobe.lastBackup') }; });
    assert.deepEqual(r, { name: 'wardrobe-backup-2026-09-27-0030-pc.json', last: '2026-09-27' });
  }, { tz: 'Asia/Seoul' });

  await check('Delete is atomic: if emptying the outfit slots fails, the garment is not deleted either', async page => {
    const r = await page.evaluate(async () => {
      await basic(); await transaction(['outfits'], 'readwrite', tx => tx.objectStore('outfits').put({ id: 'o1', name: 'A', slots: { top: 't1' }, createdAt: 1, worn: [] })); await refresh();
      const orig = IDBObjectStore.prototype.put; IDBObjectStore.prototype.put = function (...a) { if (this.name === 'outfits') { this.transaction.abort(); return null; } return orig.apply(this, a); };
      openEdit('t1'); try { await deleteGarment(); } finally { IDBObjectStore.prototype.put = orig; }
      return { kept: (await clothesDB()).some(c => c.id === 't1'), slot: (await outfitsDB())[0].slots.top, alert: alerts.at(-1) };
    });
    assert.equal(r.kept, true); assert.equal(r.slot, 't1'); assert.match(r.alert, /삭제하지 못했습니다/);
  });

  await check('Replacing a photo with one of the same byte size still refreshes the displayed copy', async page => {
    const r = await page.evaluate(async () => {
      await basic(); const shownBefore = clothes.find(c => c.id === 't1').image;
      const stored = (await clothesDB()).find(c => c.id === 't1').image, bytes = new Uint8Array(await stored.arrayBuffer()); bytes[Math.floor(bytes.length / 2)] ^= 0xff;
      openEdit('t1'); pendingImage = new Blob([bytes], { type: stored.type }); await saveEdit();
      const shownAfter = clothes.find(c => c.id === 't1').image, after = new Uint8Array(await shownAfter.arrayBuffer());
      return { sameSize: shownAfter.size === shownBefore.size, newObject: shownAfter !== shownBefore, newBytes: after[Math.floor(after.length / 2)] === bytes[Math.floor(bytes.length / 2)] };
    });
    assert.deepEqual(r, { sameSize: true, newObject: true, newBytes: true });
  });

  await check('Coming back to the app on a new day redraws 입음 ✓ back to 오늘 입음', async page => {
    await page.evaluate(async () => { await seed([{ id: 'x', category: '상의', memo: '셔츠' }]); await wear('x'); });
    const before = await page.evaluate(() => document.querySelector('#items .item .actions button:last-child').textContent);
    await page.clock.setFixedTime(new Date(Date.now() + 86400000 + 3600000));
    const after = await page.evaluate(async () => { document.dispatchEvent(new Event('visibilitychange')); await sleep(50); return document.querySelector('#items .item .actions button:last-child').textContent; });
    assert.deepEqual([before, after], ['입음 ✓', '오늘 입음']);
  });

  await check('Recommend: 3 combos with distinct tops and bottoms; outer when cold or formal, bag when formal, none when hot; 다른 추천 moves on', async page => {
    const r = await page.evaluate(async () => {
      const specs = [];
      for (let i = 0; i < 5; i++) specs.push({ id: 'top' + i, category: '상의', memo: '상의' + i, color: ['검정', '흰색', '회색', '네이비', '베이지'][i] });
      for (let i = 0; i < 4; i++) specs.push({ id: 'bot' + i, category: '하의', memo: '하의' + i, color: ['검정', '블루', '베이지', '회색'][i] });
      specs.push({ id: 'shoe', category: '신발', memo: '신발' }, { id: 'coat', category: '아우터', memo: '코트', season: '겨울' }, { id: 'bag', category: '가방', memo: '가방' });
      await seed(specs); goto('코디 추천');
      const set = (o, w) => { $('occasion').value = String(o); $('weather').value = w; };
      set(1, 'normal'); recommend(); const normal = recommendations.map(c => c.slots);
      const distinct = new Set(normal.map(x => x.top)).size === normal.length && new Set(normal.map(x => x.bottom)).size === normal.length;
      const firstKeys = recommendations.map(c => c.key); recommend(true); const moved = recommendations.every(c => !firstKeys.includes(c.key));
      set(1, 'cold'); recommend(); const cold = recommendations[0].slots;
      set(3, 'normal'); recommend(); const formal = recommendations[0].slots;
      set(3, 'hot'); recommend(); const hot = recommendations[0].slots;
      return { n: normal.length, distinct, moved, coldOuter: cold.outer, formalOuter: formal.outer, formalBag: formal.bag, hotOuter: hot.outer, normalBag: normal[0].bag, cards: document.querySelectorAll('#result .reccard').length, allBlack: colorScore('검정', '검정'), sameChroma: colorScore('블루', '블루') };
    });
    assert.deepEqual(r, { n: 3, distinct: true, moved: true, coldOuter: 'coat', formalOuter: 'coat', formalBag: 'bag', hotOuter: null, normalBag: null, cards: 3, allBlack: 3, sameChroma: 2 });
  });

  await check('코디 탭 추천으로 채우기 fills the slots and gives a different combo on the next press', async page => {
    const r = await page.evaluate(async () => {
      await basic(); goto('코디'); await sleep(20); OF.fillRec(); await sleep(50);
      const a = JSON.parse(localStorage.getItem('wardrobe.outfitDraft')).draft, shownA = document.querySelectorAll('#outfit .card .fl-tile img').length;
      OF.fillRec(); await sleep(50);
      const b = JSON.parse(localStorage.getItem('wardrobe.outfitDraft')).draft, shownB = [...document.querySelectorAll('#outfit .card .fl-tile img')].map(i => i.alt);
      const want = Object.values(b).filter(Boolean).map(id => clothes.find(c => c.id === id).memo);
      return { filled: !!a.top && !!a.bottom, shownA, different: a.top !== b.top || a.bottom !== b.bottom, shownMatches: JSON.stringify(shownB.sort()) === JSON.stringify(want.sort()), toast: toastText() };
    });
    assert.equal(r.filled, true); assert.ok(r.shownA >= 2); assert.equal(r.different, true); assert.equal(r.shownMatches, true); assert.match(r.toast, /다른 조합/);
  });

  await check('Backup merge: adds new items, newer updatedAt wins, keeps max wear stats, unions outfit worn dates; cancel changes nothing', async page => {
    const r = await page.evaluate(async () => {
      const img = async c => b64(await jpeg(c));
      await seed([{ id: 'a', category: '상의', memo: '에이' }, { id: 'b', category: '하의', memo: '비 원래', wearCount: 5, lastWorn: 5000 }]);
      await transaction(['clothes', 'outfits'], 'readwrite', tx => { const cs = tx.objectStore('clothes'), q = cs.get('b'); q.onsuccess = () => cs.put({ ...q.result, updatedAt: 100 }); tx.objectStore('outfits').put({ id: 'o1', name: '출근', slots: { top: 'a', bottom: 'b' }, createdAt: 1, updatedAt: 50, worn: ['2026-09-01'] }); });
      await refresh();
      const file = { app: 'my-wardrobe', version: '4.5', createdAt: new Date().toISOString(), clothes: [
        { id: 'b', image: await img('#00f'), category: '하의', type: '', color: '블루', season: '사계절', formality: 2, memo: '비 백업', createdAt: 2, wearCount: 2, lastWorn: 9000, updatedAt: 200 },
        { id: 'c', image: await img('#0f0'), category: '신발', type: '', color: '회색', season: '사계절', formality: 2, memo: '씨 새옷', createdAt: 3, wearCount: 0, lastWorn: null },
      ], outfits: [{ id: 'o1', name: '출근(백업)', slots: { top: 'a', bottom: 'b' }, createdAt: 1, updatedAt: 10, worn: ['2026-09-02'] }, { id: 'o2', name: '주말', slots: { top: 'a' }, createdAt: 2, worn: [] }] };
      const f = new File([JSON.stringify(file)], 'm.json', { type: 'application/json' });
      confirmAnswer = false; await mergeBackup(f); const untouched = (await clothesDB()).length === 2 && (await outfitsDB()).length === 1;
      confirmAnswer = true; await mergeBackup(new File([JSON.stringify(file)], 'm.json', { type: 'application/json' }));
      const cs = Object.fromEntries((await clothesDB()).map(c => [c.id, c])), os = Object.fromEntries((await outfitsDB()).map(o => [o.id, o]));
      const shownB = clothes.find(c => c.id === 'b'); const bSize = (await (await fetch(url(shownB.image))).blob()).size;
      return { untouched, ids: Object.keys(cs).sort(), bMemo: cs.b.memo, bWear: cs.b.wearCount, bLast: cs.b.lastWorn, aMemo: cs.a.memo, o1Name: os.o1.name, o1Worn: os.o1.worn, o2: !!os.o2, shownB: bSize === cs.b.image.size, toast: toastText() };
    });
    assert.deepEqual(r, { untouched: true, ids: ['a', 'b', 'c'], bMemo: '비 백업', bWear: 5, bLast: 9000, aMemo: '에이', o1Name: '출근', o1Worn: ['2026-09-01', '2026-09-02'], o2: true, shownB: true, toast: '합쳤습니다: 새 옷 1벌 · 바뀐 옷 1벌 · 새 코디 1개' });
  });

  await check('Content edits and outfit saves stamp updatedAt; wear records and unchanged saves do not (merge compares content by it)', async page => {
    const r = await page.evaluate(async () => {
      await basic(); const t0 = Date.now();
      openEdit('t2'); document.getElementById('editMemo').value = '새 이름'; await saveEdit(); await wear('t3'); openEdit('s1'); await saveEdit();
      goto('코디'); OF.pick('top'); OF.choose('t1'); OF.save(); await sleep(300);
      const cs = Object.fromEntries((await clothesDB()).map(c => [c.id, c])), [o] = await outfitsDB();
      return { edit: cs.t2.updatedAt >= t0, wear: cs.t3.updatedAt === undefined, outfit: o.updatedAt >= t0, unchangedSave: cs.s1.updatedAt === undefined, untouched: cs.b1.updatedAt === undefined };
    });
    assert.deepEqual(r, { edit: true, wear: true, outfit: true, unchangedSave: true, untouched: true });
  });

  await check('Registration tab: big photo button first, shop import folded, backup in its own card, diagnostics hidden without ?debug=1', async page => {
    const r = await page.evaluate(async () => {
      const cards = [...document.querySelectorAll('#add > .card, #add > details.card')];
      visionModel = null; modelPromise = null; scriptLoads.clear(); delete window.tf; delete window.mobilenet;
      await $('photo').onchange({ target: { files: [new File([await jpeg('#123')], 'a.jpg', { type: 'image/jpeg' })], value: '' } });
      return { firstHasPhoto: !!cards[0].querySelector('#photo') && !!cards[0].querySelector('label.bigbtn[for=photo]'), second: cards[1].tagName + ':' + cards[1].open, backupSeparate: !!cards[2].querySelector('#backupBox') && !cards[0].querySelector('#backupBox'), diagHidden: document.getElementById('diagnosticBtn').hidden, saveText: document.getElementById('batchBtn').textContent, folded: !document.querySelector('#queue details').open };
    });
    assert.deepEqual(r, { firstHasPhoto: true, second: 'DETAILS:false', backupSeparate: true, diagHidden: true, saveText: '모두 저장 (1)', folded: true });
  });

  await check('Typing in the registration list is not interrupted by re-renders; missing fields are highlighted on save', async page => {
    const r = await page.evaluate(async () => {
      visionModel = null; modelPromise = null; scriptLoads.clear(); delete window.tf; delete window.mobilenet;
      await $('photo').onchange({ target: { files: [new File([await jpeg('#123')], 'a.jpg', { type: 'image/jpeg' })], value: '' } });
      goto('옷 등록'); const memo = document.querySelector('[aria-label="사진 1 메모"]'); memo.focus(); if (document.activeElement !== memo) throw new Error('memo not focused'); memo.value = '입력 중'; qset(0, 'memo', '입력 중');
      renderQueue(); const same = document.querySelector('[aria-label="사진 1 메모"]') === memo && memo.isConnected;
      memo.blur(); await sleep(20); const rerendered = document.querySelector('[aria-label="사진 1 메모"]') !== memo;
      batch[0].category = ''; batch[0].color = ''; await saveBatch(); const need = !!document.querySelector('#queue .q.need'), msg = alerts.at(-1);
      qset(0, 'category', '상의'); qset(0, 'color', '회색'); const cleared = !batch[0].need;
      return { same, rerendered, need, msg, cleared };
    });
    assert.equal(r.same, true); assert.equal(r.rerendered, true); assert.equal(r.need, true); assert.match(r.msg, /주황색/); assert.equal(r.cleared, true);
  });

  await check('Empty closet offers 사진으로 옷 등록 and 백업 파일 가져오기', async page => {
    const r = await page.evaluate(async () => {
      const e = document.getElementById('empty'), btns = [...e.querySelectorAll('button')].map(b => b.textContent);
      e.querySelector('button').click(); return { btns, add: document.getElementById('add').classList.contains('active') };
    });
    assert.deepEqual(r, { btns: ['사진으로 옷 등록', '백업 파일 가져오기'], add: true });
  });

  await check('코디에 담기 after the outfit tab was already drawn shows the new garment (no stale view)', async page => {
    const r = await page.evaluate(async () => {
      await basic(); goto('코디'); await sleep(20); goto('옷장');
      openEdit('g1'); OF.addToOutfit(); await sleep(50);
      return { tab: document.getElementById('outfit').classList.contains('active'), shown: !!document.querySelector('#outfit .card .fl-tile img[alt="포터 토트"]') };
    });
    assert.deepEqual(r, { tab: true, shown: true });
  });

  const MERGE_HELPERS = `
    window.mkFile = async (clothesRows, outfitsRows, tombstones) => new File([JSON.stringify({ app: 'my-wardrobe', version: '4.5', createdAt: new Date().toISOString(), clothes: await Promise.all(clothesRows.map(async c => ({ type: '', color: '회색', season: '사계절', formality: 2, createdAt: 1, wearCount: 0, lastWorn: null, ...c, image: await b64(c.blob || await jpeg('#777')), blob: undefined }))), outfits: outfitsRows || [], ...(tombstones ? { tombstones } : {}) })], 'backup.json', { type: 'application/json' });
    window.same = async id => { const c = (await clothesDB()).find(x => x.id === id); return c; };
  `;

  await check('Merge: wearing on the other device does not undo a content edit made here (wear is merged separately)', async page => {
    await page.evaluate(MERGE_HELPERS);
    const r = await page.evaluate(async () => {
      const img = await jpeg('#345');
      await seed([{ id: 'x', category: '상의', memo: '원래 이름', image: img, wearCount: 2 }]);
      openEdit('x'); document.getElementById('editMemo').value = 'PC에서 고친 이름'; await saveEdit();
      const f = await mkFile([{ id: 'x', category: '상의', memo: '원래 이름', blob: img, wearCount: 3, lastWorn: 9000 }]);
      await mergeBackup(f); const x = await same('x');
      return { memo: x.memo, wear: x.wearCount, last: x.lastWorn };
    });
    assert.deepEqual(r, { memo: 'PC에서 고친 이름', wear: 3, last: 9000 });
  });

  await check('Merge: unknown-age content differences are asked about; declining keeps this side and does not claim "same closet"', async page => {
    await page.evaluate(MERGE_HELPERS);
    const r = await page.evaluate(async () => {
      const img = await jpeg('#456'); await seed([{ id: 'x', category: '상의', memo: '여기 이름', image: img }]);
      const f = () => mkFile([{ id: 'x', category: '상의', memo: '저기 이름', blob: img }]);
      confirmQueue = [false]; await mergeBackup(await f()); const kept = (await same('x')).memo, t1 = toastText(), asked = confirms.at(-1);
      confirmQueue = [true, true]; await mergeBackup(await f()); const taken = (await same('x')).memo;
      return { kept, t1, asked, taken };
    });
    assert.equal(r.kept, '여기 이름'); assert.match(r.t1, /그대로 두었습니다/); assert.doesNotMatch(r.t1, /같은 옷장/); assert.match(r.asked, /알 수 없는/); assert.equal(r.taken, '저기 이름');
  });

  await check('Merge: deletions travel both ways (no revival of deleted outfits/worn dates; other-device deletions apply here) and backups carry the marks', async page => {
    await page.evaluate(MERGE_HELPERS);
    const r = await page.evaluate(async () => {
      await seed([{ id: 'a', category: '상의', memo: 'A' }, { id: 'z', category: '하의', memo: 'Z' }]);
      await transaction(['outfits'], 'readwrite', tx => { const s = tx.objectStore('outfits'); s.put({ id: 'o1', name: 'O1', slots: { top: 'a', bottom: 'z' }, createdAt: 1, worn: ['2026-09-20'] }); s.put({ id: 'o2', name: 'O2', slots: { top: 'a' }, createdAt: 2, worn: [] }); });
      await refresh(); goto('코디'); OF.unwear('o1', '2026-09-20'); await sleep(300); OF.del('o2'); await sleep(300);
      const old = await mkFile([{ id: 'a', category: '상의', memo: 'A' }, { id: 'z', category: '하의', memo: 'Z' }], [{ id: 'o1', name: 'O1', slots: { top: 'a', bottom: 'z' }, createdAt: 1, worn: ['2026-09-20'] }, { id: 'o2', name: 'O2', slots: { top: 'a' }, createdAt: 2, worn: [] }], { c: { z: Date.now() }, o: {}, w: {} });
      await mergeBackup(old); const os = await outfitsDB(), cs = await clothesDB();
      let got = null; window.downloadBlob = (b) => { got = b; }; await exportBackup(); const file = JSON.parse(await got.text());
      return { o2: os.some(o => o.id === 'o2'), o1worn: os.find(o => o.id === 'o1').worn, zGone: !cs.some(c => c.id === 'z'), slot: os.find(o => o.id === 'o1').slots.bottom, marks: Object.keys(file.tombstones.o).includes('o2') && Object.keys(file.tombstones.w).includes('o1|2026-09-20') && Object.keys(file.tombstones.c).includes('z') };
    });
    assert.deepEqual(r, { o2: false, o1worn: [], zGone: true, slot: null, marks: true });
  });

  await check('Merge re-reads inside the write: a change made while the dialog was open is kept; an edited outfit draft follows the merged outfit', async page => {
    await page.evaluate(MERGE_HELPERS);
    const r = await page.evaluate(async () => {
      const img = await jpeg('#567'); await seed([{ id: 'x', category: '상의', memo: 'X', image: img }, { id: 'y', category: '하의', memo: 'Y' }]);
      goto('코디'); OF.pick('top'); OF.choose('x'); OF.name('내 코디'); OF.save(); await sleep(300); const [o] = await outfitsDB();
      const f = await mkFile([{ id: 'x', category: '상의', memo: 'X', blob: img, wearCount: 1 }], [{ ...o, name: '폰에서 고친 이름', updatedAt: o.updatedAt + 1000 }]);
      window.onConfirm = t => { if (t.includes('합칠까요')) transaction(['clothes'], 'readwrite', tx => { const s = tx.objectStore('clothes'), q = s.get('x'); q.onsuccess = () => s.put({ ...q.result, wearCount: 7 }); }); };
      await mergeBackup(f); window.onConfirm = null;
      return { wear: (await same('x')).wearCount, name: (await outfitsDB())[0].name, draftName: document.getElementById('outfitName').value };
    });
    assert.deepEqual(r, { wear: 7, name: '폰에서 고친 이름', draftName: '폰에서 고친 이름' });
  });

  await check('Recommend: 다른 추천 shows new tops and bottoms; outer and shoes vary within a page; the reason text matches the result', async page => {
    const r = await page.evaluate(async () => {
      const specs = [];
      for (let i = 0; i < 7; i++) specs.push({ id: 'top' + i, category: '상의', memo: '상의' + i });
      for (let i = 0; i < 7; i++) specs.push({ id: 'bot' + i, category: '하의', memo: '하의' + i });
      for (let i = 0; i < 3; i++) specs.push({ id: 'sh' + i, category: '신발', memo: '신발' + i }, { id: 'ou' + i, category: '아우터', memo: '아우터' + i, season: '겨울' });
      await seed(specs); goto('코디 추천');
      $('occasion').value = '1'; $('weather').value = 'cold'; recommend(); const p1 = recommendations.map(c => c.slots);
      recommend(true); const p2 = recommendations.map(c => c.slots);
      const overlapT = p2.some(s => p1.some(q => q.top === s.top)), overlapB = p2.some(s => p1.some(q => q.bottom === s.bottom));
      $('occasion').value = '3'; $('weather').value = 'hot'; recommend(); const hotWhy = document.querySelector('#result .reason').textContent;
      return { overlapT, overlapB, outers: new Set(p1.map(s => s.outer)).size, shoes: new Set(p1.map(s => s.shoes)).size, hotOuter: recommendations.some(c => c.slots.outer), hotWhy };
    });
    assert.equal(r.overlapT, false); assert.equal(r.overlapB, false); assert.equal(r.outers, 3); assert.equal(r.shoes, 3); assert.equal(r.hotOuter, false); assert.doesNotMatch(r.hotWhy, /아우터/);
  });

  await check('추천으로 채우기 repeats without asking, changes both top and bottom, and asks only if the user changed the draft', async page => {
    const r = await page.evaluate(async () => {
      const specs = []; for (let i = 0; i < 4; i++) specs.push({ id: 'top' + i, category: '상의', memo: '상의' + i }, { id: 'bot' + i, category: '하의', memo: '하의' + i });
      await seed(specs); goto('코디'); await sleep(20);
      OF.fillRec(); const a = JSON.parse(localStorage.getItem('wardrobe.outfitDraft')).draft; OF.fillRec(); const b = JSON.parse(localStorage.getItem('wardrobe.outfitDraft')).draft;
      const asked = confirms.length; OF.pick('top'); OF.choose('top3'); confirmAnswer = false; OF.fillRec(); const askedAfterManual = confirms.length;
      return { asked, bothChanged: a.top !== b.top && a.bottom !== b.bottom, askedAfterManual };
    });
    assert.deepEqual(r, { asked: 0, bothChanged: true, askedAfterManual: 1 });
  });

  await check('PC click on a list button right after typing is not swallowed by the deferred redraw', async page => {
    await page.evaluate(async () => {
      visionModel = null; modelPromise = null; scriptLoads.clear(); delete window.tf; delete window.mobilenet;
      await $('photo').onchange({ target: { files: [new File([await jpeg('#123')], 'a.jpg', { type: 'image/jpeg' })], value: '' } }); goto('옷 등록');
    });
    await page.click('[aria-label="사진 1 메모"]'); await page.keyboard.type('셔츠');
    await page.evaluate(() => renderQueue());
    await page.click('#queue .q .quick button:first-child');
    await page.waitForTimeout(50);
    const r = await page.evaluate(() => ({ cat: batch[0].category, memo: batch[0].memo }));
    assert.deepEqual(r, { cat: '상의', memo: '셔츠' });
  });

  await check('Busy photo button looks disabled; plain toasts let taps through; stale orange outline is not drawn; ?debug=1 survives a reload', async page => {
    const r = await page.evaluate(async () => {
      processing = true; updateBatchButtons(); const off = document.getElementById('photoLabel').classList.contains('off'), offText = document.getElementById('photoLabel').textContent; processing = false; updateBatchButtons();
      toast('안내'); const pe = document.getElementById('appToast').style.pointerEvents;
      visionModel = null; modelPromise = null; scriptLoads.clear(); delete window.tf; delete window.mobilenet;
      await $('photo').onchange({ target: { files: [new File([await jpeg('#321')], 'a.jpg', { type: 'image/jpeg' })], value: '' } });
      batch[0].need = true; batch[0].category = '상의'; batch[0].color = '회색'; renderQueue(); const stale = !!document.querySelector('#queue .q.need');
      return { off, offText, pe, stale };
    });
    assert.equal(r.off, true); assert.match(r.offText, /끝나면/); assert.equal(r.pe, 'none'); assert.equal(r.stale, false);
    await page.goto(page.url().replace(/\/?(\?.*)?$/, '/?debug=1')); await page.waitForFunction(() => window.OF);
    await page.goto(page.url().replace(/\?.*$/, '')); await page.waitForFunction(() => window.OF);
    assert.equal(await page.evaluate(() => DEBUG), true);
  });

  await check('Offline: after one online visit the app shell opens with no network (service worker), and the manifest/icons are served', async (page, context) => {
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller && window.OF);
    const m = await page.evaluate(async () => { const r = await fetch('./manifest.webmanifest'); const j = await r.json(); const ic = await Promise.all(j.icons.map(i => fetch(i.src).then(r => r.ok))); return { name: j.name, start: j.start_url, icons: ic.every(Boolean), link: !!document.querySelector('link[rel=manifest]') && !!document.querySelector('link[rel=apple-touch-icon]') }; });
    await context.setOffline(true);
    await page.reload(); await page.waitForFunction(() => /옷 \d+벌/.test(document.getElementById('summary').textContent) && window.OF);
    const offline = await page.evaluate(() => ({ title: document.title, nav: document.querySelectorAll('nav button').length }));
    await context.setOffline(false);
    assert.deepEqual(m, { name: '내 옷장', start: './', icons: true, link: true }); assert.deepEqual(offline, { title: '내 옷장', nav: 4 });
  }, { sw: true });

  await check('A closed IndexedDB connection is reopened automatically for the next write', async page => {
    const r = await page.evaluate(async () => { await seed([{ id: 'x', category: '상의', memo: '셔츠' }]); db.close(); await wear('x'); return { count: (await clothesDB())[0].wearCount, alerts }; });
    assert.deepEqual(r, { count: 1, alerts: [] });
  });

  await check('If wardrobe-import.js fails to load, the closet still opens and works', async page => {
    const r = await page.evaluate(async () => { await seed([{ id: 'x', category: '상의', memo: '셔츠' }]); return { summary: document.getElementById('summary').textContent, cards: document.querySelectorAll('#items .item').length, extras: typeof initWardrobeExtras }; });
    assert.deepEqual(r, { summary: '옷 1벌 · 저장 코디 0개', cards: 1, extras: 'undefined' });
  }, { block: ['/wardrobe-import.js'] });

  await check('Restore rejects SVG photos, malformed outfit dates/slots and non-numeric counts before touching data; legacy outfit shapes still pass', async page => {
    const r = await page.evaluate(async () => {
      const img = await b64(await jpeg('#111')), base = { id: 'a', image: img, category: '상의', type: '', color: '회색', season: '사계절', formality: 2, memo: '', createdAt: 1, wearCount: 0, lastWorn: null };
      const tryIt = async o => { try { await prepareRestore({ app: 'my-wardrobe', version: '4.6', clothes: [base], outfits: [], ...o }); return 'ok'; } catch (e) { return e.message; } };
      return {
        svg: await tryIt({ clothes: [{ ...base, image: 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg"/>') }] }),
        worn: await tryIt({ outfits: [{ id: 'o', name: 'x', slots: { top: 'a' }, worn: ['어제'] }] }),
        slots: await tryIt({ outfits: [{ id: 'o', slots: { top: { x: 1 } } }] }),
        count: await tryIt({ clothes: [{ ...base, wearCount: '3' }] }),
        legacy: await tryIt({ outfits: [{ id: 42, legacyShape: { any: true } }] }),
      };
    });
    assert.match(r.svg, /JPEG·PNG/); assert.match(r.worn, /착용 날짜/); assert.match(r.slots, /칸/); assert.match(r.count, /wearCount/); assert.equal(r.legacy, 'ok');
  });

  await check('Saving the edit sheet writes only fields the user changed (keeps a change made elsewhere, adds no empty details)', async page => {
    const r = await page.evaluate(async () => {
      await basic(); openEdit('t2');
      await transaction(['clothes'], 'readwrite', tx => { const s = tx.objectStore('clothes'), q = s.get('t2'); q.onsuccess = () => s.put({ ...q.result, color: '네이비' }); });
      document.getElementById('editMemo').value = '화이트 옥스포드'; await saveEdit();
      const c = (await clothesDB()).find(x => x.id === 't2');
      return { memo: c.memo, color: c.color, details: 'wardrobeDetails' in c };
    });
    assert.deepEqual(r, { memo: '화이트 옥스포드', color: '네이비', details: false });
  });

  await check('Product title hints: the last garment noun decides (니트 가디건 → 가디건, 부츠컷 청바지 → 데님); no garment noun abstains; only tracking parameters are dropped', async page => {
    const names = ['데님 셔츠', '패딩 크로스백', '데님 자켓', '패딩 자켓', '청바지', '오버핏 셔츠', '크루넥 티셔츠', '가죽 로퍼', '테스트 다운 패딩', '패딩 부츠', '가방',
      '니트 가디건', '니트 조거 팬츠', '스웨트셔츠', '폴로 셔츠', '부츠컷 청바지', '와이드 반바지', '후드 자켓', '데님 팬츠', 'Denim Shirt', 'Puffer Jacket', '울 코트'];
    const r = await page.evaluate(names => ({
      t: names.map(n => { const x = productTitleSuggestion(n); return x.category ? x.category + '·' + (x.type || '-') : '보류'; }),
      url: productMetadata({ url: 'https://shop.example/p/1?color=navy&utm_source=ig&fbclid=abc&gclid=z&opt=a%2Cb' }).url,
      bad: productMetadata({ url: 'https://shop.example/p/2?%E0%A4%A=1&utm_medium=x' }).url,
    }), names);
    assert.deepEqual(r.t, ['상의·셔츠', '가방·크로스백', '아우터·재킷', '아우터·패딩', '하의·데님', '상의·셔츠', '상의·티셔츠', '신발·로퍼', '아우터·패딩', '신발·부츠', '보류',
      '아우터·가디건', '하의·-', '상의·맨투맨', '상의·폴로', '하의·데님', '하의·쇼츠', '아우터·재킷', '하의·데님', '상의·셔츠', '아우터·패딩', '아우터·코트']);
    assert.equal(r.url, 'https://shop.example/p/1?color=navy&opt=a%2Cb');
    assert.equal(r.bad, 'https://shop.example/p/2?%E0%A4%A=1');
  });

  await check('Safari extractor uses canonical only when it is the same page path, and drops only tracking parameters', async (page, context) => {
    const p = await context.newPage(), code = readFileSync(join(root, 'product-shortcut.js'), 'utf8'), o = `http://127.0.0.1:${server.address().port}`;
    await p.goto(`${o}/shortcut-help.html?id=3&utm_source=ig&fbclid=z`);
    const run = canonical => p.evaluate(([code, canonical]) => new Promise(resolve => {
      document.querySelectorAll('link[rel=canonical]').forEach(l => l.remove());
      if (canonical) { const l = document.createElement('link'); l.rel = 'canonical'; l.href = canonical; document.head.append(l); }
      window.completion = out => resolve(JSON.parse(out.metadata).product.url); (0, eval)(code);
    }), [code, canonical]);
    const r = { none: await run(''), other: await run('https://other.example/product/9'), list: await run(`${o}/category/list`), same: await run(`${o}/shortcut-help.html?utm_medium=a&opt=a%2Cb`) };
    await p.close();
    assert.deepEqual(r, { none: `${o}/shortcut-help.html?id=3`, other: `${o}/shortcut-help.html?id=3`, list: `${o}/shortcut-help.html?id=3`, same: `${o}/shortcut-help.html?opt=a%2Cb` });
  });

  await check('Shortcut code is fetched when the setup box opens and copied on the first tap', async page => {
    const r = await page.evaluate(async () => {
      let copied = ''; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async t => { copied = t; } } });
      goto('옷 등록'); document.getElementById('productCard').open = true; const det = document.getElementById('shortcutCode').closest('details'); det.open = true; await sleep(300);
      await copyShortcutScript();
      return { ok: copied.includes('my-wardrobe-product'), status: document.getElementById('shortcutStatus').textContent };
    });
    assert.deepEqual(r, { ok: true, status: '단축어 코드를 복사했습니다.' });
  });

  await check('In the home-screen app the shortcut help opens in the same window (not Safari) and no Safari-tab warning shows', async page => {
    const r = await page.evaluate(async () => { await basic(); return { target: document.getElementById('shortcutHelpLink').getAttribute('target'), tabWarn: document.getElementById('safety').innerText.includes('Safari 탭') }; });
    assert.deepEqual(r, { target: null, tabWarn: false });
  }, { iphone: true, standalone: true });

  await check('Version is the same in APP_VERSION, version.json, the visible labels and both cache-busting script URLs', async page => {
    const r = await page.evaluate(async () => { const html = await (await fetch('./index.html', { cache: 'no-store' })).text(), v = (await (await fetch('./version.json', { cache: 'no-store' })).json()).version; return { v, app: APP_VERSION, label: html.includes(`현재 버전 <b>v${v}</b>`), foot: html.includes(`Wardrobe v${v}`), imp: html.includes(`wardrobe-import.js?v=${v}`), out: html.includes(`outfits.js?v=${v}`) }; });
    assert.equal(r.app, r.v); assert.deepEqual([r.label, r.foot, r.imp, r.out], [true, true, true, true]);
  });

  await check('CDN model scripts are pinned and checked with integrity hashes', async page => {
    const r = await page.evaluate(() => ({ keys: Object.keys(SRI), used: Object.keys(SRI).every(u => loadVisionModel.toString().includes(u)), sha: Object.values(SRI).every(h => /^sha384-[A-Za-z0-9+/]{64}$/.test(h)) }));
    assert.equal(r.keys.length, 2); assert.equal(r.used, true); assert.equal(r.sha, true);
  });

  await check('Offline right after the first visit: closet and both helper scripts open from the install cache; version.json is never cached; other script versions are not substituted', async (page, context) => {
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await context.setOffline(true);
    await page.reload(); await page.waitForFunction(() => /옷 \d+벌/.test(document.getElementById('summary').textContent) && window.OF);
    const r = await page.evaluate(async () => {
      const al = []; window.alert = t => al.push(String(t));
      const fails = u => fetch(u).then(() => false, () => true);
      const names = await caches.keys(), keys = (await (await caches.open(names[0])).keys()).map(k => new URL(k.url).pathname + new URL(k.url).search);
      await checkUpdate(true);
      return { names, v: APP_VERSION, extras: typeof initWardrobeExtras, outfits: keys.includes(`/outfits.js?v=${APP_VERSION}`), imp: keys.includes(`/wardrobe-import.js?v=${APP_VERSION}`), junk: keys.filter(k => /[?&](t|refresh)=|version\.json/.test(k)),
        version: await fails('./version.json'), other: await fails('./outfits.js?v=0.1'), al };
    });
    await context.setOffline(false);
    assert.deepEqual(r.names, [`wardrobe-shell-${r.v}`]);
    assert.deepEqual([r.extras, r.outfits, r.imp, r.junk, r.version, r.other], ['function', true, true, [], true, true]);
    assert.match(r.al[0] || '', /오프라인/);
  }, { sw: true });

  await check('Offline: the shortcut help page opens from cache (not the closet), and an unknown page shows an offline notice', async (page, context) => {
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    const o = `http://127.0.0.1:${server.address().port}`;
    await context.setOffline(true);
    await page.goto(`${o}/shortcut-help.html`); const help = await page.title();
    await page.goto(`${o}/nothing.html`); const nothing = await page.evaluate(() => document.body.innerText);
    await context.setOffline(false);
    assert.equal(help, '상품 가져오기 설정 · 내 옷장'); assert.match(nothing, /오프라인이라 이 페이지를 열 수 없습니다/);
  }, { sw: true });

  await check('Weak signal: if the app page takes longer than ~4 s the saved copy opens instead of waiting', async page => {
    await page.evaluate(async () => { await navigator.serviceWorker.ready; });
    await page.reload(); await page.waitForFunction(() => !!navigator.serviceWorker.controller && window.OF);
    slowMs = 9000; const t0 = Date.now();
    try { await page.reload({ waitUntil: 'domcontentloaded' }); await page.waitForFunction(() => window.OF, null, { timeout: 8000 }); } finally { slowMs = 0; }
    const ms = Date.now() - t0;
    assert.ok(ms >= 3500 && ms < 8000, `opened after ${ms} ms`);
    // 강제 새로고침(refresh 값)은 옛 사본으로 끊지 않고 새 화면을 기다린다
    slowMs = 5500; const t1 = Date.now();
    try { await page.goto(page.url().replace(/\/?(\?.*)?$/, `/?refresh=${t1}`), { waitUntil: 'domcontentloaded', timeout: 15000 }); await page.waitForFunction(() => window.OF); } finally { slowMs = 0; }
    const waited = Date.now() - t1;
    assert.ok(waited >= 5000, `refresh opened after ${waited} ms`);
  }, { sw: true });

  await check('Home-screen app: tapping the shortcut help link asks first when there is unsaved work (cancel stays); with nothing unsaved it just opens', async page => {
    const r = await page.evaluate(async () => {
      batch.push({ id: 'draft' }); window.confirmAnswer = false;
      document.getElementById('shortcutHelpLink').click(); await sleep(300);
      const stayed = location.pathname.endsWith('/') || location.pathname.endsWith('/index.html');
      batch.length = 0; return { stayed, asked: confirms.length };
    });
    assert.deepEqual(r, { stayed: true, asked: 1 });
    await Promise.all([page.waitForURL(/shortcut-help\.html/), page.evaluate(() => document.getElementById('shortcutHelpLink').click())]);
  }, { iphone: true, standalone: true });

  await check('A lost IndexedDB connection does not stop the next-day redraw or the back-navigation refresh (reconnects and reads new data)', async page => {
    const r = await page.evaluate(async () => {
      await seed([{ id: 'x', category: '상의', memo: '셔츠' }]);
      await transaction(['clothes'], 'readwrite', tx => { tx.objectStore('clothes').put({ ...clothes[0], id: 'y', category: '하의', memo: '바지', createdAt: 5000 }); });
      renderedDate = '2000-01-01'; db.close(); db = null;
      document.dispatchEvent(new Event('visibilitychange')); const redrawn = renderedDate === localDate();
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })); await sleep(600);
      return { redrawn, cards: document.querySelectorAll('#items .item').length, db: !!db };
    });
    assert.deepEqual(r, { redrawn: true, cards: 2, db: true });
  });

  await check('Reconnecting shares one attempt and gives up after 8 s instead of hanging; the refresh button still works while a save looks stuck', async page => {
    const r = await page.evaluate(async () => {
      db.close(); db = null; const a = reopenDB(), b = reopenDB(), shared = a === b; await a;
      const orig = openDB; openDB = () => new Promise(() => {}); db.close(); db = null;
      const t0 = Date.now(); let msg = '';
      try { await transaction(['clothes'], 'readonly', tx => { tx.objectStore('clothes').count(); }); } catch (e) { msg = e.message; }
      const ms = Date.now() - t0; openDB = orig; await reopenDB();
      mutationBusy = true; window.confirmAnswer = false; forceReload(); mutationBusy = false;
      return { shared, msg, ms, ask: confirms.at(-1) || '' };
    });
    assert.equal(r.shared, true); assert.match(r.msg, /다시 열지 못했습니다/); assert.ok(r.ms >= 7500 && r.ms < 12000, `${r.ms} ms`); assert.match(r.ask, /그래도 새로고침할까요/);
  });

  await check('If wardrobe-import.js fails to load, editing a garment still opens, saves and closes; restoring details asks for a reload instead of crashing', async page => {
    const r = await page.evaluate(async () => {
      await seed([{ id: 'x', category: '상의', memo: '셔츠' }]);
      openEdit('x'); const opened = document.getElementById('editModal').classList.contains('open');
      document.getElementById('editMemo').value = '옥스포드 셔츠'; await saveEdit();
      const c = (await clothesDB())[0], closedAfterSave = !document.getElementById('editModal').classList.contains('open');
      openEdit('x'); const closed = closeEdit() !== false && !document.getElementById('editModal').classList.contains('open');
      const img = await b64(await jpeg('#222')), base = { id: 'a', image: img, category: '상의', type: '', color: '회색', season: '사계절', formality: 2, memo: '', createdAt: 1, wearCount: 0, lastWorn: null };
      const tryIt = async c => { try { await prepareRestore({ app: 'my-wardrobe', version: '4.6', clothes: [c], outfits: [] }); return 'ok'; } catch (e) { return e.message; } };
      return { opened, memo: c.memo, details: 'wardrobeDetails' in c, closedAfterSave, closed, plain: await tryIt(base), withDetails: await tryIt({ ...base, wardrobeDetails: { product: { name: 'x' } } }), alerts };
    });
    assert.deepEqual({ ...r, withDetails: undefined }, { opened: true, memo: '옥스포드 셔츠', details: false, closedAfterSave: true, closed: true, plain: 'ok', withDetails: undefined, alerts: [] });
    assert.match(r.withDetails, /새로고침한 뒤 다시 복원/);
  }, { block: ['/wardrobe-import.js'] });

  await check('Formality is two levels (캐주얼/포멀): old 1·2 read as 캐주얼 and 3·4 as 포멀 without rewriting stored values; purpose names drop the formality words', async page => {
    const r = await page.evaluate(async () => {
      await seed([{ id: 'a', category: '상의', memo: '옛 스마트캐주얼' }, { id: 'b', category: '하의', memo: '옛 포멀' }, { id: 'c', category: '신발', memo: '옛 비즈니스' }]);
      await transaction(['clothes'], 'readwrite', tx => { const st = tx.objectStore('clothes'); for (const [id, f] of [['a', 2], ['b', 4], ['c', 3]]) { const q = st.get(id); q.onsuccess = () => st.put({ ...q.result, formality: f }); } });
      await refresh();
      const labels = [...new DOMParser().parseFromString(`<select>${opts(FOR, 1)}</select>`, 'text/html').querySelectorAll('option')].map(o => o.textContent);
      const shown = id => { openEdit(id); const el = document.getElementById('editFormality'), v = el.value, t = el.selectedOptions[0].textContent; return v + t; };
      const a = shown('a'); window.confirmAnswer = false; const before = confirms.length; OF.addToOutfit(); const askedDirty = confirms.length > before; closeEdit();
      const b = shown('b'); closeEdit(); const c = shown('c'); closeEdit();
      openEdit('a'); document.getElementById('editMemo').value = '메모만 수정'; await saveEdit();
      openEdit('c'); document.getElementById('editFormality').value = '1'; await saveEdit();
      const db = Object.fromEntries((await clothesDB()).map(x => [x.id, x.formality]));
      const occ = [...document.getElementById('occasion').options].map(o => o.textContent).join('|');
      return { labels, a, b, c, askedDirty, db, occ };
    });
    assert.deepEqual(r.labels, ['캐주얼', '포멀']);
    assert.deepEqual([r.a, r.b, r.c], ['1캐주얼', '3포멀', '3포멀']);
    assert.equal(r.askedDirty, false, 'opening an old 스마트캐주얼 item must not look like an unsaved change');
    assert.deepEqual(r.db, { a: 2, b: 4, c: 1 });
    assert.ok(!/스마트|비즈니스/.test(r.occ), r.occ);
  });

  await check('Color select shows 블루 as 블루·하늘색 (saxe/sky blue go there) while the stored value stays 블루', async page => {
    const r = await page.evaluate(async () => {
      await seed([{ id: 'a', category: '상의', memo: '삭스블루 셔츠', color: '블루' }]);
      openEdit('a'); const el = document.getElementById('editColor'), shown = el.value + '|' + el.selectedOptions[0].textContent; closeEdit();
      return { shown, list: [...el.options].some(o => o.textContent === '블루'), stored: (await clothesDB())[0].color };
    });
    assert.deepEqual(r, { shown: '블루|블루·하늘색', list: false, stored: '블루' });
  });

  await check('Recommendation scores use the two formality levels (출근 prefers 포멀, 주말 prefers 캐주얼, 데이트 neutral); new photos and shop imports default to 캐주얼', async page => {
    const r = await page.evaluate(async () => {
      const s = (f, t) => itemScore({ season: '사계절', formality: f, lastWorn: null }, t, 'normal');
      goto('옷 등록');
      const file = new File([await jpeg('#345')], 'x.jpg', { type: 'image/jpeg' }), dt = new DataTransfer(); dt.items.add(file);
      const input = document.getElementById('photo'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 100 && !batch.length; i++) await sleep(50);
      const photoDefault = batch[0]?.formality; batch.length = 0;
      return { same12: s(1, 3) === s(2, 3), same34: s(3, 3) === s(4, 3), work: s(3, 3) > s(1, 3), weekend: s(1, 1) > s(3, 1), date: s(1, 2) === s(3, 2), photoDefault,
        importDefault: /formality:1,memo:p\.name/.test(queueProduct.toString()) };
    });
    assert.deepEqual(r, { same12: true, same34: true, work: true, weekend: true, date: true, photoDefault: 1, importDefault: true });
  });

  await check('Photo margin auto-trim: plain or cut-out backgrounds are trimmed around the garment (keeping a margin); busy backgrounds and label photos are left as they are', async page => {
    const r = await page.evaluate(async () => {
      const make = async (w, h, draw, type = 'image/jpeg') => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h); return new File([await new Promise(r => c.toBlob(r, type, .92))], 'p', { type }); };
      const size = async b => { const im = await blobImage(b); return [im.naturalWidth, im.naturalHeight]; };
      const white = await make(400, 300, (x, w, h) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.fillStyle = '#1b2a4a'; x.fillRect(120, 70, 160, 160); });
      const cut = await make(300, 300, x => { x.fillStyle = '#111'; x.beginPath(); x.arc(150, 150, 60, 0, 7); x.fill(); }, 'image/png');
      const busy = await make(400, 300, (x, w, h) => { for (let i = 0; i < 400; i++) { x.fillStyle = `hsl(${(i * 37) % 360},60%,${30 + (i * 13) % 50}%)`; x.fillRect((i * 53) % w, (i * 29) % h, 40, 30); } });
      const w1 = await f2b(white), c1 = await f2b(cut), b1 = await f2b(busy), l1 = await f2b(white, { trim: false });
      const corner = await (async () => { const im = await blobImage(c1), c = document.createElement('canvas'); c.width = im.naturalWidth; c.height = im.naturalHeight; c.getContext('2d').drawImage(im, 0, 0); return [...c.getContext('2d').getImageData(2, 2, 1, 1).data.slice(0, 3)]; })();
      return { white: await size(w1), color: (await estimateColor(w1)).name, cut: await size(c1), corner, busy: await size(b1), label: await size(l1) };
    });
    assert.ok(r.white[0] >= 195 && r.white[0] <= 215 && r.white[1] >= 195 && r.white[1] <= 215, `white ${r.white}`);
    assert.equal(r.color, '네이비');
    assert.ok(r.cut[0] >= 140 && r.cut[0] <= 170, `cut ${r.cut}`); assert.ok(r.corner.every(v => v > 240), `corner ${r.corner}`);
    assert.deepEqual(r.busy, [400, 300]); assert.deepEqual(r.label, [400, 300]);
  });

  await check('Auto-trim safety: full-frame garments, low-contrast cream on white and long slacks keep the whole garment; undo restores the untrimmed photo in the list and the edit sheet', async page => {
    const r = await page.evaluate(async () => {
      const make = async (w, h, draw) => { const c = document.createElement('canvas'); c.width = w; c.height = h; const x = c.getContext('2d'); draw(x, w, h); return new File([await new Promise(r => c.toBlob(r, 'image/jpeg', .92))], 'p.jpg', { type: 'image/jpeg' }); };
      const size = async b => { const im = await blobImage(b); return [im.naturalWidth, im.naturalHeight]; };
      const navyFull = await make(900, 1200, (x, w, h) => { x.fillStyle = '#1b2a4a'; x.fillRect(0, 0, w, h); x.fillStyle = '#fff'; x.fillRect(380, 400, 140, 60); });
      const cream = await make(900, 1200, (x, w, h) => { x.fillStyle = '#fcfcfc'; x.fillRect(0, 0, w, h); x.fillStyle = '#f1ecdf'; x.fillRect(150, 240, 600, 720); x.fillStyle = '#8a6d3b'; x.fillRect(445, 300, 10, 600); });
      const slacks = await make(900, 1200, (x, w, h) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.fillStyle = '#555'; x.fillRect(330, 60, 240, 1080); });
      const nf = await size(await f2b(navyFull)), cr = await f2b(cream), crs = await size(cr), sl = await size(await f2b(slacks));
      // 등록 목록: 자른 사진에는 '자르지 않은 사진으로'가 보이고 누르면 원래 크기로
      goto('옷 등록'); const white = await make(400, 300, (x, w, h) => { x.fillStyle = '#fff'; x.fillRect(0, 0, w, h); x.fillStyle = '#1b2a4a'; x.fillRect(120, 70, 160, 160); });
      const dt = new DataTransfer(); dt.items.add(white); const input = document.getElementById('photo'); input.files = dt.files; input.dispatchEvent(new Event('change', { bubbles: true }));
      for (let i = 0; i < 100 && !(batch.length && !processing); i++) await sleep(50);
      const btn = () => [...document.querySelectorAll('#queue button')].find(b => b.textContent === '자르지 않은 사진으로');
      const listBefore = [await size(batch[0].image), !!btn()]; await untrimPending(0); const listAfter = [await size(batch[0].image), !!btn()]; batch.length = 0; renderQueue();
      // 수정 창
      await seed([{ id: 'a', category: '상의', memo: '셔츠' }]); openEdit('a'); await chooseEditPhoto(white);
      const editBefore = [await size(pendingImage), !document.getElementById('editUntrimBtn').hidden]; await untrimEditPhoto();
      const editAfter = [await size(pendingImage), !document.getElementById('editUntrimBtn').hidden]; closeEdit();
      return { nf, crs, sl, listBefore, listAfter, editBefore, editAfter };
    });
    assert.deepEqual(r.nf, [900, 1200], 'a full-frame garment must not be trimmed to its logo');
    assert.ok(r.crs[0] >= 600 * 1.2 && r.crs[1] >= 720 * 1.2, `cream kept ${r.crs}`);
    assert.ok(r.sl[0] / r.sl[1] >= 0.59, `slacks aspect ${r.sl}`);
    assert.equal(r.listBefore[1], true); assert.ok(r.listBefore[0][0] < 300); assert.deepEqual(r.listAfter, [[400, 300], false]);
    assert.equal(r.editBefore[1], true); assert.ok(r.editBefore[0][0] < 300); assert.deepEqual(r.editAfter, [[400, 300], false]);
  });

  await check('A care-label photo still being prepared is dropped when the sheet is closed and another garment opened (not saved onto it)', async page => {
    const r = await page.evaluate(async () => {
      await seed([{ id: 'a', category: '상의', memo: 'A' }, { id: 'b', category: '상의', memo: 'B' }]);
      const orig = f2b; f2b = async (...a) => { await sleep(500); return orig(...a); };
      const label = new File([await jpeg('#eee', 200)], 'label.jpg', { type: 'image/jpeg' });
      openEdit('a'); const job = chooseCarePhoto(label); await sleep(50); closeEdit(); openEdit('b'); await job; f2b = orig;
      document.getElementById('editMemo').value = 'B 메모'; await saveEdit();
      const rows = Object.fromEntries((await clothesDB()).map(c => [c.id, !!c.wardrobeDetails?.care?.labelImage]));
      return rows;
    });
    assert.deepEqual(r, { a: false, b: false });
  });

  await check('Work recommendations stay formal on hot and cold days (no shorts, sandals or padding), and a date prefers a shirt over a hoodie among casual tops', async page => {
    const r = await page.evaluate(async () => {
      const spec = [['tf', '상의', '셔츠', '봄/가을', 3], ['tc', '상의', '티셔츠', '여름', 1], ['bf', '하의', '슬랙스', '사계절', 3], ['bc', '하의', '쇼츠', '여름', 1],
        ['sf', '신발', '구두', '사계절', 3], ['sc', '신발', '샌들', '여름', 1], ['of', '아우터', '코트', '겨울', 3], ['oc', '아우터', '패딩', '겨울', 1]];
      await seed(spec.map(([id, category, type]) => ({ id, category, type, memo: type })));
      await transaction(['clothes'], 'readwrite', tx => { const st = tx.objectStore('clothes'); for (const [id, , , season, formality] of spec) { const q = st.get(id); q.onsuccess = () => st.put({ ...q.result, season, formality, color: '회색' }); } });
      await refresh();
      const hot = recommendCombos(3, 'hot')[0].slots, cold = recommendCombos(3, 'cold')[0].slots;
      await seed([{ id: 'h1', category: '상의', type: '후드', memo: '후드' }, { id: 's1', category: '상의', type: '셔츠', memo: '셔츠' }, { id: 'p1', category: '하의', type: '데님', memo: '데님' }]);
      await transaction(['clothes'], 'readwrite', tx => { const st = tx.objectStore('clothes'); for (const id of ['tf', 'tc', 'bf', 'bc', 'sf', 'sc', 'of', 'oc']) st.delete(id); for (const id of ['h1', 's1', 'p1']) { const q = st.get(id); q.onsuccess = () => st.put({ ...q.result, color: '회색', formality: 1 }); } });
      await refresh();
      return { hot: [hot.top, hot.bottom, hot.shoes], cold: [cold.top, cold.bottom, cold.shoes, cold.outer], date: recommendCombos(2, 'normal')[0].slots.top };
    });
    assert.deepEqual(r.hot, ['tf', 'bf', 'sf']); assert.deepEqual(r.cold, ['tf', 'bf', 'sf', 'of']); assert.equal(r.date, 's1');
  });

  await check('Purposes are 주말·데이트·출근/격식 (3); a combo keeps one formality level (no dress shirt + shorts + sandals on a date); merge treats old 2 and new 1 as the same content', async page => {
    const r = await page.evaluate(async () => {
      const occ = [...document.getElementById('occasion').options].map(o => o.value + o.textContent);
      await seed([
        { id: 'tc', category: '상의', memo: '후드' }, { id: 'tf', category: '상의', memo: '드레스셔츠' },
        { id: 'bc', category: '하의', memo: '반바지' }, { id: 'bf', category: '하의', memo: '정장바지' },
        { id: 'sc', category: '신발', memo: '샌들' }, { id: 'sf', category: '신발', memo: '구두' },
      ]);
      await transaction(['clothes'], 'readwrite', tx => { const st = tx.objectStore('clothes'); for (const id of ['tc', 'bc', 'sc', 'tf', 'bf', 'sf']) { const q = st.get(id); q.onsuccess = () => st.put({ ...q.result, color: '회색', formality: id.endsWith('f') ? 3 : 1 }); } });
      await refresh();
      const lv = id => formalityLevel(clothes.find(c => c.id === id).formality);
      const combos = recommendCombos(2, 'normal').slice(0, 2).map(c => [c.slots.top, c.slots.bottom, c.slots.shoes]);
      const coherent = combos.every(ids => new Set(ids.map(lv)).size === 1);
      const work = recommendCombos(3, 'normal')[0].slots.top, weekend = recommendCombos(1, 'normal')[0].slots.top;
      const base = { category: '상의', type: '', color: '회색', season: '사계절', memo: '', archived: undefined, partial: undefined, image: null };
      return { occ, coherent, combos, work, weekend, same21: sameContent({ ...base, formality: 2 }, { ...base, formality: 1 }), same23: sameContent({ ...base, formality: 2 }, { ...base, formality: 3 }) };
    });
    assert.deepEqual(r.occ, ['1주말 / 편한 외출', '2데이트', '3출근·격식 있는 자리']);
    assert.equal(r.coherent, true, JSON.stringify(r.combos));
    assert.deepEqual([r.work, r.weekend], ['tf', 'tc']);
    assert.deepEqual([r.same21, r.same23], [true, false]);
  });

  await check('Shop import: the paste button reads the clipboard straight into a preview (also from the closet tab), without drawing the long text in the box', async page => {
    const r = await page.evaluate(async () => {
      const img = await b64(await jpeg('#246', 120));
      const pkg = JSON.stringify({ metadata: JSON.stringify({ app: 'my-wardrobe-product', version: 1, product: { name: '울 니트 - 사이즈 & 후기 | 무신사', brand: '테스트', listedPrice: '39,900' } }), imageBase64: img.split(',')[1] });
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: async () => pkg, writeText: async () => {} } });
      const g = window.goto; delete window.goto; document.getElementById('closetPasteBtn').click(); window.goto = g; // 앱에는 goto가 없다(검사용 도우미)
      for (let i = 0; i < 100 && !productDraft; i++) await sleep(50);
      const onAdd = document.getElementById('add').classList.contains('active'), open = document.getElementById('productCard').open;
      return { onAdd, open, box: document.getElementById('productPayload').value, name: document.getElementById('productName').value, price: productDraft.product.listedPrice, photo: !!productDraft.image };
    });
    assert.deepEqual(r, { onAdd: true, open: true, box: '', name: '울 니트', price: '39900', photo: true });
  });

  await check('Shop import recovers common Shortcut mistakes: line breaks inside the photo text; a broken photo text falls back to the photo address; wrong server content-type is sniffed', async page => {
    const port = server.address().port, jpg = readFileSync(join(__dirname, '..', 'icon-192.png'));
    await page.route(`http://127.0.0.1:${port}/fake-shop/img.jpg`, route => route.fulfill({ status: 200, headers: { 'content-type': 'application/x-www-form-urlencoded', 'access-control-allow-origin': '*' }, body: jpg }));
    const r = await page.evaluate(async port => {
      const img = await b64(await jpeg('#246', 120)), part = img.split(',')[1];
      const meta = JSON.stringify({ app: 'my-wardrobe-product', version: 1, product: { name: '셔츠' }, imageUrl: `http://127.0.0.1:${port}/fake-shop/img.jpg` });
      const wrapped = '{"metadata": ' + JSON.stringify(meta) + ', "imageBase64": "' + part.slice(0, 40) + '\n' + part.slice(40) + '"}';
      goto('옷 등록'); await previewProduct(wrapped); const a = { photo: !!productDraft?.image, status: document.getElementById('productStatus').textContent };
      await previewProduct(JSON.stringify({ metadata: meta, imageBase64: '@@깨진사진@@' })); const b = { photo: !!productDraft?.image, name: productDraft?.product.name };
      await previewProduct('{"metadata": "{"app":"my-wardrobe-product"}"}'); const c = document.getElementById('productStatus').textContent;
      return { a, b, c };
    }, port);
    assert.equal(r.a.photo, true, r.a.status); assert.deepEqual(r.b, { photo: true, name: '셔츠' }); assert.match(r.c, /따옴표/);
  });

  await check('Shop import accepts a pasted product page HTML (app share path) and a bare address the shop allows; a blocked address explains the Safari route', async page => {
    const port = server.address().port, o = `http://127.0.0.1:${port}`;
    const html = `<!doctype html><html><head><meta property="og:title" content="브이넥 니트 - 감도 깊은 취향 셀렉트샵 29CM"><meta property="og:image" content="/fake-shop/img.jpg"><link rel="canonical" href="${o}/fake-shop/products/1"><script type="application/ld+json">{"@type":"Product","name":"브이넥 니트","brand":{"name":"브랜드A"},"offers":{"price":"239000","priceCurrency":"KRW"}}</script></head><body>본문</body></html>`;
    const jpg = readFileSync(join(__dirname, '..', 'icon-192.png'));
    await page.route(`${o}/fake-shop/img.jpg`, route => route.fulfill({ status: 200, headers: { 'content-type': 'image/png' }, body: jpg }));
    await page.route(`${o}/fake-shop/products/1`, route => route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=utf-8' }, body: html }));
    await page.route(`${o}/fake-shop/blocked`, route => route.abort());
    const r = await page.evaluate(async ([html, o]) => {
      goto('옷 등록'); await previewProduct(html);
      const a = { name: productDraft?.product.name, brand: productDraft?.product.brand, url: productDraft?.product.url, price: productDraft?.product.listedPrice, photo: !!productDraft?.image };
      await previewProduct(`${o}/fake-shop/products/1`); const b = { name: productDraft?.product.name, photo: !!productDraft?.image };
      await previewProduct(`${o}/fake-shop/blocked`); const c = document.getElementById('productStatus').textContent;
      return { a, b, c };
    }, [html, o]);
    assert.deepEqual(r.a, { name: '브이넥 니트', brand: '브랜드A', url: `${o}/fake-shop/products/1`, price: '239000', photo: true });
    assert.deepEqual(r.b, { name: '브이넥 니트', photo: true });
    assert.match(r.c, /Safari에서 상품 페이지를 열고/);
  });

  await check('Extractor reads Cafe24 ProductGroup/hasVariant (brand, code) and the sale price; the app shortens the Cafe24 code and prefers the Cafe24 photo server and Musinsa large photos', async (page, context) => {
    const p = await context.newPage(), code = readFileSync(join(root, 'product-shortcut.js'), 'utf8'), o = `http://127.0.0.1:${server.address().port}`;
    await p.goto(`${o}/shortcut-help.html`);
    const out = await p.evaluate(code => new Promise(resolve => {
      document.head.innerHTML = '<meta property="og:title" content="CANVAS WORK PANTS (OLIVE)"><meta property="og:image" content="https://m.lokward.com/web/product/big/202605/abc.jpeg"><meta property="product:price:amount" content="64000"><meta property="product:sale_price:amount" content="58900"><meta property="product:sale_price:currency" content="KRW"><link rel="canonical" href="' + location.href + '">';
      const s = document.createElement('script'); s.type = 'application/ld+json';
      s.textContent = JSON.stringify({ '@context': 'https://schema.org', '@type': 'ProductGroup', '@id': location.href, name: 'CANVAS WORK PANTS (OLIVE)', productGroupID: 'cafe24_lokward1_1_1118', hasVariant: [{ '@type': 'Product', name: 'CANVAS WORK PANTS (OLIVE) M', brand: { '@type': 'Brand', name: 'LOKWARD' }, sku: 'cafe24_lokward1_1_1118_P0000BRA000A', size: 'M', offers: { '@type': 'Offer', price: 64000, priceCurrency: 'KRW' } }] });
      document.head.append(s); window.completion = r => resolve(r); (0, eval)(code);
    }), code);
    await p.close();
    const meta = JSON.parse(out.metadata).product;
    assert.deepEqual([meta.name, meta.brand, meta.sku, meta.size, meta.listedPrice, meta.currency], ['CANVAS WORK PANTS (OLIVE)', 'LOKWARD', 'cafe24_lokward1_1_1118', '', '58900', 'KRW']);
    const r = await page.evaluate(meta => {
      const d = parseProductPackage(JSON.stringify({ app: 'my-wardrobe-product', version: 1, product: meta, imageUrl: 'https://m.lokward.com/web/product/big/202605/abc.jpeg' }));
      return { sku: d.product.sku, mall: d.mall, lok: imageCandidates(d.imageUrl, d.mall), ms: imageCandidates('https://image.msscdn.net/images/goods_img/20240101/2093486/2093486_1_500.jpg', '') };
    }, meta);
    assert.deepEqual(r.lok, ['https://cafe24img.poxo.com/lokward1/web/product/big/202605/abc.jpeg', 'https://m.lokward.com/web/product/big/202605/abc.jpeg']);
    assert.deepEqual([r.sku, r.mall], ['1118', 'lokward1']);
    assert.deepEqual(r.ms, ['https://image.msscdn.net/images/goods_img/20240101/2093486/2093486_1_big.jpg', 'https://image.msscdn.net/images/goods_img/20240101/2093486/2093486_1_500.jpg']);
  });

  await check('Product name color: bracket/underscore/dash color words map to the 12 colors (brand words ignored, two colors abstain); queued item uses it; Base64 page HTML (app-share Shortcut) previews', async page => {
    const r = await page.evaluate(async () => {
      const names = ['오버사이즈 옥스포드 셔츠 [화이트]', '라이트 헌팅 자켓 (차콜)', '옥스포드 버튼다운 셔츠_네이비', 'CANVAS WORK PANTS (OLIVE)', 'Kyale henry knit - navy', '오프화이트 니트', '체크 셔츠 네이비/그린', '삭스블루 셔츠',
        '스웨이드 블루종', '크루 삭스 3팩', '내추럴 핏 셔츠 블랙', '블랙워치 체크 셔츠', '샌드워시 치노 팬츠', '모카신 로퍼', '크림슨 니트'];
      const field = [nameColor({ name: '울 니트 (네이비)', color: '레드' }) || '-', nameColor({ name: '셔츠', color: '밝은회색(실버)' }) || '-'];
      const colors = names.map(n => nameColor({ name: n }) || '-');
      const brandIgnored = nameColor({ name: '블랙야크 플리스 자켓', brand: '블랙야크' }) || '-';
      const img = await b64(await jpeg('#777', 120));
      goto('옷 등록'); await previewProduct(JSON.stringify({ metadata: JSON.stringify({ app: 'my-wardrobe-product', version: 1, product: { name: '무신사 스탠다드(MUSINSA STANDARD) 옥스포드 셔츠 [화이트] - 사이즈 & 후기 | 무신사', brand: '무신사 스탠다드' } }), imageBase64: img.split(',')[1] }));
      const shown = document.getElementById('productName').value; await queueProduct(); const q = batch[batch.length - 1];
      applyColorResult(q, { name: '검정', reliable: true, rgb: [0, 0, 0] }); // 다시 분석해도 상품명 색은 그대로
      const queued = { color: q.color, manual: !!q.manual.color, source: q.colorSource, cat: q.category + '·' + q.type }; batch.length = 0; renderQueue();
      const html = '<!doctype html><html><head><meta property="og:title" content="브이넥 니트 - navy - 감도 깊은 취향 셀렉트샵 29CM"><link rel="canonical" href="https://www.29cm.co.kr/products/1"></head><body></body></html>';
      const enc = btoa(String.fromCharCode(...new TextEncoder().encode(html)));
      await previewProduct(enc); const b64name = productDraft?.product.name, b64url = productDraft?.product.url;
      return { colors, field, brandIgnored, shown, queued, b64name, b64url };
    });
    assert.deepEqual(r.colors, ['흰색', '회색', '네이비', '카키/올리브', '네이비', '아이보리/크림', '-', '블루', '-', '-', '검정', '-', '-', '-', '-']);
    assert.deepEqual(r.field, ['-', '회색']);
    assert.equal(r.brandIgnored, '-');
    assert.equal(r.shown, '옥스포드 셔츠 [화이트]');
    assert.deepEqual(r.queued, { color: '흰색', manual: false, source: 'name', cat: '상의·셔츠' });
    assert.deepEqual([r.b64name, r.b64url], ['브이넥 니트 - navy', 'https://www.29cm.co.kr/products/1']);
  });

  await check('Pasted page HTML without canonical/og:url takes the product address from JSON-LD @id (Pottery); a share-link landing page is recognised and explained', async page => {
    const r = await page.evaluate(async () => {
      goto('옷 등록');
      const html = '<!doctype html><html><head><meta property="og:title" content="옥스포드 버튼다운 셔츠_네이비"><meta property="og:image" content="https://cafe24img.poxo.com/pottery33300/web/product/big/202608/x.jpg"><script type="application/ld+json">{"@type":"ProductGroup","@id":"https://ptry.co.kr/product/oxford/5201/","name":"옥스포드 버튼다운 셔츠_네이비","hasVariant":[{"@type":"Product","brand":{"name":"POTTERY"},"sku":"cafe24_pottery33300_1_5201_P0000HSB000A"}]}</script></head><body></body></html>';
      let a; try { const d = await productFromText(html); a = { url: d.product.url, brand: d.product.brand, img: d.imageUrl, mall: d.mall }; } catch (e) { a = e.message; }
      await previewProduct('<!doctype html><html><head><title>Launching App...</title></head><body><script>var store_link="https://www.musinsa.com/products/1";</script></body></html>');
      return { a, share: document.getElementById('productStatus').textContent };
    });
    assert.deepEqual(r.a, { url: 'https://ptry.co.kr/product/oxford/5201/', brand: 'POTTERY', img: 'https://cafe24img.poxo.com/pottery33300/web/product/big/202608/x.jpg', mall: 'pottery33300' });
    assert.match(r.share, /공유 링크 안내 페이지/);
  });

  await check('Shop import hygiene: tracking values (AppsFlyer share, Naver/Google ads) are dropped but product numbers kept; EUC-KR pages decode; a store landing title is refused; a short JSON pasted into the box previews at once', async page => {
    const port = server.address().port, o = `http://127.0.0.1:${port}`;
    const euc = Buffer.concat([Buffer.from('<!doctype html><html><head><meta charset="euc-kr"><meta property="og:title" content="'), Buffer.from([0xB0, 0xA1, 0xB3, 0xAA, 0xB4, 0xD9]), Buffer.from(` shirt"><link rel="canonical" href="${o}/fake-shop/euc"></head><body></body></html>`)]);
    await page.route(`${o}/fake-shop/euc`, route => route.fulfill({ status: 200, headers: { 'content-type': 'text/html; charset=euc-kr' }, body: euc }));
    const r = await page.evaluate(async o => {
      const urls = [cleanProductURL('https://www.29cm.co.kr/products/3738438?reward_key=RK_1&af_dp=x&shortlink=abc&pid=29cm_pdp_share&utm_source=s&deep_link_value=y'),
        cleanProductURL('https://ptry.co.kr/product/detail.html?product_no=5201&cate_no=944&NaPm=ct%3D1&n_query=%EB%82%A8%EC%9E%90&n_rank=3&_ga=2.1&gclid=z'),
        cleanProductURL('https://shop.example/item?pid=77&color=navy')];
      goto('옷 등록'); await previewProduct(`${o}/fake-shop/euc`); const euc = productDraft?.product.name || document.getElementById('productStatus').textContent;
      let landing; try { parseProductPackage(JSON.stringify({ app: 'my-wardrobe-product', version: 1, product: { name: '온라인 패션 스토어 무신사' } })); landing = 'ok'; } catch (e) { landing = e.message; }
      productDraft = null; const json = JSON.stringify({ app: 'my-wardrobe-product', version: 1, product: { name: '짧은 버전 셔츠' } });
      const dt = new DataTransfer(); dt.setData('text/plain', json); const box = document.getElementById('productPayload'); box.value = '';
      const ev = new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }); box.dispatchEvent(ev);
      for (let i = 0; i < 60 && !productDraft; i++) await sleep(50);
      return { urls, euc, landing, pasted: productDraft?.product.name, prevented: ev.defaultPrevented };
    }, o);
    assert.deepEqual(r.urls, ['https://www.29cm.co.kr/products/3738438', 'https://ptry.co.kr/product/detail.html?product_no=5201&cate_no=944', 'https://shop.example/item?pid=77&color=navy']);
    assert.equal(r.euc, '가나다 shirt'); assert.match(r.landing, /공유 링크 안내 페이지/);
    assert.deepEqual([r.pasted, r.prevented], ['짧은 버전 셔츠', true]);
  });

  await check('Paste buttons are narrow enough (≤ 300 pt) that the iPhone paste bubble anchors above the button, with a visible hint; the screen stays put until the bubble is answered; a dismissed bubble leads to pasting by hand', async page => {
    const r = await page.evaluate(async () => {
      const w = id => document.getElementById(id).getBoundingClientRect().width, hint = id => document.getElementById(id).nextElementSibling?.textContent || '';
      const sizes = { closet: w('closetPasteBtn'), closetHint: hint('closetPasteBtn') };
      let release; Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: () => new Promise(res => { release = res; }) } });
      const g = window.goto; delete window.goto;
      document.getElementById('closetPasteBtn').click(); const still = document.querySelector('.page.active').id;
      release(JSON.stringify({ app: 'my-wardrobe-product', version: 1, product: { name: '늦게 온 셔츠' } }));
      for (let i = 0; i < 60 && !productDraft; i++) await sleep(50);
      const after = document.querySelector('.page.active').id, name = productDraft?.product.name;
      sizes.card = w('productPasteBtn'); sizes.cardHint = hint('productPasteBtn');
      Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { readText: () => Promise.reject(Object.assign(new Error('x'), { name: 'NotAllowedError' })) } });
      window.goto = g; goto('옷장'); delete window.goto; document.getElementById('closetPasteBtn').click(); await sleep(100);
      const denied = { page: document.querySelector('.page.active').id, status: document.getElementById('productStatus').textContent, focus: document.activeElement?.id, diag: document.getElementById('productDiag').textContent };
      window.goto = g;
      return { sizes, still, after, name, denied };
    });
    assert.ok(r.sizes.closet > 0 && r.sizes.closet <= 300 && r.sizes.card > 0 && r.sizes.card <= 300, JSON.stringify(r.sizes));
    assert.match(r.sizes.closetHint, /붙여넣기/); assert.match(r.sizes.cardHint, /붙여넣기/);
    assert.deepEqual([r.still, r.after, r.name], ['closet', 'add', '늦게 온 셔츠']);
    assert.equal(r.denied.page, 'add'); assert.match(r.denied.status, /길게 눌러/); assert.equal(r.denied.focus, 'productPayload'); assert.match(r.denied.diag, /가져오기 준비됨.*NotAllowedError/);
  });

  await check('Status line shows the import file is running (and says so when it is not); text pasted into the box previews even when the paste event carries no data', async page => {
    const r = await page.evaluate(async () => {
      const diag = document.getElementById('productDiag').textContent;
      goto('옷 등록'); document.getElementById('productCard').open = true;
      const box = document.getElementById('productPayload');
      box.dispatchEvent(new ClipboardEvent('paste', { clipboardData: new DataTransfer(), bubbles: true, cancelable: true }));
      box.value = JSON.stringify({ app: 'my-wardrobe-product', version: 1, product: { name: '입력칸 셔츠' } }); box.dispatchEvent(new Event('input', { bubbles: true }));
      for (let i = 0; i < 60 && !productDraft; i++) await sleep(50);
      const name = productDraft?.product.name, cleared = box.value === '';
      box.value = 'https'; box.dispatchEvent(new Event('input', { bubbles: true }));
      return { diag, name, cleared, hint: document.getElementById('productStatus').textContent };
    });
    assert.match(r.diag, /가져오기 준비됨 · v[\d.]+ · 클립보드 읽기/); assert.deepEqual([r.name, r.cleared], ['입력칸 셔츠', true]); assert.match(r.hint, /5자 · 상품 미리보기를 누르세요/);
  });

  await check('If wardrobe-import.js does not run, the product card says so instead of staying silent', async page => {
    const r = await page.evaluate(() => document.getElementById('productDiag').textContent);
    assert.match(r, /불러오지 못했습니다/);
  }, { block: ['/wardrobe-import.js'] });

  await check('pagehide into the back/forward cache keeps image URLs; a real unload still releases them', async page => {
    const r = await page.evaluate(async () => {
      await basic(); const n = imageURLs.size;
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })); const kept = imageURLs.size;
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: false })); const released = imageURLs.size;
      return { n: n > 0, kept: kept === n, released };
    });
    assert.deepEqual(r, { n: true, kept: true, released: 0 });
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed. Chromium only — iPhone Safari itself is not verified by this suite.`);
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); try { await browser.close(); } catch {} server.close(); process.exit(1); });
