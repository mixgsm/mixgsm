// MIX GSM - Telefon fotograf listesi (photos/ -> feed/photos.json)
//
//   node scripts/generate-photo-list.js
//
// Site, telefon gorsellerini dosya adina gore eslestirir. Eskiden yeni
// yuklenen dosyalari yalnizca koddaki sabit liste veya (saatte 60 istek
// sinirli) GitHub API ile bulabiliyordu; modelin ilk gorseli sabit listede
// oldugunda "MODEL-2.jpg" gibi ek fotograflar hic fark edilmiyordu. CI bu
// listeyi her calismada uretir, site ayni kaynaktan (limitsiz) okur.
// Dosya yalnizca icerik degistiginde yazilir (gereksiz commit olmaz).
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
// Sitedeki PHOTO_FILE_NAME ile ayni kural: yalnizca guvenli dosya adlari.
const PHOTO_FILE_NAME = /^[A-Za-z0-9._%-]+\.(jpg|jpeg|png|webp)$/i;

function listPhotoFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isFile() && PHOTO_FILE_NAME.test(d.name))
    .map((d) => d.name)
    .sort((a, b) => a.localeCompare(b, "en"));
}

function buildPhotoList(dir) {
  return JSON.stringify({ files: listPhotoFiles(dir) }, null, 1) + "\n";
}

function main() {
  const out = path.join(ROOT, "feed", "photos.json");
  const next = buildPhotoList(path.join(ROOT, "photos"));
  const prev = fs.existsSync(out) ? fs.readFileSync(out, "utf8") : "";
  if (prev === next) {
    console.log("feed/photos.json guncel.");
    return;
  }
  fs.writeFileSync(out, next);
  console.log("feed/photos.json yazildi: " + JSON.parse(next).files.length + " dosya.");
}

if (require.main === module) main();

module.exports = { listPhotoFiles, buildPhotoList, PHOTO_FILE_NAME };
