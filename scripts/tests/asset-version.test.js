// scripts/asset-version.js birim testleri (node --test scripts/tests/asset-version.test.js).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { checkAssets, fixAssets, contentHash, inlineScriptHash } = require("../asset-version");

const THEME = "\n(function(){ document.documentElement.setAttribute('data-theme','dark'); })();\n";
const CSP_TPL = (hashes) =>
  `<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self' ${hashes}; object-src 'none';">`;

function makeSite({ appName, appBody = "console.info(1);", cspHashes, extraInline = "" }) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mixgsm-assets-"));
  fs.mkdirSync(path.join(dir, "js"));
  fs.writeFileSync(path.join(dir, "js", appName), appBody);
  const html = `<!doctype html><html><head><script>${THEME}</script>\n${CSP_TPL(cspHashes)}\n` +
    `<script type="application/ld+json">{"a":1}</script>\n<script src="js/${appName}" defer></script>` +
    `</head><body>${extraInline}</body></html>`;
  fs.writeFileSync(path.join(dir, "index.html"), html);
  return dir;
}

test("tutarli site hatasiz gecer", () => {
  const body = "var x = 1;";
  const dir = makeSite({ appName: `app.${contentHash(body)}.js`, appBody: body, cspHashes: `'${inlineScriptHash(THEME)}'` });
  assert.deepEqual(checkAssets(dir), []);
});

test("icerigi degisen JS dosyasi (eski hash adi) yakalanir ve duzeltilir", () => {
  const dir = makeSite({ appName: "app.0000000000.js", appBody: "var y = 2;", cspHashes: `'${inlineScriptHash(THEME)}'` });
  assert.ok(checkAssets(dir).some((e) => /hash/i.test(e)));
  fixAssets(dir);
  assert.deepEqual(checkAssets(dir), []);
  const expected = `app.${contentHash("var y = 2;")}.js`;
  assert.ok(fs.existsSync(path.join(dir, "js", expected)));
  assert.ok(!fs.existsSync(path.join(dir, "js", "app.0000000000.js")));
  assert.match(fs.readFileSync(path.join(dir, "index.html"), "utf8"), new RegExp(`src="js/${expected}"`));
});

test("CSP'de olmayan satir ici script (tema degisti) yakalanir ve duzeltilir", () => {
  const body = "var z;";
  const dir = makeSite({ appName: `app.${contentHash(body)}.js`, appBody: body, cspHashes: "'sha256-eski='" });
  assert.ok(checkAssets(dir).some((e) => /CSP/.test(e)));
  fixAssets(dir);
  assert.deepEqual(checkAssets(dir), []);
});

test("CSP'de 'unsafe-inline' veya hash'siz yeni satir ici script hata verir", () => {
  const body = "var q;";
  const unsafe = makeSite({ appName: `app.${contentHash(body)}.js`, appBody: body, cspHashes: `'unsafe-inline' '${inlineScriptHash(THEME)}'` });
  assert.ok(checkAssets(unsafe).some((e) => /unsafe-inline/.test(e)));
  const extra = makeSite({
    appName: `app.${contentHash(body)}.js`, appBody: body,
    cspHashes: `'${inlineScriptHash(THEME)}'`, extraInline: "<script>alert(1)</script>",
  });
  assert.ok(checkAssets(extra).some((e) => /CSP/.test(e)));
});

test("oznitelikli satir ici script (type=module) de CSP hash'i ister; JSON-LD ve src'li script istemez", () => {
  const body = "var m;";
  const dir = makeSite({
    appName: `app.${contentHash(body)}.js`, appBody: body,
    cspHashes: `'${inlineScriptHash(THEME)}'`, extraInline: '<script type="module">import("x")</script>',
  });
  assert.ok(checkAssets(dir).some((e) => /CSP/.test(e)));
  fixAssets(dir);
  assert.deepEqual(checkAssets(dir), []);
  const csp = fs.readFileSync(path.join(dir, "index.html"), "utf8").match(/script-src ([^;]*)/)[1];
  assert.equal(csp.split(" ").filter((x) => x.startsWith("'sha256-")).length, 2);
});

test("index.html'in referans verdigi JS dosyasi yoksa hata verir", () => {
  const body = "var w;";
  const dir = makeSite({ appName: `app.${contentHash(body)}.js`, appBody: body, cspHashes: `'${inlineScriptHash(THEME)}'` });
  fs.rmSync(path.join(dir, "js", `app.${contentHash(body)}.js`));
  assert.ok(checkAssets(dir).some((e) => /bulunamadi/.test(e)));
});

test("gercek depo tutarli (index.html + js/app.*.js + CSP)", () => {
  assert.deepEqual(checkAssets(path.join(__dirname, "..", "..")), []);
});
