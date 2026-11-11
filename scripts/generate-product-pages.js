// MIX GSM - Urun sayfalari ureteci (Google'da urun bazinda gorunurluk)
//
//   node scripts/generate-product-pages.js           -> urun/<slug>/index.html,
//                                                       laptop/<slug>/index.html,
//                                                       urun/index.html (tum urunler)
//   node scripts/generate-product-pages.js --check   -> yalnizca kontrol; diskteki
//                                                       sayfalar guncel degilse cikis 1
//
// NEDEN: Ana site tek sayfadir; urunler "#urun/..." ile pencere olarak acilir ve
// arama motorlari bunlari ayri sayfa olarak gormez. Bu script her urun icin
// kendi adresi, basligi, aciklamasi ve yapilandirilmis verisi (schema.org
// Product) olan sade bir sayfa uretir. Sayfa, ziyaretciyi katalogdaki ayni
// urune ("/#urun/<slug>") ve WhatsApp'a goturur.
//
// KURALLAR
// - Tek veri kaynagi catalog.json + catalog-laptop.json. Hicbir bilgi uydurulmaz;
//   bos alan sayfada hic gosterilmez.
// - Adresler sitenin urun baglantisiyla AYNI slug'i kullanir (telefon:
//   legacyProductSlug = sitedeki productSlug; laptop: laptopSlugOf).
// - Taksit kurali, ozellik yazimi (displaySpec) ve WhatsApp mesaji site
//   kodundan (js/app.<hash>.js) OKUNUP calistirilir; burada kopyasi tutulmaz.
// - IMEI/kayit durumu, garanti ve fatura bilgisi bu sayfalarda GOSTERILMEZ
//   (fiyat listesi sayfasindaki sahip karariyla ayni temkin).
// - Sayfalarda tarih/saat damgasi yoktur: bir sayfa yalnizca kendi urununun
//   verisi degisince degisir (her katalog guncellemesinde yuzlerce dosya
//   commit edilmez).
// - Katalogdan kalkan urunun sayfasi silinir. Yalnizca bu scriptin urettigi
//   (PAGE_MARKER tasiyan) klasorler silinir; baska hicbir dosyaya dokunulmaz.
// - Once TUM sayfalar bellekte uretilir; hata olursa diske hicbir sey yazilmaz.
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { readAppSource } = require("./asset-version");
const { loadSiteImageMatcher } = require("./check-images");
const priceFeed = require("./generate-price-page");

const ROOT = path.join(__dirname, "..");
const SITE_ORIGIN = "https://mixgsm.tr";
const PHONE_DIR = "urun";
const LAPTOP_DIR = "laptop";
const PAGE_MARKER = "<!-- mixgsm:urun-sayfasi -->";
const PHONE_PHOTO_BASE = "https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/";
const LAPTOP_PHOTO_BASE = "https://raw.githubusercontent.com/mixgsm/mixgsm/main/laptop-photos/images/";
const SLUG_OK = /^[a-z0-9-]{1,200}$/;
const STOCK_LABEL_TR = { IN: "Stokta", ASK: "Stok durumunu sorun", OUT: "Tükendi" };
const STOCK_SCHEMA = { IN: "https://schema.org/InStock", ASK: "https://schema.org/LimitedAvailability", OUT: "https://schema.org/OutOfStock" };
const GROUP_TITLE_TR = { PHONE: "Cep Telefonları", PERSONAL_CARE: "Kişisel Bakım" };

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const jsonLd = (obj) => JSON.stringify(obj).replace(/</g, "\\u003c");
const fmtNum = (n) => new Intl.NumberFormat("tr-TR").format(n);
const clean = (v) => String(v == null ? "" : v).replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------- site kodundan okunan kurallar
// Bolumler bos bir vm baglaminda calisir; yalnizca saf (DOM'a dokunmayan)
// fonksiyonlar alinir. Bolum bulunamazsa uretim DURUR (yanlis kuralla sayfa yazilmaz).
function sliceBetween(source, start, end) {
  const i = source.indexOf(start);
  const j = i < 0 ? -1 : source.indexOf(end, i);
  if (i < 0 || j <= i) throw new Error(`site kodunda bolum bulunamadi: ${start}`);
  return source.slice(i, j);
}

function loadSiteRules(siteRoot) {
  const source = readAppSource(siteRoot);
  const code = [
    'const fmt = n => n.toLocaleString("tr-TR");',
    sliceBetween(source, "function displaySpec(", "\n// ====="),
    sliceBetween(source, "const TAKSIT_COUNT", "// Kart altı tek satır"),
    sliceBetween(source, "function productWhatsappText(", "\n}\n") + "\n}",
    sliceBetween(source, "function laptopBaseSlug(", "function findLaptopBySlug("),
    sliceBetween(source, "function normalizeTR(", "\n// İşletme sahibinin seçim"),
    ";({ displaySpec, taksitInfo, TAKSIT_COUNT, TAKSIT_CARDS, productWhatsappText, laptopSlugOf })",
  ].join("\n");
  const api = vm.runInNewContext(code, {}, { filename: "js/app.js#urun-sayfasi-kurallari" });
  ["displaySpec", "taksitInfo", "productWhatsappText", "laptopSlugOf"].forEach((k) => {
    if (typeof api[k] !== "function") throw new Error(`site kodundan ${k} okunamadi`);
  });
  return api;
}

// index.html'deki sayac anahtari (bos/gecersizse urun sayfalarina sayac eklenmez).
function readCounterToken(siteRoot) {
  const html = fs.readFileSync(path.join(siteRoot, "index.html"), "utf8");
  const m = html.match(/<meta name="mixgsm-sayac" content="([a-f0-9]{32})">/i);
  return m ? m[1] : "";
}

// ---------------------------------------------------------------- veri -> sayfa modeli
function phoneDisplayName(p) {
  const b = priceFeed.normalizeText(p.b);
  const m = priceFeed.normalizeText(p.m);
  return clean(m === b || m.startsWith(b + " ") ? p.m : `${p.b} ${p.m}`);
}

function phonePages(catalog, rules, matcher, repoPhotos) {
  const exists = new Set(repoPhotos);
  const list = matcher.withPhotoVariantIndex(catalog.products);
  const pages = [];
  const seen = new Set();
  list.forEach((p) => {
    if (priceFeed.isNonProductRow(p)) return;
    const slug = priceFeed.legacyProductSlug(p);
    if (!SLUG_OK.test(slug) || seen.has(slug)) return;        // ayni adres iki kez yazilmaz
    seen.add(slug);
    const base = phoneDisplayName(p);
    const variant = rules.displaySpec("spec", p.s);
    const name = clean(variant ? `${base} ${variant}` : base);
    // Gorsel: sitenin eslestirme mantigi; depoda GERCEKTEN olan ilk dosya.
    const file = matcher.candidates(p, repoPhotos)
      .map((u) => (u.startsWith(PHONE_PHOTO_BASE) ? decodeURIComponent(u.slice(PHONE_PHOTO_BASE.length)) : ""))
      .find((f) => f && f !== "gorsel-yok.jpg" && exists.has(f));
    const price = typeof p.p === "number" && isFinite(p.p) && p.p > 0 ? p.p : null;
    const specs = [
      ["RAM / Depolama", variant],
      ["Ekran", rules.displaySpec("screen", p.screen)],
      ["İşlemci", clean(p.processor)],
      ["Kamera", rules.displaySpec("camera", p.camera)],
      ["Batarya", rules.displaySpec("battery", p.battery)],
      ["Bağlantı", rules.displaySpec("connectivity", p.connectivity)],
    ].filter((r) => r[1]);
    pages.push({
      kind: "phone", dir: PHONE_DIR, slug, name, base,
      brand: clean(p.b), group: p.group === "PERSONAL_CARE" ? "PERSONAL_CARE" : "PHONE",
      price, stock: STOCK_LABEL_TR[p.stock] ? p.stock : "ASK", sold: false,
      image: file ? `/photos/${encodeURIComponent(file)}` : "",
      imageKind: "white",
      specs, note: "", condition: "https://schema.org/NewCondition",
      catalogHref: `/#urun/${slug}`,
      waLabel: clean(`${p.b} ${p.m}` + (clean(p.s) ? ` - ${p.s}` : "")),
    });
  });
  return pages;
}

// Laptop sahne gorselleri (zemini temizlenmis buyuk surum). Sitenin okudugu
// laptop-photos/stage/manifest.json; guvenilmeyen girdi gibi dogrulanir.
function readLaptopStage(siteRoot) {
  const out = new Map();
  try {
    const d = JSON.parse(fs.readFileSync(path.join(siteRoot, "laptop-photos", "stage", "manifest.json"), "utf8"));
    const files = d && d.files && typeof d.files === "object" ? d.files : {};
    Object.keys(files).forEach((name) => {
      const e = files[name];
      if (!e || !/^[A-Za-z0-9._-]+$/.test(name) || !/^[A-Za-z0-9._-]+\.lg\.webp$/.test(e.lg || "")) return;
      if (!fs.existsSync(path.join(siteRoot, "laptop-photos", "stage", e.lg))) return;
      out.set(name, { lg: e.lg, kind: e.type === "opaque" ? (e.bg === "scene" ? "scene" : "white") : "cut" });
    });
  } catch (e) { /* manifest yoksa orijinal fotograf kullanilir */ }
  return out;
}

function laptopPages(laptopCatalog, rules, repoLaptopImages, stage) {
  const exists = new Set(repoLaptopImages);
  const pages = [];
  const seen = new Set();
  const unit = (v, u) => { const t = clean(v); return !t ? "" : new RegExp(u + "\\b", "i").test(t) ? t : `${t} ${u}`; };
  (laptopCatalog && Array.isArray(laptopCatalog.products) ? laptopCatalog.products : []).forEach((p) => {
    if (!p || !clean(p.brand) || !clean(p.model)) return;
    const slug = rules.laptopSlugOf(p);
    if (!SLUG_OK.test(slug) || seen.has(slug)) return;
    seen.add(slug);
    const cond = p.condition === "NEW" ? "Sıfır" : p.condition === "USED" ? "2. El" : "";
    const base = clean(`${p.brand} ${p.model}`);
    const name = clean(cond ? `${base} (${cond})` : base);
    const img = clean(p.img);
    const file = img.startsWith(LAPTOP_PHOTO_BASE) ? decodeURIComponent(img.slice(LAPTOP_PHOTO_BASE.length)) : "";
    const sold = p.stock === "OUT";
    const price = !sold && typeof p.price === "number" && isFinite(p.price) && p.price > 0 ? p.price : null;
    const ssd = clean(p.ssdGB);
    const specs = [
      ["Durum", cond],
      ["İşlemci", clean([p.cpu, p.cpuGen].map(clean).filter(Boolean).join(" "))],
      ["RAM", clean([unit(p.ramGB, "GB"), clean(p.ramType)].filter(Boolean).join(" "))],
      ["Depolama", !ssd ? "" : /ssd|nvme|hdd|emmc/i.test(ssd) ? unit(ssd.replace(/\s*(ssd|nvme|hdd|emmc).*$/i, ""), "GB") + " " + ssd.replace(/^.*?(ssd|nvme|hdd|emmc)/i, "$1") : unit(ssd, "GB") + " SSD"],
      ["Ekran kartı", clean([clean(p.gpu), unit(p.gpuVramGB, "GB"), unit(p.gpuTgpW, "W")].filter(Boolean).join(" · "))],
      ["Ekran", clean([clean(p.screen), unit(p.hz, "Hz")].filter(Boolean).join(" · "))],
      ["Klavye aydınlatma", clean(p.kbLight)],
      ["Kozmetik durum", clean(p.cosmetic)],
      ["Pil sağlığı", clean(p.batteryHealth)],
      ["Kutu", clean(p.box)],
      ["Adaptör", clean(p.adapter)],
      ["RAM yükseltme", clean(p.ramUpgrade)],
      ["M.2 yuvası", clean(p.m2Slot)],
      ["Kullanım amacı", clean(p.usage)],
    ].filter((r) => r[1]);
    pages.push({
      kind: "laptop", dir: LAPTOP_DIR, slug, name, base,
      brand: clean(p.brand), group: "LAPTOP",
      price, stock: sold ? "OUT" : STOCK_LABEL_TR[p.stock] ? p.stock : "ASK", sold,
      image: !file || !exists.has(file) ? ""
        : stage && stage.has(file) ? `/laptop-photos/stage/${encodeURIComponent(stage.get(file).lg)}`
        : `/laptop-photos/images/${encodeURIComponent(file)}`,
      imageKind: file && stage && stage.has(file) ? stage.get(file).kind : "white",
      specs, note: clean(p.description),
      condition: p.condition === "USED" ? "https://schema.org/UsedCondition" : "https://schema.org/NewCondition",
      catalogHref: `/#laptop/${slug}`,
      waLabel: clean(`${base}` + (p.id ? ` (${p.id})` : "")),
    });
  });
  return pages;
}

// ---------------------------------------------------------------- HTML
const STYLE = `
@font-face{font-family:"Inter";src:url("/fonts/inter-var-tr.woff2") format("woff2");font-weight:400 800;font-display:swap}
:root{--bg:#080808;--surface:#111;--surface-2:#171717;--text:#F5F5F5;--muted:#9a9a9a;--line:rgba(255,255,255,.1);--accent:#E63946;--wa:#25D366;--stage-hi:#E9EBEF;--stage-lo:#CDD2D9}
@media (prefers-color-scheme:light){:root{--bg:#FAFAFA;--surface:#F2F2F2;--surface-2:#fff;--text:#16181A;--muted:#5B5F66;--line:rgba(0,0,0,.12);--stage-hi:#F5F6F8;--stage-lo:#E3E6EB}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 Inter,-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
a{color:inherit}
.wrap{max-width:1040px;margin:0 auto;padding:0 20px 56px}
.top{display:flex;justify-content:space-between;align-items:center;gap:12px;padding:14px 0;border-bottom:1px solid var(--line)}
.brand-link{display:inline-flex;align-items:center;gap:10px;font-weight:700;letter-spacing:-.01em;text-decoration:none}
.brand-link img{width:28px;height:28px;border-radius:50%}
.btn{display:inline-flex;align-items:center;justify-content:center;min-height:48px;padding:0 18px;border-radius:12px;border:1px solid var(--line);text-decoration:none;font-size:15px;font-weight:600}
.btn.wa{background:var(--wa);color:#06210f;border-color:transparent}
.btn.sm{min-height:44px;font-size:14px;padding:0 14px}
.crumbs{margin:18px 0 0;padding:0;list-style:none;display:flex;flex-wrap:wrap;gap:6px;font-size:13px;color:var(--muted)}
.crumbs li+li::before{content:"/";margin-right:6px;opacity:.6}
.crumbs a{text-decoration:none}
.crumbs a:hover{color:var(--text)}
.product{display:grid;gap:24px;margin-top:18px}
.stage{border-radius:20px;background:radial-gradient(120% 95% at 50% 30%,var(--stage-hi) 0%,var(--stage-lo) 100%);display:flex;align-items:center;justify-content:center;padding:32px;min-height:280px}
.stage img{max-width:100%;max-height:360px;width:auto;height:auto;object-fit:contain}
.stage img[data-stage="white"]{mix-blend-mode:multiply}
.eyebrow{margin:0;font-size:13px;font-weight:600;letter-spacing:.04em;color:var(--muted)}
h1{margin:4px 0 0;font-size:clamp(26px,5.4vw,38px);line-height:1.12;letter-spacing:-.03em;font-weight:700}
.price{margin:18px 0 0;font-size:clamp(28px,6vw,36px);font-weight:700;letter-spacing:-.02em;line-height:1.1}
.price.ask{font-size:20px;color:var(--muted);font-weight:600}
.stockline{margin:8px 0 0;font-size:14px;font-weight:600;color:var(--muted)}
.stockline.in{color:#1a9c4a}
.stockline.out{color:var(--accent)}
.taksit{margin:16px 0 0;padding:12px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface)}
.taksit b{display:flex;flex-wrap:wrap;justify-content:space-between;gap:4px 12px;font-size:15px;font-weight:600}
.taksit p{margin:6px 0 0;font-size:13px;line-height:1.5;color:var(--muted)}
.actions{display:flex;flex-wrap:wrap;gap:10px;margin:20px 0 0}
.actions .btn{flex:1 1 220px}
h2{margin:36px 0 10px;font-size:20px;letter-spacing:-.01em}
table{border-collapse:collapse;width:100%;font-size:15px}
th,td{padding:11px 0;text-align:left;border-bottom:1px solid var(--line);vertical-align:top}
th{width:42%;font-weight:500;color:var(--muted);padding-right:12px}
td{font-weight:500}
.note{margin:14px 0 0;color:var(--muted);font-size:15px}
.info{margin:22px 0 0;padding:0;list-style:none;display:grid;gap:8px;font-size:14px;color:var(--muted)}
.info li{padding-left:16px;position:relative}
.info li::before{content:"";position:absolute;left:0;top:.62em;width:6px;height:6px;border-radius:50%;background:var(--muted);opacity:.6}
.more{margin:0;padding:0;list-style:none;display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.more a{display:flex;flex-direction:column;gap:2px;min-height:64px;justify-content:center;padding:10px 14px;border:1px solid var(--line);border-radius:12px;background:var(--surface-2);text-decoration:none;font-size:14px;font-weight:600;line-height:1.3}
.more a span{font-size:13px;font-weight:500;color:var(--muted)}
.more a:hover{border-color:var(--muted)}
a:focus-visible{outline:2px solid var(--text);outline-offset:2px;border-radius:8px}
footer{margin-top:48px;padding-top:18px;border-top:1px solid var(--line);color:var(--muted);font-size:14px}
footer p{margin:0 0 8px}
@media (min-width:860px){.wrap{padding:0 32px 72px}.product{grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:40px;align-items:start}.stage{min-height:420px;position:sticky;top:20px}}
`.trim();

function headCommon({ title, description, url, image, token, ld, noindex }) {
  const csp = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; font-src 'self'; base-uri 'none'; form-action 'none'"
    + (token ? "; script-src https://static.cloudflareinsights.com; connect-src https://cloudflareinsights.com" : "");
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
${PAGE_MARKER}
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="${csp}">
<title>${esc(title)}</title>
<meta name="description" content="${esc(description)}">
<link rel="canonical" href="${esc(url)}">
<meta name="robots" content="${noindex ? "noindex, follow" : "index, follow"}">
<meta property="og:type" content="website">
<meta property="og:locale" content="tr_TR">
<meta property="og:site_name" content="MİX GSM">
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:url" content="${esc(url)}">
${image ? `<meta property="og:image" content="${esc(SITE_ORIGIN + image)}">\n` : ""}<meta name="theme-color" content="#080808">
<link rel="icon" href="/mix-gsm-logo.jpg" type="image/jpeg">
${ld.map((o) => `<script type="application/ld+json">${jsonLd(o)}</script>`).join("\n")}
<style>
${STYLE}
</style>
</head>`;
}

function topBar(biz) {
  return `<div class="top">
<a class="brand-link" href="/"><img src="/mix-gsm-logo.jpg" alt="" width="28" height="28">MİX GSM</a>
<a class="btn wa sm" href="${esc(biz.phone.whatsapp_url)}" rel="noopener noreferrer" target="_blank">WhatsApp’tan Yaz</a>
</div>`;
}

function footer(biz, token) {
  return `<footer>
<p>${esc(biz.address)}<br><a href="tel:${esc(biz.phone.e164)}">${esc(biz.phone.display)}</a></p>
<p><a href="/">Ana sayfa (ürün kataloğu)</a> · <a href="/fiyat-listesi/">Güncel fiyat listesi</a> · <a href="/${PHONE_DIR}/">Tüm ürünler</a></p>
<p>Bu sayfa katalog verisinden otomatik oluşturulur. Sipariş öncesi stok ve fiyatı WhatsApp’tan teyit edin.</p>
</footer>
</div>
${token ? `<script defer src="https://static.cloudflareinsights.com/beacon.min.js" data-cf-beacon='{"token": "${token}"}'></script>\n` : ""}</body>
</html>
`;
}

function requireBusiness(b) {
  const phone = b && b.contact && b.contact.status === "confirmed" && (b.contact.phones || []).find((x) => x.role === "order_whatsapp");
  const loc = b && b.location && b.location.status === "confirmed" && b.location.display && b.location.display.full;
  if (!phone || !loc) throw new Error("feed/business.public.json: onayli adres ve telefon bulunamadi");
  return { phone, address: loc };
}

const pageUrl = (pg) => `${SITE_ORIGIN}/${pg.dir}/${pg.slug}/`;
const pagePath = (pg) => `/${pg.dir}/${pg.slug}/`;

function priceText(pg) {
  if (pg.sold) return "Satıldı";
  return pg.price === null ? "Fiyat için sorun" : `${fmtNum(pg.price)} TL`;
}

function renderProductPage(pg, all, biz, rules, token) {
  const url = pageUrl(pg);
  const taksit = !pg.sold && pg.stock !== "OUT" && pg.price !== null ? rules.taksitInfo(pg.price) : null;
  const groupTitle = pg.kind === "laptop" ? "Laptoplar" : GROUP_TITLE_TR[pg.group];
  const groupHref = pg.kind === "laptop" ? `/${PHONE_DIR}/#laptoplar` : `/${PHONE_DIR}/#${pg.group === "PERSONAL_CARE" ? "kisisel-bakim" : "telefonlar"}`;

  const specText = pg.specs.slice(0, 5).map((r) => `${r[0]}: ${r[1]}`).join(", ");
  const description = clean(
    pg.sold ? `${pg.name} MİX GSM’de satıldı. Benzer modeller için katalogdaki güncel laptoplara bakın.`
      : `${pg.name}${pg.price !== null ? ` güncel fiyatı ${fmtNum(pg.price)} TL` : " için güncel fiyatı WhatsApp’tan sorun"}. ${specText ? specText + ". " : ""}MİX GSM’den Türkiye geneline kargo${taksit ? `, kredi kartına ${rules.TAKSIT_COUNT} taksit` : ""}.`
  ).slice(0, 300);
  const title = pg.sold ? `${pg.name} (Satıldı) | MİX GSM`
    : `${pg.name} ${pg.price !== null ? "Fiyatı" : "Fiyat ve Stok"} | MİX GSM`;

  const product = {
    "@context": "https://schema.org",
    "@type": "Product",
    name: pg.name,
    sku: pg.slug,
    brand: { "@type": "Brand", name: pg.brand },
    url,
  };
  if (pg.image) product.image = SITE_ORIGIN + pg.image;
  if (specText || pg.note) product.description = clean([pg.note, specText].filter(Boolean).join(" ")).slice(0, 500);
  if (!pg.sold && pg.price !== null) {
    product.offers = {
      "@type": "Offer", url, price: pg.price, priceCurrency: "TRY",
      availability: STOCK_SCHEMA[pg.stock], itemCondition: pg.condition,
      seller: { "@type": "Organization", name: "MİX GSM", url: SITE_ORIGIN + "/" },
    };
  }
  const crumbs = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "MİX GSM", item: SITE_ORIGIN + "/" },
      { "@type": "ListItem", position: 2, name: groupTitle, item: SITE_ORIGIN + groupHref },
      { "@type": "ListItem", position: 3, name: pg.name, item: url },
    ],
  };

  const wa = `https://wa.me/${biz.phone.e164.replace("+", "")}?text=${encodeURIComponent(rules.productWhatsappText(pg.waLabel))}`;
  // Ayni markanin diger sayfalari (once ayni tur, katalog sirasi), en fazla 8.
  const others = all.filter((x) => x !== pg && x.kind === pg.kind && !x.sold && x.brand.toLocaleUpperCase("tr") === pg.brand.toLocaleUpperCase("tr")).slice(0, 8);

  const stockClass = pg.stock === "IN" ? "in" : pg.stock === "OUT" ? "out" : "";
  const stockLabel = pg.sold ? "Bu model satıldı" : STOCK_LABEL_TR[pg.stock];

  return `${headCommon({ title, description, url, image: pg.image, token, ld: [product, crumbs], noindex: pg.sold })}
<body>
<div class="wrap">
${topBar(biz)}
<main>
<ol class="crumbs">
<li><a href="/">Ana sayfa</a></li>
<li><a href="${esc(groupHref)}">${esc(groupTitle)}</a></li>
<li>${esc(pg.brand)}</li>
</ol>
<div class="product">
${pg.image ? `<div class="stage"><img src="${esc(pg.image)}" alt="${esc(pg.name)}" data-stage="${pg.imageKind}" width="480" height="480" decoding="async" fetchpriority="high"></div>` : ""}
<div>
<p class="eyebrow">${esc(pg.brand)}</p>
<h1>${esc(pg.name)}</h1>
<p class="price${pg.sold || pg.price === null ? " ask" : ""}">${esc(priceText(pg))}</p>
<p class="stockline ${stockClass}">${esc(stockLabel)}</p>
${taksit ? `<div class="taksit"><b><span>Kredi kartına ${rules.TAKSIT_COUNT} taksit</span><span>${rules.TAKSIT_COUNT} × ${fmtNum(taksit.monthly)} TL</span></b><p>Toplam yaklaşık ${fmtNum(taksit.total)} TL. Geçerli kartlar: ${esc(rules.TAKSIT_CARDS)}. Kesin tutarı WhatsApp’tan teyit ederiz.</p></div>` : ""}
<div class="actions">
<a class="btn wa" href="${esc(wa)}" rel="noopener noreferrer" target="_blank">${pg.sold ? "Benzerini WhatsApp’tan Sor" : "WhatsApp’tan Sor"}</a>
<a class="btn" href="${esc(pg.catalogHref)}">Katalogda Aç</a>
</div>
<ul class="info">
<li>Türkiye’nin 81 iline anlaşmalı kargo</li>
<li>Fiyat ve stok katalogla birlikte güncellenir; sipariş öncesi WhatsApp’tan teyit edin</li>
</ul>
</div>
</div>
${pg.specs.length ? `<h2>Özellikler</h2>
<table>
<tbody>
${pg.specs.map((r) => `<tr><th scope="row">${esc(r[0])}</th><td>${esc(r[1])}</td></tr>`).join("\n")}
</tbody>
</table>` : ""}
${pg.note ? `<p class="note">${esc(pg.note)}</p>` : ""}
${others.length ? `<h2>${esc(pg.brand)} — diğer modeller</h2>
<ul class="more">
${others.map((o) => `<li><a href="${esc(pagePath(o))}">${esc(o.name)}<span>${esc(priceText(o))}</span></a></li>`).join("\n")}
</ul>` : ""}
</main>
${footer(biz, token)}`;
}

function renderIndexPage(pages, biz, token) {
  const url = `${SITE_ORIGIN}/${PHONE_DIR}/`;
  const sections = [
    ["telefonlar", "Cep Telefonları", pages.filter((p) => p.kind === "phone" && p.group === "PHONE")],
    ["kisisel-bakim", "Kişisel Bakım", pages.filter((p) => p.kind === "phone" && p.group === "PERSONAL_CARE")],
    ["laptoplar", "Laptoplar", pages.filter((p) => p.kind === "laptop" && !p.sold)],
  ].filter((s) => s[2].length);
  const listed = sections.reduce((n, s) => n + s[2].length, 0);
  const description = `MİX GSM’deki tüm ürünlerin sayfaları: ${listed} ürün, güncel fiyat ve stok bilgisiyle. Türkiye geneline kargo.`;
  const itemList = {
    "@context": "https://schema.org", "@type": "ItemList", name: "MİX GSM Tüm Ürünler", numberOfItems: listed,
    itemListElement: sections.flatMap((s) => s[2]).map((p, i) => ({ "@type": "ListItem", position: i + 1, name: p.name, url: pageUrl(p) })),
  };
  let body = "";
  sections.forEach(([id, title, list]) => {
    body += `<h2 id="${id}">${esc(title)}</h2>\n<ul class="more">\n`
      + list.map((p) => `<li><a href="${esc(pagePath(p))}">${esc(p.name)}<span>${esc(priceText(p))}</span></a></li>`).join("\n")
      + "\n</ul>\n";
  });
  return `${headCommon({ title: "Tüm Ürünler: Telefon, Laptop ve Kişisel Bakım | MİX GSM", description, url, image: "", token, ld: [itemList] })}
<body>
<div class="wrap">
${topBar(biz)}
<main>
<h1>Tüm Ürünler</h1>
<p class="note">Her ürünün kendi sayfasında güncel fiyat, stok ve özellikler yer alır. Filtreleme ve karşılaştırma için <a href="/">kataloğu</a> kullanabilirsiniz.</p>
${body}</main>
${footer(biz, token)}`;
}

// ---------------------------------------------------------------- uretim
function buildAll(siteRoot) {
  const read = (rel) => JSON.parse(fs.readFileSync(path.join(siteRoot, rel), "utf8"));
  const catalog = read("catalog.json");
  if (!catalog || !Array.isArray(catalog.products) || !catalog.products.length) throw new Error("catalog.json bos/gecersiz - urun sayfalari GUNCELLENMEDI.");
  let laptopCatalog = null;
  try { laptopCatalog = read("catalog-laptop.json"); } catch (e) { laptopCatalog = null; }   // laptop verisi yoksa yalniz telefon
  const biz = requireBusiness(read(path.join("feed", "business.public.json")));
  const rules = loadSiteRules(siteRoot);
  const matcher = loadSiteImageMatcher(siteRoot);
  const listDir = (rel) => (fs.existsSync(path.join(siteRoot, rel)) ? fs.readdirSync(path.join(siteRoot, rel)) : []);
  const token = readCounterToken(siteRoot);

  const pages = phonePages(catalog, rules, matcher, listDir("photos"))
    .concat(laptopPages(laptopCatalog, rules, listDir(path.join("laptop-photos", "images")), readLaptopStage(siteRoot)));
  if (!pages.some((p) => p.kind === "phone")) throw new Error("Telefon urunu bulunamadi - urun sayfalari GUNCELLENMEDI.");

  const files = new Map();                                    // goreli yol -> icerik
  pages.forEach((pg) => files.set(`${pg.dir}/${pg.slug}/index.html`, renderProductPage(pg, pages, biz, rules, token)));
  files.set(`${PHONE_DIR}/index.html`, renderIndexPage(pages, biz, token));
  return { pages, files };
}

// Diskte bu scriptin urettigi (isaret tasiyan) sayfalar.
function existingGenerated(siteRoot) {
  const out = [];
  [PHONE_DIR, LAPTOP_DIR].forEach((dir) => {
    const abs = path.join(siteRoot, dir);
    if (!fs.existsSync(abs)) return;
    const top = path.join(abs, "index.html");
    if (fs.existsSync(top) && fs.readFileSync(top, "utf8").includes(PAGE_MARKER)) out.push(`${dir}/index.html`);
    fs.readdirSync(abs, { withFileTypes: true }).filter((e) => e.isDirectory()).forEach((e) => {
      const f = path.join(abs, e.name, "index.html");
      if (fs.existsSync(f) && fs.readFileSync(f, "utf8").includes(PAGE_MARKER)) out.push(`${dir}/${e.name}/index.html`);
    });
  });
  return out;
}

function sync(siteRoot, files, write) {
  let written = 0, removed = 0;
  files.forEach((content, rel) => {
    const abs = path.join(siteRoot, rel);
    const current = fs.existsSync(abs) ? fs.readFileSync(abs, "utf8").replace(/\r\n/g, "\n") : null;
    if (current === content) return;
    written++;
    if (!write) return;
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, content, "utf8");
  });
  existingGenerated(siteRoot).filter((rel) => !files.has(rel)).forEach((rel) => {
    removed++;
    if (!write) return;
    const abs = path.join(siteRoot, rel);
    fs.unlinkSync(abs);
    const dir = path.dirname(abs);
    if (path.basename(dir) !== PHONE_DIR && path.basename(dir) !== LAPTOP_DIR && !fs.readdirSync(dir).length) fs.rmdirSync(dir);
  });
  return { written, removed };
}

// Site haritasi icin adresler (generate-sitemap.js kullanir).
function listPageUrls(siteRoot) {
  const { pages } = buildAll(siteRoot);
  return [`${SITE_ORIGIN}/${PHONE_DIR}/`].concat(pages.filter((p) => !p.sold).map(pageUrl));
}

function main() {
  const check = process.argv.includes("--check");
  const { pages, files } = buildAll(ROOT);                    // hata olursa hicbir dosya yazilmaz
  const { written, removed } = sync(ROOT, files, !check);
  if (check) {
    if (written || removed) { console.log(`::error::urun sayfalari guncel degil: ${written} degisecek, ${removed} silinecek (node scripts/generate-product-pages.js)`); process.exitCode = 1; }
    else console.log(`Urun sayfalari guncel (${pages.length} urun).`);
    return;
  }
  console.log(`Urun sayfalari: ${pages.length} urun; ${written} dosya yazildi, ${removed} dosya silindi.`);
}

if (require.main === module) {
  try { main(); } catch (err) { console.error("HATA:", err.message); process.exit(1); }
}

module.exports = { buildAll, sync, existingGenerated, listPageUrls, loadSiteRules, phonePages, laptopPages, renderProductPage, PAGE_MARKER, PHONE_DIR, LAPTOP_DIR };
