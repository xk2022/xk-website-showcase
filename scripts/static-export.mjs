import { access, readFile, readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { validateReleaseConfiguration } from './release-gate.mjs';

export const origin = 'https://showcase.xplorekaleidoscope.com';
export const escape = value => String(value).replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]);

export function validateSites(sites) {
  const seen = new Set();
  for (const site of sites) {
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(site.slug) || seen.has(site.slug) || !/^xk2022\/[a-zA-Z0-9_-]+$/.test(site.repository)) throw new Error('Invalid or duplicate showcase: ' + site.slug);
    if (site.framework !== undefined && !['next', 'vite', 'screen', 'interactive'].includes(site.framework)) throw new Error('Unsupported framework: ' + site.slug);
    if (site.framework === 'screen' && (site.indexable !== false || (!site.repository.startsWith('xk2022/xk-app-') && site.repository !== 'xk2022/codex-xk-apparel-store'))) throw new Error('Screen previews must be non-indexable APP entries');
    const preservedInteractive = site.slug === 'rotaract' && site.ref === 'fd8374eca0d840d64790552a6562e05c1a8bc76b' && site.staticArtifact?.sourceSha === site.ref && site.staticArtifact?.url === 'https://github.com/xk2022/xk-website-showcase/releases/download/preserved-showcase-45564113822-v1/rotaract-static.zip';
    // A new private-source demo is promoted only through a reviewed, immutable
    // Hub release registration; never accept an arbitrary interactive archive.
    const reviewedRotaract = site.slug === 'rotaract' && /^[a-f0-9]{40}$/.test(site.ref) && site.staticArtifact?.sourceSha === site.ref && site.staticArtifact.url === `https://github.com/xk2022/xk-website-showcase/releases/download/rotaract-${site.ref.slice(0,7)}-v1/rotaract-static.zip`;
    const ownerDemo = site.slug === 'little-me-owner-demo' && site.repository === 'xk2022/xk-app-little-me-inventory' && site.indexable === false && /^[a-f0-9]{40}$/.test(site.ref) && site.staticArtifact?.sourceSha === site.ref && site.staticArtifact.url === `https://github.com/xk2022/xk-website-showcase/releases/download/little-me-owner-demo-${site.ref.slice(0,7)}-v1/little-me-owner-demo-static.zip`;
    const logisticsDemo = site.slug === 'logistics' && site.repository === 'xk2022/xk-app-logistics'
      && site.indexable === false && /^[a-f0-9]{40}$/.test(site.ref)
      && site.env?.VITE_SHOWCASE_DEMO === 'true' && site.staticArtifact === undefined
      && site.releaseGate?.workflow === '.github/workflows/ci.yml'
      && site.releaseGate?.job === 'Frontend quality'
      && Object.keys(site.releaseGate).sort().join(',') === 'job,workflow';
    if (site.framework === 'interactive' && !ownerDemo && !logisticsDemo && (site.slug !== 'rotaract' || site.repository !== 'xk2022/xk-app-rotaract' || site.indexable !== false || site.env?.VITE_SHOWCASE_DEMO !== 'true' || (!site.releaseGate && !preservedInteractive && !reviewedRotaract) || !/^[a-f\d]{40}$/i.test(site.ref))) throw new Error('Interactive preview requires an approved pinned demo');
    for (const option of ['indexable', 'listed']) {
      if (site[option] !== undefined && typeof site[option] !== 'boolean') throw new Error(`Invalid ${option}: ${site.slug}`);
    }
    if (site.status !== undefined && site.status !== 'proposal') throw new Error(`Unsupported showcase status: ${site.slug}`);
    if (site.status === 'proposal' && site.indexable !== false) throw new Error(`Concept proposals must remain non-indexable: ${site.slug}`);
    validateReleaseConfiguration(site);
    seen.add(site.slug);
  }
}

function attributes(tag) {
  return Object.fromEntries([...tag.matchAll(/([\w-]+)\s*=\s*(["'])(.*?)\2/gs)].map(([, name, , value]) => [name.toLowerCase(), value]));
}

export const transportRoutes = ['', 'services/', 'shipping-guide/', 'about/', 'inquiry/'];
export const ruiCafeRoutes = ['', 'about/', 'menu/', 'cakes/', 'space/', 'news/', 'visit/'];
export const shengfengyangRoutes = ['', 'story/', 'products/', 'gifting/', 'stores/',
  ...['pure-pork-floss', 'seaweed-pork-floss', 'original-pork-jerky', 'black-pepper-pork-jerky', 'thai-pork-jerky', 'traditional-pork-shreds', 'pure-pork-fu', 'swordfish-floss', 'chicken-floss', 'north-sea-squid-shreds', 'charcoal-squid-shreds', 'lemon-pork-jerky', 'nut-pork-jerky', 'honey-pepper-pork-strips', 'classic-honey-pork-jerky'].map(slug => `products/${slug}/`)];

// Keep transport's metadata contract in the Hub as well as its source suite.
// Its sitemap remains an explicit route inventory while its fictional demo is noindex.
export function assertTransportPage(html, url, base = origin) {
  const home = `${new URL(base).origin}/truck-transport/`;
  const metadata = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0]));
  const links = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0]));
  const canonical = links.filter(tag => tag.rel?.toLowerCase() === 'canonical');
  if (canonical.length !== 1 || canonical[0].href !== url) throw new Error(`Incorrect transport canonical URL: ${url}`);
  const headings = [...html.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
  if (headings.length !== 1 || !headings[0][1].replace(/<[^>]*>/g, '').trim()) throw new Error(`Transport page must have one nonempty H1: ${url}`);
  const robots = metadata.filter(tag => tag.name?.toLowerCase() === 'robots');
  if (!robots.length || robots.some(tag => {
    const tokens = (tag.content || '').toLowerCase().split(/[\s,]+/);
    return !tokens.includes('noindex') || !tokens.includes('nofollow') || tokens.includes('index') || tokens.includes('follow');
  })) throw new Error(`Missing transport noindex,nofollow: ${url}`);
  const image = `${home}images/social-card.jpg`;
  for (const [key, value] of Object.entries({ 'og:url': url, 'og:image': image, 'og:image:width': '1200', 'og:image:height': '630', 'twitter:card': 'summary_large_image', 'twitter:image': image })) {
    const matches = metadata.filter(tag => (tag.property || tag.name)?.toLowerCase() === key);
    if (matches.length !== 1 || matches[0].content !== value) throw new Error(`Incorrect transport social metadata ${key}: ${url}`);
  }
  const icons = links.filter(tag => tag.rel?.toLowerCase().split(/\s+/).includes('icon'));
  if (icons.length !== 1 || !icons[0].href || icons[0].href.startsWith('//') || new URL(icons[0].href, url).href !== `${home}favicon.svg`) throw new Error(`Incorrect transport icon: ${url}`);
  return [image, `${home}favicon.svg`];
}

export function assertTransportSitemap(xml, base = origin) {
  const expected = transportRoutes.map(route => `${new URL(base).origin}/truck-transport/${route}`).sort();
  const actual = [...xml.matchAll(/<loc\b[^>]*>(.*?)<\/loc>/gs)].map(([, value]) => value.trim()).sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) throw new Error('Transport sitemap must list exactly its five public routes');
}

async function htmlFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) throw new Error('Symlinks are not supported in static exports: ' + entry.name);
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await htmlFiles(path));
    else if (entry.isFile() && entry.name.endsWith('.html')) files.push(path);
  }
  return files;
}

export async function validateLocalReferences(html, directory, slug, pagePath = 'index.html', { legacy = false } = {}) {
  const prefix = `/${slug}/`;
  // Keep existing Next registrations on the original root-absolute resource contract.
  // In particular, its root-home href="/" was never treated as a case asset.
  // A connection hint names an origin, not a navigable page or fetched file.
  // Keep actual anchors, stylesheets, scripts and preloads under the case path.
  html = html.replace(/<link\b[^>]*>/gi, tag => {
    const rel = attributes(tag).rel?.toLowerCase();
    return rel === 'preconnect' || rel === 'dns-prefetch' ? '' : tag;
  });
  const resources = new Set(legacy
    ? [...html.matchAll(/(?:src|href)="(\/[^"#? ]+)(?:\?[^" ]*)?"/g)].map(match => match[1])
    : [...html.matchAll(/\b(?:src|href)\s*=\s*(["'])(.*?)\1/gs)].map(([, , value]) => value));
  for (const resource of resources) {
    if (resource.startsWith('//')) throw new Error(`Asset escapes case path: ${resource}`);
    if (/^[a-z][a-z\d+.-]*:/i.test(resource) || /^[?#]/.test(resource) || !resource) continue;
    const decoded = decodeURIComponent(resource.split(/[?#]/)[0]);
    if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').some(part => part === '..')) throw new Error(`Unsafe resource path: ${resource}`);
    const pathname = new URL(decoded, `${origin}${prefix}${pagePath}`).pathname;
    if (!pathname.startsWith(prefix)) throw new Error(`Asset escapes case path: ${resource}`);
    const path = resolve(directory, pathname.slice(prefix.length));
    if (path !== resolve(directory) && !path.startsWith(resolve(directory) + sep)) throw new Error(`Asset escapes output: ${resource}`);
    const info = await stat(path);
    await access(info.isDirectory() ? join(path, 'index.html') : path);
  }
}

export async function validateExport(directory, site) {
  const html = await readFile(join(directory, 'index.html'), 'utf8');
  const canonical = [...html.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0])).filter(tag => tag.rel?.toLowerCase() === 'canonical');
  if (canonical.length !== 1 || canonical[0].href !== `${origin}/${site.slug}/`) throw new Error(`Invalid canonical URL: ${site.slug}`);
  if (site.framework === 'vite' || site.framework === 'interactive') {
    const tags = [...html.matchAll(/<(?:script|link)\b[^>]*>/g)].map(match => attributes(match[0]));
    const assetPrefix = `/${site.slug}/assets/`;
    if (!tags.some(tag => tag.type === 'module' && tag.src?.startsWith(assetPrefix) && /\.js(?:\?|$)/.test(tag.src)) || !tags.some(tag => tag.rel === 'stylesheet' && tag.href?.startsWith(assetPrefix) && /\.css(?:\?|$)/.test(tag.href))) throw new Error(`Invalid Vite assets: ${site.slug}`);
    if (site.framework === 'vite') {
      await access(join(directory, '404.html'));
      await access(join(directory, 'en/404.html'));
    } else {
      const policy = [...html.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0])).find(tag => tag['http-equiv']?.toLowerCase() === 'content-security-policy');
      if (!policy?.content?.split(';').map(value => value.trim()).includes("connect-src 'none'")) throw new Error('Interactive preview requires a network-denying CSP');
      if (tags.some(tag => tag.src && !tag.src.startsWith(assetPrefix) || tag.rel === 'stylesheet' && !tag.href?.startsWith(assetPrefix))) throw new Error('Interactive preview resources must be local');
    }
  } else if (site.framework !== 'screen' && !html.includes(`/${site.slug}/_next/static/`)) {
    throw new Error(`Invalid Next.js base path: ${site.slug}`);
  }

  const strict = site.framework === 'vite' || site.indexable === false;
  // Check nested Next exports too, while retaining their legacy root-home link contract.
  const files = await htmlFiles(directory);
  for (const file of files) {
    const content = await readFile(file, 'utf8');
    await validateLocalReferences(content, directory, site.slug, relative(directory, file).split(sep).join('/'), { legacy: !strict });
    if (site.slug === 'logistics' && site.framework === 'interactive') {
      // Anchors may return to the Hub. Runtime resources may only load from
      // this reviewed export, including images that the generic legacy check
      // deliberately leaves outside its publication contract.
      for (const [tag] of content.matchAll(/<(?:script|link|img|source|video|audio|iframe|object|embed|input)\b[^>]*>/gi)) {
        const values = attributes(tag);
        if (/<link\b/i.test(tag) && ['canonical', 'alternate'].includes(values.rel?.toLowerCase())) continue;
        if (['preconnect', 'dns-prefetch'].includes(values.rel?.toLowerCase())) throw new Error('Logistics demo cannot request connection hints');
        for (const match of tag.matchAll(/\b(src|href|poster|data|srcset)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
          const value = match[2] ?? match[3] ?? match[4];
          const resources = match[1].toLowerCase() === 'srcset' ? value.split(',').map(part => part.trim().split(/\s+/)[0]) : [value];
          for (const resource of resources) {
            if (!resource || !resource.startsWith('/logistics/')) throw new Error('Logistics demo resources must stay under /logistics/');
            await validateLocalReferences(`<img src="${escape(resource)}">`, directory, site.slug);
          }
        }
      }
    }
    if (site.indexable === false) {
      const robots = [...content.matchAll(/<meta\b[^>]*>/gi)].map(match => attributes(match[0])).filter(tag => tag.name?.toLowerCase() === 'robots');
      if (!robots.length || robots.some(tag => {
        const tokens = (tag.content || '').toLowerCase().split(/[\s,]+/);
        return !tokens.includes('noindex') || !tokens.includes('nofollow') || tokens.includes('index') || tokens.includes('follow');
      })) throw new Error(`Missing noindex,nofollow in ${site.slug}/${relative(directory, file)}`);
    }
  }
  if (site.slug === 'shengfengyang' || site.slug === 'rui-cafe') {
    const routes = site.slug === 'rui-cafe' ? ruiCafeRoutes : shengfengyangRoutes;
    const name = site.slug === 'rui-cafe' ? 'Rui Café' : 'Shengfengyang';
    for (const route of routes) {
      const content = await readFile(join(directory, route, 'index.html'), 'utf8');
      const expected = `${origin}/${site.slug}/${route}`;
      const canonical = [...content.matchAll(/<link\b[^>]*>/gi)].map(match => attributes(match[0])).filter(tag => tag.rel?.toLowerCase() === 'canonical');
      if (canonical.length !== 1 || canonical[0].href !== expected) throw new Error(`Incorrect ${name} canonical: ${expected}`);
      const headings = [...content.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/gi)];
      if (headings.length !== 1 || !headings[0][1].replace(/<[^>]*>/g, '').trim()) throw new Error(`${name} page must have one nonempty H1: ${expected}`);
    }
  }
  if (site.indexable === false) {
    try {
      await access(join(directory, 'sitemap.xml'));
    } catch (error) {
      if (error.code === 'ENOENT') return;
      throw error;
    }
    throw new Error(`Non-indexable proposal must not export sitemap.xml: ${site.slug}`);
  }
  await access(join(directory, 'sitemap.xml'));
  if (site.slug === 'truck-transport') {
    assertTransportSitemap(await readFile(join(directory, 'sitemap.xml'), 'utf8'));
    for (const route of transportRoutes) {
      const content = await readFile(join(directory, route, 'index.html'), 'utf8');
      const assets = assertTransportPage(content, `${origin}/truck-transport/${route}`);
      for (const asset of assets) await access(join(directory, new URL(asset).pathname.slice('/truck-transport/'.length)));
    }
  }
}

export function buildRobots(sites) {
  const blocked = sites.filter(site => site.indexable === false).map(site => `Disallow: /${site.slug}/`);
  const sitemaps = sites.filter(site => site.indexable !== false).map(site => `Sitemap: ${origin}/${site.slug}/sitemap.xml`);
  return ['User-agent: *', 'Allow: /', ...blocked, ...sitemaps, ''].join('\n');
}

export function renderCards(sites) {
  return sites.filter(site => site.listed !== false).map(site => `<a class="card" href="./${site.slug}/"><img src="./${site.slug}/_showcase-preview.jpg" alt="${escape(site.name)} 首頁截圖" width="960" height="540" loading="lazy"><div class="card-body"><small>${escape(projectType(site))} · ${escape(site.category)}</small><h3>${escape(site.name)}</h3><p>${escape(site.purpose || site.category)}</p>${site.status === 'proposal' ? '<p>概念提案・非官方網站，未代表正式客戶委託。</p>' : ''}<span>${site.status === 'proposal' ? '查看概念提案' : site.framework === 'screen' ? '查看畫面預覽' : site.framework === 'interactive' ? '操作互動展示' : '瀏覽展示案例'} →</span></div></a>`).join('\n');
}

const projectType = site => {
  // 僅將這個已確認的 LP 模板來源對應到既有 LP 分類，不新增 TEMPLATE 類型或通配規則。
  if (site.repository === 'xk2022/xk-template-lp') return 'LP';
  if (site.repository === 'xk2022/codex-xk-apparel-store') return 'APP';
  return (site.repository?.split('/')[1]?.split('-')[1] || 'XK').toUpperCase();
};
const typeInfo = {
  LP: ['快速轉換頁', '適用活動入口、精選預購（10品項內）與工程詢價留單——資訊不發散、轉換更直接！', '專為單一目標打造的快速轉換頁'],
  BRAND: ['品牌形象網站', '聚焦品牌故事、核心理念、特色風格與精選作品——傳遞獨特價值，讓客戶一眼認同！', '專為品牌美學打造的形象官方網站'],
  CORP: ['企業商務官網', '完整架構公司簡介、多項業務、產品目錄與最新動態——展現組織實力，強化合作信任！', '專為企業規模打造的商務官方網站'],
  SHOP: ['品牌購物商城', '瀏覽商品、比較規格、加入購物袋與結帳。', ''],
  APP: ['專屬行動應用', '整合會員系統、即時推播、預約下單與專屬功能——進駐客戶手機桌面，提高回購與黏著度！', '專為深度互動打造的客製化專屬 APP'],
  AI: ['智慧應用解決方案', '串接智能客服、知識庫問答、自動化流程與數據輔助——減少重複人力，讓營運24小時高效運轉！', '專為效率升級打造的客製化 AI 應用'],
};

export function renderGallery(sites) {
  const visible = sites.filter(site => site.listed !== false);
  const types = new Map();
  const brands = new Map();
  for (const site of visible) {
    const type = projectType(site);
    const brand = site.brand || site.name;
    if (!types.has(type)) types.set(type, []);
    if (!brands.has(brand)) brands.set(brand, []);
    types.get(type).push(site);
    brands.get(brand).push(site);
  }
  const order = key => Object.keys(typeInfo).includes(key) ? Object.keys(typeInfo).indexOf(key) : 99;
  const section = (title, subtitle, rows, headline) => `<section class="group"><header class="group-heading"><div><h2>${escape(title)} <small class="count">${rows.length} 件</small></h2>${headline ? `<p class="group-lead">${escape(headline)}</p>` : ''}${subtitle ? `<p>${escape(subtitle)}</p>` : ''}</div></header>${rows.length ? `<div class="grid">${renderCards(rows)}</div>` : `<p>展示案例籌備中。</p>`}</section>`;
  if (!types.has('AI')) types.set('AI', []);
  const sortedTypes = [...types].sort(([a], [b]) => order(a) - order(b));
  const sortedBrands = [...brands].filter(([, rows]) => rows.length >= 2).sort(([, a], [, b]) => b.length - a.length);
  const brandSections = sortedBrands.map(([name, rows]) => section(name, [...new Set(rows.map(projectType))].join(' · '), [...rows].sort((a,b) => order(projectType(a)) - order(projectType(b))))).join('');
  return `<div class="gallery-mode" role="group" aria-label="作品瀏覽方式"><input type="radio" name="gallery-view" id="view-type" checked><input type="radio" name="gallery-view" id="view-brand"><div class="view-controls"><label for="view-type">依網站類型</label><label for="view-brand">依品牌</label><span class="total">全站 ${visible.length} 件展示作品</span></div><div class="type-view">${sortedTypes.map(([key, rows]) => section(`${key}｜${typeInfo[key]?.[0] || '其他網站'}`, typeInfo[key]?.[1], rows, typeInfo[key]?.[2])).join('')}</div><div class="brand-view"><p>僅展示擁有兩件以上作品的品牌（共 ${sortedBrands.length} 個品牌）。</p>${brandSections || '<p>目前尚無符合條件的品牌，請切換至依網站類型查看所有作品。</p>'}</div></div>`;
}

export function renderNotFound(sites) {
  const fallbacks = sites.filter(site => site.framework === 'vite').map(site => [`/${site.slug}/`, `/${site.slug}/404.html`, `/${site.slug}/en/404.html`]);
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>找不到頁面｜XK SYSTEM</title></head><body><main><h1>找不到頁面 / Page not found</h1><p>請使用網站導覽返回。Return to the showcase to continue.</p><a href="/">XK SYSTEM Showcase</a></main><script>const fallbacks=${JSON.stringify(fallbacks)};const match=fallbacks.find(([prefix])=>location.pathname.startsWith(prefix));if(match){const english=location.pathname.startsWith(match[0]+'en/')||new URLSearchParams(location.search).get('lang')==='en';location.replace(match[english?2:1]);}</script></body></html>\n`;
}
