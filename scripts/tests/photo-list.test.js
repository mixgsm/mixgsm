// scripts/generate-photo-list.js birim testleri (node --test scripts/tests/photo-list.test.js).
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { listPhotoFiles, buildPhotoList } = require("../generate-photo-list");

function tempDir(names) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "mixgsm-photos-"));
  names.forEach((n) => fs.writeFileSync(path.join(dir, n), ""));
  fs.mkdirSync(path.join(dir, "alt-klasor.jpg"));
  return dir;
}

test("yalnizca guvenli adli gorsel dosyalari, sirali listelenir", () => {
  const dir = tempDir(["B-2.jpg", "A.webp", ".gitkeep", "not.txt", "kotu ad.jpg", "C.PNG"]);
  assert.deepEqual(listPhotoFiles(dir), ["A.webp", "B-2.jpg", "C.PNG"]);
});

test("cikti kararlidir (ayni klasor = ayni icerik, gereksiz commit yok)", () => {
  const dir = tempDir(["Z.jpg", "A.jpg"]);
  const a = buildPhotoList(dir);
  assert.equal(a, buildPhotoList(dir));
  assert.deepEqual(JSON.parse(a), { files: ["A.jpg", "Z.jpg"] });
});

test("depodaki gercek photos/ klasoru listelenebilir", () => {
  const files = listPhotoFiles(path.join(__dirname, "..", "..", "photos"));
  assert.ok(files.length > 50);
  assert.ok(files.includes("gorsel-yok.jpg"));
});
