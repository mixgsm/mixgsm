// scripts/generate-product-pages.js testleri (node --test scripts/tests/product-pages.test.js).
// Gercek depo verisiyle bellekte uretir; diske yazmaz.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const fs = require("fs");
const vm = require("vm");
const gen = require("../generate-product-pages");
const priceFeed = require("../generate-price-page");
const { readAppSource } = require("../asset-version");

const root = path.join(__dirname, "..", "..");
const built = gen.buildAll(root);
const pageOf = (dir, slug) => built.files.get(`${dir}/${slug}/index.html`);

test("katalogdaki her telefon/bakim urununun sayfasi var ve adres sitedeki baglantiyla ayni", () => {
  const src = readAppSource(root);
  const slice = (a, b) => { const i = src.indexOf(a); const j = src.indexOf(b, i); assert.ok(i >= 0 && j > i, a); return src.slice(i, j); };
  const site = vm.runInNewContext(
    slice("function normalizeTR(", "\n// İşletme sahibinin seçim") + slice("function productBaseSlug(", "function findProductBySlug(") + ";({ productSlug })", {});
  const catalog = JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8"));
  const real = catalog.products.filter((p) => !priceFeed.isNonProductRow(p));
  assert.ok(real.length > 0);
  real.forEach((p) => {
    const slug = site.productSlug(p);
    const html = pageOf(gen.PHONE_DIR, slug);
    assert.ok(html, `sayfa yok: ${slug}`);
    assert.ok(html.includes(`href="/#urun/${slug}"`), `katalog baglantisi yanlis: ${slug}`);
    assert.ok(html.includes(`<link rel="canonical" href="https://mixgsm.tr/${gen.PHONE_DIR}/${slug}/">`));
  });
});

// Fatura/garanti ALANLARI gosterilmez; isletmenin kendi yazdigi urun aciklamasi
// (sitede de gorunen metin) "Faturali" diyebilir, o serbesttir.
test("sayfalar IMEI/kayit durumu, fatura ve garanti alanlarini icermez", () => {
  built.files.forEach((html, rel) => {
    assert.ok(!/Kayıt Durumu|Kayıtlı|Kayıtsız|IMEI|<th scope="row">(Fatura|Garanti)/.test(html), `hassas bilgi: ${rel}`);
  });
});

test("her sayfada uretici isareti, tek h1, gecerli JSON-LD ve CSP var", () => {
  built.files.forEach((html, rel) => {
    assert.ok(html.includes(gen.PAGE_MARKER), rel);
    assert.equal((html.match(/<h1>/g) || []).length, 1, rel);
    assert.match(html, /<meta http-equiv="Content-Security-Policy" content="default-src 'none';/, rel);
    [...html.matchAll(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g)].forEach((m) => JSON.parse(m[1]));
  });
});

test("fiyatli, stokta olan urunde teklif (Offer) ve taksit var; satilan laptop arama disi", () => {
  const priced = built.pages.find((p) => p.kind === "phone" && p.price && p.stock === "IN");
  const html = pageOf(priced.dir, priced.slug);
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.equal(ld["@type"], "Product");
  assert.equal(ld.offers.price, priced.price);
  assert.equal(ld.offers.priceCurrency, "TRY");
  assert.match(html, /Kredi kartına 3 taksit/);
  assert.match(html, /<meta name="robots" content="index, follow">/);

  const sold = built.pages.find((p) => p.sold);
  if (sold) {
    const s = pageOf(sold.dir, sold.slug);
    assert.match(s, /<meta name="robots" content="noindex, follow">/);
    assert.ok(!/"offers"/.test(s));
    assert.ok(!/taksit/i.test(s.replace(/<style>[\s\S]*?<\/style>/, "")));
  }
});

test("kotu niyetli urun adi kacislanir (HTML/JSON-LD enjeksiyonu yok)", () => {
  const rules = gen.loadSiteRules(root);
  const evil = '</script><img src=x onerror=alert(1)>"\'<b>';
  const pages = gen.laptopPages({ products: [{ id: "PC-999", condition: "USED", brand: "ACME", model: evil, price: 1000, stock: "IN", description: evil }] }, rules, [], new Map());
  assert.equal(pages.length, 1);
  const biz = { phone: { e164: "+905424818255", display: "0542 481 82 55", whatsapp_url: "https://wa.me/905424818255" }, address: "Adres" };
  const html = gen.renderProductPage(pages[0], pages, biz, rules, "");
  assert.ok(!html.includes("<img src=x"));
  assert.ok(!/<img[^>]*onerror/i.test(html));
  assert.ok(!html.includes(`"'<b>`));
  assert.equal((html.match(/<\/script>/g) || []).length, (html.match(/<script /g) || []).length);
});

test("sayac anahtari yoksa sayfada hic dis script yok", () => {
  const rules = gen.loadSiteRules(root);
  const pg = built.pages[0];
  const biz = { phone: { e164: "+905424818255", display: "x", whatsapp_url: "https://wa.me/905424818255" }, address: "Adres" };
  const html = gen.renderProductPage(pg, built.pages, biz, rules, "");
  assert.ok(!html.includes("cloudflareinsights"));
});

test("Google beslemesi: yalniz kayitli/fiyatli/gorselli/stoktaki urun, kayitsiz telefon yok, TSV saglam", () => {
  const base = { kind: "phone", dir: "urun", group: "PHONE", brand: "XIAOMI", specs: [["Ekran", "6,9"]], note: "", image: "/photos/a.jpg",
    price: 9500, stock: "IN", sold: false, condition: "https://schema.org/NewCondition", registration: "KAYITLI" };
  const pages = [
    { ...base, slug: "kayitli", name: "Xiaomi\tPOCO C85" },
    { ...base, slug: "kayitsiz", name: "x", registration: "KAYITSIZ" },
    { ...base, slug: "belirsiz", name: "x", registration: "" },
    { ...base, slug: "fiyatsiz", name: "x", price: null },
    { ...base, slug: "gorselsiz", name: "x", image: "" },
    { ...base, slug: "sor", name: "x", stock: "ASK" },
    { ...base, slug: "bakim", name: "Braun", group: "PERSONAL_CARE", registration: "-" },
    { ...base, kind: "laptop", dir: "laptop", group: "LAPTOP", slug: "lp", name: "Lenovo (2. El)", registration: undefined, condition: "https://schema.org/UsedCondition" },
  ];
  const feeds = gen.googleFeedFiles(pages);
  const rows = (f) => feeds.get(f).trimEnd().split("\n").map((l) => l.split("\t"));
  const prod = rows("feed/google-urunler.tsv");
  const stock = rows("feed/google-magaza-stok.tsv");
  assert.deepEqual(prod.slice(1).map((r) => r[0]), ["kayitli", "bakim", "lp"]);
  prod.forEach((r) => assert.equal(r.length, prod[0].length));
  assert.deepEqual(prod[1].slice(0, 2), ["kayitli", "Xiaomi POCO C85"]);
  assert.equal(prod[1][6], "9500.00 TRY");
  assert.equal(prod[3][7], "used");
  assert.deepEqual(stock[1], ["17557344197910298668", "kayitli", "9500.00 TRY", "in_stock"]);
  // gercek katalog: kayitsiz telefon beslemeye hic girmez
  const real = gen.googleFeedFiles(built.pages).get("feed/google-urunler.tsv");
  built.pages.filter((p) => p.kind === "phone" && p.group === "PHONE" && p.registration !== "KAYITLI")
    .forEach((p) => assert.ok(!real.includes(`\n${p.slug}\t`), p.slug));
});
