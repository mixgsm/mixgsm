// MIX GSM - site uygulama kodu. Degistirdikten sonra: node scripts/asset-version.js
// REDESIGN SAĞLAMLAŞTIRMA — KAPSÜLLEME: tüm uygulama kodu tek bir fonksiyon
// kapsamında. Telefon durumu (products, cat, q, sort, favs, compareList…) ve
// laptop durumu (LaptopStore, LaptopFilters…) artık global DEĞİL; satır içi
// olay kalmadığı için hiçbir fonksiyonun global olması gerekmiyor. Dışarıya
// hiçbir şey açılmaz (eski window.MIXGSM tanılama arayüzü kaldırıldı).
(function () {
// Ortak body-scroll-kilidi (telefon VE laptop tum modal/cekmece acilis-kapanis
// noktalari tarafindan kullanilir). Duz "overflow:hidden" iOS Safari'de arka
// plan icerigin hala kaydirilabilir kalmasina yol acabiliyordu; bu yuzden
// position:fixed + scroll-offset restorasyonu tekniğine geçildi. Idempotent:
// zaten kilitliyken tekrar cagrilirsa (ic ice acilan modal) mevcut scroll
// offset'inin ustune yazmaz.
// ERİŞİLEBİLİRLİK: "hareketi azalt" tercihinde JS'ten başlatılan kaydırmalar da
// anında olur (CSS'teki scroll-behavior kuralı JS'teki behavior:'smooth'u ezmez).
function smoothOrAuto() {
  return (window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches) ? 'auto' : 'smooth';
}

let bodyScrollLockY = 0;
function lockBodyScroll() {
  if (document.body.style.position === 'fixed') return;
  bodyScrollLockY = window.scrollY || window.pageYOffset || 0;
  document.body.style.position = 'fixed';
  document.body.style.top = '-' + bodyScrollLockY + 'px';
  document.body.style.left = '0';
  document.body.style.right = '0';
  document.body.style.width = '100%';
  document.body.style.overflow = 'hidden';
}
function unlockBodyScroll() {
  document.body.style.position = '';
  document.body.style.top = '';
  document.body.style.left = '';
  document.body.style.right = '';
  document.body.style.width = '';
  document.body.style.overflow = '';
  // ONEMLI (2 ayri incelikle test edilerek bulundu):
  // 1) Site genelinde "html { scroll-behavior: smooth }" tanimli oldugu icin
  //    duz window.scrollTo(0, y) burada da animasyonlu/yavas calisiyor ve
  //    modal kapanisinda gozle gorulur, istenmeyen bir "kayma" efekti
  //    yaratiyor -> behavior:'instant' ile bu bypass ediliyor.
  // 2) position:fixed kaldirildiginda tarayici sayfa yuksekligini (ve dolayisiyla
  //    max scroll degerini) SENKRON olarak yeniden hesaplamiyor; bir sonraki
  //    satirda hemen scrollTo cagirilirsa bazen eski/kismi (kucuk) bir
  //    scrollHeight'a gore kirpilmis, YANLIS bir konuma atlayabiliyor. Asagidaki
  //    offsetHeight okumasi senkron bir reflow'u zorlayarak bunu engelliyor.
  void document.body.offsetHeight;
  window.scrollTo({ top: bodyScrollLockY, left: 0, behavior: 'instant' });
}

let products = [];
let cat = "ALL", group = "ALL", q = "", sort = "default";
// Gelismis filtreler (Faz 11)
let ramFilter = "ALL", only5G = false, minBattery = 0, priceMin = null, priceMax = null;
// Akilli kullanim alani pilleri (Faz - Asama 1): sadece gercek sutun
// verisine (kamera MP, islemci metni) dayanan ek filtreler. "Oyun" pili
// eklenmedi - GPU/ekran yenileme hizi gibi veriler katalogda yok, bu yuzden
// uydurma bir kritere gore etiketlemek istemedik.
let minCamera = 0, minPerf = 0;
const favKey = "mixgsm-favorites-v15";
let favs = [];
// Karsilastirma listesi (favorilerden bagimsiz, gecici, sayfa yenilenince sifirlanir).
let compareList = [];
// "Sadece Farkları Göster" - karsilastirma tablosunda urunler arasinda AYNI
// olan satirlari gizleme tercihi (gecici, sayfa yenilenince sifirlanir).
let compareDiffOnly = false;
try {
  const saved = JSON.parse(localStorage.getItem(favKey) || "[]");
  favs = Array.isArray(saved) ? saved : [];
} catch(e) { favs = [] }

// GUVENLIK/DAYANIKLILIK: localStorage.setItem gizli (private/incognito)
// sekmede, depolama kotasi dolduğunda veya kullanici tarayici ayarlarindan
// depolamayi engellediginde hata firlatabilir. Bu durumda favori islemi
// sadece bu oturumda (sayfa hafizasinda) calismaya devam etsin, tum site
// cokmesin - kullaniciya sessizce bir kez bilgi verilir.
let favStorageWarned = false;
function saveFavsToStorage() {
  try {
    localStorage.setItem(favKey, JSON.stringify(favs));
  } catch (e) {
    if (!favStorageWarned) {
      favStorageWarned = true;
      showToast('Favoriler bu oturumda çalışıyor ancak tarayıcınızda saklanamıyor.');
    }
  }
}

// Favori anahtari: depolama formati degismiyor (eski kayitli favoriler
// bozulmasin diye), ama KARSILASTIRMA normalizeTR ile yapiliyor - boylece
// sheet'te marka/model yazimindaki kucuk farklar (bosluk, buyuk/kucuk harf
// vb.) favorinin sessizce "kaybolmasina" sebep olmuyor.
function favKeyOf(p) { return `${p.b}|${p.m}|${p.s}`; }
function normalizedFavKey(rawKey) {
  return String(rawKey || '').split('|').map(part => normalizeTR(part)).join('|');
}
function isFav(p) {
  const target = normalizedFavKey(favKeyOf(p));
  return favs.some(k => normalizedFavKey(k) === target);
}

// --- Gelismis filtre yardimcilari (Faz 11) ---
// RAM/Hafiza sutunu serbest metin ("8 GB / 256 GB" gibi) - ilk sayiyi RAM
// olarak okuyoruz. Format uymuyorsa null donuyor (o urun RAM filtresine dahil edilmez).
function extractRAM(specText) {
  const text = String(specText || '');
  // Sadece "RAM / Depolama" formatinda ("8 GB / 256 GB" gibi) ilk sayiyi RAM
  // kabul ediyoruz. iPhone gibi tek sayili ("128 GB") girislerde bu aslinda
  // sadece depolama olabilir, RAM oldugundan emin olamayiz - bu yuzden
  // filtreye hic dahil etmiyoruz (yanlis bilgi vermemek icin).
  if (!text.includes('/')) return null;
  const m = text.match(/(\d+)\s*gb/i);
  return m ? `${m[1]} GB` : null;
}

// Baglanti sutununda gercekten "5G" yaziyor mu (kelime olarak) kontrol eder;
// "4,5 G" gibi farkli bir ifadeyi 5G ile karistirmaz.
function is5GConnectivity(connText) {
  const text = String(connText || '');
  // Once "4.5G" / "4,5 G" gibi ifadeleri metinden cikar - bunlar gercek 5G
  // degildir, "5G" ile karistirilmamali.
  const cleaned = text.replace(/4\s*[.,]\s*5\s*g/gi, '');
  // Kalan metinde, hemen onunde baska bir rakam/nokta olmayan bagimsiz "5G" var mi?
  return /(?:^|[^0-9.,])5\s*g\b/i.test(cleaned);
}

function getAvailableRAMs() {
  const set = new Set();
  products.forEach(p => {
    if (p.group !== 'PHONE') return;
    const ram = extractRAM(p.s);
    if (ram) set.add(ram);
  });
  return Array.from(set).sort((a, b) => parseInt(a) - parseInt(b));
}

function renderRamFilterOptions() {
  const wrap = document.getElementById('ramFilterGroup');
  if (!wrap) return;
  const rams = getAvailableRAMs();
  if (!rams.length) { wrap.innerHTML = '<span style="color:var(--muted);font-size:12px;">Katalogda RAM verisi bulunamadı.</span>'; return; }
  wrap.innerHTML = '<button data-ram="ALL" class="active">Tümü</button>' +
    rams.map(r => `<button data-ram="${escapeHtml(r)}">${escapeHtml(r)}</button>`).join('');
  wrap.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      ramFilter = b.dataset.ram;
      wrap.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      render();
    });
  });
}

const grid = document.querySelector("#grid");
const count = document.querySelector("#count");
const fmt = n => n.toLocaleString("tr-TR");

function normalizeTR(v) {
  return (v||"").toLocaleLowerCase("tr-TR")
    .replace(/ı/g,"i").replace(/İ/g,"i").replace(/ş/g,"s").replace(/Ş/g,"s")
    .replace(/ğ/g,"g").replace(/Ğ/g,"g").replace(/ü/g,"u").replace(/Ü/g,"u")
    .replace(/ö/g,"o").replace(/Ö/g,"o").replace(/ç/g,"c").replace(/Ç/g,"c")
    .replace(/[^a-z0-9]+/g," ").trim();
}

// Urun paylasim linki icin okunabilir "slug" uretir (orn. "xiaomi-poco-x8-pro-256-8").
// Marka+model tabanina, varsa RAM/hafiza varyant bilgisindeki sayilar eklenir,
// boylece ayni modelin farkli varyantlari BIRBIRINDEN FARKLI link uretir.
function productBaseSlug(p) {
  return normalizeTR(`${p.b} ${p.m}`).trim().replace(/\s+/g, '-');
}

function productVariantSuffix(p) {
  const nums = String(p.s || '').match(/\d+/g);
  return nums && nums.length ? nums.join('-') : '';
}

function productSlug(p) {
  const base = productBaseSlug(p);
  const suffix = productVariantSuffix(p);
  return suffix ? `${base}-${suffix}` : base;
}

// ESKI (varyantsiz) linkler bozulmasin diye: once yeni (tam) formatla arar,
// bulamazsa marka+model tabanina gore ilk eslesen urune duser.
function findProductBySlug(slug) {
  if (!slug) return -1;
  const exactIdx = products.findIndex(p => productSlug(p) === slug);
  if (exactIdx > -1) return exactIdx;
  return products.findIndex(p => productBaseSlug(p) === slug);
}

// Telefon ve laptop arama kutularinin ALGORITMASI (sorguyu normalize edip
// token'lara bolme, her token icin hedef metinde substring arama, eslesen
// token sayisini skor olarak dondurme) birebir ayniydi; yalnizca hangi
// alanlarin arama hedefine dahil edildigi (sema) farkliydi. Bu yuzden
// SADECE ortak skor hesaplama mantigi tek fonksiyona cikarildi; her taraf
// kendi hedef metnini (kendi sema/alanlariyla) eskisi gibi kendisi kurar -
// davranista hicbir fark yaratmaz (bkz. denetim raporu, once/sonra testiyle
// dogrulandi).
function computeSearchScore(query, targetText) {
  if (!query) return 0;
  const qn = normalizeTR(query);
  const target = normalizeTR(targetText);
  let score = 0;
  qn.split(/\s+/).filter(Boolean).forEach(t => {
    if (target.includes(t)) score += 1;
  });
  return score;
}

function searchScore(p, query) {
  return computeSearchScore(query, p.b + " " + p.m + " " + p.s);
}

// Google arama sonuclarinda urunlerin zengin gorunum (fiyat/stok) alabilmesi
// icin, Google Sheet'ten o an gelen GERCEK urun verisinden (uydurma hicbir
// sey eklenmeden) schema.org Product/ItemList yapisal verisi uretir.
function updateProductSchema() {
  const el = document.getElementById('ld-products');
  if (!el) return;
  const items = products.filter(p => !isNonProductRow(p) && p.p !== null);
  const listItems = items.slice(0, 80).map((p, i) => {
    const availability = p.stock === 'IN' ? 'https://schema.org/InStock'
      : p.stock === 'OUT' ? 'https://schema.org/OutOfStock'
      : 'https://schema.org/LimitedAvailability';
    // Sitede gosterilen gorselle ayni gercek gorseli kullan (sayfadaki
    // eslestirme mantigiyla birebir tutarli olsun diye).
    const productImage = imageCandidatesForProduct(p)[0];
    return {
      "@type": "ListItem",
      "position": i + 1,
      "item": {
        "@type": "Product",
        "name": `${p.b} ${p.m}`.trim(),
        "image": productImage,
        "brand": { "@type": "Brand", "name": p.b },
        "url": `https://mixgsm.tr/#urun/${productSlug(p)}`,
        "offers": {
          "@type": "Offer",
          "priceCurrency": "TRY",
          "price": p.p,
          "availability": availability,
          "url": `https://mixgsm.tr/#urun/${productSlug(p)}`
        }
      }
    };
  });
  const schema = {
    "@context": "https://schema.org",
    "@type": "ItemList",
    "itemListElement": listItems
  };
  el.textContent = JSON.stringify(schema);
}

// Hero gorseli icin GERCEK, stokta olan bir telefon secer (en yuksek fiyatli
// stoktaki telefon = genelde amiral gemisi modeli - uydurma/rastgele internet
// gorseli KULLANILMAZ, sadece katalogdaki gercek urun gorseli). Stokta uygun
// urun yoksa gorsel alani sessizce gizlenir, hicbir urun "satista" gibi
// gosterilmez.
// waitForPhotoDiscovery: hero ürününün görseli sabit listede yoksa ve arka
// planda GitHub fotoğraf araması yapılacaksa, hero (LCP) önce "görsel yok"
// resmiyle açılıp sonra değişmesin; mevcut "yükleniyor" hali korunur. Arama
// bitince (başarılı/başarısız) discoverExtraPhotosInBackground hero'yu yeniden çizer.
function renderHeroProduct(waitForPhotoDiscovery) {
  const img = document.getElementById('heroProductImg');
  const empty = document.getElementById('heroVisualEmpty');
  if (!img || !empty) return;
  const candidates = products.filter(p => !isNonProductRow(p) && p.group === 'PHONE' && p.stock === 'IN' && p.p !== null);
  candidates.sort((a, b) => b.p - a.p);
  const pick = candidates[0];
  if (!pick) { img.style.display = 'none'; empty.style.display = 'block'; empty.textContent = 'Güncel katalog için ürünleri inceleyin.'; return; }
  const heroSrc = imageCandidatesForProduct(pick)[0];
  if (waitForPhotoDiscovery && /gorsel-yok\.jpg$/.test(heroSrc)) return;
  img.src = heroSrc;
  img.alt = `${pick.b} ${pick.m}`;
  img.style.display = 'block';
  empty.style.display = 'none';
}

function isNonProductRow(p) {
  const brand = normalizeTR(p.b || '');
  const model = normalizeTR(p.m || '');
  const text = `${brand} ${model}`.trim();

  // Marka/model başlıkları ve boş satırlar ürün değildir.
  if(!brand || !model) return true;

  const titleTerms = [
    'marka model','urun tanimi','modelleri','modeller',
    'guncelleme','whatsapp','fiyat listesi','iletisim',
    'urunleri','urunler','liste'
  ];
  if(titleTerms.some(term => text.includes(term))) return true;

  // "APPLE IPHONE", "IPHONE", "SAMSUNG" gibi yalnızca marka başlıkları.
  const brandOnly = new Set([
    'apple','apple iphone','iphone',
    'samsung','xiaomi','redmi','poco',
    'infinix','tecno','oneplus','google','pixel',
    'dyson','braun','philips'
  ]);
  if(brandOnly.has(model)) return true;

  // Marka ve model aynıysa ürün değildir.
  if(model === brand || model.replace(/\s+/g,'') === brand.replace(/\s+/g,'')) return true;

  return false;
}


function normalizeGithubImageUrl(value) {
  const raw = String(value || '').trim();
  if(!raw) return '';

  // GÜVENLİK: Yalnızca MİX GSM GitHub deposundaki /photos/ görselleri kabul
  // edilir. Onemli: sadece BASLANGICI degil, TUM string'i (sonuna kadar $)
  // ve sadece guvenli dosya adi karakterlerini (harf/rakam/nokta/tire/alt
  // cizgi/% kodlama) kabul ediyoruz. Eskiden sadece "basliyor mu" kontrol
  // ediliyordu; bu, Sheets'teki gorsel hucresine izinli linkin ARDINDAN
  // fazladan karakter (orn. " onerror=...) eklenerek HTML'e enjekte
  // edilebilecegi gercek bir XSS acigiydi. Simdi tam ve guvenli eslesme
  // sart, aksi halde link reddedilir (gorsel "bulunamadi" yedegine duser).
  const directMatch = raw.match(/^https:\/\/raw\.githubusercontent\.com\/mixgsm\/mixgsm\/main\/photos\/[A-Za-z0-9._%-]+$/i);
  if (directMatch) {
    return raw;
  }

  // GitHub blob linkini raw linke çevir (aynı güvenli karakter seti şartıyla).
  const blob = raw.match(/^https:\/\/github\.com\/mixgsm\/mixgsm\/blob\/main\/photos\/([A-Za-z0-9._%-]+)$/i);
  if(blob) {
    return `https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/${blob[1]}`;
  }

  return '';
}

function cleanImageName(value) {
  return String(value || '')
    .trim()
    .toUpperCase()
    .replace(/İ/g,'I').replace(/Ş/g,'S').replace(/Ğ/g,'G')
    .replace(/Ü/g,'U').replace(/Ö/g,'O').replace(/Ç/g,'C')
    .replace(/[^A-Z0-9]+/g,'-')
    .replace(/^-+|-+$/g,'');
}

const GITHUB_PHOTO_FILES = [
  '.gitkeep',
  'APPLE-IPHONE-16-PRO-MAX.jpg','APPLE-IPHONE-16-PRO.jpg','APPLE-IPHONE-16.jpg','APPLE-IPHONE-17-PRO-MAX.jpg','APPLE-IPHONE-17-PRO.jpg','APPLE-IPHONE-17.jpg','IPHONE-18-PRO.jpg','IPHONE-18-PRO-MAX.jpg',
  'BRAUN-SILK-EXPERT-PRO-5.jpg','BRAUN-SKIN-I-EXPERT.jpg','Braun-pro-5.jpg','Braun-skin-i.jpg',
  'DYSON-AIRWRAP-LONG.jpg','DYSON-AIRWRAP.jpg','Dyson-airstart.jpg','Dyson-airwarp.jpg','Dyson-coanda.jpg','Dyson-gen5-detect-submarine.jpg','Dyson-v16-piston-animal.jpg',
  'GOOGLE-PIXEL-10-PRO-XL.jpg',
  'INFINIX-GT-50-PRO.jpg','INFINIX-HOT-60-PRO-2.png','INFINIX-HOT-60-PRO-PLUS.webp','INFINIX-HOT-60-PRO.webp','INFINIX-HOT-60I-5G.jpg','INFINIX-NOTE-50-2.jpg','INFINIX-NOTE-50-PRO-PLUS-2.jpg','INFINIX-NOTE-50-PRO-PLUS.webp','INFINIX-NOTE-50-PRO.webp','INFINIX-NOTE-50.webp','INFINIX-NOTE-60-PRO.webp','INFINIX-SMART-10-PLUS.png','INFINIX-SMART-10.webp','INFINIX-SMART-20.jpg',
  'MI-15.webp','MI-15T-PRO.jpg','MI-15T.jpg','MI-17-PRO-MAX.webp','MI-17-PRO.jpg','MI-17-PRO.webp','MI-17-ULTRA.jpg','MI-17-ULTRA.webp','MI-17.jpg','MI-17.webp','MI-17T-PRO.jpg','MI-17T.jpg',
  'ONEPLUS-11.jpg','ONEPLUS-12.webp','ONEPLUS-15.jpg','ONEPLUS-15.webp','PHILIPS-LUMEA-LAZER.jpg',
  'POCO-F8-PRO.jpg','POCO-F8-ULTRA.jpg','POCO-F9-PRO.jpg','POCO-F9-ULTRA.jpg','POCO-X8-PRO-MAX.jpg','POCO-X8-PRO.jpg',
  'REDMAGIC-11-PRO-PLUS.webp','REDMAGIC-11-PRO.jpg','REDMAGIC-11-PRO.webp','REDMAGIC-11S-PRO.webp',
  'REDMI-15.jpg','REDMI-15C.jpg','REDMI-A7-PRO.jpg','REDMI-NOTE-14-PRO-PLUS-5G.jpg','REDMI-NOTE-14-PRO.webp','REDMI-NOTE-14.webp','REDMI-NOTE-15-PRO-5G.jpg','REDMI-NOTE-15-PRO-PLUS-5G.jpg','REDMI-NOTE-15-PRO.jpg','REDMI-NOTE-15.jpg','REDMI-NOTE-17-PRO-MAX.jpg',
  'SAMSUNG-S24-ULTRA.jpg','SAMSUNG-S25-ULTRA.jpg','SAMSUNG-S26-ULTRA.jpg','SAMSUNG-Z-FOLD-6.webp','SAMSUNG-Z-FOLD-7.jpg',
  'TECNO-CAMON-40-PREMIER.webp','TECNO-CAMON-40-PRO-5G.webp','TECNO-CAMON-50-PRO-5G.webp','TECNO-CAMON-NOTE-50-ULTRA.jpg','TECNO-POVA-CURVE-2-5G.jpg','TECNO-POVA-SLIM-5G.jpg','TECNO-SPARK-40-C.jpg','TECNO-SPARK-GO-3.jpg',
  'b_infinix-hot-60-pro-10.webp','b_infinix-note-50-pro-1.webp','dyson-airwarp-long.jpg','dyson-coanda-x2.png','dyson-gen5-detect-absolute.jpg','dyson-v15-detect-absolute.jpg','gorsel-yok.jpg','k_infinix-note-50-4.webp','k_infinix-note-50-pro-plus-1.webp',
  'm_apple-iphone-16-4.jpg','m_apple-iphone-16-pro-256gb-3.jpg','m_apple-iphone-16-pro-max-1tb-5.jpg','m_apple-iphone-17-2.jpg','m_apple-iphone-17-pro-1tb-4.jpg','m_apple-iphone-17-pro-max-2tb-10.jpg','m_google-pixel-10-pro-xl-14.jpg',
  'm_infinix-gt-50-pro-6.jpg','m_infinix-hot-60-pro-9.png','m_infinix-hot-60-pro-plus-7.webp','m_infinix-hot-60i-5g-21.jpg','m_infinix-note-50-1.jpg','m_infinix-note-50-pro-plus-15.jpg','m_infinix-note-60-pro-2.webp','m_infinix-smart-10-2.webp','m_infinix-smart-10-plus-7.png','m_infinix-smart-20-5.jpg',
  'm_nubia-red-magic-11-pro-1tb-16.webp','m_nubia-red-magic-11-pro-plus-1.webp','m_nubia-redmagic-11s-pro-14.webp','m_oneplus-11-3.jpg','m_oneplus-12-6.webp','m_oneplus-15-13.webp',
  'm_samsung-galaxy-s24-ultra-5.jpg','m_samsung-galaxy-s25-ultra-512gb-2.jpg','m_samsung-galaxy-s26-ultra-15.jpg','m_samsung-galaxy-z-fold6-32.webp','m_samsung-galaxy-z-fold7-20.jpg',
  'm_tecno-camon-40-premier-4.webp','m_tecno-camon-40-pro-5g-12gb-4.webp','m_tecno-camon-50-pro-5g-3.webp','m_tecno-camon-50-ultra-12-256gb-15.jpg','m_tecno-pova-curve-2-5g-10.jpg','m_tecno-pova-slim-5g-1.jpg','m_tecno-spark-40c-2.jpg','m_tecno-spark-go-3-2.jpg',
  'poco-x7-pro.webp'
].filter(Boolean);

// Sabit listede eslesme bulunamayan YENI urunler icin, sadece ihtiyac aninda
// GitHub'daki fotograf klasorunun canli listesiyle bir kez tamamlanir.
let EXTRA_PHOTO_FILES = [];

function githubPhotoUrl(file) {
  return `https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/${encodeURIComponent(file)}`;
}

function imageMatchKey(value) {
  return cleanImageName(value)
    .replace(/^M-/, '')
    .replace(/^B-/, '')
    .replace(/^K-/, '')
    .replace(/^APPLE-IPHONE-/, 'IPHONE-')
    .replace(/^GOOGLE-PIXEL-/, 'PIXEL-')
    .replace(/^SAMSUNG-GALAXY-/, 'SAMSUNG-')
    .replace(/^NUBIA-RED-/, 'RED-')
    .replace(/^REDMAGIC-/, 'RED-')
    .replace(/^XIAOMI-/, 'MI-');
}

function imageTokens(value) {
  return imageMatchKey(value).split('-').filter(Boolean);
}

function imageFileScore(p, file) {
  if (!file || file === '.gitkeep' || file === 'gorsel-yok.jpg') return -999;

  const brand = cleanImageName(p.b);
  const model = cleanImageName(p.m);
  const fileKey = cleanImageName(file.replace(/\.[^.]+$/, ''));

  // NOT: Anahtarlar cleanImageName(marka)+'|'+cleanImageName(model) formatiyla
  // BIREBIR eslesecek sekilde (tire ile, bosluksuz) yazilmalidir - aksi halde
  // bu liste sessizce devre disi kalir ve asagidaki genel puanlama mantigina
  // duser (bu, daha once Pro/Pro Max/Plus modellerinin birbirine karismasina
  // sebep olan gercek bir hataydi).
  const exactAliases = {
    'PHILIPS|PHILIPS-LUMEA-LAZER-EPILASYON': ['PHILIPS-LUMEA-LAZER.jpg'],
    'DYSON|DYSON-AIRWRAP-LONG-COMPLETE': ['DYSON-AIRWRAP-LONG.jpg', 'dyson-airwarp-long.jpg'],
    'XIAOMI|REDMI-A7-PRO': ['REDMI-A7-PRO.jpg'],
    'XIAOMI|REDMI-15C': ['REDMI-15C.jpg'],
    'XIAOMI|REDMI-15': ['REDMI-15.jpg'],
    'XIAOMI|REDMI-NOTE-14': ['REDMI-NOTE-14.webp'],
    'XIAOMI|REDMI-NOTE-14-PRO-5G': ['REDMI-NOTE-14-PRO.webp'],
    'XIAOMI|REDMI-NOTE-14-PRO-PLUS-5G': ['REDMI-NOTE-14-PRO-PLUS-5G.jpg'],
    'XIAOMI|REDMI-NOTE-15': ['REDMI-NOTE-15.jpg'],
    'XIAOMI|REDMI-NOTE-15-PRO-4-5G': ['REDMI-NOTE-15-PRO.jpg'],
    'XIAOMI|REDMI-NOTE-15-PRO-5G': ['REDMI-NOTE-15-PRO-5G.jpg'],
    'XIAOMI|REDMI-NOTE-15-PRO-PLUS-5G': ['REDMI-NOTE-15-PRO-PLUS-5G.jpg'],
    'XIAOMI|POCO-X7-PRO': ['poco-x7-pro.webp'],
    'XIAOMI|POCO-X8-PRO': ['POCO-X8-PRO.jpg'],
    'XIAOMI|POCO-X8-PRO-MAX': ['POCO-X8-PRO-MAX.jpg'],
    'XIAOMI|POCO-F8-PRO': ['POCO-F8-PRO.jpg'],
    'XIAOMI|POCO-F8-ULTRA': ['POCO-F8-ULTRA.jpg'],
    'XIAOMI|POCO-F9-PRO': ['POCO-F9-PRO.jpg'],
    'XIAOMI|POCO-F9-ULTRA': ['POCO-F9-ULTRA.jpg'],
    'XIAOMI|REDMI-NOTE-17-PRO-MAX-5G': ['REDMI-NOTE-17-PRO-MAX.jpg'],
    'XIAOMI|MI-15T': ['MI-15T.jpg'],
    'XIAOMI|MI-15T-PRO': ['MI-15T-PRO.jpg'],
    'XIAOMI|MI-17T': ['MI-17T.jpg'],
    'XIAOMI|MI-17T-PRO': ['MI-17T-PRO.jpg'],
    'XIAOMI|MI-15': ['MI-15.webp'],
    'XIAOMI|MI-17': ['MI-17.jpg'],
    'XIAOMI|MI-17-PRO': ['MI-17-PRO.jpg'],
    'XIAOMI|MI-17-PRO-MAX': ['MI-17-PRO-MAX.webp'],
    'XIAOMI|MI-17-ULTRA': ['MI-17-ULTRA.jpg'],
    'XIAOMI|MI-17-ULTRA-GLOBAL': ['MI-17-ULTRA.jpg'],
    'XIAOMI|MI-17-ULTRA-LEICA-EDITION': ['MI-17-ULTRA.jpg'],
    'INFINIX|SMART-10': ['INFINIX-SMART-10.webp'],
    'INFINIX|SMART-10-PLUS': ['INFINIX-SMART-10-PLUS.png'],
    'INFINIX|NOTE-50-PRO': ['INFINIX-NOTE-50-PRO.webp'],
    'INFINIX|NOTE-50-PRO-PLUS': ['INFINIX-NOTE-50-PRO-PLUS.webp'],
    'RED-MAGIC|REDMAGIC-11-PRO': ['REDMAGIC-11-PRO.jpg'],
    'ONEPLUS|ONEPLUS-15': ['ONEPLUS-15.jpg'],
    'RED-MAGIC|REDMAGIC-11S-PRO': ['REDMAGIC-11S-PRO.webp'],
    'IPHONE|IPHONE-16': ['APPLE-IPHONE-16.jpg'],
    'IPHONE|IPHONE-16-PRO': ['APPLE-IPHONE-16-PRO.jpg'],
    'IPHONE|IPHONE-16-PRO-MAX': ['APPLE-IPHONE-16-PRO-MAX.jpg'],
    'IPHONE|IPHONE-17': ['APPLE-IPHONE-17.jpg'],
    'IPHONE|IPHONE-17-PRO': ['APPLE-IPHONE-17-PRO.jpg'],
    'IPHONE|IPHONE-17-PRO-MAX': ['APPLE-IPHONE-17-PRO-MAX.jpg'],
    'IPHONE|IPHONE-18-PRO': ['IPHONE-18-PRO.jpg'],
    'IPHONE|IPHONE-18-PRO-MAX': ['IPHONE-18-PRO-MAX.jpg']
  };

  const aliasFiles = exactAliases[`${brand}|${model}`];
  if (aliasFiles && aliasFiles.some(f => f.toLowerCase() === file.toLowerCase())) return 1000;

  if (brand === 'APPLE' && !fileKey.includes('IPHONE')) return -999;
  if (brand === 'SAMSUNG' && !fileKey.includes('SAMSUNG')) return -999;
  if (brand === 'ONEPLUS' && !fileKey.includes('ONEPLUS')) return -999;
  if (brand === 'INFINIX' && !fileKey.includes('INFINIX')) return -999;
  if (brand === 'TECNO' && !fileKey.includes('TECNO')) return -999;
  if (brand === 'DYSON' && !fileKey.includes('DYSON')) return -999;
  if (brand === 'BRAUN' && !fileKey.includes('BRAUN')) return -999;
  if (brand === 'PHILIPS' && !fileKey.includes('PHILIPS')) return -999;
  if (brand === 'GOOGLE' && !fileKey.includes('PIXEL')) return -999;
  if (brand === 'REDMI' && !fileKey.includes('REDMI')) return -999;
  if (brand === 'POCO' && !fileKey.includes('POCO')) return -999;
  if (brand === 'XIAOMI' && !/^(MI|REDMI|POCO)-/.test(fileKey)) return -999;

  const ignored = new Set([
    'GB','TB','G','RAM','ROM','BLACK','WHITE','BLUE','GREEN','GRAY','GREY',
    'GLOBAL','EU','TR','COMPLETE','EPILASYON','5G','4G','4','5'
  ]);

  let modelTokens = imageTokens(model).filter(t => !ignored.has(t));
  if (brand === 'XIAOMI') modelTokens = modelTokens.filter(t => t !== 'XIAOMI');

  const matched = modelTokens.filter(t => fileKey.includes(t));
  if (!matched.length) return -999;

  // Nesil/model numarasi (S24, IPHONE-16, NOTE-15 gibi salt sayisal token'lar)
  // dosya adinda hic gecmiyorsa, bu farkli bir nesil/model demektir; boyle bir
  // eslesmeye asla izin verme (Pro/Pro Max/Ultra karismasiyla ayni kategori hata
  // - ornegin stokta olmayan "iPhone 15 Pro Max" icin yanlislikla "iPhone 16 Pro
  // Max" gorseli secilmesin diye).
  const missingTokens = modelTokens.filter(t => !matched.includes(t));
  if (missingTokens.some(t => /^\d+$/.test(t))) return -999;

  // Dosya adinda modelde olmayan fazladan kelime varsa (PRO/PLUS/MAX/ULTRA gibi
  // ayirici ekler dahil), bu dosya farkli/daha ust bir varyant olabilir demektir.
  // Boyle dosyalari cezalandirarak, tam eslesen dosyanin her zaman kazanmasini saglar.
  const fileTokens = imageTokens(fileKey).filter(t => !ignored.has(t));
  const extraTokens = fileTokens.filter(t => !modelTokens.includes(t));

  let score = matched.length * 20;
  if (modelTokens.length && matched.length === modelTokens.length) score += 20;
  else if (modelTokens.length >= 2 && matched.length >= modelTokens.length - 1) score += 10;

  score -= extraTokens.length * 25;

  if (/^(m_|b_|k_)/i.test(file)) score -= 4;
  if (file.toLowerCase().endsWith('.jpg')) score += 1;
  if (file.toLowerCase() === `${fileKey}.jpg`.toLowerCase()) score += 3;

  return score;
}
// GUVENILIRLIK: tarayicinin fetch() fonksiyonu varsayilan olarak SURESIZ
// bekleyebilir. Agin yavas/takildigi durumlarda (ozellikle yeni bir
// telefonun ilk hucresel baglantisinda) istek hicbir zaman ne basarili
// olup ne de hataya dusuyordu - bu yuzden kullanici "Katalog yukleniyor..."
// ekraninda sonsuza kadar kalabiliyordu.
//
// ONEMLI DUZELTME: sadece fetch()'in kendisini degil, cevabin GOVDESINI
// (ornegin buyuk/yavas akan bir TSV/JSON govdesi) okuma suresini deayni
// zaman siniri icine alan bir yardimci. Onceki basit "fetch'i sarmala"
// yaklasimi sadece HTTP basliklari gelene kadar korumaliydi; sunucu
// basliklari hemen donup govdeyi yavas/damla damla gonderirse (once
// hic gozlemlemedigimiz ama gercek cihazlarda karsilasilan bir durum)
// istek yine sonsuza kadar takilabiliyordu. Bu fonksiyon, verilen islevi
// (fetch + .text()/.json() gibi govde okumasi dahil) TEK bir AbortController
// ile sarmalar; sure dolarsa hem baglanti hem de devam eden govde okumasi
// iptal edilir ve normal hata/fallback akisina (catch bloklari) duseriz.
// Google Sheets veri kaynagini, kolon yapisini veya urun objesini
// DEGISTIRMIYOR - sadece "sonsuza kadar bekleme" sorununu cozuyor.
function withTimeout(taskFn, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  return Promise.resolve()
    .then(() => taskFn(controller.signal))
    .finally(() => clearTimeout(timer));
}

// PERFORMANS: GitHub API (IP başına saatte 60 istek sınırı) her sayfa
// açılışında değil, tarayıcı oturumu başına en fazla bir kez çağrılır.
// Katalog İLK render'ı bu isteği BEKLEMEZ: oturum önbelleği varsa render'dan
// önce senkron okunur; yoksa istek arka planda yapılır ve yeni dosya
// bulunursa katalog bir kez yeniden çizilir.
const EXTRA_PHOTOS_SESSION_KEY = 'mixgsm-extra-photos-v1';
const EXTRA_PHOTOS_TIMEOUT_MS = 6000;
const PHOTO_FILE_NAME = /^[A-Za-z0-9._%-]+\.(jpg|jpeg|png|webp)$/i;
let extraPhotosResolved = false;

// Banner/başlık satırları (isNonProductRow) hiçbir görselle eşleşmez; onları
// saymak, gerek yokken her oturumda GitHub API çağrısı yaptırıyordu.
function hasUnmatchedProducts(productList) {
  return productList.some(p => {
    if (isNonProductRow(p) || normalizeGithubImageUrl(p.img)) return false;
    return !GITHUB_PHOTO_FILES.some(file => imageFileScore(p, file) > 0);
  });
}

function loadCachedExtraPhotoFiles() {
  if (extraPhotosResolved) return;
  try {
    const cached = JSON.parse(sessionStorage.getItem(EXTRA_PHOTOS_SESSION_KEY) || 'null');
    if (Array.isArray(cached) && cached.every(n => typeof n === 'string' && PHOTO_FILE_NAME.test(n))) {
      EXTRA_PHOTO_FILES = cached;
      extraPhotosResolved = true;
    }
  } catch (e) { /* bozuk/erişilemeyen önbellek: ağdan denenecek */ }
}

// Yeni (sabit listede olmayan) dosya bulunursa true döner.
async function fetchExtraPhotoFiles() {
  const data = await withTimeout(async (signal) => {
    const res = await fetch('https://api.github.com/repos/mixgsm/mixgsm/contents/photos', {
      headers: { 'Accept': 'application/vnd.github+json' }, signal
    });
    if (!res.ok) return null;
    return res.json();
  }, EXTRA_PHOTOS_TIMEOUT_MS);
  if (!Array.isArray(data)) return false;

  const known = new Set(GITHUB_PHOTO_FILES.map(f => f.toLowerCase()));
  EXTRA_PHOTO_FILES = data
    .map(item => item && item.name)
    .filter(name => typeof name === 'string' && PHOTO_FILE_NAME.test(name) && !known.has(name.toLowerCase()));
  extraPhotosResolved = true;
  try { sessionStorage.setItem(EXTRA_PHOTOS_SESSION_KEY, JSON.stringify(EXTRA_PHOTO_FILES)); } catch (e) { /* kota/gizli mod */ }
  return EXTRA_PHOTO_FILES.length > 0;
}

function discoverExtraPhotosInBackground() {
  if (extraPhotosResolved || !hasUnmatchedProducts(products)) return;
  fetchExtraPhotoFiles().then(found => {
    if (found) {
      render();
      updateProductSchema();
    }
    renderHeroProduct();
  }).catch(() => {
    // GitHub API yok/limit/zaman aşımı: sabit liste + "görsel yok" yedeği çalışmaya devam eder.
    renderHeroProduct();
  });
}

// "12 GB / 1024 GB" -> "1TB", "8 GB / 512 GB" -> "512GB", "256 GB" -> "256GB".
// Depolama = metindeki SON sayı (RAM ilk sayıdır). 1024 GB ve katları TB'ye çevrilir.
function storageLabel(s) {
  const nums = String(s || '').match(/\d+/g);
  if (!nums) return '';
  const gb = Number(nums[nums.length - 1]);
  if (!gb || gb < 16) return '';
  return gb >= 1024 && gb % 1024 === 0 ? `${gb / 1024}TB` : `${gb}GB`;
}

function storageVariantFile(baseFile, s, files) {
  const label = storageLabel(s);
  if (!label || !baseFile) return '';
  const stem = baseFile.replace(/\.[^.]+$/, '').toUpperCase();
  const want = `${stem}-${label}`;
  return files.find(f => f.replace(/\.[^.]+$/, '').toUpperCase() === want) || '';
}

function imageCandidatesForProduct(p) {
  // 1) G sütunundaki GitHub URL'si her zaman önceliklidir.
  const githubImage = normalizeGithubImageUrl(p.img);
  if (githubImage) return [githubImage];

  // 2) G boşsa yalnızca gerçekten mevcut olduğu ekran görüntülerinde görülen
  //    GitHub photos dosyalarından eşleştir. Sabit listede yoksa, sayfa
  //    yüklenirken tespit edilmişse EXTRA_PHOTO_FILES'taki yeni dosyalar da denenir.
  const allPhotoFiles = GITHUB_PHOTO_FILES.concat(EXTRA_PHOTO_FILES);
  const ranked = allPhotoFiles
    .map(file => ({ file, score: imageFileScore(p, file) }))
    .filter(x => x.score > 0)
    .sort((a, b) => b.score - a.score || a.file.localeCompare(b.file));

  if (!ranked.length) return [githubPhotoUrl('gorsel-yok.jpg')];

  // Aynı ürün için yalnızca en güçlü birkaç gerçek dosyayı dene.
  const topScore = ranked[0].score;
  const candidates = ranked
    .filter(x => x.score >= topScore - 2)
    .slice(0, 4)
    .map(x => githubPhotoUrl(x.file));

  // DEPOLAMA VARYANTI: model görseli seçildikten SONRA, aynı dosya adının
  // "-256GB / -512GB / -1TB" uzantılı hali varsa o öne alınır. Yoksa model
  // görseli (fallback) aynen kullanılır. Yalnız kazanan model dosyasının adı
  // temel alındığı için başka modelle karışamaz; RAM dikkate alınmaz.
  const variantFile = storageVariantFile(ranked[0].file, p.s, allPhotoFiles);
  if (variantFile) candidates.unshift(githubPhotoUrl(variantFile));

  return candidates.length ? candidates : [githubPhotoUrl('gorsel-yok.jpg')];
}

function tryNextProductImage(img) {
  try {
    const sources = JSON.parse(img.dataset.imageSources || '[]');
    const index = Number(img.dataset.imageIndex || 0) + 1;

    if(index < sources.length) {
      img.dataset.imageIndex = String(index);
      img.src = sources[index];
      return;
    }
  } catch(e) {}

  img.onerror = null;
  img.src = 'https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/gorsel-yok.jpg';
}

function autoImageMarkup(p) {
  const sources = imageCandidatesForProduct(p);

  if(!sources.length) {
    return `<img src="https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/gorsel-yok.jpg" alt="${escapeHtml(p.m)}" loading="lazy" decoding="async">`;
  }

  const encoded = JSON.stringify(sources).replace(/'/g,'&#39;');

  return `<img src="${escapeHtml(sources[0])}"
    data-image-sources='${encoded}'
    data-image-index="0"
    alt="${escapeHtml(p.b)} ${escapeHtml(p.m)}"
    loading="lazy" decoding="async">`;
}

// Google Sheets'e ulasilamadiginda gosterilecek son basarili katalogu
// tarayicida saklamak icin ayri bir anahtar (favoriler anahtariyla
// karismasin diye). Sadece bir DAYANIKLILIK/yedek mekanizmasidir; Google
// Sheets veri kaynagini degistirmez, sadece baglanti hatasinda devreye girer.
const catalogCacheKey = "mixgsm-catalog-cache-v1";

function saveCatalogCache(list) {
  try {
    localStorage.setItem(catalogCacheKey, JSON.stringify({ ts: Date.now(), products: list }));
  } catch (e) { /* kota/gizli mod - sessizce yoksay, site calismaya devam eder */ }
}

function loadCatalogCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(catalogCacheKey) || "null");
    const list = raw ? sanitizePhoneList(raw.products) : [];
    if (list.length) return list;
  } catch (e) { /* bozuk cache - yoksay */ }
  return null;
}

// GÜVENLİK/VERİ DOĞRULAMA: catalog.json, localStorage önbelleği ve Sheets
// verisi GÜVENİLMEYEN girdi kabul edilir. Her ürün, render'dan önce bu şemaya
// zorlanır: metin alanları yalnızca metin, fiyat yalnızca makul aralıkta tam
// sayı (değilse null = "WhatsApp'tan Sor"), stok yalnızca IN/OUT/ASK
// (bilinmeyen = ASK), etiket/kategori yalnızca bilinen değerler, görsel URL'si
// yeniden beyaz listeden geçer. Alan adları ve anlamları DEĞİŞMEZ.
const PHONE_PRICE_MIN = 100;
const PHONE_PRICE_MAX = 300000;
const LAPTOP_PRICE_MIN = 1000;
const LAPTOP_PRICE_MAX = 500000;
const STOCK_VALUES = ['IN', 'OUT', 'ASK'];
const PHONE_CAT_VALUES = ['APPLE', 'SAMSUNG', 'XIAOMI', 'INFINIX_TECNO', 'OTHER'];
const PHONE_TAGS = { 'MİX GSM Öneriyor': 'tag-oneri', 'Fırsat': 'tag-firsat', 'Popüler': 'tag-populer', 'Yeni': 'tag-yeni' };
const PHONE_TEXT_FIELDS = ['b', 'm', 's', 'battery', 'screen', 'processor', 'camera', 'connectivity', 'registration', 'warranty'];

function toText(v) {
  if (typeof v === 'string') return v;
  return typeof v === 'number' && Number.isFinite(v) ? String(v) : '';
}
function toPrice(v, min, max) {
  return Number.isInteger(v) && v >= min && v <= max ? v : null;
}
function toStock(v) {
  return STOCK_VALUES.includes(v) ? v : 'ASK';
}

function sanitizePhoneProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const p = {};
  PHONE_TEXT_FIELDS.forEach(k => { p[k] = toText(raw[k]); });
  p.p = toPrice(raw.p, PHONE_PRICE_MIN, PHONE_PRICE_MAX);
  p.stock = toStock(raw.stock);
  p.cat = PHONE_CAT_VALUES.includes(raw.cat) ? raw.cat : 'OTHER';
  p.group = raw.group === 'PERSONAL_CARE' ? 'PERSONAL_CARE' : 'PHONE';
  p.img = normalizeGithubImageUrl(raw.img);
  const tagClass = PHONE_TAGS[raw.tagLabel] || '';
  p.tagLabel = tagClass ? raw.tagLabel : '';
  p.tagClass = tagClass;
  return p;
}

function sanitizePhoneList(list) {
  return Array.isArray(list) ? list.map(sanitizePhoneProduct).filter(Boolean) : [];
}

// Adres çubuğundaki slug'ı çözer; bozuk %-kodlamada hata fırlatmak yerine ''
// döner (bulunamayan ürün gibi davranır, katalog yükleme akışı bozulmaz).
function safeDecodeSlug(value) {
  try { return decodeURIComponent(value); } catch (e) { return ''; }
}

function openProductFromHash() {
  const hashMatch = location.hash.match(/^#urun\/(.+)$/);
  if (!hashMatch) return;
  const slug = safeDecodeSlug(hashMatch[1]);
  const idx = findProductBySlug(slug);
  if (idx > -1) renderProductModal(products[idx]);
}

// Katalog verisi geldiğinde (catalog.json / Sheets / önbellek) ORTAK gösterim
// adımları - eskiden üç yerde birebir kopyaydı. fromCache: bağlantı sorunu
// nedeniyle son bilinen katalog gösteriliyor ("güncel olmayabilir" uyarısı).
async function showPhoneCatalog(list, fromCache) {
  products = list;
  if (!fromCache) saveCatalogCache(products);
  const cacheNoticeEl = document.getElementById('cacheNotice');
  if (cacheNoticeEl) cacheNoticeEl.style.display = fromCache ? 'block' : 'none';
  loadCachedExtraPhotoFiles();
  // PERFORMANS: hero (LCP) görseli yalnızca ürün listesine bağlı. src'si
  // kataloğun tamamı çizilmeden ÖNCE atanır ve tarayıcıya kısa bir ara
  // verilir: görsel isteği ancak çalışan görev bitince gönderildiği için ara
  // olmadan indirme, ~100 kartlık render bitene kadar başlamazdı.
  renderHeroProduct(!fromCache && !extraPhotosResolved && hasUnmatchedProducts(products));
  await new Promise(resolve => setTimeout(resolve, 0));
  renderRamFilterOptions();
  render();
  updateProductSchema();
  computeBudgetThreshold();
  openProductFromHash();
  if (!fromCache) discoverExtraPhotosInBackground();
}

// GUVENILIRLIK (same-origin ONCELIKLI yol): musteri tarayicisi katalogu
// ONCE, mixgsm.tr ile AYNI ADRESTEN (same-origin) sunulan "catalog.json"
// dosyasindan yuklemeyi dener. Bu dosya, Google Sheets verisinden GitHub
// Actions tarafindan periyodik olarak otomatik uretilir (bkz.
// .github/workflows/update-catalog.yml + scripts/generate-catalog.js).
// Same-origin bir statik dosya oldugu icin tarayicinin Google Sheets'e
// dogrudan baglanmasini GEREKTIRMEZ - CORS, yonlendirme (redirect) veya
// Google tarafinda yasanabilecek herhangi bir aksama bu yolu ETKILEMEZ.
// Bu dosya henuz olusturulmamissa / bozuksa / bos donerse (ornegin Actions
// ilk kez hic calismadiysa), asagida HIC DEGISTIRILMEDEN duran mevcut
// "Google Sheets'ten dogrudan yukle" yontemine sessizce duser - musteri
// bunu hicbir zaman fark etmez, urun veri yapisi/kolonlari DEGISMEZ.
// ÖNBELLEK: URL sabit (<head>'deki preload ile eşleşsin diye). 'no-cache' =
// tarayıcı her açılışta ETag ile sunucuya sorar (değişmediyse 304). Eski
// "?t=Date.now()" CDN'i zaten atlatmıyordu (GitHub Pages CDN sorgu
// parametresini yok sayıyor); güncellik yine CDN süresiyle (10 dk) sınırlı.
async function loadCatalogFromSameOrigin() {
  return withTimeout(async (signal) => {
    const res = await fetch('catalog.json', { cache: 'no-cache', signal });
    if (!res.ok) throw new Error('catalog.json yok/erişilemedi (HTTP ' + res.status + ')');
    const data = await res.json();
    const list = data ? sanitizePhoneList(data.products) : [];
    if (!list.length) {
      throw new Error('catalog.json boş/geçersiz');
    }
    return list;
  }, 5000);
}

// Katalog yukleme AKISININ giris noktasi (eskiden DOMContentLoaded
// dogrudan loadFromGoogleSheets() cagiriyordu). Sirasiyla: (1) same-origin
// catalog.json -> basarisizsa (2) mevcut, hic degismemis Google Sheets
// dogrudan yontemi (kendi 2-denemeli timeout + cache + hata-mesaji
// mantigiyla birlikte, asagida oldugu gibi). Boylece Google Sheets veri
// kaynagi/kolon yapisi/urun objesi TAMAMEN AYNI kalir; sadece "once nereden
// denenecegi" degisir.
async function loadCatalog() {
  grid.innerHTML = '<div class="empty">Katalog yükleniyor... ⏳</div>';

  // ONEMLI: try/catch SADECE catalog.json'u getirip dogrulama adimini
  // sarmalar. Eger burasi (asagida) genis tutulup render() vb. adimlari da
  // icine alsaydi, catalog.json BASARIYLA gelmis olsa bile render asamasinda
  // olusabilecek ALAKASIZ bir hata yanlislikla "same-origin basarisiz oldu"
  // sanilip GEREKSIZ YERE Google Sheets'e ikinci bir istek atardi. Simdi
  // sadece gercek fetch/dogrulama hatasi fallback'i tetikliyor.
  let sameOriginProducts;
  try {
    sameOriginProducts = await loadCatalogFromSameOrigin();
  } catch (sameOriginErr) {
    // catalog.json yoksa/basarisizsa, ASAGIDA HIC DEGISMEYEN mevcut Google
    // Sheets dogrudan yontemine (kendi tum guvenlik aglariyla) sessizce dus.
    await loadFromGoogleSheets();
    return;
  }

  await showPhoneCatalog(sameOriginProducts, false);
}

// Google Sheets'ten TEK bir dogrudan deneme yapar: fetch + HTTP durum
// kontrolu + govde (TSV metni) okuma - tumu ayni "timeoutMs" suresi
// icinde. withTimeout() sayesinde sadece baglanti degil, govdenin
// tamamen okunmasi da bu sure siniri icinde kalmak zorunda.
async function fetchSheetsTsvOnce(url, timeoutMs) {
  return withTimeout(async (signal) => {
    const res = await fetch(url + '&t=' + Date.now(), { cache: 'no-store', signal });
    if (!res.ok) throw new Error("Excel'e ulaşılamadı.");
    return res.text();
  }, timeoutMs);
}

async function loadFromGoogleSheets() {
  const url = "https://docs.google.com/spreadsheets/d/1PN8gIIC4f57y9R0vy2p6SaLpeCwWWetM1Ga-Xkbrv6o/export?format=tsv&gid=121333260";
  try {
    grid.innerHTML = '<div class="empty">Katalog yükleniyor... ⏳</div>';

    // GUVENILIRLIK: ilk deneme 9 saniye icinde (baglanti + govde okuma dahil)
    // tamamlanmazsa ya da aginda TEK seferlik gecici bir sorun olursa
    // (ornegin mobil veride ilk baglanti), hemen pes edip kullaniciyi hataya
    // dusurmek yerine 6 saniye sure siniriyla BIR kez daha deniyoruz. Ikisi
    // de basarisiz/zaman asimina ugrarsa asagidaki catch blogu (mevcut
    // cache -> hata mesaji sirasiyla) hic degismeden calisir - kullanici
    // hicbir zaman sonsuza kadar "Katalog yukleniyor..." ekraninda kalmaz.
    let tsv;
    try {
      tsv = await fetchSheetsTsvOnce(url, 9000);
    } catch (firstAttemptErr) {
      tsv = await fetchSheetsTsvOnce(url, 6000);
    }

    const lines = tsv.split('\n');
    let newProducts = [];
    let startIndex = lines[0].includes('MARKA') ? 1 : 0;

    for(let i = startIndex; i < lines.length; i++) {
      if(!lines[i].trim()) continue;
      const cols = lines[i].split('\t').map(c => c.trim().replace(/\r/g, ''));
      
      let marka = (cols[0] || '').toUpperCase();
      let model = (cols[1] || '').toUpperCase();
      if(!marka && !model) continue;
      
      let stokWords = normalizeTR(cols[4] || '').split(/\s+/);
      // Stok cozumu = mixgsm-ops/contract/enums.json ile AYNI kural: ASK sozcugu -> ASK | acik olumsuz
      // sozcuk -> OUT | olumlu sozcuk -> IN | TANINMAYAN/BOS -> ASK (bilinmeyen urun OUT gosterilmez).
      let stockStatus = 'ASK';
      if (stokWords.some(w => ['sor', 'sorunuz', 'soru'].includes(w))) {
        stockStatus = 'ASK';
      } else if (stokWords.some(w => ['var', 'stokta', 'mevcut', 'evet'].includes(w)) &&
                 !stokWords.some(w => ['yok', 'tukendi', '0', 'hayir', 'false', 'degil'].includes(w))) {
        stockStatus = 'IN';
      } else if (stokWords.some(w => ['yok', 'tukendi', '0', 'hayir', 'false', 'degil'].includes(w))) {
        stockStatus = 'OUT';
      }
      
      // Fiyat: veri yok / hatali / sifir / metin (orn. "SORUNUZ") - tum bu
      // durumlarda musteriye YANLIS ya da UYDURMA bir rakam gostermek yerine
      // "WhatsApp'tan Sor" gosteriyoruz (finalPrice = null). Gercek, makul
      // araliktaki (100 TL - 300.000 TL) bir sayi varsa onu kullaniyoruz.
      let rawPrice = cols[3] || '';
      let isNegativePrice = /^\s*-/.test(rawPrice);
      let cleanPrice = rawPrice.replace(/[,.]\d{1,2}(?!\d)/g, '').replace(/[^0-9]/g, '');
      let parsedPrice = cleanPrice ? parseInt(cleanPrice, 10) : NaN;
      let finalPrice = (!isNegativePrice && Number.isFinite(parsedPrice) && parsedPrice >= 100 && parsedPrice <= 300000) ? parsedPrice : null;

      let catType = "OTHER";
      if(marka.includes('APPLE') || marka.includes('IPHONE')) catType = "APPLE";
      else if(marka.includes('SAMSUNG')) catType = "SAMSUNG";
      else if(marka.includes('XIAOMI') || marka.includes('REDMI') || marka.includes('POCO')) catType = "XIAOMI";
      else if(marka.includes('INFINIX') || marka.includes('TECNO')) catType = "INFINIX_TECNO";
      
      let groupType = "PHONE";
      const katStr = (cols[5] || '').toLowerCase();
      if(katStr.includes('bakım') || marka.includes('DYSON') || marka.includes('BRAUN') || marka.includes('PHILIPS')) {
        groupType = "PERSONAL_CARE";
      }

      // Etiket (N=GARANTİ, O=ETİKET) - sadece taniyabildigimiz 4 kelimeden biri
      // yazilmissa gosteriyoruz; baska/hatali bir sey yazilmissa hic etiket
      // gostermiyoruz (yanlis/anlamsiz etiket cikmasin diye).
      let warrantyText = (cols[13] || '').trim();
      let tagRaw = normalizeTR(cols[14] || '');
      let tagLabel = '', tagClass = '';
      if (tagRaw.includes('mix') && tagRaw.includes('oneri')) { tagLabel = 'MİX GSM Öneriyor'; tagClass = 'tag-oneri'; }
      else if (tagRaw.includes('firsat')) { tagLabel = 'Fırsat'; tagClass = 'tag-firsat'; }
      else if (tagRaw.includes('populer')) { tagLabel = 'Popüler'; tagClass = 'tag-populer'; }
      else if (tagRaw.includes('yeni')) { tagLabel = 'Yeni'; tagClass = 'tag-yeni'; }

      newProducts.push({
        b: marka, m: model, s: cols[2] || '',
        p: finalPrice,
        stock: stockStatus, cat: catType, group: groupType,
        img: normalizeGithubImageUrl(cols[6] || ''),
        battery: cols[7] || '', screen: cols[8] || '',
        processor: cols[9] || '', camera: cols[10] || '',
        connectivity: cols[11] || '', registration: cols[12] || '',
        warranty: warrantyText, tagLabel: tagLabel, tagClass: tagClass
      });
    }
    
    // Paylasilan bir urun linkiyle gelindiyse (#urun/xxx) showPhoneCatalog
    // katalog cizildikten sonra ilgili urunu otomatik acar.
    const sheetProducts = sanitizePhoneList(newProducts);
    if (!sheetProducts.length) throw new Error('Sheets verisi boş');
    await showPhoneCatalog(sheetProducts, false);
  } catch (err) {
    // DAYANIKLILIK: canli Google Sheets baglantisi basarisiz oldu. Eger daha
    // once basariyla yuklenmis bir katalog tarayicida sakliysa, musteriyi
    // tamamen bos/hata ekraniyla karsilamak yerine o son bilinen katalogu
    // ACIKCA "guncel olmayabilir" uyarisiyla birlikte gosteriyoruz. Cache de
    // yoksa mevcut hata ekrani aynen korunuyor.
    const cached = loadCatalogCache();
    if (cached && cached.length) {
      try {
        await showPhoneCatalog(cached, true);
        return;
      } catch (renderErr) { /* cache verisiyle render de basarisiz olursa asagidaki genel hataya dus */ }
    }
    count.textContent = 'Katalog yüklenemedi';   // "Yükleniyor..." takılı kalmasın
    grid.innerHTML = `<div class="empty">Katalog şu anda yenileniyor. Lütfen sayfayı yenileyin veya WhatsApp üzerinden güncel stok/fiyat sorabilirsiniz.<br><br><a href="https://wa.me/905424818255" target="_blank" rel="noopener noreferrer" class="btn-whatsapp" style="display:inline-flex;margin-top:15px;justify-content:center;"><svg class="icon"><use href="#ic-chat"></use></svg> WhatsApp'tan Ürün Sor</a></div>`;
  }
}

function escapeHtml(value) {
  return String(value ?? '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

// REDESIGN SAĞLAMLAŞTIRMA: telefon kartı TEK yerde üretilir (katalog +
// vitrinler). Satır içi onclick YOK; tıklamalar data-action ile merkezi
// dinleyiciye (initActionDelegation) gider. İşaretleme ve sınıflar aynı.
function phoneCardHtml(p, extraAttrs) {
  const badge = p.stock === 'IN' ? '<span class="stock">● Stokta</span>'
    : p.stock === 'ASK' ? '<span class="stock ask">Sorunuz</span>'
    : '<span class="stock no">Tükendi</span>';
  const priceDisplay = p.p === null ? `<strong class="price-query">WhatsApp'tan Sor</strong>` : `<strong>${fmt(p.p)} <em>TL</em></strong>`;
  const pk = favKeyOf(p);
  const pIndex = products.indexOf(p);
  const imgMarkup = autoImageMarkup(p);
  const tagMarkup = p.tagLabel ? `<span class="tagbadge ${p.tagClass}">${escapeHtml(p.tagLabel)}</span>` : '';
  const isComparing = compareList.includes(pk);
  const fav = isFav(p);
  return `
    <article class="card ${isComparing ? "comparing" : ""}" ${extraAttrs || ''} data-i="${pIndex}" data-action="open-product">
      <div class="visual">
        ${tagMarkup}
        ${badge}
        <button type="button" class="fav ${fav ? "active" : ""}" data-action="fav" data-i="${pIndex}" aria-label="${fav ? "Favorilerden çıkar" : "Favoriye ekle"}"><svg class="icon" aria-hidden="true"><use href="#ic-heart"></use></svg></button>
        ${imgMarkup}
      </div>
      <div class="info">
        <div class="brand">${escapeHtml(p.b)}</div>
        <div class="name"><button type="button" class="card-open" data-action="open-product" data-i="${pIndex}" aria-label="${escapeHtml(p.b)} ${escapeHtml(p.m)} ürününü görüntüle">${escapeHtml(p.m)}</button></div>
        <span class="spec">${escapeHtml(p.s)}</span>
        <div class="bottom">
          <div class="price">
            <small>GÜNCEL FİYAT</small>
            ${priceDisplay}
          </div>
          <button type="button" class="compare-toggle ${isComparing ? "active" : ""}" data-action="compare" data-i="${pIndex}"><svg class="icon" aria-hidden="true"><use href="#ic-compare"></use></svg> ${isComparing ? "Seçildi" : "Karşılaştır"}</button>
        </div>
      </div>
    </article>`;
}

function render() {
  let filtered = products.filter(p => !isNonProductRow(p) &&
    (cat === "ALL" || p.cat === cat) &&
    (group === "ALL" || p.group === group) &&
    (ramFilter === "ALL" || extractRAM(p.s) === ramFilter) &&
    (!only5G || is5GConnectivity(p.connectivity)) &&
    (!minBattery || extractLeadingNumber(p.battery) >= minBattery) &&
    (priceMin === null || (p.p !== null && p.p >= priceMin)) &&
    (priceMax === null || (p.p !== null && p.p <= priceMax)) &&
    (!minCamera || extractLeadingNumber(p.camera) >= minCamera) &&
    (!minPerf || perfTierOf(p) >= minPerf)
  );
  
  if(q) {
    filtered.forEach(p => p._score = searchScore(p, q));
    filtered = filtered.filter(p => p._score > 0).sort((a,b) => b._score - a._score);
  }

  if(sort === "low") filtered.sort((x, y) => (x.p || Infinity) - (y.p || Infinity));
  if(sort === "high") filtered.sort((x, y) => (y.p || -Infinity) - (x.p || -Infinity));
  if(sort === "name") filtered.sort((x, y) => x.m.localeCompare(y.m, "tr"));

  count.textContent = `${filtered.length} ürün listeleniyor`;
  
  grid.innerHTML = filtered.length ? filtered.map(p => phoneCardHtml(p  )).join("") : '<div class="empty">Aradığınız kriterde ürün bulunamadı.</div>';
}

// Arama debounce: kullanici her harfe bastiginda degil, yazmayi ~300ms
// kestiginde render() calisir. Davranis degismiyor - sadece her tus vurusunda
// tum kataloğun yeniden cizilmesini onluyor (performans).
let searchDebounceTimer = null;
document.querySelector("#q").addEventListener("input", e => {
  q = e.target.value.trim();

  if (q.length > 0) {
    cat = "ALL";
    group = "ALL";

    document.querySelectorAll(".filter-group button").forEach(x => x.classList.remove("active"));

    const fAll = document.querySelector('#filters button[data-cat="ALL"]');
    const cAll = document.querySelector('#categoryFilters button[data-group="ALL"]');
    if (fAll) fAll.classList.add("active");
    if (cAll) cAll.classList.add("active");
  }

  clearTimeout(searchDebounceTimer);
  searchDebounceTimer = setTimeout(render, 300);
});

document.querySelector("#sort").addEventListener("change", e => { sort = e.target.value; render(); });

document.querySelectorAll("#filters button").forEach(b => {
  b.addEventListener("click", () => {
    cat = b.dataset.cat;
    document.querySelectorAll("#filters button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    render();
  });
});

document.querySelectorAll("#categoryFilters button").forEach(b => {
  b.addEventListener("click", () => {
    group = b.dataset.group;
    document.querySelectorAll("#categoryFilters button").forEach(x => x.classList.remove("active"));
    b.classList.add("active");
    render();
  });
});

// --- Gelismis filtre kontrolleri (Faz 11) ---
document.getElementById("priceMinInput").addEventListener("input", e => {
  const v = e.target.value.trim();
  priceMin = v === '' ? null : Math.max(0, parseInt(v, 10) || 0);
  render();
});
document.getElementById("priceMaxInput").addEventListener("input", e => {
  const v = e.target.value.trim();
  priceMax = v === '' ? null : Math.max(0, parseInt(v, 10) || 0);
  render();
});
document.getElementById("only5GCheck").addEventListener("change", e => {
  only5G = e.target.checked;
  render();
});
document.getElementById("minBatterySelect").addEventListener("change", e => {
  minBattery = parseInt(e.target.value, 10) || 0;
  render();
});
document.getElementById("advClearBtn").addEventListener("click", () => {
  ramFilter = "ALL"; only5G = false; minBattery = 0; priceMin = null; priceMax = null;
  minCamera = 0; minPerf = 0;
  document.getElementById("priceMinInput").value = '';
  document.getElementById("priceMaxInput").value = '';
  document.getElementById("only5GCheck").checked = false;
  document.getElementById("minBatterySelect").value = '0';
  document.querySelectorAll('#ramFilterGroup button').forEach(x => x.classList.remove('active'));
  const ramAllBtn = document.querySelector('#ramFilterGroup button[data-ram="ALL"]');
  if (ramAllBtn) ramAllBtn.classList.add('active');
  document.querySelectorAll('#quickusePills button').forEach(x => x.classList.remove('active'));
  render();
});

// --- Akilli kullanim alani pilleri ---
// Sadece gercek sutun verisine dayanir: Batarya (mAh), Kamera (MP) ve
// Islemci metnindeki bilinen kademe (perfTierOf, Telefonumu Bul
// sihirbazinda zaten kullanilan ayni tahmini kademe). "Uygun Fiyat" katalog
// yuklendikten sonra GERCEK fiyatlardan hesaplanan medyan deger uzerinden
// calisir (bkz. computeBudgetThreshold). Sabit/uydurma bir esik degildir.
const QUICKUSE_CAMERA_MP = 50;
const QUICKUSE_BATTERY_MAH = 5000;
const QUICKUSE_PERF_TIER = 2;
let budgetThreshold = null;

function computeBudgetThreshold() {
  const prices = products.filter(p => !isNonProductRow(p) && p.group === 'PHONE' && p.p !== null).map(p => p.p).sort((a, b) => a - b);
  if (!prices.length) { budgetThreshold = null; return; }
  const mid = Math.floor(prices.length / 2);
  // medyan: tek sayida eleman -> ortadaki deger, cift sayida eleman ->
  // ortadaki iki degerin ortalamasi (matematiksel olarak dogru medyan tanimi)
  budgetThreshold = prices.length % 2 === 0 ? (prices[mid - 1] + prices[mid]) / 2 : prices[mid];
}

document.querySelectorAll('#quickusePills button').forEach(btn => {
  btn.addEventListener('click', () => {
    const key = btn.dataset.quick;
    const willActivate = !btn.classList.contains('active');
    btn.classList.toggle('active');

    if (key === 'battery') {
      minBattery = willActivate ? QUICKUSE_BATTERY_MAH : 0;
      document.getElementById('minBatterySelect').value = String(minBattery);
    } else if (key === 'price') {
      if (willActivate && budgetThreshold === null) computeBudgetThreshold();
      priceMax = willActivate ? budgetThreshold : null;
      document.getElementById('priceMaxInput').value = priceMax || '';
    } else if (key === 'camera') {
      minCamera = willActivate ? QUICKUSE_CAMERA_MP : 0;
    } else if (key === 'perf') {
      minPerf = willActivate ? QUICKUSE_PERF_TIER : 0;
    }
    render();
  });
});

// GUVENLIK/STABILITE: birden fazla modal/cekmece ust uste acilip
// kapanirsa (orn. baska bir modal acikken bu kapanirsa), arka plan
// kaydirmasi SADECE gercekten hicbir modal/cekmece kalmadiysa tekrar
// acilsin. Aksi halde hala acik bir modal varken arkaplan kayabilirdi.
function anyModalOpen() {
  const modalIds = ['modal', 'comparemodal', 'favmodal', 'findermodal', 'legalmodal'];
  if (modalIds.some(id => { const el = document.getElementById(id); return el && el.classList.contains('open'); })) return true;
  const panel = document.getElementById('filterPanel');
  return !!(panel && panel.classList.contains('open'));
}

// Filtre çekmecesi (mobil <=900px)
function openFilterDrawer() {
  document.getElementById('filterPanel').classList.add('open');
  document.getElementById('filterBackdrop').classList.add('open');
  lockBodyScroll();
  // ERISILEBILIRLIK: klavye/ekran okuyucu kullanan kullanicilar acilan
  // cekmeceye odaklansin (mevcut urun modalindaki ayni davranis).
  const closeBtn = document.querySelector('#filterPanel .close');
  if (closeBtn) closeBtn.focus();
}
function closeFilterDrawer() {
  document.getElementById('filterPanel').classList.remove('open');
  document.getElementById('filterBackdrop').classList.remove('open');
  if (!anyModalOpen()) unlockBodyScroll();
}

// Tükenen bir ürün için katalogdaki STOKTA OLAN diger urunler arasindan
// benzerlerini bulur: once ayni marka grubu (cat), sonra fiyat yakinligi
// esas alinir. Sadece gercekten sheet'ten gelen, stokta olan urunler
// onerilir - hicbir veri uydurulmaz.
function getSimilarProducts(p) {
  const candidates = products.filter(other =>
    other.stock === 'IN' &&
    other.group === p.group &&
    !(other.b === p.b && other.m === p.m && other.s === p.s)
  );

  const scored = candidates.map(other => {
    let score = (other.cat === p.cat) ? 100 : 0;
    if (p.p !== null && other.p !== null) {
      score -= Math.abs(other.p - p.p) / 1000;
    }
    return { other, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.slice(0, 4).map(x => x.other);
}

function renderSimilarProducts(p) {
  const similarBox = document.getElementById("similarBox");
  const similarList = document.getElementById("similarList");

  if (p.stock !== "OUT") { similarBox.style.display = "none"; return; }

  const similar = getSimilarProducts(p);
  if (!similar.length) { similarBox.style.display = "none"; return; }

  similarBox.style.display = "block";
  similarList.innerHTML = similar.map(sp => {
    const spIndex = products.indexOf(sp);
    const spImg = imageCandidatesForProduct(sp)[0] || 'https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/gorsel-yok.jpg';
    const spPrice = sp.p === null ? `WhatsApp'tan Sor` : `${fmt(sp.p)} TL`;
    return `<div class="similar-item" data-action="open-product" data-i="${spIndex}" role="button" tabindex="0" aria-label="${escapeHtml(sp.b)} ${escapeHtml(sp.m)} ürününü görüntüle">
      <img src="${escapeHtml(spImg)}" alt="${escapeHtml(sp.m)}" loading="lazy" decoding="async">
      <div class="similar-name">${escapeHtml(sp.m)}</div>
      <div class="similar-price">${spPrice}</div>
    </div>`;
  }).join('');
}

function renderProductModal(p) {
  const modal = document.getElementById("modal");
  const modalImg = document.getElementById("mi");
  
  const sources = imageCandidatesForProduct(p);
  modalImg.dataset.imageSources = JSON.stringify(sources);
  modalImg.dataset.imageIndex = "0";
  // Görsel hatası: merkezi 'error' dinleyicisi (initActionDelegation) yönetir.
  modalImg.onerror = null;
  modalImg.src = sources[0] || 'https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/gorsel-yok.jpg';
  
  document.getElementById("mb").textContent = p.b;
  document.getElementById("mn").textContent = p.m;
  // GUVENLIK: innerHTML yerine DOM/textContent kullanarak yaziliyor - fiyat
  // alani zaten sayisal olarak dogrulanmis olsa da (bkz. loadFromGoogleSheets),
  // bu ekstra bir koruma katmanidir (defense-in-depth).
  const mpEl = document.getElementById("mp");
  mpEl.textContent = "";
  if (p.p === null) {
    const span = document.createElement("span");
    span.style.color = "var(--whatsapp)";
    span.style.fontSize = "22px";
    span.style.fontWeight = "600";
    span.textContent = "WhatsApp'tan Fiyat Sorunuz";
    mpEl.appendChild(span);
  } else {
    mpEl.textContent = `${fmt(p.p)} TL`;
  }
  
  document.getElementById("outOfStockWarn").style.display = p.stock === "OUT" ? "block" : "none";
  renderSimilarProducts(p);

  const setRow = (id, val) => {
    const tr = document.getElementById(`tr-${id}`);
    if(val && val.trim()) { tr.style.display = ""; document.getElementById(`mf${id}`).textContent = val; }
    else { tr.style.display = "none"; }
  };

  setRow("spec", p.s); setRow("screen", p.screen); setRow("processor", p.processor);
  setRow("camera", p.camera); setRow("battery", p.battery);
  setRow("connectivity", p.connectivity); setRow("registration", p.registration);
  setRow("warranty", p.warranty);

  const waText = `Merhaba MİX GSM, katalogdan ${p.b} ${p.m} ${p.s ? '('+p.s+')' : ''} modeli hakkında stok ve fiyat bilgisi almak istiyorum.`;
  document.getElementById("mw").href = `https://wa.me/905424818255?text=${encodeURIComponent(waText)}`;

  // Sadece telefonlar icin GSMArena arama linki gosteriliyor (kisisel bakim
  // urunleri GSMArena'da yok). Kendi verimizi degil, dogrudan GSMArena'nin
  // kendi arama sonucunu actigimiz icin yanlis/uydurma bir teknik bilgi
  // riski yok.
  const gsmLink = document.getElementById("mGsmarena");
  if (p.group === "PHONE") {
    const gsmQuery = encodeURIComponent(`${p.b} ${p.m}`.trim());
    gsmLink.href = `https://www.gsmarena.com/results.php3?sQuickSearch=yes&sName=${gsmQuery}`;
    gsmLink.style.display = "block";
  } else {
    gsmLink.style.display = "none";
  }
  
  modal.classList.add("open");
  lockBodyScroll();
  modal.querySelector('.close').focus();
}

function openProduct(i) {
  const p = products[i];
  renderProductModal(p);

  // Urun linki: adres cubugunu bu urune ozel, paylasilabilir bir linke
  // gunceller (sayfayi yeniden yuklemeden, history.pushState ile).
  try {
    const newUrl = location.pathname + location.search + '#urun/' + productSlug(p);
    history.pushState({ productSlug: productSlug(p) }, '', newUrl);
  } catch (e) {}
}

function closeProduct() {
  document.getElementById("modal").classList.remove("open");
  if (!anyModalOpen()) unlockBodyScroll();

  // Urun kapatilinca linki temiz ana sayfa adresine geri al.
  try {
    if (location.hash.startsWith('#urun/')) {
      history.pushState({}, '', location.pathname + location.search);
    }
  } catch (e) {}
}

function copyProductLink() {
  navigator.clipboard.writeText(location.href).then(() => {
    showToast('Ürün linki kopyalandı!');
  }).catch(() => {
    showToast('Link kopyalanamadı, adres çubuğundan kopyalayabilirsiniz.');
  });
}

function toggleFav(e, index) {
  e.stopPropagation();
  const p = products[index];
  const pk = favKeyOf(p);
  const target = normalizedFavKey(pk);
  if (favs.some(k => normalizedFavKey(k) === target)) {
    favs = favs.filter(k => normalizedFavKey(k) !== target);
  } else {
    favs.push(pk);
  }
  saveFavsToStorage();
  updateFavs(); render();
}

// --- Karsilastirma (Faz 8) ---
function toggleCompare(e, index) {
  e.stopPropagation();
  const p = products[index];
  const pk = `${p.b}|${p.m}|${p.s}`;
  if (compareList.includes(pk)) {
    compareList = compareList.filter(x => x !== pk);
  } else {
    if (compareList.length >= 4) {
      showToast('En fazla 4 ürünü karşılaştırabilirsiniz.');
      return;
    }
    compareList.push(pk);
  }
  updateCompareBar();
  render();
}

function updateCompareBar() {
  document.getElementById('comparecount').textContent = `${compareList.length} ürün seçildi`;
  document.getElementById('comparetraybar').classList.toggle('show', compareList.length > 0);
  document.getElementById('compareViewBtn').style.display = compareList.length >= 2 ? 'inline-block' : 'none';
  const bnBadge = document.getElementById('bnCompareBadge');
  if (bnBadge) {
    bnBadge.textContent = String(compareList.length);
    bnBadge.classList.toggle('show', compareList.length > 0);
  }
  updateFloatingBarsLayout();
}

// Mobil alt gezinmedeki "Karsilastir" butonu: secili urun varsa dogrudan
// karsilastirma tablosunu acar, yoksa katalogda urun secmeye yonlendirir.
function bottomNavCompare() {
  if (compareList.length) { openCompareModal(); }
  else { showToast('Önce karşılaştırmak için ürün seçin'); document.getElementById('catalog').scrollIntoView({ behavior: smoothOrAuto() }); }
}

// Favoriler cubugu VE karsilastirma cubugu ayni anda gorunur olabilir.
// Dar (mobil) ekranlarda ikisi de alt kenara yakin oldugu icin ust uste
// binebiliyordu - burada karsilastirma cubugunu, favoriler cubugunun
// gercek yuksekligine gore dinamik olarak onun ustune tasiyoruz.
function updateFloatingBarsLayout() {
  const favBar = document.getElementById('comparebar');
  const compareBar = document.getElementById('comparetraybar');
  if (!favBar || !compareBar) return;
  const bothShown = favBar.classList.contains('show') && compareBar.classList.contains('show');
  if (bothShown && window.innerWidth <= 720) {
    // Favoriler barinin CSS'ten gelen taban konumunu (bottom-nav + safe-area
    // dahil) esas al, boylece bottom-nav yuksekligi ileride degisirse bu
    // hesap da otomatik dogru kalir.
    const favBaseBottom = parseFloat(getComputedStyle(favBar).bottom) || 0;
    const favHeight = favBar.offsetHeight || 44;
    compareBar.style.bottom = (favBaseBottom + favHeight + 14) + 'px';
  } else {
    compareBar.style.bottom = '';
  }
}
window.addEventListener('resize', updateFloatingBarsLayout);

function clearCompare() {
  compareList = [];
  updateCompareBar();
  render();
}

function getCompareProducts() {
  return compareList
    .map(pk => products.find(p => `${p.b}|${p.m}|${p.s}` === pk))
    .filter(Boolean);
}

function removeFromCompare(pk) {
  compareList = compareList.filter(x => x !== pk);
  updateCompareBar();
  render();
  if (compareList.length < 2) { closeCompareModal(); return; }
  renderCompareTable();
}

function openCompareModal() {
  if (compareList.length < 2) { showToast('Karşılaştırmak için en az 2 ürün seçin.'); return; }
  renderCompareTable();
  document.getElementById('comparemodal').classList.add('open');
  lockBodyScroll();
  const closeBtn = document.querySelector('#comparemodal .close');
  if (closeBtn) closeBtn.focus();
}

function closeCompareModal() {
  document.getElementById('comparemodal').classList.remove('open');
  if (!anyModalOpen()) unlockBodyScroll();
}

function renderCompareTable() {
  const items = getCompareProducts();
  const wrap = document.getElementById('compareTableWrap');

  // Sadece gercekten sheet'ten gelen alanlar gosteriliyor; hicbir deger uydurulmuyor.
  const rows = [
    ['Fiyat', p => p.p === null ? "WhatsApp'tan Sor" : `${fmt(p.p)} TL`],
    ['RAM / Hafıza', p => p.s || '-'],
    ['Stok', p => p.stock === 'IN' ? 'Stokta' : p.stock === 'ASK' ? 'Sorunuz' : 'Tükendi'],
    ['Batarya', p => p.battery || '-'],
    ['Ekran', p => p.screen || '-'],
    ['İşlemci', p => p.processor || '-'],
    ['Kamera', p => p.camera || '-'],
    ['Bağlantı', p => p.connectivity || '-'],
    ['Kayıt Durumu', p => p.registration || '-'],
    ['Garanti / İade', p => p.warranty || '-'],
  ];

  let html = '<table class="comparetable"><thead><tr><th><span class="sr-only">Özellik</span></th>';
  items.forEach(p => {
    const img = imageCandidatesForProduct(p)[0] || 'https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/gorsel-yok.jpg';
    const pk = `${p.b}|${p.m}|${p.s}`;
    html += `<th>
      <img class="compare-thumb" src="${escapeHtml(img)}" alt="${escapeHtml(p.m)}" loading="lazy" decoding="async">
      <div>${escapeHtml(p.b)}</div>
      <div>${escapeHtml(p.m)}</div>
      <button type="button" class="compare-remove" data-action="remove-compare" data-key="${escapeHtml(pk)}">Kaldır <span aria-hidden="true">✕</span></button>
    </th>`;
  });
  html += '</tr></thead><tbody>';

  // "Sadece Farkları Göster" acikken, karsilastirilan TUM urunlerde birebir
  // ayni deger olan satirlar (orn. hepsinde ayni ekran boyutu) gizlenir.
  // Yeni bir karsilastirma sistemi degil, mevcut tabloya eklenen basit bir
  // goruntuleme filtresidir - veri/mantik degismez.
  const diffOnly = compareDiffOnly && items.length > 1;
  let visibleRowCount = 0;
  rows.forEach(([label, getter]) => {
    const values = items.map(p => String(getter(p)));
    const allSame = values.every(v => v === values[0]);
    if (diffOnly && allSame) return;
    visibleRowCount++;
    html += `<tr><td>${escapeHtml(label)}</td>`;
    values.forEach(v => { html += `<td>${escapeHtml(v)}</td>`; });
    html += '</tr>';
  });
  html += '</tbody></table>';

  if (diffOnly && visibleRowCount === 0) {
    html += '<div class="fav-empty">Seçili ürünler arasında fark bulunamadı, tüm özellikler aynı.</div>';
  }

  wrap.innerHTML = html;
}

function updateFavs() {
  document.getElementById("favcount").textContent = `${favs.length} favori`;
  document.getElementById("comparebar").classList.toggle("show", favs.length > 0);
  updateFloatingBarsLayout();
}

function clearFavs() { favs = []; saveFavsToStorage(); updateFavs(); render(); closeFavModal(); showToast("Favoriler temizlendi"); }

// --- Favoriler paneli (Faz 9) ---
function getFavProducts() {
  return favs
    .map(k => {
      const target = normalizedFavKey(k);
      return products.find(p => normalizedFavKey(favKeyOf(p)) === target);
    })
    .filter(Boolean);
}

function removeFav(pk) {
  const target = normalizedFavKey(pk);
  favs = favs.filter(k => normalizedFavKey(k) !== target);
  saveFavsToStorage();
  updateFavs(); render();
  if (!favs.length) { closeFavModal(); return; }
  renderFavList();
}

function openLegalModal() {
  document.getElementById('legalmodal').classList.add('open');
  lockBodyScroll();
  const closeBtn = document.querySelector('#legalmodal .close');
  if (closeBtn) closeBtn.focus();
}

function closeLegalModal() {
  document.getElementById('legalmodal').classList.remove('open');
  if (!anyModalOpen()) unlockBodyScroll();
}

function openFavModal() {
  if (!favs.length) { showToast('Henüz favori ürününüz yok.'); return; }
  renderFavList();
  document.getElementById('favmodal').classList.add('open');
  lockBodyScroll();
  const closeBtn = document.querySelector('#favmodal .close');
  if (closeBtn) closeBtn.focus();
}

function closeFavModal() {
  document.getElementById('favmodal').classList.remove('open');
  if (!anyModalOpen()) unlockBodyScroll();
}

function renderFavList() {
  const items = getFavProducts();
  const wrap = document.getElementById('favListWrap');
  const shareLink = document.getElementById('favWaShare');

  if (!items.length) {
    wrap.innerHTML = '<div class="fav-empty">Henüz favori ürününüz yok.</div>';
    shareLink.style.display = 'none';
    return;
  }

  wrap.innerHTML = '<div class="fav-list">' + items.map(p => {
    const img = imageCandidatesForProduct(p)[0] || 'https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/gorsel-yok.jpg';
    const priceText = p.p === null ? "WhatsApp'tan Sor" : `${fmt(p.p)} TL`;
    const pk = favKeyOf(p);
    const pIndex = products.indexOf(p);
    return `<div class="fav-item">
      <div data-action="fav-open" data-i="${pIndex}" role="button" tabindex="0" aria-label="${escapeHtml(p.b)} ${escapeHtml(p.m)} ürününü görüntüle">
        <img src="${escapeHtml(img)}" alt="${escapeHtml(p.m)}" loading="lazy" decoding="async">
        <div class="fav-item-name">${escapeHtml(p.b)} ${escapeHtml(p.m)}</div>
        <div class="fav-item-price">${priceText}</div>
      </div>
      <button type="button" class="compare-remove" data-action="remove-fav" data-key="${escapeHtml(pk)}">Kaldır <span aria-hidden="true">✕</span></button>
    </div>`;
  }).join('') + '</div>';

  shareLink.style.display = 'block';
  // Musteriye gonderilecek mesajda SADECE sheet'ten gelen gercek fiyat/model
  // bilgisi kullaniliyor, hicbir sey uydurulmuyor.
  let waText = 'Merhaba MİX GSM, favorilerime eklediğim şu ürünlerle ilgileniyorum:\n\n';
  items.forEach(p => {
    const priceText = p.p === null ? 'fiyat sorulacak' : `${fmt(p.p)} TL`;
    waText += `• ${p.b} ${p.m}${p.s ? ' (' + p.s + ')' : ''} - ${priceText}\n`;
  });
  shareLink.href = `https://wa.me/905424818255?text=${encodeURIComponent(waText)}`;
}

// --- Telefonumu Bul sihirbazi (Faz 10) ---
const finderState = { budget: null, priority: null, brand: null };

const FINDER_BUDGETS = [
  { label: '15.000 TL altı', min: 0, max: 15000 },
  { label: '15.000 - 30.000 TL', min: 15000, max: 30000 },
  { label: '30.000 - 50.000 TL', min: 30000, max: 50000 },
  { label: '50.000 TL üzeri', min: 50000, max: Infinity },
];

const FINDER_PRIORITIES = [
  { label: '<svg class="icon"><use href="#ic-camera"></use></svg> Kamera', key: 'camera' },
  { label: '<svg class="icon"><use href="#ic-battery"></use></svg> Batarya', key: 'battery' },
  { label: '<svg class="icon"><use href="#ic-bolt"></use></svg> Performans / Oyun', key: 'performance' },
  { label: '<svg class="icon"><use href="#ic-tag"></use></svg> Fiyat / Performans', key: 'value' },
];

const FINDER_BRANDS = [
  { label: 'Apple', cat: 'APPLE' },
  { label: 'Samsung', cat: 'SAMSUNG' },
  { label: 'Xiaomi / Redmi / POCO', cat: 'XIAOMI' },
  { label: 'Farketmez', cat: 'ALL' },
];

function openFinderModal() {
  finderState.budget = null; finderState.priority = null; finderState.brand = null;
  renderFinderStep(1);
  document.getElementById('findermodal').classList.add('open');
  lockBodyScroll();
  const closeBtn = document.querySelector('#findermodal .close');
  if (closeBtn) closeBtn.focus();
}

function closeFinderModal() {
  document.getElementById('findermodal').classList.remove('open');
  if (!anyModalOpen()) unlockBodyScroll();
}

function restartFinder() { renderFinderStep(1); }

function renderFinderStep(step) {
  ['finderStep1', 'finderStep2', 'finderStep3', 'finderResults'].forEach((id, i) => {
    document.getElementById(id).style.display = (i + 1 === step) ? 'block' : 'none';
  });
  if (step === 1) {
    document.getElementById('finderBudgetOpts').innerHTML = FINDER_BUDGETS.map((b, i) =>
      `<button type="button" class="finder-opt" data-action="finder-budget" data-i="${i}">${escapeHtml(b.label)}</button>`
    ).join('');
  } else if (step === 2) {
    document.getElementById('finderPriorityOpts').innerHTML = FINDER_PRIORITIES.map((p, i) =>
      `<button type="button" class="finder-opt" data-action="finder-priority" data-i="${i}">${p.label}</button>`
    ).join('');
  } else if (step === 3) {
    document.getElementById('finderBrandOpts').innerHTML = FINDER_BRANDS.map((b, i) =>
      `<button type="button" class="finder-opt" data-action="finder-brand" data-i="${i}">${escapeHtml(b.label)}</button>`
    ).join('');
  }
}

function selectFinderBudget(i) { finderState.budget = FINDER_BUDGETS[i]; renderFinderStep(2); }
function selectFinderPriority(i) { finderState.priority = FINDER_PRIORITIES[i]; renderFinderStep(3); }
function selectFinderBrand(i) { finderState.brand = FINDER_BRANDS[i]; showFinderResults(); }

function extractLeadingNumber(str) {
  const m = String(str || '').replace(',', '.').match(/[\d.]+/);
  return m ? parseFloat(m[0]) : 0;
}

// Islemci metnindeki bilinen anahtar kelimelere gore kaba bir performans
// kademesi tahmini. Kesin bir benchmark degildir, sadece siralama icin
// yardimci bir ipucudur - musteriye "en guclu" gibi kesin bir iddia
// olarak sunulmaz.
const FINDER_PERF_TIER3 = /snapdragon 8|dimensity 9|dimensity 8|a19|a18|a17|tensor/i;
const FINDER_PERF_TIER2 = /snapdragon 7|snapdragon 6s|dimensity 7|helio g99/i;
function perfTierOf(p) {
  const text = p.processor || '';
  if (FINDER_PERF_TIER3.test(text)) return 3;
  if (FINDER_PERF_TIER2.test(text)) return 2;
  return 1;
}

function showFinderResults() {
  const { budget, priority, brand } = finderState;
  let candidates = products.filter(p =>
    p.group === 'PHONE' &&
    p.p !== null &&
    p.p >= budget.min && p.p < budget.max &&
    (brand.cat === 'ALL' || p.cat === brand.cat)
  );

  // Once stokta olanlari goster; hic stokta olan yoksa "sorunuz" durumundakileri
  // de dahil et (ama tukenmis olanlari asla onerme).
  const inStock = candidates.filter(p => p.stock === 'IN');
  candidates = inStock.length ? inStock : candidates.filter(p => p.stock !== 'OUT');

  const scoreOf = (p) => {
    if (priority.key === 'camera') return extractLeadingNumber(p.camera);
    if (priority.key === 'battery') return extractLeadingNumber(p.battery);
    if (priority.key === 'performance') return perfTierOf(p) * 1000000 - p.p;
    return -p.p; // 'value': butce icinde en uygun fiyatli olan basta
  };

  candidates.sort((a, b) => scoreOf(b) - scoreOf(a));
  const results = candidates.slice(0, 3);

  const wrap = document.getElementById('finderResultsWrap');
  if (!results.length) {
    const waMsg = encodeURIComponent('Merhaba MİX GSM, bütçeme uygun telefon önerisi almak istiyorum.');
    wrap.innerHTML = `<div class="fav-empty">Bu kriterlere tam uyan bir ürün bulamadık. Farklı bir bütçe deneyebilir ya da doğrudan WhatsApp'tan sorabilirsin.</div>
      <a href="https://wa.me/905424818255?text=${waMsg}" target="_blank" rel="noopener noreferrer" class="modalwa" style="margin-top:12px;"><svg class="icon"><use href="#ic-chat"></use></svg> WhatsApp'tan Sor</a>`;
  } else {
    wrap.innerHTML = '<div class="finder-q">Senin için önerilerimiz:</div><div class="fav-list">' +
      results.map(p => {
        const img = imageCandidatesForProduct(p)[0] || 'https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/gorsel-yok.jpg';
        const priceText = p.p === null ? "WhatsApp'tan Sor" : `${fmt(p.p)} TL`;
        const pIndex = products.indexOf(p);
        return `<div class="fav-item" data-action="finder-open" data-i="${pIndex}" role="button" tabindex="0" aria-label="${escapeHtml(p.b)} ${escapeHtml(p.m)} ürününü görüntüle">
          <img src="${escapeHtml(img)}" alt="${escapeHtml(p.m)}" loading="lazy" decoding="async">
          <div class="fav-item-name">${escapeHtml(p.b)} ${escapeHtml(p.m)}</div>
          <div class="fav-item-price">${priceText}</div>
        </div>`;
      }).join('') + '</div>';
  }

  renderFinderStep(4);
}

// Arka arkaya gelen bildirimlerde onceki zamanlayici yenisini erken kapatmasin.
const TOAST_DURATION_MS = 2500;
let toastTimer = null;
function showToast(t) {
  const x = document.getElementById("toast");
  x.textContent = t; x.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => x.classList.remove("show"), TOAST_DURATION_MS);
}

function openLightbox(src) {
  document.getElementById("lightbox-img").src = src;
  document.getElementById("lightbox").classList.add("active");
}
function closeLightbox() {
  document.getElementById("lightbox").classList.remove("active");
}

document.addEventListener("keydown", e => {
  if (e.key === "Escape") { closeProduct(); closeLightbox(); closeCompareModal(); closeFavModal(); closeFinderModal(); closeLegalModal(); closeFilterDrawer(); }
  // Klavye erisilebilirligi: onclick ile tiklanabilir olup dogal olarak
  // odaklanamayan kart/satir gibi elemanlar (role="button" + tabindex="0")
  // Enter veya Bosluk tusuyla da tetiklenebilsin.
  if ((e.key === "Enter" || e.key === " ") && e.target && e.target.matches && e.target.matches('[role="button"][tabindex]')) {
    e.preventDefault();
    e.target.click();
  }
});

// REDESIGN SAĞLAMLAŞTIRMA — MERKEZİ TIKLAMA YÖNETİMİ (event delegation)
// JS ile üretilen kart/düğmelerde satır içi onclick/onerror YOK. Her öğe
// data-action (+ data-i / data-key) taşır; tek bir belge dinleyicisi mevcut
// fonksiyonları AYNEN çağırır. Sonradan eklenen kartlar da otomatik çalışır.
// En içteki data-action kazanır (kart içindeki favori düğmesi kartı açmaz).
(function initActionDelegation() {
  const idx = el => { const n = parseInt(el.dataset.i, 10); return Number.isInteger(n) && n >= 0 ? n : -1; };
  const actions = {
    'open-product': (el) => { const i = idx(el); if (i > -1 && products[i]) openProduct(i); },
    'fav': (el, e) => { const i = idx(el); if (i > -1 && products[i]) toggleFav(e, i); },
    'compare': (el, e) => { const i = idx(el); if (i > -1 && products[i]) toggleCompare(e, i); },
    'remove-compare': (el) => removeFromCompare(el.dataset.key || ''),
    'remove-fav': (el) => removeFav(el.dataset.key || ''),
    'fav-open': (el) => { const i = idx(el); closeFavModal(); if (i > -1 && products[i]) openProduct(i); },
    'finder-open': (el) => { const i = idx(el); closeFinderModal(); if (i > -1 && products[i]) openProduct(i); },
    'finder-budget': (el) => { const i = idx(el); if (i > -1) selectFinderBudget(i); },
    'finder-priority': (el) => { const i = idx(el); if (i > -1) selectFinderPriority(i); },
    'finder-brand': (el) => { const i = idx(el); if (i > -1) selectFinderBrand(i); },
    'laptop-empty-wa': () => navigateToLaptopWhatsapp('Merhaba MİX GSM, laptop kataloğu hakkında bilgi almak istiyorum.'),
    'laptop-reset': () => resetLaptopFilters()
  };
  document.addEventListener('click', e => {
    const el = e.target && e.target.closest ? e.target.closest('[data-action]') : null;
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) fn(el, e);
  });

  // Ürün görseli yedek zinciri: eski onerror="tryNextProductImage(this)" yerine
  // tek bir yakalama (capture) dinleyicisi. "görsel yok" dosyası da
  // yüklenemezse döngüye girmez.
  document.addEventListener('error', e => {
    const t = e.target;
    if (!t || t.tagName !== 'IMG' || !t.hasAttribute('data-image-sources')) return;
    if (/gorsel-yok\.jpg(?:[?#]|$)/i.test(t.src)) return;
    tryNextProductImage(t);
  }, true);
})();

// Geri/ileri tusuna basildiginda (orn. urun acikken "geri" tusu) modal
// tutarli kalsin: link hala #urun/... ise o urunu ac, degilse kapat.
window.addEventListener('popstate', () => {
  const hashMatch = location.hash.match(/^#urun\/(.+)$/);
  if (hashMatch && products.length) {
    const idx = findProductBySlug(safeDecodeSlug(hashMatch[1]));
    if (idx > -1) { renderProductModal(products[idx]); return; }
  }
  document.getElementById("modal").classList.remove("open");
  if (!anyModalOpen()) unlockBodyScroll();
});

window.addEventListener('DOMContentLoaded', () => { loadCatalog(); updateFavs(); });

// Sade yorum slider'i: mevcut 4 gercek musteri yorumu icerigi degismedi,
// sadece tek seferde bir tanesi gosteriliyor (noktalarla gezinme).

// --- TEMA SİSTEMİ (Dark/Light) ------------------------------------------
// Mevcut ürün/veri/filtre sistemlerinin ÜZERİNE eklenen, onlardan tamamen
// bağımsız bir UI katmanı. "mixgsm-theme" anahtarı mevcut localStorage
// anahtarlarıyla (favoriler, karşılaştırma vb.) çakışmaz. Sayfa daha ilk
// boyanmadan önce doğru tema zaten <head>'deki küçük script ile
// uygulanmış oluyor (flash/sıçrama olmasın diye); buradaki kod sadece
// buton arayüzünü senkronlar ve kullanıcı tema değiştirdiğinde/telefonun
// sistem teması değiştiğinde canlı olarak günceller.
const THEME_KEY = 'mixgsm-theme';

function getSystemTheme() {
  return (window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches) ? 'dark' : 'light';
}
function getStoredThemePref() {
  try {
    const v = localStorage.getItem(THEME_KEY);
    return (v === 'light' || v === 'dark' || v === 'system') ? v : 'system';
  } catch (e) { return 'system'; }
}
function applyResolvedTheme(resolved) {
  document.documentElement.setAttribute('data-theme', resolved);
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute('content', resolved === 'light' ? '#FAFAFA' : '#080808');
}
function updateThemeToggleUI(pref) {
  const btn = document.getElementById('themeToggleBtn');
  if (!btn) return;
  const labels = { system: 'Sistem (cihaz temanı takip eder)', light: 'Açık', dark: 'Koyu' };
  btn.setAttribute('data-theme-pref', pref);
  btn.setAttribute('aria-label', 'Görünüm teması: ' + labels[pref] + '. Değiştirmek için tıklayın.');
}
function resolveAndApplyTheme() {
  const pref = getStoredThemePref();
  applyResolvedTheme(pref === 'system' ? getSystemTheme() : pref);
  updateThemeToggleUI(pref);
}
function setThemePref(pref) {
  try { localStorage.setItem(THEME_KEY, pref); } catch (e) {}
  resolveAndApplyTheme();
}
function cycleThemePref() {
  const order = ['system', 'light', 'dark'];
  const next = order[(order.indexOf(getStoredThemePref()) + 1) % order.length];
  setThemePref(next);
}
if (window.matchMedia) {
  window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', function () {
    if (getStoredThemePref() === 'system') resolveAndApplyTheme();
  });
}

// --- CSP HAZIRLIGI: statik (dinamik olarak yeniden render EDILMEYEN) HTML
// üzerindeki inline onclick="..." handler'ları addEventListener'a taşıyoruz.
// Davranış birebir aynı kalıyor; sadece güvenlik/bakım/CSP-uyumluluğu için
// event bağlama yöntemi değişiyor. Ürün kartları, karşılaştırma tablosu,
// favoriler/finder sonuçları gibi HER render() çağrısında YENİDEN
// OLUŞTURULAN dinamik elementlerdeki onclick'lere BİLEREK DOKUNULMADI -
// bunlar için event delegation gerekirdi ki bu, "mevcut sistemi bozma"
// kuralına aykırı, gereksiz bir mimari değişiklik olurdu.
(function bindStaticEventListeners() {
  const on = (selector, handler, root) => {
    const el = (root || document).querySelector(selector);
    if (el) el.addEventListener('click', handler);
  };
  const onAll = (selector, handler, root) => {
    (root || document).querySelectorAll(selector).forEach(el => el.addEventListener('click', handler));
  };
  const onBackdropClick = (id, closeFn) => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', e => { if (e.target === el) closeFn(); });
  };

  on('#filterBackdrop', closeFilterDrawer);
  on('.close', closeFilterDrawer, document.getElementById('filterPanel'));
  on('.btn-finder', openFinderModal, document.getElementById('filterPanel'));
  on('#filterToggleBtn', openFilterDrawer);
  onAll('.store-gallery img', function() { openLightbox(this.src); });
  on('.footer-line a[href="#"]', e => { e.preventDefault(); openLegalModal(); });

  onBackdropClick('modal', closeProduct);
  on('.close', closeProduct, document.getElementById('modal'));
  on('.share-btn', copyProductLink, document.getElementById('modal'));

  on('.btn-view-fav', openFavModal, document.getElementById('comparebar'));
  on('button:not(.btn-view-fav)', clearFavs, document.getElementById('comparebar'));

  onBackdropClick('favmodal', closeFavModal);
  on('.close', closeFavModal, document.getElementById('favmodal'));

  onBackdropClick('findermodal', closeFinderModal);
  on('.close', closeFinderModal, document.getElementById('findermodal'));
  on('.btn-finder', restartFinder, document.getElementById('findermodal'));

  on('#compareViewBtn', openCompareModal, document.getElementById('comparetraybar'));
  on('.btn-clear', clearCompare, document.getElementById('comparetraybar'));

  onBackdropClick('comparemodal', closeCompareModal);
  on('.close', closeCompareModal, document.getElementById('comparemodal'));

  onBackdropClick('legalmodal', closeLegalModal);
  on('.close', closeLegalModal, document.getElementById('legalmodal'));

  on('.bottom-nav a[href="#"]', e => { e.preventDefault(); window.scrollTo({ top: 0, behavior: smoothOrAuto() }); });
  on('.bottom-nav button', bottomNavCompare);

  on('#lightbox', closeLightbox);
  on('#lightbox-img', e => e.stopPropagation());

  const diffOnlyCheck = document.getElementById('compareDiffOnly');
  if (diffOnlyCheck) {
    diffOnlyCheck.addEventListener('change', () => {
      compareDiffOnly = diffOnlyCheck.checked;
      renderCompareTable();
    });
  }

  on('#themeToggleBtn', cycleThemePref);
  resolveAndApplyTheme();
})();

// ================================================================
// FAZ 3 — LAPTOP VERİ KATMANI (LaptopStore)
// Bu blok TAMAMEN İZOLE: products/cat/group/q/sort/ramFilter/favs/
// compareList/catalogCacheKey gibi hiçbir mevcut TELEFON değişkenine veya
// fonksiyonuna dokunmaz, hiçbirini okumaz/yazmaz. loadCatalog(),
// loadFromGoogleSheets(), saveCatalogCache(), loadCatalogCache() — hepsi
// telefon tarafında AYNEN duruyor. Burada sadece ortak, salt-yardımcı
// withTimeout() fonksiyonu tekrar kullanılıyor (state değil, davranış
// değiştirmiyor). Bu fazda henüz katalog UI'ı (kart/grid) YOK — sadece
// veri çekilip LaptopStore.products'a yazılıyor; ekrana basma Faz 4'te.
//
// GÜVENLİK: Main Management Sheet URL'si burada YOK. LAPTOP_SHEET_CONFIG
// bir PLACEHOLDER'dır - gerçek Public Laptop Sheet URL'si hazır olduğunda
// SADECE bu satır güncellenecek.
// ================================================================
const LAPTOP_SHEET_CONFIG = {
  url: 'https://docs.google.com/spreadsheets/d/1VImHmUN9eAA7x4y6tTrh5F0UA1sLsdcgCb3HjiVyXNg/export?format=tsv&gid=0'
};

function isLaptopSheetConfigured() {
  return /^https:\/\/docs\.google\.com\/spreadsheets\//.test(LAPTOP_SHEET_CONFIG.url);
}

// GÜVENLİK: telefonun normalizeGithubImageUrl()'i ile AYNI kural, ama
// SADECE /laptop-photos/ klasörüne izin verir - /photos/ ile karışmaz.
function normalizeLaptopGithubImageUrl(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';

  // Tam URL - düz dosya adı (eski/test formatı): laptop-photos/DOSYA.jpg
  const directMatch = raw.match(
    /^https:\/\/raw\.githubusercontent\.com\/mixgsm\/mixgsm\/main\/laptop-photos\/[A-Za-z0-9._%-]+$/i
  );
  if (directMatch) return raw;

  // Tam URL - images/ alt klasörü (gerçek Sheet fotoğrafları burada barınıyor)
  const directMatchImages = raw.match(
    /^https:\/\/raw\.githubusercontent\.com\/mixgsm\/mixgsm\/main\/laptop-photos\/images\/[A-Za-z0-9._%-]+$/i
  );
  if (directMatchImages) return raw;

  const blob = raw.match(
    /^https:\/\/github\.com\/mixgsm\/mixgsm\/blob\/main\/laptop-photos\/([A-Za-z0-9._%-]+(?:\/[A-Za-z0-9._%-]+)?)$/i
  );
  if (blob) {
    return `https://raw.githubusercontent.com/mixgsm/mixgsm/main/laptop-photos/${blob[1]}`;
  }

  // GERÇEK SHEET FORMATI: Sheet hücrelerinde tam URL değil, GÖRECELİ yol
  // saklanıyor - örn. "images/PC-001-01.jpg". Yalnızca sabit "images/" alt
  // klasörü + güvenli dosya adı karakterleri (harf/rakam/nokta/tire/alt
  // çizgi/% kodlama, "/" YOK) kabul edilir - path traversal (../) veya
  // başka bir klasöre çıkış KESİNLİKLE mümkün değildir.
  const relativeMatch = raw.match(/^images\/([A-Za-z0-9._%-]+)$/);
  if (relativeMatch) {
    return `https://raw.githubusercontent.com/mixgsm/mixgsm/main/laptop-photos/${raw}`;
  }

  return '';
}

// FAZ 3 DÜZELTME: laptop görseli yoksa/kırıksa gösterilecek TEK, izole
// fallback. Telefonun "photos/gorsel-yok.jpg" dosyasına KESİNLİKLE
// dokunulmaz/karıştırılmaz - bu ayrı bir laptop-photos/ dosyasıdır.
// Gerçek kart görseli render'ı Faz 4'te bu iki yardımcıyı kullanacak;
// Faz 3'te henüz katalog kartı UI'ı yok (bkz. yukarıdaki not), bu yüzden
// burada sadece altyapı hazırlanıyor ve doğrudan çağrılarak test edilebilir.
// REDESIGN FİNAL: laptop-photos/laptop-gorsel-yok.jpg depoda hiç yoktu (kırık
// görsel). Depoda VAR olan ortak "görsel yok" dosyası kullanılıyor.
const LAPTOP_FALLBACK_IMAGE = 'https://raw.githubusercontent.com/mixgsm/mixgsm/main/photos/gorsel-yok.jpg';

function laptopProductImageOrFallback(p) {
  const img = p && p.img ? String(p.img).trim() : '';
  return img || LAPTOP_FALLBACK_IMAGE;
}

// FAZ 5 DÜZELTME: inline onerror="" veya img.onerror = fn ATANMIYOR - kart,
// modal ana görsel ve galeri thumbnail'lerindeki tüm görsel hataları TEK bir
// delegated 'error' listener (bkz. bindLaptopStaticEventListeners, capture
// fazında) üzerinden bu fonksiyona yönlendiriliyor. Bu yüzden bu fonksiyon
// çağrılmadan önce src zaten fallback'ten FARKLI olduğu kontrol edilir
// (delegation listener'da) - sonsuz döngü riski böyle önlenir.
function laptopImageOnError(imgEl) {
  if (!imgEl) return;
  imgEl.src = LAPTOP_FALLBACK_IMAGE;
}

const laptopCatalogCacheKey = 'mixgsm-laptop-cache-v1';
const LAPTOP_CACHE_TTL_MS = 60 * 60 * 1000; // 1 saat - isa ile netleşen karar

function saveLaptopCatalogCache(list) {
  try {
    localStorage.setItem(laptopCatalogCacheKey, JSON.stringify({ ts: Date.now(), products: list }));
  } catch (e) { /* kota/gizli mod - sessizce yoksay */ }
}

// { products, ageMs, isStale } döner; hiç cache yoksa null.
function loadLaptopCatalogCache() {
  try {
    const raw = JSON.parse(localStorage.getItem(laptopCatalogCacheKey) || 'null');
    const list = raw ? sanitizeLaptopList(raw.products) : [];
    if (list.length && typeof raw.ts === 'number') {
      const ageMs = Date.now() - raw.ts;
      return { products: list, ageMs, isStale: ageMs > LAPTOP_CACHE_TTL_MS };
    }
  } catch (e) { /* bozuk cache - yoksay */ }
  return null;
}

// GÜVENLİK/VERİ DOĞRULAMA: telefondaki sanitizePhoneProduct ile aynı ilke
// (catalog-laptop.json / Sheet / önbellek güvenilmeyen girdi). Alan adları aynı.
const LAPTOP_TEXT_FIELDS = ['id', 'brand', 'model', 'cpu', 'cpuGen', 'ramGB', 'ramType', 'ssdGB', 'gpu',
  'gpuVramGB', 'gpuTgpW', 'screen', 'hz', 'kbLight', 'cosmetic', 'batteryHealth', 'warranty', 'box',
  'invoice', 'adapter', 'ramUpgrade', 'm2Slot', 'usage', 'saleDate', 'description'];
const LAPTOP_IMAGE_FIELDS = ['img', 'img2', 'img3', 'img4', 'img5', 'img6'];

function sanitizeLaptopProduct(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const p = {};
  LAPTOP_TEXT_FIELDS.forEach(k => { p[k] = toText(raw[k]); });
  LAPTOP_IMAGE_FIELDS.forEach(k => { p[k] = normalizeLaptopGithubImageUrl(raw[k]); });
  p.condition = raw.condition === 'NEW' || raw.condition === 'USED' ? raw.condition : null;
  p.price = toPrice(raw.price, LAPTOP_PRICE_MIN, LAPTOP_PRICE_MAX);
  p.stock = toStock(raw.stock);
  p.deal = raw.deal === true;
  p.newArrival = raw.newArrival === true;
  return p;
}

function sanitizeLaptopList(list) {
  return Array.isArray(list) ? list.map(sanitizeLaptopProduct).filter(Boolean) : [];
}

const LaptopStore = {
  products: [],
  loaded: false,
  loading: false,
  usingCache: false,
  error: null
};

function setLaptopHeroNote(text) {
  const el = document.querySelector('#laptop-section .laptop-hero-note');
  if (el) el.textContent = text;
}

// ---- FAZ 3 DÜZELTME: #laptopGrid durum render yardımcıları ----
// Bu yardımcılar SADECE #laptopGrid içeriğini yönetir; telefonun #grid'ine
// veya render()'ına KESİNLİKLE dokunmaz. Gerçek ürün kartı tasarımı Faz
// 4 kapsamıdır - burada sadece skeleton / boş / hata / "veri geldi ama
// kart tasarımı henüz yok" durumları için minimal, tema tutarlı HTML var.
function getLaptopGridEl() {
  return document.getElementById('laptopGrid');
}

function setLaptopGridAriaBusy(isBusy) {
  const el = getLaptopGridEl();
  if (el) el.setAttribute('aria-busy', isBusy ? 'true' : 'false');
}

function renderLaptopSkeleton() {
  const el = getLaptopGridEl();
  if (!el) return;
  setLaptopGridAriaBusy(true);
  // aria-hidden + odaklanabilir hiçbir eleman yok -> gereksiz tab/focus yok.
  const cardHtml = '<div class="laptop-skeleton-card" aria-hidden="true">'
    + '<div class="laptop-skeleton-image"></div>'
    + '<div class="laptop-skeleton-body">'
    + '<div class="laptop-skeleton-line w-90"></div>'
    + '<div class="laptop-skeleton-line w-60"></div>'
    + '<div class="laptop-skeleton-line w-40"></div>'
    + '<div class="laptop-skeleton-price"></div>'
    + '</div></div>';
  // Her zaman 6 kart yazılıyor; CSS (:nth-child(n+5)) mobil/tablette 4'e
  // düşürüyor - DOM sabit kalıyor, layout shift (CLS) olmuyor.
  el.innerHTML = cardHtml.repeat(6);
}

function renderLaptopEmptyState(message) {
  const el = getLaptopGridEl();
  if (!el) return;
  setLaptopGridAriaBusy(false);
  el.innerHTML = '<div class="laptop-empty">' + escapeHtml(message) + '</div>';
}

function renderLaptopErrorState(message) {
  const el = getLaptopGridEl();
  if (!el) return;
  setLaptopGridAriaBusy(false);
  el.innerHTML = '<div class="laptop-error">' + escapeHtml(message)
    + '<br><br><button type="button" class="laptop-modalwa laptop-empty-wa" style="display:inline-flex;width:auto;padding:12px 20px;" data-action="laptop-empty-wa"><svg class="icon"><use href="#ic-chat"></use></svg> WhatsApp\'tan Laptop Sor</button></div>';
}

// FAZ 4: Veri (same-origin/Sheet/cache) başarıyla geldiğinde çağrılır.
// Filtre panelini (mevcut GERÇEK veriden, hiçbir uydurma değer olmadan)
// kurar, filtrelenmiş/aranmış/sıralanmış gerçek ürün kartlarını render
// eder ve sayfa bir #laptop/slug derin linkiyle açıldıysa ilgili laptop
// modalını burada açar (veri hazır olmadan modal açılamayacağı için).
function onLaptopDataReady() {
  renderLaptopFilterPanel();
  renderLaptopCatalog();
  maybeOpenLaptopFromHash();
}

// ================================================================
// FAZ 4 — LAPTOP KATALOG UI: kart/grid, arama, sıralama, filtreler
// (masaüstü panel + mobil drawer), ürün modalı, #laptop/slug derin
// link, "Bana Laptop Bul" formu (sessionStorage taslak + 3sn cooldown +
// dinamik WhatsApp mesajı).
//
// KIRMIZI ÇİZGİ: Bu blok, q/sort/cat/group/ramFilter/only5G/minBattery/
// priceMin/priceMax/minCamera/minPerf/favs/compareList gibi HİÇBİR
// telefon state değişkenine dokunmaz/okumaz/yazmaz. #modal/#filterPanel/
// #grid/#q/#sort gibi telefon DOM elemanlarına da dokunmaz - kendi ayrı
// id/class kümesini (laptop* / laptop-*) kullanır. Telefonun render()/
// openProduct()/closeProduct()/loadCatalog() fonksiyonları AYNEN duruyor.
// ================================================================

// --- Laptop arama/sıralama/filtre state (telefonunkinden TAMAMEN AYRI) ---
let laptopQ = '';
let laptopSort = 'default';
const LaptopFilters = {
  condition: 'ALL', brand: 'ALL', priceMin: null, priceMax: null,
  cpuBrand: 'ALL', cpuType: 'ALL', cpuGen: 'ALL',
  ram: 'ALL', ssd: 'ALL',
  gpu: 'ALL', gpuVram: 'ALL', gpuTgp: 'ALL',
  hz: 'ALL', usage: 'ALL'
};

// --- Laptop slug / deep-link (#laptop/slug) - telefonun #urun/slug
// sisteminden TAMAMEN AYRI fonksiyonlar. Public Sheet'teki gerçek ID
// sütunu (p.id) benzersiz ek olarak kullanılıyor - uydurma bir varyant
// numarası üretilmiyor. ---
function laptopBaseSlug(p) {
  return normalizeTR(`${p.brand} ${p.model}`).trim().replace(/\s+/g, '-');
}
function laptopSlugOf(p) {
  const base = laptopBaseSlug(p);
  const idPart = p.id ? normalizeTR(String(p.id)).replace(/\s+/g, '-') : '';
  return idPart ? `${base}-${idPart}` : base;
}
function findLaptopBySlug(slug) {
  if (!slug) return -1;
  const exact = LaptopStore.products.findIndex(p => laptopSlugOf(p) === slug);
  if (exact > -1) return exact;
  return LaptopStore.products.findIndex(p => laptopBaseSlug(p) === slug);
}

// --- CPU marka/tip sınıflandırması: SADECE gerçek "cpu" metninden
// TÜRETİLİR (yeni veri uydurulmaz) - marka Intel/AMD/Apple içeriyor mu
// diye bakar, tip için bilinen i3/i5/.../Ryzen 3/.../M1-M4/Celeron/
// Pentium kalıplarını arar. Eşleşme yoksa boş string döner (o ürün o
// filtrede görünmez, yanlış sınıflandırılmaz). ---
function laptopCpuBrandOf(p) {
  const t = normalizeTR(p.cpu);
  if (!t) return '';
  if (t.includes('intel')) return 'Intel';
  if (t.includes('amd') || t.includes('ryzen')) return 'AMD';
  if (t.includes('apple') || /\bm[1-4]\b/.test(t)) return 'Apple';
  return 'Diğer';
}
const LAPTOP_CPU_TYPE_PATTERNS = [
  ['i3', /\bi3\b/], ['i5', /\bi5\b/], ['i7', /\bi7\b/], ['i9', /\bi9\b/],
  ['Ryzen 3', /ryzen ?3\b/], ['Ryzen 5', /ryzen ?5\b/], ['Ryzen 7', /ryzen ?7\b/], ['Ryzen 9', /ryzen ?9\b/],
  ['M1', /\bm1\b/], ['M2', /\bm2\b/], ['M3', /\bm3\b/], ['M4', /\bm4\b/],
  ['Celeron', /celeron/], ['Pentium', /pentium/]
];
function laptopCpuTypeOf(p) {
  const t = normalizeTR(p.cpu);
  if (!t) return '';
  for (let i = 0; i < LAPTOP_CPU_TYPE_PATTERNS.length; i++) {
    if (LAPTOP_CPU_TYPE_PATTERNS[i][1].test(t)) return LAPTOP_CPU_TYPE_PATTERNS[i][0];
  }
  return '';
}

// Belirtilen alanda katalogda GERÇEKTEN var olan, tekrarsız değerleri
// (sayısalsa küçükten büyüğe, değilse alfabetik) döner - sabit/uydurma
// bir liste değil, her zaman o anki gerçek LaptopStore.products'tan.
function laptopDistinctValues(getter) {
  const set = new Set();
  LaptopStore.products.forEach(p => {
    const v = String(getter(p) || '').trim();
    if (v) set.add(v);
  });
  return Array.from(set).sort((a, b) => {
    const na = parseFloat(a), nb = parseFloat(b);
    if (!Number.isNaN(na) && !Number.isNaN(nb)) return na - nb;
    return a.localeCompare(b, 'tr');
  });
}

function laptopSearchScore(p, query) {
  return computeSearchScore(query, [p.brand, p.model, p.cpu, p.gpu, p.usage].filter(Boolean).join(' '));
}

function applyLaptopFilters(list) {
  return list.filter(p => {
    if (LaptopFilters.condition !== 'ALL' && p.condition !== LaptopFilters.condition) return false;
    if (LaptopFilters.brand !== 'ALL' && p.brand !== LaptopFilters.brand) return false;
    if (LaptopFilters.priceMin !== null && !(p.price !== null && p.price >= LaptopFilters.priceMin)) return false;
    if (LaptopFilters.priceMax !== null && !(p.price !== null && p.price <= LaptopFilters.priceMax)) return false;
    if (LaptopFilters.cpuBrand !== 'ALL' && laptopCpuBrandOf(p) !== LaptopFilters.cpuBrand) return false;
    if (LaptopFilters.cpuType !== 'ALL' && laptopCpuTypeOf(p) !== LaptopFilters.cpuType) return false;
    if (LaptopFilters.cpuGen !== 'ALL' && String(p.cpuGen || '').trim() !== LaptopFilters.cpuGen) return false;
    if (LaptopFilters.ram !== 'ALL' && String(p.ramGB || '').trim() !== LaptopFilters.ram) return false;
    if (LaptopFilters.ssd !== 'ALL' && String(p.ssdGB || '').trim() !== LaptopFilters.ssd) return false;
    if (LaptopFilters.gpu !== 'ALL' && String(p.gpu || '').trim() !== LaptopFilters.gpu) return false;
    if (LaptopFilters.gpuVram !== 'ALL' && String(p.gpuVramGB || '').trim() !== LaptopFilters.gpuVram) return false;
    if (LaptopFilters.gpuTgp !== 'ALL' && String(p.gpuTgpW || '').trim() !== LaptopFilters.gpuTgp) return false;
    if (LaptopFilters.hz !== 'ALL' && String(p.hz || '').trim() !== LaptopFilters.hz) return false;
    if (LaptopFilters.usage !== 'ALL' && String(p.usage || '').trim() !== LaptopFilters.usage) return false;
    return true;
  });
}

// --- Filtre paneli: her grup, o anki GERÇEK katalogdan türetilen
// değerlerle bir kere kurulur (telefondaki renderRamFilterOptions() ile
// AYNI desen). ---
function renderLaptopFilterButtonGroup(containerId, values, getCurrent, setValue) {
  const wrap = document.getElementById(containerId);
  if (!wrap) return;
  if (!values.length) { wrap.innerHTML = '<span class="laptop-filter-empty-note">Katalogda veri bulunamadı.</span>'; return; }
  const current = getCurrent();
  wrap.innerHTML = '<button type="button" data-val="ALL" class="' + (current === 'ALL' ? 'active' : '') + '">Tümü</button>'
    + values.map(v => '<button type="button" data-val="' + escapeHtml(v) + '" class="' + (current === v ? 'active' : '') + '">' + escapeHtml(v) + '</button>').join('');
  wrap.querySelectorAll('button').forEach(b => {
    b.addEventListener('click', () => {
      setValue(b.dataset.val);
      wrap.querySelectorAll('button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderLaptopCatalog();
    });
  });
}

let laptopBrandSelectBuilt = false;
function renderLaptopFilterPanel() {
  renderLaptopFilterButtonGroup('laptopBrandGroup', laptopDistinctValues(p => p.brand), () => LaptopFilters.brand, v => { LaptopFilters.brand = v; });
  renderLaptopFilterButtonGroup('laptopCpuBrandGroup', laptopDistinctValues(p => laptopCpuBrandOf(p)), () => LaptopFilters.cpuBrand, v => { LaptopFilters.cpuBrand = v; });
  renderLaptopFilterButtonGroup('laptopRamGroup', laptopDistinctValues(p => p.ramGB), () => LaptopFilters.ram, v => { LaptopFilters.ram = v; });
  renderLaptopFilterButtonGroup('laptopSsdGroup', laptopDistinctValues(p => p.ssdGB), () => LaptopFilters.ssd, v => { LaptopFilters.ssd = v; });
  renderLaptopFilterButtonGroup('laptopGpuGroup', laptopDistinctValues(p => p.gpu), () => LaptopFilters.gpu, v => { LaptopFilters.gpu = v; });
  renderLaptopFilterButtonGroup('laptopUsageGroup', laptopDistinctValues(p => p.usage), () => LaptopFilters.usage, v => { LaptopFilters.usage = v; });
  renderLaptopFilterButtonGroup('laptopCpuTypeGroup', laptopDistinctValues(p => laptopCpuTypeOf(p)), () => LaptopFilters.cpuType, v => { LaptopFilters.cpuType = v; });
  renderLaptopFilterButtonGroup('laptopCpuGenGroup', laptopDistinctValues(p => p.cpuGen), () => LaptopFilters.cpuGen, v => { LaptopFilters.cpuGen = v; });
  renderLaptopFilterButtonGroup('laptopGpuVramGroup', laptopDistinctValues(p => p.gpuVramGB), () => LaptopFilters.gpuVram, v => { LaptopFilters.gpuVram = v; });
  renderLaptopFilterButtonGroup('laptopGpuTgpGroup', laptopDistinctValues(p => p.gpuTgpW), () => LaptopFilters.gpuTgp, v => { LaptopFilters.gpuTgp = v; });
  renderLaptopFilterButtonGroup('laptopHzGroup', laptopDistinctValues(p => p.hz), () => LaptopFilters.hz, v => { LaptopFilters.hz = v; });

  // "Bana Laptop Bul" formundaki Marka Tercihi de GERÇEK katalog
  // markalarından dolduruluyor (uydurma marka listesi değil). Sadece bir
  // kez kuruluyor ki kullanıcı formu doldururken seçimi sıfırlanmasın.
  if (!laptopBrandSelectBuilt) {
    const brandSelect = document.getElementById('lfBrand');
    if (brandSelect) {
      const brands = laptopDistinctValues(p => p.brand);
      brandSelect.innerHTML = '<option value="">Farketmez</option>'
        + brands.map(b => '<option value="' + escapeHtml(b) + '">' + escapeHtml(b) + '</option>').join('');
      laptopBrandSelectBuilt = true;
    }
  }
}

function resetLaptopFilters() {
  LaptopFilters.condition = 'ALL'; LaptopFilters.brand = 'ALL';
  LaptopFilters.priceMin = null; LaptopFilters.priceMax = null;
  LaptopFilters.cpuBrand = 'ALL'; LaptopFilters.cpuType = 'ALL'; LaptopFilters.cpuGen = 'ALL';
  LaptopFilters.ram = 'ALL'; LaptopFilters.ssd = 'ALL';
  LaptopFilters.gpu = 'ALL'; LaptopFilters.gpuVram = 'ALL'; LaptopFilters.gpuTgp = 'ALL';
  LaptopFilters.hz = 'ALL'; LaptopFilters.usage = 'ALL';

  const priceMinEl = document.getElementById('laptopPriceMinInput');
  const priceMaxEl = document.getElementById('laptopPriceMaxInput');
  if (priceMinEl) priceMinEl.value = '';
  if (priceMaxEl) priceMaxEl.value = '';

  document.querySelectorAll('#laptopConditionGroup button').forEach(x => x.classList.remove('active'));
  const condAll = document.querySelector('#laptopConditionGroup button[data-condition="ALL"]');
  if (condAll) condAll.classList.add('active');

  ['laptopBrandGroup', 'laptopCpuBrandGroup', 'laptopCpuTypeGroup', 'laptopCpuGenGroup', 'laptopRamGroup',
    'laptopSsdGroup', 'laptopGpuGroup', 'laptopGpuVramGroup', 'laptopGpuTgpGroup', 'laptopHzGroup', 'laptopUsageGroup'
  ].forEach(id => {
    const wrap = document.getElementById(id);
    if (!wrap) return;
    wrap.querySelectorAll('button').forEach(x => x.classList.remove('active'));
    const allBtn = wrap.querySelector('button[data-val="ALL"]');
    if (allBtn) allBtn.classList.add('active');
  });

  renderLaptopCatalog();
}

// Filtre sonucu boş olduğunda ("hazırlanıyor" DEĞİL, gerçek bir katalog
// varken filtre/arama hiçbir şeyle eşleşmediğinde) skeleton GÖSTERİLMEZ -
// doğrudan bu empty-state'e geçilir, kullanıcı filtreleri tek tıkla
// temizleyebilir.
function renderLaptopFilteredEmptyState() {
  const el = getLaptopGridEl();
  if (!el) return;
  setLaptopGridAriaBusy(false);
  el.innerHTML = '<div class="laptop-empty">Aradığınız kriterlere uygun laptop bulunamadı.'
    + '<br><br><button type="button" class="laptop-adv-clear" data-action="laptop-reset" style="width:auto;display:inline-block;padding:10px 18px;">Filtreleri Temizle</button></div>';
}

function laptopCardMarkup(p) {
  const idx = LaptopStore.products.indexOf(p);
  const title = [p.brand, p.model].filter(Boolean).join(' ') || 'Laptop';
  const img = laptopProductImageOrFallback(p);
  // OKUNABILIRLIK DUZELTMESI: emoji daireler (🟢/🔴) solid renkli zemin
  // üzerinde gereksiz/karisik duruyordu - "●" isareti + BUYUK HARF metin
  // (istenen mockup ile birebir) kullanildi.
  const badge = p.stock === 'IN' ? '<span class="laptop-card-badge in">● STOKTA</span>'
    : p.stock === 'ASK' ? '<span class="laptop-card-badge ask">Sorunuz</span>'
    : '<span class="laptop-card-badge out">● SATILDI</span>';
  const tagSpans = [];
  // REDESIGN FİNAL: tek ana rozet (öncelik Fırsat > Yeni Gelen), emojisiz.
  if (p.deal) tagSpans.push('<span class="laptop-card-tag">Fırsat</span>');
  else if (p.newArrival) tagSpans.push('<span class="laptop-card-tag">Yeni Gelen</span>');
  const tag = tagSpans.length ? '<div class="laptop-card-tags">' + tagSpans.join('') + '</div>' : '';
  const priceMarkup = p.price === null
    ? '<span class="laptop-card-price ask">WhatsApp\'tan Sor</span>'
    : '<span class="laptop-card-price">' + fmt(p.price) + ' <em>TL</em></span>';
  const condText = p.condition === 'NEW' ? 'Sıfır' : p.condition === 'USED' ? '2. El' : '';
  // GORSEL DUZELTME: "2. El"/"Sıfır" artık kart görselinin SOL ÜSTÜNDE,
  // stok etiketinin AYNI dikey sarmalayıcı (.laptop-card-left-badges)
  // içindeki İLK öğesi olarak gösteriliyor - stok etiketi bu yüzden HER
  // ZAMAN hemen altında, üst üste binme yapısal olarak mümkün değil.
  const condBadge = condText ? '<span class="laptop-card-tag">' + escapeHtml(condText) + '</span>' : '';
  const leftBadges = '<div class="laptop-card-left-badges">' + condBadge + badge + '</div>';
  const memText = [p.ramGB && (p.ramGB + ' GB RAM'), p.ssdGB && (p.ssdGB + ' GB SSD')].filter(Boolean).join(' · ');
  const screenText = [p.screen, p.hz && (p.hz + ' Hz')].filter(Boolean).join(' · ');
  const specsText = [condText, p.cpu, memText, p.gpu, screenText].filter(Boolean).slice(0, 4).join(' • ');

  // ERİŞİLEBİLİRLİK: kartın tamamı fareyle tıklanır (grid click dinleyicisi);
  // klavye/ekran okuyucu için gerçek düğme model adıdır (role="button" kart YOK).
  return '<article class="laptop-card" data-laptop-index="' + idx + '">'
    + '<div class="laptop-card-visual">' + tag + leftBadges
    + '<img src="' + escapeHtml(img) + '" alt="' + escapeHtml(title) + '" loading="lazy" decoding="async">'
    + '</div>'
    + '<div class="laptop-card-body">'
    + '<div class="laptop-card-brand">' + escapeHtml(p.brand || '') + '</div>'
    + '<div class="laptop-card-model"><button type="button" class="card-open" aria-label="' + escapeHtml(title) + ' ürününü görüntüle">' + escapeHtml(p.model || title) + '</button></div>'
    + (specsText ? '<div class="laptop-card-specs">' + escapeHtml(specsText) + '</div>' : '')
    + '<div class="laptop-card-bottom">' + priceMarkup + '</div>'
    + '</div></article>';
}

function renderLaptopCatalog() {
  const el = getLaptopGridEl();
  if (!el) return;

  if (!LaptopStore.products.length) {
    setLaptopGridAriaBusy(false);
    renderLaptopEmptyState('Laptop kataloğu hazırlanıyor, çok yakında burada olacak.');
    const emptyCountEl = document.getElementById('laptopCount');
    if (emptyCountEl) emptyCountEl.textContent = '0 laptop listeleniyor';
    return;
  }

  let filtered = applyLaptopFilters(LaptopStore.products);

  if (laptopQ) {
    filtered.forEach(p => { p._score = laptopSearchScore(p, laptopQ); });
    filtered = filtered.filter(p => p._score > 0).sort((a, b) => b._score - a._score);
  }

  if (laptopSort === 'low') filtered.sort((x, y) => (x.price === null ? Infinity : x.price) - (y.price === null ? Infinity : y.price));
  else if (laptopSort === 'high') filtered.sort((x, y) => (y.price === null ? -Infinity : y.price) - (x.price === null ? -Infinity : x.price));
  else if (laptopSort === 'new') filtered.sort((x, y) => Number(y.newArrival) - Number(x.newArrival));
  else if (laptopSort === 'deal') filtered.sort((x, y) => Number(y.deal) - Number(x.deal));

  const countEl = document.getElementById('laptopCount');
  if (countEl) countEl.textContent = filtered.length + ' laptop listeleniyor';

  setLaptopGridAriaBusy(false);

  if (!filtered.length) {
    renderLaptopFilteredEmptyState();
    return;
  }

  el.innerHTML = filtered.map(laptopCardMarkup).join('');
}

// --- Laptop modalı: telefonun #modal / renderProductModal() /
// openProduct() / closeProduct() sisteminden TAMAMEN AYRI. ---
let currentLaptopModalProduct = null;
let laptopLastFocusedTrigger = null;

function setLaptopModalRow(key, val) {
  const tr = document.getElementById('tr-lm-' + key);
  const cell = document.getElementById('lmf' + key);
  if (!tr || !cell) return;
  if (val && String(val).trim()) { tr.style.display = ''; cell.textContent = val; }
  else { tr.style.display = 'none'; }
}

function restoreLaptopFocus() {
  if (laptopLastFocusedTrigger && typeof laptopLastFocusedTrigger.focus === 'function') {
    try { laptopLastFocusedTrigger.focus(); } catch (e) {}
  }
  laptopLastFocusedTrigger = null;
}

function anyLaptopOverlayOpen() {
  const ids = ['laptopModal', 'laptopFinderModal'];
  if (ids.some(id => { const el = document.getElementById(id); return el && el.classList.contains('open'); })) return true;
  const panel = document.getElementById('laptopFilterPanel');
  return !!(panel && panel.classList.contains('open'));
}

// Çoklu görsel mimarisi. Gerçek Public Sheet ALTI ayrı "Fotoğraf 1"..
// "Fotoğraf 6" sütunu içeriyor (img..img6) - ürüne göre 0-6 arası dolu
// olabilir, boş olanlar atlanır. Görsel yoksa fallback'li tek elemanlı
// bir dizi döner.
function laptopImagesOf(p) {
  const seen = Object.create(null);
  const list = [];
  function pushIfValid(u) {
    const v = u && String(u).trim();
    if (v && !seen[v]) { seen[v] = true; list.push(v); }
  }
  if (p) {
    if (Array.isArray(p.images)) p.images.forEach(pushIfValid);
    pushIfValid(p.img);
    pushIfValid(p.img2);
    pushIfValid(p.img3);
    pushIfValid(p.img4);
    pushIfValid(p.img5);
    pushIfValid(p.img6);
  }
  if (!list.length) list.push(LAPTOP_FALLBACK_IMAGE);
  return list;
}

let laptopGalleryImages = [];
let laptopGalleryIndex = 0;

// Ana görseli ve aktif küçük-resim vurgusunu günceller. Yeni DOM
// oluşturmaz (thumbnail'ler zaten renderLaptopGallery() tarafından
// yazılmıştır) - bu yüzden tıklama/swipe sonrası güvenle çağrılabilir.
function setLaptopGalleryImage(idx) {
  if (!laptopGalleryImages.length) return;
  const n = laptopGalleryImages.length;
  laptopGalleryIndex = ((idx % n) + n) % n;
  // FAZ 5 DÜZELTME: img.onerror = fn ATANMIYOR - görsel hataları TEK,
  // delegated 'error' listener (bindLaptopStaticEventListeners) üzerinden
  // yönetiliyor.
  const mainImg = document.getElementById('lmi');
  if (mainImg) {
    mainImg.src = laptopGalleryImages[laptopGalleryIndex] || LAPTOP_FALLBACK_IMAGE;
  }
  const thumbsWrap = document.getElementById('laptopGalleryThumbs');
  if (thumbsWrap) {
    Array.prototype.forEach.call(thumbsWrap.children, function (thumbEl, i) {
      thumbEl.classList.toggle('active', i === laptopGalleryIndex);
    });
  }
}

// Modal açılırken galeriyi kurar: ana görsel + (varsa 2+) küçük resim
// şeridi. Güvenli DOM API'leri (createElement/textContent/setAttribute)
// kullanılır, kullanıcı/Sheet verisinden gelen içerik innerHTML ile
// yazılmaz.
function renderLaptopGallery(p) {
  laptopGalleryImages = laptopImagesOf(p);
  laptopGalleryIndex = 0;

  const mainImg = document.getElementById('lmi');
  if (mainImg) {
    mainImg.src = laptopGalleryImages[0] || LAPTOP_FALLBACK_IMAGE;
    mainImg.alt = [p.brand, p.model].filter(Boolean).join(' ') || 'Laptop';
  }

  // GORSEL DUZELTME: sol/sag oklar - tıpkı thumbnail seridi gibi, 2'den az
  // görselde tamamen gizlenir (hidden attribute), aksi halde görünür.
  const prevBtn = document.getElementById('laptopGalleryPrevBtn');
  const nextBtn = document.getElementById('laptopGalleryNextBtn');
  const showArrows = laptopGalleryImages.length >= 2;
  if (prevBtn) prevBtn.hidden = !showArrows;
  if (nextBtn) nextBtn.hidden = !showArrows;

  const thumbsWrap = document.getElementById('laptopGalleryThumbs');
  if (!thumbsWrap) return;
  thumbsWrap.textContent = '';
  if (laptopGalleryImages.length < 2) {
    thumbsWrap.style.display = 'none';
    return;
  }
  thumbsWrap.style.display = '';
  laptopGalleryImages.forEach(function (url, i) {
    const thumb = document.createElement('button');
    thumb.type = 'button';
    thumb.className = 'laptop-gallery-thumb' + (i === 0 ? ' active' : '');
    thumb.setAttribute('data-laptop-gallery-idx', String(i));
    thumb.setAttribute('aria-label', 'Görsel ' + (i + 1));
    const thumbImg = document.createElement('img');
    thumbImg.loading = 'lazy';
    thumbImg.alt = '';
    thumbImg.src = url;
    thumb.appendChild(thumbImg);
    thumbsWrap.appendChild(thumb);
  });
}

// Modal rozeti - kartla (laptopCardMarkup) aynı alanlar (deal/newArrival)
// ve aynı öncelik; ekstra renk/animasyon yok, sadece var(--laptop-gold).
function renderLaptopModalBadges(p) {
  const wrap = document.getElementById('laptopModalBadges');
  if (!wrap) return;
  wrap.textContent = '';
  if (!p) return;
  // REDESIGN FİNAL: kartla aynı — tek rozet (Fırsat > Yeni Gelen), emojisiz.
  const label = p.deal ? 'Fırsat' : (p.newArrival ? 'Yeni Gelen' : '');
  if (label) {
    const badge = document.createElement('span');
    badge.className = 'laptop-modal-badge';
    badge.textContent = label;
    wrap.appendChild(badge);
  }
}

function renderLaptopModal(p) {
  currentLaptopModalProduct = p;
  renderLaptopGallery(p);
  renderLaptopModalBadges(p);

  const brandEl = document.getElementById('lmb');
  const nameEl = document.getElementById('lmn');
  if (brandEl) brandEl.textContent = p.brand || '';
  if (nameEl) nameEl.textContent = p.model || '';

  const priceEl = document.getElementById('lmp');
  if (priceEl) priceEl.textContent = p.price === null ? "WhatsApp'tan Fiyat Sorunuz" : fmt(p.price) + ' TL';

  const stockWarn = document.getElementById('laptopOutOfStockWarn');
  if (stockWarn) stockWarn.style.display = p.stock === 'OUT' ? 'block' : 'none';

  setLaptopModalRow('condition', p.condition === 'NEW' ? 'Sıfır' : p.condition === 'USED' ? '2. El' : '');
  setLaptopModalRow('cpu', p.cpu);
  setLaptopModalRow('cpugen', p.cpuGen);
  setLaptopModalRow('ram', p.ramGB ? (p.ramGB + ' GB') : '');
  setLaptopModalRow('ramtype', p.ramType);
  setLaptopModalRow('ssd', p.ssdGB ? (p.ssdGB + ' GB') : '');
  setLaptopModalRow('gpu', p.gpu);
  setLaptopModalRow('vram', p.gpuVramGB ? (p.gpuVramGB + ' GB') : '');
  setLaptopModalRow('tgp', p.gpuTgpW ? (p.gpuTgpW + ' W') : '');
  setLaptopModalRow('screen', [p.screen, p.hz && (p.hz + ' Hz')].filter(Boolean).join(' · '));
  setLaptopModalRow('kb', p.kbLight);
  setLaptopModalRow('cosmetic', p.cosmetic);
  setLaptopModalRow('battery', p.batteryHealth);
  setLaptopModalRow('warranty', p.warranty);
  setLaptopModalRow('box', p.box);
  setLaptopModalRow('invoice', p.invoice);
  setLaptopModalRow('adapter', p.adapter);
  setLaptopModalRow('ramup', p.ramUpgrade);
  setLaptopModalRow('m2', p.m2Slot);
  setLaptopModalRow('usage', p.usage);

  const descEl = document.getElementById('lmDescription');
  if (descEl) descEl.textContent = p.description || '';

  const modal = document.getElementById('laptopModal');
  if (!modal) return;
  laptopLastFocusedTrigger = document.activeElement;
  modal.classList.add('open');
  lockBodyScroll();
  const closeBtn = document.getElementById('laptopModalCloseBtn');
  if (closeBtn) closeBtn.focus();
}

function openLaptopProduct(i) {
  const p = LaptopStore.products[i];
  if (!p) return;
  renderLaptopModal(p);
  try {
    const newUrl = location.pathname + location.search + '#laptop/' + laptopSlugOf(p);
    history.pushState({ laptopSlug: laptopSlugOf(p) }, '', newUrl);
  } catch (e) {}
}

// GÜVENLİK/TEKNİK DÜZELTME: kart HTML'inde artık inline onclick YOK -
// data-laptop-index sadece GÜVENLİ bir sayısal index taşır (kullanıcı
// verisi değil, LaptopStore.products.indexOf() sonucu). Gerçek açma
// işlemi her zaman openLaptopProduct(i) üzerinden, index doğrulanarak
// yapılır.
function openLaptopProductFromCard(cardEl) {
  if (!cardEl) return;
  const idx = parseInt(cardEl.dataset.laptopIndex, 10);
  if (Number.isFinite(idx)) openLaptopProduct(idx);
}

function closeLaptopProduct() {
  const modal = document.getElementById('laptopModal');
  if (modal) modal.classList.remove('open');
  if (!anyLaptopOverlayOpen()) unlockBodyScroll();
  try {
    if (location.hash.startsWith('#laptop/')) {
      history.pushState({}, '', location.pathname + location.search);
    }
  } catch (e) {}
  restoreLaptopFocus();
}

function maybeOpenLaptopFromHash() {
  const hashMatch = location.hash.match(/^#laptop\/(.+)$/);
  if (!hashMatch) return;
  const idx = findLaptopBySlug(safeDecodeSlug(hashMatch[1]));
  if (idx > -1) renderLaptopModal(LaptopStore.products[idx]);
}

window.addEventListener('popstate', () => {
  const hashMatch = location.hash.match(/^#laptop\/(.+)$/);
  if (hashMatch && LaptopStore.products.length) {
    const idx = findLaptopBySlug(safeDecodeSlug(hashMatch[1]));
    if (idx > -1) { renderLaptopModal(LaptopStore.products[idx]); return; }
  }
  const modal = document.getElementById('laptopModal');
  if (modal) modal.classList.remove('open');
  if (!anyLaptopOverlayOpen()) unlockBodyScroll();
});

// --- Mobil filtre drawer ---
function openLaptopFilterDrawer() {
  laptopLastFocusedTrigger = document.activeElement;
  const panel = document.getElementById('laptopFilterPanel');
  const backdrop = document.getElementById('laptopFilterBackdrop');
  if (panel) panel.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
  lockBodyScroll();
  const closeBtn = document.getElementById('laptopFilterCloseBtn');
  if (closeBtn) closeBtn.focus();
}
function closeLaptopFilterDrawer() {
  const panel = document.getElementById('laptopFilterPanel');
  const backdrop = document.getElementById('laptopFilterBackdrop');
  if (panel) panel.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
  if (!anyLaptopOverlayOpen()) unlockBodyScroll();
  restoreLaptopFocus();
}

// --- WhatsApp: dinamik mesaj, mobil wa.me / masaüstü web.whatsapp.com,
// window.open KULLANILMAZ (Faz 4/6 kuralı). ---
function buildLaptopWaMessage(p) {
  const parts = [p.brand, p.model].filter(Boolean).join(' ');
  return 'Merhaba MİX GSM, katalogdan ' + parts + ' laptobu hakkında stok ve fiyat bilgisi almak istiyorum.';
}
function isMobileDevice() {
  return /Android|iPhone|iPad|iPod/i.test(navigator.userAgent || '');
}
function navigateToLaptopWhatsapp(message) {
  const text = encodeURIComponent(message);
  const url = isMobileDevice()
    ? 'https://wa.me/905424818255?text=' + text
    : 'https://web.whatsapp.com/send?phone=905424818255&text=' + text;
  window.location.href = url;
}

// --- Focus Trap: laptop modalı, "Bana Laptop Bul" formu ve mobil filtre
// drawer'ı için TEK, ortak bir Tab/Shift+Tab hapsi + Escape kapatma
// mantığı. Telefonun kendi document keydown dinleyicisine (Escape ile
// kendi modallerini kapatan) HİÇ DOKUNMUYOR - bu tamamen AYRI, yeni bir
// keydown dinleyicisi. ---
function getOpenLaptopFocusContainer() {
  const modal = document.getElementById('laptopModal');
  if (modal && modal.classList.contains('open')) return modal;
  const finder = document.getElementById('laptopFinderModal');
  if (finder && finder.classList.contains('open')) return finder;
  const panel = document.getElementById('laptopFilterPanel');
  if (panel && panel.classList.contains('open') && window.matchMedia('(max-width: 900px)').matches) return panel;
  return null;
}
function laptopFocusableEls(container) {
  return Array.from(container.querySelectorAll(
    'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter(el => el.offsetParent !== null || el === document.activeElement);
}
document.addEventListener('keydown', function (e) {
  const container = getOpenLaptopFocusContainer();
  if (!container) return;

  if (e.key === 'Escape') {
    if (container.id === 'laptopModal') closeLaptopProduct();
    else if (container.id === 'laptopFinderModal') closeLaptopFinder();
    else if (container.id === 'laptopFilterPanel') closeLaptopFilterDrawer();
    return;
  }

  if (e.key !== 'Tab') return;
  const focusables = laptopFocusableEls(container);
  if (!focusables.length) { e.preventDefault(); return; }
  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault(); last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault(); first.focus();
  } else if (!container.contains(document.activeElement)) {
    e.preventDefault(); first.focus();
  }
});

// --- "Bana Laptop Bul" formu: sessionStorage taslağı (versioned key),
// validasyon, 3sn buton cooldown (WhatsApp yönlendirmesini GECİKTİRMEZ),
// dinamik WhatsApp mesajı. ---
const LAPTOP_FORM_DRAFT_KEY = 'mixgsm-laptop-form-draft-v1';
const LAPTOP_FORM_FIELD_IDS = ['lfBudget', 'lfUsage', 'lfCondition', 'lfName', 'lfPhone', 'lfScreen', 'lfPriority', 'lfBrand', 'lfNote'];

function saveLaptopFormDraft() {
  try {
    const draft = {};
    LAPTOP_FORM_FIELD_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) draft[id] = el.value;
    });
    sessionStorage.setItem(LAPTOP_FORM_DRAFT_KEY, JSON.stringify(draft));
  } catch (e) { /* sessionStorage yok/dolu/gizli mod - sessizce yoksay */ }
}
function restoreLaptopFormDraft() {
  try {
    const raw = sessionStorage.getItem(LAPTOP_FORM_DRAFT_KEY);
    if (!raw) return;
    const draft = JSON.parse(raw);
    LAPTOP_FORM_FIELD_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el && typeof draft[id] === 'string') el.value = draft[id];
    });
  } catch (e) { /* bozuk taslak - yoksay */ }
}
function clearLaptopFormDraft() {
  try { sessionStorage.removeItem(LAPTOP_FORM_DRAFT_KEY); } catch (e) {}
}

function openLaptopFinder() {
  laptopLastFocusedTrigger = document.activeElement;
  restoreLaptopFormDraft();
  const modal = document.getElementById('laptopFinderModal');
  if (!modal) return;
  modal.classList.add('open');
  lockBodyScroll();
  const firstField = document.getElementById('lfBudget');
  if (firstField) firstField.focus();
}
function closeLaptopFinder() {
  const modal = document.getElementById('laptopFinderModal');
  if (modal) modal.classList.remove('open');
  if (!anyLaptopOverlayOpen()) unlockBodyScroll();
  restoreLaptopFocus();
}

const LAPTOP_FORM_MAX_BUDGET = 2000000;

// WhatsApp numarasini normalize eder; gecersizse null. Turkiye cep numarasi
// (5xx, 05xx, 905xx, +90 5xx) -> "+90 5xx xxx xx xx". Yurt disi numara ancak
// "+" / "00" ile yazilmissa (10-15 hane) kabul edilir. Harf veya izinli
// olmayan karakter iceren giris reddedilir.
function normalizeWhatsappPhone(value) {
  const raw = String(value || '').trim();
  if (!/^[0-9+\s().-]+$/.test(raw)) return null;
  if (raw.indexOf('+') > 0 || (raw.match(/\+/g) || []).length > 1) return null;
  const digits = raw.replace(/\D/g, '');
  const tr = digits.match(/^(?:90|0)?(5\d{2})(\d{3})(\d{2})(\d{2})$/);
  if (tr && !(raw.startsWith('+') && !digits.startsWith('90'))) {
    return '+90 ' + tr[1] + ' ' + tr[2] + ' ' + tr[3] + ' ' + tr[4];
  }
  const intl = raw.startsWith('+') ? digits : (digits.startsWith('00') ? digits.slice(2) : '');
  if (intl && /^[1-9]\d{9,14}$/.test(intl)) return '+' + intl;
  return null;
}

function parseLaptopBudget(value) {
  const n = Number(String(value || '').trim());
  return Number.isFinite(n) && n >= 1 && n <= LAPTOP_FORM_MAX_BUDGET ? Math.round(n) : null;
}

function validateLaptopFinderForm() {
  let valid = true;
  const checks = [
    ['lfBudget', v => parseLaptopBudget(v) !== null, 'lfBudgetError', 'Lütfen geçerli bir bütçe girin.'],
    ['lfUsage', v => v.trim() !== '', 'lfUsageError', 'Lütfen kullanım amacını seçin.'],
    ['lfCondition', v => v.trim() !== '', 'lfConditionError', 'Lütfen durum tercihini seçin.'],
    ['lfName', v => v.trim().length >= 2 && /\p{L}/u.test(v), 'lfNameError', 'Lütfen adınızı ve soyadınızı girin.'],
    ['lfPhone', v => normalizeWhatsappPhone(v) !== null, 'lfPhoneError', 'Lütfen geçerli bir WhatsApp numarası girin (örn. 0532 123 45 67).']
  ];
  checks.forEach(check => {
    const id = check[0], test = check[1], errId = check[2], msg = check[3];
    const el = document.getElementById(id);
    const errEl = document.getElementById(errId);
    const row = el ? el.closest('.laptop-form-row') : null;
    const ok = el ? test(el.value) : false;
    if (!ok) {
      valid = false;
      if (row) row.classList.add('invalid');
      if (errEl) errEl.textContent = msg;
    } else {
      if (row) row.classList.remove('invalid');
      if (errEl) errEl.textContent = '';
    }
  });
  return valid;
}

function buildLaptopFinderWaMessage(data) {
  const lines = [
    'Merhaba MİX GSM, "Bana Laptop Bul" formunu doldurdum:',
    'Bütçe: ' + fmt(data.budget) + ' TL',
    'Kullanım Amacı: ' + data.usage,
    'Durum Tercihi: ' + data.condition,
    'Ad Soyad: ' + data.name,
    'WhatsApp: ' + data.phone
  ];
  if (data.screen) lines.push('Ekran Boyutu: ' + data.screen);
  if (data.priority) lines.push('Öncelik: ' + data.priority);
  if (data.brand) lines.push('Marka Tercihi: ' + data.brand);
  if (data.note) lines.push('Not: ' + data.note);
  return lines.join('\n');
}

const LAPTOP_FORM_COOLDOWN_MS = 3000;

function handleLaptopFinderSubmit(e) {
  e.preventDefault();
  if (!validateLaptopFinderForm()) return;

  const data = {
    budget: parseLaptopBudget(document.getElementById('lfBudget').value),
    usage: document.getElementById('lfUsage').value,
    condition: document.getElementById('lfCondition').value,
    name: document.getElementById('lfName').value.trim().replace(/\s+/g, ' '),
    phone: normalizeWhatsappPhone(document.getElementById('lfPhone').value),
    screen: document.getElementById('lfScreen').value,
    priority: document.getElementById('lfPriority').value,
    brand: document.getElementById('lfBrand').value,
    note: document.getElementById('lfNote').value.trim()
  };

  // KURAL: cooldown SADECE gönder butonunu geçici olarak devre dışı
  // bırakır (çift gönderimi önlemek için) - WhatsApp yönlendirmesini
  // ASLA geciktirmez; navigasyon hemen aşağıda, senkron olarak yapılıyor.
  const submitBtn = document.getElementById('laptopFinderSubmitBtn');
  if (submitBtn) {
    submitBtn.disabled = true;
    const originalText = submitBtn.textContent;
    submitBtn.textContent = 'Gönderiliyor...';
    setTimeout(() => {
      submitBtn.disabled = false;
      submitBtn.textContent = originalText;
    }, LAPTOP_FORM_COOLDOWN_MS);
  }

  clearLaptopFormDraft();
  navigateToLaptopWhatsapp(buildLaptopFinderWaMessage(data));
}

// --- Statik laptop UI elemanlarına event bağlama (telefonun
// bindStaticEventListeners() IIFE'sine PARALEL ama TAMAMEN AYRI bir
// blok - o fonksiyona hiçbir satır eklenmedi/değiştirilmedi). ---
(function bindLaptopStaticEventListeners() {
  // TEKNİK DÜZELTME: laptop kartları artık inline onclick/onkeydown
  // İÇERMİYOR. #laptopGrid HİÇBİR ZAMAN yeniden oluşturulmuyor (sadece
  // .innerHTML'i renderLaptopCatalog() her çağrıldığında değişiyor) -
  // bu yüzden delegation listener'ları burada, script bir kez
  // çalıştığında, TEK SEFER bağlanıyor. renderLaptopCatalog() ne kadar
  // çok çağrılırsa çağrılsın yeni bir listener EKLENMİYOR/register
  // edilmiyor - kartların üstündeki tek, sabit #laptopGrid dinliyor.
  const laptopGridEl = document.getElementById('laptopGrid');
  if (laptopGridEl) {
    laptopGridEl.addEventListener('click', e => {
      const card = e.target.closest('.laptop-card');
      if (card && laptopGridEl.contains(card)) openLaptopProductFromCard(card);
    });
    laptopGridEl.addEventListener('keydown', e => {
      if (e.key !== 'Enter' && e.key !== ' ' && e.key !== 'Spacebar') return;
      const card = e.target.closest('.laptop-card');
      if (!card || !laptopGridEl.contains(card)) return;
      e.preventDefault();
      openLaptopProductFromCard(card);
    });
  }

  // FAZ 5 DÜZELTME: Laptop görsellerinde (kart, modal ana görsel, galeri
  // thumbnail'leri) HİÇBİR inline onerror="" veya img.onerror = fn ataması
  // YOK. 'error' event'i bubble ETMEZ, bu yüzden document üzerinde CAPTURE
  // fazında (üçüncü parametre true), TEK SEFER bağlanan tek bir delegated
  // listener kullanılıyor - render sayısından bağımsız, yeni görsel DOM'a
  // her eklendiğinde otomatik çalışır, ekstra listener gerekmez. src zaten
  // fallback görseline eşitse tekrar işlenmez (sonsuz döngü koruması).
  document.addEventListener('error', function (e) {
    const t = e.target;
    if (!t || t.tagName !== 'IMG') return;
    if (t.src === LAPTOP_FALLBACK_IMAGE) return;
    const inLaptopCard = t.closest && t.closest('#laptopGrid .laptop-card');
    const isModalMainImg = t.id === 'lmi';
    const inGalleryThumbs = t.closest && t.closest('#laptopGalleryThumbs');
    if (inLaptopCard || isModalMainImg || inGalleryThumbs) laptopImageOnError(t);
  }, true);

  const laptopQInput = document.getElementById('laptopQ');
  if (laptopQInput) {
    let laptopSearchDebounce = null;
    laptopQInput.addEventListener('input', e => {
      laptopQ = e.target.value.trim();
      clearTimeout(laptopSearchDebounce);
      laptopSearchDebounce = setTimeout(renderLaptopCatalog, 300);
    });
  }

  const laptopSortSelect = document.getElementById('laptopSort');
  if (laptopSortSelect) laptopSortSelect.addEventListener('change', e => { laptopSort = e.target.value; renderLaptopCatalog(); });

  document.querySelectorAll('#laptopConditionGroup button').forEach(b => {
    b.addEventListener('click', () => {
      LaptopFilters.condition = b.dataset.condition;
      document.querySelectorAll('#laptopConditionGroup button').forEach(x => x.classList.remove('active'));
      b.classList.add('active');
      renderLaptopCatalog();
    });
  });

  const priceMinInput = document.getElementById('laptopPriceMinInput');
  if (priceMinInput) priceMinInput.addEventListener('input', e => {
    const v = e.target.value.trim();
    LaptopFilters.priceMin = v === '' ? null : Math.max(0, parseInt(v, 10) || 0);
    renderLaptopCatalog();
  });
  const priceMaxInput = document.getElementById('laptopPriceMaxInput');
  if (priceMaxInput) priceMaxInput.addEventListener('input', e => {
    const v = e.target.value.trim();
    LaptopFilters.priceMax = v === '' ? null : Math.max(0, parseInt(v, 10) || 0);
    renderLaptopCatalog();
  });

  const clearBtn = document.getElementById('laptopFilterClearBtn');
  if (clearBtn) clearBtn.addEventListener('click', resetLaptopFilters);

  const filterToggleBtn = document.getElementById('laptopFilterToggleBtn');
  if (filterToggleBtn) filterToggleBtn.addEventListener('click', openLaptopFilterDrawer);
  const filterCloseBtn = document.getElementById('laptopFilterCloseBtn');
  if (filterCloseBtn) filterCloseBtn.addEventListener('click', closeLaptopFilterDrawer);
  const filterBackdrop = document.getElementById('laptopFilterBackdrop');
  if (filterBackdrop) filterBackdrop.addEventListener('click', closeLaptopFilterDrawer);

  const modalCloseBtn = document.getElementById('laptopModalCloseBtn');
  if (modalCloseBtn) modalCloseBtn.addEventListener('click', closeLaptopProduct);
  const laptopModalEl = document.getElementById('laptopModal');
  if (laptopModalEl) laptopModalEl.addEventListener('click', e => { if (e.target.id === 'laptopModal') closeLaptopProduct(); });
  const modalWaBtn = document.getElementById('laptopModalWaBtn');
  if (modalWaBtn) modalWaBtn.addEventListener('click', () => {
    if (currentLaptopModalProduct) navigateToLaptopWhatsapp(buildLaptopWaMessage(currentLaptopModalProduct));
  });

  const findBtn = document.getElementById('laptopFindBtn');
  if (findBtn) findBtn.addEventListener('click', openLaptopFinder);
  const stockBtn = document.getElementById('laptopStockBtn');
  if (stockBtn) stockBtn.addEventListener('click', () => {
    const target = document.getElementById('laptopCatalogTitle');
    if (target) target.scrollIntoView({ behavior: smoothOrAuto() });
  });
  const finderCloseBtn = document.getElementById('laptopFinderCloseBtn');
  if (finderCloseBtn) finderCloseBtn.addEventListener('click', closeLaptopFinder);
  const finderModalEl = document.getElementById('laptopFinderModal');
  if (finderModalEl) finderModalEl.addEventListener('click', e => { if (e.target.id === 'laptopFinderModal') closeLaptopFinder(); });

  const finderForm = document.getElementById('laptopFinderForm');
  if (finderForm) {
    finderForm.addEventListener('submit', handleLaptopFinderSubmit);
    LAPTOP_FORM_FIELD_IDS.forEach(id => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('input', saveLaptopFormDraft);
    });
    document.querySelectorAll('#laptopFinderForm select').forEach(el => el.addEventListener('change', saveLaptopFormDraft));
  }

  // FAZ 5: Galeri küçük resimleri - #laptopGalleryThumbs SABİT bir
  // konteyner; renderLaptopGallery() her modal açılışında yalnızca
  // İÇERİĞİNİ (thumbnail düğmelerini) yeniden yazıyor, konteynerin
  // kendisi asla yeniden oluşturulmuyor. Bu yüzden tıklama delegation'ı
  // burada, script bir kez çalıştığında, TEK SEFER bağlanıyor - yeni
  // thumbnail'ler eklendiğinde ekstra listener gerekmez.
  const galleryThumbsEl = document.getElementById('laptopGalleryThumbs');
  if (galleryThumbsEl) {
    galleryThumbsEl.addEventListener('click', e => {
      const thumb = e.target.closest('.laptop-gallery-thumb');
      if (!thumb || !galleryThumbsEl.contains(thumb)) return;
      const idx = parseInt(thumb.getAttribute('data-laptop-gallery-idx'), 10);
      if (!isNaN(idx)) setLaptopGalleryImage(idx);
    });
  }

  // GORSEL DUZELTME: sol/sag oklar - thumbnail/swipe ile AYNI, tek state
  // kaynagi olan setLaptopGalleryImage() fonksiyonunu cagirir; yeni bir
  // galeri mantigi/state EKLENMEDI.
  const galleryPrevBtn = document.getElementById('laptopGalleryPrevBtn');
  if (galleryPrevBtn) {
    galleryPrevBtn.addEventListener('click', () => setLaptopGalleryImage(laptopGalleryIndex - 1));
  }
  const galleryNextBtn = document.getElementById('laptopGalleryNextBtn');
  if (galleryNextBtn) {
    galleryNextBtn.addEventListener('click', () => setLaptopGalleryImage(laptopGalleryIndex + 1));
  }

  // FAZ 5: Mobil kaydırma (swipe) - .laptop-gallery-main de SABİT bir
  // element (modal HTML'i statik), touch listener'ları TEK SEFER
  // bağlanıyor. Basit yatay swipe: sola kaydır -> sonraki, sağa kaydır
  // -> önceki, döngüsel (wraparound). Tek görselli ürünlerde (bugünkü
  // Sheet durumu) laptopGalleryImages.length < 2 olduğu için hiçbir şey
  // yapmaz.
  const galleryMainEl = document.getElementById('laptopGalleryMain');
  if (galleryMainEl) {
    let laptopTouchStartX = null;
    let laptopTouchStartY = null;
    galleryMainEl.addEventListener('touchstart', e => {
      if (!e.touches || e.touches.length !== 1) return;
      laptopTouchStartX = e.touches[0].clientX;
      laptopTouchStartY = e.touches[0].clientY;
    }, { passive: true });
    galleryMainEl.addEventListener('touchend', e => {
      if (laptopTouchStartX === null || !e.changedTouches || e.changedTouches.length !== 1) return;
      const dx = e.changedTouches[0].clientX - laptopTouchStartX;
      const dy = e.changedTouches[0].clientY - laptopTouchStartY;
      laptopTouchStartX = null;
      laptopTouchStartY = null;
      if (laptopGalleryImages.length < 2) return;
      if (Math.abs(dx) < 40 || Math.abs(dx) < Math.abs(dy)) return;
      setLaptopGalleryImage(laptopGalleryIndex + (dx < 0 ? 1 : -1));
    }, { passive: true });
  }
})();

// (1) same-origin catalog-laptop.json dener.
async function loadLaptopCatalogFromSameOrigin() {
  return withTimeout(async (signal) => {
    const res = await fetch('catalog-laptop.json?t=' + Date.now(), { cache: 'no-store', signal });
    if (!res.ok) throw new Error('catalog-laptop.json yok/erişilemedi (HTTP ' + res.status + ')');
    return res.json();
  }, 5000);
}

// (2) same-origin başarısızsa ve gerçek bir Public Sheet bağlıysa, dogrudan
// Sheet TSV'sini dener (telefonun 9sn+6sn iki-deneme desenini tekrarlar).
async function fetchLaptopTsvOnce(timeoutMs) {
  return withTimeout(async (signal) => {
    const res = await fetch(LAPTOP_SHEET_CONFIG.url + '&t=' + Date.now(), { cache: 'no-store', signal });
    if (!res.ok) throw new Error('Laptop Sheet\'e ulaşılamadı.');
    return res.text();
  }, timeoutMs);
}

function parseLaptopTsvToProducts(tsv) {
  // scripts/generate-catalog-laptop.js içindeki parseTsvToLaptopProducts()
  // ile BİREBİR AYNI sütun sırası/kurallar (bkz. o dosyadaki yorum).
  const lines = tsv.split('\n');
  const products = [];
  const startIndex = lines[0] && normalizeTR(lines[0]).includes('id') ? 1 : 0;

  const parseCondition = (raw) => {
    const n = normalizeTR(raw);
    if (!n) return null;
    if (n.includes('sifir')) return 'NEW';
    if (n.includes('2 el') || n.includes('ikinci el') || n.includes('ikincisi')) return 'USED';
    return null;
  };
  const parseLaptopStock = (raw) => {
    // Stok cozumu = telefon tarafiyla (generate-catalog.js) AYNI kural:
    // OUT yalnizca "kesin olarak stok yok" demektir; bilinmeyen/eslesmeyen
    // bir deger yanlislikla OUT gosterilmez, guvenli varsayilan olan ASK'e duser.
    const words = normalizeTR(raw).split(/\s+/);
    if (words.some(w => ['sor', 'sorunuz', 'soru'].includes(w))) return 'ASK';
    if (words.some(w => ['var', 'stokta', 'mevcut', 'evet', 'aktif'].includes(w)) &&
        !words.some(w => ['yok', 'tukendi', '0', 'hayir', 'false', 'degil', 'satildi'].includes(w))) return 'IN';
    if (words.some(w => ['yok', 'tukendi', '0', 'hayir', 'false', 'degil', 'satildi'].includes(w))) return 'OUT';
    return 'ASK';
  };
  const parseBoolFlag = (raw) => {
    const n = normalizeTR(raw);
    return n.includes('evet') || n.includes('var') || n === 'true';
  };
  const parseLaptopPrice = (raw) => {
    const rawPrice = String(raw || '');
    const isNegative = /^\s*-/.test(rawPrice);
    const cleaned = rawPrice.replace(/[,.]\d{1,2}(?!\d)/g, '').replace(/[^0-9]/g, '');
    const parsed = cleaned ? parseInt(cleaned, 10) : NaN;
    return (!isNegative && Number.isFinite(parsed) && parsed >= 1000 && parsed <= 500000) ? parsed : null;
  };

  for (let i = startIndex; i < lines.length; i++) {
    if (!lines[i] || !lines[i].trim()) continue;
    const cols = lines[i].split('\t').map(c => c.trim().replace(/\r/g, ''));
    const brand = (cols[2] || '').toUpperCase();
    const model = (cols[3] || '').toUpperCase();
    if (!brand && !model) continue;

    products.push({
      id: cols[0] || '', condition: parseCondition(cols[1]),
      brand, model,
      cpu: cols[4] || '', cpuGen: cols[5] || '',
      ramGB: cols[6] || '', ramType: cols[7] || '',
      ssdGB: cols[8] || '',
      gpu: cols[9] || '', gpuVramGB: cols[10] || '', gpuTgpW: cols[11] || '',
      screen: cols[12] || '', hz: cols[13] || '',
      kbLight: cols[14] || '', cosmetic: cols[15] || '', batteryHealth: cols[16] || '',
      warranty: cols[17] || '', box: cols[18] || '', invoice: cols[19] || '', adapter: cols[20] || '',
      ramUpgrade: cols[21] || '', m2Slot: cols[22] || '',
      usage: cols[23] || '',
      price: parseLaptopPrice(cols[24]),
      deal: parseBoolFlag(cols[25]), newArrival: parseBoolFlag(cols[26]),
      stock: parseLaptopStock(cols[27]),
      saleDate: cols[28] || '', description: cols[29] || '',
      // Sheet'te ALTI ayrı "Fotoğraf 1".."Fotoğraf 6" sütunu var (30-35),
      // TEK sütun değil. Her biri bağımsız normalize edilir; boş/eksik
      // olanlar normalizeLaptopGithubImageUrl() tarafından '' döner ve
      // laptopImagesOf() bunları otomatik atlar.
      img: normalizeLaptopGithubImageUrl(cols[30] || ''),
      img2: normalizeLaptopGithubImageUrl(cols[31] || ''),
      img3: normalizeLaptopGithubImageUrl(cols[32] || ''),
      img4: normalizeLaptopGithubImageUrl(cols[33] || ''),
      img5: normalizeLaptopGithubImageUrl(cols[34] || ''),
      img6: normalizeLaptopGithubImageUrl(cols[35] || '')
    });
  }
  return products;
}

// Ana giriş noktası: same-origin -> (same-origin boş VE Sheet bağlıysa
// KESİNLİKLE) Sheet TSV -> cache (TTL'ye göre mesaj farklılaşır) ->
// "hazırlanıyor"/hata bilgi notu.
//
// FAZ 3 DÜZELTME (KRİTİK BUG FIX): Bu fonksiyonun önceki sürümünde,
// same-origin catalog-laptop.json BAŞARIYLA okunup 0 ürün döndürdüğünde,
// Public Laptop Sheet gerçek bir URL ile yapılandırılmış olsa BİLE
// fonksiyon hemen "hazırlanıyor" notuyla return ediyordu - yani Sheet
// fallback'i hiç denenmiyordu. Artık davranış şu: same-origin boş
// geldiğinde ÖNCE isLaptopSheetConfigured() kontrol edilir. Sheet
// yapılandırılmışsa KESİNLİKLE return edilmez, doğrudan aşağıdaki Sheet
// TSV fallback'ine geçilir. "Hazırlanıyor" notu SADECE Sheet gerçekten
// henüz yapılandırılmamışsa (placeholder URL) gösterilir.
async function loadLaptopCatalog() {
  if (LaptopStore.loading) return;
  LaptopStore.loading = true;
  LaptopStore.error = null;
  setLaptopHeroNote('Laptop kataloğu yükleniyor…');
  renderLaptopSkeleton();

  function finishLaptopLoad() {
    LaptopStore.loading = false;
    setLaptopGridAriaBusy(false);
  }

  // (1) same-origin catalog-laptop.json dener.
  try {
    const sameOrigin = await loadLaptopCatalogFromSameOrigin();
    const sameOriginList = sanitizeLaptopList(sameOrigin && sameOrigin.products);
    if (sameOriginList.length) {
      LaptopStore.products = sameOriginList;
      LaptopStore.loaded = true; LaptopStore.usingCache = false; LaptopStore.error = null;
      saveLaptopCatalogCache(LaptopStore.products);
      setLaptopHeroNote(LaptopStore.products.length + ' laptop bulundu.');
      onLaptopDataReady();
      finishLaptopLoad();
      return;
    }
    // Same-origin BAŞARILI ama BOŞ geldi.
    if (!isLaptopSheetConfigured()) {
      // Sheet gerçekten henüz bağlanmadı -> bu gerçek bir "hazırlanıyor"
      // durumu, hata değil. Burada sakin şekilde bitirilir.
      LaptopStore.loaded = true; LaptopStore.usingCache = false; LaptopStore.error = null;
      setLaptopHeroNote('Laptop kataloğu hazırlanıyor, çok yakında burada olacak.');
      renderLaptopEmptyState('Laptop kataloğu hazırlanıyor, çok yakında burada olacak.');
      finishLaptopLoad();
      return;
    }
    // Sheet yapılandırılmış -> KESİNLİKLE return etme, aşağıdaki Sheet TSV
    // fallback'ine düş (kod akışı doğal olarak devam eder).
  } catch (sameOriginErr) {
    // same-origin dosyaya hiç ulaşılamadı (yok/bozuk) - asıl fallback zincirine geç.
  }

  // (2) same-origin boş (Sheet yapılandırılmışken) VEYA same-origin'e hiç
  // ulaşılamadı -> Public Laptop Sheet TSV fallback'i (9sn + 6sn iki deneme,
  // telefon tarafındaki desenin aynısı).
  if (isLaptopSheetConfigured()) {
    try {
      let tsv;
      try {
        tsv = await fetchLaptopTsvOnce(9000);
      } catch (firstErr) {
        tsv = await fetchLaptopTsvOnce(6000);
      }
      LaptopStore.products = sanitizeLaptopList(parseLaptopTsvToProducts(tsv));
      LaptopStore.loaded = true; LaptopStore.usingCache = false; LaptopStore.error = null;
      saveLaptopCatalogCache(LaptopStore.products);
      if (LaptopStore.products.length) {
        setLaptopHeroNote(LaptopStore.products.length + ' laptop bulundu.');
      } else {
        setLaptopHeroNote('Laptop kataloğu hazırlanıyor, çok yakında burada olacak.');
      }
      onLaptopDataReady();
      finishLaptopLoad();
      return;
    } catch (sheetErr) {
      LaptopStore.error = sheetErr;
      // aşağıdaki cache fallback'ine düş
    }
  }

  // (3) localStorage cache (TTL'ye göre mesaj farklılaşır).
  const cached = loadLaptopCatalogCache();
  if (cached) {
    LaptopStore.products = cached.products;
    LaptopStore.loaded = true; LaptopStore.usingCache = true;
    const cacheMsg = cached.isStale
      ? 'Bağlantı sorunu - önbellekteki laptop verisi (1 saatten eski) gösteriliyor, WhatsApp\'tan teyit alabilirsiniz.'
      : 'Bağlantı sorunu - son başarılı laptop verisi gösteriliyor.';
    setLaptopHeroNote(cacheMsg);
    onLaptopDataReady();
    finishLaptopLoad();
    return;
  }

  // (4) hiçbir kaynak yok (same-origin de, Sheet de, cache de başarısız) ->
  // final hata durumu. Skeleton burada da kaldırılır, sonsuza dek kalmaz.
  LaptopStore.loaded = false;
  setLaptopHeroNote('Laptop kataloğu şu anda güncellenemiyor. Güncel bilgi için WhatsApp\'tan bize ulaşabilirsiniz.');
  renderLaptopErrorState('Laptop kataloğu şu anda yüklenemedi. Güncel bilgi için WhatsApp\'tan bize ulaşabilirsiniz.');
  { const lc = document.getElementById('laptopCount'); if (lc) lc.textContent = 'Katalog yüklenemedi'; }   // "Yükleniyor..." takılı kalmasın
  finishLaptopLoad();
}
// ================================================================
// FAZ 2 — STOREFRONT TOGGLE (Telefon & Kişisel Bakım <-> Laptop & PC)
// Bu blok TAMAMEN İZOLE: products/cat/group/q/sort/ramFilter/favs/
// compareList gibi hiçbir mevcut telefon state değişkenine dokunmaz,
// hiçbirini okumaz/yazmaz. Sadece iki DOM bölümünün görünürlüğünü ve
// erişilebilirlik (hidden/aria-hidden/inert) durumunu yönetir. Laptop
// tarafının kendi state'i (arama/filtre/sıralama/katalog) Faz 4-6'da
// bu bloktan bağımsız olarak eklenecek.
// ================================================================
(function initStorefrontToggle() {
  const phoneSection = document.getElementById('phone-section');
  const laptopSection = document.getElementById('laptop-section');
  const btnPhone = document.getElementById('toggleBtnPhone');
  const btnLaptop = document.getElementById('toggleBtnLaptop');
  if (!phoneSection || !laptopSection || !btnPhone || !btnLaptop) return;

  let laptopLoadStarted = false;

  function setSectionVisibility(el, visible) {
    if (visible) {
      el.hidden = false;
      el.removeAttribute('aria-hidden');
      el.removeAttribute('inert');
    } else {
      el.hidden = true;
      el.setAttribute('aria-hidden', 'true');
      el.setAttribute('inert', '');
    }
  }

  function activateStorefront(name) {
    const showLaptop = name === 'laptop';
    setSectionVisibility(phoneSection, !showLaptop);
    setSectionVisibility(laptopSection, showLaptop);
    btnPhone.classList.toggle('active', !showLaptop);
    btnLaptop.classList.toggle('active', showLaptop);
    btnPhone.setAttribute('aria-selected', String(!showLaptop));
    btnLaptop.setAttribute('aria-selected', String(showLaptop));

    // FAZ 3: laptop verisini İLK kez laptop'a geçildiğinde, tembel (lazy)
    // olarak yükle - telefon ziyaretçileri için gereksiz ağ isteği yok.
    if (showLaptop && !laptopLoadStarted) {
      laptopLoadStarted = true;
      loadLaptopCatalog();
    }
  }

  btnPhone.addEventListener('click', () => activateStorefront('phone'));
  btnLaptop.addEventListener('click', () => activateStorefront('laptop'));

  // FAZ 4: sayfa doğrudan bir #laptop/slug derin linkiyle açıldıysa,
  // kullanıcı toggle'a tıklamadan laptop storefront'unu otomatik aktif et
  // (aksi halde laptop-section hidden+inert kalır ve link hiçbir şey
  // açmaz). Telefon tarafının #urun/slug davranışına dokunmuyor.
  if (location.hash.indexOf('#laptop/') === 0) {
    activateStorefront('laptop');
  }
})();

// ================================================================
// REDESIGN ADIM 2 — HEADER
// Yalnızca görünüm/gezinme katmanı. Telefon/laptop veri akışına, state
// değişkenlerine, #urun/ ve #laptop/ linklerine DOKUNMAZ.
// - Kaydırma durumu: scroll dinleyicisi yerine IntersectionObserver
//   (sayfa kaydırılırken hiçbir kod çalışmaz; sadece eşik geçilince).
// - "Telefonlar / Laptoplar": mevcut storefront düğmelerine tıklatır
//   (geçiş mantığı initStorefrontToggle'da AYNEN kalır), sonra ilgili
//   katalog başlığına kaydırır. Adres çubuğuna hash yazmaz.
// - Aktif mağaza vurgusu: #toggleBtnLaptop'un "active" sınıfı izlenir
//   (#laptop/ derin linkiyle açılışta da doğru çalışır).
// ================================================================
(function initRedesignHeader() {
  const nav = document.getElementById('siteNavbar');
  if (!nav) return;
  const sentinel = document.getElementById('navSentinel');
  if (sentinel && 'IntersectionObserver' in window) {
    new IntersectionObserver(function (entries) {
      nav.classList.toggle('is-scrolled', !entries[0].isIntersecting);
    }).observe(sentinel);
  } else {
    nav.classList.add('is-scrolled');
  }

  const btnPhone = document.getElementById('toggleBtnPhone');
  const btnLaptop = document.getElementById('toggleBtnLaptop');
  // Header (masaüstü) + alt menü (mobil) bağlantıları birlikte yönetilir.
  const storeLinks = document.querySelectorAll('[data-nav-store]');
  const reduceMotion = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function syncCurrentStore() {
    const laptopActive = !!(btnLaptop && btnLaptop.classList.contains('active'));
    storeLinks.forEach(function (a) {
      if ((a.dataset.navStore === 'laptop') === laptopActive) a.setAttribute('aria-current', 'true');
      else a.removeAttribute('aria-current');
    });
  }

  storeLinks.forEach(function (a) {
    a.addEventListener('click', function (e) {
      const wantLaptop = a.dataset.navStore === 'laptop';
      const btn = wantLaptop ? btnLaptop : btnPhone;
      if (!btn) return; // düğme yoksa normal bağlantı gibi davran
      e.preventDefault();
      if (!btn.classList.contains('active')) btn.click();
      const target = document.getElementById(wantLaptop ? 'laptopCatalogTitle' : 'catalog');
      if (target) {
        requestAnimationFrame(function () {
          target.scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
        });
      }
    });
  });

  if (btnLaptop && 'MutationObserver' in window) {
    new MutationObserver(syncCurrentStore).observe(btnLaptop, { attributes: true, attributeFilter: ['class'] });
  }
  syncCurrentStore();
})();

// ================================================================
// REDESIGN ADIM 5 — MARKA ŞERİDİ
// Yeni ve bağımsız: mevcut fonksiyonlar/veri DEĞİŞMEZ. Sadece mevcut
// kontrolleri tetikler (storefront düğmeleri, #advClearBtn + #q arama
// kutusu, #laptopFilterClearBtn + laptop marka düğmeleri). products ve
// LaptopStore yalnızca OKUNUR. Adres çubuğuna hash yazılmaz.
// ================================================================
(function initBrandStrip() {
  const links = document.querySelectorAll('.brand-link');
  if (!links.length) return;
  const $ = id => document.getElementById(id);
  const smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const scrollTo = id => { const t = $(id); if (t) t.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }); };
  const select = el => links.forEach(a => a.setAttribute('aria-pressed', String(a === el)));
  const setInput = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };

  links.forEach(a => a.addEventListener('click', () => {
    select(a);
    if (a.dataset.brandTerm) {                                   // telefon
      if (!$('toggleBtnPhone').classList.contains('active')) $('toggleBtnPhone').click();
      $('advClearBtn').click();
      setInput($('q'), a.dataset.brandTerm);
      return scrollTo('catalog');
    }
    if (!$('toggleBtnLaptop').classList.contains('active')) $('toggleBtnLaptop').click();   // laptop (lazy-load burada başlar)
    const started = Date.now();
    (function apply() {
      // Yükleme (JSON -> Sheet -> önbellek zinciri) bitene kadar bekle; hata olursa
      // laptop kataloğunun kendi hata mesajı görünür, filtre uygulanmaz.
      const busy = typeof LaptopStore === 'undefined' || LaptopStore.loading;
      if (busy && Date.now() - started < 15000) return setTimeout(apply, 120);
      if (!busy && LaptopStore.loaded) {
        setInput($('laptopQ'), '');
        $('laptopFilterClearBtn').click();
        const b = document.querySelector('#laptopBrandGroup button[data-val="' + a.dataset.brandVal + '"]');
        if (b) b.click();                                        // yoksa: tüm laptoplar (güvenli yedek)
      }
      scrollTo('laptopCatalogTitle');
    })();
  }));

  // Kullanıcı aramayı/filtreleri kendisi değiştirirse seçim kalkar.
  const clear = e => { if (e.isTrusted) select(null); };
  ['q', 'laptopQ'].forEach(id => $(id) && $(id).addEventListener('input', clear));
  ['filterPanel', 'laptopFilterPanel', 'storefrontToggle'].forEach(id => $(id) && $(id).addEventListener('click', clear));

  // Telefon kataloğu yüklenince katalogda artık bulunmayan telefon markalarını gizle.
  const grid = $('grid');
  if (grid && 'MutationObserver' in window) new MutationObserver(() => {
    if (typeof products === 'undefined' || !products.length) return;
    const real = products.filter(p => !isNonProductRow(p));
    document.querySelectorAll('.brand-link[data-brand-term]').forEach(a => { a.hidden = !real.some(p => searchScore(p, a.dataset.brandTerm) > 0); });
  }).observe(grid, { childList: true });
})();

// ================================================================
// REDESIGN ADIM 6 — İHTİYACA GÖRE (BENTO)
// Bağımsız; mevcut fonksiyonlar/veri DEĞİŞMEZ. Sadece mevcut kontrolleri
// tetikler. Laptop verisi yalnızca Laptop bağlantısında (mevcut lazy-load).
// Tasarım formu: kullanıcı taslağı korunur; Kullanım Amacı boşsa doldurulur.
// ================================================================
(function initBento() {
  const root = document.getElementById('bento');
  if (!root) return;
  const $ = id => document.getElementById(id);
  const smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const go = id => { const t = $(id); if (t) t.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }); };
  const setInput = (el, v) => { if (el) { el.value = v; el.dispatchEvent(new Event('input', { bubbles: true })); } };
  const onLaptopReady = cb => {
    if (!$('toggleBtnLaptop').classList.contains('active')) $('toggleBtnLaptop').click();
    const t0 = Date.now();
    (function wait() {
      const busy = typeof LaptopStore === 'undefined' || LaptopStore.loading;
      if (busy && Date.now() - t0 < 15000) return setTimeout(wait, 120);
      cb(!busy && LaptopStore.loaded);
    })();
  };

  root.addEventListener('click', e => {
    const a = e.target.closest('.bento-link');
    if (!a) return;
    e.preventDefault();                                          // hash yazılmaz
    document.querySelectorAll('.brand-link[aria-pressed="true"]').forEach(b => b.setAttribute('aria-pressed', 'false'));
    const d = a.dataset;
    if (d.bentoPhone) {
      if (!$('toggleBtnPhone').classList.contains('active')) $('toggleBtnPhone').click();
      setInput($('q'), '');
      $('advClearBtn').click();
      document.querySelector('#categoryFilters button[data-group="PHONE"]').click();
      document.querySelector('#quickusePills button[data-quick="' + d.bentoPhone + '"]').click();
      return go('catalog');
    }
    onLaptopReady(ok => {
      if (d.bentoForm) {
        $('laptopFindBtn').click();                              // mevcut form (taslak + odak + Escape)
        const u = $('lfUsage');
        if (u && !u.value) { u.value = d.bentoForm; u.dispatchEvent(new Event('change', { bubbles: true })); }
        return;
      }
      if (ok) {
        setInput($('laptopQ'), '');
        $('laptopFilterClearBtn').click();
        const b = [...document.querySelectorAll('#laptopUsageGroup button')].find(x => x.dataset.val === d.bentoLaptop);
        if (b) b.click();                                        // yoksa: tüm laptoplar
      }
      go('laptopCatalogTitle');
    });
  });
})();

// ================================================================
// REDESIGN ADIM 7 — ÖNE ÇIKAN FIRSATLAR + YENİ GELENLER + LAPTOP FIRSATLARI
// Bağımsız blok; mevcut fonksiyonlar/veri DEĞİŞMEZ. Kartlar mevcut kart
// yapısıyla (telefon: render() ile aynı işaretleme + openProduct/toggleFav/
// toggleCompare; laptop: laptopCardMarkup + openLaptopProductFromCard).
// Vitrinler #grid / #laptopGrid'e ASLA yazmaz; sadece onları izler
// (MutationObserver) ve kendi kaplarına yazar -> döngü oluşmaz.
// Laptop vitrini yalnızca LaptopStore dolunca oluşur (yeni istek YOK).
// ================================================================
(function initVitrin() {
  const $ = id => document.getElementById(id);
  const phoneGrid = $('grid');
  const laptopGrid = $('laptopGrid');
  const secDeals = $('vitrinDeals'), trackDeals = $('vitrinDealsTrack');
  const secNew = $('vitrinNew'), trackNew = $('vitrinNewTrack');
  const secLaptop = $('vitrinLaptopDeals'), trackLaptop = $('vitrinLaptopDealsTrack');
  if (!phoneGrid || !secDeals || !secNew) return;

  const MAX = 8;                                   // mobil şerit; masaüstünde CSS ilk 4'ü gösterir
  const NO_PHOTO = /gorsel-yok\.jpg(?:[?#]|$)/i;  // telefon + laptop "görsel yok" dosyaları
  const failed = new Set();                        // gerçek görseli yüklenemeyen modeller (oturum boyunca)
  const norm = v => String(v || '').trim().toLocaleUpperCase('tr');
  const smooth = !(window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches);

  // --- Seçim kuralları (ileride tarih alanı gelirse sadece burası değişir) ---
  const isVitrinDeal = p => p.tagLabel === 'Fırsat' && p.group === 'PHONE';   // kişisel bakım hariç
  const isVitrinNew = p => p.tagLabel === 'Yeni';
  const phoneOk = p => !isNonProductRow(p) && p.stock === 'IN' && p.p !== null;
  const hasPhonePhoto = p => imageCandidatesForProduct(p).some(u => !NO_PHOTO.test(u));
  const phoneKey = p => 'p|' + norm(p.b) + '|' + norm(p.m);
  const laptopOk = p => p.deal && p.stock === 'IN' && p.price !== null && !!String(p.img || '').trim();
  const laptopKey = p => 'l|' + norm(p.brand) + '|' + norm(p.model);

  // Aynı model tek kart + markalar arasında dönüşümlü seçim. Her markanın
  // içindeki sıra ve markaların sırası gerçek katalog sırasıdır.
  function pick(list, keyOf, brandOf) {
    const seen = new Set(), byBrand = new Map();
    list.forEach(p => {
      const k = keyOf(p);
      if (seen.has(k) || failed.has(k)) return;
      seen.add(k);
      const b = norm(brandOf(p));
      if (!byBrand.has(b)) byBrand.set(b, []);
      byBrand.get(b).push(p);
    });
    const queues = [...byBrand.values()], out = [];
    for (let i = 0; out.length < MAX && queues.some(q => i < q.length); i++) {
      queues.forEach(q => { if (i < q.length && out.length < MAX) out.push(q[i]); });
    }
    return out;
  }

  // Telefon kartı: katalogla AYNI ortak fonksiyon (phoneCardHtml).
  function phoneCard(p) {
    return phoneCardHtml(p, 'data-vitrin-key="' + escapeHtml(phoneKey(p)) + '"');
  }

  // Favori/karşılaştırma değişince kartları yeniden çizmeden durumu eşitle.
  function syncPhoneState(track) {
    track.querySelectorAll('.card[data-i]').forEach(card => {
      const p = products[+card.dataset.i];
      if (!p) return;
      const cmp = compareList.includes(favKeyOf(p));
      const fav = isFav(p);
      card.classList.toggle('comparing', cmp);
      const f = card.querySelector('.fav');
      if (f && f.classList.contains('active') !== fav) {
        f.classList.toggle('active', fav);
        f.setAttribute('aria-label', fav ? 'Favorilerden çıkar' : 'Favoriye ekle');
      }
      const c = card.querySelector('.compare-toggle');
      if (c && c.classList.contains('active') !== cmp) {
        c.classList.toggle('active', cmp);
        c.innerHTML = '<svg class="icon" aria-hidden="true"><use href="#ic-compare"></use></svg> ' + (cmp ? 'Seçildi' : 'Karşılaştır');
      }
    });
  }

  // Bölümü doldur / gizle. İçerik aynıysa DOM'a dokunulmaz (görseller yeniden yüklenmez).
  function fill(section, track, items, sig, markup) {
    if (!items.length) {
      section.hidden = true;
      track.innerHTML = '';
      track.dataset.sig = '';
      return;
    }
    section.hidden = false;
    if (track.dataset.sig === sig) return;
    track.dataset.sig = sig;
    track.innerHTML = items.map(markup).join('');
  }

  function laptopCard(p) {
    // Mevcut laptop kartı; vitrinde tek rozet (Fırsat) — katalog kartı değişmez.
    const k = escapeHtml(laptopKey(p));
    return laptopCardMarkup(p).replace('<article class="laptop-card"', '<article class="laptop-card" data-vitrin-key="' + k + '"');
  }
  function singleLaptopBadge(track) {
    track.querySelectorAll('.laptop-card-tags').forEach(box => {
      while (box.children.length > 1) box.lastElementChild.remove();
      if (box.firstElementChild) box.firstElementChild.textContent = 'Fırsat';
    });
  }

  function update() {
    if (Array.isArray(products) && products.length) {
      const base = products.filter(phoneOk);
      const deals = pick(base.filter(p => isVitrinDeal(p) && hasPhonePhoto(p)), phoneKey, p => p.b);
      const fresh = pick(base.filter(p => isVitrinNew(p) && hasPhonePhoto(p)), phoneKey, p => p.b);
      const sigOf = list => list.map(p => [products.indexOf(p), phoneKey(p), p.s, p.p, p.tagLabel].join('~')).join('|');
      fill(secDeals, trackDeals, deals, sigOf(deals), phoneCard);
      fill(secNew, trackNew, fresh, sigOf(fresh), phoneCard);
      syncPhoneState(trackDeals);
      syncPhoneState(trackNew);
    }
    updateLaptop();
  }

  // Laptop vitrini ilk kez görününce üstte yer açılır. Kullanıcı az önce
  // laptop kataloğuna giden bir bağlantıya bastıysa (veri henüz yüklenirken
  // başlamış kaydırma), hedef kaymasın diye başlığa yeniden hizalanır.
  let lastLaptopNav = 0;
  document.addEventListener('click', e => {
    const el = e.target.closest && e.target.closest('a[href="#laptopCatalogTitle"]:not([data-bento-form]), [data-brand-val], #laptopStockBtn');
    if (el) lastLaptopNav = Date.now();
  }, true);
  function updateLaptop() {
    if (!secLaptop || typeof LaptopStore === 'undefined' || !LaptopStore.products || !LaptopStore.products.length) return;
    const list = pick(LaptopStore.products.filter(laptopOk), laptopKey, p => p.brand);
    const sig = list.map(p => [LaptopStore.products.indexOf(p), laptopKey(p), p.price].join('~')).join('|');
    const before = trackLaptop.dataset.sig;
    const wasHidden = secLaptop.hidden;
    fill(secLaptop, trackLaptop, list, sig, laptopCard);
    if (trackLaptop.dataset.sig !== before) singleLaptopBadge(trackLaptop);
    if (wasHidden && !secLaptop.hidden && Date.now() - lastLaptopNav < 5000) {
      const t = $('laptopCatalogTitle');
      if (t) requestAnimationFrame(() => t.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' }));
    }
  }

  let queued = false;
  function schedule() {
    if (queued) return;
    queued = true;
    requestAnimationFrame(() => { queued = false; update(); });
  }

  // Görsel kontrolü: yedek görseller tükenip "görsel yok" dosyasına düşen
  // (ya da hiç yüklenemeyen) kart vitrinden çıkarılır, sıradaki ürün gelir.
  function watchPhotos(section, track, dropOnAnyError) {
    const drop = img => {
      const card = img.closest('[data-vitrin-key]');
      if (!card || !track.contains(card)) return;
      failed.add(card.dataset.vitrinKey);
      card.remove();
      track.dataset.sig = 'x';                      // bir sonraki güncellemede yeniden seç
      if (!track.children.length) section.hidden = true;
      schedule();
    };
    track.addEventListener('load', e => {
      const t = e.target;
      if (t && t.tagName === 'IMG' && NO_PHOTO.test(t.currentSrc || t.src)) drop(t);
    }, true);
    track.addEventListener('error', e => {
      const t = e.target;
      if (!t || t.tagName !== 'IMG') return;
      if (dropOnAnyError || NO_PHOTO.test(t.src)) drop(t);   // telefon: ara hatalar tryNextProductImage'da
    }, true);
  }
  watchPhotos(secDeals, trackDeals, false);
  watchPhotos(secNew, trackNew, false);

  if (secLaptop && trackLaptop) {
    watchPhotos(secLaptop, trackLaptop, true);
    trackLaptop.addEventListener('click', e => {
      const card = e.target.closest('.laptop-card');
      if (card && trackLaptop.contains(card)) openLaptopProductFromCard(card);   // Enter/Space: karttaki gerçek <button class="card-open"> tıklaması buraya kabarır
    });
    const more = $('vitrinLaptopMore');
    if (more) more.addEventListener('click', e => {
      e.preventDefault();                                                      // hash yazılmaz
      const lq = $('laptopQ');
      if (lq && lq.value) { lq.value = ''; lq.dispatchEvent(new Event('input', { bubbles: true })); }
      const clr = $('laptopFilterClearBtn');
      if (clr) clr.click();
      const sort = $('laptopSort');
      if (sort) { sort.value = 'deal'; sort.dispatchEvent(new Event('change', { bubbles: true })); }   // mevcut "Fırsatlar" sıralaması
      const t = $('laptopCatalogTitle');
      if (t) t.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'start' });
    });
  }

  // Telefon: kare başına tek güncelleme. Laptop: hemen (mikro görev) —
  // böylece vitrin, veri yüklenince yapılan kaydırmalardan ÖNCE yerini alır.
  new MutationObserver(schedule).observe(phoneGrid, { childList: true });
  if (laptopGrid) new MutationObserver(updateLaptop).observe(laptopGrid, { childList: true });
  schedule();
})();

// ================================================================
// REDESIGN ADIM 8–10 — ALT BÖLÜM + KATALOG "TÜMÜNÜ GÖSTER"
// Bağımsız blok; mevcut fonksiyonlar/veri DEĞİŞMEZ.
// 1) Alt bilgideki Telefonlar/Laptoplar: header'daki mevcut mağaza
//    bağlantısını tetikler (aynı geçiş + kaydırma + lazy-load davranışı).
// 2) Katalog: uzun listede ilk 12 kart görünür, kalanı "Tümünü Göster" ile.
//    Arama/filtre/sıralama sonucu değişince tekrar ilk 12'ye döner; favori/
//    karşılaştırma gibi aynı listeyi yeniden çizen işlemlerde açık kalır.
//    Kartlar silinmez/değişmez, sadece fazlası CSS ile gizlenir.
// ================================================================
(function initHomeBottom() {
  document.querySelectorAll('[data-footer-store]').forEach(a => {
    a.addEventListener('click', e => {
      const link = document.querySelector('.nav-links [data-nav-store="' + a.dataset.footerStore + '"]');
      if (!link) return;                        // yoksa normal bağlantı gibi davranır
      e.preventDefault();
      link.click();
    });
  });

  const LIMIT = 12;
  function limiter(gridId, moreId, cardSel, keyOf) {
    const grid = document.getElementById(gridId);
    const more = document.getElementById(moreId);
    if (!grid || !more) return;
    const btn = more.querySelector('button');
    let expanded = false, lastSig = '';
    function apply() {
      const cards = [...grid.children].filter(c => c.matches(cardSel));
      const sig = cards.map(keyOf).join('|');
      if (sig !== lastSig) { expanded = false; lastSig = sig; }   // yeni sonuç listesi
      cards.forEach((c, i) => { if (i >= LIMIT) c.setAttribute('data-more', ''); else c.removeAttribute('data-more'); });
      const limited = !expanded && cards.length > LIMIT;
      grid.classList.toggle('is-limited', limited);
      more.hidden = !limited;
    }
    btn.addEventListener('click', () => {
      expanded = true;
      apply();
      const next = grid.querySelector('[data-more]');
      const nextBtn = next && (next.querySelector('.card-open') || next);
      if (nextBtn) nextBtn.focus({ preventScroll: true });        // klavyede kalınan yerden devam
    });
    new MutationObserver(apply).observe(grid, { childList: true });  // sadece kart listesi; öznitelikler izlenmez
    apply();
  }
  limiter('grid', 'catalogMore', '.card', c => c.dataset.i || '');
  limiter('laptopGrid', 'laptopCatalogMore', '.laptop-card', c => c.dataset.laptopIndex || '');
})();

// ================================================================
// REDESIGN SAĞLAMLAŞTIRMA — TELEFON PENCERELERİ ERİŞİLEBİLİRLİĞİ
// Ürün, Favoriler, Telefon Bul, Karşılaştır, KVKK ve büyük fotoğraf
// pencereleri için: açılınca odak pencerenin içinde, Tab/Shift+Tab pencerede
// döner, kapanınca odak açan öğeye geri döner. Mevcut aç/kapa fonksiyonları
// DEĞİŞMEZ; sadece sınıf değişimi izlenir. Laptop pencerelerinin kendi odak
// yönetimi zaten var (dahil edilmedi).
// ================================================================
(function initDialogA11y() {
  const DIALOGS = [['modal', 'open'], ['favmodal', 'open'], ['findermodal', 'open'], ['comparemodal', 'open'], ['legalmodal', 'open'], ['lightbox', 'active']];
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), summary, [tabindex]:not([tabindex="-1"])';
  const stack = [];                      // { el, opener }
  let lastOutside = null;
  const dialogEls = DIALOGS.map(([id]) => document.getElementById(id)).filter(Boolean);
  const inDialog = t => dialogEls.some(d => d.contains(t));
  const visible = el => !!(el && el.isConnected && el.getClientRects().length);
  // Pencere içindeki odaklar "açan öğe" sayılmaz (açılış anında da).
  document.addEventListener('focusin', e => { if (!inDialog(e.target)) lastOutside = e.target; }, true);

  DIALOGS.forEach(([id, cls]) => {
    const el = document.getElementById(id);
    if (!el) return;
    let wasOpen = el.classList.contains(cls);
    new MutationObserver(() => {
      const isOpen = el.classList.contains(cls);
      if (isOpen === wasOpen) return;
      wasOpen = isOpen;
      if (isOpen) {
        stack.push({ el, opener: lastOutside });
        if (!el.contains(document.activeElement)) {
          const first = [...el.querySelectorAll(FOCUSABLE)].find(visible);
          if (first) first.focus({ preventScroll: true });
        }
      } else {
        const i = stack.findIndex(d => d.el === el);
        const entry = i > -1 ? stack.splice(i, 1)[0] : null;
        const a = document.activeElement;
        if (entry && (!a || a === document.body || el.contains(a)) && visible(entry.opener)) entry.opener.focus({ preventScroll: true });
      }
    }).observe(el, { attributes: true, attributeFilter: ['class'] });
  });

  document.addEventListener('keydown', e => {
    if (e.key !== 'Tab' || !stack.length) return;
    const top = stack[stack.length - 1].el;
    const items = [...top.querySelectorAll(FOCUSABLE)].filter(visible);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0], last = items[items.length - 1];
    if (!top.contains(document.activeElement)) { e.preventDefault(); first.focus(); }
    else if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
  });
})();

})();
