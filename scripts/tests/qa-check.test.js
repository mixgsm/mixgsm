// scripts/qa-check.js birim testleri (node --test scripts/tests/qa-check.test.js).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { checkHtml, checkJs, runQa } = require("../qa-check");

function tmpSite(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mixgsm-qa-"));
  for (const [rel, body] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), body);
  }
  return dir;
}

const GOOD = `<!doctype html><html lang="tr"><head><title>T</title>
<meta name="description" content="d"><link rel="canonical" href="https://mixgsm.tr/">
<script type="application/ld+json">{"@type":"WebSite"}</script></head>
<body><a href="#iletisim">x</a><div id="iletisim"></div><img src="logo.jpg" alt="Logo">
<a href="https://wa.me/905424818255" target="_blank" rel="noopener noreferrer">W</a></body></html>`;

test("temiz HTML hatasiz gecer", () => {
  const dir = tmpSite({ "index.html": GOOD, "logo.jpg": "x" });
  const r = checkHtml(dir, "index.html", { requireCanonical: true });
  assert.deepEqual(r.errors, []);
});

test("HTML hatalari yakalanir: lang, duplicate id, alt, kirik dosya, noopener, http, bozuk JSON-LD, yanlis WhatsApp, kirik #link", () => {
  const bad = GOOD
    .replace('lang="tr"', "")
    .replace('<div id="iletisim"></div>', '<div id="a"></div><div id="a"></div>')
    .replace('alt="Logo"', "")
    .replace('src="logo.jpg"', 'src="yok.jpg"')
    .replace('rel="noopener noreferrer"', "")
    .replace('{"@type":"WebSite"}', "{bozuk")
    .replace("905424818255", "905551112233")
    .replace("</body>", '<a href="http://example.com">h</a><a href="javascript:alert(1)">j</a><button onclick="x()">b</button></body>');
  const dir = tmpSite({ "index.html": bad });
  const errors = checkHtml(dir, "index.html", { requireCanonical: true }).errors.join("\n");
  for (const re of [/lang/, /duplicate id: a/i, /alt/, /yok\.jpg/, /noopener/, /http:\/\/example\.com/, /JSON-LD/, /905551112233/, /#iletisim/, /javascript:/, /onclick/]) {
    assert.match(errors, re);
  }
});

test("JS kontrolleri: eval, document.write, debugger, console.log, satir ici handler, sozdizimi", () => {
  const r = checkJs("app.js", "eval('1'); document.write('x'); debugger; console.log(1); el.innerHTML = '<img onerror=\"x()\">';");
  const e = r.errors.join("\n");
  for (const re of [/eval/, /document\.write/, /debugger/, /console\.log/, /onerror/]) assert.match(e, re);
  assert.ok(checkJs("bozuk.js", "function ( {").errors.some((x) => /sozdizimi/i.test(x)));
  assert.deepEqual(checkJs("iyi.js", "const a = 1; console.warn('uyari');").errors, []);
});

test("WhatsApp numarasi JS'te de denetlenir; HTML yorumundaki eski numara hata sayilmaz; tek tirnakli oznitelik de kontrol edilir", () => {
  assert.ok(checkJs("app.js", "location.href = 'https://wa.me/905551112233';").errors.some((e) => /905551112233/.test(e)));
  assert.deepEqual(checkJs("app.js", "location.href = 'https://wa.me/905424818255';").errors, []);
  const html = GOOD.replace("</body>", "<!-- eski numara: wa.me/905551112233 --><a href='https://t.me/x' target='_blank'>t</a></body>");
  const dir = tmpSite({ "index.html": html, "logo.jpg": "x" });
  const errors = checkHtml(dir, "index.html", { requireCanonical: true }).errors.join("\n");
  assert.doesNotMatch(errors, /905551112233/);
  assert.match(errors, /noopener/);
});

test("gercek depo QA'dan hatasiz gecer", () => {
  const r = runQa(path.join(__dirname, "..", ".."), { quiet: true });
  assert.deepEqual(r.errors, []);
});
