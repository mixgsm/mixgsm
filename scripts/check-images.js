// MIX GSM - Gorsel saglik kontrolu (IMAGE HEALTH CHECK)
//
//   node scripts/check-images.js            -> ozet + GitHub Actions ::warning:: satirlari
//   node scripts/check-images.js --strict   -> kirik gorsel varsa cikis kodu 1
//
// Telefon gorselleri tarayicida, site kodundaki (js/app.<hash>.js) eslestirme mantigiyla
// (imageCandidatesForProduct) secilir. Bu script o mantigi KOPYALAMAZ:
// site kodundaki ilgili bolumu okuyup aynen calistirir, boylece rapor ile
// sitenin gosterdigi gorsel hicbir zaman ayrismaz. Depodaki dosya listesi,
// tarayicinin GitHub API'den aldigi listenin yerine gecer.
//
// Laptop gorselleri Sheet'teki Fotograf 1..6 URL'lerinden gelir; depoda
// birebir (buyuk/kucuk harf dahil - raw.githubusercontent.com harfe duyarli)
// bulunup bulunmadigi kontrol edilir.
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const schema = require("./lib/catalog-schema");
const { readAppSource } = require("./asset-version");

const ROOT = path.join(__dirname, "..");
const PHONE_BASE = "https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/";
const LAPTOP_BASE = "https://raw.githubusercontent.com/mixgsm/mixgsm/main/laptop-photos/";
const PHONE_FALLBACK = "gorsel-yok.jpg";
const IMAGE_EXT = /\.(jpe?g|png|webp)$/i;
const LAPTOP_IMAGE_FIELDS = ["img", "img2", "img3", "img4", "img5", "img6"];
// Site kodunda telefon gorsel eslestirme bolumunun sinirlari. Bolum bos bir
// vm baglaminda calisir: burada yalnizca imageCandidatesForProduct ve sabit
// liste kullanilir. Bolumdeki tarayici bagimli fonksiyonlar (fetch,
// sessionStorage, isNonProductRow kullananlar) burada CAGRILMAMALIDIR.
const MATCHER_START = "function normalizeGithubImageUrl(";
const MATCHER_END = "function tryNextProductImage(";

function loadSiteImageMatcher(siteRoot) {
  const html = readAppSource(siteRoot);
  const start = html.indexOf(MATCHER_START);
  const end = html.indexOf(MATCHER_END);
  if (start < 0 || end < 0 || end < start) {
    throw new Error("site kodunda gorsel eslestirme bolumu bulunamadi (" + MATCHER_START + " ... " + MATCHER_END + ")");
  }
  const source = html.slice(start, end) +
    "\n;({ imageCandidatesForProduct, withPhotoVariantIndex, staticFiles: GITHUB_PHOTO_FILES, setExtra: (f) => { EXTRA_PHOTO_FILES = f; } })";
  const api = vm.runInNewContext(source, {}, { filename: "js/app.js#image-matcher" });
  const staticFiles = Array.from(api.staticFiles);
  const staticLower = new Set(staticFiles.map((f) => f.toLowerCase()));

  // repoFiles: depodaki photos/ dosyalari. Tarayicida oldugu gibi, sabit
  // listede olmayanlar "ekstra" (GitHub API) dosyalari olarak eklenir.
  function candidates(product, repoFiles) {
    api.setExtra(repoFiles.filter((f) => IMAGE_EXT.test(f) && !staticLower.has(f.toLowerCase())));
    return Array.from(api.imageCandidatesForProduct(product));
  }
  const withPhotoVariantIndex = (list) => Array.from(api.withPhotoVariantIndex(list));
  return { candidates, withPhotoVariantIndex, staticFiles };
}

function fileFromUrl(url, base) {
  if (!url.startsWith(base)) return null;
  try { return decodeURIComponent(url.slice(base.length)); } catch (e) { return null; }
}

function label(p) {
  return [p.b, p.m, p.s].filter(Boolean).join(" ");
}

function checkPhoneImages(products, matcher, repoFiles) {
  const exists = new Set(repoFiles);
  const real = products.filter((p) => !schema.isNonProductRow(p));
  const result = { total: real.length, ok: [], fallback: [], broken: [], firstCandidateMissing: [] };
  real.forEach((p) => {
    const files = matcher.candidates(p, repoFiles).map((u) => fileFromUrl(u, PHONE_BASE));
    if (files.length === 1 && files[0] === PHONE_FALLBACK) {
      result.fallback.push(label(p));
      return;
    }
    const firstOk = files.findIndex((f) => f && exists.has(f));
    if (firstOk < 0) {
      result.broken.push(`${label(p)} -> ${files.join(", ")} (depoda yok)`);
    } else {
      result.ok.push(`${label(p)} -> ${files[firstOk]}`);
      if (firstOk > 0) result.firstCandidateMissing.push(`${label(p)} -> ${files[0]} (depoda yok, yedege dusuyor)`);
    }
  });
  return result;
}

function checkLaptopImages(products, repoFiles) {
  const exact = new Set(repoFiles);
  const lower = new Map(repoFiles.map((f) => [f.toLowerCase(), f]));
  const usage = new Map();
  const result = { total: products.length, imagesOk: 0, noImage: [], broken: [], shared: [] };
  products.forEach((p) => {
    const urls = LAPTOP_IMAGE_FIELDS.map((k) => String(p[k] || "").trim()).filter(Boolean);
    if (!urls.length) { result.noImage.push(p.id || "(ID yok)"); return; }
    urls.forEach((u) => {
      const rel = fileFromUrl(u, LAPTOP_BASE);
      if (!rel) { result.broken.push(`${p.id}: gecersiz adres ${u}`); return; }
      if (!IMAGE_EXT.test(rel)) { result.broken.push(`${p.id}: gecersiz uzanti ${rel}`); return; }
      if (exact.has(rel)) {
        result.imagesOk++;
        usage.set(rel, (usage.get(rel) || []).concat(p.id));
      } else if (lower.has(rel.toLowerCase())) {
        result.broken.push(`${p.id}: ${rel} -> depoda ${lower.get(rel.toLowerCase())} (buyuk/kucuk harf farki)`);
      } else {
        result.broken.push(`${p.id}: ${rel} depoda yok`);
      }
    });
  });
  usage.forEach((ids, rel) => {
    const unique = [...new Set(ids)];
    if (unique.length > 1) result.shared.push(`${rel}: ${unique.join(", ")}`);
  });
  return result;
}

function listFiles(dir, prefix) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) =>
    e.isDirectory() ? listFiles(path.join(dir, e.name), prefix + e.name + "/") : [prefix + e.name]
  );
}

function readProducts(file) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(ROOT, file), "utf8"));
    return Array.isArray(data.products) ? data.products : [];
  } catch (e) {
    console.log(`::warning::${file} okunamadi: ${e.message}`);
    return [];
  }
}

function main() {
  const matcher = loadSiteImageMatcher(ROOT);
  const photoFiles = listFiles(path.join(ROOT, "photos"), "");
  const phone = checkPhoneImages(readProducts("catalog.json"), matcher, photoFiles);
  const laptop = checkLaptopImages(readProducts("catalog-laptop.json"), listFiles(path.join(ROOT, "laptop-photos"), ""));
  const staleStatic = matcher.staticFiles.filter((f) => f !== ".gitkeep" && !photoFiles.includes(f));
  const extraCount = photoFiles.filter((f) => IMAGE_EXT.test(f) && !matcher.staticFiles.some((s) => s.toLowerCase() === f.toLowerCase())).length;

  console.log("GORSEL SAGLIK RAPORU");
  console.log(`Telefon: ${phone.total} urun | Gorsel OK: ${phone.ok.length} | Fallback (gorsel yok): ${phone.fallback.length} | Kirik: ${phone.broken.length}`);
  console.log(`Laptop:  ${laptop.total} urun | Gorsel OK: ${laptop.imagesOk} | Gorselsiz urun: ${laptop.noImage.length} | Kirik: ${laptop.broken.length} | Paylasilan gorsel: ${laptop.shared.length}`);
  console.log(`Site kodundaki sabit foto listesi: depoda olmayan ${staleStatic.length} | listede olmayan (GitHub API'ye kalan) ${extraCount}`);

  const warn = (msg) => console.log(`::warning::${msg}`);
  phone.fallback.forEach((x) => warn(`Telefon gorseli yok (fallback): ${x}`));
  phone.broken.forEach((x) => warn(`Telefon gorseli kirik: ${x}`));
  phone.firstCandidateMissing.forEach((x) => warn(`Telefon gorseli: ${x}`));
  laptop.noImage.forEach((x) => warn(`Laptop gorseli yok: ${x}`));
  laptop.broken.forEach((x) => warn(`Laptop gorseli kirik: ${x}`));
  laptop.shared.forEach((x) => warn(`Ayni laptop gorseli birden fazla urunde: ${x}`));
  staleStatic.forEach((x) => warn(`Site kodundaki foto listesinde var, depoda yok: ${x}`));

  const brokenCount = phone.broken.length + laptop.broken.length;
  if (process.argv.includes("--strict") && brokenCount) process.exitCode = 1;
}

if (require.main === module) main();

module.exports = { loadSiteImageMatcher, checkPhoneImages, checkLaptopImages };
