// scripts/check-images.js birim testleri (node --test scripts/tests/check-images.test.js).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { loadSiteImageMatcher, checkPhoneImages, checkLaptopImages } = require("../check-images");

const matcher = loadSiteImageMatcher(path.join(__dirname, "..", ".."));
const phone = (b, m, over) => ({ b, m, s: "", p: 1000, stock: "IN", img: "", ...over });

test("site kodundaki (js/app.<hash>.js) gercek eslestirme mantigi yuklenir", () => {
  assert.equal(typeof matcher.candidates, "function");
  assert.ok(matcher.staticFiles.length > 50);
});

test("Pro / Pro Max karismaz (sitedeki mantik aynen kullanilir)", () => {
  const files = matcher.staticFiles;
  const top = (p) => matcher.candidates(p, files)[0];
  assert.match(top(phone("IPHONE", "IPHONE 17 PRO MAX")), /APPLE-IPHONE-17-PRO-MAX\.jpg$/);
  assert.match(top(phone("IPHONE", "IPHONE 17 PRO")), /APPLE-IPHONE-17-PRO\.jpg$/);
  assert.match(top(phone("IPHONE", "IPHONE 15 PRO MAX")), /gorsel-yok\.jpg$/);
});

test("telefon: OK / fallback / depoda olmayan dosya siniflandirilir", () => {
  const repoFiles = ["APPLE-IPHONE-17.jpg", "gorsel-yok.jpg"];
  const list = [
    phone("IPHONE", "IPHONE 17"),
    phone("NOKIA", "3310"),
    phone("IPHONE", "IPHONE 16"),
    { b: "MARKA", m: "MODEL / ÜRÜN TANIMI" },
  ];
  const r = checkPhoneImages(list, matcher, repoFiles);
  assert.equal(r.total, 3);
  assert.equal(r.ok.length, 1);
  assert.equal(r.fallback.length, 1);
  assert.equal(r.broken.length, 1);
  assert.match(r.broken[0], /IPHONE 16/);
});

test("telefon: Sheet'teki G sutunu URL'si depoda yoksa kirik sayilir", () => {
  const url = "https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/YOK.jpg";
  const r = checkPhoneImages([phone("IPHONE", "IPHONE 17", { img: url })], matcher, ["APPLE-IPHONE-17.jpg"]);
  // Sheet görseli ilk adaydır ama artık modelin depodaki görselleri de
  // yedek olarak kalır: ürün kırık görünmez, eksik ilk aday raporlanır.
  assert.equal(r.broken.length, 0);
  assert.equal(r.firstCandidateMissing.length, 1);
  assert.match(r.firstCandidateMissing[0], /YOK\.jpg/);

  const alone = checkPhoneImages([phone("NOKIA", "3310", { img: url })], matcher, ["APPLE-IPHONE-17.jpg"]);
  assert.equal(alone.broken.length, 1);
});

// --- Galeri: aynı modelin sıra numaralı ek fotoğrafları ---
const PH = "https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/";
const files = (list) => list.map((u) => decodeURIComponent(u.slice(PH.length)));

test("galeri: -2 / _3 sıra numaralı fotoğraflar aynı modele eklenir, kardeş modeller eklenmez", () => {
  const repo = ["REDMI-NOTE-14-PRO-PLUS-5G.jpg", "REDMI-NOTE-14-PRO-PLUS-5G-2.jpg", "REDMI-NOTE-14-PRO-PLUS-5G_3.webp",
    "REDMI-NOTE-14-PRO.webp", "REDMI-NOTE-14.webp", "REDMI-NOTE-15-PRO-PLUS-5G.jpg"];
  const got = files(matcher.candidates(phone("XIAOMI", "REDMI NOTE 14 PRO PLUS 5G"), repo));
  assert.equal(got[0], "REDMI-NOTE-14-PRO-PLUS-5G.jpg");
  assert.ok(got.includes("REDMI-NOTE-14-PRO-PLUS-5G-2.jpg"));
  assert.ok(got.includes("REDMI-NOTE-14-PRO-PLUS-5G_3.webp"));
  assert.ok(!got.some((f) => /^REDMI-NOTE-14(-PRO)?\.webp$|NOTE-15/.test(f)), got.join(","));
});

test("galeri: model numarası sıra numarası sanılmaz (Note 14 ≠ Note 14 Pro, Note 15)", () => {
  const repo = ["REDMI-NOTE-14.webp", "REDMI-NOTE-14-2.jpg", "REDMI-NOTE-14-PRO.webp", "REDMI-NOTE-15.jpg"];
  const got = files(matcher.candidates(phone("XIAOMI", "REDMI NOTE 14"), repo));
  assert.deepEqual(got, ["REDMI-NOTE-14.webp", "REDMI-NOTE-14-2.jpg"]);
  const none = files(matcher.candidates(phone("XIAOMI", "REDMI NOTE 13"), repo));
  assert.deepEqual(none, ["gorsel-yok.jpg"]);
});

test("galeri: sabit eşleşmeli (alias) modelde de ek fotoğraflar gelir, Pro Max karışmaz", () => {
  const repo = ["IPHONE-18-PRO.jpg", "APPLE-18-PRO-1.jpg", "APPLE-18-PRO-2.webp", "APPLE-18-PRO-MAX-1.webp", "IPHONE-18-PRO-MAX.jpg"];
  const got = files(matcher.candidates(phone("IPHONE", "IPHONE 18 PRO"), repo));
  assert.equal(got[0], "IPHONE-18-PRO.jpg");
  assert.ok(got.includes("APPLE-18-PRO-1.jpg") && got.includes("APPLE-18-PRO-2.webp"), got.join(","));
  assert.ok(!got.some((f) => /PRO-MAX/.test(f)), got.join(","));
});

test("galeri: 'xiaomi-' önekli yüklemeler doğru Xiaomi modeline bağlanır", () => {
  const repo = ["MI-17.jpg", "xiaomi-17-2.jpg", "xiaomi-17-3.jpg", "xiaomi-17-pro-2.jpg", "MI-17T.jpg", "xiaomi-17t-1.jpg",
    "REDMI-NOTE-17-PRO-MAX.jpg", "xiaomi-redmi-note-17-pro-max-2.jpg", "xiaomi-redmi-note-17-pro-2.jpg"];
  assert.deepEqual(files(matcher.candidates(phone("XIAOMI", "MI 17"), repo)).filter((f) => !/webp$/.test(f)),
    ["MI-17.jpg", "xiaomi-17-2.jpg", "xiaomi-17-3.jpg"]);
  assert.deepEqual(files(matcher.candidates(phone("XIAOMI", "MI 17T"), repo)), ["MI-17T.jpg", "xiaomi-17t-1.jpg"]);
  assert.deepEqual(files(matcher.candidates(phone("XIAOMI", "REDMI NOTE 17 PRO MAX 5G"), repo)),
    ["REDMI-NOTE-17-PRO-MAX.jpg", "xiaomi-redmi-note-17-pro-max-2.jpg"]);
});

test("galeri: ürün adındaki '5G' ile yüklenen ek fotoğraflar eklenir, farklı 5G modeli karışmaz", () => {
  const repo = ["REDMI-NOTE-14-PRO.webp", "REDMI-NOTE-14-PRO-5G-2.jpg", "REDMI-NOTE-14-PRO-5G-3.jpg",
    "REDMI-NOTE-15-PRO.jpg", "REDMI-NOTE-15-PRO-5G.jpg"];
  assert.deepEqual(files(matcher.candidates(phone("XIAOMI", "REDMI NOTE 14 PRO 5G"), repo)),
    ["REDMI-NOTE-14-PRO.webp", "REDMI-NOTE-14-PRO-5G-2.jpg", "REDMI-NOTE-14-PRO-5G-3.jpg"]);
  assert.deepEqual(files(matcher.candidates(phone("XIAOMI", "REDMI NOTE 15 PRO 5G"), repo)), ["REDMI-NOTE-15-PRO-5G.jpg"]);
});

test("galeri: Sheet görseli ilk sırada, alternatifler susmaz, tekrar yok", () => {
  const repo = ["REDMI-NOTE-14-PRO-PLUS-5G.jpg", "REDMI-NOTE-14-PRO-PLUS-5G-2.jpg"];
  const img = PH + "REDMI-NOTE-14-PRO-PLUS-5G-2.jpg";
  const got = files(matcher.candidates(phone("XIAOMI", "REDMI NOTE 14 PRO PLUS 5G", { img }), repo));
  assert.equal(got[0], "REDMI-NOTE-14-PRO-PLUS-5G-2.jpg");
  assert.ok(got.includes("REDMI-NOTE-14-PRO-PLUS-5G.jpg"));
  assert.equal(new Set(got).size, got.length);
});

test("laptop: eksik, buyuk/kucuk harf farkli ve paylasilan gorseller yakalanir", () => {
  const base = "https://raw.githubusercontent.com/mixgsm/mixgsm/main/laptop-photos/images/";
  const repoFiles = ["images/PC-001-01.jpg", "images/PC-002-01.jpg"];
  const list = [
    { id: "PC-001", img: base + "PC-001-01.jpg", img2: base + "PC-001-02.png" },
    { id: "PC-002", img: base + "pc-002-01.jpg" },
    { id: "PC-003", img: base + "PC-001-01.jpg" },
    { id: "PC-004" },
  ];
  const r = checkLaptopImages(list, repoFiles);
  assert.equal(r.total, 4);
  assert.deepEqual(r.noImage, ["PC-004"]);
  assert.ok(r.broken.some((x) => /PC-001-02\.png/.test(x)));
  assert.ok(r.broken.some((x) => /pc-002-01\.jpg/.test(x) && /harf/.test(x)));
  assert.ok(r.shared.some((x) => /PC-001, PC-003/.test(x)));
  assert.equal(r.imagesOk, 2);
});
