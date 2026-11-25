// .github/workflows/update-catalog.yml statik kontrolleri (gercek Actions calistirmasi DEGILDIR).
// continue-on-error adimlarinin sonucu her zaman calisan ozet adiminda gorunur olmali.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const path = require("path");

const wf = fs.readFileSync(path.join(__dirname, "..", "..", ".github", "workflows", "update-catalog.yml"), "utf8");
const steps = wf.split(/\n      - name: /).slice(1).map((chunk) => ({
  name: chunk.split("\n")[0].trim(),
  id: (chunk.match(/^        id: ([a-z_]+)$/m) || [])[1] || null,
  cont: /^        continue-on-error: true$/m.test(chunk),
  body: chunk,
}));
const SUMMARY = "Izlenen adimlarin ozeti";

test("her continue-on-error adiminin benzersiz id'si var ve ozet adimi sonucunu (outcome) okuyor", () => {
  const summary = steps.find((s) => s.name === SUMMARY);
  assert.ok(summary, "ozet adimi yok");
  const watched = steps.filter((s) => s.cont && s.name !== SUMMARY);
  assert.ok(watched.length >= 10);
  const ids = watched.map((s) => s.id);
  assert.ok(ids.every(Boolean), "id'siz continue-on-error adimi: " + watched.filter((s) => !s.id).map((s) => s.name).join(", "));
  assert.equal(new Set(ids).size, ids.length, "tekrarlayan id");
  ids.forEach((id) => assert.ok(summary.body.includes(`\${{ steps.${id}.outcome }}`), `ozet ${id} sonucunu okumuyor`));
});

test("ozet adimi her durumda calisir, is akisini kirmizi yapmaz, son adimdir ve yayin zincirini degistirmez", () => {
  const summary = steps[steps.length - 1];
  assert.equal(summary.name, SUMMARY);
  assert.match(summary.body, /^        if: always\(\)$/m);
  assert.ok(summary.cont);
  assert.match(summary.body, /GITHUB_STEP_SUMMARY/);
  assert.match(summary.body, /exit 0\s*$/);
  assert.ok(!/git (push|commit)|gh workflow run/.test(summary.body), "ozet adimi commit/push/deploy yapmamali");
  // adim sonuclari betige ortam degiskeniyle gelir (ifadeler run icine gomulmez)
  assert.ok(!/run: \|[\s\S]*\$\{\{/.test(summary.body));
});

test("sitemap durum dosyasi commit'e eklenir; mevcut yayin adimlari yerinde", () => {
  assert.match(wf, /git add \.sitemap-state\.json/);
  const names = steps.map((s) => s.name);
  const commit = names.indexOf("Degisiklik varsa commit + push et");
  assert.ok(commit > names.indexOf("sitemap.xml guncelle"));
  assert.ok(names.indexOf("Yayin isini baslat (deploy-pages.yml)") > commit);
});
