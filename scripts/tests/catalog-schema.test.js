// scripts/lib/catalog-schema.js birim testleri (node --test scripts/tests/).
// Bagimlilik yok: Node 20+ yerlesik test calistiricisi.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const {
  PHONE_COLUMNS,
  LAPTOP_COLUMNS,
  validateHeader,
  findHeaderLine,
  productSlug,
  isNonProductRow,
  validatePhoneCatalog,
  registrationWarnings,
  validateLaptopCatalog,
} = require("../lib/catalog-schema");

const PHONE_HEADER =
  "MARKA \tMODEL \tRAM-HAFIZA\tFİYAT\tSTOK\tKATEGORİ\tRESİM\tBATARYA \tEKRAN\tİŞLEMCİ\tKAMERA\tBAĞLANTI\tKAYIT DURUMU\tGARANTİ\tETİKET\r";
const LAPTOP_HEADER = [
  "ID", "Durum", "Marka", "Model", "İşlemci", "İşlemci Nesli", "RAM (GB)", "RAM Tipi", "SSD (GB)",
  "Ekran Kartı", "GPU VRAM (GB)", "GPU TGP (W)", "Ekran", "Hz", "Klavye Aydınlatma", "Kozmetik",
  "Pil Sağlığı", "Garanti", "Kutu", "Fatura", "Adaptör", "RAM Yükseltme", "M.2 Slot", "Kullanım",
  "Satış Fiyatı (TL)", "Fırsat", "Yeni Gelen", "Stok", "Satış Tarihi", "Ürün Açıklaması",
  "Fotoğraf 1", "Fotoğraf 2", "Fotoğraf 3", "Fotoğraf 4", "Fotoğraf 5", "Fotoğraf 6", "WhatsApp Mesajı",
].join("\t");

const phone = (over) => ({ b: "XIAOMI", m: "REDMI 15", s: "8 GB / 256 GB", p: 14000, stock: "IN", ...over });
const laptop = (over) => ({ id: "PC-001", brand: "ASUS", model: "TUF A15", price: 30000, stock: "IN", ...over });
const phones = (n) => Array.from({ length: n }, (_, i) => phone({ m: `REDMI ${i + 1}` }));

test("gercek telefon basligi gecerli sayilir", () => {
  assert.deepEqual(validateHeader(PHONE_HEADER, PHONE_COLUMNS), []);
});

test("kayan telefon kolonu (araya sutun eklenmesi) hata verir", () => {
  const shifted = PHONE_HEADER.replace("FİYAT", "RENK\tFİYAT");
  const errors = validateHeader(shifted, PHONE_COLUMNS);
  assert.ok(errors.length > 0);
  assert.match(errors[0], /fiyat/i);
});

test("eksik telefon kolonu hata verir", () => {
  const cut = PHONE_HEADER.split("\t").slice(0, 10).join("\t");
  assert.ok(validateHeader(cut, PHONE_COLUMNS).length > 0);
});

test("gercek laptop basligi gecerli; sona eklenen fazladan kolon sorun degil", () => {
  assert.deepEqual(validateHeader(LAPTOP_HEADER, LAPTOP_COLUMNS), []);
  assert.deepEqual(validateHeader(LAPTOP_HEADER + "\tYeni Kolon", LAPTOP_COLUMNS), []);
});

test("laptop 'Kullanım' -> 'Kullanım Amacı' gibi uzatma kabul edilir, yeniden adlandirma edilmez", () => {
  assert.deepEqual(validateHeader(LAPTOP_HEADER.replace("Kullanım", "Kullanım Amacı"), LAPTOP_COLUMNS), []);
  assert.ok(validateHeader(LAPTOP_HEADER.replace("Stok", "Adet"), LAPTOP_COLUMNS).length > 0);
});

test("findHeaderLine ilk satiri (bos TSV'de null) dondurur", () => {
  assert.equal(findHeaderLine("A\tB\nC"), "A\tB");
  assert.equal(findHeaderLine(""), null);
});

test("productSlug istemci/feed ile ayni formati uretir", () => {
  assert.equal(productSlug(phone()), "xiaomi-redmi-15-8-256");
  assert.equal(productSlug(phone({ b: "IPHONE", m: "İPHONE 17 PRO", s: "256 GB" })), "iphone-iphone-17-pro-256");
  assert.equal(productSlug(phone({ s: "" })), "xiaomi-redmi-15");
});

test("banner/baslik satirlari urun sayilmaz", () => {
  assert.equal(isNonProductRow({ b: "MARKA", m: "MODEL / ÜRÜN TANIMI" }), true);
  assert.equal(isNonProductRow({ b: "📱  XIAOMI & REDMI & POCO", m: "" }), true);
  assert.equal(isNonProductRow(phone()), false);
});

test("gecerli telefon katalogu hatasiz gecer", () => {
  const r = validatePhoneCatalog(phones(20));
  assert.deepEqual(r.errors, []);
  assert.equal(r.stats.realCount, 20);
});

test("duplicate telefon slug'i hata verir", () => {
  const list = phones(10).concat([phone({ m: "REDMI 1", s: "8GB/256GB" })]);
  const r = validatePhoneCatalog(list);
  assert.ok(r.errors.some((e) => /slug/i.test(e)));
});

test("fiyatlarin cogu okunamiyorsa (kolon kaymasi belirtisi) hata verir", () => {
  const list = phones(10).map((p, i) => (i < 6 ? { ...p, p: null } : p));
  assert.ok(validatePhoneCatalog(list).errors.some((e) => /fiyat/i.test(e)));
});

test("tanimsiz stok degeri hata verir", () => {
  assert.ok(validatePhoneCatalog(phones(5).concat([phone({ m: "X", stock: "MAYBE" })])).errors.length > 0);
});

test("urun sayisi oncekine gore yariya duserse hata verir", () => {
  assert.ok(validatePhoneCatalog(phones(10), { previousRealCount: 30 }).errors.some((e) => /sayi/i.test(e)));
  assert.deepEqual(validatePhoneCatalog(phones(20), { previousRealCount: 30 }).errors, []);
});

test("hic gercek urun yoksa hata verir", () => {
  assert.ok(validatePhoneCatalog([{ b: "MARKA", m: "MODEL / ÜRÜN TANIMI" }]).errors.length > 0);
});

test("asiri yuksek telefon fiyati uyari uretir (hata degil)", () => {
  const r = validatePhoneCatalog(phones(5).concat([phone({ m: "FOLD", p: 250000 })]));
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.some((w) => /yuksek/i.test(w)));
});

test("gecerli laptop katalogu hatasiz gecer", () => {
  const list = [laptop(), laptop({ id: "PC-002", model: "TUF A16" })];
  assert.deepEqual(validateLaptopCatalog(list).errors, []);
});

test("duplicate ya da bos laptop ID hata verir", () => {
  assert.ok(validateLaptopCatalog([laptop(), laptop({ model: "X" })]).errors.some((e) => /ID/.test(e)));
  assert.ok(validateLaptopCatalog([laptop({ id: "" })]).errors.some((e) => /ID/.test(e)));
});

test("laptop fiyatlarinin cogu okunamiyorsa hata verir", () => {
  const list = [laptop({ price: null }), laptop({ id: "PC-002", price: null }), laptop({ id: "PC-003" })];
  assert.ok(validateLaptopCatalog(list).errors.some((e) => /fiyat/i.test(e)));
});

test("laptop sayisi yariya duserse hata verir", () => {
  assert.ok(validateLaptopCatalog([laptop()], { previousCount: 10 }).errors.length > 0);
});

// Gercek Sheet'te gorulen baslik/not satirlari (25.11.2026 catalog.json'dan). catalog.json
// artik bunlari tasimadigi icin kural testleri bu sabit listeyle de calisir.
const SHEET_NOTE_ROWS = [
  "📱  INFINIX MODELLERİ", "🍏  APPLE IPHONE", "🔹  SAMSUNG", "🧹  DYSON MODELLERİ",
  "💎 MIX GSM MÜŞTERİ HİZMETLERİ & GARANTİ ŞARTLARI",
  "✅ TÜM CİHAZLARA 1 YIL ÜCRETSİZ YAZILIM DESTEĞİ SAĞLANIR.",
  "🚚 ANLAŞMALI KARGO İLE GÜVENLİ VE HIZLI ADRESE TESLİMAT (KARGO ÜCRETI BIZE AITTIR, ORTALAMA 2 GÜNDE TESLIM).",
  "💳 3 AY TAKSİT YAPILAN KARTLAR: YAPI KREDİ WORLD CARD, VAKIFBANK WORLD CARD, QNB KREDİ KARTI, ENPARA KREDİ KARTI.",
  "📲 WHATSAPP SIPARIŞ & İLETIŞIM: 0542 481 82 55",
].map((b) => ({ b, m: "", s: "", p: null, stock: "ASK", group: "PHONE", registration: "", warranty: "" }));

// Ayni kuralin iki kopyasi (site kodu js/app.<hash>.js <-> lib) sessizce ayrismasin: sitedeki
// isNonProductRow/productSlug, gercek katalogdaki her satirda lib ile ayni sonucu vermeli.
test("isNonProductRow ve productSlug site kodundaki kopyayla birebir ayni", () => {
  const fs = require("fs");
  const path = require("path");
  const vm = require("vm");
  const root = path.join(__dirname, "..", "..");
  const html = require("../asset-version").readAppSource(root);
  const between = (a, b) => {
    const i = html.indexOf(a);
    const j = html.indexOf(b, i);
    assert.ok(i >= 0 && j > i, `site kodunda bolum bulunamadi: ${a}`);
    return html.slice(i, j);
  };
  const source = between("function normalizeTR(", "function computeSearchScore(") +
    between("function isNonProductRow(", "function normalizeGithubImageUrl(") +
    ";({ isNonProductRow, productSlug })";
  const site = vm.runInNewContext(source, {});
  const rows = JSON.parse(fs.readFileSync(path.join(root, "catalog.json"), "utf8")).products.concat([
    { b: "MARKA", m: "MODEL / ÜRÜN TANIMI", s: "" },
    { b: "SAMSUNG", m: "SAMSUNG", s: "" },
    { b: "İPHONE", m: "İPHONE 17 PRO", s: "256 GB" },
  ], SHEET_NOTE_ROWS);
  rows.forEach((p) => {
    assert.equal(site.isNonProductRow(p), isNonProductRow(p), `isNonProductRow farkli: ${p.b} ${p.m}`);
    assert.equal(site.productSlug(p), productSlug(p), `productSlug farkli: ${p.b} ${p.m}`);
  });
});

test("kayit durumu: KAYITLI/KAYITSIZ disi telefon degeri uyari olur (hata degil), deger degistirilmez", () => {
  const ph = (m, registration, extra = {}) => ({ b: "XIAOMI", m, s: "8 GB / 256 GB", p: 15000, stock: "IN", group: "PHONE", registration, ...extra });
  const list = [
    ph("REDMI 15", "KAYITLI"), ph("REDMI 15C", "kayıtsız"), ph("POCO F9 PRO", "ŞUAN YOK"), ph("POCO F9 ULTRA", "ŞUAN YOK"),
    ph("PIXEL 10", "SORUNUZ"), ph("REDMI 17", ""), ph("REDMI 17C", "-"),
    { b: "DYSON", m: "AIRSTRAIT", s: "", p: 9500, stock: "IN", group: "PERSONAL_CARE", registration: "-" },
  ].concat(SHEET_NOTE_ROWS);
  const before = JSON.stringify(list);
  const w = registrationWarnings(list, list.map((_, i) => i + 2));
  assert.equal(w.length, 4);                                     // "ŞUAN YOK", "SORUNUZ", "(boş)", "-"
  assert.match(w[0], /"ŞUAN YOK" \(2 telefon/);
  assert.match(w[0], /POCO F9 PRO 8 GB \/ 256 GB \[Sheet satırı 4\]/);
  assert.ok(w.some((x) => /"\(boş\)" \(1 telefon/.test(x)));
  assert.ok(!w.join(" ").includes("REDMI 15 "), "beklenen deger uyari vermemeli");
  assert.ok(!w.join(" ").includes("AIRSTRAIT"), "kisisel bakim urununde kayit sutunu kontrol edilmez");
  assert.equal(JSON.stringify(list), before, "uyari veriyi degistirmemeli");
  // satir numarasi verilmezse yazilmaz; validatePhoneCatalog uyariyi tasir ama HATA uretmez
  assert.ok(!registrationWarnings(list).join(" ").includes("Sheet satırı"));
  const v = validatePhoneCatalog(list);
  assert.deepEqual(v.errors, []);
  assert.equal(v.warnings.filter((x) => x.startsWith("Kayit durumu")).length, 4);
});

test("cok sayida ayni deger ozetlenir (isim listesi sinirli)", () => {
  const list = Array.from({ length: 20 }, (_, i) => ({ b: "XIAOMI", m: `MODEL ${i}`, s: "", p: 10000, stock: "IN", group: "PHONE", registration: "?" }));
  const [w] = registrationWarnings(list);
  assert.match(w, /\(20 telefon/);
  assert.match(w, /ve 12 tane daha$/);
});
