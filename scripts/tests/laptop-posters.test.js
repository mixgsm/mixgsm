// Afiş vitrini: laptop-photos/afis/<ID>.<uzantı> dosyalarının ürüne bağlanması
// node --test scripts/tests/laptop-posters.test.js
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { posterFileFor, withPosters } = require("../generate-catalog-laptop");

const FILES = ["PC-063.webp", "PC-066.jpg", "PC-066.webp", "pc-070.WEBP", "PC-071.gif", "PC-07.webp", "PC-0710.webp", "PC-072 kopya.webp", "notlar.txt"];

test("ID ile birebir aynı adlı dosya bulunur; webp önceliklidir; büyük/küçük harf fark etmez", () => {
  assert.equal(posterFileFor("PC-063", FILES), "laptop-photos/afis/PC-063.webp");
  assert.equal(posterFileFor("PC-066", FILES), "laptop-photos/afis/PC-066.webp");
  assert.equal(posterFileFor("PC-070", FILES), "laptop-photos/afis/pc-070.WEBP");
});

test("benzer ID'ler, desteklenmeyen uzantılar, boşluklu adlar ve boş ID eşleşmez", () => {
  assert.equal(posterFileFor("PC-071", FILES), "");
  assert.equal(posterFileFor("PC-072", FILES), "");
  assert.equal(posterFileFor("PC-0", FILES), "");
  assert.equal(posterFileFor("", FILES), "");
  assert.equal(posterFileFor("../PC-063", FILES), "");
});

test("afişi olan ürüne poster eklenir, olmayana dokunulmaz, liste değiştirilmez", () => {
  const list = [{ id: "PC-063", brand: "HP" }, { id: "PC-099", brand: "ACER" }];
  const out = withPosters(list, FILES);
  assert.equal(out[0].poster, "laptop-photos/afis/PC-063.webp");
  assert.deepEqual(out[1], list[1]);
  assert.equal(list[0].poster, undefined);
});
