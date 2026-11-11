// MIX GSM - sitemap.xml ureteci
//
//   node scripts/generate-sitemap.js
//
// Ana sayfa, fiyat listesi ve urun sayfalari (urun/, laptop/) catalog verisinden gelir;
// lastmod = katalogun uretildigi gun (Turkiye saati). Dosya yalnizca icerik
// degisince yazilir, boylece gunde en fazla bir kez degisir.
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITEMAP_PATH = path.join(ROOT, "sitemap.xml");
const CATALOG_PATH = path.join(ROOT, "catalog.json");
const PAGES = [
  { loc: "https://mixgsm.tr/", changefreq: "daily", priority: "1.0" },
  { loc: "https://mixgsm.tr/fiyat-listesi/", changefreq: "daily", priority: "0.8" },
];

function istanbulDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) throw new Error("Gecersiz tarih: " + iso);
  // en-CA bicimi YYYY-MM-DD verir.
  return d.toLocaleDateString("en-CA", { timeZone: "Europe/Istanbul" });
}

// extraUrls: urun sayfalari (scripts/generate-product-pages.js). Ayni lastmod.
function buildSitemap(lastmod, extraUrls = []) {
  const pages = PAGES.concat(extraUrls.map((loc) => ({ loc, changefreq: "weekly", priority: "0.6" })));
  const urls = pages.map((p) =>
    `  <url>\n    <loc>${p.loc}</loc>\n    <lastmod>${lastmod}</lastmod>\n    <changefreq>${p.changefreq}</changefreq>\n    <priority>${p.priority}</priority>\n  </url>`
  ).join("\n");
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

function main() {
  const catalog = JSON.parse(fs.readFileSync(CATALOG_PATH, "utf8"));
  // Urun sayfasi adresleri uretilemezse site haritasi yalniz iki sayfayla yazilir.
  let extra = [];
  try { extra = require("./generate-product-pages").listPageUrls(ROOT); } catch (e) { console.log("::warning::urun sayfasi adresleri alinamadi: " + e.message); }
  const xml = buildSitemap(istanbulDate(catalog.generatedAt), extra);
  const current = fs.existsSync(SITEMAP_PATH) ? fs.readFileSync(SITEMAP_PATH, "utf8").replace(/\r\n/g, "\n") : "";
  if (current === xml) {
    console.log("sitemap.xml guncel.");
    return;
  }
  fs.writeFileSync(SITEMAP_PATH, xml);
  console.log("sitemap.xml yazildi (lastmod " + istanbulDate(catalog.generatedAt) + ").");
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("HATA:", err.message);
    process.exit(1);
  }
}

module.exports = { buildSitemap, istanbulDate };
