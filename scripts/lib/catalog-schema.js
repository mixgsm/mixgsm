// MIX GSM - Katalog sema dogrulamasi (Google Sheets -> catalog*.json).
//
// generate-catalog.js (telefon) ve generate-catalog-laptop.js (laptop) YAZMADAN
// ONCE bu kontrolleri calistirir. Hata varsa yeni dosya YAZILMAZ; depodaki son
// gecerli catalog*.json yayinda kalir. Uyarilar yalnizca loglanir.
//
// ONEMLI: productSlug / isNonProductRow kurallari index.html ve
// generate-price-page.js ile BIREBIR AYNI olmalidir (ayni kuralin kopyalari).
"use strict";

const fs = require("fs");

// Sheet baslik satiri, normalizeTR sonrasi. Hucre bu degerle BASLAMALI
// ("Kullanım" -> "Kullanım Amacı" gibi uzatmalar kabul; yeniden adlandirma,
// silme veya araya kolon ekleme = kolon kaymasi = hata).
const PHONE_COLUMNS = [
  "marka", "model", "ram hafiza", "fiyat", "stok", "kategori", "resim", "batarya",
  "ekran", "islemci", "kamera", "baglanti", "kayit durumu", "garanti", "etiket",
];
const LAPTOP_COLUMNS = [
  "id", "durum", "marka", "model", "islemci", "islemci nesli", "ram gb", "ram tipi", "ssd gb",
  "ekran karti", "gpu vram gb", "gpu tgp w", "ekran", "hz", "klavye aydinlatma", "kozmetik",
  "pil sagligi", "garanti", "kutu", "fatura", "adaptor", "ram yukseltme", "m 2 slot", "kullanim",
  "satis fiyati", "firsat", "yeni gelen", "stok", "satis tarihi", "urun aciklamasi",
  "fotograf 1", "fotograf 2", "fotograf 3", "fotograf 4", "fotograf 5", "fotograf 6",
];

const STOCK_VALUES = ["IN", "OUT", "ASK"];
// Fiyati okunamayan (WhatsApp'tan Sor) urun orani bunu asarsa fiyat kolonu kaymis sayilir.
const MAX_NULL_PRICE_RATIO = 0.5;
// Urun sayisi bir onceki yayindakinin bu oranin altina duserse Sheet bozuk sayilir.
const MIN_COUNT_RATIO = 0.5;
// Hata degil, sadece uyari: telefonlarda bu tutarin ustu dikkat ister.
const PHONE_PRICE_WARN = 150000;

function normalizeTR(v) {
  return (v || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/İ/g, "i").replace(/ş/g, "s").replace(/Ş/g, "s")
    .replace(/ğ/g, "g").replace(/Ğ/g, "g").replace(/ü/g, "u").replace(/Ü/g, "u")
    .replace(/ö/g, "o").replace(/Ö/g, "o").replace(/ç/g, "c").replace(/Ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// İşletme sahibinin seçim sütunları (telefon "Ana Sayfa", laptop "Vitrin"):
// yalnız açık "Evet" seçim sayılır; boş/"Hayır"/başka her şey = seçilmedi.
// (Fırsat sütununun "var" da kabul eden gevşek kuralı burada BİLEREK yok.)
// Aynı kural istemcideki Sheet yedeğinde de (js/app.*.js isYes) kullanılır.
const YES_VALUES = new Set(["evet", "yes", "true", "1"]);
function isYes(v) {
  return YES_VALUES.has(normalizeTR(v == null ? "" : String(v)));
}

function findHeaderLine(tsv) {
  const first = String(tsv || "").split("\n")[0];
  return first ? first.replace(/\r/g, "") : null;
}

function validateHeader(headerLine, expected) {
  const cols = String(headerLine || "").split("\t").map((c) => normalizeTR(c));
  const errors = [];
  expected.forEach((name, i) => {
    const actual = cols[i];
    if (actual === undefined || actual === "") {
      errors.push(`Kolon ${i + 1} eksik (beklenen: "${name}")`);
    } else if (!actual.startsWith(name)) {
      errors.push(`Kolon ${i + 1} beklenen "${name}", bulunan "${actual}" (kolon kaymasi?)`);
    }
  });
  return errors;
}

function productBaseSlug(p) {
  return normalizeTR(`${p.b} ${p.m}`).trim().replace(/\s+/g, "-");
}

function productSlug(p) {
  const base = productBaseSlug(p);
  const nums = String(p.s || "").match(/\d+/g);
  return nums && nums.length ? `${base}-${nums.join("-")}` : base;
}

function isNonProductRow(p) {
  const brand = normalizeTR(p.b || "");
  const model = normalizeTR(p.m || "");
  const text = `${brand} ${model}`.trim();
  if (!brand || !model) return true;
  const titleTerms = ["marka model", "urun tanimi", "modelleri", "modeller", "guncelleme", "whatsapp",
    "fiyat listesi", "iletisim", "urunleri", "urunler", "liste"];
  if (titleTerms.some((term) => text.includes(term))) return true;
  const brandOnly = new Set(["apple", "apple iphone", "iphone", "samsung", "xiaomi", "redmi", "poco",
    "infinix", "tecno", "oneplus", "google", "pixel", "dyson", "braun", "philips"]);
  if (brandOnly.has(model)) return true;
  if (model === brand || model.replace(/\s+/g, "") === brand.replace(/\s+/g, "")) return true;
  return false;
}

function findDuplicates(values) {
  const seen = new Set();
  const dups = new Set();
  values.forEach((v) => (seen.has(v) ? dups.add(v) : seen.add(v)));
  return [...dups];
}

function checkCommon(items, { priceOf, label, previousCount }) {
  const errors = [];
  if (!items.length) {
    errors.push(`Gecerli ${label} bulunamadi (0 urun).`);
    return errors;
  }
  const nullPrices = items.filter((p) => priceOf(p) === null).length;
  if (nullPrices / items.length > MAX_NULL_PRICE_RATIO) {
    errors.push(`${label}: ${items.length} urunun ${nullPrices} tanesinde fiyat okunamadi (fiyat kolonu kaymis olabilir).`);
  }
  const badStock = items.filter((p) => !STOCK_VALUES.includes(p.stock));
  if (badStock.length) errors.push(`${label}: tanimsiz stok degeri (${badStock.length} urun).`);
  if (previousCount && items.length < previousCount * MIN_COUNT_RATIO) {
    errors.push(`${label}: urun sayisi ${previousCount} -> ${items.length} dustu (yarinin altinda).`);
  }
  return errors;
}

function validatePhoneCatalog(products, { previousRealCount } = {}) {
  const real = (products || []).filter((p) => !isNonProductRow(p));
  const errors = checkCommon(real, { priceOf: (p) => p.p, label: "telefon", previousCount: previousRealCount });
  const dupSlugs = findDuplicates(real.map(productSlug));
  if (dupSlugs.length) errors.push(`Duplicate urun slug'i: ${dupSlugs.join(", ")}`);
  const warnings = real
    .filter((p) => p.p !== null && p.p > PHONE_PRICE_WARN)
    .map((p) => `Cok yuksek fiyat, kontrol edin: ${p.b} ${p.m} ${p.s} = ${p.p} TL`);
  return { errors, warnings, stats: { rowCount: (products || []).length, realCount: real.length } };
}

function validateLaptopCatalog(products, { previousCount } = {}) {
  const list = products || [];
  const errors = checkCommon(list, { priceOf: (p) => p.price, label: "laptop", previousCount });
  const emptyIds = list.filter((p) => !String(p.id || "").trim()).length;
  if (emptyIds) errors.push(`Laptop ID bos: ${emptyIds} urun.`);
  const dupIds = findDuplicates(list.map((p) => String(p.id || "").trim()).filter(Boolean));
  if (dupIds.length) errors.push(`Duplicate laptop ID: ${dupIds.join(", ")}`);
  return { errors, warnings: [], stats: { realCount: list.length } };
}

// Onceki yayindaki (depodaki) dosyadan urun sayisini okur; yoksa/bozuksa 0.
function readPreviousCount(filePath, countFn) {
  try {
    const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
    return Array.isArray(data.products) ? countFn(data.products) : 0;
  } catch (e) {
    return 0;
  }
}

// GitHub Actions ek aciklamasi (::error:: / ::warning::) olarak yazdirir.
function report(result, tag) {
  result.warnings.forEach((w) => console.log(`::warning::${tag}: ${w}`));
  result.errors.forEach((e) => console.log(`::error::${tag}: ${e}`));
}

module.exports = {
  PHONE_COLUMNS,
  LAPTOP_COLUMNS,
  normalizeTR,
  isYes,
  findHeaderLine,
  validateHeader,
  productSlug,
  isNonProductRow,
  validatePhoneCatalog,
  validateLaptopCatalog,
  readPreviousCount,
  report,
};
