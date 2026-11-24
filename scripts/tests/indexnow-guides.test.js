// IndexNow bildirimi ve rehber sayfalari (node --test scripts/tests/indexnow-guides.test.js)
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const indexnow = require("../indexnow-submit");
const gen = require("../generate-product-pages");

const root = path.join(__dirname, "..", "..");

test("IndexNow: yalniz yayinlanan sayfalar adrese cevrilir", () => {
  assert.equal(indexnow.fileToUrl("index.html"), "https://mixgsm.tr/");
  assert.equal(indexnow.fileToUrl("urun/xiaomi-poco-c85-4-128/index.html"), "https://mixgsm.tr/urun/xiaomi-poco-c85-4-128/");
  assert.equal(indexnow.fileToUrl("rehber/index.html"), "https://mixgsm.tr/rehber/");
  ["catalog.json", "sitemap.xml", "feed/products.json", "../x/index.html", ".github/index.html", "a/b/c/index.html"]
    .forEach((f) => assert.equal(indexnow.fileToUrl(f), null, f));
  assert.deepEqual(indexnow.urlsFromList("index.html\ncatalog.json\nindex.html\n"), ["https://mixgsm.tr/"]);
});

test("IndexNow anahtar dosyasi depoda ve icerigi adiyla ayni", () => {
  assert.match(indexnow.findKey(root) || "", /^[a-f0-9]{32}$/);
});

test("rehberler: liste urunleri katalogda var, fiyat araligina uyar; llms.txt uretilir", () => {
  const built = gen.buildAll(root);
  assert.ok(built.guides.length >= 1);
  const under = built.guides.find((g) => g.slug === "20000-tl-alti-telefon");
  if (under) under.items.forEach((p) => assert.ok(p.price <= 20000 && p.stock === "IN"));
  built.guides.forEach((g) => {
    const html = built.files.get(`${gen.GUIDE_DIR}/${g.slug}/index.html`);
    assert.ok(html && html.includes(gen.PAGE_MARKER));
    g.items.forEach((p) => assert.ok(built.files.has(`${p.dir}/${p.slug}/index.html`), `rehberde sayfasi olmayan urun: ${p.slug}`));
  });
  assert.ok(built.llms.startsWith("# MİX GSM") && built.llms.includes("## Rehberler"));
});
