// Tarayici (Chromium) uctan uca testleri: 900px siniri, pencere/kaydirma
// kilidi, geri/ileri gecmisi, URL filtreleri, odak, kontrast, depolama hatasi,
// bozuk katalog. Calistirma: npm run test:browser  (Chromium gerekir:
// npx playwright install chromium). Gercek iOS Safari yerine GECMEZ.
"use strict";

const test = require("node:test");
const assert = require("node:assert/strict");
const { chromium } = require("playwright");
const { startServer, routeExternal, launchOptions } = require("./harness");

let browser, srv;
test.before(async () => {
  srv = await startServer();
  browser = await chromium.launch(launchOptions());
});
test.after(async () => {
  if (browser) await browser.close();
  if (srv) srv.server.close();
});

async function open(t, { width = 1280, height = 900, path = "", theme = "dark", catalogBody, init, reducedMotion, waitCards = true } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, colorScheme: theme, reducedMotion: reducedMotion || "no-preference", hasTouch: width < 800 });
  await routeExternal(ctx, { catalogBody });
  if (init) await ctx.addInitScript(init);
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("console", (m) => { if (m.type() === "error" && !/ERR_FAILED|net::|Failed to load resource/.test(m.text())) errors.push(m.text()); });
  await page.goto(srv.url + path, { waitUntil: "load" });
  if (waitCards) await page.waitForSelector("#grid .card");
  t.after(async () => { await ctx.close(); });
  return { ctx, page, errors };
}
const locked = (page) => page.evaluate(() => document.body.style.position === "fixed");
async function toLaptop(page) {
  await page.click("#toggleBtnLaptop");
  await page.waitForSelector("#laptopGrid .laptop-card");
}
const layout = (page, sel) => page.evaluate((s) => {
  const el = document.querySelector(s);
  const cs = getComputedStyle(el);
  return { position: cs.position, visibility: cs.visibility };
}, sel);

for (const [label, toggle, panel, layoutSel, colStart] of [
  ["telefon", "#filterToggleBtn", "#filterPanel", ".catalog-layout", "220px"],
  ["laptop", "#laptopFilterToggleBtn", "#laptopFilterPanel", "#laptop-section .laptop-catalog-layout", "240px"],
]) {
  test(`900px siniri (${label}): 899/900 cekmece, 901 yan sutun; acik cekmece genisleyince kapanir`, async (t) => {
    const { page, errors } = await open(t, { width: 899, height: 800 });
    if (label === "laptop") await toLaptop(page);
    for (const w of [899, 900]) {
      await page.setViewportSize({ width: w, height: 800 });
      assert.notEqual(await page.$eval(toggle, (b) => getComputedStyle(b).display), "none", `${w}: Filtrele gorunmeli`);
      const l = await layout(page, panel);
      assert.equal(l.position, "fixed", `${w}: panel cekmece olmali`);
      assert.equal(l.visibility, "hidden", `${w}: kapali cekmece gizli olmali`);
      const cols = await page.$eval(layoutSel, (el) => getComputedStyle(el).gridTemplateColumns);
      assert.ok(!cols.startsWith(colStart), `${w}: yan sutun olmamali (${cols})`);
    }
    await page.setViewportSize({ width: 901, height: 800 });
    assert.equal(await page.$eval(toggle, (b) => getComputedStyle(b).display), "none");
    assert.equal((await layout(page, panel)).position, "sticky");
    assert.ok((await page.$eval(layoutSel, (el) => getComputedStyle(el).gridTemplateColumns)).startsWith(colStart));

    // 900'de ac -> 1200'e genislet: open + kaydirma kilidi kalmamali
    await page.setViewportSize({ width: 900, height: 800 });
    await page.click(toggle);
    assert.equal((await layout(page, panel)).visibility, "visible");
    assert.equal(await locked(page), true);
    await page.setViewportSize({ width: 1200, height: 800 });
    await page.waitForTimeout(100);
    assert.equal(await page.$eval(panel, (p) => p.classList.contains("open")), false);
    assert.equal(await locked(page), false);
    // tekrar dar: Escape ile kapanir, odak Filtrele dugmesine doner
    await page.setViewportSize({ width: 375, height: 800 });
    await page.click(toggle);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(50);
    assert.equal(await page.$eval(panel, (p) => p.classList.contains("open")), false);
    assert.equal(await locked(page), false);
    assert.equal(await page.evaluate((s) => document.activeElement === document.querySelector(s), toggle), true);
    assert.deepEqual(errors, []);
  });
}

test("telefon penceresi: kapat dugmesi kaydirmada gorunur, fiyat+WhatsApp alani altta, son satiri ortmez", async (t) => {
  const { page, errors } = await open(t, { width: 375, height: 667 });
  const opener = page.locator("#grid .card .card-open").first();
  await opener.click();
  await page.waitForSelector("#modal.open");
  await page.waitForTimeout(350);               // acilis gecisi (scale .97 -> 1) bitsin
  const wa = await page.$eval("#mw", (a) => decodeURIComponent(a.href));
  const [name, spec] = await page.$$eval("#mn, #mfspec", (els) => els.map((e) => e.textContent));
  assert.ok(wa.startsWith("https://wa.me/905424818255?text="));
  assert.ok(wa.includes(name) && wa.includes(spec) && /stok ve fiyat/.test(wa), wa);
  // Ortadayken alan ekranda
  await page.$eval("#modal .modalbox", (b) => { b.scrollTop = b.scrollHeight / 3; });
  await page.waitForTimeout(50);
  const midCta = await page.$eval("#modal .modal-cta", (c) => c.getBoundingClientRect().bottom);
  assert.ok(midCta <= 667 + 1, "fiyat/WhatsApp alani ekranda olmali");
  // En altta: kapat tiklanabilir, son tablo satiri alanin ustunde
  await page.$eval("#modal .modalbox", (b) => { b.scrollTop = b.scrollHeight; });
  await page.waitForTimeout(50);
  const res = await page.evaluate(() => {
    const c = document.querySelector("#modal .close").getBoundingClientRect();
    const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
    const rows = [...document.querySelectorAll("#modal .spec-table tr")].filter((r) => r.style.display !== "none");
    const lastRow = rows[rows.length - 1].getBoundingClientRect();
    const cta = document.querySelector("#modal .modal-cta").getBoundingClientRect();
    return { closeVisible: c.top >= 0 && !!hit && !!hit.closest(".close"), w: c.width, rowBottom: lastRow.bottom, ctaTop: cta.top };
  });
  assert.equal(res.closeVisible, true);
  assert.ok(res.w >= 44, "kapat dokunma alani >= 44px");
  assert.ok(res.rowBottom <= res.ctaTop + 1, "son teknik satir ortulmemeli");
  // Escape: kapanir, adres temizlenir, kilit kalkar, odak acan dugmeye doner
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("modal").classList.contains("open") && !location.hash);
  assert.equal(await locked(page), false);
  assert.equal(await opener.evaluate((b) => document.activeElement === b), true);
  assert.deepEqual(errors, []);
});

test("laptop penceresi: kapat seridi ve WhatsApp alani; ikinci el ozeti yalniz dolu alanlar", async (t) => {
  const { page, errors } = await open(t, { width: 375, height: 667 });
  await toLaptop(page);
  await page.locator("#laptopGrid .laptop-card .card-open").first().click();
  await page.waitForSelector("#laptopModal.open");
  await page.$eval("#laptopModal .laptop-modalbox", (b) => { b.scrollTop = b.scrollHeight; });
  await page.waitForTimeout(50);
  const r = await page.evaluate(() => {
    const c = document.getElementById("laptopModalCloseBtn").getBoundingClientRect();
    const hit = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
    const items = [...document.querySelectorAll("#laptopUsedSummaryList li")].map((li) => li.textContent);
    return { ok: !!hit && hit.closest("#laptopModalCloseBtn") !== null, items, hidden: document.getElementById("laptopUsedSummary").hidden };
  });
  assert.equal(r.ok, true);
  // Dolu alanlar "Etiket: değer" biçiminde; tek istisna onaylı "takas yok" cümlesi.
  if (!r.hidden) r.items.forEach((t2) => assert.ok(t2 === "Takas seçeneğimiz yoktur." || /^(Kozmetik|Pil|Garanti|Kutu|Fatura|Adaptör): \S/.test(t2), t2));
  assert.deepEqual(errors, []);
});

test("gecmis: telefon ac/kapat/ileri/geri; laptop ac/kapat -> telefona gec -> ileri", async (t) => {
  const { page, errors } = await open(t, { width: 1280, height: 900 });
  await page.locator("#grid .card .card-open").first().click();
  await page.waitForFunction(() => location.hash.startsWith("#urun/"));
  await page.click("#modal .close");
  await page.waitForFunction(() => !location.hash && !document.getElementById("modal").classList.contains("open"));
  await page.goForward();
  await page.waitForFunction(() => document.getElementById("modal").classList.contains("open"));
  assert.equal(await locked(page), true);
  await page.goBack();
  await page.waitForFunction(() => !document.getElementById("modal").classList.contains("open"));
  assert.equal(await locked(page), false);

  await toLaptop(page);
  await page.locator("#laptopGrid .laptop-card .card-open").first().click();
  await page.waitForFunction(() => location.hash.startsWith("#laptop/"));
  await page.click("#laptopModalCloseBtn");
  await page.waitForFunction(() => !location.hash);
  await page.click("#toggleBtnPhone");
  await page.goForward();
  await page.waitForFunction(() => document.getElementById("laptopModal").classList.contains("open"));
  const st = await page.evaluate(() => ({
    sectionHidden: document.getElementById("laptop-section").hidden,
    inert: document.getElementById("laptop-section").hasAttribute("inert"),
    laptopTab: document.getElementById("toggleBtnLaptop").classList.contains("active"),
    visible: document.getElementById("laptopModal").getBoundingClientRect().height > 0,
  }));
  assert.deepEqual(st, { sectionHidden: false, inert: false, laptopTab: true, visible: true });
  await page.keyboard.press("Escape");
  await page.waitForFunction(() => !document.getElementById("laptopModal").classList.contains("open"));
  assert.equal(await locked(page), false);
  assert.deepEqual(errors, []);
});

test("dogrudan urun baglantilari: #urun/ ve #laptop/ acilir", async (t) => {
  const { page: p1 } = await open(t, { path: "#urun/xiaomi-redmi-a7-pro" });
  await p1.waitForSelector("#modal.open");
  assert.match(await p1.textContent("#mn"), /REDMI A7 PRO/);
  const { page: p2 } = await open(t, { path: "#laptop/acer-nitro-5-pc-001", waitCards: false });
  await p2.waitForSelector("#laptopModal.open");
  assert.equal(await p2.textContent("#lmn"), "NITRO 5");
  assert.equal(await p2.$eval("#laptop-section", (s) => s.hidden), false);
});

test("ust uste pencereler: Escape yalniz en usttekini kapatir, kilit son pencereyle kalkar", async (t) => {
  const { page, errors } = await open(t, { width: 1280, height: 900 });
  await toLaptop(page);
  await page.click("#laptopFindBtn");
  await page.waitForSelector("#laptopFinderModal.open");
  await page.click("#lfPrivacyBtn");
  await page.waitForSelector("#legalmodal.open");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(50);
  assert.equal(await page.$eval("#legalmodal", (m) => m.classList.contains("open")), false);
  assert.equal(await page.$eval("#laptopFinderModal", (m) => m.classList.contains("open")), true);
  assert.equal(await locked(page), true, "form acikken arka plan kilitli kalmali");
  // Tab form icinde doner
  for (let i = 0; i < 25; i++) await page.keyboard.press("Tab");
  assert.equal(await page.evaluate(() => document.getElementById("laptopFinderModal").contains(document.activeElement)), true);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(50);
  assert.equal(await page.$eval("#laptopFinderModal", (m) => m.classList.contains("open")), false);
  assert.equal(await locked(page), false);
  assert.deepEqual(errors, []);
});

test("magaza degisirken gizlenen bolumdeki cekmece kapanir (gorunmez pencere/kilit kalmaz)", async (t) => {
  const { page } = await open(t, { width: 375, height: 700 });
  await toLaptop(page);
  await page.click("#laptopFilterToggleBtn");
  assert.equal(await locked(page), true);
  await page.evaluate(() => document.getElementById("toggleBtnPhone").click());
  assert.equal(await page.$eval("#laptopFilterPanel", (p) => p.classList.contains("open")), false);
  assert.equal(await locked(page), false);
  // telefon cekmecesi acikken kategori degistir
  await page.click("#filterToggleBtn");
  await page.click('#categoryFilters button[data-group="PERSONAL_CARE"]');
  assert.equal(await page.$eval("#filterPanel", (p) => p.classList.contains("open")), true);
  assert.match(await page.textContent("#count"), /\d+ ürün/);
  await page.click("#filterBackdrop", { position: { x: 10, y: 10 } });
  assert.equal(await locked(page), false);
});

test("paylasilabilir filtreler: URL'den okunur, gecersiz deger yok sayilir, degisince URL guncellenir", async (t) => {
  const { page, errors } = await open(t, { path: "?ara=iphone&sira=low&marka=%3Cscript%3E" });
  assert.equal(await page.inputValue("#q"), "iphone");
  assert.equal(await page.inputValue("#sort"), "low");
  assert.equal(await page.$eval('#filters button[data-cat="ALL"]', (b) => b.classList.contains("active")), true);
  const names = await page.$$eval("#grid .card .card-open", (b) => b.map((x) => x.textContent));
  assert.ok(names.length > 0 && names.every((n) => /IPHONE/i.test(n)), names.join(","));
  await page.fill("#q", "poco");
  await page.waitForFunction(() => new URLSearchParams(location.search).get("ara") === "poco");
  assert.equal(new URL(page.url()).searchParams.get("marka"), null);

  const { page: lp } = await open(t, { path: "?magaza=laptop&lmarka=ACER&lsira=low", waitCards: false });
  await lp.waitForSelector("#laptopGrid .laptop-card");
  assert.equal(await lp.$eval("#toggleBtnLaptop", (b) => b.classList.contains("active")), true);
  const brands = await lp.$$eval("#laptopGrid .laptop-card-brand", (els) => els.map((e) => e.textContent));
  assert.ok(brands.length > 0 && brands.every((b) => b === "ACER"), brands.join(","));
  assert.equal(await lp.$eval('#laptopBrandGroup button[data-val="ACER"]', (b) => b.classList.contains("active")), true);
  assert.deepEqual(errors, []);
});

test("klavye odagi: laptop aramasi ve katalog kontrollerinde gorunur odak halkasi", async (t) => {
  const { page } = await open(t, { width: 1280, height: 900 });
  await toLaptop(page);
  await page.focus("#laptopSort");
  await page.keyboard.press("Shift+Tab");      // arama kutusuna klavyeyle
  const ring = await page.evaluate(() => {
    const w = document.querySelector("#laptop-section .laptop-search");
    const cs = getComputedStyle(w);
    return { active: document.activeElement.id, style: cs.outlineStyle, width: parseFloat(cs.outlineWidth) };
  });
  assert.equal(ring.active, "laptopQ");
  assert.equal(ring.style, "solid");
  assert.ok(ring.width >= 2);
  // Sonraki 30 sekme durağinda her odakli ogenin (ya da kart/kutu sarmalayicisinin) halkasi var
  const missing = [];
  for (let i = 0; i < 30; i++) {
    await page.keyboard.press("Tab");
    const r = await page.evaluate(() => {
      const a = document.activeElement;
      const has = (el) => el && getComputedStyle(el).outlineStyle !== "none" && parseFloat(getComputedStyle(el).outlineWidth) > 0;
      const ok = has(a) || has(a.closest(".card, .laptop-card, .laptop-search, .search"));
      return ok ? null : (a.id || a.className || a.tagName);
    });
    if (r) missing.push(r);
  }
  assert.deepEqual(missing, []);
});

test("acik tema: 'Tükendi' ve stok uyarilari >= 4.5:1, fotograf penceresi kapatma simgesi acik renk", async (t) => {
  const { page } = await open(t, { theme: "light" });
  const r = await page.evaluate(() => {
    // rgb(...) ve color(srgb r g b / a) bicimlerini okur
    const parse = (c) => {
      const m = c.match(/color\(srgb ([^)]+)\)/);
      if (m) { const v = m[1].split(/[\s/]+/).filter(Boolean).map(Number); return [v[0] * 255, v[1] * 255, v[2] * 255, v.length > 3 ? v[3] : 1]; }
      const v = c.match(/[\d.]+/g).map(Number); return [v[0], v[1], v[2], v.length > 3 ? v[3] : 1];
    };
    const L = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
    const ratio = (a, b) => { const x = L(a), y = L(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
    const el = document.createElement("span"); el.className = "stock no"; el.textContent = "Tükendi";
    const host = document.querySelector("#grid .card .visual"); host.appendChild(el);
    const fg = parse(getComputedStyle(el).color);
    const base = parse(getComputedStyle(host).backgroundColor);
    const tint = parse(getComputedStyle(el).backgroundColor);
    const bg = [0, 1, 2].map((k) => tint[k] * tint[3] + base[k] * (1 - tint[3]));
    const lb = document.querySelector(".lightbox-close");
    return { ratioOnBase: ratio(fg, bg), lbColor: getComputedStyle(lb).color };
  });
  assert.ok(r.ratioOnBase >= 4.5, `Tükendi kontrasti ${r.ratioOnBase.toFixed(2)}`);
  assert.equal(r.lbColor, "rgb(255, 255, 255)");
});

test("mobil: favori + karsilastirma cubuklari ust uste binmez, alt menunun ustunde", async (t) => {
  const { page } = await open(t, { width: 375, height: 740 });
  await page.locator("#grid .card .fav").first().click();
  await page.locator("#grid .card .compare-toggle").nth(0).click();
  await page.locator("#grid .card .compare-toggle").nth(1).click();
  await page.waitForTimeout(400);
  const r = await page.evaluate(() => {
    const a = document.getElementById("comparebar").getBoundingClientRect();
    const b = document.getElementById("comparetraybar").getBoundingClientRect();
    const nav = document.querySelector(".bottom-nav").getBoundingClientRect();
    return { overlap: !(a.bottom <= b.top || b.bottom <= a.top), aboveNav: a.bottom <= nav.top && b.bottom <= nav.top };
  });
  assert.deepEqual(r, { overlap: false, aboveNav: true });
});

test("depolama engelli (localStorage hata firlatir): katalog ve tema dugmesi calisir", async (t) => {
  const { page, errors } = await open(t, {
    init: () => { Object.defineProperty(window, "localStorage", { get() { throw new Error("SecurityError"); } }); },
  });
  const before = await page.getAttribute("#themeToggleBtn", "data-theme-pref");
  await page.click("#themeToggleBtn");
  const after = await page.getAttribute("#themeToggleBtn", "data-theme-pref");
  assert.notEqual(before, after);
  assert.equal(await page.getAttribute("html", "data-theme"), after === "system" ? await page.evaluate(() => matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light") : after);
  await page.locator("#grid .card .fav").first().click();     // favori: oturumda calisir, uyari verir
  assert.match(await page.textContent("#favcount"), /1 favori/);
  assert.deepEqual(errors, []);
});

for (const [label, body] of [["bozuk JSON", "{bozuk"], ["yalniz baslik satiri", JSON.stringify({ products: [{ b: "⚡ MIX GSM • GÜNCEL VİTRİN", m: "" }] })]]) {
  test(`katalog hatasi (${label}) + Sheets erisilemez + onbellek yok: anlasilir hata, takili 'Yükleniyor' yok`, async (t) => {
    const { page, errors } = await open(t, { catalogBody: body, waitCards: false });
    await page.waitForFunction(() => /yüklenemedi/i.test(document.getElementById("count").textContent), null, { timeout: 30000 });
    assert.match(await page.textContent("#grid"), /WhatsApp/);
    assert.equal(await page.$("#grid .card"), null);
    assert.deepEqual(errors, []);
  });
}

test("acilis donusu: ilk etkilesime kadar baslamaz; hareket azaltmada hic baslamaz; durdur dugmesi", async (t) => {
  const { page } = await open(t, {});
  await page.waitForTimeout(1500);
  assert.equal(await page.$eval("#heroRotateBtn", (b) => b.hidden), true);
  await page.mouse.click(5, 300);
  await page.waitForFunction(() => !document.getElementById("heroRotateBtn").hidden, null, { timeout: 5000 });
  await page.click("#heroRotateBtn");
  assert.equal(await page.getAttribute("#heroRotateBtn", "aria-pressed"), "true");
  assert.equal(await page.getAttribute("#heroRotateBtn", "aria-label"), "Ürün geçişini başlat");

  const { page: rm } = await open(t, { reducedMotion: "reduce" });
  await rm.mouse.click(5, 300);
  await rm.waitForTimeout(1500);
  assert.equal(await rm.$eval("#heroRotateBtn", (b) => b.hidden), true);
});

test("laptop formu: yalniz butce + kullanim zorunlu; onizleme ve katalog eslesmeleri; mesajda numara alani yok", async (t) => {
  const { page, ctx } = await open(t, { width: 1280, height: 900 });
  await toLaptop(page);
  await page.click("#laptopFindBtn");
  await page.click("#laptopFinderSubmitBtn");
  const invalid = await page.$$eval('#laptopFinderForm [aria-invalid="true"]', (els) => els.map((e) => e.id));
  assert.deepEqual(invalid, ["lfBudget", "lfUsage"]);
  assert.equal(await page.evaluate(() => document.activeElement.id), "lfBudget");
  await page.fill("#lfBudget", "40000");
  await page.selectOption("#lfUsage", "Oyun");
  const preview = await page.textContent("#lfPreview");
  assert.match(preview, /Bütçe: 40\.000 TL/);
  assert.match(preview, /Kullanım Amacı: Oyun/);
  assert.doesNotMatch(preview, /WhatsApp:|Ad Soyad/);
  const matches = await page.$$eval("#lfMatches .laptop-match span", (s) => s.map((x) => x.textContent));
  assert.ok(matches.length <= 3);
  matches.forEach((m) => assert.match(m, /^Bütçene uyuyor \([\d.]+ TL\) · Kullanım amacı: Gaming/));
  let waUrl = null;
  await ctx.route(/^https:\/\/(web\.whatsapp\.com|wa\.me)\//, (route) => { waUrl = route.request().url(); return route.abort(); });
  await page.click("#laptopFinderSubmitBtn");
  await page.waitForTimeout(300);
  assert.ok(waUrl && /phone=905424818255|wa\.me\/905424818255/.test(waUrl), String(waUrl));
  assert.equal(decodeURIComponent(waUrl.split("text=")[1]), preview);
});

test("Telefonumu Bul: oneriler dogrulanabilir gerekceyle; karsilastirma ozeti farklari sayar", async (t) => {
  const { page } = await open(t, { width: 1280, height: 900 });
  await page.click("#filterPanel .btn-finder");
  await page.click('#finderBudgetOpts [data-i="3"]');
  await page.click('#finderPriorityOpts [data-i="0"]');
  await page.click('#finderBrandOpts [data-i="3"]');
  const why = await page.$$eval("#finderResultsWrap .finder-why", (u) => u.map((x) => x.textContent));
  assert.ok(why.length > 0);
  why.forEach((w) => assert.match(w, /Bütçene uyuyor: [\d.]+ TL/));
  await page.keyboard.press("Escape");
  await page.locator("#grid .card .compare-toggle").nth(0).click();
  await page.locator("#grid .card .compare-toggle").nth(1).click();
  await page.click("#compareViewBtn");
  assert.match(await page.textContent(".compare-summary"), /\d+ özellik farklı.*\d+ özellik aynı/);
});

test("katalog guncellenme zamani: catalog.json generatedAt'ten (sayfa acilis saati degil)", async (t) => {
  const { page } = await open(t, {});
  const gen = require("../../../catalog.json").generatedAt;
  const r = await page.$eval("#catalogUpdated time", (el) => el.dateTime);
  assert.equal(new Date(r).toISOString(), new Date(gen).toISOString());
});

test("eski onbellek: katalog alinamazsa son liste uyariyla ve kendi guncellenme zamaniyla gosterilir", async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => ctx.close());
  await routeExternal(ctx);
  const page = await ctx.newPage();
  await page.goto(srv.url, { waitUntil: "load" });
  await page.waitForSelector("#grid .card");
  await ctx.route(/\/catalog\.json(\?|$)/, (route) => route.fulfill({ status: 503, body: "" }));
  await page.reload({ waitUntil: "load" });
  await page.waitForSelector("#grid .card");
  assert.equal(await page.$eval("#cacheNotice", (n) => getComputedStyle(n).display), "block");
  const gen = require("../../../catalog.json").generatedAt;
  assert.equal(new Date(await page.$eval("#catalogUpdated time", (el) => el.dateTime)).toISOString(), new Date(gen).toISOString());
});

test("yuklenemeyen urun gorseli: yedek zinciri 'gorsel yok' dosyasina duser, sonsuz donguye girmez", async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => ctx.close());
  await routeExternal(ctx);
  // Son eklenen yonlendirme once calisir: urun fotograflari 404, "gorsel yok" dosyasi gercek.
  await ctx.route(/^https:\/\/raw\.githubusercontent\.com\/mixgsm\/mixgsm\/main\/photos\/(?!gorsel-yok)/, (route) => route.fulfill({ status: 404, body: "" }));
  const page = await ctx.newPage();
  let requests = 0;
  page.on("request", (r) => { if (/gorsel-yok/.test(r.url())) requests++; });
  await page.goto(srv.url, { waitUntil: "load" });
  await page.waitForSelector("#grid .card");
  await page.$eval("#grid", (g) => g.scrollIntoView());
  await page.waitForFunction(() => [...document.querySelectorAll("#grid .card img")].slice(0, 4).every((i) => /gorsel-yok/.test(i.src)), null, { timeout: 15000 });
  await page.waitForTimeout(500);
  assert.ok(requests < 40, `gorsel-yok istegi: ${requests}`);
});

test("yatay tasma yok: 320-1440 genislikler ve yatay kisa ekran (812x375)", async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 320, height: 640 } });
  t.after(() => ctx.close());
  await routeExternal(ctx);
  const page = await ctx.newPage();
  await page.goto(srv.url, { waitUntil: "load" });
  await page.waitForSelector("#grid .card");
  const bad = [];
  for (const [w, h] of [[320, 640], [375, 812], [390, 844], [768, 1024], [899, 900], [900, 900], [901, 900], [1440, 900], [812, 375]]) {
    await page.setViewportSize({ width: w, height: h });
    await page.waitForTimeout(80);
    for (const store of ["phone", "laptop"]) {
      await page.click(store === "phone" ? "#toggleBtnPhone" : "#toggleBtnLaptop");
      if (store === "laptop") await page.waitForSelector("#laptopGrid .laptop-card");
      const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
      if (over > 1) bad.push(`${w}x${h}/${store}: +${over}px`);
    }
  }
  assert.deepEqual(bad, []);
});

// ---------------------------------------------------------------
// DENETİM 2: Satılan Modeller + laptop fotoğraf sahnesi
// ---------------------------------------------------------------
const LAPTOPS = require("../../../catalog-laptop.json").products.filter((p) => p.brand || p.model);
const SOLD_IDS = LAPTOPS.filter((p) => p.stock === "OUT").map((p) => p.id);
const ACTIVE_IDS = LAPTOPS.filter((p) => p.stock !== "OUT").map((p) => p.id);
const idsIn = (page, sel) => page.$$eval(sel, (cards, all) => cards.map((c) => all[+c.dataset.laptopIndex].id), LAPTOPS);
async function openLaptops(t, opts = {}) {
  const r = await open(t, { path: "?magaza=laptop", waitCards: false, ...opts });
  await r.page.waitForSelector("#laptopGrid .laptop-card");
  return r;
}
async function showAll(page, gridMore) {
  for (let i = 0; i < 10; i++) { const b = page.locator(`#${gridMore}:not([hidden]) button`); if (!(await b.count())) break; await b.click(); }
}

test("stok ayrimi: stoktakiler ana listede, satilanlar yalniz 'Satilan Modeller' bolumunde; sayilar tutarli", async (t) => {
  assert.ok(SOLD_IDS.length > 0 && ACTIVE_IDS.length > 0, "test verisinde iki grup da olmali");
  const { page, errors } = await openLaptops(t);
  await showAll(page, "laptopCatalogMore");
  await showAll(page, "laptopSoldMore");
  const main = await idsIn(page, "#laptopGrid .laptop-card");
  const sold = await idsIn(page, "#laptopSoldGrid .laptop-card");
  assert.deepEqual([...main].sort(), [...ACTIVE_IDS].sort());
  assert.deepEqual([...sold].sort(), [...SOLD_IDS].sort());
  assert.equal(await page.$("#laptopGrid .laptop-card--sold"), null);
  assert.equal(await page.textContent("#laptopCount"), `${ACTIVE_IDS.length} laptop listeleniyor`);
  assert.equal(await page.textContent("#laptopSoldCount"), `(${SOLD_IDS.length})`);
  // Satilan kartta fiyat yok, Firsat/Yeni rozeti yok, metinle "satildi" bilgisi var
  const soldCards = await page.$$eval("#laptopSoldGrid .laptop-card", (cs) => cs.map((c) => ({
    price: !!c.querySelector(".laptop-card-price"), tags: c.querySelectorAll(".laptop-card-tags").length,
    text: c.textContent, badge: (c.querySelector(".laptop-card-badge") || {}).textContent })));
  soldCards.forEach((c) => { assert.equal(c.price, false); assert.equal(c.tags, 0); assert.match(c.text, /Satıldı/); assert.match(c.badge, /SATILDI/); });
  // Bolum semantigi: baslikli section, h3
  assert.equal(await page.$eval("#laptopSold", (s) => s.getAttribute("aria-labelledby") === "laptopSoldTitle" && document.getElementById("laptopSoldTitle").tagName), "H3");
  assert.deepEqual(errors, []);
});

test("satilan model: dogrudan baglanti acilir, satin alinabilir izlenimi vermez; geri/ileri calisir", async (t) => {
  const sold = LAPTOPS.find((p) => p.stock === "OUT");
  const slug = `${(sold.brand + " " + sold.model).toLocaleLowerCase("tr-TR").replace(/ı/g, "i").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, "-")}-${sold.id.toLowerCase()}`;
  const { page, ctx, errors } = await open(t, { path: "#laptop/" + slug, waitCards: false });
  await page.waitForSelector("#laptopModal.open");
  const st = await page.evaluate(() => ({
    price: document.getElementById("lmp").textContent, warn: getComputedStyle(document.getElementById("laptopOutOfStockWarn")).display,
    badges: document.getElementById("laptopModalBadges").children.length, cta: document.getElementById("lmcp").textContent,
    wa: document.getElementById("laptopModalWaBtn").textContent.trim() }));
  assert.equal(st.price, "Bu model satıldı");
  assert.equal(st.warn, "block");
  assert.equal(st.badges, 0);
  assert.doesNotMatch(st.cta, /TL/);
  assert.equal(st.wa, "Benzerini Sor");
  let waUrl = null;
  await ctx.route(/^https:\/\/(web\.whatsapp\.com|wa\.me)\//, (route) => { waUrl = route.request().url(); return route.abort(); });
  await page.click("#laptopModalWaBtn");
  await page.waitForTimeout(300);
  assert.match(decodeURIComponent(waUrl), /satıldı olarak görünen .*benzer, stokta olan bir laptop var mı\?/);
  assert.match(waUrl, /905424818255/);
  // Kartla ac -> kapat -> geri/ileri
  await page.goto(srv.url + "?magaza=laptop", { waitUntil: "load" });
  await page.waitForSelector("#laptopSoldGrid .laptop-card");
  await page.locator("#laptopSoldGrid .laptop-card .card-open").first().click();
  await page.waitForFunction(() => location.hash.startsWith("#laptop/"));
  await page.click("#laptopModalCloseBtn");
  await page.waitForFunction(() => !location.hash && !document.getElementById("laptopModal").classList.contains("open"));
  await page.goForward();
  await page.waitForFunction(() => document.getElementById("laptopModal").classList.contains("open"));
  assert.equal(await page.textContent("#lmp"), "Bu model satıldı");
  await page.goBack();
  await page.waitForFunction(() => !document.getElementById("laptopModal").classList.contains("open"));
  assert.equal(await locked(page), false);
  assert.deepEqual(errors, []);
});

test("arama/filtre stok ayrimini bozmaz: yalniz satilmis eslesme -> ana liste bos + bilgi, bolumde gorunur", async (t) => {
  const { page } = await openLaptops(t);
  const target = LAPTOPS.find((p) => p.stock === "OUT" && !LAPTOPS.some((q) => q.stock !== "OUT" && q.model === p.model && q.brand === p.brand));
  await page.fill("#laptopQ", target.model);
  await page.waitForFunction(() => document.getElementById("laptopCount").textContent.startsWith("0 "), null, { timeout: 5000 }).catch(() => {});
  const main = await idsIn(page, "#laptopGrid .laptop-card");
  const sold = await idsIn(page, "#laptopSoldGrid .laptop-card");
  main.forEach((id) => assert.ok(ACTIVE_IDS.includes(id), id));
  assert.ok(sold.includes(target.id), `${target.id} satilanlarda olmali`);
  if (!main.length) assert.match(await page.textContent("#laptopGrid"), /stokta laptop bulunamadı.*satılan model aşağıda/);
  // marka filtresi: iki grup da yalniz o marka
  await page.fill("#laptopQ", "");
  await page.waitForTimeout(400);
  await page.click('#laptopBrandGroup button[data-val="LENOVO"]');
  const b1 = await page.$$eval("#laptopGrid .laptop-card-brand, #laptopSoldGrid .laptop-card-brand", (e) => e.map((x) => x.textContent));
  assert.ok(b1.length && b1.every((b) => b === "LENOVO"));
  assert.ok((await idsIn(page, "#laptopGrid .laptop-card")).every((id) => ACTIVE_IDS.includes(id)));
});

test("Bana Laptop Bul (tarayici): yuksek butcede bile satilmis laptop onerilmez", async (t) => {
  const { page } = await openLaptops(t);
  await page.click("#laptopFindBtn");
  for (const usage of ["Oyun", "Ofis / Günlük Kullanım", "Öğrenci", "Diğer"]) {
    await page.fill("#lfBudget", "500000");
    await page.selectOption("#lfUsage", usage);
    const ids = await page.$$eval("#lfMatches .laptop-match", (bs, all) => bs.map((b) => all[+b.dataset.laptopIndex].id), LAPTOPS);
    ids.forEach((id) => assert.ok(!SOLD_IDS.includes(id), `${usage}: satilmis ${id} onerildi`));
  }
});

test("galeri: sahne turevi yuklenemezse orijinal fotograf gosterilir", async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => ctx.close());
  await routeExternal(ctx);
  await ctx.route(/\/laptop-photos\/stage\/[^/]+\.webp$/, (route) => route.fulfill({ status: 404, body: "" }));
  const page = await ctx.newPage();
  await page.goto(srv.url + "#laptop/acer-nitro-5-pc-001", { waitUntil: "load" });
  await page.waitForSelector("#laptopModal.open");
  await page.waitForFunction(() => { const i = document.getElementById("lmi"); return i.complete && i.naturalWidth > 0 && /laptop-photos\/images\//.test(i.src); }, null, { timeout: 10000 });
  assert.equal(await page.getAttribute("#lmi", "data-stage"), "white");
  assert.equal(await page.getAttribute("#lmi", "data-orig"), null);
});

test("kirik laptop gorseli: turev + orijinal yoksa 'gorsel yok'a duser, sonsuz yedek dongusu yok", async (t) => {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  t.after(() => ctx.close());
  await routeExternal(ctx);
  let attempts = 0;
  await ctx.route(/(\/laptop-photos\/stage\/[^/]+\.webp|\/laptop-photos\/images\/[^/]+)$/, (route) => { attempts++; return route.fulfill({ status: 404, body: "" }); });
  const page = await ctx.newPage();
  let fallbackReq = 0;
  page.on("request", (r) => { if (/gorsel-yok\.jpg/.test(r.url())) fallbackReq++; });
  await page.goto(srv.url + "#laptop/acer-nitro-5-pc-001", { waitUntil: "load" });
  await page.waitForSelector("#laptopModal.open");
  await page.waitForFunction(() => /gorsel-yok\.jpg/.test(document.getElementById("lmi").src), null, { timeout: 10000 });
  await page.waitForTimeout(1500);
  const before = attempts;
  await page.waitForTimeout(1500);
  assert.equal(attempts, before, "basarisiz istekler durmali (dongu yok)");
  assert.ok(fallbackReq < 60, `gorsel-yok istegi: ${fallbackReq}`);
});

for (const [w, h] of [[320, 640], [375, 812], [812, 375]]) {
  test(`mobil laptop penceresi ${w}x${h}: yatay tasma yok, galeri ve kucuk resimler kullanilabilir, son satir ortulmez`, async (t) => {
    const { page, errors } = await open(t, { width: w, height: h, path: "#laptop/acer-nitro-5-pc-001", waitCards: false });
    await page.waitForSelector("#laptopModal.open");
    await page.waitForTimeout(400);
    const r = await page.evaluate(() => {
      const box = document.querySelector("#laptopModal .laptop-modalbox");
      const g = document.getElementById("laptopGalleryMain").getBoundingClientRect();
      const thumbs = [...document.querySelectorAll("#laptopGalleryThumbs .laptop-gallery-thumb")].map((b) => b.getBoundingClientRect());
      return { boxOver: box.scrollWidth - box.clientWidth, pageOver: document.documentElement.scrollWidth - innerWidth,
        gLeft: g.left, gRight: g.right, vw: innerWidth, thumbs: thumbs.length, thumbMinH: Math.min(...thumbs.map((t2) => t2.height)) };
    });
    assert.ok(r.boxOver <= 1 && r.pageOver <= 1, JSON.stringify(r));
    assert.ok(r.gLeft >= 0 && r.gRight <= r.vw + 1, JSON.stringify(r));
    assert.ok(r.thumbs >= 2 && r.thumbMinH >= 44, JSON.stringify(r));
    // Kucuk resim degistirir; aktif olan altin vurgulu
    await page.locator("#laptopGalleryThumbs .laptop-gallery-thumb").nth(1).click();
    assert.equal(await page.$eval("#laptopGalleryThumbs .laptop-gallery-thumb:nth-child(2)", (b) => b.classList.contains("active")), true);
    await page.$eval("#laptopModal .laptop-modalbox", (b) => { b.scrollTop = b.scrollHeight; });
    await page.waitForTimeout(80);
    const end = await page.evaluate(() => {
      const rows = [...document.querySelectorAll("#laptopModal .laptop-spec-table tr")].filter((x) => x.style.display !== "none");
      return { row: rows[rows.length - 1].getBoundingClientRect().bottom, cta: document.querySelector("#laptopModal .laptop-modal-cta").getBoundingClientRect().top };
    });
    assert.ok(end.row <= end.cta + 1, JSON.stringify(end));
    assert.deepEqual(errors, []);
  });
}
