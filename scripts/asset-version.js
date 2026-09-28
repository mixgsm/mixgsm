// MIX GSM - JS dosya surumu ve CSP hash tutarliligi
//
//   node scripts/asset-version.js          -> duzelt: js/app.*.js adini icerik hash'ine
//                                             gore yeniler, index.html'deki <script src>
//                                             ve CSP script-src hash'lerini gunceller
//   node scripts/asset-version.js --check  -> yalnizca kontrol; tutarsizlik varsa cikis 1
//
// NEDEN: GitHub Pages CDN'i sorgu parametresini (?v=...) yok sayar; dosya adinda
// icerik hash'i olmazsa deploy sonrasi bazi ziyaretciler eski JS + yeni HTML
// alabilir. Uygulama kodunu degistirdikten sonra bu script calistirilmalidir;
// CI testleri (scripts/tests/asset-version.test.js) unutulursa yakalar.
//
// CSP: satir ici calisan tek script (tema, sayfa boyanmadan once calismak
// zorunda) 'sha256-...' ile izinlidir; 'unsafe-inline' KULLANILMAZ.
// JSON-LD (type="application/ld+json") calistirilmaz, CSP kapsaminda degildir.
"use strict";

const crypto = require("crypto");
const fs = require("fs");
const path = require("path");

const APP_DIR = "js";
const APP_FILE = /^app\.[0-9a-f]{10}\.js$/;
const APP_TAG = /<script src="js\/(app\.[0-9a-f]{10}\.js)" defer><\/script>/;
// Tum <script> bloklari; src'li olanlar ve calistirilmayan veri bloklari
// (JSON-LD gibi) disinda kalan HER satir ici script CSP hash'i gerektirir.
const SCRIPT_BLOCK = /<script(\s[^>]*)?>([\s\S]*?)<\/script>/g;
const EXECUTABLE_TYPES = ["", "text/javascript", "application/javascript", "module"];
const CSP_META = /(<meta http-equiv="Content-Security-Policy" content=")([^"]*)(")/;

// HTML ayristirici CRLF'i LF'e cevirir; sunulan dosya da LF'dir. Hash'ler
// isletim sisteminden (Windows autocrlf) bagimsiz olsun diye LF'e normalize edilir.
const toLf = (s) => String(s).replace(/\r\n/g, "\n");

function contentHash(text) {
  return crypto.createHash("sha256").update(toLf(text), "utf8").digest("hex").slice(0, 10);
}

function inlineScriptHash(text) {
  return "sha256-" + crypto.createHash("sha256").update(toLf(text), "utf8").digest("base64");
}

function readSite(root) {
  const htmlPath = path.join(root, "index.html");
  const html = fs.readFileSync(htmlPath, "utf8");
  const tag = html.match(APP_TAG);
  const appFiles = fs.existsSync(path.join(root, APP_DIR))
    ? fs.readdirSync(path.join(root, APP_DIR)).filter((f) => APP_FILE.test(f))
    : [];
  return { htmlPath, html, referenced: tag ? tag[1] : null, appFiles };
}

function scriptSrcTokens(html) {
  const meta = html.match(CSP_META);
  if (!meta) return null;
  const directive = meta[2].split(";").map((d) => d.trim()).find((d) => d.startsWith("script-src "));
  return directive ? directive.split(/\s+/).slice(1) : [];
}

function isExecutableInline(attrs) {
  const a = String(attrs || "");
  if (/\ssrc\s*=/i.test(a)) return false;
  const type = (a.match(/\stype\s*=\s*["']?([^"'\s>]+)/i) || [null, ""])[1].toLowerCase();
  return EXECUTABLE_TYPES.includes(type);
}

function expectedInlineHashes(html) {
  return [...html.matchAll(SCRIPT_BLOCK)]
    .filter((m) => isExecutableInline(m[1]))
    .map((m) => `'${inlineScriptHash(m[2])}'`);
}

function checkAssets(root) {
  const errors = [];
  const { html, referenced, appFiles } = readSite(root);
  if (!referenced) {
    errors.push('index.html\'de <script src="js/app.<hash>.js" defer> bulunamadi');
  } else if (!appFiles.includes(referenced)) {
    errors.push(`index.html'in referans verdigi js/${referenced} bulunamadi`);
  } else {
    const actual = `app.${contentHash(fs.readFileSync(path.join(root, APP_DIR, referenced), "utf8"))}.js`;
    if (actual !== referenced) errors.push(`js/${referenced} icerigi degismis; hash'li ad ${actual} olmali (node scripts/asset-version.js)`);
  }
  if (appFiles.length > 1) errors.push(`js/ altinda birden fazla app.*.js var: ${appFiles.join(", ")}`);

  const tokens = scriptSrcTokens(html);
  if (!tokens) {
    errors.push("CSP meta etiketinde script-src bulunamadi");
  } else {
    if (tokens.includes("'unsafe-inline'")) errors.push("CSP script-src 'unsafe-inline' icermemeli");
    const hashes = tokens.filter((t) => t.startsWith("'sha256-"));
    const expected = expectedInlineHashes(html);
    expected.filter((h) => !hashes.includes(h)).forEach((h) => errors.push(`CSP'de olmayan satir ici script: ${h}`));
    hashes.filter((h) => !expected.includes(h)).forEach((h) => errors.push(`CSP'de artik kullanilmayan hash: ${h}`));
  }
  return errors;
}

function fixAssets(root) {
  const site = readSite(root);
  let html = site.html;
  const current = site.referenced && site.appFiles.includes(site.referenced) ? site.referenced : site.appFiles[0];
  if (!current) throw new Error("js/ altinda app.*.js yok; once uygulama kodunu js/app.<hash>.js olarak ekleyin");
  const body = fs.readFileSync(path.join(root, APP_DIR, current), "utf8");
  const next = `app.${contentHash(body)}.js`;
  if (next !== current) fs.renameSync(path.join(root, APP_DIR, current), path.join(root, APP_DIR, next));
  html = html.replace(APP_TAG, `<script src="js/${next}" defer></script>`);

  html = html.replace(CSP_META, (all, open, content, close) => {
    const directives = content.split(";").map((d) => d.trim()).filter(Boolean).map((d) =>
      d.startsWith("script-src ") ? ["script-src", "'self'", ...expectedInlineHashes(html)].join(" ") : d
    );
    return open + directives.join("; ") + ";" + close;
  });
  fs.writeFileSync(site.htmlPath, html);
  return next;
}

// index.html'in yukledigi uygulama kodunu (js/app.<hash>.js) dondurur; CI
// kontrolleri (check-images, sema testleri) site kodunu buradan okur.
function readAppSource(root) {
  const { referenced } = readSite(root);
  if (!referenced) throw new Error('index.html\'de <script src="js/app.<hash>.js" defer> bulunamadi');
  return fs.readFileSync(path.join(root, APP_DIR, referenced), "utf8");
}

function main() {
  const root = path.join(__dirname, "..");
  if (process.argv.includes("--check")) {
    const errors = checkAssets(root);
    errors.forEach((e) => console.log(`::error::asset-version: ${e}`));
    if (errors.length) process.exitCode = 1;
    else console.log("JS dosya adi ve CSP hash'leri tutarli.");
    return;
  }
  console.log("Guncel dosya: js/" + fixAssets(root));
}

if (require.main === module) main();

module.exports = { checkAssets, fixAssets, contentHash, inlineScriptHash, readAppSource };
