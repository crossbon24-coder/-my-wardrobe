/* Paste this entire file into Shortcuts: Run JavaScript on Webpage.
 * Reads only product metadata from the open page. No network requests or page changes.
 * 사진 내려받기·클립보드 동작은 shortcut-help.html(단축어 설정 안내)을 보세요.
 */
(function () {
  function text(value, limit) {
    if (Array.isArray(value)) value = value.filter(v => typeof v === 'string').join(' / ');
    return typeof value === 'string' || typeof value === 'number' ? String(value).trim().slice(0, limit || 500) : '';
  }
  function address(value) {
    try {
      const u = new URL(text(value, 4096), location.href);
      if (!value || !/^https?:$/.test(u.protocol) || u.username || u.password) return '';
      u.hash = ''; return u.href;
    } catch (_) { return ''; }
  }
  function meta(key) { return document.querySelector('meta[property="' + key + '"],meta[name="' + key + '"]')?.content || ''; }
  const products = [];
  function visit(node, depth) {
    if (!node || typeof node !== 'object' || depth > 12 || products.length > 40) return;
    if (Array.isArray(node)) { node.slice(0, 100).forEach(n => visit(n, depth + 1)); return; }
    const types = [].concat(node['@type'] || []);
    if (types.some(t => typeof t === 'string' && /(^|\/)ProductGroup$/.test(t))) {
      // Cafe24 등은 상품 하나를 ProductGroup + 사이즈별 hasVariant로 적는다. 묶음 값을 먼저 쓰고 빈 칸은 첫 변형에서 채운다
      const v = [].concat(node.hasVariant || []).find(x => x && typeof x === 'object') || {};
      // 사이즈·색·설명·사진은 변형마다 다르므로 빌리지 않는다(첫 변형의 사이즈가 '구매 사이즈'로 채워지지 않게). 코드는 묶음 번호
      products.push({ ...node, name: node.name || v.name, brand: node.brand || v.brand, sku: node.productGroupID || node.sku || (typeof v.sku === 'string' && /^cafe24_/.test(v.sku) ? v.sku.split('_').slice(0, 4).join('_') : ''), offers: node.offers || v.offers });
    } else if (types.some(t => typeof t === 'string' && /(^|\/)Product$/.test(t))) products.push(node);
    // Do not search recommendations or page-wide personal/account data.
    for (const key of ['@graph', 'mainEntity']) if (node[key]) visit(node[key], depth + 1);
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    if (script.textContent.length > 1000000) continue;
    try { visit(JSON.parse(script.textContent), 0); } catch (_) {}
  }
  // 같은 상품이 두 번 들어 있으면 하나로 본다(서로 다른 상품이 여럿이면 아래에서 페이지 정보로 넘어간다)
  const seen = new Set(), unique = products.filter(p => { let k = ''; try { k = JSON.stringify(p); } catch (_) {} if (k && seen.has(k)) return false; seen.add(k); return true; });
  const pageUrl = address(location.href), canonical = address(document.querySelector('link[rel="canonical"]')?.href);
  const matches = unique.filter(p => {
    const u = address(p.url || p['@id']); return u && (u === pageUrl || u === canonical);
  });
  // Multiple distinct products are ambiguous. Fall back to page metadata rather than guessing one.
  const p = matches.length === 1 ? matches[0] : unique.length === 1 ? unique[0] : {};
  const rawImage = [].concat(p.image || []).find(Boolean);
  const imageUrl = address(typeof rawImage === 'object' ? rawImage.url || rawImage.contentUrl : rawImage) || address(meta('og:image'));
  const offer = Array.isArray(p.offers) ? (p.offers.length === 1 ? p.offers[0] : {}) : p.offers || {};
  const product = {
    name: text(p.name || meta('og:title') || document.title),
    brand: text((b => typeof b === 'object' && b ? b.name : b)(Array.isArray(p.brand) ? p.brand[0] : p.brand)) || text(meta('product:brand')),
    // 대표 주소(canonical)는 지금 보는 페이지와 같은 경로일 때만 쓴다. 추적 꼬리표만 빼고 나머지 쿼리(옵션 번호 등)는 원문 그대로 둔다
    url: (u => { try { const x = new URL(u); if (!x.search) return x.href; const key = q => { const k = q.split('=')[0]; try { return decodeURIComponent(k); } catch (_) { return k; } }; const parts = x.search.slice(1).split('&').filter(Boolean), af = parts.some(q => /^af_/i.test(key(q))); const kept = parts.filter(q => !/^(utm_[a-z_]*|fbclid|gclid|gbraid|wbraid|gad_source|dclid|msclkid|ttclid|twclid|yclid|igshid|igsh|mc_[a-z_]*|_hs[a-z_]*|_ga|_gl|ref_?src|srsltid|af_[a-z_]*|reward_key|shortlink|deep_link_value|deep_link_sub\d*|is_retargeting|onelink_[a-z_]*|source_caller|NaPm|n_[a-z_]*)$/i.test(key(q)) && !(af && /^pid$/i.test(key(q)))); x.search = kept.length ? '?' + kept.join('&') : ''; return x.href; } catch (_) { return u; } })((() => { try { const a = new URL(canonical || ''), b = new URL(pageUrl); return canonical && a.origin === b.origin && a.pathname === b.pathname ? canonical : pageUrl; } catch (_) { return pageUrl; } })()),
    material: text(p.material), color: text(p.color), size: text(p.size), sku: text(p.sku),
    description: text(p.description || meta('og:description'), 4000),
    // 페이지에 보이는 가격: 할인가 메타(Cafe24)가 있으면 그것, 없으면 상품 정보의 가격
    listedPrice: text(meta('product:sale_price:amount')) || text(offer.price) || text(meta('product:price:amount')), currency: text(offer.priceCurrency, 20) || text(meta('product:sale_price:currency'), 20) || text(meta('product:price:currency'), 20)
  };
  const payload = {app: 'my-wardrobe-product', version: 1, product, imageUrl};
  // JSON text is intentional: a later Shortcut Text action embeds it without reserializing.
  completion({metadata: JSON.stringify(payload), imageUrl});
})();
