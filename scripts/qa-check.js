// MIX GSM - yayin oncesi otomatik QA (tek komut)
//
//   node scripts/qa-check.js            -> tum kontroller; HATA varsa cikis kodu 1
//
// Kapsam: HTML (lang/title/description/canonical, duplicate id, alt, kirik yerel
// dosya, ic #link hedefi, JSON-LD), guvenlik (CSP, noopener, http://, javascript:,
// satir ici on...= handler), linkler (WhatsApp numarasi = onayli numara, bilinmeyen
// dis alan adi), JS (sozdizimi, eval/document.write/debugger/console.log), veri
// (katalog dogrulayicilari), gorseller (saglik raporu, uyari) ve JS/CSP tutarliligi.
// Ag istegi YAPMAZ (dis linklerin canli durumu kontrol edilmez).
"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");
const schema = require("./lib/catalog-schema");
const { checkAssets, readAppSource } = require("./asset-version");
const { loadSiteImageMatcher, checkPhoneImages, checkLaptopImages } = require("./check-images");
const { checkLaptopStage } = require("./lib/laptop-stage");

const HTML_PAGES = [
  { file: "index.html", requireCanonical: true },
  { file: "fiyat-listesi/index.html", requireCanonical: true },
  { file: "price-assets/index.html", requireCanonical: false },
];
// Bilinen dis alan adlari; digerleri UYARI olarak raporlanir.
const KNOWN_HOSTS = new Set([
  "mixgsm.tr", "wa.me", "web.whatsapp.com", "maps.app.goo.gl", "www.instagram.com", "www.facebook.com",
  "t.me", "www.gsmarena.com", "raw.githubusercontent.com", "docs.google.com", "api.github.com",
  "schema.org", "www.sitemaps.org", "www.w3.org",
]);
const DEFAULT_WA_NUMBER = "905424818255";

function onayliWhatsapp(root) {
  try {
    const b = JSON.parse(fs.readFileSync(path.join(root, "feed", "business.public.json"), "utf8"));
    const phone = (b.contact.phones || []).find((p) => p.role === "order_whatsapp");
    return phone ? phone.e164.replace(/\D/g, "") : DEFAULT_WA_NUMBER;
  } catch (e) {
    return DEFAULT_WA_NUMBER;
  }
}

// Isaretleme analizi icin script/style icerigi ve HTML yorumlari cikarilir.
function markupOnly(html) {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "<script></script>")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "<style></style>");
}

function attrValues(markup, attr) {
  return [...markup.matchAll(new RegExp(`\\s${attr}=(?:"([^"]*)"|'([^']*)')`, "gi"))].map((m) => (m[1] !== undefined ? m[1] : m[2]));
}

// wa.me/<numara> ve ?phone=<numara> iceren her yerde numara onayli numara olmali.
function wrongWhatsappNumbers(text, waNumber) {
  const numbers = [...text.matchAll(/(?:wa\.me\/|[?&]phone=)(\d{10,15})/g)].map((m) => m[1]);
  return [...new Set(numbers)].filter((n) => n !== waNumber);
}

function checkHtml(root, rel, { requireCanonical, waNumber = DEFAULT_WA_NUMBER } = {}) {
  const errors = [];
  const warnings = [];
  const file = path.join(root, rel);
  const html = fs.readFileSync(file, "utf8");
  const markup = markupOnly(html);
  const err = (m) => errors.push(`${rel}: ${m}`);

  if (!/<html\b[^>]*\slang="[^"]+"/i.test(html)) err("<html lang> eksik");
  if (!/<title>[^<]+<\/title>/i.test(html)) err("<title> eksik/bos");
  // Indekslenen sayfalar (canonical zorunlu olanlar) description da tasimali.
  if (requireCanonical && !/<meta name="description" content="[^"]+"/i.test(html)) err("meta description eksik");
  if (requireCanonical && !/<link rel="canonical" href="https:\/\/[^"]+"/i.test(html)) err("canonical eksik");

  const ids = attrValues(markup, "id");
  const seen = new Set();
  ids.forEach((id) => { if (seen.has(id)) err(`duplicate id: ${id}`); seen.add(id); });

  [...markup.matchAll(/<img\b[^>]*>/gi)].forEach((m) => {
    if (!/\salt=/i.test(m[0])) err(`alt eksik: ${m[0].slice(0, 80)}`);
    if (/\srole=["']button["']/i.test(m[0])) err(`img role=button (gercek <button> kullanin): ${m[0].slice(0, 80)}`);
  });
  if (attrValues(markup, "src").some((v) => !v.trim())) err("bos src=\"\" (JS atayacaksa ozniteligi hic yazmayin)");
  if (attrValues(markup, "href").some((v) => !v.trim())) err("bos href=\"\"");

  // Meta CSP yalnizca kendisinden SONRA gelen icerige uygulanir: satir ici
  // script'lerden once durmali.
  const cspAt = html.search(/<meta http-equiv="Content-Security-Policy"/i);
  const inlineScriptAt = html.search(/<script(?![^>]*\ssrc=)(?![^>]*type="application\/ld\+json")[^>]*>/i);
  if (cspAt > -1 && inlineScriptAt > -1 && inlineScriptAt < cspAt) err("CSP meta satir ici script'ten sonra geliyor (en uste tasiyin)");

  const refs = attrValues(markup, "src").concat(attrValues(markup, "href"));
  refs.forEach((u) => {
    if (/^javascript:/i.test(u)) return err(`javascript: URL: ${u}`);
    if (/^http:\/\//i.test(u)) return err(`guvensiz http:// link: ${u}`);
    if (u.startsWith("#")) {
      const target = u.slice(1);
      if (target && !target.startsWith("urun/") && !target.startsWith("laptop/") && !seen.has(target)) err(`ic link hedefi yok: ${u}`);
      return;
    }
    if (/^(https?:|mailto:|tel:|data:|\/\/)/i.test(u)) {
      if (/^https:/i.test(u)) {
        const host = new URL(u).hostname;
        if (!KNOWN_HOSTS.has(host)) warnings.push(`${rel}: bilinmeyen dis alan adi: ${host}`);
      }
      return;
    }
    const clean = u.split(/[?#]/)[0];
    if (!clean) return;
    // "/x" site kokune, "x" sayfanin klasorune goredir.
    let target = clean.startsWith("/") ? path.join(root, clean) : path.resolve(path.dirname(file), clean);
    if (clean.endsWith("/")) target = path.join(target, "index.html");
    if (!fs.existsSync(target)) err(`kirik yerel dosya: ${u}`);
  });

  [...markup.matchAll(/<a\b[^>]*target=["']_blank["'][^>]*>/gi)].forEach((m) => {
    if (!/rel=["'][^"']*noopener/i.test(m[0])) err(`target=_blank noopener'siz: ${m[0].slice(0, 90)}`);
  });

  [...markup.matchAll(/<[a-z][^<>]*\s(on[a-z]+)\s*=/gi)].forEach((m) => err(`satir ici olay handler'i: ${m[1]}`));

  [...html.matchAll(/<script type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/gi)].forEach((m, i) => {
    if (!m[1].trim()) return; // JS ile doldurulan bos blok
    try { JSON.parse(m[1]); } catch (e) { err(`JSON-LD #${i + 1} gecersiz: ${e.message}`); }
  });

  // Yorumlar haric isaretleme (eski numaradan bahseden bir yorum CI'i kirmasin).
  wrongWhatsappNumbers(markup, waNumber).forEach((n) => err(`onayli olmayan WhatsApp numarasi: ${n}`));

  return { errors, warnings };
}

function checkJs(name, source, { waNumber = DEFAULT_WA_NUMBER } = {}) {
  const errors = [];
  const err = (m) => errors.push(`${name}: ${m}`);
  try { new vm.Script(source, { filename: name }); } catch (e) { err(`sozdizimi hatasi: ${e.message}`); }
  const banned = [
    [/\beval\s*\(/, "eval("], [/\bnew Function\s*\(/, "new Function("], [/document\.write\s*\(/, "document.write("],
    [/\bdebugger\b/, "debugger"], [/console\.(log|debug)\s*\(/, "console.log/debug"],
  ];
  banned.forEach(([re, label]) => { if (re.test(source)) err(`yasak kullanim: ${label}`); });
  [...source.matchAll(/<[a-z][^<>]*\s(on[a-z]+)\s*=\s*["'\\]/gi)].forEach((m) => err(`HTML sablonunda satir ici handler: ${m[1]}`));
  if (/["'`]\s*javascript:/i.test(source)) err("javascript: URL metni");
  wrongWhatsappNumbers(source, waNumber).forEach((n) => err(`onayli olmayan WhatsApp numarasi: ${n}`));
  return { errors, warnings: [] };
}

function readProducts(root, file) {
  return JSON.parse(fs.readFileSync(path.join(root, file), "utf8")).products || [];
}

function runQa(root, { quiet = false } = {}) {
  const sections = [];
  const run = (name, fn) => {
    let r;
    try { r = fn(); } catch (e) { r = { errors: [`${name}: calistirilamadi: ${e.message}`], warnings: [] }; }
    sections.push({ name, errors: r.errors, warnings: r.warnings || [] });
  };
  const waNumber = onayliWhatsapp(root);

  run("HTML + linkler + guvenlik", () => {
    const out = { errors: [], warnings: [] };
    HTML_PAGES.filter((p) => fs.existsSync(path.join(root, p.file))).forEach((p) => {
      const r = checkHtml(root, p.file, { requireCanonical: p.requireCanonical, waNumber });
      out.errors.push(...r.errors); out.warnings.push(...r.warnings);
    });
    return out;
  });
  run("JS", () => checkJs("js/app.<hash>.js", readAppSource(root), { waNumber }));
  run("CSP + JS surumu", () => ({ errors: checkAssets(root), warnings: [] }));
  run("Veri", () => {
    const phone = schema.validatePhoneCatalog(readProducts(root, "catalog.json"));
    const laptop = schema.validateLaptopCatalog(readProducts(root, "catalog-laptop.json"));
    return { errors: phone.errors.concat(laptop.errors), warnings: phone.warnings.concat(laptop.warnings) };
  });
  run("Gorseller", () => {
    const matcher = loadSiteImageMatcher(root);
    const photos = fs.readdirSync(path.join(root, "photos"));
    const lp = [];
    const walk = (d, pre) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) =>
      e.isDirectory() ? walk(path.join(d, e.name), pre + e.name + "/") : lp.push(pre + e.name));
    walk(path.join(root, "laptop-photos"), "");
    const ph = checkPhoneImages(readProducts(root, "catalog.json"), matcher, photos);
    const la = checkLaptopImages(readProducts(root, "catalog-laptop.json"), lp);
    const warnings = ph.broken.concat(ph.fallback.map((x) => "gorsel yok: " + x), la.broken, la.noImage.map((x) => "laptop gorsel yok: " + x));
    return { errors: [], warnings };
  });
  run("Laptop foto sahnesi", () => checkLaptopStage(root));

  const errors = sections.flatMap((s) => s.errors);
  const warnings = sections.flatMap((s) => s.warnings);
  if (!quiet) {
    console.log("MIX GSM QA RAPORU");
    sections.forEach((s) => console.log(`${s.errors.length ? "HATA " : "OK   "} ${s.name}: ${s.errors.length} hata, ${s.warnings.length} uyari`));
    errors.forEach((e) => console.log(`::error::${e}`));
    warnings.forEach((w) => console.log(`::warning::${w}`));
    console.log(errors.length ? `SONUC: ${errors.length} HATA - yayina uygun degil.` : "SONUC: hata yok.");
  }
  return { errors, warnings, sections };
}

if (require.main === module) {
  const r = runQa(path.join(__dirname, ".."));
  if (r.errors.length) process.exitCode = 1;
}

module.exports = { checkHtml, checkJs, runQa };
