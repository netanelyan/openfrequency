import { getJson, getText } from '../core/net.js';
import { titleOf } from '../sources/text.js';

// A store, read for its demo: its name and currency from Shopify's public store summary (/meta.json), its products
// and categories from the public catalogue (/products.json, /collections.json), and its colour from the homepage's
// theme-color. Shopify only for now; any other platform is told so, plainly, on /demos.
//
// The store's document is its catalogue written out as lines: its categories, its price range, each product with
// its price. The demo's last slide, which sends the reader to the store, may quote it word for word, so a number
// about the store is a number the store published. Its products' pictures move past beside the title on its page.

export class DemoError extends Error {}

/** The store's homepage as https://host, or null for something that is not an address. */
export function storeOrigin(input) {
  const t = String(input || '').trim();
  if (!t || /\s/.test(t)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
    return `https://${u.hostname.toLowerCase()}`;
  } catch {
    return null;
  }
}

export const domainOf = (origin) => new URL(origin).hostname.replace(/^www\./, '');

const money = (v) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
};
// 289 or 289.9, as a shop writes it: no trailing .00.
const num = (n) => (Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100));

/** Read a Shopify store. get/getPage are injectable (tests). Throws DemoError with a sentence for the operator. */
export async function readStore(url, { get = getJson, getPage = getText } = {}) {
  const origin = storeOrigin(url);
  if (!origin) throw new DemoError('הכתובת של החנות לא תקינה');
  let catalogue;
  try {
    catalogue = await get(`${origin}/products.json?limit=100`);
  } catch {
    throw new DemoError('לא הצלחנו לקרוא את המוצרים: נראה שהחנות לא על Shopify, או שהאתר לא ענה');
  }
  const products = Array.isArray(catalogue?.products) ? catalogue.products : null;
  if (!products) throw new DemoError('לא הצלחנו לקרוא את המוצרים: נראה שהחנות לא על Shopify');
  const meta = await get(`${origin}/meta.json`).catch(() => null);
  const cols = await get(`${origin}/collections.json?limit=50`).catch(() => null);
  const page = await getPage(origin).catch(() => null);
  const html = String(page?.body || '');
  const accent = /<meta[^>]+name=["']theme-color["'][^>]+content=["'](#[0-9a-f]{6})["']/i.exec(html)?.[1] || null;
  const title = titleOf(html);
  const name = String(meta?.name || title?.split(/[|–—-]/)[0] || domainOf(origin)).trim();
  const collections = (Array.isArray(cols?.collections) ? cols.collections : [])
    .map((c) => String(c.title || '').trim())
    .filter((t) => t && !/^(all|home ?page|frontpage|הכל|כל המוצרים)$/i.test(t));
  return { origin, domain: domainOf(origin), name, currency: meta?.currency || 'ILS', accent, products, collections, logo: logoOf(html, origin, name) };
}

/**
 * The store's logo, from its homepage: the first picture whose class, name or file says logo, or whose text is the
 * store's name (a Shopify theme's header logo is both). Its address on the store's own CDN, or null.
 */
export function logoOf(html, origin, name = '') {
  for (const [tag] of String(html || '').matchAll(/<img\b[^>]*>/gi)) {
    const attr = (k) => new RegExp(`\\s${k}=["']([^"']*)["']`, 'i').exec(tag)?.[1] || '';
    const src = attr('src').replace(/&amp;/g, '&');
    if (!src || /^data:/i.test(src)) continue;
    const alt = attr('alt').trim();
    if (!/logo/i.test(`${attr('class')} ${src} ${alt}`) && !(name && alt === name)) continue;
    try {
      const u = new URL(src.startsWith('//') ? `https:${src}` : src, origin);
      if (u.protocol !== 'https:' || /\.svg$/i.test(u.pathname)) continue;
      u.searchParams.delete('width');
      return u.href;
    } catch {
      // an address that does not parse: the next picture
    }
  }
  return null;
}

const priceOf = (p) => {
  const prices = (p.variants || []).map((v) => money(v.price)).filter(Boolean);
  return prices.length ? { min: Math.min(...prices), max: Math.max(...prices) } : null;
};

/** The products a demo may show: with a photograph, a price and something in stock, the newest first. */
export function usable(products) {
  return (products || [])
    .filter((p) => p?.images?.[0]?.src && priceOf(p) && (p.variants || []).some((v) => v.available !== false))
    .sort((a, b) => String(b.published_at || '').localeCompare(String(a.published_at || '')));
}

const MAX_PRODUCTS = 60;

/** The store's document: its catalogue as lines. { key: 'store', url, title, text }. */
export function storeDocument(store) {
  const cur = store.currency === 'ILS' ? '₪' : store.currency;
  const list = usable(store.products).slice(0, MAX_PRODUCTS);
  const lines = [`${store.name} היא חנות אונליין בכתובת ${store.domain}.`];
  if (store.collections?.length) lines.push(`הקטגוריות באתר: ${store.collections.slice(0, 30).join(', ')}.`);
  const prices = list.map(priceOf).filter(Boolean);
  if (prices.length) {
    const lo = Math.min(...prices.map((p) => p.min));
    const hi = Math.max(...prices.map((p) => p.max));
    lines.push(lo === hi ? `המחירים באתר: ${num(lo)} ${cur}.` : `המחירים באתר: מ-${num(lo)} ${cur} עד ${num(hi)} ${cur}.`);
  }
  for (const p of list) {
    const pr = priceOf(p);
    const type = p.product_type ? ` (${String(p.product_type).trim()})` : '';
    lines.push(`${String(p.title).trim()}${type}: ${pr.min === pr.max ? `${num(pr.min)} ${cur}` : `מ-${num(pr.min)} ${cur}`}.`);
  }
  return { key: 'store', url: store.origin, title: store.name, text: lines.join('\n') };
}

/** The catalogue as the topic's chooser reads it: one line per product, with its id. */
export const catalogueLines = (store) =>
  usable(store.products)
    .slice(0, MAX_PRODUCTS)
    .map((p) => `${p.id} | ${String(p.title).trim()}${p.product_type ? ` | ${p.product_type}` : ''}${[].concat(p.tags || []).length ? ` | ${[].concat(p.tags).slice(0, 6).join(', ')}` : ''}`)
    .join('\n');

/** What the store's page says was read: { products, images, categories, low, high }. */
export function storeStats(store) {
  const list = usable(store.products);
  const prices = list.map(priceOf);
  return {
    products: list.length,
    images: list.reduce((n, p) => n + (p.images || []).length, 0),
    categories: (store.collections || []).length,
    low: prices.length ? Math.min(...prices.map((p) => p.min)) : null,
    high: prices.length ? Math.max(...prices.map((p) => p.max)) : null,
  };
}

/** The products that move past beside the title on the store's page: [{ title, price, src }], the newest first. */
export const shelfOf = (store, n = 12) =>
  usable(store.products)
    .slice(0, n)
    .map((p) => ({ title: String(p.title).trim(), price: priceOf(p).min, src: String(p.images[0].src) }));
