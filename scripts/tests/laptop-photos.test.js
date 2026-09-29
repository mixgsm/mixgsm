// Laptop fotoğraflarının laptop-photos/images/ klasöründen otomatik bulunması
// node --test scripts/tests/laptop-photos.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { autoLaptopPhotos, withAutoPhotos } = require("../generate-catalog-laptop");

const BASE = "https://raw.githubusercontent.com/mixgsm/mixgsm/main/laptop-photos/images/";
const FILES = [
  "PC-035-01.jpg", "PC-035-02.jpg", "PC-035-03.jpg", "PC-035-04.jpg", "PC-035-005.webp", "PC-035-06.webp",
  "PC-036-01.webp", "PC-036-05.jpg", "PC-036-02.webp",
  "PC-03-01.jpg", "PC-0350-01.jpg", "PC-035-kapak.jpg", "PC-035-07.gif", "PC-035-08 kopya.jpg",
];
const EMPTY_IMAGES = { img: "", img2: "", img3: "", img4: "", img5: "", img6: "" };
const laptop = (id, over) => ({ id, brand: "HP", model: "X", ...EMPTY_IMAGES, ...over });

test("ID'ye ait dosyalar sıra numarasına göre (005 = 5) en fazla 6 tane bulunur", () => {
  assert.deepEqual(autoLaptopPhotos("PC-035", FILES), [
    "PC-035-01.jpg", "PC-035-02.jpg", "PC-035-03.jpg", "PC-035-04.jpg", "PC-035-005.webp", "PC-035-06.webp",
  ].map((f) => BASE + f));
  assert.deepEqual(autoLaptopPhotos("PC-036", FILES), ["PC-036-01.webp", "PC-036-02.webp", "PC-036-05.jpg"].map((f) => BASE + f));
});

test("benzer ID'ler (PC-03, PC-0350), numarasız/boşluklu adlar ve desteklenmeyen uzantılar karışmaz", () => {
  assert.deepEqual(autoLaptopPhotos("PC-03", FILES), [BASE + "PC-03-01.jpg"]);
  assert.deepEqual(autoLaptopPhotos("PC-0350", FILES), [BASE + "PC-0350-01.jpg"]);
  assert.deepEqual(autoLaptopPhotos("PC-099", FILES), []);
  assert.deepEqual(autoLaptopPhotos("", FILES), []);
});

test("Sheet'te fotoğrafı olan ürüne dokunulmaz; boş olan doldurulur; liste değiştirilmez", () => {
  const sheetImg = BASE + "PC-036-05.jpg";
  const list = [laptop("PC-035"), laptop("PC-036", { img: sheetImg }), laptop("PC-099")];
  const out = withAutoPhotos(list, FILES);

  assert.equal(out[0].img, BASE + "PC-035-01.jpg");
  assert.equal(out[0].img6, BASE + "PC-035-06.webp");
  assert.deepEqual(out[1], list[1]);
  assert.deepEqual(out[2], list[2]);
  assert.equal(list[0].img, "");
});

test("3 fotoğraflı üründe kalan alanlar boş kalır", () => {
  const [p] = withAutoPhotos([laptop("PC-036")], FILES);
  assert.deepEqual([p.img, p.img2, p.img3, p.img4, p.img5, p.img6],
    [BASE + "PC-036-01.webp", BASE + "PC-036-02.webp", BASE + "PC-036-05.jpg", "", "", ""]);
});
