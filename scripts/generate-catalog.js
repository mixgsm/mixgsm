// MIX GSM - Google Sheets -> catalog.json ureteci
//
// Bu script GitHub Actions tarafindan (bkz. .github/workflows/update-catalog.yml)
// sunucu tarafinda (bir tarayici DEGIL) calistirilir. Google Sheets'ten TSV
// verisini ceker ve index.html icindeki mevcut tarayici-tarafi ayristirma
// mantigiyla BIREBIR AYNI kurallari kullanarak catalog.json dosyasini uretir.
//
// ONEMLI: Bu dosya index.html'deki loadFromGoogleSheets() fonksiyonunun bir
// "aynasidir". index.html'de kolon yapisi / urun alanlari / is kurallari
// degisirse, BURASI DA guncellenmelidir - aksi halde catalog.json ile
// dogrudan Google Sheets yontemi FARKLI veri uretmeye baslar.
//
// Sunucu tarafinda calistigi icin (GitHub Actions runner'i) tarayici CORS
// kurallarina tabi DEGILDIR - bu yuzden Google Sheets'e sorunsuz baglanabilir.

const fs = require("fs");
const path = require("path");

const SHEETS_URL =
  "https://docs.google.com/spreadsheets/d/1PN8gIIC4f57y9R0vy2p6SaLpeCwWWetM1Ga-Xkbrv6o/export?format=tsv&gid=121333260";

const OUTPUT_PATH = path.join(__dirname, "..", "catalog.json");

function normalizeTR(v) {
  return (v || "")
    .toLocaleLowerCase("tr-TR")
    .replace(/\u0131/g, "i").replace(/\u0130/g, "i").replace(/\u015f/g, "s").replace(/\u015e/g, "s")
    .replace(/\u011f/g, "g").replace(/\u011e/g, "g").replace(/\u00fc/g, "u").replace(/\u00dc/g, "u")
    .replace(/\u00f6/g, "o").replace(/\u00d6/g, "o").replace(/\u00e7/g, "c").replace(/\u00c7/g, "c")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

// index.html'deki normalizeGithubImageUrl() ile BIREBIR AYNI guvenlik kurali:
// sadece MIX GSM GitHub deposundaki /photos/ altindaki dosyalara izin verilir.
function normalizeGithubImageUrl(value) {
  const raw = String(value || "").trim();
  if (!raw) return "";

  const directMatch = raw.match(
    /^https:\/\/raw\.githubusercontent\.com\/mixgsm\/mixgsm\/main\/photos\/[A-Za-z0-9._%-]+$/i
  );
  if (directMatch) return raw;

  const blob = raw.match(
    /^https:\/\/github\.com\/mixgsm\/mixgsm\/blob\/main\/photos\/([A-Za-z0-9._%-]+)$/i
  );
  if (blob) {
    return `https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/${blob[1]}`;
  }

  return "";
}

function parseTsvToProducts(tsv) {
  const lines = tsv.split("\n");
  const products = [];
  const startIndex = lines[0] && lines[0].includes("MARKA") ? 1 : 0;

  for (let i = startIndex; i < lines.length; i++) {
    if (!lines[i] || !lines[i].trim()) continue;
    const cols = lines[i].split("\t").map((c) => c.trim().replace(/\r/g, ""));

    const marka = (cols[0] || "").toUpperCase();
    const model = (cols[1] || "").toUpperCase();
    if (!marka && !model) continue;

    const stokWords = normalizeTR(cols[4] || "").split(/\s+/);
    let stockStatus = "OUT";
    if (stokWords.some((w) => ["sor", "sorunuz", "soru"].includes(w))) {
      stockStatus = "ASK";
    } else if (
      stokWords.some((w) => ["var", "stokta", "mevcut", "evet"].includes(w)) &&
      !stokWords.some((w) => ["yok", "tukendi", "0", "hayir", "false", "degil"].includes(w))
    ) {
      stockStatus = "IN";
    }

    const rawPrice = cols[3] || "";
    const isNegativePrice = /^\s*-/.test(rawPrice);
    const cleanPrice = rawPrice.replace(/[,.]\d{1,2}(?!\d)/g, "").replace(/[^0-9]/g, "");
    const parsedPrice = cleanPrice ? parseInt(cleanPrice, 10) : NaN;
    const finalPrice =
      !isNegativePrice && Number.isFinite(parsedPrice) && parsedPrice >= 100 && parsedPrice <= 300000
        ? parsedPrice
        : null;

    let catType = "OTHER";
    if (marka.includes("APPLE") || marka.includes("IPHONE")) catType = "APPLE";
    else if (marka.includes("SAMSUNG")) catType = "SAMSUNG";
    else if (marka.includes("XIAOMI") || marka.includes("REDMI") || marka.includes("POCO")) catType = "XIAOMI";
    else if (marka.includes("INFINIX") || marka.includes("TECNO")) catType = "INFINIX_TECNO";

    let groupType = "PHONE";
    const katStr = (cols[5] || "").toLowerCase();
    if (katStr.includes("bak\u0131m") || marka.includes("DYSON") || marka.includes("BRAUN") || marka.includes("PHILIPS")) {
      groupType = "PERSONAL_CARE";
    }

    const warrantyText = (cols[13] || "").trim();
    const tagRaw = normalizeTR(cols[14] || "");
    let tagLabel = "";
    let tagClass = "";
    if (tagRaw.includes("mix") && tagRaw.includes("oneri")) {
      tagLabel = "M\u0130X GSM \u00d6neriyor";
      tagClass = "tag-oneri";
    } else if (tagRaw.includes("firsat")) {
      tagLabel = "F\u0131rsat";
      tagClass = "tag-firsat";
    } else if (tagRaw.includes("populer")) {
      tagLabel = "Pop\u00fcler";
      tagClass = "tag-populer";
    } else if (tagRaw.includes("yeni")) {
      tagLabel = "Yeni";
      tagClass = "tag-yeni";
    }

    products.push({
      b: marka,
      m: model,
      s: cols[2] || "",
      p: finalPrice,
      stock: stockStatus,
      cat: catType,
      group: groupType,
      img: normalizeGithubImageUrl(cols[6] || ""),
      battery: cols[7] || "",
      screen: cols[8] || "",
      processor: cols[9] || "",
      camera: cols[10] || "",
      connectivity: cols[11] || "",
      registration: cols[12] || "",
      warranty: warrantyText,
      tagLabel: tagLabel,
      tagClass: tagClass,
    });
  }

  return products;
}

async function main() {
  const res = await fetch(SHEETS_URL + "&t=" + Date.now(), { cache: "no-store" });
  if (!res.ok) {
    throw new Error("Google Sheets export basarisiz: HTTP " + res.status);
  }
  const tsv = await res.text();
  const products = parseTsvToProducts(tsv);

  // GUVENLIK: Sheets gecici olarak bos/bozuk bir sey donerse (ornegin bakim
  // sayfasi, izin hatasi vb.), catalog.json'u BOS/BOZUK veriyle EZMEYIZ.
  // Onceki iyi surum repo'da oldugu gibi kalir, is akisi hata ile durur.
  if (!products.length) {
    throw new Error(
      "Ayristirilan urun sayisi 0 - Sheets verisi beklenmedik formatta olabilir. " +
        "Guvenlik icin catalog.json GUNCELLENMEDI."
    );
  }

  const payload = {
    generatedAt: new Date().toISOString(),
    productCount: products.length,
    products,
  };

  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload));
  console.log(`catalog.json yazildi: ${products.length} urun.`);
}

if (require.main === module) {
  main().catch((err) => {
    console.error("HATA:", err.message);
    process.exit(1);
  });
}

module.exports = { parseTsvToProducts, normalizeGithubImageUrl, normalizeTR };
