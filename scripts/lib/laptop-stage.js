// MIX GSM - laptop fotograf "sahne" turevlerinin tutarlilik kontrolu.
// Turevler cevrim disi uretilir (scripts/laptop-stage.py). Kaynak fotograf
// sonradan DEGISTIRILIP arac tekrar calistirilmazsa sitede ESKI urun gorseli
// gosterilir (yanlis gorsel = veri hatasi); bu kontrol QA'da HATA verir.
// Manifestte olmayan yeni fotograflar sorun degildir: site orijinali gosterir
// (CSS'te beyaz zemin sahneye karisir) - yalniz bilgi amacli uyari.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const STAGE_FILE = /^[A-Za-z0-9._-]+\.(sm|lg)\.webp$/;
const TYPES = ["cut", "alpha", "opaque"];
const PHOTO = /^[A-Za-z0-9._-]+\.(jpe?g|png|webp)$/i;

function sha16(file) {
  return crypto.createHash("sha256").update(fs.readFileSync(file)).digest("hex").slice(0, 16);
}

function checkLaptopStage(root) {
  const errors = [];
  const warnings = [];
  const srcDir = path.join(root, "laptop-photos", "images");
  const stageDir = path.join(root, "laptop-photos", "stage");
  const manifestPath = path.join(stageDir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    warnings.push("laptop-photos/stage/manifest.json yok: laptop fotograflari orijinal haliyle gosterilir");
    return { errors, warnings };
  }
  let files;
  try {
    files = JSON.parse(fs.readFileSync(manifestPath, "utf8")).files || {};
  } catch (e) {
    errors.push("laptop-photos/stage/manifest.json okunamadi: " + e.message);
    return { errors, warnings };
  }
  const owner = new Map(); // turev dosyasi -> kaynak (iki kaynak ayni turevi paylasamaz)
  Object.keys(files).forEach((name) => {
    const e = files[name] || {};
    const src = path.join(srcDir, name);
    if (!PHOTO.test(name) || !fs.existsSync(src)) {
      errors.push(`sahne manifestinde kaynagi olmayan fotograf: ${name} (python3 scripts/laptop-stage.py)`);
      return;
    }
    if (!TYPES.includes(e.type)) errors.push(`sahne manifestinde gecersiz tur: ${name}`);
    ["sm", "lg"].forEach((k) => {
      if (!STAGE_FILE.test(e[k] || "") || !fs.existsSync(path.join(stageDir, e[k]))) errors.push(`sahne turevi eksik: ${name} (${k})`);
      else if (owner.has(e[k])) errors.push(`iki fotograf ayni sahne turevini paylasiyor: ${owner.get(e[k])} ve ${name} (${e[k]})`);
      else owner.set(e[k], name);
    });
    if (e.sha256 !== sha16(src)) errors.push(`laptop fotografi degismis ama sahne turevi eski: ${name} (python3 scripts/laptop-stage.py)`);
  });
  const missing = fs.existsSync(srcDir) ? fs.readdirSync(srcDir).filter((f) => PHOTO.test(f) && !files[f]) : [];
  if (missing.length) warnings.push(`sahne turevi olmayan ${missing.length} laptop fotografi (orijinal gosterilir): ${missing.slice(0, 5).join(", ")}`);
  return { errors, warnings };
}

module.exports = { checkLaptopStage, sha16 };
