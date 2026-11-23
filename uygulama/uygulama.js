// MIX GSM - /uygulama: telefona "uygulama olarak ekle" sayfasi.
// Android/Chrome: tarayicinin kurulum penceresi tek dugmeyle acilir
// (beforeinstallprompt). iPhone: Apple buna izin vermez; Safari'deki adimlar
// gosterilir. Uygulama ici tarayicilarda (Instagram vb.) "tarayicida ac" uyarisi.
(function () {
  "use strict";
  var ua = navigator.userAgent || "";
  var isIOS = /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1);
  var isAndroid = /Android/i.test(ua);
  var isInApp = /Instagram|FBAN|FBAV|FB_IAB|Line\/|Twitter|TikTok|musical_ly|Snapchat/i.test(ua);
  var isIOSOtherBrowser = isIOS && /CriOS|FxiOS|EdgiOS|OPiOS|YaBrowser|GSA\//i.test(ua);
  var standalone = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches) || window.navigator.standalone === true;
  var deferred = null;

  function show(id) {
    var panels = document.querySelectorAll(".panel");
    for (var i = 0; i < panels.length; i++) panels[i].classList.remove("on");
    var el = document.getElementById(id);
    if (el) el.classList.add("on");
  }

  function decide() {
    if (standalone) return show("p-installed");
    if (isInApp) return show("p-inapp");
    if (isIOS) return show(isIOSOtherBrowser ? "p-ios-other" : "p-ios");
    if (isAndroid) {
      // Duğme hemen gösterilir; tarayıcı 3 sn içinde kurulum izni vermezse
      // (zaten yüklü, Samsung Internet vb.) elle adımlara geçilir.
      show("p-android-btn");
      setTimeout(function () { if (!deferred && !standalone) show("p-android-manual"); }, 3000);
      return;
    }
    show("p-desktop");
  }

  window.addEventListener("beforeinstallprompt", function (e) {
    e.preventDefault();
    deferred = e;
    if (isAndroid && !isInApp) show("p-android-btn");
    var desk = document.getElementById("installBtnDesk");
    if (desk && !isAndroid && !isIOS) desk.hidden = false;
  });

  window.addEventListener("appinstalled", function () {
    deferred = null;
    show("p-installed");
  });

  function install() {
    if (!deferred) { show(isAndroid ? "p-android-manual" : "p-desktop"); return; }
    var ev = deferred;
    deferred = null;
    ev.prompt();
    if (ev.userChoice && ev.userChoice.then) {
      ev.userChoice.then(function (r) {
        if (!r || r.outcome !== "accepted") show(isAndroid ? "p-android-manual" : "p-desktop");
      });
    }
  }

  document.getElementById("installBtn").addEventListener("click", install);
  document.getElementById("installBtnDesk").addEventListener("click", install);

  document.getElementById("copyBtn").addEventListener("click", function () {
    var btn = this;
    var url = "https://mixgsm.tr/uygulama/";
    var ok = function () { btn.textContent = "Kopyalandı ✓ Şimdi Safari'de yapıştırın"; };
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(ok, function () { btn.textContent = url; });
    } else {
      btn.textContent = url;
    }
  });

  decide();
})();
