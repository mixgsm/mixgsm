// MIX GSM - catalog.json -> ortak urun beslemesi (feed/products.json) + statik fiyat sayfasi (fiyat-listesi/)
//
// Bu script (generate-catalog.js gibi) sunucu tarafinda / yerelde calisir; harici servise BAGLANMAZ,
// yalnizca depodaki catalog.json ve feed/business.public.json dosyalarini okur.
//
//   node scripts/generate-price-page.js
//
// Girdi : catalog.json                 (scripts/generate-catalog.js uretir; Sheets -> catalog.json)
//         feed/business.public.json    (isletme bilgisi; mixgsm-ops sozlesmesinden UretILIR, elle duzenlenmez)
// Cikti : feed/products.json           (sozlesme: mixgsm.product-feed v1; WhatsApp/Instagram/firsat tuketebilir)
//         fiyat-listesi/index.html     (JavaScript'siz, taranabilir statik sayfa)
//
// ONEMLI: normalizasyon / slug / varyant / kayit kurallari mixgsm-ops/contract/tools/lib.mjs ve
// index.html ile BIREBIR AYNI olmalidir. Ayni kuralin iki kopyasi oldugu icin mixgsm-ops'ta
// `node contract/tools/check-contract.mjs` uyum testi vardir; bu dosyada kural degisirse orayi da guncelleyin.
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CATALOG_PATH = path.join(ROOT, "catalog.json");
const BUSINESS_PATH = path.join(ROOT, "feed", "business.public.json");
const FEED_PATH = path.join(ROOT, "feed", "products.json");
const PAGE_DIR = path.join(ROOT, "fiyat-listesi");
const PAGE_PATH = path.join(PAGE_DIR, "index.html");
const SITE_ORIGIN = "https://mixgsm.tr";
const CONTRACT_VERSION = "1.0.0";

// ---------------------------------------------------------------- kurallar (sozlesme ile ayni)
function normalizeTR(v) {
  return (v || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/İ/g, "i").replace(/ş/g, "s").replace(/Ş/g, "s")
    .replace(/ğ/g, "g").replace(/Ğ/g, "g").replace(/ü/g, "u").replace(/Ü/g, "u")
    .replace(/ö/g, "o").replace(/Ö/g, "o").replace(/ç/g, "c").replace(/Ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function normalizeText(v) {
  const pre = String(v || "").replace(/\+/g, " plus ");
  return normalizeTR(pre).replace(/(\d)\s+g\b/g, "$1g");
}

const slugify = (v) => normalizeText(v).replace(/\s+/g, "-");

function legacyProductSlug(p) {
  const base = normalizeTR(`${p.b} ${p.m}`).trim().replace(/\s+/g, "-");
  const nums = String(p.s || "").match(/\d+/g);
  const suffix = nums && nums.length ? nums.join("-") : "";
  return suffix ? `${base}-${suffix}` : base;
}

function isNonProductRow(p) {
  const brand = normalizeTR(p.b || "");
  const model = normalizeTR(p.m || "");
  const text = `${brand} ${model}`.trim();
  if (!brand || !model) return true;
  const titleTerms = ["marka model", "urun tanimi", "modelleri", "modeller", "guncelleme", "whatsapp",
    "fiyat listesi", "iletisim", "urunleri", "urunler", "liste"];
  if (titleTerms.some((term) => text.includes(term))) return true;
  const brandOnly = new Set(["apple", "apple iphone", "iphone", "samsung", "xiaomi", "redmi", "poco",
    "infinix", "tecno", "oneplus", "google", "pixel", "dyson", "braun", "philips"]);
  if (brandOnly.has(model)) return true;
  if (model === brand || model.replace(/\s+/g, "") === brand.replace(/\s+/g, "")) return true;
  return false;
}

const LEGACY_BRAND_TO_CANONICAL = { IPHONE: "APPLE", "RED MAGIC": "REDMAGIC" };
const canonicalBrand = (b) => {
  const upper = String(b || "").trim().toUpperCase();
  return LEGACY_BRAND_TO_CANONICAL[upper] || upper;
};
const brandKey = (b) => slugify(canonicalBrand(b));
function modelKey(p) {
  const bk = brandKey(p.b);
  const ms = slugify(p.m);
  return ms === bk || ms.startsWith(bk + "-") ? ms : `${bk}-${ms}`;
}

function parseVariant(s) {
  const raw = String(s || "").trim();
  const pair = raw.match(/^(\d+)\s*GB\s*\/\s*(\d+)\s*(GB|TB)$/i);
  if (pair) {
    const storage = pair[3].toUpperCase() === "TB" ? Number(pair[2]) * 1024 : Number(pair[2]);
    return { label: raw, ram_gb: Number(pair[1]), storage_gb: storage };
  }
  const single = raw.match(/^(\d+)\s*(GB|TB)$/i);
  if (single) {
    const storage = single[2].toUpperCase() === "TB" ? Number(single[1]) * 1024 : Number(single[1]);
    return { label: raw, ram_gb: null, storage_gb: storage };
  }
  return { label: raw === "-" ? "" : raw, ram_gb: null, storage_gb: null };
}

// enums.json ile ayni (uyum testi: check-contract.mjs)
const STOCK_LABEL_TR = { IN: "Stokta", OUT: "Tükendi", ASK: "Sorunuz" };
const STOCK_SCHEMA_ORG = {
  IN: "https://schema.org/InStock",
  OUT: "https://schema.org/OutOfStock",
  ASK: "https://schema.org/LimitedAvailability",
};
const REGISTRATION_SYNONYMS = { REGISTERED: ["kayitli"], UNREGISTERED: ["kayitsiz"], ASK: ["sorunuz", "soru", "sor"] };
// (kayit durumu etiketleri KALDIRILDI: IMEI/kayit durumu fiyat sayfasinda gosterilmez; feed'de veri olarak durur)
function registrationCode(raw) {
  const t = normalizeTR(raw);
  if (!t) return "NOT_APPLICABLE";
  for (const code of Object.keys(REGISTRATION_SYNONYMS)) if (REGISTRATION_SYNONYMS[code].includes(t)) return code;
  return "ASK";
}

const GROUP_TITLE_TR = { PHONE: "Cep Telefonları", PERSONAL_CARE: "Kişisel Bakım" };
const BRAND_TITLE_TR = {
  XIAOMI: "Xiaomi • Redmi • POCO", APPLE: "Apple iPhone", SAMSUNG: "Samsung", INFINIX: "Infinix",
  TECNO: "Tecno", ONEPLUS: "OnePlus", GOOGLE: "Google Pixel", REDMAGIC: "RedMagic",
  PHILIPS: "Philips", BRAUN: "Braun", DYSON: "Dyson",
};

// ---------------------------------------------------------------- ortak besleme
const nn = (v) => {
  const t = String(v == null ? "" : v).trim();
  return t ? t : null;
};

function toProduct(p, updatedAt) {
  return {
    product_id: legacyProductSlug(p),
    model_key: modelKey(p),
    group: p.group === "PERSONAL_CARE" ? "PERSONAL_CARE" : "PHONE",
    brand: { key: brandKey(p.b), name: canonicalBrand(p.b) },
    model: String(p.m).trim(),
    variant: parseVariant(p.s),
    price: { amount: Number.isInteger(p.p) ? p.p : null, currency: "TRY" },
    stock: ["IN", "OUT", "ASK"].includes(p.stock) ? p.stock : "ASK",
    attributes: {
      battery: nn(p.battery), screen: nn(p.screen), processor: nn(p.processor),
      camera: nn(p.camera), connectivity: nn(p.connectivity),
    },
    registration: registrationCode(p.registration),
    warranty: String(p.warranty || "").trim(),
    tag: nn(p.tagLabel),
    image: nn(p.img),
    source: { system: "google_sheets", via: "catalog.json" },
    updated_at: updatedAt,
  };
}

function buildFeed(catalog) {
  const products = catalog.products.filter((p) => !isNonProductRow(p)).map((p) => toProduct(p, catalog.generatedAt));
  const seen = new Set();
  for (const pr of products) {
    if (seen.has(pr.product_id)) throw new Error("Tekrarlayan product_id: " + pr.product_id);
    seen.add(pr.product_id);
  }
  return {
    contract: "mixgsm.product-feed",
    contract_version: CONTRACT_VERSION,
    generated_at: catalog.generatedAt,
    count: products.length,
    products,
  };
}

// ---------------------------------------------------------------- HTML
const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const fmtPrice = (n) => `${new Intl.NumberFormat("tr-TR").format(n)} TL`;
const fmtWhen = (iso) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "long", timeStyle: "short" });

// Model adi zaten markayla basliyorsa (DYSON AIRSTART, REDMAGIC 11S PRO) markayi tekrarlamaz.
function displayName(pr) {
  const b = normalizeText(pr.brand.name);
  const m = normalizeText(pr.model);
  const base = m === b || m.startsWith(b + " ") ? pr.model : `${pr.brand.name} ${pr.model}`;
  return `${base}${pr.variant.label ? " " + pr.variant.label : ""}`.trim();
}

function requireBusiness(b) {
  const phone = b && b.contact && b.contact.status === "confirmed" && (b.contact.phones || []).find((x) => x.role === "order_whatsapp");
  const loc = b && b.location && b.location.status === "confirmed" && b.location.display && b.location.display.full;
  if (!phone || !loc) throw new Error("feed/business.public.json: onayli adres ve telefon bulunamadi");
  return { phone, address: loc, notice: b.policies && b.policies.price_notice && b.policies.price_notice.text_tr };
}

function waLink(phone, text) {
  return `https://wa.me/${phone.e164.replace("+", "")}?text=${encodeURIComponent(text)}`;
}

// links (istege bagli, main() doldurur):
//   phoneUrls: Map product_id -> mutlak urun sayfasi adresi (yalniz sayfasi GERCEKTEN olanlar)
//   laptops  : [{ name, price, url }] stokta, fiyatli, satilmamis ve sayfasi olan laptoplar
// Bos birakilirsa sayfa eski haliyle (baglantisiz, laptopsuz) cizilir.
function renderPage(feed, business, links = {}) {
  const biz = requireBusiness(business);
  const phoneUrls = links.phoneUrls instanceof Map ? links.phoneUrls : new Map();
  const laptops = Array.isArray(links.laptops) ? links.laptops : [];
  const relPath = (abs) => abs.slice(SITE_ORIGIN.length);
  const when = fmtWhen(feed.generated_at);
  const url = `${SITE_ORIGIN}/fiyat-listesi/`;

  // grup -> marka -> urunler (katalogdaki ilk gorulme sirasi korunur)
  const groups = new Map();
  for (const pr of feed.products) {
    if (!groups.has(pr.group)) groups.set(pr.group, new Map());
    const brands = groups.get(pr.group);
    if (!brands.has(pr.brand.key)) brands.set(pr.brand.key, { name: pr.brand.name, items: [] });
    brands.get(pr.brand.key).items.push(pr);
  }

  const toc = [];
  let body = "";
  for (const [group, brands] of groups) {
    body += `<h2>${esc(GROUP_TITLE_TR[group] || group)}</h2>\n`;
    for (const [bkey, b] of brands) {
      const title = BRAND_TITLE_TR[b.name] || b.name;
      // IMEI/kayit durumu musteriye acik fiyat sayfasinda GOSTERILMEZ (sahip karari 2026-09-20;
      // Faz D'de ayri musteri iletisim kurali olarak ele alinacak).
      toc.push(`<li><a href="#marka-${esc(bkey)}">${esc(title)}</a></li>`);
      // Kisisel bakim urunlerinde (Dyson/Braun/Philips) RAM / Depolama anlamsiz: sutun hic yok.
      const hasVariantCol = group !== "PERSONAL_CARE";
      body += `<section id="marka-${esc(bkey)}">\n<h3>${esc(title)}</h3>\n<div class="tablewrap"><table>\n<thead><tr><th scope="col">Model</th>${hasVariantCol ? '<th scope="col">RAM / Depolama</th>' : ""}<th scope="col">Fiyat</th><th scope="col">Stok</th><th scope="col"><span class="sr">WhatsApp</span></th></tr></thead>\n<tbody>\n`;
      for (const pr of b.items) {
        const price = pr.price.amount === null ? "WhatsApp’tan sorun" : fmtPrice(pr.price.amount);
        const label = displayName(pr);
        const wa = waLink(biz.phone, `Merhaba MİX GSM, ${label} için stok ve fiyat bilgisi almak istiyorum.`);
        const pageUrl = phoneUrls.get(pr.product_id);
        const modelCell = pageUrl ? `<a href="${esc(relPath(pageUrl))}">${esc(pr.model)}</a>` : esc(pr.model);
        body += `<tr id="${esc(pr.product_id)}"><th scope="row">${modelCell}</th>${hasVariantCol ? `<td>${esc(pr.variant.label || "—")}</td>` : ""}` +
          `<td class="price">${esc(price)}</td><td><span class="stock ${pr.stock.toLowerCase()}">${esc(STOCK_LABEL_TR[pr.stock])}</span></td>` +
          "" +
          `<td><a href="${esc(wa)}" rel="noopener noreferrer" target="_blank">Sor</a></td></tr>\n`;
      }
      body += `</tbody>\n</table></div>\n</section>\n`;
    }
  }

  if (laptops.length) {
    toc.push(`<li><a href="#laptoplar">Laptoplar</a></li>`);
    body += `<h2>Laptoplar</h2>\n<section id="laptoplar">\n<p class="lead">Stoktaki laptoplar. Özellikler ve fotoğraflar ürün sayfasında.</p>\n<div class="tablewrap"><table>\n<thead><tr><th scope="col">Model</th><th scope="col">Fiyat</th><th scope="col"><span class="sr">WhatsApp</span></th></tr></thead>\n<tbody>\n`;
    for (const lp of laptops) {
      const wa = waLink(biz.phone, `Merhaba MİX GSM, ${lp.name} için stok ve fiyat bilgisi almak istiyorum.`);
      body += `<tr><th scope="row"><a href="${esc(relPath(lp.url))}">${esc(lp.name)}</a></th><td class="price">${esc(fmtPrice(lp.price))}</td>` +
        `<td><a href="${esc(wa)}" rel="noopener noreferrer" target="_blank">Sor</a></td></tr>\n`;
    }
    body += `</tbody>\n</table></div>\n</section>\n`;
  }

  const itemList = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    name: "MİX GSM Güncel Fiyat ve Stok Listesi",
    numberOfItems: feed.products.length,
    itemListElement: feed.products.map((pr, i) => ({
      "@type": "ListItem",
      position: i + 1,
      name: displayName(pr),
      url: phoneUrls.get(pr.product_id) || `${url}#${pr.product_id}`,
    })),
  };

  const description = `MİX GSM güncel telefon fiyat ve stok listesi: Xiaomi, iPhone, Samsung ve daha fazlası. Türkiye geneline kargo. Son güncelleme: ${when}.`;

  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; base-uri 'none'; form-action 'none'">
<title>Güncel Telefon Fiyat Listesi | MİX GSM · Türkiye Geneline Kargo</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${url}">
<meta name="robots" content="index, follow">
<meta property="og:type" content="website">
<meta property="og:locale" content="tr_TR">
<meta property="og:site_name" content="MİX GSM">
<meta property="og:title" content="Güncel Telefon Fiyat Listesi | MİX GSM">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${url}">
<meta property="og:image" content="https://mixgsm.tr/og-cover.jpg">
<meta name="theme-color" content="#080808">
<link rel="icon" href="/mix-gsm-logo.jpg">
<script type="application/ld+json">${jsonLd(itemList)}</script>
<style>
:root{--bg:#080808;--surface:#111;--text:#F5F5F5;--muted:#9a9a9a;--line:rgba(255,255,255,.1);--accent:#E63946;--wa:#25D366}
@media (prefers-color-scheme:light){:root{--bg:#FAFAFA;--surface:#fff;--text:#16181A;--muted:#5B5F66;--line:rgba(0,0,0,.12)}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif}
a{color:inherit}
.wrap{max-width:980px;margin:0 auto;padding:0 16px 48px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}
.brand-link{font-weight:600;text-decoration:none}
.btn{display:inline-flex;align-items:center;min-height:44px;padding:0 16px;border-radius:10px;border:1px solid var(--line);text-decoration:none;font-size:14px}
.btn.wa{background:var(--wa);color:#06210f;border-color:transparent;font-weight:600}
h1{font-size:clamp(24px,5vw,34px);line-height:1.2;margin:24px 0 8px}
.lead{color:var(--muted);margin:0 0 4px}
.notice{margin:16px 0;padding:12px 14px;border:1px solid var(--line);border-radius:10px;background:var(--surface);font-size:14px}
.toc ul{list-style:none;display:flex;flex-wrap:wrap;gap:8px;padding:0;margin:16px 0}
.toc a{display:inline-flex;align-items:center;min-height:36px;padding:0 12px;border:1px solid var(--line);border-radius:99px;text-decoration:none;font-size:14px}
h2{margin:32px 0 4px;font-size:22px}
h3{margin:20px 0 8px;font-size:17px}
section{scroll-margin-top:12px}
.tablewrap{overflow-x:auto;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
table{border-collapse:collapse;width:100%;min-width:560px;font-size:14px}
th,td{padding:10px 12px;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
thead th{font-size:12px;color:var(--muted);text-transform:uppercase;letter-spacing:.5px}
tbody tr:last-child th,tbody tr:last-child td{border-bottom:0}
tbody th{font-weight:600}
td.price{white-space:nowrap;font-weight:600}
.stock{font-size:12px;font-weight:600;padding:2px 8px;border-radius:99px;border:1px solid var(--line);white-space:nowrap}
.stock.in{color:#1a9c4a;border-color:#1a9c4a}
.stock.ask{color:#b7791f;border-color:#b7791f}
.stock.out{color:var(--accent);border-color:var(--accent)}
tr:target{outline:2px solid var(--accent);outline-offset:-2px}
footer{margin-top:40px;padding-top:16px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
.sr{position:absolute;width:1px;height:1px;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap}
@media (max-width:600px){table{min-width:0;font-size:13px}th,td{padding:8px 6px}th:first-child,td:first-child{padding-left:10px}th:last-child,td:last-child{padding-right:10px}thead th{font-size:11px;letter-spacing:0}.stock{padding:2px 6px;font-size:11px}}
</style>
</head>
<body>
<div class="wrap">
<div class="top">
<a class="brand-link" href="/">MİX GSM</a>
<a class="btn wa" href="${esc(biz.phone.whatsapp_url)}" rel="noopener noreferrer" target="_blank">WhatsApp’tan Yaz</a>
</div>
<main>
<h1>Güncel Fiyat ve Stok Listesi</h1>
<p class="lead">Son güncelleme: <time datetime="${esc(feed.generated_at)}">${esc(when)}</time> (Türkiye saati)</p>
<p class="notice">${esc(biz.notice || "")} Sipariş vermeden önce WhatsApp üzerinden stok ve fiyat teyidi almak en sağlıklı yöntemdir.</p>
<nav class="toc" aria-label="Markalar"><ul>
${toc.join("\n")}
</ul></nav>
${body}</main>
<footer>
<p>${esc(biz.address)}<br><a href="tel:${esc(biz.phone.e164)}">${esc(biz.phone.display)}</a> · <a href="/">Ana sayfa (ürün kataloğu)</a></p>
<p>Bu sayfa katalog verisinden otomatik oluşturulur.</p>
</footer>
</div>
</body>
</html>
`;
}

// ---------------------------------------------------------------- urun sayfasi baglantilari
// Adresler urun sayfasi ureticisinin (generate-product-pages.js pageModels) KENDI
// modellerinden alinir; ayrica sayfa dosyasi depoda GERCEKTEN varsa baglanti verilir
// (yeni urunun sayfasi bir sonraki calismada olusunca baglanti da gelir; 404 yok).
const pageExists = (root, abs) => {
  const rel = abs.slice(SITE_ORIGIN.length).replace(/^\/+/, "");
  return fs.existsSync(path.join(root, rel, "index.html"));
};

function collectLinks(root, feed) {
  const phoneUrls = new Map();
  let laptops = [];
  let models = null;
  try {
    const pp = require("./generate-product-pages");
    models = pp.pageModels(root).pages.map((pg) => ({ ...pg, url: pp.pageUrl(pg) }));
  } catch (e) {
    console.log("::warning::fiyat listesi: urun sayfasi modelleri alinamadi, baglantisiz cizilecek: " + e.message);
  }
  if (models) {
    const ids = new Set(feed.products.map((pr) => pr.product_id));
    models.filter((pg) => pg.kind === "phone" && ids.has(pg.slug) && pageExists(root, pg.url))
      .forEach((pg) => phoneUrls.set(pg.slug, pg.url));
    // Laptop: yalniz stokta, fiyatli, satilmamis ve sayfasi olan (rehber/llms ile ayni kural).
    try {
      laptops = models.filter((pg) => pg.kind === "laptop" && !pg.sold && pg.stock === "IN" && typeof pg.price === "number" && pg.price > 0 && pageExists(root, pg.url))
        .map((pg) => ({ name: pg.name, price: pg.price, url: pg.url }));
    } catch (e) {
      console.log("::warning::fiyat listesi: laptop ozeti atlandi: " + e.message);
      laptops = [];
    }
  }
  return { phoneUrls, laptops };
}

// ---------------------------------------------------------------- calistirma
function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  if (!catalog || !Array.isArray(catalog.products) || !catalog.products.length || !catalog.generatedAt) {
    throw new Error("catalog.json bos/gecersiz - feed ve fiyat sayfasi GUNCELLENMEDI.");
  }
  const business = JSON.parse(fs.readFileSync(BUSINESS_PATH, "utf8"));
  const feed = buildFeed(catalog);
  if (!feed.count) throw new Error("Urun sayisi 0 - feed ve fiyat sayfasi GUNCELLENMEDI.");
  const html = renderPage(feed, business, collectLinks(ROOT, feed)); // hata olursa hicbir dosya yazilmaz

  fs.mkdirSync(path.dirname(FEED_PATH), { recursive: true });
  fs.mkdirSync(PAGE_DIR, { recursive: true });
  fs.writeFileSync(FEED_PATH, JSON.stringify(feed) + "\n", "utf8");
  fs.writeFileSync(PAGE_PATH, html, "utf8");
  console.log(`feed/products.json ve fiyat-listesi/index.html yazildi: ${feed.count} urun.`);
}

// Fiyat sayfasi icerik kontrolleri (--verify ve testler). Hata listesi doner.
//  - her urun satiri var, fiyat/stok besleme ile ayni
//  - urun adi baglantisi ve JSON-LD adresi: urun sayfasi varsa ONA, yoksa sayfa ici capaya
//  - baglanti verilen her urun/laptop sayfasi depoda var ve noindex degil
//  - kisisel bakim tablolarinda RAM / Depolama sutunu yok
//  - IMEI/kayit durumu bilgisi yok
function verifyPage(html, feed, root) {
  const errors = [];
  const rowOf = (id) => {
    const i = html.indexOf(`<tr id="${id}">`);
    return i < 0 ? null : html.slice(i, html.indexOf("</tr>", i));
  };
  let ld = null;
  try { ld = JSON.parse((html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/) || [])[1]); } catch (e) { ld = null; }
  if (!ld || !Array.isArray(ld.itemListElement)) errors.push("JSON-LD ItemList okunamadi");
  const ldUrl = new Map((ld && ld.itemListElement || []).map((x) => [x.position, x.url]));
  feed.products.forEach((pr, i) => {
    const id = pr.product_id;
    const row = rowOf(id);
    if (!row) { errors.push(`sayfada urun yok: ${id}`); return; }
    const price = pr.price.amount === null ? "WhatsApp’tan sorun" : fmtPrice(pr.price.amount);
    if (!row.includes(`>${esc(price)}<`)) errors.push(`fiyat uyumsuz: ${id} (${price})`);
    if (!row.includes(`>${esc(STOCK_LABEL_TR[pr.stock])}<`)) errors.push(`stok uyumsuz: ${id}`);
    const abs = `${SITE_ORIGIN}/urun/${id}/`;
    const hasPage = fs.existsSync(path.join(root, "urun", id, "index.html"));
    const linked = row.includes(`<a href="/urun/${id}/">`);
    if (hasPage && !linked) errors.push(`urun sayfasi var ama baglanti yok: ${id}`);
    if (!hasPage && linked) errors.push(`olmayan urun sayfasina baglanti: ${id}`);
    const expectUrl = hasPage ? abs : `${SITE_ORIGIN}/fiyat-listesi/#${id}`;
    if (ldUrl.get(i + 1) !== expectUrl) errors.push(`JSON-LD adresi yanlis: ${id} (${ldUrl.get(i + 1)})`);
    if (pr.group === "PERSONAL_CARE" && /<td>[^<]*(GB|—)<\/td>/.test(row)) errors.push(`kisisel bakim satirinda RAM/Depolama hucresi: ${id}`);
  });
  // Kisisel bakim marka bolumlerinde RAM sutunu basligi olmamali.
  const careKeys = new Set(feed.products.filter((pr) => pr.group === "PERSONAL_CARE").map((pr) => pr.brand.key));
  careKeys.forEach((k) => {
    const i = html.indexOf(`<section id="marka-${k}">`);
    if (i >= 0 && html.slice(i, html.indexOf("</section>", i)).includes("RAM / Depolama")) errors.push(`kisisel bakim tablosunda RAM / Depolama sutunu: ${k}`);
  });
  // Laptop baglantilari: sayfa var, satilmis (noindex) degil.
  for (const m of html.matchAll(/href="\/laptop\/([a-z0-9-]+)\/"/g)) {
    const file = path.join(root, "laptop", m[1], "index.html");
    if (!fs.existsSync(file)) errors.push(`olmayan laptop sayfasina baglanti: ${m[1]}`);
    else if (/<meta name="robots" content="noindex/.test(fs.readFileSync(file, "utf8"))) errors.push(`satilmis (noindex) laptop listede: ${m[1]}`);
  }
  if (/Kayıtlı|Kayıtsız|Kayıt Durumu|IMEI/.test(html)) errors.push("sayfada IMEI/kayit durumu bilgisi var (gosterilmemeli)");
  return errors;
}

// --verify: catalog.json, feed/products.json ve fiyat-listesi/index.html AYNI veri anlik goruntusunden mi?
// Workflow'da uretimden sonra calisir; tutarsizlik varsa is akisi HATA verir (sessiz eski sayfa birakilmaz).
function verify() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const feed = JSON.parse(fs.readFileSync(FEED_PATH, "utf8"));
  const html = fs.readFileSync(PAGE_PATH, "utf8");
  const expected = catalog.products.filter((p) => !isNonProductRow(p));
  const errors = [];
  if (feed.generated_at !== catalog.generatedAt) errors.push(`feed generated_at (${feed.generated_at}) != catalog generatedAt (${catalog.generatedAt})`);
  if (feed.count !== expected.length || feed.products.length !== expected.length) errors.push(`urun sayisi uyumsuz: feed=${feed.count}/${feed.products.length} catalog=${expected.length}`);
  if (!html.includes(`datetime="${catalog.generatedAt}"`)) errors.push("fiyat-listesi/index.html baska bir zaman damgasi gosteriyor");
  errors.push(...verifyPage(html, feed, ROOT));
  if (errors.length) throw new Error("Tutarlilik hatasi:\n - " + errors.join("\n - "));
  console.log(`Tutarlilik dogrulandi: catalog.json, feed/products.json ve fiyat-listesi/index.html ayni veri (${expected.length} urun, ${catalog.generatedAt}).`);
}

module.exports = {
  normalizeTR, normalizeText, legacyProductSlug, isNonProductRow, canonicalBrand, brandKey, modelKey,
  parseVariant, registrationCode, buildFeed, renderPage, collectLinks, verifyPage,
  STOCK_LABEL_TR, STOCK_SCHEMA_ORG, REGISTRATION_SYNONYMS,
};

// Calistirma blogu module.exports'tan SONRA: main() icinde generate-product-pages
// yuklenirken (o da bu dosyayi require eder) disa acilan fonksiyonlar hazir olsun.
if (require.main === module) {
  try {
    if (process.argv.includes("--verify")) verify();
    else main();
  } catch (err) {
    console.error("HATA:", err.message);
    process.exit(1);
  }
}

