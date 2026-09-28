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
const server = createServer((req, res) => {
  const path = decodeURIComponent(req.url.split('?')[0]);
  const file = normalize(join(root, path === '/' ? 'index.html' : path.slice(1)));
  if (!file.startsWith(root) || file.includes(`${root}\\.git`) || file.includes(`${root}/.git`) || !existsSync(file)) { res.writeHead(404).end(); return; }
  const ext = extname(file);
  res.setHeader('Content-Type', ext === '.json' ? 'application/json' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  res.end(readFileSync(file));
});
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1';
let browser, passed = 0, failed = 0;
async function fresh(opts = {}) {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, ...(opts.iphone ? { userAgent: IPHONE } : {}), ...(opts.tz ? { timezoneId: opts.tz } : {}) });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  // 외부 https(모델 CDN 등)는 일부러 막으므로 그 '불러오기 실패' 콘솔 메시지만 예상된 것으로 거른다
  page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource: net::ERR_FAILED/.test(m.text())) errors.push('console: ' + m.text()); });
  await page.route('https://**/*', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => /옷 \d+벌/.test(document.getElementById('summary').textContent) && window.OF);
  await page.evaluate(() => {
    window.alerts = []; window.confirms = []; window.confirmAnswer = true;
    window.alert = t => alerts.push(String(t)); window.confirm = t => { confirms.push(String(t)); return window.confirmAnswer; };
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
  try { await fn(t.page); assert.deepEqual(t.errors, [], 'runtime errors'); console.log('PASS', name); passed++; }
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
      const loads = await new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth); im.onerror = () => res(0); im.src = url(shown.image); });
      return { partialShown, preview, unchanged: afterCancel === before, changed: rec.image.size !== before, partial: rec.partial, wearCount: rec.wearCount, shownSize: shown.image.size === rec.image.size, loads, toast: toastText() };
    });
    assert.deepEqual(r, { partialShown: true, preview: true, unchanged: true, changed: true, partial: false, wearCount: 7, shownSize: true, loads: 300, toast: '사진을 바꿨습니다' });
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
      return { name: got.name, expected: `wardrobe-backup-${localDateStr()}.json`, same, restorable, last: localStorage.getItem('wardrobe.lastBackup') === localDateStr(), info: document.getElementById('backupInfo').textContent };
    });
    assert.equal(r.name, r.expected); assert.equal(r.same, true); assert.equal(r.restorable, 6); assert.equal(r.last, true); assert.match(r.info, /마지막 백업: \d{4}-\d{2}-\d{2} \(오늘\)/);
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
    assert.equal(r.shared.length, 1); assert.match(r.shared[0], /^wardrobe-backup-\d{4}-\d{2}-\d{2}\.json$/); assert.equal(r.downloaded, 0); assert.equal(r.last, true); assert.equal(r.hidden, true);
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
    assert.deepEqual(r, { name: 'wardrobe-backup-2026-09-27.json', last: '2026-09-27' });
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
