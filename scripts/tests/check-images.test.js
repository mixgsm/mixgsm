// scripts/check-images.js birim testleri (node --test scripts/tests/check-images.test.js).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const path = require("path");
const { loadSiteImageMatcher, checkPhoneImages, checkLaptopImages } = require("../check-images");

const INDEX = path.join(__dirname, "..", "..", "index.html");
const matcher = loadSiteImageMatcher(INDEX);
const phone = (b, m, over) => ({ b, m, s: "", p: 1000, stock: "IN", img: "", ...over });

test("index.html'deki gercek eslestirme mantigi yuklenir", () => {
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
  assert.equal(r.broken.length, 1);
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
