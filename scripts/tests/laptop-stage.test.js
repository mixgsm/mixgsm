// Laptop fotograf sahnesi (manifest dogrulama + sitedeki tek gorsel secim
// noktasi) ve stok grubu (satilan modeller) regresyon testleri.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const vm = require("vm");
const { checkLaptopStage, sha16 } = require("../lib/laptop-stage");
const { readAppSource } = require("../asset-version");

const root = path.join(__dirname, "..", "..");
const source = readAppSource(root);
function fnSrc(start) {
  const i = source.indexOf(start);
  assert.ok(i >= 0, "site kodunda bulunamadi: " + start);
  return source.slice(i, source.indexOf("\n}\n", i) + 3);
}
function constSrc(start) {
  const i = source.indexOf(start);
  assert.ok(i >= 0, "site kodunda bulunamadi: " + start);
  return source.slice(i, source.indexOf(";\n", i) + 2);
}

function fixture() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "stage-"));
  fs.mkdirSync(path.join(dir, "laptop-photos", "images"), { recursive: true });
  fs.mkdirSync(path.join(dir, "laptop-photos", "stage"), { recursive: true });
  const src = path.join(dir, "laptop-photos", "images", "PC-001-01.jpg");
  fs.writeFileSync(src, "foto-v1");
  ["PC-001-01.sm.webp", "PC-001-01.lg.webp"].forEach((f) => fs.writeFileSync(path.join(dir, "laptop-photos", "stage", f), "x"));
  const manifest = { version: 1, files: { "PC-001-01.jpg": { sha256: sha16(src), type: "cut", bg: "none", sm: "PC-001-01.sm.webp", lg: "PC-001-01.lg.webp" } } };
  fs.writeFileSync(path.join(dir, "laptop-photos", "stage", "manifest.json"), JSON.stringify(manifest));
  return { dir, src };
}

test("sahne manifesti: tutarliysa hata yok; kaynak degisirse veya turev eksikse HATA; yeni foto yalniz uyari", () => {
  const { dir, src } = fixture();
  assert.deepEqual(checkLaptopStage(dir), { errors: [], warnings: [] });
  fs.writeFileSync(path.join(dir, "laptop-photos", "images", "PC-002-01.jpg"), "yeni");
  assert.equal(checkLaptopStage(dir).warnings.length, 1);
  fs.writeFileSync(src, "foto-v2-degisti");
  assert.match(checkLaptopStage(dir).errors.join("\n"), /degismis ama sahne turevi eski: PC-001-01\.jpg/);
  fs.writeFileSync(src, "foto-v1");
  fs.unlinkSync(path.join(dir, "laptop-photos", "stage", "PC-001-01.lg.webp"));
  assert.match(checkLaptopStage(dir).errors.join("\n"), /sahne turevi eksik: PC-001-01\.jpg \(lg\)/);
});

test("sahne manifesti: ayni adli farkli uzantili iki fotograf ayni turevi paylasamaz (PC-021 .jpg/.webp)", () => {
  const { dir } = fixture();
  const img = path.join(dir, "laptop-photos", "images", "PC-001-01.webp");
  fs.writeFileSync(img, "baska-foto");
  const mp = path.join(dir, "laptop-photos", "stage", "manifest.json");
  const m = JSON.parse(fs.readFileSync(mp, "utf8"));
  m.files["PC-001-01.webp"] = { sha256: sha16(img), type: "cut", bg: "none", sm: "PC-001-01.sm.webp", lg: "PC-001-01.lg.webp" };
  fs.writeFileSync(mp, JSON.stringify(m));
  assert.match(checkLaptopStage(dir).errors.join("\n"), /ayni sahne turevini paylasiyor: PC-001-01\.jpg ve PC-001-01\.webp/);
});

test("depodaki gercek sahne manifesti kaynak fotograflarla tutarli", () => {
  assert.deepEqual(checkLaptopStage(root).errors, []);
});

const stageApi = vm.runInNewContext(
  "const LAPTOP_FALLBACK_IMAGE = 'https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/gorsel-yok.jpg';\n" +
  fnSrc("function escapeHtml(") +
  constSrc("const LAPTOP_STAGE_BASE =") + constSrc("const LAPTOP_IMAGES_PREFIX =") + constSrc("const LAPTOP_STAGE_FILE =") +
  "let laptopStage = new Map();\n" +
  fnSrc("function sanitizeLaptopStage(") + fnSrc("function laptopStageImage(") + fnSrc("function laptopStageImgAttrs(") +
  ";({ sanitizeLaptopStage, laptopStageImage, laptopStageImgAttrs, set: (m) => { laptopStage = m; } })", {});

const IMG = "https://raw.githubusercontent.com/mixgsm/mixgsm/main/laptop-photos/images/";

test("sahne secimi: turev varsa ayni kaynaktan kucuk/buyuk turev + orijinal yedek; yoksa orijinal (beyaz zemin)", () => {
  stageApi.set(stageApi.sanitizeLaptopStage({ files: {
    "PC-001-01.jpg": { type: "cut", sm: "PC-001-01.sm.webp", lg: "PC-001-01.lg.webp" },
    "PC-008-02.jpg": { type: "opaque", bg: "scene", sm: "PC-008-02.sm.webp", lg: "PC-008-02.lg.webp" },
    "PC-012-03.jpg": { type: "opaque", bg: "white", sm: "PC-012-03.sm.webp", lg: "PC-012-03.lg.webp" },
    "__proto__": { type: "cut", sm: "x.sm.webp", lg: "x.lg.webp" },
    "kotu.jpg": { type: "cut", sm: "../index.html", lg: "javascript:alert(1)" },
    "tur.jpg": { type: "silinmis", sm: "a.sm.webp", lg: "a.lg.webp" },
  } }));
  assert.deepEqual({ ...stageApi.laptopStageImage(IMG + "PC-001-01.jpg", "sm") },
    { src: "laptop-photos/stage/PC-001-01.sm.webp", orig: IMG + "PC-001-01.jpg", kind: "cut" });
  assert.equal(stageApi.laptopStageImage(IMG + "PC-001-01.jpg", "lg").src, "laptop-photos/stage/PC-001-01.lg.webp");
  assert.equal(stageApi.laptopStageImage(IMG + "PC-008-02.jpg", "sm").kind, "scene");
  assert.equal(stageApi.laptopStageImage(IMG + "PC-012-03.jpg", "sm").kind, "white");
  // manifestte olmayan / gecersiz girdi: orijinal, beyaz zemin muamelesi
  ["PC-099-01.jpg", "kotu.jpg", "tur.jpg", "__proto__"].forEach((n) => {
    assert.deepEqual({ ...stageApi.laptopStageImage(IMG + n, "sm") }, { src: IMG + n, orig: "", kind: "white" }, n);
  });
  // bos URL: "gorsel yok"
  assert.match(stageApi.laptopStageImage("", "sm").src, /gorsel-yok\.jpg$/);
  // isaretleme: kacisli, yedek orijinal data-orig'de
  assert.equal(stageApi.laptopStageImgAttrs(IMG + "PC-001-01.jpg", "sm"),
    'src="laptop-photos/stage/PC-001-01.sm.webp" data-stage="cut" data-orig="' + IMG + 'PC-001-01.jpg"');
});

const soldApi = vm.runInNewContext(
  "const fmt = n => n.toLocaleString('tr-TR');\n" +
  fnSrc("function laptopUnit(") + fnSrc("function isLaptopSold(") + fnSrc("function laptopStockSummary(") +
  constSrc("const LAPTOP_FORM_USAGE_MAP =") + fnSrc("function laptopFormMatches(") + fnSrc("function buildLaptopSoldWaMessage(") +
  ";({ isLaptopSold, laptopStockSummary, laptopFormMatches, buildLaptopSoldWaMessage })", {});

test("stok grubu: yalniz OUT satilan; ASK (Sorunuz) satilmis sayilmaz; ozet sayilari", () => {
  assert.equal(soldApi.isLaptopSold({ stock: "OUT" }), true);
  assert.equal(soldApi.isLaptopSold({ stock: "IN" }), false);
  assert.equal(soldApi.isLaptopSold({ stock: "ASK" }), false);
  assert.equal(soldApi.isLaptopSold(null), false);
  assert.equal(soldApi.laptopStockSummary([{ stock: "IN" }, { stock: "ASK" }, { stock: "OUT" }]), "2 laptop stokta · 1 satılan model.");
});

test("Bana Laptop Bul: satilmis/stokta olmayan laptop ASLA onerilmez", () => {
  const list = [
    { id: "A", brand: "ACER", model: "NITRO", stock: "OUT", price: 30000, usage: "Gaming", condition: "USED" },
    { id: "B", brand: "ACER", model: "NITRO 5", stock: "IN", price: 34000, usage: "Gaming", condition: "USED" },
    { id: "C", brand: "HP", model: "VICTUS", stock: "ASK", price: 31000, usage: "Gaming", condition: "USED" },
  ];
  const got = soldApi.laptopFormMatches({ budget: 50000, usage: "Oyun", condition: "", brand: "" }, list).map((m) => m.p.id);
  assert.deepEqual(got, ["B"]);
});

test("satilan model WhatsApp mesaji stok vaadi icermez, benzerini sorar", () => {
  const msg = soldApi.buildLaptopSoldWaMessage({ id: "PC-003", brand: "LENOVO", model: "IDEAPAD 3" });
  assert.equal(msg, "Merhaba İsa Bey, sitede satıldı olarak görünen LENOVO IDEAPAD 3 (Ürün kodu: PC-003) modeline benzer, stokta olan bir laptop var mı?");
});
