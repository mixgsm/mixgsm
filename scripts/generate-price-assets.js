// MIX GSM - catalog.json + feed/business.public.json -> mobil paylasima
// hazir fiyat listesi JPG'leri (1080x1920, sayfalanmis) ve tiklanabilir
// linkli PDF.
//
// Bu script (generate-catalog.js / generate-price-page.js gibi) sunucu
// tarafinda / yerelde calisir; disaridan tek bagimliligi Playwright'tir
// (Chromium'u yerel olarak baslatip statik HTML'i JPG/PDF'e "yazdirir").
// Aga BAGLANMAZ - sadece repodaki catalog.json + feed/business.public.json
// dosyalarini okur, disariya istek atmaz.
//
//   node scripts/generate-price-assets.js
//
// Girdi : catalog.json                 (scripts/generate-catalog.js uretir)
//         feed/business.public.json    (isletme bilgisi; elle duzenlenmez)
//         mix-gsm-logo.jpg             (marka logosu)
// Cikti : price-assets/fiyat-listesi-01.jpg, -02.jpg, ...  (1080x1920, otomatik sayfa sayisi)
//         price-assets/fiyat-listesi.pdf                   (secilebilir metin + tiklanabilir linkler)
//
// ONEMLI: gruplama / marka adlandirma / stok etiketleri / fiyat bicimi
// kurallari scripts/generate-price-page.js ile BIREBIR AYNI olmalidir.
// Biri degisirse digeri de guncellenmelidir (ayni "ayna" kurali, dosya
// basinda tekrarlanan yorum bunun icin var).
//
// TASARIM MANTIGI (ozet):
//   1) catalog.json -> ortak, sirali "akis birimleri" listesine cevrilir
//      (grup basligi / marka basligi / model bloklari - PDF ve JPG'nin
//      TEK ortak kaynagi budur, bkz. buildFlowUnits()).
//   2) JPG'ler icin: bu birimler once GORUNMEZ bir sayfada gercekten
//      render edilip GERCEK piksel yukseklikleri olculur (measureUnits()),
//      sonra bu gercek yukseklige gore 1080x1920'lik sayfalara "bin
//      packing" ile dagitilir (paginate()) - sabit "sayfa basina X urun"
//      varsayimi YOKTUR, font kucultme YOKTUR.
//   3) PDF icin: ayni birimler tek bir akan HTML'de CSS sayfa-kirilim
//      kurallarina (break-inside/avoid, thead tekrari degil ama blok
//      butunlugu) birakilir; site adresi ve WhatsApp linki gercek 
//      href> olarak yazilir (Chromium PDF baskisi bunlari tiklanabilir
//      link olarak gomer), metin rasterize edilmez (secilebilir kalir).
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const CATALOG_PATH = path.join(ROOT, "catalog.json");
const BUSINESS_PATH = path.join(ROOT, "feed", "business.public.json");
const LOGO_PATH = path.join(ROOT, "mix-gsm-logo.jpg");
const OUT_DIR = path.join(ROOT, "price-assets");
const OUT_PDF = path.join(OUT_DIR, "fiyat-listesi.pdf");
const JPG_PREFIX = "fiyat-listesi-";
const SITE_URL = "https://mixgsm.tr/fiyat-listesi";

// Mobil JPG sayfa boyutu (9:16) - sabit, degistirilmemeli (point 1).
const PAGE_W = 1080;
const PAGE_H = 1920;

// ---------------------------------------------------------------- kurallar (generate-price-page.js ile ayni)
function normalizeTR(v) {
  return (v || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\u0131/g, "i").replace(/\u0130/g, "i").replace(/\u015f/g, "s").replace(/\u015e/g, "s")
    .replace(/\u011f/g, "g").replace(/\u011e/g, "g").replace(/\u00fc/g, "u").replace(/\u00dc/g, "u")
    .replace(/\u00f6/g, "o").replace(/\u00d6/g, "o").replace(/\u00e7/g, "c").replace(/\u00c7/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}
function normalizeText(v) {
  const pre = String(v || "").replace(/\+/g, " plus ");
  return normalizeTR(pre).replace(/(\d)\s+g\b/g, "$1g");
}
const slugify = (v) => normalizeText(v).replace(/\s+/g, "-");

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

// Sadece "GB/GB" veya "GB" kaliplarini normalize eder; her seyi oldugu
// gibi de kabul eder (bos / "-" ise bos dondurur). Veri ASLA degistirilmez,
// yalnizca gosterim icin trim edilir (point 23).
function parseVariant(s) {
  const raw = String(s || "").trim();
  if (!raw || raw === "-" || raw === "\u2014") return "";
  return raw;
}

const STOCK_LABEL_TR = { IN: "Stokta", OUT: "T\u00fckendi", ASK: "Sorunuz", UNKNOWN: "Bilinmiyor" };
const STOCK_ORDER = ["IN", "OUT", "ASK", "UNKNOWN"];
const GROUP_TITLE_TR = { PHONE: "Cep Telefonlar\u0131", PERSONAL_CARE: "Ki\u015fisel Bak\u0131m" };
const BRAND_TITLE_TR = {
  XIAOMI: "Xiaomi \u2022 Redmi \u2022 POCO", APPLE: "Apple iPhone", SAMSUNG: "Samsung", INFINIX: "Infinix",
  TECNO: "Tecno", ONEPLUS: "OnePlus", GOOGLE: "Google Pixel", REDMAGIC: "RedMagic",
  PHILIPS: "Philips", BRAUN: "Braun", DYSON: "Dyson",
};

function groupOf(p) {
  return p.group === "PERSONAL_CARE" ? "PERSONAL_CARE" : "PHONE";
}

// Model adi zaten markayla basliyorsa markayi tekrar etmez (DYSON AIRSTART, REDMAGIC 11S PRO).
function displayModelName(brandName, model) {
  const b = normalizeText(brandName);
  const m = normalizeText(model);
  const base = m === b || m.startsWith(b + " ") ? model : `${brandName} ${model}`;
  return base.trim();
}

const esc = (s) => String(s == null ? "" : s)
  .replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
const fmtPrice = (n) => `${new Intl.NumberFormat("tr-TR").format(n)} TL`;
const fmtWhen = (iso) => new Date(iso).toLocaleString("tr-TR", { timeZone: "Europe/Istanbul", dateStyle: "long", timeStyle: "short" });

function requireBusiness(b) {
  const phone = b && b.contact && b.contact.status === "confirmed" && (b.contact.phones || []).find((x) => x.role === "order_whatsapp");
  const loc = b && b.location && b.location.status === "confirmed" && b.location.display && b.location.display.full;
  if (!phone || !loc) throw new Error("feed/business.public.json: onayli adres ve telefon bulunamadi");
  return {
    phone,
    address: loc,
    instagram: b.channels && b.channels.instagram,
    notice: b.policies && b.policies.price_notice && b.policies.price_notice.text_tr,
  };
}

// ---------------------------------------------------------------- 1) ORTAK VERI MODELI (PDF + JPG icin TEK kaynak)
// Sirali "akis birimleri" uretir: grup basligi -> marka basligi -> model
// bloklari (ayni model + farkli RAM/depolama varyasyonlari TEK blokta
// gruplanir; fiyat/stok karistirilmadan her varyasyon kendi satirinda
// kalir - point 6/23).
function buildFlowUnits(catalog) {
  const products = catalog.products.filter((p) => !isNonProductRow(p) && (p.b || p.m));

  const groupOrder = [];
  const groupMap = new Map();
  for (const p of products) {
    const g = groupOf(p);
    if (!groupMap.has(g)) { groupMap.set(g, new Map()); groupOrder.push(g); }
    const brands = groupMap.get(g);
    const bKey = brandKey(p.b);
    if (!brands.has(bKey)) brands.set(bKey, { name: canonicalBrand(p.b), models: new Map(), modelOrder: [] });
    const brand = brands.get(bKey);
    // Ayni model, farkli yazim/bosluk varyasyonlariyla ayri bloklara
    // BOLUNMESIN diye normalize edilmis anahtar kullanilir (point 6).
    const mKey = slugify(p.m || "");
    if (!brand.models.has(mKey)) {
      brand.models.set(mKey, { modelRaw: String(p.m || "").trim(), rows: [] });
      brand.modelOrder.push(mKey);
    }
    const stockRaw = ["IN", "OUT", "ASK"].includes(p.stock) ? p.stock : "UNKNOWN";
    brand.models.get(mKey).rows.push({
      variant: parseVariant(p.s),
      priceRaw: Number.isInteger(p.p) ? p.p : null,
      stock: stockRaw,
    });
  }

  // Her grup icin RAM/Depolama (veya ozellik) kolonu gosterilsin mi?
  // Veriye gore dinamik karar - marka adina gore hard-code YOK (point 4).
  const groupHasVariant = new Map();
  for (const [g, brands] of groupMap) {
    let has = false;
    outer: for (const [, brand] of brands) {
      for (const mKey of brand.modelOrder) {
        if (brand.models.get(mKey).rows.some((r) => r.variant)) { has = true; break outer; }
      }
    }
    groupHasVariant.set(g, has);
  }

  const units = [];
  for (const g of groupOrder) {
    units.push({ type: "groupHeader", group: g, label: GROUP_TITLE_TR[g] || g });
    const brands = groupMap.get(g);
    for (const [bKey, brand] of brands) {
      units.push({
        type: "brandHeader", group: g, brandKey: bKey, brandName: brand.name,
        title: BRAND_TITLE_TR[brand.name] || brand.name,
      });
      for (const mKey of brand.modelOrder) {
        const m = brand.models.get(mKey);
        units.push({
          type: "modelBlock", group: g, brandKey: bKey, brandName: brand.name,
          model: m.modelRaw, showVariant: groupHasVariant.get(g), rows: m.rows,
        });
      }
    }
  }
  return units;
}

// ---------------------------------------------------------------- 2) PAYLASILAN GORSEL DIL (CSS) - PDF ve JPG AYNI dili kullanir
const THEME_CSS = `
  :root{
    --bg:#080808;--surface:#111111;--surface-2:#171717;--text:#F5F5F5;--muted:#8A8A8A;
    --accent:#E63946;--whatsapp:#25D366;--amber:#F59E0B;--line:rgba(255,255,255,0.10);
  }
  *{box-sizing:border-box}
  html,body{margin:0;padding:0;background:var(--bg);color:var(--text);
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,Roboto,sans-serif;}
  a{color:inherit}
  .u-groupheader{margin:22px 0 8px;padding-bottom:6px;border-bottom:1px solid var(--line);}
  .u-groupheader h2{font-size:13px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);
    font-weight:700;margin:0;}
  .u-brandheader{margin:14px 0 8px;}
  .u-brandheader h3{font-size:17px;font-weight:700;margin:0;color:var(--text);}
  .u-brandheader .cont{font-size:13px;font-weight:500;color:var(--muted);}
  .model-block{background:var(--surface);border-radius:14px;padding:12px 14px;margin-bottom:10px;}
  .model-block .model-name{font-size:14.5px;font-weight:700;margin:0 0 6px;color:var(--text);}
  .variant-row{display:flex;align-items:center;gap:10px;padding:6px 0;}
  .variant-row + .variant-row{border-top:1px solid var(--line);}
  .variant-row .variant{flex:1 1 auto;font-size:13px;color:var(--muted);min-width:0;}
  .variant-row .price{font-size:16px;font-weight:800;color:var(--text);white-space:nowrap;
    letter-spacing:-.2px;}
  .variant-row.no-variant .price{flex:1 1 auto;}
  .stock-badge{display:inline-flex;align-items:center;gap:5px;font-size:11.5px;font-weight:600;
    padding:4px 9px 4px 7px;border-radius:99px;white-space:nowrap;flex-shrink:0;}
  .stock-badge .dot{width:7px;height:7px;border-radius:50%;flex-shrink:0;}
  .stock-badge.st-in{background:rgba(37,211,102,0.14);color:var(--whatsapp);}
  .stock-badge.st-in .dot{background:var(--whatsapp);}
  .stock-badge.st-out{background:rgba(230,57,70,0.14);color:var(--accent);}
  .stock-badge.st-out .dot{background:var(--accent);}
  .stock-badge.st-ask{background:rgba(245,158,11,0.16);color:var(--amber);}
  .stock-badge.st-ask .dot{background:var(--amber);}
  .stock-badge.st-unknown{background:rgba(255,255,255,0.08);color:var(--muted);}
  .stock-badge.st-unknown .dot{background:var(--muted);}
`;

function renderStockBadge(stock) {
  const cls = { IN: "st-in", OUT: "st-out", ASK: "st-ask", UNKNOWN: "st-unknown" }[stock] || "st-unknown";
  return `<span class="stock-badge ${cls}"><i class="dot"></i>${esc(STOCK_LABEL_TR[stock] || STOCK_LABEL_TR.UNKNOWN)}</span>`;
}

// unit -> HTML. PDF akisinda ve JPG olcum/render asamalarinda AYNI
// fonksiyon kullanilir (point 10: tek veri + tek gorunum kaynagi).
function renderUnitHtml(unit, opts) {
  opts = opts || {};
  if (unit.type === "groupHeader") {
    return `<div class="u-groupheader" data-unit="groupHeader"><h2>${esc(unit.label)}</h2></div>`;
  }
  if (unit.type === "brandHeader") {
    const cont = opts.continuation ? ` <span class="cont">\u2014 Devam</span>` : "";
    return `<div class="u-brandheader" data-unit="brandHeader"><h3>${esc(unit.title)}${cont}</h3></div>`;
  }
  if (unit.type === "modelBlock") {
    const name = displayModelName(unit.brandName, unit.model);
    let rowsHtml = "";
    for (const r of unit.rows) {
      const priceLabel = r.priceRaw === null ? "Sorunuz" : fmtPrice(r.priceRaw);
      const showVariant = unit.showVariant && r.variant;
      rowsHtml += `<div class="variant-row${showVariant ? "" : " no-variant"}">` +
        (showVariant ? `<span class="variant">${esc(r.variant)}</span>` : "") +
        `<span class="price">${esc(priceLabel)}</span>${renderStockBadge(r.stock)}</div>\n`;
    }
    return `<div class="model-block" data-unit="modelBlock"><p class="model-name">${esc(name)}</p>${rowsHtml}</div>`;
  }
  return "";
}

// ---------------------------------------------------------------- 3) PDF (akan, sayfalanmis, tiklanabilir link)
function buildPdfHtml(units, catalog, business, logoDataUri) {
  const biz = requireBusiness(business);
  const when = fmtWhen(catalog.generatedAt);
  const body = units.map((u) => renderUnitHtml(u)).join("\n");
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<title>M\u0130X GSM G\u00fcncel Fiyat Listesi</title>
<style>
${THEME_CSS}
  .wrap{max-width:900px;margin:0 auto;padding:26px 26px 8px;}
  .top{display:flex;align-items:center;gap:14px;padding-bottom:18px;border-bottom:1px solid var(--line);margin-bottom:4px;}
  .top img{width:52px;height:52px;border-radius:13px;object-fit:cover;flex-shrink:0;}
  .top .brand-name{font-size:19px;font-weight:700;letter-spacing:-.2px;margin:0;}
  .top .brand-sub{font-size:12.5px;color:var(--muted);margin:2px 0 0;}
  h1{font-size:24px;line-height:1.25;margin:20px 0 4px;letter-spacing:-.3px;}
  .lead{color:var(--muted);font-size:13px;margin:0 0 16px;}
  .notice{margin:0 0 4px;padding:11px 13px;border:1px solid var(--line);border-radius:12px;
    background:var(--surface);font-size:12px;color:var(--muted);line-height:1.5;}
  .u-groupheader{break-after:avoid;page-break-after:avoid;}
  .u-brandheader{break-after:avoid;page-break-after:avoid;}
  .u-brandheader h3{break-after:avoid;page-break-after:avoid;}
  .model-block{break-inside:avoid;page-break-inside:avoid;}
  .foot{margin:26px 0 10px;padding-top:16px;border-top:1px solid var(--line);font-size:11.5px;
    color:var(--muted);line-height:1.7;}
  .foot a{font-weight:600;text-decoration:none;}
  .foot .wa{color:var(--whatsapp);}
  .foot .site{color:var(--text);}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <img src="${logoDataUri}" alt="M\u0130X GSM logosu">
    <div>
      <p class="brand-name">M\u0130X GSM</p>
      <p class="brand-sub">Gaziantep \u2022 Telefon ve Teknoloji Ma\u011fazas\u0131</p>
    </div>
  </div>
  <h1>G\u00fcncel Fiyat ve Stok Listesi</h1>
  <p class="lead">Son g\u00fcncelleme: ${esc(when)}</p>
  <div class="notice">${esc(biz.notice || "Fiyatlar stok durumuna g\u00f6re de\u011fi\u015febilir.")}</div>
  ${body}
  <div class="foot">
    ${esc(biz.address)}<br>
    WhatsApp: <a class="wa" href="${esc(biz.phone.whatsapp_url)}">${esc(biz.phone.display)}</a><br>
    G\u00fcncel liste her zaman: <a class="site" href="${esc(SITE_URL)}">mixgsm.tr/fiyat-listesi</a>
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------- 4) JPG - olcum + sayfalama + render
// Sabit sayfa kromu (ust basari/tarih/sayfa no + alt bilgi satiri) -
// gercek yukseklikleri de olcum gecisinde belirlenir (sabit "tahmin"
// kullanilmaz, point 20).
function buildChromeHtml(headerInner, footerInner) {
  return {
    header: `<div class="jpg-header" data-unit="chrome"><div class="jpg-header-top"><img src="${headerInner.logoDataUri}" alt=""><div><p class="jh-brand">M\u0130X GSM</p><p class="jh-sub">G\u00fcncel Fiyat ve Stok Listesi</p></div><div class="jh-page">${esc(headerInner.pageLabel)}</div></div><p class="jh-date">${esc(headerInner.when)}</p></div>`,
    footer: `<div class="jpg-footer" data-unit="chrome"><p>${esc(footerInner.address)}</p><p>WhatsApp: ${esc(footerInner.phone)} \u00b7 mixgsm.tr/fiyat-listesi</p></div>`,
  };
}

const JPG_CHROME_CSS = `
  .jpg-page{width:${PAGE_W}px;height:${PAGE_H}px;background:var(--bg);display:flex;flex-direction:column;
    padding:0 44px;overflow:hidden;}
  .jpg-header{flex:0 0 auto;padding:28px 0 14px;border-bottom:1px solid var(--line);}
  .jpg-header-top{display:flex;align-items:center;gap:12px;}
  .jpg-header-top img{width:44px;height:44px;border-radius:11px;object-fit:cover;flex-shrink:0;}
  .jh-brand{font-size:17px;font-weight:700;margin:0;letter-spacing:-.2px;}
  .jh-sub{font-size:12px;color:var(--muted);margin:2px 0 0;}
  .jh-page{margin-left:auto;font-size:13px;font-weight:700;color:var(--muted);flex-shrink:0;}
  .jh-date{font-size:12px;color:var(--muted);margin:10px 0 0;}
  .jpg-content{flex:1 1 auto;overflow:hidden;padding-top:4px;}
  .jpg-footer{flex:0 0 auto;padding:10px 0 24px;border-top:1px solid var(--line);
    font-size:11px;color:var(--muted);line-height:1.6;}
  .jpg-footer p{margin:0;}
`;

async function measureUnits(page, units, chrome) {
  const html = `<!doctype html><html><head><style>${THEME_CSS}${JPG_CHROME_CSS}
    body{background:var(--bg)}
    .measure-page{width:${PAGE_W}px;padding:0 44px;}
  </style></head><body>
    <div class="measure-page">
      ${chrome.header}
      ${units.map((u, i) => `<div data-idx="${i}">${renderUnitHtml(u)}</div>`).join("\n")}
      ${chrome.footer}
    </div>
  </body></html>`;
  await page.setContent(html, { waitUntil: "networkidle" });
  return page.evaluate(() => {
    const wrap = document.querySelector(".measure-page");
    const headerEl = wrap.querySelector(".jpg-header");
    const footerEl = wrap.querySelector(".jpg-footer");
    const items = Array.from(wrap.querySelectorAll("[data-idx]")).map((el) => Math.ceil(el.getBoundingClientRect().height));
    return {
      headerH: Math.ceil(headerEl.getBoundingClientRect().height),
      footerH: Math.ceil(footerEl.getBoundingClientRect().height),
      items,
    };
  });
}

// Gercek olculmus yuksekliklere gore 1080x1920'lik sayfalara dagitir.
// - Baslik hemen ardindan icerik gelmeden sayfa sonunda "yalniz" kalmaz
//   (1 birimlik lookahead).
// - Birden fazla blogu olan bir marka, kalan alana sigmayacaksa (ve
//   markanin cogu bu sayfaya sigmiyorsa) yeni sayfaya ertelenir; boylece
//   bir sayfanin sonunda baska markadan 1-2 urun "yalniz" kalmaz.
function paginate(units, heights, contentH, VGAP) {
  const pages = [];
  let cur = [];
  let curH = 0;

  function remaining() { return contentH - curH; }
  function pushBreak() { if (cur.length) { pages.push(cur); cur = []; curH = 0; } }

  for (let i = 0; i < units.length; i++) {
    const u = units[i];
    const h = heights[i] + (cur.length ? VGAP : 0);

    if (u.type === "brandHeader") {
      // Bu markanin toplam blok sayisi ve bu sayfada kalan alana kac
      // tanesinin sigacagini kabaca hesapla; sigmayacaksa yeni sayfa.
      let j = i + 1, blockCount = 0, wouldFit = 0, acc = curH + h;
      while (j < units.length && units[j].type === "modelBlock") {
        blockCount++;
        const bh = heights[j] + VGAP;
        if (acc + bh <= contentH) { wouldFit++; acc += bh; }
        j++;
      }
      const brandFitsBadly = blockCount >= 2 && wouldFit < Math.min(blockCount, Math.ceil(blockCount * 0.4));
      const nearPageEnd = remaining() < contentH * 0.35;
      if (curH + h > contentH || (brandFitsBadly && nearPageEnd)) {
        pushBreak();
      }
      cur.push(i); curH += heights[i] + (cur.length > 1 ? VGAP : 0);
      continue;
    }

    if (u.type === "groupHeader") {
      // 1 birim lookahead: hemen ardindan gelen (marka basligi + varsa
      // ilk model blogu) ile birlikte sigmiyorsa yeni sayfaya gecir.
      let lookaheadH = h;
      if (units[i + 1] && units[i + 1].type === "brandHeader") lookaheadH += heights[i + 1] + VGAP;
      if (curH + lookaheadH > contentH && cur.length) pushBreak();
      cur.push(i); curH += heights[i] + (cur.length > 1 ? VGAP : 0);
      continue;
    }

    // modelBlock
    if (curH + h > contentH) {
      if (!cur.length) {
        // Tek basina sayfaya sigmiyor (cok fazla varyasyonu var) - yine
        // de bu sayfaya koy, zorla kucultme yapma (point 2).
        cur.push(i); curH += heights[i];
      } else {
        pushBreak();
        cur.push(i); curH += heights[i];
      }
      continue;
    }
    cur.push(i); curH += h;
  }
  pushBreak();
  return pages;
}

async function renderJpgPages(browser, units, catalog, business, logoDataUri, outDir) {
  const page = await browser.newPage({ viewport: { width: PAGE_W, height: PAGE_H } });
  const when = fmtWhen(catalog.generatedAt);
  const biz = requireBusiness(business);

  const measureChrome = buildChromeHtml(
    { logoDataUri, pageLabel: "9 / 9", when },
    { address: biz.address, phone: biz.phone.display }
  );
  const { headerH, footerH, items: heights } = await measureUnits(page, units, measureChrome);

  const VGAP = 10;
  const CONTENT_PAD_TOP = 4;
  const contentH = PAGE_H - headerH - footerH - CONTENT_PAD_TOP - 8;

  const pages = paginate(units, heights, contentH, VGAP);
  const total = pages.length;

  if (process.env.PAGINATE_DEBUG) {
    console.error(`contentH=${contentH} headerH=${headerH} footerH=${footerH}`);
    pages.forEach((idxs, p) => {
      let h = 0;
      idxs.forEach((i, k) => { h += heights[i] + (k ? VGAP : 0); });
      console.error(`page ${p + 1}: ${idxs.length} units, used=${h}/${contentH} (${(100 * h / contentH).toFixed(0)}%)`);
    });
  }

  const outFiles = [];
  for (let p = 0; p < total; p++) {
    const idxs = pages[p];
    const firstUnit = units[idxs[0]];
    const continuation = firstUnit.type === "modelBlock";
    let bodyHtml = "";
    if (continuation) {
      bodyHtml += renderUnitHtml(
        { type: "brandHeader", brandName: firstUnit.brandName, title: BRAND_TITLE_TR[firstUnit.brandName] || firstUnit.brandName },
        { continuation: true }
      );
    }
    bodyHtml += idxs.map((i) => renderUnitHtml(units[i])).join("\n");

    const chrome = buildChromeHtml(
      { logoDataUri, pageLabel: `${p + 1} / ${total}`, when },
      { address: biz.address, phone: biz.phone.display }
    );

    const html = `<!doctype html><html><head><style>${THEME_CSS}${JPG_CHROME_CSS}</style></head><body>
      <div class="jpg-page">
        ${chrome.header}
        <div class="jpg-content">${bodyHtml}</div>
        ${chrome.footer}
      </div>
    </body></html>`;

    await page.setContent(html, { waitUntil: "networkidle" });
    const fileName = `${JPG_PREFIX}${String(p + 1).padStart(2, "0")}.jpg`;
    const outPath = path.join(outDir, fileName);
    await page.screenshot({ path: outPath, type: "jpeg", quality: 88 });
    outFiles.push(fileName);
  }

  await page.close();
  return outFiles;
}

// ---------------------------------------------------------------- 5) PAYLASIM SAYFASI (tek link: JPG'ler + PDF)
// Musterinin WhatsApp/Instagram'da paylasilan TEK bir linke tiklayip
// tum JPG sayfalarini ve PDF'i gorebilecegi kucuk, statik bir sayfa.
// price-assets/index.html olarak yazilir; GitHub Pages klasor icin bu
// dosyayi otomatik sunar, yani link https://mixgsm.tr/price-assets/
// olur. Sayfa sayisi (jpgFiles) HER CALISTIRMADA gercek uretilen
// dosyalara gore degisir - burada sabit sayi varsayimi YOKTUR.
function buildGalleryHtml(jpgFiles, catalog, business) {
  const biz = requireBusiness(business);
  const when = fmtWhen(catalog.generatedAt);
  const thumbs = jpgFiles.map((f, i) => `
    <a class="thumb" href="${esc(f)}" target="_blank" rel="noopener">
      <img src="${esc(f)}" alt="Fiyat listesi sayfa ${i + 1}" loading="lazy">
      <span>Sayfa ${i + 1} / ${jpgFiles.length}</span>
    </a>`).join("\n");
  return `<!doctype html>
<html lang="tr">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>M\u0130X GSM - G\u00fcncel Fiyat Listesi</title>
<style>
${THEME_CSS}
  body{padding:0 16px 40px;}
  .wrap{max-width:640px;margin:0 auto;}
  .top{display:flex;align-items:center;gap:12px;padding:22px 0 16px;}
  .top img{width:48px;height:48px;border-radius:12px;object-fit:cover;flex-shrink:0;}
  .top .brand-name{font-size:18px;font-weight:700;margin:0;}
  .top .brand-sub{font-size:12.5px;color:var(--muted);margin:2px 0 0;}
  h1{font-size:20px;margin:6px 0 2px;}
  .lead{color:var(--muted);font-size:13px;margin:0 0 18px;}
  .pdf-btn{display:flex;align-items:center;justify-content:center;gap:8px;background:var(--accent);
    color:#fff;font-weight:700;font-size:15px;text-decoration:none;border-radius:14px;padding:15px 18px;margin-bottom:22px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(130px,1fr));gap:12px;margin-bottom:24px;}
  .thumb{display:block;text-decoration:none;color:var(--text);background:var(--surface);border-radius:12px;
    overflow:hidden;border:1px solid var(--line);}
  .thumb img{width:100%;display:block;aspect-ratio:9/16;object-fit:cover;background:var(--surface-2);}
  .thumb span{display:block;text-align:center;font-size:12px;padding:7px 0;color:var(--muted);}
  .foot{padding-top:16px;border-top:1px solid var(--line);font-size:11.5px;color:var(--muted);line-height:1.7;}
  .foot a{font-weight:600;text-decoration:none;}
  .foot .wa{color:var(--whatsapp);}
  .foot .site{color:var(--text);}
</style>
</head>
<body>
<div class="wrap">
  <div class="top">
    <img src="/mix-gsm-logo.jpg" alt="M\u0130X GSM logosu">
    <div>
      <p class="brand-name">M\u0130X GSM</p>
      <p class="brand-sub">Gaziantep \u2022 Telefon ve Teknoloji Ma\u011fazas\u0131</p>
    </div>
  </div>
  <h1>G\u00fcncel Fiyat ve Stok Listesi</h1>
  <p class="lead">Son g\u00fcncelleme: ${esc(when)}</p>
  <a class="pdf-btn" href="fiyat-listesi.pdf">PDF olarak indir</a>
  <div class="grid">
    ${thumbs}
  </div>
  <div class="foot">
    ${esc(biz.address)}<br>
    WhatsApp: <a class="wa" href="${esc(biz.phone.whatsapp_url)}">${esc(biz.phone.display)}</a><br>
    T\u00fcm site: <a class="site" href="https://mixgsm.tr/">mixgsm.tr</a>
  </div>
</div>
</body>
</html>`;
}

// ---------------------------------------------------------------- calistirma
async function main() {
  const { chromium } = require("playwright");

  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  const business = JSON.parse(fs.readFileSync(BUSINESS_PATH, "utf8"));
  const logoDataUri = "data:image/jpeg;base64," + fs.readFileSync(LOGO_PATH).toString("base64");

  const units = buildFlowUnits(catalog);
  if (!units.length) throw new Error("catalog.json'dan hicbir gecerli urun cikarilamadi - guvenlik icin durduruldu.");

  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Onceki calistirmadan kalan JPG sayfalarini temizle (sayfa sayisi
  // azalirsa eski fazladan dosyalar site uzerinde asili kalmasin).
  for (const f of fs.readdirSync(OUT_DIR)) {
    if (f.startsWith(JPG_PREFIX) && f.endsWith(".jpg")) fs.unlinkSync(path.join(OUT_DIR, f));
  }

  const browser = await chromium.launch();
  try {
    // 1) PDF - akan, sayfalanmis, tiklanabilir linkli, secilebilir metin.
    const pdfPage = await browser.newPage();
    const pdfHtml = buildPdfHtml(units, catalog, business, logoDataUri);
    await pdfPage.setContent(pdfHtml, { waitUntil: "networkidle" });
    await pdfPage.emulateMedia({ media: "print" });
    await pdfPage.pdf({
      path: OUT_PDF,
      format: "A4",
      printBackground: true,
      margin: { top: "10mm", bottom: "16mm", left: "10mm", right: "10mm" },
      displayHeaderFooter: true,
      headerTemplate: `<span></span>`,
      footerTemplate: `<div style="width:100%;font-size:9px;color:#999;text-align:center;font-family:Arial,sans-serif;">Sayfa <span class="pageNumber"></span> / <span class="totalPages"></span></div>`,
    });
    await pdfPage.close();

    // 2) JPG'ler - 1080x1920, gercek olculmus yukseklige gore otomatik sayfalanir.
    const jpgFiles = await renderJpgPages(browser, units, catalog, business, logoDataUri, OUT_DIR);

    const pdfSize = fs.statSync(OUT_PDF).size;
    console.log(`fiyat-listesi.pdf yazildi (${(pdfSize / 1024).toFixed(0)} KB)`);
    console.log(`${jpgFiles.length} JPG sayfasi yazildi: ${jpgFiles.join(", ")}`);

    // 3) Paylasim sayfasi - musteriye WhatsApp/Instagram'da atilacak TEK
    // link (mixgsm.tr/price-assets/), tum JPG'lere ve PDF'e buradan erisilir.
    fs.writeFileSync(path.join(OUT_DIR, "index.html"), buildGalleryHtml(jpgFiles, catalog, business), "utf8");
    console.log("price-assets/index.html yazildi (paylasim linki: mixgsm.tr/price-assets/).");
  } finally {
    await browser.close();
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("HATA:", err.message);
    process.exit(1);
  });
}

module.exports = { buildFlowUnits, renderUnitHtml, paginate };
