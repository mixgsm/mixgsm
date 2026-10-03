// MIX GSM - Google Sheets TSV ayristirici (telefon + laptop ortak).
//
// Google Sheets "format=tsv" disa aktariminda bir hucre satir sonu, sekme veya
// cift tirnak iceriyorsa hucre cift tirnakla sarilir ve icteki tirnak ikilenir
// (CSV kurali). Eski "split('\n') + split('\t')" yaklasimi boyle bir hucrede
// satiri ikiye boluyor, sonraki sutunlar kayiyordu (fiyat stok sutununa vb.).
//
// AYNI KURAL js/app.<hash>.js icindeki parseTsvRows() kopyasindadir; biri
// degisirse digeri de degismeli (scripts/tests/tsv.test.js ikisini birlikte
// dogrular).
//
// Kapanmayan / ardindan ayirici gelmeyen tirnak (bozuk veri) dosyanin geri
// kalanini yutmasin diye o hucre DUZ METIN sayilir.
"use strict";

function parseTsvRows(text) {
  const s = String(text == null ? "" : text).replace(/^﻿/, "");
  const n = s.length;
  const rows = [];
  let row = [];
  let i = 0;
  if (!n) return rows;
  while (i < n) {
    let field;
    let end = -1;
    if (s[i] === '"') {
      let j = i + 1;
      let buf = "";
      let closed = false;
      while (j < n) {
        if (s[j] === '"') {
          if (s[j + 1] === '"') { buf += '"'; j += 2; continue; }
          closed = true;
          j++;
          break;
        }
        buf += s[j];
        j++;
      }
      if (closed && (j >= n || s[j] === "\t" || s[j] === "\n" || s[j] === "\r")) {
        field = buf;
        end = j;
      }
    }
    if (end < 0) {
      let k = i;
      while (k < n && s[k] !== "\t" && s[k] !== "\n") k++;
      field = s.slice(i, k);
      if (field.endsWith("\r")) field = field.slice(0, -1);
      end = k;
    }
    row.push(field);
    i = end;
    if (s[i] === "\r") i++;
    if (i >= n) break;
    if (s[i] === "\t") {
      i++;
      if (i >= n) row.push("");
      continue;
    }
    if (s[i] === "\n") {
      i++;
      rows.push(row);
      row = [];
    }
  }
  if (row.length) rows.push(row);
  return rows;
}

// Hucre temizligi: bas/son bosluk ve \r atilir; hucre ici satir sonlari tek
// bosluga indirilir (marka/model/fiyat gibi tek satirlik alanlar icin).
// keepNewlines: aciklama gibi cok satirli metin alanlarinda satir sonu korunur.
function cleanCell(value, keepNewlines) {
  const v = String(value == null ? "" : value).replace(/\r/g, "");
  return (keepNewlines ? v.replace(/[ \t]*\n[ \t]*/g, "\n").replace(/\n{3,}/g, "\n\n") : v.replace(/\s*\n\s*/g, " ")).trim();
}

module.exports = { parseTsvRows, cleanCell };
