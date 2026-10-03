// Google Sheets TSV ayristirici: tirnakli hucre, hucre ici satir sonu/sekme.
// Uretim betikleri (scripts/lib/tsv.js) ve sitedeki Sheets yedegi
// (js/app.<hash>.js parseTsvRows) AYNI kurali kullanmali.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const vm = require("vm");
const { parseTsvRows, cleanCell } = require("../lib/tsv");
const { readAppSource } = require("../asset-version");
const { parseTsvToProducts } = require("../generate-catalog");
const { parseTsvToLaptopProducts } = require("../generate-catalog-laptop");
const path = require("path");

const source = readAppSource(path.join(__dirname, "..", ".."));
function appFn(start) {
  const i = source.indexOf(start);
  assert.ok(i >= 0, "site kodunda bulunamadi: " + start);
  const j = source.indexOf("\n}\n", i);
  return source.slice(i, j + 3);
}
const app = vm.runInNewContext(appFn("function parseTsvRows(") + appFn("function cleanCell(") + ";({ parseTsvRows, cleanCell })", {});

const CASES = [
  "a\tb\tc\n1\t2\t3",
  "a\tb\r\n1\t2\r\n",
  'x\t"cok\nsatirli"\ty\nz\t2\t3',
  'x\t"tirnak ""ic"""\ty',
  'x\t"sekme\ticeren"\ty',
  'x\t"kapanmayan tirnak\ty\nz\tw',
  'x\t"a"b\ty',
  "\n\na\t\n",
  "",
  "﻿MARKA\tMODEL\nAPPLE\tIPHONE 17",
];

test("ayristirici: site kopyasi uretim betigiyle birebir ayni sonucu verir", () => {
  CASES.forEach((c) => assert.deepEqual(JSON.parse(JSON.stringify(app.parseTsvRows(c))), parseTsvRows(c), JSON.stringify(c)));
  ["  a \r\n b ", "a\n\n\n\nb", null, 5].forEach((c) => {
    assert.equal(app.cleanCell(c), cleanCell(c));
    assert.equal(app.cleanCell(c, true), cleanCell(c, true));
  });
});

test("tirnakli hucre: satir sonu ve sekme sutun kaydirmaz, \"\" kacisi cozulur", () => {
  assert.deepEqual(parseTsvRows('x\t"cok\nsatirli"\ty\nz\t2\t3'), [["x", "cok\nsatirli", "y"], ["z", "2", "3"]]);
  assert.deepEqual(parseTsvRows('x\t"sekme\ticeren"\ty'), [["x", "sekme\ticeren", "y"]]);
  assert.deepEqual(parseTsvRows('x\t"tirnak ""ic"""\ty'), [["x", 'tirnak "ic"', "y"]]);
  assert.deepEqual(parseTsvRows("a\tb\r\n1\t2\r\n"), [["a", "b"], ["1", "2"]]);
});

test("bozuk tirnak dosyanin geri kalanini yutmaz (duz metin sayilir)", () => {
  assert.deepEqual(parseTsvRows('x\t"kapanmayan tirnak\ty\nz\tw'), [["x", '"kapanmayan tirnak', "y"], ["z", "w"]]);
  assert.deepEqual(parseTsvRows('x\t"a"b\ty'), [["x", '"a"b', "y"]]);
});

test("cleanCell: tek satirlik alanlarda satir sonu bosluga iner, aciklamada korunur", () => {
  assert.equal(cleanCell(" 12 GB /\r\n 256 GB "), "12 GB / 256 GB");
  assert.equal(cleanCell("Satir 1\r\nSatir 2", true), "Satir 1\nSatir 2");
});

const PHONE_HEADER = ["MARKA", "MODEL", "RAM-HAFIZA", "FİYAT", "STOK", "KATEGORİ", "RESİM", "BATARYA", "EKRAN",
  "İŞLEMCİ", "KAMERA", "BAĞLANTI", "KAYIT DURUMU", "GARANTİ", "ETİKET"].join("\t");

test("telefon katalogu: cok satirli hucre fiyat/stok sutunlarini kaydirmaz", () => {
  const row = ["XIAOMI", '"POCO X8\nPRO"', '"12 GB /\n512 GB"', "28.000", "VAR", "", "", "6500 mAh", "", "", "", "", "", "", "Fırsat"].join("\t");
  const [p] = parseTsvToProducts(PHONE_HEADER + "\n" + row);
  assert.equal(p.m, "POCO X8 PRO");
  assert.equal(p.s, "12 GB / 512 GB");
  assert.equal(p.p, 28000);
  assert.equal(p.stock, "IN");
  assert.equal(p.battery, "6500 mAh");
  assert.equal(p.tagLabel, "Fırsat");
});

test("laptop katalogu: aciklama cok satirli kalir, fotograf sutunlari kaymaz", () => {
  const head = ["ID", "Durum", "Marka", "Model"].concat(Array(33).fill("x")).join("\t");
  const cols = ["PC-9", "2. El", "HP", "Victus"].concat(Array(33).fill(""));
  cols[24] = "41.500";
  cols[27] = "AKTİF";
  cols[29] = '"Ilk satir\nIkinci satir"';
  cols[30] = "images/PC-9-01.jpg";
  const [p] = parseTsvToLaptopProducts(head + "\n" + cols.join("\t"));
  assert.equal(p.description, "Ilk satir\nIkinci satir");
  assert.equal(p.price, 41500);
  assert.equal(p.stock, "IN");
  assert.equal(p.img, "https://raw.githubusercontent.com/mixgsm/mixgsm/main/laptop-photos/images/PC-9-01.jpg");
});
