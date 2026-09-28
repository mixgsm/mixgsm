// scripts/generate-sitemap.js birim testleri (node --test scripts/tests/sitemap.test.js).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { buildSitemap, istanbulDate } = require("../generate-sitemap");

test("tarih Turkiye saatine gore alinir (UTC gece yarisi sonrasi degil)", () => {
  assert.equal(istanbulDate("2026-09-26T20:59:00Z"), "2026-09-26");
  assert.equal(istanbulDate("2026-09-26T21:01:00Z"), "2026-09-27");
});

test("gecersiz tarih hata verir", () => {
  assert.throws(() => istanbulDate("bozuk"));
});

test("sitemap iki sayfayi ve verilen lastmod'u icerir, gecerli XML iskeleti", () => {
  const xml = buildSitemap("2026-09-26");
  assert.match(xml, /^<\?xml version="1\.0" encoding="UTF-8"\?>/);
  assert.match(xml, /<loc>https:\/\/mixgsm\.tr\/<\/loc>\s*<lastmod>2026-09-26<\/lastmod>/);
  assert.match(xml, /<loc>https:\/\/mixgsm\.tr\/fiyat-listesi\/<\/loc>\s*<lastmod>2026-09-26<\/lastmod>/);
  assert.equal((xml.match(/<url>/g) || []).length, 2);
  assert.match(xml, /<\/urlset>\n$/);
});
