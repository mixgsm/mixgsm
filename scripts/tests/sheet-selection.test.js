// Sheet'ten işletme sahibi seçimleri (telefon P "Ana Sayfa", laptop AK "Vitrin")
// node --test scripts/tests/sheet-selection.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { isYes } = require("../lib/catalog-schema");
const { parseTsvToProducts } = require("../generate-catalog");
const { parseTsvToLaptopProducts } = require("../generate-catalog-laptop");

test("isYes: yalnız açık 'evet' değerleri seçim sayılır", () => {
  ["EVET", "Evet", " evet ", "1", "true", "yes"].forEach((v) => assert.equal(isYes(v), true, v));
  ["", "Hayır", "HAYIR", "x", "var", "evet değil", undefined, null].forEach((v) => assert.equal(isYes(v), false, String(v)));
});

const PHONE_HEADER = ["MARKA", "MODEL", "RAM-HAFIZA", "FİYAT", "STOK", "KATEGORİ", "RESİM", "BATARYA", "EKRAN",
  "İŞLEMCİ", "KAMERA", "BAĞLANTI", "KAYIT DURUMU", "GARANTİ", "ETİKET", "ANA SAYFA"].join("\t");
const phoneRow = (model, home) =>
  ["XIAOMI", model, "12 GB / 512 GB", "28.000", "VAR", "", "", "", "", "", "", "", "", "", ""]
    .concat(home === undefined ? [] : [home]).join("\t");

test("telefon: P sütunu 'Ana Sayfa' -> home (sütun yoksa/boşsa false)", () => {
  const tsv = [PHONE_HEADER, phoneRow("MI 17", "EVET"), phoneRow("MI 17 PRO", ""), phoneRow("MI 17T")].join("\n");
  const got = parseTsvToProducts(tsv).map((p) => [p.m, p.home]);
  assert.deepEqual(got, [["MI 17", true], ["MI 17 PRO", false], ["MI 17T", false]]);
});

const LAPTOP_HEADER = ["ID", "Durum", "Marka", "Model"].concat(Array(32).fill("x"), ["VİTRİN"]).join("\t");
const laptopRow = (id, vitrin) => {
  const cols = [id, "2. El", "ACER", "Nitro 5"].concat(Array(32).fill(""));
  cols[24] = "34.000";
  cols[27] = "Var";
  if (vitrin !== undefined) cols[36] = vitrin;
  return cols.join("\t");
};

test("laptop: AK sütunu 'Vitrin' -> showcase (fotoğraf sütunlarından sonra, eski indeksler kaymaz)", () => {
  const tsv = [LAPTOP_HEADER, laptopRow("PC-1", "EVET"), laptopRow("PC-2", "Hayır"), laptopRow("PC-3")].join("\n");
  const got = parseTsvToLaptopProducts(tsv);
  assert.deepEqual(got.map((p) => [p.id, p.showcase]), [["PC-1", true], ["PC-2", false], ["PC-3", false]]);
  assert.equal(got[0].price, 34000);
  assert.equal(got[0].img, "");
});
