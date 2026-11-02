// Gemeinsamer Kern der YuNet-Messung (kein Produktcode): laeuft in Node und im Browser.
// Enthaelt: Umbau des YuNet-Modells auf freie Eingabegroesse (im Speicher, nichts wird geschrieben), Nachverarbeitung wie OpenCV
// FaceDetectorYN 2023mar, Nachverarbeitung des Modells 320n (wie src/erkenner/modell.ts) und die Augen-/Mundboxen des alten Werkzeugs.

// ---------- Protobuf von Hand: nur das Noetige, um Eingabe- und Ausgabeformen des ONNX-Modells frei zu machen ----------

function liesVarint(b, p) {
  let r = 0;
  let schub = 1;
  for (;;) {
    const byte = b[p++];
    r += (byte & 0x7f) * schub;
    if ((byte & 0x80) === 0) break;
    schub *= 128;
  }
  return [r, p];
}

function schreibeVarint(zahl) {
  const aus = [];
  let z = zahl;
  while (z >= 128) {
    aus.push((z % 128) | 0x80);
    z = Math.floor(z / 128);
  }
  aus.push(z);
  return Uint8Array.from(aus);
}

function verbinde(teile) {
  const n = teile.reduce((a, t) => a + t.length, 0);
  const aus = new Uint8Array(n);
  let o = 0;
  for (const t of teile) {
    aus.set(t, o);
    o += t.length;
  }
  return aus;
}

// Zerlegt eine Nachricht in ihre Felder; `roh` ist das Feld samt Tag, `inhalt` die Nutzlast (nur bei Laengenfeldern).
function felder(b) {
  const liste = [];
  let p = 0;
  while (p < b.length) {
    const start = p;
    let tag;
    [tag, p] = liesVarint(b, p);
    const nr = Math.floor(tag / 8);
    const art = tag % 8;
    let inhalt = null;
    let wert = null;
    if (art === 0) {
      [wert, p] = liesVarint(b, p);
    } else if (art === 2) {
      let laenge;
      [laenge, p] = liesVarint(b, p);
      inhalt = b.subarray(p, p + laenge);
      p += laenge;
    } else if (art === 1) p += 8;
    else if (art === 5) p += 4;
    else throw new Error(`unbekannte Wire-Art ${art}`);
    liste.push({ nr, art, wert, inhalt, roh: b.subarray(start, p) });
  }
  return liste;
}

function laengenFeld(nr, inhalt) {
  return verbinde([schreibeVarint(nr * 8 + 2), schreibeVarint(inhalt.length), inhalt]);
}

const kodiereText = (s) => new TextEncoder().encode(s);

// Form (TensorShapeProto) neu bauen: `ersatz` bildet den Index auf einen Parameternamen ab (freie Dimension).
function baueForm(formBytes, ersatz) {
  const dims = felder(formBytes).filter((f) => f.nr === 1);
  const neu = dims.map((d, i) => {
    if (ersatz[i] === undefined) return d.roh;
    const param = laengenFeld(2, kodiereText(ersatz[i]));
    return laengenFeld(1, param);
  });
  return verbinde(neu);
}

function patcheWertInfo(infoBytes, ersatzFuer) {
  const teile = [];
  for (const f of felder(infoBytes)) {
    if (f.nr !== 2) {
      teile.push(f.roh);
      continue;
    }
    // TypeProto -> tensor_type (Feld 1) -> shape (Feld 2)
    const typ = felder(f.inhalt).map((t) => {
      if (t.nr !== 1) return t.roh;
      const tensor = felder(t.inhalt).map((s) => (s.nr === 2 ? laengenFeld(2, baueForm(s.inhalt, ersatzFuer(felder(s.inhalt).filter((x) => x.nr === 1).length))) : s.roh));
      return laengenFeld(1, verbinde(tensor));
    });
    teile.push(laengenFeld(2, verbinde(typ)));
  }
  return verbinde(teile);
}

// Liefert eine Kopie des YuNet-Modells mit freier Eingabehoehe und -breite (h, w); die Formangaben der Zwischenwerte entfallen.
// Das Modell ist ein Rechenbild mit Reshape auf -1, es rechnet in jeder durch 32 teilbaren Groesse (OpenCV setzt die Groesse zur Laufzeit).
export function macheEingabeFrei(modellBytes) {
  const wurzel = felder(modellBytes);
  const teile = [];
  for (const f of wurzel) {
    if (f.nr !== 7) {
      teile.push(f.roh);
      continue;
    }
    const graph = [];
    for (const g of felder(f.inhalt)) {
      if (g.nr === 11) graph.push(laengenFeld(11, patcheWertInfo(g.inhalt, (anzahl) => (anzahl === 4 ? { 2: 'h', 3: 'w' } : {}))));
      else if (g.nr === 12) {
        // Ausgabe [1, N, K]: N frei
        graph.push(laengenFeld(12, patcheWertInfo(g.inhalt, (anzahl) => (anzahl === 3 ? { 1: `n${graph.length}` } : {}))));
      } else if (g.nr === 13) continue;
      else graph.push(g.roh);
    }
    teile.push(laengenFeld(7, verbinde(graph)));
  }
  return verbinde(teile);
}

// ---------- Gemeinsames ----------

export function iou(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  if (x2 <= x1 || y2 <= y1) return 0;
  const s = (x2 - x1) * (y2 - y1);
  return s / (a[2] * a[3] + b[2] * b[3] - s);
}

// ---------- YuNet: Nachverarbeitung wie OpenCV FaceDetectorYN (2023mar) ----------
// Eingabe: BGR, Werte 0 bis 255 (blobFromImage ohne Skalierung), Feld S x S. Ausgaben je Schrittweite 8, 16, 32:
// cls (N), obj (N), bbox (N x 4: dx, dy, log w, log h), kps (N x 10). Score = sqrt(cls * obj), je auf 0 bis 1 begrenzt.
export const YUNET_SCHRITTE = [8, 16, 32];

// ausgaben: { cls_8: Float32Array, ... } oder Objekt mit .data; S: Seite des Eingabefeldes; skala: Feld-Pixel je Bild-Pixel.
export function yunetNachverarbeite(ausgaben, S, skala, bildBreite, bildHoehe, schwelle = 0.75, nmsSchwelle = 0.3, obergrenze = 5000) {
  const kandidaten = [];
  for (const schritt of YUNET_SCHRITTE) {
    const spalten = Math.floor(S / schritt);
    const zeilen = Math.floor(S / schritt);
    const cls = ausgaben[`cls_${schritt}`];
    const obj = ausgaben[`obj_${schritt}`];
    const bbox = ausgaben[`bbox_${schritt}`];
    const kps = ausgaben[`kps_${schritt}`];
    for (let r = 0; r < zeilen; r++) {
      for (let c = 0; c < spalten; c++) {
        const i = r * spalten + c;
        const cs = Math.min(1, Math.max(0, cls[i]));
        const os = Math.min(1, Math.max(0, obj[i]));
        const score = Math.sqrt(cs * os);
        if (score < schwelle) continue;
        const cx = (c + bbox[i * 4]) * schritt;
        const cy = (r + bbox[i * 4 + 1]) * schritt;
        const w = Math.exp(bbox[i * 4 + 2]) * schritt;
        const h = Math.exp(bbox[i * 4 + 3]) * schritt;
        const lm = [];
        for (let n = 0; n < 5; n++) lm.push([((kps[i * 10 + 2 * n] + c) * schritt) / skala, ((kps[i * 10 + 2 * n + 1] + r) * schritt) / skala]);
        kandidaten.push({ score, box: [(cx - w / 2) / skala, (cy - h / 2) / skala, w / skala, h / skala], lm });
      }
    }
  }
  kandidaten.sort((a, b) => b.score - a.score);
  const behalten = [];
  for (const k of kandidaten) {
    if (behalten.length >= obergrenze) break;
    if (behalten.every((b) => iou(k.box, b.box) <= nmsSchwelle)) behalten.push(k);
  }
  return behalten.map((k) => ({
    score: Math.round(k.score * 1000) / 1000,
    box: k.box,
    // Reihenfolge wie OpenCV: rechtes Auge, linkes Auge (Bildsicht: links, rechts), Nase, rechter und linker Mundwinkel
    lm: k.lm,
    bildBreite,
    bildHoehe,
  }));
}

// ---------- Modell 320n: wie src/erkenner/modell.ts (Eingabe 320, RGB 0 bis 1, rechts und unten schwarz; NMS 0,45 ueber alle Klassen) ----------
export const GESICHTS_KLASSEN = new Set([1, 12]); // FACE_FEMALE, FACE_MALE

export function n320Nachverarbeite(daten, dims, S, bildBreite, bildHoehe, schwelle = 0.1) {
  const skala = S / Math.max(bildBreite, bildHoehe);
  const kanaele = dims[1];
  const n = dims[2];
  const klassen = kanaele - 4;
  const kandidaten = [];
  for (let i = 0; i < n; i++) {
    let beste = -1;
    let best = -Infinity;
    for (let c = 0; c < klassen; c++) {
      const s = daten[(4 + c) * n + i];
      if (s > best) {
        best = s;
        beste = c;
      }
    }
    if (best < schwelle) continue;
    const mx = daten[i];
    const my = daten[n + i];
    const cw = daten[2 * n + i];
    const ch = daten[3 * n + i];
    const x1 = Math.max(0, (mx - cw / 2) / skala);
    const y1 = Math.max(0, (my - ch / 2) / skala);
    const x2 = Math.min(bildBreite, (mx + cw / 2) / skala);
    const y2 = Math.min(bildHoehe, (my + ch / 2) / skala);
    if (x2 - x1 < 1 || y2 - y1 < 1) continue;
    kandidaten.push({ klasse: beste, score: best, box: [x1, y1, x2 - x1, y2 - y1] });
  }
  kandidaten.sort((a, b) => b.score - a.score);
  const behalten = [];
  for (const k of kandidaten) if (behalten.every((b) => iou(k.box, b.box) <= 0.45)) behalten.push(k);
  // Gesichter wie das Produkt: ganze Pixel (Abschneiden), Wert gerundet auf drei Stellen
  return behalten
    .filter((k) => GESICHTS_KLASSEN.has(k.klasse))
    .map((k) => ({
      score: Math.round(k.score * 1000) / 1000,
      box: [Math.trunc(k.box[0]), Math.trunc(k.box[1]), Math.max(1, Math.trunc(k.box[2])), Math.max(1, Math.trunc(k.box[3]))],
    }));
}

// ---------- Augen- und Mundbox des alten Werkzeugs (engine/detector.py, Abschnitt mit eyes und mouth) ----------
function begrenze(x, y, w, h, B, H) {
  const x1 = Math.max(0, Math.min(B, x));
  const y1 = Math.max(0, Math.min(H, y));
  const x2 = Math.max(0, Math.min(B, x + w));
  const y2 = Math.max(0, Math.min(H, y + h));
  return [x1, y1, Math.max(0, x2 - x1), Math.max(0, y2 - y1)];
}

export function yunetAugenBox(g, B, H) {
  const [, fh] = [g.box[2], g.box[3]];
  const re = g.lm[0];
  const le = g.lm[1];
  const cx = (re[0] + le[0]) / 2;
  const cy = (re[1] + le[1]) / 2;
  const augenAbstand = Math.max(6, Math.hypot(le[0] - re[0], le[1] - re[1]));
  const bw = augenAbstand * 2.3;
  const bh = Math.max(fh * 0.24, augenAbstand * 0.75);
  return begrenze(cx - bw / 2, cy - bh / 2, bw, bh, B, H);
}

export function yunetMundBox(g, B, H) {
  const fh = g.box[3];
  const rm = g.lm[3];
  const lm = g.lm[4];
  const cx = (rm[0] + lm[0]) / 2;
  const cy = (rm[1] + lm[1]) / 2;
  const mw = Math.max(10, Math.hypot(lm[0] - rm[0], lm[1] - rm[1])) * 2;
  const mh = Math.max(fh * 0.22, mw * 0.5);
  return begrenze(cx - mw / 2, cy - mh / 2, mw, mh, B, H);
}
