// scripts/generate-sitemap.js birim testleri (node --test scripts/tests/sitemap.test.js).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSitemap, istanbulDate } = require("../generate-sitemap");

test("tarih Turkiye saatine gore alinir (UTC gece yarisi sonrasi degil)", () => {
  assert.equal(istanbulDate("2026-09-26T20:59:00Z"), "2026-09-26");
  assert.equal(istanbulDate("2026-09-26T21:01:00Z"), "2026-09-27");
});

test("gecersiz tarih hata verir", () => {
  assert.throws(() => istanbulDate("bozuk"));
});

test("sitemap sabit dort sayfayi ve verilen lastmod'u icerir, gecerli XML iskeleti", () => {
  const xml = buildSitemap("2026-09-26");
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<loc>https:\/\/mixgsm\.tr\/<\/loc>\s*<lastmod>2026-09-26<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/mixgsm\.tr\/fiyat-listesi\/<\/loc>\s*<lastmod>2026-09-26<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/mixgsm\.tr\/iade-politikasi\/<\/loc>\s*<lastmod>2026-09-26<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/mixgsm\.tr\/uygulama\/<\/loc>/);
  assert.equal((xml.match(/<url>/g) || []).length, 4);
  assert.match(xml, /<\/urlset>\n$/);
});

// ---------------------------------------------------------------- lastmod = gercek icerik degisikligi
const fs = require("fs");
const os = require("os");
const path = require("path");
const { computeLastmods, parseSitemapDates, locToFile, generate, STATE_FILE } = require("../generate-sitemap");

function tmpSite(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mixgsm-sitemap-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}
const U = (p) => `https://mixgsm.tr${p}`;
const datesOf = (dir) => parseSitemapDates(fs.readFileSync(path.join(dir, "sitemap.xml"), "utf8"));
const BASE = {
  "index.html": "<h1>Ana</h1>", "fiyat-listesi/index.html": "<p>Son güncelleme: <time datetime=\"2026-11-01T10:00:00Z\">1 Kasım 2026 13:00</time></p><td>10.000 TL</td>",
  "iade-politikasi/index.html": "<p>7 gün</p>", "uygulama/index.html": "<p>app</p>",
  "urun/a-8-256/index.html": "<p>A 10.000 TL</p>", "urun/b-8-256/index.html": "<p>B 12.000 TL</p>",
  "laptop/nitro-pc-001/index.html": "<p>Nitro</p>",
};
const EXTRA = [U("/urun/a-8-256/"), U("/urun/b-8-256/"), U("/laptop/nitro-pc-001/")];

test("adres -> sayfa dosyasi eslemesi; site disi / ust klasor reddedilir", () => {
  assert.equal(locToFile(U("/")), "index.html");
  assert.equal(locToFile(U("/urun/a-8-256/")), "urun/a-8-256/index.html");
  assert.equal(locToFile("https://baska.site/x/"), null);
});

test("ilk calistirma: mevcut sitemap tarihleri korunur (bugune cekilmez), durum dosyasi olusur", () => {
  const dir = tmpSite({ ...BASE, "sitemap.xml": buildSitemap("2026-11-20", EXTRA) });
  const r = generate(dir, { extraUrls: EXTRA, today: "2026-12-01" });
  assert.equal(r.updatedToday, 0);
  assert.ok([...datesOf(dir).values()].every((d) => d === "2026-11-20"));
  const state = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), "utf8"));
  assert.equal(Object.keys(state.urls).length, 7);
  assert.ok(Object.values(state.urls).every((u) => /^[a-f0-9]{16}$/.test(u.hash)));
});

test("degismeyen adres tarihini korur; icerigi degisen adres bugun olur; yalniz yeniden yazilmak degisiklik sayilmaz", () => {
  const dir = tmpSite({ ...BASE, "sitemap.xml": buildSitemap("2026-11-20", EXTRA) });
  generate(dir, { extraUrls: EXTRA, today: "2026-11-21" });
  // ayni icerik yeniden yaziliyor (uretici her calismada yazar) + B'nin fiyati degisiyor
  fs.writeFileSync(path.join(dir, "urun/a-8-256/index.html"), "<p>A 10.000 TL</p>");
  fs.writeFileSync(path.join(dir, "urun/b-8-256/index.html"), "<p>B 12.500 TL</p>");
  generate(dir, { extraUrls: EXTRA, today: "2026-12-01" });
  const d = datesOf(dir);
  assert.equal(d.get(U("/urun/a-8-256/")), "2026-11-20");
  assert.equal(d.get(U("/urun/b-8-256/")), "2026-12-01");
  assert.equal(d.get(U("/iade-politikasi/")), "2026-11-20");
  // ertesi gun hicbir sey degismezse B'nin tarihi 2026-12-01'de kalir
  generate(dir, { extraUrls: EXTRA, today: "2026-12-02" });
  assert.equal(datesOf(dir).get(U("/urun/b-8-256/")), "2026-12-01");
});

test("fiyat listesinde yalniz 'Son güncelleme' saatinin degismesi icerik degisikligi sayilmaz, fiyat degisirse sayilir", () => {
  const dir = tmpSite({ ...BASE, "sitemap.xml": buildSitemap("2026-11-20", EXTRA) });
  generate(dir, { extraUrls: EXTRA, today: "2026-11-21" });
  const f = path.join(dir, "fiyat-listesi/index.html");
  fs.writeFileSync(f, "<p>Son güncelleme: <time datetime=\"2026-12-01T09:00:00Z\">1 Aralık 2026 12:00</time></p><td>10.000 TL</td>");
  generate(dir, { extraUrls: EXTRA, today: "2026-12-01" });
  assert.equal(datesOf(dir).get(U("/fiyat-listesi/")), "2026-11-20");
  fs.writeFileSync(f, "<p>Son güncelleme: <time datetime=\"2026-12-02T09:00:00Z\">2 Aralık 2026 12:00</time></p><td>10.500 TL</td>");
  generate(dir, { extraUrls: EXTRA, today: "2026-12-02" });
  assert.equal(datesOf(dir).get(U("/fiyat-listesi/")), "2026-12-02");
});

test("yeni adres bugun tarihiyle eklenir; listeden cikan adres (satilan laptop dahil) sitemap ve durumdan silinir", () => {
  const dir = tmpSite({ ...BASE, "sitemap.xml": buildSitemap("2026-11-20", EXTRA) });
  generate(dir, { extraUrls: EXTRA, today: "2026-11-21" });
  fs.mkdirSync(path.join(dir, "urun/c-12-512"), { recursive: true });
  fs.writeFileSync(path.join(dir, "urun/c-12-512/index.html"), "<p>C</p>");
  // laptop satildi: listPageUrls satilan laptopu vermez (sayfasi noindex olarak durur ama listede yok)
  const extra2 = [U("/urun/a-8-256/"), U("/urun/b-8-256/"), U("/urun/c-12-512/")];
  generate(dir, { extraUrls: extra2, today: "2026-12-01" });
  const d = datesOf(dir);
  assert.equal(d.get(U("/urun/c-12-512/")), "2026-12-01");
  assert.ok(!d.has(U("/laptop/nitro-pc-001/")));
  const state = JSON.parse(fs.readFileSync(path.join(dir, STATE_FILE), "utf8"));
  assert.ok(!(U("/laptop/nitro-pc-001/") in state.urls));
  assert.equal((fs.readFileSync(path.join(dir, "sitemap.xml"), "utf8").match(/<url>/g) || []).length, 7);
});

test("computeLastmods: sayfa dosyasi gecici olarak yoksa tarih ilerlemez; gecersiz bugun hata verir", () => {
  const loc = U("/urun/a-8-256/");
  const state = { urls: { [loc]: { hash: "aaaaaaaaaaaaaaaa", lastmod: "2026-11-20" } } };
  const r = computeLastmods([loc], { hashes: new Map([[loc, null]]), state, today: "2026-12-01" });
  assert.equal(r.lastmods.get(loc), "2026-11-20");
  assert.equal(r.state.urls[loc].hash, "aaaaaaaaaaaaaaaa");
  assert.throws(() => computeLastmods([loc], { hashes: new Map(), state, today: "bugun" }));
});

test("gercek depo: satilan (noindex) laptop sayfalari sitemap'te yok, sitemap'teki her adresin sayfasi var", () => {
  const root = path.join(__dirname, "..", "..");
  const locs = [...parseSitemapDates(fs.readFileSync(path.join(root, "sitemap.xml"), "utf8")).keys()];
  assert.ok(locs.length > 10);
  for (const loc of locs) {
    const file = path.join(root, locToFile(loc));
    assert.ok(fs.existsSync(file), `sitemap'te olup sayfasi olmayan adres: ${loc}`);
    assert.ok(!/<meta name="robots" content="noindex/.test(fs.readFileSync(file, "utf8")), `noindex sayfa sitemap'te: ${loc}`);
  }
});
