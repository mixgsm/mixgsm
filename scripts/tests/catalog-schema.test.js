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
