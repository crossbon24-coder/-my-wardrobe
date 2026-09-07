/* Paste this entire file into Shortcuts: Run JavaScript on Webpage.
 * Reads only product metadata from the open page. No network requests or page changes.
 * See SHORTCUT.md for the native image download and clipboard actions.
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
    if (types.some(t => typeof t === 'string' && /(^|\/)Product$/.test(t))) products.push(node);
    // Do not search recommendations or page-wide personal/account data.
    for (const key of ['@graph', 'mainEntity']) if (node[key]) visit(node[key], depth + 1);
  }
  for (const script of document.querySelectorAll('script[type="application/ld+json"]')) {
    if (script.textContent.length > 1000000) continue;
    try { visit(JSON.parse(script.textContent), 0); } catch (_) {}
  }
  const pageUrl = address(location.href), canonical = address(document.querySelector('link[rel="canonical"]')?.href);
  const matches = products.filter(p => {
    const u = address(p.url || p['@id']); return u && (u === pageUrl || u === canonical);
  });
  // Multiple distinct products are ambiguous. Fall back to page metadata rather than guessing one.
  const p = matches.length === 1 ? matches[0] : products.length === 1 ? products[0] : {};
  const rawImage = [].concat(p.image || []).find(Boolean);
  const imageUrl = address(typeof rawImage === 'object' ? rawImage.url || rawImage.contentUrl : rawImage) || address(meta('og:image'));
  const offer = Array.isArray(p.offers) ? (p.offers.length === 1 ? p.offers[0] : {}) : p.offers || {};
  const product = {
    name: text(p.name || meta('og:title') || document.title),
    brand: text(typeof p.brand === 'object' ? p.brand?.name : p.brand),
    url: pageUrl,
    material: text(p.material), color: text(p.color), size: text(p.size), sku: text(p.sku),
    description: text(p.description || meta('og:description'), 4000),
    listedPrice: text(offer.price), currency: text(offer.priceCurrency, 20)
  };
  const payload = {app: 'my-wardrobe-product', version: 1, product, imageUrl};
  // JSON text is intentional: a later Shortcut Text action embeds it without reserializing.
  completion({metadata: JSON.stringify(payload), imageUrl});
})();
