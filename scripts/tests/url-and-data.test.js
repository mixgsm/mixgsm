// Paylasilabilir filtre URL'si, gorsel URL izin listesi ve katalog dogrulama
// (js/app.<hash>.js). Kod vm icinde, tarayici olmadan calistirilir.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { readAppSource } = require("../asset-version");

const root = path.join(__dirname, "..", "..");
const source = readAppSource(root);
function fnSrc(start, endMarker = "\n}\n") {
  const i = source.indexOf(start);
  assert.ok(i >= 0, "site kodunda bulunamadi: " + start);
  const j = source.indexOf(endMarker, i);
  return source.slice(i, j + endMarker.length);
}
function constSrc(start) {
  const i = source.indexOf(start);
  assert.ok(i >= 0, "site kodunda bulunamadi: " + start);
  return source.slice(i, source.indexOf(";\n", i) + 2);
}

const urlApi = vm.runInNewContext(
  constSrc("const PHONE_CAT_VALUES =") + constSrc("const URL_SORTS =") + constSrc("const URL_LAPTOP_SORTS =") +
  constSrc("const URL_TEXT_MAX =") + constSrc("const URL_PRICE_MAX =") +
  fnSrc("function cleanUrlText(") + fnSrc("function cleanUrlPrice(") + fnSrc("function readUrlFilterState(") +
  ";({ readUrlFilterState })", { URLSearchParams });

test("URL filtreleri: gecerli degerler okunur", () => {
  const st = urlApi.readUrlFilterState("?ara=iphone%2017&marka=APPLE&kategori=PHONE&sira=low&min=10000&max=60000");
  assert.equal(st.q, "iphone 17");
  assert.equal(st.cat, "APPLE");
  assert.equal(st.group, "PHONE");
  assert.equal(st.sort, "low");
  assert.equal(st.priceMin, 10000);
  assert.equal(st.priceMax, 60000);
  assert.equal(st.store, "phone");
  const lt = urlApi.readUrlFilterState("?magaza=laptop&lara=rtx&lmarka=ACER&ldurum=USED&lsira=deal&lmax=40000");
  assert.equal(lt.store, "laptop");
  assert.equal(lt.lq, "rtx");
  assert.equal(lt.lbrand, "ACER");
  assert.equal(lt.lcond, "USED");
  assert.equal(lt.lsort, "deal");
  assert.equal(lt.lmax, 40000);
});

test("URL filtreleri: izin disi / zararli / asiri degerler varsayilana doner", () => {
  const st = urlApi.readUrlFilterState(
    "?marka=%3Cscript%3E&kategori=X&sira=__proto__&min=-5&max=99999999&magaza=javascript&lmarka=acer%22%3E&ldurum=OLD&lsira=x&lmin=1e5");
  assert.equal(st.cat, "ALL");
  assert.equal(st.group, "ALL");
  assert.equal(st.sort, "default");
  assert.equal(st.priceMin, null);
  assert.equal(st.priceMax, null);
  assert.equal(st.store, "phone");
  assert.equal(st.lbrand, "ALL");
  assert.equal(st.lcond, "ALL");
  assert.equal(st.lsort, "default");
  assert.equal(st.lmin, null);
  // Arama metni: kontrol karakteri ve < > atilir, uzunluk sinirli.
  const long = urlApi.readUrlFilterState("?ara=" + encodeURIComponent("<img src=x>\u0000" + "a".repeat(200)));
  assert.ok(!/[<>\u0000]/.test(long.q));
  assert.ok(long.q.length <= 60);
  // Bozuk kodlama site akisini kirmaz.
  assert.doesNotThrow(() => urlApi.readUrlFilterState("?ara=%E0%A4%A"));
});

const imgApi = vm.runInNewContext(
  fnSrc("function normalizeGithubImageUrl(") + fnSrc("function normalizeLaptopGithubImageUrl(") +
  ";({ normalizeGithubImageUrl, normalizeLaptopGithubImageUrl })", {});

test("gorsel URL izin listesi: javascript:, data:, http:, baska depo ve klasor disi yollar reddedilir", () => {
  const bad = [
    "javascript:alert(1)", " JAVASCRIPT:alert(1)", "data:image/svg+xml;base64,PHN2Zz4=", "http://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/A.jpg",
    "https://raw.githubusercontent.com/baska/depo/main/photos/A.jpg", "https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/../index.html",
    "https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/A.jpg\" onerror=\"x", "//evil.example/a.jpg", "images/../../x.jpg", "images/a/b.jpg",
  ];
  bad.forEach((u) => {
    assert.equal(imgApi.normalizeGithubImageUrl(u), "", u);
    assert.equal(imgApi.normalizeLaptopGithubImageUrl(u), "", u);
  });
  assert.equal(imgApi.normalizeGithubImageUrl("https://github.com/mixgsm/mixgsm/blob/main/photos/MI-17.jpg"),
    "https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/MI-17.jpg");
  assert.equal(imgApi.normalizeLaptopGithubImageUrl("images/PC-001-01.jpg"),
    "https://raw.githubusercontent.com/mixgsm/mixgsm/main/laptop-photos/images/PC-001-01.jpg");
});

test("katalog dogrulama: yalniz baslik satirlari gecerli katalog sayilmaz; bos laptop satiri elenir", () => {
  const ctx = vm.runInNewContext(
    fnSrc("function normalizeTRRaw(") + "function normalizeTR(v){return normalizeTRRaw(v)}\n" +
    fnSrc("function isNonProductRow(") + fnSrc("function hasRealPhoneProduct(") +
    "const toText = v => typeof v === 'string' ? v : '';\nconst toPrice = (v,a,b) => Number.isInteger(v)&&v>=a&&v<=b ? v : null;\nconst toStock = v => ['IN','OUT','ASK'].includes(v) ? v : 'ASK';\n" +
    "const LAPTOP_PRICE_MIN = 1000, LAPTOP_PRICE_MAX = 500000;\nconst normalizeLaptopGithubImageUrl = () => '';\n" +
    constSrc("const LAPTOP_TEXT_FIELDS =") + constSrc("const LAPTOP_IMAGE_FIELDS =") +
    fnSrc("function sanitizeLaptopProduct(") + fnSrc("function sanitizeLaptopList(") +
    ";({ hasRealPhoneProduct, sanitizeLaptopList })", {});
  assert.equal(ctx.hasRealPhoneProduct([{ b: "⚡ MIX GSM • GÜNCEL VİTRİN", m: "" }, { b: "MARKA", m: "MODEL / ÜRÜN TANIMI" }]), false);
  assert.equal(ctx.hasRealPhoneProduct([]), false);
  assert.equal(ctx.hasRealPhoneProduct([{ b: "XIAOMI", m: "POCO X8 PRO" }]), true);
  const list = ctx.sanitizeLaptopList([{ brand: "", model: "" }, null, 5, { brand: "ACER", model: "NITRO 5", price: 34000, stock: "IN" }]);
  assert.equal(list.length, 1);
  assert.equal(list[0].price, 34000);
});

test("katalog zamani: yalniz gecerli ve gelecekte olmayan ISO zaman gosterilir", () => {
  const ctx = vm.runInNewContext(fnSrc("function toCatalogTime(") + ";({ toCatalogTime })", {});
  assert.equal(ctx.toCatalogTime("2026-10-02T09:11:48.768Z"), "2026-10-02T09:11:48.768Z");
  ["", null, "dun", "2026-13-45T99:99", 1790000000000, new Date(Date.now() + 864e5).toISOString(), "2019-01-01T00:00:00Z"]
    .forEach((v) => assert.equal(ctx.toCatalogTime(v), null, String(v)));
});

test("900px siniri: laptop masaustu duzeni 901px'te baslar (mobil cekmece kurallariyla cakismaz)", () => {
  const html = fs.readFileSync(path.join(root, "index.html"), "utf8");
  // Laptop yan sutunu/sticky panel hangi medya kosulunda?
  const m = html.match(/@media\s*\(min-width:\s*(\d+)px\)\s*\{\s*#laptop-section \.laptop-catalog-layout \{ grid-template-columns: 240px 1fr;/);
  assert.ok(m, "laptop masaustu duzen kurali bulunamadi");
  assert.equal(m[1], "901");
  const phone = html.match(/@media\s*\(min-width:\s*(\d+)px\)\s*\{\s*\.catalog-layout \{ grid-template-columns: 220px 1fr;/);
  assert.ok(phone && phone[1] === "901");
  // Cekmece kurallari max-width: 900px
  assert.ok(/@media \(max-width: 900px\) \{\s*#laptop-section \.laptop-filter-drawer-backdrop\.open/.test(html));
});

test("takas: sitede takas teklifi/tanitimi veya takasli yorum yok (yalniz 'takas yok' bilgisi serbest)", () => {
  // MİX GSM takas yapmaz. Serbest olan TEK ifade: takas YAPILMADIGINI soyleyen
  // onayli SSS soru/cevabi (gorunur + JSON-LD) ve laptop ozetindeki cumle.
  // Bunlar cikarildiktan sonra 'takas' gecen baska hicbir sey kalmamali.
  const ALLOWED = [
    "Eski cihazımı getirip takas yapabilir miyim?",
    "Hayır, işletmemizde ikinci el telefon alım-satımı veya takas (trade-in) işlemi yapılmamaktadır.",
    "Takas seçeneğimiz yoktur."
  ];
  const strip = (txt) => ALLOWED.reduce((acc, a) => acc.split(a).join(""), txt);
  const html = strip(fs.readFileSync(path.join(root, "index.html"), "utf8").replace(/<!--[\s\S]*?-->/g, ""));
  assert.ok(!/takas/i.test(html), "index.html'de onaysiz 'takas' gecen gorunur icerik var");
  const code = strip(source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, ""));
  assert.ok(!/takas/i.test(code), "site kodunda onaysiz 'takas' metni var");
  // Onayli bilgi gercekten yerinde mi: SSS (gorunur + JSON-LD) ve laptop ozeti.
  const raw = fs.readFileSync(path.join(root, "index.html"), "utf8");
  assert.equal(raw.split(ALLOWED[0]).length - 1, 2, "SSS takas sorusu hem gorunur hem JSON-LD'de olmali");
  assert.ok(source.includes(ALLOWED[2]), "laptop ozetinde 'Takas seçeneğimiz yoktur.' olmali");
});
