// MIX GSM - IndexNow bildirimi (Bing, Yandex ve IndexNow kullanan diger arama motorlari)
//
//   node scripts/indexnow-submit.js <degisen-dosyalar.txt>
//
// NEDEN: ChatGPT'nin web aramasi buyuk olcude Bing'e dayanir. Fiyat/stok
// degistiginde Bing'in sayfayi hemen yeniden taramasi icin degisen adresler
// IndexNow'a bildirilir. Google IndexNow kullanmaz (o site haritasini okur).
//
// Girdi: katalog commit'inde degisen dosyalarin listesi (git diff --cached --name-only).
// Anahtar: depo kokundeki <32 hex>.txt dosyasi (icinde yalniz anahtar yazar).
// Hata olursa yalnizca uyari verir; katalog yayinini ASLA engellemez.
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SITE = "https://mixgsm.tr";
const HOST = "mixgsm.tr";
const ENDPOINT = "https://api.indexnow.org/indexnow";
const MAX_URLS = 10000;

function findKey(root) {
  const f = fs.readdirSync(root).find((n) => /^[a-f0-9]{32}\.txt$/.test(n));
  if (!f) return null;
  const key = fs.readFileSync(path.join(root, f), "utf8").trim();
  return key === f.slice(0, 32) ? key : null;
}

// Dosya yolu -> sayfa adresi. Yalniz yayinlanan HTML sayfalari bildirilir.
function fileToUrl(rel) {
  const p = String(rel).trim().replace(/\\/g, "/");
  if (!p || p.startsWith(".") || p.includes("..")) return null;
  if (p === "index.html") return `${SITE}/`;
  const m = p.match(/^([a-z0-9-]+(?:\/[a-z0-9-]+)?)\/index\.html$/);
  return m ? `${SITE}/${m[1]}/` : null;
}

function urlsFromList(text) {
  return [...new Set(String(text).split(/\r?\n/).map(fileToUrl).filter(Boolean))].slice(0, MAX_URLS);
}

async function main() {
  const listFile = process.argv[2];
  if (!listFile || !fs.existsSync(listFile)) { console.log("IndexNow: degisen dosya listesi yok, atlandi."); return; }
  const key = findKey(ROOT);
  if (!key) { console.log("::warning::IndexNow anahtar dosyasi bulunamadi, atlandi."); return; }
  const urlList = urlsFromList(fs.readFileSync(listFile, "utf8"));
  if (!urlList.length) { console.log("IndexNow: bildirilecek sayfa yok."); return; }
  const res = await fetch(ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify({ host: HOST, key, keyLocation: `${SITE}/${key}.txt`, urlList }),
  });
  if (res.status === 200 || res.status === 202) console.log(`IndexNow: ${urlList.length} adres bildirildi (HTTP ${res.status}).`);
  else console.log(`::warning::IndexNow yaniti HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
}

if (require.main === module) {
  main().catch((err) => console.log("::warning::IndexNow bildirilemedi: " + err.message));
}

module.exports = { fileToUrl, urlsFromList, findKey };
