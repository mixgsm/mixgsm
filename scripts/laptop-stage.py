#!/usr/bin/env python3
# MIX GSM - laptop urun fotograflari icin "sahne" turevleri (cevrim disi arac).
#
# NEDEN: laptop fotograflarinin cogu saf beyaz zeminli; koyu sitede kart ve
# galeri icinde buyuk beyaz kutu gibi gorunuyordu. Bu arac fotografi KESMEDEN
# (urun kirpilmaz, oran degismez) yalniz KENARA BAGLI beyaz zemini saydam yapar;
# site saydam gorseli CSS'teki acik gri urun sahnesinin ustunde gosterir.
#
# GUVENLIK (muhafazakar):
# - Yalniz kenara bagli, neredeyse beyaz VE renksiz pikseller zemin sayilir
#   (flood-fill / jeodezik yeniden insa). Urunun icindeki beyaz alanlar (ekran
#   icerigi, logo, yansima) kenara bagli olmadigi icin silinmez.
# - Urune 1-2 px'lik ince beyaz baglantilar (antialias) erozyonla kesilir.
# - Kenarinin cogu beyaz olmayan (gercek ortam fotografi) ya da zemin orani
#   makul olmayan gorsel ISLENMEZ; yalniz kucultulur ("opaque").
# - Zaten saydam zeminli gorselin saydamligi korunur ("alpha").
# - Orijinaller DEGISMEZ (laptop-photos/images/). Turevler laptop-photos/stage/.
# - Gorsel BUYUTULMEZ: kaynak kucukse kaynak boyutu kullanilir.
#
# KULLANIM:  python3 scripts/laptop-stage.py            (degisenleri isler)
#            python3 scripts/laptop-stage.py --force    (hepsini yeniden)
# GEREKSINIM: Python 3, Pillow (WebP destekli), numpy, scipy  (yalniz bu arac;
#             site ve npm bagimliliklarina eklenmez).
# CIKTI: laptop-photos/stage/<ad>.sm.webp (kart/kucuk resim, en uzun kenar 640),
#        <ad>.lg.webp (galeri, en uzun kenar 1200), manifest.json
#        (kaynak SHA-256 ilk 16 hanesi ile; kaynak degisirse QA hata verir -> araci tekrar calistir).
import hashlib
import json
import os
import sys

import numpy as np
from PIL import Image
from scipy import ndimage

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "laptop-photos", "images")
OUT = os.path.join(ROOT, "laptop-photos", "stage")
MANIFEST = os.path.join(OUT, "manifest.json")
SAFE_NAME = __import__("re").compile(r"^[A-Za-z0-9._-]+\.(jpe?g|png|webp)$", __import__("re").I)

WHITE_MIN = 242          # min(R,G,B) >= 242  -> "neredeyse beyaz"
WHITE_CHROMA = 12        # max-min <= 12      -> renksiz (krem/renkli zemin degil)
BORDER_WHITE_MIN = 0.60  # kenar piksellerinin en az %60'i beyaz olmali
BRIDGE_ERODE = 2         # ince baglantilari kesmek icin erozyon (px)
BG_MIN, BG_MAX = 0.03, 0.92
LIGHT_PRODUCT_MAX = 0.40 # urunun %40'tan fazlasi beyaz/acik gri ise (beyaz kasa)
                         # urun kenari zeminden guvenle ayrilamaz -> islenmez
FEATHER_PX = 2           # kenar yumusatma bandi
FEATHER_FLOOR = 205      # bantta min kanal 205 ve alti tamamen opak
SIZES = {"sm": 640, "lg": 1200}
TRIM_MARGIN = 0.03       # saydam kenar kirpiliyorsa urun etrafinda %3 bosluk


def sha(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        h.update(f.read())
    return h.hexdigest()[:16]  # degisiklik tespiti icin yeterli, dosya kucuk kalir


def border(arr):
    return np.concatenate([arr[0], arr[-1], arr[:, 0], arr[:, -1]])


def white_border_ratio(rgba):
    rgb = rgba[..., :3].astype(np.int32)
    mn, mx = rgb.min(2), rgb.max(2)
    return border((mn >= WHITE_MIN) & ((mx - mn) <= WHITE_CHROMA)).mean()


def cut_background(rgba):
    """(rgba, durum, ayrinti) dondurur. durum: cut | alpha | opaque."""
    a = rgba.astype(np.int32)
    rgb, al = a[..., :3], a[..., 3]
    if (border(al) < 16).mean() > 0.5:
        return rgba, "alpha", "kaynak zaten saydam zeminli"
    mn, mx = rgb.min(2), rgb.max(2)
    near = (mn >= WHITE_MIN) & ((mx - mn) <= WHITE_CHROMA)
    bw = border(near).mean()
    if bw < BORDER_WHITE_MIN:
        return rgba, "opaque", f"kenar beyaz orani {bw:.2f} < {BORDER_WHITE_MIN} (ortam fotografi)"
    seeds = ndimage.binary_erosion(near, iterations=BRIDGE_ERODE, border_value=1)
    lab, _ = ndimage.label(seeds)
    edge = np.unique(np.concatenate([lab[0], lab[-1], lab[:, 0], lab[:, -1]]))
    edge = edge[edge > 0]
    seed = np.isin(lab, edge)
    # Jeodezik yeniden insa (hizli): "near" bilesenlerinden tohum iceren(ler)
    nlab, _ = ndimage.label(near)
    keep = np.unique(nlab[seed])
    bg = np.isin(nlab, keep[keep > 0])
    frac = bg.mean()
    if not (BG_MIN <= frac <= BG_MAX):
        return rgba, "opaque", f"zemin orani {frac:.2f} makul aralikta degil"
    fg = ~bg
    # Urun tek ve anlamli buyuklukte bir parca olmali (gurultu degil).
    flab, fn = ndimage.label(fg)
    if fn == 0:
        return rgba, "opaque", "urun bulunamadi"
    sizes = ndimage.sum(fg, flab, range(1, fn + 1))
    if sizes.max() < 0.03 * fg.size:
        return rgba, "opaque", "urun parcasi cok kucuk"
    light = ((mn >= 225) & ((mx - mn) <= 15))[fg].mean()
    if light > LIGHT_PRODUCT_MAX:
        return rgba, "opaque", f"acik renkli urun (%{light * 100:.0f}); kenar zeminle karisabilir"
    # Alfa: zemin 0, bantta beyazliga gore yumusak, gerisi 255.
    alpha = np.full(mn.shape, 255.0)
    alpha[bg] = 0
    band = ndimage.binary_dilation(bg, iterations=FEATHER_PX) & fg
    soft = np.clip((255.0 - mn) / (255.0 - FEATHER_FLOOR), 0, 1) * 255.0
    alpha[band] = np.minimum(alpha[band], soft[band])
    # Bant pikselini beyazdan ayir (beyaz hale kalmasin): c = (c - (1-a)*255) / a
    out = a.astype(np.float64)
    af = alpha / 255.0
    m = band & (af > 0.02)
    for k in range(3):
        ch = out[..., k]
        ch[m] = np.clip((ch[m] - (1 - af[m]) * 255.0) / af[m], 0, 255)
    out[..., 3] = alpha
    return out.round().astype(np.uint8), "cut", f"zemin %{frac * 100:.0f}"


def trim(im):
    """Yalniz saydam kenar bosluklarini kirpar (urune dokunmaz); oran bilgisi icin bbox."""
    al = np.asarray(im)[..., 3]
    ys, xs = np.where(al > 8)
    if not len(xs):
        return im
    h, w = al.shape
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    mx, my = int((x1 - x0) * TRIM_MARGIN), int((y1 - y0) * TRIM_MARGIN)
    return im.crop((max(0, x0 - mx), max(0, y0 - my), min(w, x1 + mx), min(h, y1 + my)))


def save_variants(im, stem):
    files = {}
    for key, side in SIZES.items():
        v = im.copy()
        if max(v.size) > side:
            v.thumbnail((side, side), Image.LANCZOS)
        name = f"{stem}.{key}.webp"
        v.save(os.path.join(OUT, name), "WEBP", quality=82, method=4)
        files[key] = name
    return files, im.size


def main():
    force = "--force" in sys.argv
    os.makedirs(OUT, exist_ok=True)
    old = {}
    if os.path.exists(MANIFEST) and not force:
        old = json.load(open(MANIFEST, encoding="utf-8")).get("files", {})
    files, report = {}, []
    names_all = [n for n in sorted(os.listdir(SRC)) if SAFE_NAME.match(n) and os.path.isfile(os.path.join(SRC, n))]
    # Ayni adli farkli uzantili kaynaklar (or. PC-021-01.jpg + .webp) turev adinda
    # cakismasin: bu durumda uzanti da ada eklenir (PC-021-01-jpg.sm.webp).
    stems = [os.path.splitext(n)[0] for n in names_all]
    dup = {s for s in stems if stems.count(s) > 1}
    for name in names_all:
        path = os.path.join(SRC, name)
        if not SAFE_NAME.match(name) or not os.path.isfile(path):
            continue
        digest = sha(path)
        prev = old.get(name)
        stem, ext = os.path.splitext(name)
        if stem in dup:
            stem = f"{stem}-{ext[1:].lower()}"
        if prev and prev.get("sha256") == digest and all(prev.get(k) == f"{stem}.{k}.webp" for k in SIZES) and all(os.path.exists(os.path.join(OUT, prev[k])) for k in SIZES):
            files[name] = prev
            continue
        im = Image.open(path)
        im.load()
        rgba = np.asarray(im.convert("RGBA"))
        arr, kind, detail = cut_background(rgba)
        out = Image.fromarray(arr, "RGBA")
        if kind in ("cut", "alpha"):
            out = trim(out)
        else:
            out = Image.fromarray(np.asarray(im.convert("RGB")), "RGB")
        names, size = save_variants(out, stem)
        # Islenmemis (opaque) gorselin zemini: beyaz ise site CSS'te "multiply"
        # ile beyazi sahne rengine karistirir; ortam fotografinda (scene) karistirmaz.
        bg = "none" if kind != "opaque" else ("white" if white_border_ratio(rgba) >= BORDER_WHITE_MIN else "scene")
        files[name] = {"sha256": digest, "type": kind, "bg": bg, "w": size[0], "h": size[1], **names}
        report.append((name, kind, detail))
    # Kaynagi silinmis turevleri temizle
    keep = {v[k] for v in files.values() for k in SIZES} | {"manifest.json"}
    for f in os.listdir(OUT):
        if f not in keep:
            os.remove(os.path.join(OUT, f))
    json.dump({"version": 1, "files": files}, open(MANIFEST, "w", encoding="utf-8"), ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    counts = {}
    for v in files.values():
        counts[v["type"]] = counts.get(v["type"], 0) + 1
    for r in report:
        print(*r, sep="\t")
    print("TOPLAM", len(files), counts)


if __name__ == "__main__":
    main()
