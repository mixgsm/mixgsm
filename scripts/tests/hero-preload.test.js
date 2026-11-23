"use strict";
const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const { heroProducts, apply } = require("../generate-hero-preload");

const ROOT = path.join(__dirname, "..", "..");

test("hero: yalniz stokta, fiyatli, ana sayfa isaretli urunler; ayni model bir kez", () => {
  const list = heroProducts([
    { b: "XIAOMI", m: "POCO F9", p: 100, stock: "IN", home: true, group: "PHONE" },
    { b: "XIAOMI", m: "POCO F9", p: 120, stock: "IN", home: true, group: "PHONE" },
    { b: "XIAOMI", m: "REDMI 15", p: 90, stock: "OUT", home: true, group: "PHONE" },
    { b: "XIAOMI", m: "REDMI 15C", p: 80, stock: "IN", home: false, group: "PHONE" },
  ]);
  assert.deepEqual(list.map((p) => p.m), ["POCO F9"]);
});

test("hero: isaretli urun yoksa en pahali stoktaki telefon", () => {
  const list = heroProducts([
    { b: "XIAOMI", m: "REDMI 15C", p: 80, stock: "IN", group: "PHONE" },
    { b: "SAMSUNG", m: "S25 ULTRA", p: 900, stock: "IN", group: "PHONE" },
  ]);
  assert.equal(list[0].m, "S25 ULTRA");
});

test("hero: index.html'e gorsel + preload yazilir, tekrar uygulamak ayni sonucu verir", () => {
  const html = fs.readFileSync(path.join(ROOT, "index.html"), "utf8");
  const out = apply(html, { src: "photos/A B.jpg", alt: 'X "Y"' });
  assert.match(out, /<img id="heroProductImg" src="photos\/A%20B\.jpg" alt="X &quot;Y&quot;"/);
  assert.equal((out.match(/<!--hero-preload-->/g) || []).length, 1);
  assert.equal(apply(out, { src: "photos/A B.jpg", alt: 'X "Y"' }), out);
  const none = apply(out, null);
  assert.doesNotMatch(none, /hero-preload/);
  assert.match(none, /<img id="heroProductImg" alt="" style="display:none;"/);
});
