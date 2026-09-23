// MIX GSM - Public Laptop Sheet -> catalog-laptop.json ureteci
//
// Bu script GitHub Actions tarafindan (bkz. .github/workflows/update-catalog.yml)
// sunucu tarafinda calisir. scripts/generate-catalog.js'in (telefon) laptop
// icin AYNASIDIR - ayni yapi/kural, TAMAMEN FARKLI kaynak ve sema.
//
// KRITIK GUVENLIK KURALI: bu dosya SADECE Public Laptop Sheet'i okur. Main
// Management Sheet'in URL'si bu dosyada, repo'da veya baska hicbir pipeline
// adiminda BULUNMAZ. Alis Fiyati / Maliyet / Kar / Tedarikci / Ic Not /
// Personel Notu gibi alanlar asagida TANIMLI DEGIL - bu yuzden parse
// edilmeleri, catalog-laptop.json'a girmeleri veya tarayiciya gitmeleri
// mumkun degil.
//
// KRITIK DAYANIKLILIK KURALI: Public Laptop Sheet URL'si henuz placeholder
// ise (gercek bir sheet baglanmadiysa) veya fetch basarisiz olursa, bu
// script HATA FIRLATIP GitHub Actions job'unu KIRMAZ - bos ama gecerli bir
// catalog-laptop.json yazar. Boylece telefon tarafindaki catalog.json
// uretimi bu script'ten TAMAMEN bagimsiz kalir, laptop sheet henuz hazir
// olmasa da telefon pipeline'i asla etkilenmez.

const fs = require("fs");
const path = require("path");

// MIX GSM: Public Laptop Sheet TSV export linki (isa tarafindan onaylandi,
// 22.09.2026). Bu SADECE musteri-facing alanlar icin ayrilmis Public Sheet -
// Main Management Sheet URL'si BURAYA ASLA KONULMAYACAK.
const LAPTOP_SHEETS_URL = "https://docs.google.com/spreadsheets/d/1VImHmUN9eAA7x4y6tTrh5F0UA1sLsdcgCb3HjiVyXNg/export?format=tsv&gid=0";

const OUTPUT_PATH = path.join(__dirname, "..", "catalog-laptop.json");

function isConfigured(url) {
  return /^https:\/\/docs\.google\.com\/spreadsheets\//.test(String(url || ""));
}

function writeEmptyCatalog(reason) {
  const payload = {
    generatedAt: new Date().toISOString(),
    productCount: 0,
    products: [],
    note: reason,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload));
  console.log("catalog-laptop.json BOS yazildi. Sebep: " + reason);
}

function normalizeTR(v) {
  return (v || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/ı/g, "i").replace(/İ/g, "i").replace(/ş/g, "s").replace(/Ş/g, "s")
    .replace(/ğ/g, "g").replace(/Ğ/g, "g").replace(/ü/g, "u").replace(/Ü/g, "u")
    .replace(/ö/g, "o").replace(/Ö/g, "o").replace(/ç/g, "c").replace(/Ç/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// index.html'deki normalizeLaptopGithubImageUrl() ile BIREBIR AYNI guvenlik
// kurali: SADECE MIX GSM GitHub deposundaki /laptop-photos/ altindaki
// dosyalara izin verilir (telefonlarin /photos/ klasoruyle KARISTIRILMAZ).
function normalizeLaptopGithubImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  // Tam URL - duz dosya adi (eski/test formati): laptop-photos/DOSYA.jpg
  const directMatch = raw.match(
    /^https:\/\/raw\.githubusercontent\.com\/mixgsm\/mixgsm\/main\/laptop-photos\/[A-Za-z0-9._%-]+$/i
  );
  if (directMatch) return raw;

  // Tam URL - images/ alt klasoru (gercek Sheet fotograflari burada)
  const directMatchImages = raw.match(
    /^https:\/\/raw\.githubusercontent\.com\/mixgsm\/mixgsm\/main\/laptop-photos\/images\/[A-Za-z0-9._%-]+$/i
  );
  if (directMatchImages) return raw;

  const blob = raw.match(
    /^https:\/\/github\.com\/mixgsm\/mixgsm\/blob\/main\/laptop-photos\/([A-Za-z0-9._%-]+(?:\/[A-Za-z0-9._%-]+)?)$/i
  );
  if (blob) {
    return `https://raw.githubusercontent.com/mixgsm/mixgsm/main/laptop-photos/${blob[1]}`;
  }

  // GERCEK SHEET FORMATI: Sheet hucrelerinde tam URL degil, GORECELI yol
  // saklaniyor - orn. "images/PC-001-01.jpg". Yalnizca sabit "images/" alt
  // klasoru + guvenli dosya adi karakterleri ("/" YOK) kabul edilir - path
  // traversal (../) veya baska bir klasore cikis KESINLIKLE mumkun degildir.
  const relativeMatch = raw.match(/^images\/([A-Za-z0-9._%-]+)$/);
  if (relativeMatch) {
    return `https://raw.githubusercontent.com/mixgsm/mixgsm/main/laptop-photos/${raw}`;
  }

  return "";
}

function parseCondition(raw) {
  const n = normalizeTR(raw);
  if (!n) return null;
  if (n.includes("sifir")) return "NEW";
  if (n.includes("2 el") || n.includes("ikinci el") || n.includes("ikincisi")) return "USED";
  return null;
}

function parseStock(raw) {
  const words = normalizeTR(raw).split(/\s+/);
  if (words.some((w) => ["sor", "sorunuz", "soru"].includes(w))) return "ASK";
  if (
    words.some((w) => ["var", "stokta", "mevcut", "evet"].includes(w)) &&
    !words.some((w) => ["yok", "tukendi", "0", "hayir", "false", "degil"].includes(w))
  ) {
    return "IN";
  }
  return "OUT";
}

function parseBoolFlag(raw) {
  const n = normalizeTR(raw);
  return n.includes("evet") || n.includes("var") || n === "true";
}

// Laptop fiyat araligi telefonlardan (100-300.000 TL) FARKLI ve daha genis
// tutuldu - ust segment oyun/is istasyonu laptoplar bu aralikta rahatlikla
// olabilir. Gercek disi (0, negatif, metin) veya asiri uc degerler yine
// UYDURULMAYIP null (WhatsApp'tan Sor) olarak birakiliyor.
function parsePrice(raw) {
  const rawPrice = String(raw || "");
  const isNegative = /^\s*-/.test(rawPrice);
  const cleaned = rawPrice.replace(/[,.]\d{1,2}(?!\d)/g, "").replace(/[^0-9]/g, "");
  const parsed = cleaned ? parseInt(cleaned, 10) : NaN;
  return !isNegative && Number.isFinite(parsed) && parsed >= 1000 && parsed <= 500000 ? parsed : null;
}

// Public Laptop Sheet sutun sirasi (isa'nin onayladigi sema, A-AE, 0-indeksli):
// 0 ID, 1 Durum, 2 Marka, 3 Model, 4 Islemci, 5 Islemci Nesli, 6 RAM(GB),
// 7 RAM Tipi, 8 SSD(GB), 9 Ekran Karti, 10 GPU VRAM(GB), 11 GPU TGP(W),
// 12 Ekran, 13 Hz, 14 Klavye Aydinlatma, 15 Kozmetik, 16 Pil Sagligi,
// 17 Garanti, 18 Kutu, 19 Fatura, 20 Adaptor, 21 RAM Yukseltme, 22 M.2 Slot,
// 23 Kullanim Amaci, 24 Satis Fiyati, 25 Firsat, 26 Yeni Gelen, 27 Stok,
// 28 Satis Tarihi, 29 Urun Aciklamasi, 30-35 Fotograf 1..Fotograf 6 (ALTI
// AYRI SUTUN - tek "Fotograf" sutunu degil).
// NOT: "WhatsApp Mesaji" sutunu BILEREK YOK - mesaj urun verisinden
// dinamik uretilecek (Faz 6).
function parseTsvToLaptopProducts(tsv) {
  const lines = tsv.split("\n");
  const products = [];
  const startIndex = lines[0] && normalizeTR(lines[0]).includes("id") ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    if (!lines[i] || !lines[i].trim()) continue;
    const cols = lines[i].split("\t").map((c) => c.trim().replace(/\r/g, ""));

    const brand = (cols[2] || "").toUpperCase();
    const model = (cols[3] || "").toUpperCase();
    if (!brand && !model) continue;

    products.push({
      id: cols[0] || "",
      condition: parseCondition(cols[1]),
      brand,
      model,
      cpu: cols[4] || "",
      cpuGen: cols[5] || "",
      ramGB: cols[6] || "",
      ramType: cols[7] || "",
      ssdGB: cols[8] || "",
      gpu: cols[9] || "",
      gpuVramGB: cols[10] || "",
      gpuTgpW: cols[11] || "",
      screen: cols[12] || "",
      hz: cols[13] || "",
      kbLight: cols[14] || "",
      cosmetic: cols[15] || "",
      batteryHealth: cols[16] || "",
      warranty: cols[17] || "",
      box: cols[18] || "",
      invoice: cols[19] || "",
      adapter: cols[20] || "",
      ramUpgrade: cols[21] || "",
      m2Slot: cols[22] || "",
      usage: cols[23] || "",
      price: parsePrice(cols[24]),
      deal: parseBoolFlag(cols[25]),
      newArrival: parseBoolFlag(cols[26]),
      stock: parseStock(cols[27]),
      saleDate: cols[28] || "",
      description: cols[29] || "",
      img: normalizeLaptopGithubImageUrl(cols[30] || ""),
      img2: normalizeLaptopGithubImageUrl(cols[31] || ""),
      img3: normalizeLaptopGithubImageUrl(cols[32] || ""),
      img4: normalizeLaptopGithubImageUrl(cols[33] || ""),
      img5: normalizeLaptopGithubImageUrl(cols[34] || ""),
      img6: normalizeLaptopGithubImageUrl(cols[35] || ""),
    });
  }

  return products;
}

async function main() {
  if (!isConfigured(LAPTOP_SHEETS_URL)) {
    writeEmptyCatalog("Public Laptop Sheet henuz baglanmadi (placeholder URL).");
    return;
  }

  let tsv;
  try {
    const res = await fetch(LAPTOP_SHEETS_URL + "&t=" + Date.now());
    if (!res.ok) throw new Error("HTTP " + res.status);
    tsv = await res.text();
  } catch (err) {
    // DAYANIKLILIK: canli Sheet'e ulasilamadi. Eski catalog-laptop.json
    // varsa DOKUNMADAN birak (bir onceki basarili veri kaybolmasin); yoksa
    // bos-ama-gecerli bir dosya yaz. Ikisi de is akisini KIRMAZ.
    if (fs.existsSync(OUTPUT_PATH)) {
      console.log("Public Laptop Sheet'e ulasilamadi (" + err.message + "). Mevcut catalog-laptop.json korunuyor.");
      return;
    }
    writeEmptyCatalog("Public Laptop Sheet'e ulasilamadi: " + err.message);
    return;
  }

  const products = parseTsvToLaptopProducts(tsv);
  const payload = {
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    products,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload));
  console.log("catalog-laptop.json uretildi. Urun sayisi: " + products.length);
}

main().catch((err) => {
  // Son care: beklenmeyen bir hata bile olsa GitHub Actions job'unu
  // KIRMAMAK icin process'i basarisiz koda cikarmiyoruz - sadece logluyoruz
  // ve (varsa) mevcut dosyayi koruyoruz / yoksa bos yaziyoruz.
  console.error("Beklenmeyen hata:", err);
  if (!fs.existsSync(OUTPUT_PATH)) {
    writeEmptyCatalog("Beklenmeyen hata: " + err.message);
  }
});
