// scripts/generate-price-page.js: urun baglantilari, JSON-LD adresleri, kisisel bakim sutunu, laptop ozeti.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const priceFeed = require("../generate-price-page");

const root = path.join(__dirname, "..", "..");
const business = JSON.parse(fs.readFileSync(path.join(root, "feed", "business.public.json"), "utf8"));
const O = "https://mixgsm.tr";

function catalog() {
  const base = { cat: "XIAOMI", img: "", battery: "", screen: "", processor: "", camera: "", connectivity: "", warranty: "", tagLabel: "", tagClass: "", home: false };
  return { generatedAt: "2026-11-25T10:00:00.000Z", products: [
    { ...base, b: "XIAOMI", m: "REDMI 15", s: "8 GB / 256 GB", p: 14500, stock: "IN", group: "PHONE", registration: "KAYITSIZ" },
    { ...base, b: "XIAOMI", m: "REDMI 17", s: "8 GB / 256 GB", p: null, stock: "ASK", group: "PHONE", registration: "KAYITLI" },
    { ...base, b: "DYSON", m: "DYSON AIRSTRAIT", s: "", p: 9500, stock: "IN", group: "PERSONAL_CARE", cat: "OTHER", registration: "-" },
  ] };
}
function tmpRoot(dirs) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mixgsm-price-"));
  for (const [rel, body] of Object.entries(dirs)) {
    fs.mkdirSync(path.join(dir, rel), { recursive: true });
    fs.writeFileSync(path.join(dir, rel, "index.html"), body);
  }
  return dir;
}

test("urun adi mevcut urun sayfasina baglanir, JSON-LD adresi urun sayfasidir; sayfasi olmayan urun capada kalir", () => {
  const feed = priceFeed.buildFeed(catalog());
  const phoneUrls = new Map([["xiaomi-redmi-15-8-256", `${O}/urun/xiaomi-redmi-15-8-256/`], ["dyson-dyson-airstrait", `${O}/urun/dyson-dyson-airstrait/`]]);
  const html = priceFeed.renderPage(feed, business, { phoneUrls });
  assert.match(html, /<th scope="row"><a href="\/urun\/xiaomi-redmi-15-8-256\/">REDMI 15<\/a><\/th>/);
  assert.match(html, /<th scope="row">REDMI 17<\/th>/);                       // sayfa yok -> baglanti yok
  const ld = JSON.parse(html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  assert.deepEqual(ld.itemListElement.map((x) => x.url), [
    `${O}/urun/xiaomi-redmi-15-8-256/`, `${O}/fiyat-listesi/#xiaomi-redmi-17-8-256`, `${O}/urun/dyson-dyson-airstrait/`]);
  // kisisel bakim: RAM / Depolama sutunu ve bos hucresi yok; telefon tablosu sutunlarini korur
  const care = html.slice(html.indexOf('<section id="marka-dyson">'), html.indexOf("</section>", html.indexOf('<section id="marka-dyson">')));
  assert.ok(!care.includes("RAM / Depolama") && !care.includes("<td>—</td>"));
  const phone = html.slice(html.indexOf('<section id="marka-xiaomi">'), html.indexOf("</section>", html.indexOf('<section id="marka-xiaomi">')));
  assert.ok(phone.includes("RAM / Depolama") && phone.includes("<td>8 GB / 256 GB</td>"));
  assert.ok(!/Kayıtlı|Kayıtsız|KAYITSIZ|IMEI/.test(html), "kayit durumu sayfada gorunmemeli");
});

test("laptop ozeti yalniz verilen (stokta, sayfasi olan) laptoplari listeler; laptop yoksa bolum hic yok", () => {
  const feed = priceFeed.buildFeed(catalog());
  const withL = priceFeed.renderPage(feed, business, { laptops: [{ name: "ACER NITRO 5 (2. El)", price: 27500, url: `${O}/laptop/acer-nitro-5-pc-001/` }] });
  assert.match(withL, /<section id="laptoplar">/);
  assert.match(withL, /<a href="\/laptop\/acer-nitro-5-pc-001\/">ACER NITRO 5 \(2\. El\)<\/a>/);
  assert.match(withL, /27\.500 TL/);
  assert.match(withL, /href="#laptoplar"/);
  const without = priceFeed.renderPage(feed, business, {});
  assert.ok(!without.includes("laptoplar"));
});

test("verifyPage: dogru sayfa gecer; olmayan sayfaya baglanti, eksik baglanti, satilmis laptop ve kayit bilgisi yakalanir", () => {
  const feed = priceFeed.buildFeed(catalog());
  const dir = tmpRoot({
    "urun/xiaomi-redmi-15-8-256": "<p>ok</p>", "urun/dyson-dyson-airstrait": "<p>ok</p>",
    "laptop/acer-nitro-5-pc-001": "<p>ok</p>",
    "laptop/acer-nitro-pc-008": '<meta name="robots" content="noindex, follow">',
  });
  const links = { phoneUrls: new Map([["xiaomi-redmi-15-8-256", `${O}/urun/xiaomi-redmi-15-8-256/`], ["dyson-dyson-airstrait", `${O}/urun/dyson-dyson-airstrait/`]]),
    laptops: [{ name: "ACER NITRO 5", price: 27500, url: `${O}/laptop/acer-nitro-5-pc-001/` }] };
  const good = priceFeed.renderPage(feed, business, links);
  assert.deepEqual(priceFeed.verifyPage(good, feed, dir), []);
  // urun sayfasi var ama baglanti verilmemis
  const noLinks = priceFeed.renderPage(feed, business, { laptops: links.laptops });
  assert.ok(priceFeed.verifyPage(noLinks, feed, dir).some((e) => /baglanti yok: xiaomi-redmi-15/.test(e)));
  // olmayan sayfaya baglanti + satilmis laptop + kayit bilgisi
  const bad = priceFeed.renderPage(feed, business, {
    phoneUrls: new Map([...links.phoneUrls, ["xiaomi-redmi-17-8-256", `${O}/urun/xiaomi-redmi-17-8-256/`]]),
    laptops: [{ name: "ACER NITRO", price: 20000, url: `${O}/laptop/acer-nitro-pc-008/` }],
  }).replace("</main>", "<p>Kayıtsız</p></main>");
  const errs = priceFeed.verifyPage(bad, feed, dir).join("\n");
  assert.match(errs, /olmayan urun sayfasina baglanti: xiaomi-redmi-17/);
  assert.match(errs, /JSON-LD adresi yanlis: xiaomi-redmi-17/);
  assert.match(errs, /satilmis \(noindex\) laptop listede: acer-nitro-pc-008/);
  assert.match(errs, /IMEI\/kayit/);
  // fiyat degismis sayfa
  const wrongPrice = good.replace("14.500 TL", "14.900 TL");
  assert.ok(priceFeed.verifyPage(wrongPrice, feed, dir).some((e) => /fiyat uyumsuz: xiaomi-redmi-15/.test(e)));
});

test("gercek depo: baglantilar urun sayfasi ureticisinin adresleriyle ayni; laptop listesi yalniz stoktaki ve sayfasi olanlar", () => {
  const html = fs.readFileSync(path.join(root, "fiyat-listesi", "index.html"), "utf8");
  const feed = JSON.parse(fs.readFileSync(path.join(root, "feed", "products.json"), "utf8"));
  assert.deepEqual(priceFeed.verifyPage(html, feed, root), []);
  const pp = require("../generate-product-pages");
  const { pages } = pp.pageModels(root);
  const expected = pages.filter((pg) => pg.kind === "laptop" && !pg.sold && pg.stock === "IN" && typeof pg.price === "number" && pg.price > 0
    && fs.existsSync(path.join(root, "laptop", pg.slug, "index.html"))).map((pg) => `/laptop/${pg.slug}/`).sort();
  const listed = [...html.matchAll(/href="(\/laptop\/[a-z0-9-]+\/)"/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, expected);
  const phoneLinks = [...html.matchAll(/<a href="\/urun\/([a-z0-9-]+)\/">/g)].map((m) => m[1]);
  const phoneSlugs = new Set(pages.filter((pg) => pg.kind === "phone").map((pg) => pg.slug));
  assert.ok(phoneLinks.length > 0 && phoneLinks.every((s) => phoneSlugs.has(s)));
});
