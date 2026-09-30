// Site kodundaki (js/app.<hash>.js) performans önbellekleri ve güvenlik
// sertleştirmeleri için regresyon testleri. Kod vm içinde, tarayıcı olmadan
// çalıştırılır; yalnız saf (DOM'a dokunmayan) bölümler yüklenir.
"use strict";

const test = require("node:test");
const assert = require("node:assert");
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { readAppSource } = require("../asset-version");

const root = path.join(__dirname, "..", "..");
const source = readAppSource(root);

function section(start, end) {
  const i = source.indexOf(start);
  const j = source.indexOf(end, i);
  assert.ok(i >= 0 && j > i, `site kodunda bolum bulunamadi: ${start}`);
  return source.slice(i, j);
}

test("escapeHtml HTML ve oznitelik icin tehlikeli karakterlerin hepsini kacirir", () => {
  const code = section("function escapeHtml(", "\n}\n") + "\n}\n;escapeHtml";
  const escapeHtml = vm.runInNewContext(code, {});
  assert.equal(escapeHtml(`<img src=x onerror="a('b')">&`), "&lt;img src=x onerror=&quot;a(&#39;b&#39;)&quot;&gt;&amp;");
  assert.equal(escapeHtml(null), "");
  assert.equal(escapeHtml(0), "0");
});

test("gorsel eslestirme onbellegi sonuclari degistirmez (onbellekli = ham)", () => {
  const code = section("function normalizeGithubImageUrl(", "function tryNextProductImage(") +
    "\n;({ imageFileScore, imageFileScoreRaw, imageCandidatesForProduct, imageCandidatesForProductRaw," +
    " files: GITHUB_PHOTO_FILES, setExtra: (f) => { EXTRA_PHOTO_FILES = f; } })";
  const api = vm.runInNewContext(code, {});
  const products = JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8")).products;
  const extra = fs.readdirSync(path.join(root, "photos"))
    .filter((f) => /\.(jpg|jpeg|png|webp)$/i.test(f) && !api.files.some((s) => s.toLowerCase() === f.toLowerCase()));
  api.setExtra(extra);
  const files = Array.from(api.files).concat(extra);
  // Iki tur: ikinci turda degerler onbellekten gelir.
  for (let round = 0; round < 2; round++) {
    products.forEach((p) => {
      files.forEach((f) => assert.equal(api.imageFileScore(p, f), api.imageFileScoreRaw(p, f), `${p.b} ${p.m} / ${f}`));
      assert.deepStrictEqual(Array.from(api.imageCandidatesForProduct(p)), Array.from(api.imageCandidatesForProductRaw(p)));
    });
  }
  // Donen dizi kopya: cagiran degistirse de onbellek bozulmaz.
  const p = products[0];
  const first = api.imageCandidatesForProduct(p);
  first.length = 0;
  assert.ok(api.imageCandidatesForProduct(p).length > 0);
});

test("favoriler yalnizca makul metin anahtarlarla yuklenir", () => {
  const code = section("const favKey =", "// GUVENLIK/DAYANIKLILIK: localStorage.setItem") + ";favs";
  const run = (stored) => vm.runInNewContext(code, {
    localStorage: { getItem: () => stored },
  });
  assert.deepStrictEqual(Array.from(run(JSON.stringify(["A|B|C", "A|B|C", 5, null, {}, "x".repeat(301), ""]))), ["A|B|C"]);
  assert.deepStrictEqual(Array.from(run("{bozuk")), []);
  assert.deepStrictEqual(Array.from(run(JSON.stringify({ a: 1 }))), []);
  assert.equal(run(JSON.stringify(Array.from({ length: 500 }, (_, i) => "k" + i))).length, 200);
});

test("WhatsApp urun mesaji onerilen bicimde ve yalniz katalog verisinden", () => {
  const helper = section("function productWhatsappText(", "\n}\n") + "\n}\n";
  const laptop = section("function buildLaptopWaMessage(", "\n}\n") + "\n}\n";
  const api = vm.runInNewContext(helper + laptop + ";({ productWhatsappText, buildLaptopWaMessage })", {});
  assert.equal(api.productWhatsappText("XIAOMI  POCO X8 PRO - 12 GB / 512 GB "),
    "Merhaba İsa Bey, XIAOMI POCO X8 PRO - 12 GB / 512 GB için güncel stok ve fiyat bilgisi alabilir miyim?");
  assert.equal(api.buildLaptopWaMessage({ id: "PC-001", brand: "ACER", model: "NITRO 5", ramGB: "16", ssdGB: "1 TB NVMe" }),
    "Merhaba İsa Bey, ACER NITRO 5 - 16 GB RAM / 1 TB NVMe (Ürün kodu: PC-001) için güncel stok ve fiyat bilgisi alabilir miyim?");
  // Bos alanlar icin tahmin/uydurma deger eklenmez.
  assert.equal(api.buildLaptopWaMessage({ brand: "HP", model: "VICTUS" }),
    "Merhaba İsa Bey, HP VICTUS için güncel stok ve fiyat bilgisi alabilir miyim?");
  // Telefon penceresi de ayni yardimciyi kullanir.
  assert.ok(/productWhatsappText\(`\$\{p\.b\} \$\{p\.m\}`/.test(source));
});
