/* 코디 기능(outfits.js) 회귀 검사. 합성 이미지만 쓰고 사용자 사진·실제 IndexedDB·GitHub Pages에 접근하지 않는다.
 * 실행: node tests/outfits.cjs   (Playwright 필요. WARDROBE_TEST_CHROMIUM으로 Chromium 실행 파일 지정 가능)
 * 검사마다 새 브라우저 컨텍스트(빈 DB)에서 시작하므로 순서에 의존하지 않는다.
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
  // 저장소 안의 정적 파일은 모두 제공한다(허용 목록을 두지 않아 새 파일이 404로 숨는 일이 없다)
  if (!file.startsWith(root) || file.includes(`${root}\\.git`) || file.includes(`${root}/.git`) || !existsSync(file)) { res.writeHead(404).end(); return; }
  const ext = extname(file);
  res.setHeader('Content-Type', ext === '.json' ? 'application/json' : ext === '.js' ? 'text/javascript; charset=utf-8' : 'text/html; charset=utf-8');
  res.end(readFileSync(file));
});
let browser, passed = 0, failed = 0;
async function fresh() {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push('console: ' + m.text()); });
  await page.route('https://**/*', route => route.abort());
  await page.goto(`http://127.0.0.1:${server.address().port}/`);
  await page.waitForFunction(() => /옷 \d+벌/.test(document.getElementById('summary').textContent) && window.OF);
  await page.evaluate(() => {
    window.alerts = []; window.alert = t => alerts.push(String(t)); window.confirm = () => true; window.promptAnswer = null; window.prompt = () => window.promptAnswer;
    window.sleep = ms => new Promise(r => setTimeout(r, ms));
    window.goto = name => [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === name).click();
    window.seed = async specs => { // [{id,category,memo,color,type,brand}]
      const rows = [];
      for (const [i, s] of specs.entries()) {
        const c = document.createElement('canvas'); c.width = c.height = 64; const ctx = c.getContext('2d');
        ctx.fillStyle = `hsl(${(i * 47) % 360},60%,50%)`; ctx.fillRect(0, 0, 64, 64);
        const image = await new Promise(r => c.toBlob(r, 'image/jpeg', .8));
        rows.push({ id: s.id, image, category: s.category, type: s.type || '', color: s.color || '회색', season: '사계절', formality: 2, memo: s.memo || '', createdAt: 1000 + i, wearCount: s.wearCount || 0, lastWorn: s.lastWorn || null, ...(s.brand ? { wardrobeDetails: { product: { brand: s.brand, name: s.memo || '' } } } : {}) });
      }
      await transaction(['clothes'], 'readwrite', tx => { const st = tx.objectStore('clothes'); for (const r of rows) st.put(r); });
      await refresh();
    };
    window.basic = () => seed([
      { id: 'o1', category: '아우터', memo: '네이비 블레이저', type: '블레이저' },
      { id: 't1', category: '상의', memo: '그레이 니트', type: '니트', color: '회색' },
      { id: 't2', category: '상의', memo: '화이트 셔츠', type: '셔츠', color: '흰색' },
      { id: 't3', category: '상의', memo: '블랙 티셔츠', type: '티셔츠', color: '검정', brand: 'Stussy' },
      { id: 'b1', category: '하의', memo: '인디고 데님', type: '데님', color: '블루' },
      { id: 's1', category: '신발', memo: '뉴발란스 2002R', type: '스니커즈' },
      { id: 'g1', category: '가방', memo: '포터 토트', type: '토트' },
      { id: 'a1', category: '액세서리', memo: '블랙 볼캡', type: '모자' },
    ]);
    window.outfitsDB = () => transaction(['outfits'], 'readonly', tx => { const q = tx.objectStore('outfits').getAll(); return () => q.result; });
    window.clothesDB = () => transaction(['clothes'], 'readonly', tx => { const q = tx.objectStore('clothes').getAll(); return () => q.result; });
    window.fill = async slots => { for (const [k, id] of Object.entries(slots)) { OF.pick(k); OF.choose(id); } };
    window.todayStr = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
  });
  return { context, page, errors };
}
async function check(name, fn) {
  const t = await fresh();
  try { await fn(t.page); assert.deepEqual(t.errors, [], 'runtime errors'); assert.equal(await t.page.evaluate(() => OF.errors), 0, 'outfits.js render errors'); console.log('PASS', name); passed++; }
  catch (e) { console.log('FAIL', name, '\n  ', e.message.split('\n').slice(0, 6).join('\n   ')); failed++; }
  finally { await t.context.close(); }
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  browser = await chromium.launch({ headless: true, ...(process.env.WARDROBE_TEST_CHROMIUM ? { executablePath: process.env.WARDROBE_TEST_CHROMIUM, args: ['--no-sandbox', '--disable-dev-shm-usage'] } : {}) });

  await check('outfits.js loads, adds the 코디 tab and does not render the hidden outfit page', async page => {
    const r = await page.evaluate(async () => { await basic(); const before = document.getElementById('outfit').innerHTML.length; goto('코디'); await sleep(50); return { before, after: document.getElementById('outfit').innerHTML.length, hasNav: !!document.querySelector('nav button[onclick*="outfit"]') }; });
    assert.equal(r.hasNav, true); assert.ok(r.after > 0);
  });

  await check('Save, then save again overwrites instead of duplicating; 새로 저장 makes a second outfit', async page => {
    const r = await page.evaluate(async () => {
      await basic(); goto('코디'); await fill({ top: 't1', bottom: 'b1', shoes: 's1' });
      OF.save(); await sleep(300); OF.save(); await sleep(300);
      const afterTwo = (await outfitsDB()).length;
      OF.pick('top'); OF.choose('t2'); OF.save(); await sleep(300);
      const rows = await outfitsDB();
      OF.saveNew(); await sleep(300);
      return { afterTwo, overwritten: rows.length === 1 && rows[0].slots.top === 't2', total: (await outfitsDB()).length, btn: document.getElementById('outfit').innerText.includes('덮어쓰기') };
    });
    assert.deepEqual(r, { afterTwo: 1, overwritten: true, total: 2, btn: true });
  });

  await check('Overwrite keeps worn history and createdAt; load fills the name; rename updates the record', async page => {
    const r = await page.evaluate(async () => {
      await basic(); goto('코디'); await fill({ top: 't1', bottom: 'b1' }); OF.name('출근룩'); OF.save(); await sleep(300);
      const [o] = await outfitsDB(); OF.wear(o.id); await sleep(300);
      OF.clearAll(); OF.load(o.id); const nameField = document.getElementById('outfitName').value;
      OF.pick('shoes'); OF.choose('s1'); OF.save(); await sleep(300);
      const [o2] = await outfitsDB();
      promptAnswer = '주말룩'; OF.rename(o.id); await sleep(300);
      const [o3] = await outfitsDB();
      return { nameField, keptWorn: o2.worn.length === 1, keptCreated: o2.createdAt === o.createdAt, shoes: o2.slots.shoes, renamed: o3.name };
    });
    assert.deepEqual(r, { nameField: '출근룩', keptWorn: true, keptCreated: true, shoes: 's1', renamed: '주말룩' });
  });

  await check('Rapid double tap on 저장 creates one outfit', async page => {
    const n = await page.evaluate(async () => { await basic(); goto('코디'); await fill({ top: 't1', bottom: 'b1' }); OF.save(); OF.save(); OF.save(); await sleep(500); return (await outfitsDB()).length; });
    assert.equal(n, 1);
  });

  await check('Bag and accessory are separate slots; old outfits with a bag in acc still render', async page => {
    const r = await page.evaluate(async () => {
      await basic(); goto('코디'); await fill({ top: 't1', bottom: 'b1', bag: 'g1', acc: 'a1' }); OF.save(); await sleep(300);
      const [o] = await outfitsDB();
      await transaction(['outfits'], 'readwrite', tx => tx.objectStore('outfits').put({ id: 'legacy', name: '옛 코디', slots: { top: 't2', bottom: 'b1', shoes: null, acc: 'g1' }, createdAt: 5, worn: [] }));
      await refresh(); await sleep(50);
      OF.pick('acc'); const accChoices = document.querySelectorAll('#pickGrid .pitem').length; OF.closePick();
      return { bag: o.slots.bag, acc: o.slots.acc, accChoices, legacyImgs: [...document.querySelectorAll('#outfit .of-item')].find(e => e.innerText.includes('옛 코디')).querySelectorAll('img').length };
    });
    assert.deepEqual(r, { bag: 'g1', acc: 'a1', accChoices: 1, legacyImgs: 3 });
  });

  await check('Pick sheet: search (incl. brand), subtype chip, sort, close button, visible names', async page => {
    const r = await page.evaluate(async () => {
      await basic(); goto('코디'); OF.pick('top');
      const all = document.querySelectorAll('#pickGrid .pitem').length;
      const names = [...document.querySelectorAll('#pickGrid .pitem span')].map(s => s.textContent);
      OF.pickQuery('stussy'); const brand = [...document.querySelectorAll('#pickGrid .pitem span')].map(s => s.textContent);
      OF.pickQuery(''); OF.pickType('셔츠'); const typed = document.querySelectorAll('#pickGrid .pitem').length;
      const closeBtn = !!document.querySelector('#pickBody .pick-close'); document.querySelector('#pickBody .pick-close').click();
      return { all, hasNames: names.includes('그레이 니트'), brand, typed, closeBtn, closed: !document.getElementById('pickModal').classList.contains('open') };
    });
    assert.deepEqual(r, { all: 3, hasNames: true, brand: ['블랙 티셔츠'], typed: 1, closeBtn: true, closed: true });
  });

  await check('오늘 입음: idempotent per outfit, and a garment already counted today is not counted again', async page => {
    const r = await page.evaluate(async () => {
      await basic(); goto('코디');
      await fill({ top: 't1', bottom: 'b1', shoes: 's1' }); OF.saveNew(); await sleep(300);
      OF.clearAll(); await fill({ top: 't2', bottom: 'b1', shoes: 's1' }); OF.saveNew(); await sleep(300);
      const [a, b] = (await outfitsDB()).sort((x, y) => x.createdAt - y.createdAt);
      OF.wear(a.id); await sleep(300); OF.wear(a.id); await sleep(300); OF.wear(b.id); await sleep(300);
      const c = Object.fromEntries((await clothesDB()).map(x => [x.id, x.wearCount]));
      return { t1: c.t1, t2: c.t2, b1: c.b1, s1: c.s1 };
    });
    assert.deepEqual(r, { t1: 1, t2: 1, b1: 1, s1: 1 });
  });

  await check('Closet-card 오늘 입음 today then outfit 오늘 입음 today counts the garment once', async page => {
    const r = await page.evaluate(async () => {
      await basic(); await wear('t1'); goto('코디'); await fill({ top: 't1', bottom: 'b1' }); OF.save(); await sleep(300);
      const [o] = await outfitsDB(); OF.wear(o.id); await sleep(300);
      const c = Object.fromEntries((await clothesDB()).map(x => [x.id, x.wearCount]));
      return { t1: c.t1, b1: c.b1 };
    });
    assert.deepEqual(r, { t1: 1, b1: 1 });
  });

  await check('Future dates cannot be recorded; past dates can, and appear on the calendar', async page => {
    const r = await page.evaluate(async () => {
      await basic(); goto('코디'); await fill({ top: 't1', bottom: 'b1' }); OF.save(); await sleep(300);
      const [o] = await outfitsDB();
      const d = new Date(); d.setDate(d.getDate() + 3); const fut = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
      const p = new Date(); p.setDate(p.getDate() - 2); const past = `${p.getFullYear()}-${String(p.getMonth() + 1).padStart(2, '0')}-${String(p.getDate()).padStart(2, '0')}`;
      OF.addWorn(fut); const futOpen = document.getElementById('wornModal').classList.contains('open');
      OF.view('cal'); OF.month(0); if (fut.slice(0, 7) !== todayStr().slice(0, 7)) OF.month(1); OF.day(fut);
      const futButton = document.getElementById('outfit').innerText.includes('이 날 기록 추가');
      OF.addWorn(past); OF.chooseWorn(o.id); await sleep(300);
      const [o2] = await outfitsDB(); const c = (await clothesDB()).find(x => x.id === 't1');
      return { futOpen, futButton, worn: o2.worn, t1: c.wearCount, lastWornDay: new Date(c.lastWorn).getDate() === p.getDate() };
    });
    assert.equal(r.futOpen, false); assert.equal(r.futButton, false); assert.equal(r.worn.length, 1); assert.equal(r.t1, 1); assert.equal(r.lastWornDay, true);
  });

  await check('Closet search matches data (brand, name), not button labels; clearing restores the list and empty text', async page => {
    const r = await page.evaluate(async () => {
      await basic(); const inp = document.getElementById('closetSearch'); const vis = () => [...document.querySelectorAll('#items .item')].filter(e => !e.hidden).length;
      const set = v => { inp.value = v; inp.dispatchEvent(new Event('input')); };
      set('수정'); const buttonWord = vis(); set('stussy'); const brand = vis(); set('없는옷xyz');
      const none = { vis: vis(), noMatch: !document.getElementById('closetNoMatch').hidden, emptyShown: document.getElementById('empty').style.display };
      set(''); return { buttonWord, brand, none, after: vis(), emptyAfter: document.getElementById('empty').style.display, noMatchAfter: document.getElementById('closetNoMatch').hidden };
    });
    assert.deepEqual(r, { buttonWord: 0, brand: 1, none: { vis: 0, noMatch: true, emptyShown: 'none' }, after: 8, emptyAfter: 'none', noMatchAfter: true });
  });

  await check('4-column mode keeps a one-line name on each card', async page => {
    const r = await page.evaluate(async () => { await basic(); document.getElementById('densityBtn').click(); await sleep(50); const t = document.querySelector('#items .item .title'); return { dense: document.getElementById('items').classList.contains('dense'), titleVisible: getComputedStyle(t).display !== 'none', actionsHidden: getComputedStyle(document.querySelector('#items .item .actions')).display === 'none' }; });
    assert.deepEqual(r, { dense: true, titleVisible: true, actionsHidden: true });
  });

  await check('Malformed outfit records (non-string worn, bad slots) do not break the outfit page or closet search', async page => {
    const r = await page.evaluate(async () => {
      await basic();
      await transaction(['outfits'], 'readwrite', tx => { const st = tx.objectStore('outfits');
        st.put({ id: 'bad1', name: 123, slots: { top: { x: 1 }, bottom: 'b1' }, createdAt: 'x', worn: [99999999] });            // 숫자 날짜: 옛 코드는 .slice에서 멈춤
        st.put({ id: 'bad2', name: '주입', slots: { top: 't1' }, createdAt: 2, worn: ['2026-<img src=x onerror=alert(1)>'] }); // slice(5) 뒤 태그가 되는 문자열
      });
      await refresh(); goto('코디'); await sleep(50);
      const txt = document.getElementById('outfit').innerText;
      const inp = document.getElementById('closetSearch'); inp.value = '니트'; inp.dispatchEvent(new Event('input'));
      return { rendered: txt.includes('저장한 코디'), injected: !!document.querySelector('#outfit img[src="x"]'), search: [...document.querySelectorAll('#items .item')].filter(e => !e.hidden).length, alerts };
    });
    assert.deepEqual(r, { rendered: true, injected: false, search: 1, alerts: [] });
  });

  await check('Draft survives a reload; ids that no longer exist are dropped after data loads', async page => {
    await page.evaluate(async () => { await basic(); goto('코디'); await fill({ top: 't1', bottom: 'b1' }); OF.name('초안'); });
    await page.reload();
    await page.waitForFunction(() => /옷 8벌/.test(document.getElementById('summary').textContent) && window.OF);
    const r = await page.evaluate(async () => {
      window.goto = name => [...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === name).click();
      goto('코디'); await new Promise(r => setTimeout(r, 50));
      const kept = { name: document.getElementById('outfitName').value, imgs: document.querySelectorAll('#outfit .card .fl-tile img').length };
      await transaction(['clothes'], 'readwrite', tx => tx.objectStore('clothes').delete('t1')); await refresh(); await new Promise(r => setTimeout(r, 50));
      const saved = JSON.parse(localStorage.getItem('wardrobe.outfitDraft'));
      return { kept, afterDelete: saved.draft.top, bottom: saved.draft.bottom };
    });
    assert.deepEqual(r, { kept: { name: '초안', imgs: 2 }, afterDelete: null, bottom: 'b1' });
  });

  await check('옷 수정 창의 코디에 담기 puts the garment in its slot and opens the 코디 tab', async page => {
    const r = await page.evaluate(async () => {
      await basic(); openEdit('g1'); document.getElementById('ofAddBtn').click(); await sleep(50);
      return { tab: document.getElementById('outfit').classList.contains('active'), modalClosed: !document.getElementById('editModal').classList.contains('open'), bagImg: !!document.querySelector('#outfit .card .fl-tile img[alt="포터 토트"]') };
    });
    assert.deepEqual(r, { tab: true, modalClosed: true, bagImg: true });
  });

  await check('OF.hasDraft reports unsaved outfit edits (for update/reload prompts)', async page => {
    const r = await page.evaluate(async () => {
      await basic(); goto('코디'); const empty = OF.hasDraft(); await fill({ top: 't1', bottom: 'b1' }); const unsaved = OF.hasDraft();
      OF.save(); await sleep(300); const saved = OF.hasDraft(); OF.pick('top'); OF.choose('t2'); const changed = OF.hasDraft();
      return { empty, unsaved, saved, changed };
    });
    assert.deepEqual(r, { empty: false, unsaved: true, saved: false, changed: true });
  });

  await check('v4.2 guard: after 오늘 입음 the displayed image Blobs and object URLs stay the same (WebKit IDB Blob safety)', async page => {
    const r = await page.evaluate(async () => {
      await basic(); const before = clothes.find(c => c.id === 't1'), b = before.image, u = url(b);
      goto('코디'); await fill({ top: 't1', bottom: 'b1' }); OF.save(); await sleep(300); const [o] = await outfitsDB(); OF.wear(o.id); await sleep(300);
      const after = clothes.find(c => c.id === 't1');
      const ok = await new Promise(res => { const im = new Image(); im.onload = () => res(im.naturalWidth > 0); im.onerror = () => res(false); im.src = url(after.image); });
      return { sameBlob: after.image === b, sameUrl: url(after.image) === u, loads: ok, wearCount: after.wearCount };
    });
    assert.deepEqual(r, { sameBlob: true, sameUrl: true, loads: true, wearCount: 1 });
  });

  await browser.close(); server.close();
  console.log(`\n${passed} passed, ${failed} failed. Chromium only — iPhone Safari is not verified by this suite.`);
  process.exit(failed ? 1 : 0);
})().catch(async e => { console.error(e); try { await browser.close(); } catch {} server.close(); process.exit(1); });
