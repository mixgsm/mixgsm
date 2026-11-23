// MIX GSM - acilis (hero) gorselini index.html'e onceden yazar
//
//   node scripts/generate-hero-preload.js            -> index.html'i gunceller
//   node scripts/generate-hero-preload.js --check    -> yalniz kontrol; guncel degilse cikis 1
//
// NEDEN (PERFORMANS / LCP): Acilistaki urun fotografi eskiden ancak app.js
// yuklenip catalog.json islendikten SONRA sayfaya ekleniyordu; sayfanin en
// buyuk ogesi (LCP) ~4 sn'de gorunuyordu. Bu script sitenin kendi secim
// kuralini (heroProducts + ilk fotografli urun) taklit edip o urunun
// fotografini HTML'e yazar: tarayici gorseli JS'i beklemeden indirir ve
// gosterir. JS sonradan ayni urunu secer (gorsel degismez); katalog degismisse
// JS kendi secimini gosterir, sayfa yine calisir.
//
// Katalog her guncellendiginde (update-catalog.yml) calistirilir.
"use strict";

const fs = require("fs");
const path = require("path");
const { loadSiteImageMatcher } = require("./check-images");
const priceFeed = require("./generate-price-page");

const ROOT = path.join(__dirname, "..");
const PHONE_PHOTO_BASE = "https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/";
const IMG_RE = /<img id="heroProductImg"[^>]*>/;
const EMPTY_RE = /<div class="home-hero-empty" id="heroVisualEmpty"[^>]*>[^<]*<\/div>/;
const PRELOAD_RE = /<!--hero-preload-->[\s\S]*?<!--\/hero-preload-->\n?/;
const PRELOAD_ANCHOR = '<link rel="preload" href="catalog.json"';

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function normalizeKey(p) {
  return String(`${p.b} ${p.m}`).toLocaleLowerCase("tr-TR").replace(/\s+/g, " ").trim();
}

// app.js heroProducts() ile ayni kural.
function heroProducts(products) {
  const available = products.filter((p) => !priceFeed.isNonProductRow(p) && p.stock === "IN" && typeof p.p === "number");
  const seen = new Set();
  const chosen = available.filter((p) => {
    if (!p.home) return false;
    const key = normalizeKey(p);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  if (chosen.length) return chosen;
  return available.filter((p) => p.group === "PHONE").sort((a, b) => b.p - a.p).slice(0, 1);
}

function productLabel(p) {
  const b = String(p.b || "").trim();
  const m = String(p.m || "").trim();
  return (m.toLocaleUpperCase("tr-TR").startsWith(b.toLocaleUpperCase("tr-TR")) ? m : `${b} ${m}`).trim();
}

function pickHero(root) {
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8"));
  const matcher = loadSiteImageMatcher(root);
  const photos = fs.readdirSync(path.join(root, "photos"));
  const exists = new Set(photos);
  const list = matcher.withPhotoVariantIndex(catalog.products);
  for (const p of heroProducts(list)) {
    const first = matcher.candidates(p, photos)[0] || "";
    const file = first.startsWith(PHONE_PHOTO_BASE) ? decodeURIComponent(first.slice(PHONE_PHOTO_BASE.length)) : "";
    if (file && file !== "gorsel-yok.jpg" && exists.has(file)) return { src: "photos/" + file, alt: productLabel(p) };
  }
  return null;
}

function apply(html, hero) {
  let out = html.replace(PRELOAD_RE, "");
  if (!IMG_RE.test(out) || !EMPTY_RE.test(out) || !out.includes(PRELOAD_ANCHOR)) {
    throw new Error("index.html'de acilis gorseli isaretleri bulunamadi");
  }
  if (!hero) {
    out = out.replace(IMG_RE, '<img id="heroProductImg" alt="" style="display:none;" fetchpriority="high" decoding="async">');
    return out.replace(EMPTY_RE, '<div class="home-hero-empty" id="heroVisualEmpty">Katalog yükleniyor…</div>');
  }
  const src = esc(encodeURI(hero.src));
  out = out.replace(IMG_RE, `<img id="heroProductImg" src="${src}" alt="${esc(hero.alt)}" fetchpriority="high" decoding="async">`);
  out = out.replace(EMPTY_RE, '<div class="home-hero-empty" id="heroVisualEmpty" style="display:none;">Katalog yükleniyor…</div>');
  const preload = `<!--hero-preload--><link rel="preload" href="${src}" as="image" fetchpriority="high"><!--/hero-preload-->\n`;
  return out.replace(PRELOAD_ANCHOR, preload + PRELOAD_ANCHOR);
}

function main() {
  const file = path.join(ROOT, "index.html");
  const html = fs.readFileSync(file, "utf8");
  const hero = pickHero(ROOT);
  const next = apply(html, hero);
  if (process.argv.includes("--check")) {
    if (next !== html) { console.error("index.html acilis gorseli guncel degil: node scripts/generate-hero-preload.js"); process.exit(1); }
    console.log("Acilis gorseli guncel.");
    return;
  }
  if (next === html) { console.log("Acilis gorseli guncel" + (hero ? ": " + hero.src : ".")); return; }
  fs.writeFileSync(file, next);
  console.log("index.html acilis gorseli yazildi: " + (hero ? hero.src : "(yok)"));
}

if (require.main === module) {
  try { main(); } catch (err) { console.error("HATA:", err.message); process.exit(1); }
}

module.exports = { heroProducts, apply, pickHero };
