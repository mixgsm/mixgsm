// MIX GSM - sitemap.xml ureteci
//
//   node scripts/generate-sitemap.js
//
// Adresler: sabit sayfalar (PAGES) + urun/laptop/rehber sayfalari
// (generate-product-pages.js listPageUrls; satilan laptoplar noindex oldugu icin
// listede YOKTUR).
//
// lastmod = o adresin ICERIGININ son degistigi gun (Turkiye saati).
// Her adresin sayfa dosyasinin (ornek: urun/x/index.html) icerik ozeti
// .sitemap-state.json dosyasinda tutulur:
//   - ozet ayni      -> onceki tarih korunur (dosya yeniden yazilmis olsa bile)
//   - ozet farkli    -> bugun
//   - yeni adres     -> bugun
//   - listede olmayan adres -> sitemap'ten ve durum dosyasindan cikar
// Ilk calistirmada (durum dosyasi yokken) mevcut sitemap.xml'deki tarihler
// KORUNUR; hicbir tarih sebepsiz bugune cekilmez.
// Git gecmisine bakilmaz (Actions sig klon kullanir). Durum dosyasi nokta ile
// basladigi icin Jekyll/GitHub Pages onu yayinlamaz; hassas veri icermez
// (yalniz adres, ozet, tarih).
"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const ROOT = path.join(__dirname, "..");
const SITE_ORIGIN = "https://mixgsm.tr";
const SITEMAP_FILE = "sitemap.xml";
const STATE_FILE = ".sitemap-state.json";
const STATE_VERSION = 1;
const PAGES = [
  { loc: "https://mixgsm.tr/", changefreq: "daily", priority: "1.0" },
  { loc: "https://mixgsm.tr/fiyat-listesi/", changefreq: "daily", priority: "0.8" },
  { loc: "https://mixgsm.tr/iade-politikasi/", changefreq: "monthly", priority: "0.3" },
  { loc: "https://mixgsm.tr/uygulama/", changefreq: "monthly", priority: "0.4" },
];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function istanbulDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("Gecersiz tarih: " + iso);
  // en-CA bicimi YYYY-MM-DD verir.
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
}

// Sabit sayfalar + ek adresler (urun/laptop/rehber), sirasi korunur, tekrar yok.
function pageList(extraUrls = []) {
  const seen = new Set();
  return PAGES.concat(extraUrls.map((loc) => ({ loc, changefreq: "weekly", priority: "0.6" })))
    .filter((p) => (seen.has(p.loc) ? false : seen.add(p.loc)));
}

// lastmod: tek tarih (tum adresler) ya da adres -> tarih fonksiyonu.
function buildSitemap(lastmod, extraUrls = []) {
  const dateOf = typeof lastmod === "function" ? lastmod : () => lastmod;
  const urls = pageList(extraUrls).map((p) =>
    `  <url>\n    <loc>${p.loc}</loc>\n    <lastmod>${dateOf(p.loc)}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// Mevcut sitemap.xml'den adres -> lastmod (ilk calistirmada tarihleri korumak icin).
function parseSitemapDates(xml) {
  const out = new Map();
  const re = /<url>\s*<loc>([^<]+)<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g;
  let m;
  while ((m = re.exec(String(xml || "")))) if (DATE_RE.test(m[2].trim())) out.set(m[1].trim(), m[2].trim());
  return out;
}

// https://mixgsm.tr/urun/x/ -> urun/x/index.html ; https://mixgsm.tr/ -> index.html
function locToFile(loc) {
  const u = new URL(loc);
  if (u.origin !== SITE_ORIGIN) return null;
  const rel = decodeURIComponent(u.pathname).replace(/^\/+/, "");
  if (rel.split("/").some((part) => part === "..")) return null;
  return rel === "" ? "index.html" : rel.replace(/\/?$/, "/") + "index.html";
}

// Her uretimde degisen ama icerik sayilmayan kisimlar ozetten cikarilir:
// fiyat listesindeki "Son güncelleme" saati ve <time datetime="..."> damgasi.
function normalizeForHash(text) {
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/<time\b[^>]*>[^<]*<\/time>/g, "<time></time>")
    .replace(/\sdatetime="[^"]*"/g, "")
    .replace(/Son güncelleme:[^<"]*/g, "Son güncelleme:");
}

function pageHash(root, loc) {
  const rel = locToFile(loc);
  if (!rel) return null;
  const file = path.join(root, rel);
  if (!fs.existsSync(file)) return null;
  return crypto.createHash("sha256").update(normalizeForHash(fs.readFileSync(file, "utf8"))).digest("hex").slice(0, 16);
}

// Saf fonksiyon (test edilir): adres listesi + guncel ozetler + onceki durum -> tarihler ve yeni durum.
//   locs       : adresler (sirali)
//   hashes     : Map adres -> ozet (dosya yoksa null)
//   state      : onceki .sitemap-state.json ({ urls: { adres: { hash, lastmod } } }) ya da null
//   previous   : Map adres -> onceki sitemap.xml tarihi (ilk calistirma gecisi)
//   today      : YYYY-MM-DD
function computeLastmods(locs, { hashes, state, previous = new Map(), today }) {
  if (!DATE_RE.test(String(today || ""))) throw new Error("Gecersiz bugun tarihi: " + today);
  const prevUrls = state && state.urls && typeof state.urls === "object" ? state.urls : null;
  const urls = {};
  const lastmods = new Map();
  for (const loc of locs) {
    const hash = hashes.get(loc) || null;
    const prev = prevUrls && prevUrls[loc] && DATE_RE.test(String(prevUrls[loc].lastmod)) ? prevUrls[loc] : null;
    let lastmod;
    if (prev) {
      // Dosya bulunamadiysa (gecici uretim hatasi) icerik degisti sayilmaz.
      lastmod = hash === null || hash === prev.hash ? prev.lastmod : today;
    } else if (!prevUrls && previous.has(loc)) {
      lastmod = previous.get(loc);                     // ilk calistirma: mevcut tarihi koru
    } else {
      lastmod = today;                                 // yeni adres
    }
    if (lastmod > today) lastmod = today;              // gelecek tarih yazilmaz
    lastmods.set(loc, lastmod);
    urls[loc] = { hash: hash === null && prev ? prev.hash : hash, lastmod };
  }
  return { lastmods, state: { version: STATE_VERSION, urls } };
}

function readJson(file) {
  try { return JSON.parse(fs.readFileSync(file, "utf8")); } catch (e) { return null; }
}

// root, extraUrls ve today disaridan verilebilir (testler gecici klasorde calisir).
function generate(root, { extraUrls, today } = {}) {
  const sitemapPath = path.join(root, SITEMAP_FILE);
  const statePath = path.join(root, STATE_FILE);
  const pages = pageList(extraUrls || []);
  const locs = pages.map((p) => p.loc);
  const currentXml = fs.existsSync(sitemapPath) ? fs.readFileSync(sitemapPath, "utf8").replace(/\r\n/g, "\n") : "";
  const hashes = new Map(locs.map((loc) => [loc, pageHash(root, loc)]));
  const { lastmods, state } = computeLastmods(locs, {
    hashes,
    state: readJson(statePath),
    previous: parseSitemapDates(currentXml),
    today: today || istanbulDate(new Date().toISOString()),
  });
  const xml = buildSitemap((loc) => lastmods.get(loc), extraUrls || []);
  const stateText = JSON.stringify(state, null, 1) + "\n";
  const currentState = fs.existsSync(statePath) ? fs.readFileSync(statePath, "utf8") : "";
  const changed = { sitemap: currentXml !== xml, state: currentState !== stateText };
  if (changed.sitemap) fs.writeFileSync(sitemapPath, xml);
  if (changed.state) fs.writeFileSync(statePath, stateText);
  const updatedToday = [...lastmods.values()].filter((d) => d === (today || istanbulDate(new Date().toISOString()))).length;
  return { changed, count: locs.length, updatedToday };
}

function main() {
  // Urun sayfasi adresleri uretilemezse site haritasi yalniz sabit sayfalarla yazilir.
  let extra = [];
  try { extra = require("./generate-product-pages").listPageUrls(ROOT); } catch (e) { console.log("::warning::urun sayfasi adresleri alinamadi: " + e.message); }
  const r = generate(ROOT, { extraUrls: extra });
  if (!r.changed.sitemap && !r.changed.state) console.log(`sitemap.xml guncel (${r.count} adres).`);
  else console.log(`sitemap.xml ${r.changed.sitemap ? "yazildi" : "ayni"}; ${r.count} adres, bugun tarihli: ${r.updatedToday}.`);
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("HATA:", err.message);
    process.exit(1);
  }
}

module.exports = { buildSitemap, istanbulDate, computeLastmods, parseSitemapDates, locToFile, normalizeForHash, pageHash, generate, STATE_FILE };
