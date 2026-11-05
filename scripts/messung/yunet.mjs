// Messwerkzeug: lohnt YuNet als Zusatzmodell fuer Augen und Mund? (PHASE-2-BAUPLAN 10.3, kein Produktcode)
// Aufruf: node scripts/messung/yunet.mjs [--teil genauigkeit|kosten|alles] [--browser chromium|firefox|beide] [--laeufe 3] [--max N]
//   genauigkeit: onnxruntime-node, alle Testbilder, YuNet (Schwelle 0,75, NMS 0,3) gegen 320n (Schwelle 0,10) und die geschaetzten Baender.
//   kosten:      Messseite yunet-seite.html mit onnxruntime-web (WASM, 1 Thread) in Chromium (Playwright) und Firefox (geckodriver);
//                je Bild Vorverarbeitung, Inferenz, Nachverarbeitung, gesamt bei Eingabe 320 und 640; 320n zum Vergleich; Kaltstart.
// Modelle: YuNet aus ../04 Alt-Code Referenz/modelle (nur gelesen, zur Laufzeit ausgeliefert), 320n aus public/modelle.
// Ergebnis: scripts/messung/ergebnis-yunet-<zeit>.json (Zahlen, Satz sfw mit Namen, Satz nsfw nur mit laufender Nummer; keine Bilder).
import http from 'node:http';
import { createReadStream, existsSync, readFileSync, statSync } from 'node:fs';
import { readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ort from 'onnxruntime-node';
import sharp from 'sharp';
import { chromium } from '@playwright/test';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { gesichtsZonen, mitRand } from '../../src/erkenner/zonen.ts';
import { macheEingabeFrei, yunetNachverarbeite, n320Nachverarbeite, yunetAugenBox, yunetMundBox, iou } from './yunet-kern.mjs';
import { argumente, firefoxBin, median, perzentil, rund, wurzel, zeitstempel } from './hilfe.mjs';

process.env.SE_AVOID_STATS = 'true';
const hier = path.dirname(fileURLToPath(import.meta.url));
const modellOrdnerAlt = path.resolve(wurzel, '../04 Alt-Code Referenz/modelle');
const yunetPfad = path.join(modellOrdnerAlt, 'face_detection_yunet_2023mar.onnx');
const n320Pfad = path.join(wurzel, 'public/modelle/320n.onnx');
const testbilder = path.resolve(wurzel, '../05 Testbilder');
const ortOrdner = path.join(wurzel, 'node_modules/onnxruntime-web/dist');
const ENDUNGEN = new Set(['.jpg', '.jpeg', '.png', '.webp']);
const MAX_SEITE = 1600;
const RAND = 0.15;
const IOU_ZUORDNUNG = 0.3;
const YUNET_SCHWELLE = 0.75;
const YUNET_NMS = 0.3;
const N320_SCHWELLE = 0.1;

const args = argumente();
const teil = args.teil ?? 'alles';
const browserWahl = args.browser ?? 'beide';
const laeufeAnzahl = Number(args.laeufe ?? 3);
const maxBilder = Number(args.max ?? 0);

// ---------- Bilderliste ----------
async function leseSatz(satz) {
  const eintraege = await readdir(path.join(testbilder, satz), { withFileTypes: true });
  return eintraege
    .filter((e) => e.isFile() && !e.name.startsWith('.') && ENDUNGEN.has(path.extname(e.name).toLowerCase()))
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, 'en', { numeric: true, sensitivity: 'base' }));
}

// ---------- Messserver (Port ab 47373) ----------
const TYPEN = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.wasm': 'application/wasm', '.onnx': 'application/octet-stream', '.json': 'application/json', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' };

function sendeDatei(res, datei) {
  if (!existsSync(datei)) {
    res.writeHead(404).end('nicht gefunden');
    return;
  }
  res.writeHead(200, { 'content-type': TYPEN[path.extname(datei).toLowerCase()] ?? 'application/octet-stream', 'content-length': statSync(datei).size, 'cache-control': 'no-store' });
  createReadStream(datei).pipe(res);
}

async function starteServer() {
  const saetze = { sfw: await leseSatz('sfw'), nsfw: await leseSatz('nsfw') };
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const p = decodeURIComponent(url.pathname);
    if (p === '/' || p === '/yunet-seite.html') return sendeDatei(res, path.join(hier, 'yunet-seite.html'));
    if (p === '/yunet-seite.mjs' || p === '/yunet-kern.mjs') return sendeDatei(res, path.join(hier, p));
    if (p === '/modell/yunet.onnx') return sendeDatei(res, yunetPfad);
    if (p === '/modell/320n.onnx') return sendeDatei(res, n320Pfad);
    if (p === '/api/bilder') {
      const liste = [];
      for (const satz of ['sfw', 'nsfw']) for (const name of saetze[satz]) liste.push({ satz, name });
      res.writeHead(200, { 'content-type': 'application/json', 'cache-control': 'no-store' }).end(JSON.stringify(liste));
      return;
    }
    if (p.startsWith('/bild/')) {
      const [satz, ...rest] = p.slice(6).split('/');
      const name = rest.join('/');
      if (saetze[satz]?.includes(name)) return sendeDatei(res, path.join(testbilder, satz, name));
      return res.writeHead(404).end('nicht gefunden');
    }
    if (p.startsWith('/ort/') && /^[\w.-]+\.(js|mjs|wasm)$/.test(p.slice(5))) return sendeDatei(res, path.join(ortOrdner, p.slice(5)));
    res.writeHead(404).end('nicht gefunden');
  });
  for (let port = 47373; port < 47473; port++) {
    const ok = await new Promise((r) => {
      server.once('error', () => r(false));
      server.listen(port, '127.0.0.1', () => r(true));
    });
    if (ok) return { server, port };
  }
  throw new Error('kein freier Port ab 47373');
}

// ---------- Genauigkeit in Node ----------
// Vorverarbeitung wie das Produkt: Arbeitsbild bis 1600, dann Feld S x S, rechts und unten schwarz (sharp statt Canvas).
async function ladeBild(datei) {
  const { data, info } = await sharp(datei).rotate().resize({ width: MAX_SEITE, height: MAX_SEITE, fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true });
  return { roh: data, breite: info.width, hoehe: info.height };
}

async function baueTensor(bild, S, art) {
  const skala = S / Math.max(bild.breite, bild.hoehe);
  const zw = Math.max(1, Math.round(bild.breite * skala));
  const zh = Math.max(1, Math.round(bild.hoehe * skala));
  const klein = await sharp(bild.roh, { raw: { width: bild.breite, height: bild.hoehe, channels: 3 } }).resize(zw, zh).raw().toBuffer();
  const f = S * S;
  const d = new Float32Array(3 * f);
  for (let y = 0; y < zh; y++) {
    for (let x = 0; x < zw; x++) {
      const i = (y * zw + x) * 3;
      const p = y * S + x;
      if (art === 'n320') {
        d[p] = klein[i] / 255;
        d[f + p] = klein[i + 1] / 255;
        d[2 * f + p] = klein[i + 2] / 255;
      } else {
        d[p] = klein[i + 2];
        d[f + p] = klein[i + 1];
        d[2 * f + p] = klein[i];
      }
    }
  }
  return { tensor: new ort.Tensor('float32', d, [1, 3, S, S]), skala };
}

async function erkenneAlle(liste, mitFortschritt = true) {
  const yunet = await ort.InferenceSession.create(macheEingabeFrei(readFileSync(yunetPfad)));
  const n320 = await ort.InferenceSession.create(readFileSync(n320Pfad));
  const aus = [];
  let nr = 0;
  for (const b of liste) {
    if (mitFortschritt && ++nr % 20 === 0) console.log(`  Genauigkeit: Bild ${nr}/${liste.length}`);
    const bild = await ladeBild(path.join(testbilder, b.satz, b.name));
    const e = { satz: b.satz, name: b.name, breite: bild.breite, hoehe: bild.hoehe };
    for (const S of [640, 320]) {
      const { tensor, skala } = await baueTensor(bild, S, 'yunet');
      const o = await yunet.run({ input: tensor });
      const roh = {};
      for (const k of Object.keys(o)) roh[k] = o[k].data;
      e[S === 640 ? 'yunet' : 'yunet320'] = yunetNachverarbeite(roh, S, skala, bild.breite, bild.hoehe, YUNET_SCHWELLE, YUNET_NMS);
      if (S === 640) e.yunet60 = yunetNachverarbeite(roh, S, skala, bild.breite, bild.hoehe, 0.6, YUNET_NMS);
    }
    const t = await baueTensor(bild, 320, 'n320');
    const o = await n320.run({ [n320.inputNames[0]]: t.tensor });
    const ausgabe = o[n320.outputNames[0]];
    e.n320 = n320Nachverarbeite(ausgabe.data, ausgabe.dims, 320, bild.breite, bild.hoehe, N320_SCHWELLE);
    aus.push(e);
  }
  return aus;
}

// ---------- Auswertung ----------
const flaeche = (b) => Math.max(0, b[2]) * Math.max(0, b[3]);
function schnitt(a, b) {
  const x1 = Math.max(a[0], b[0]);
  const y1 = Math.max(a[1], b[1]);
  const x2 = Math.min(a[0] + a[2], b[0] + b[2]);
  const y2 = Math.min(a[1] + a[3], b[1] + b[3]);
  return x2 <= x1 || y2 <= y1 ? 0 : (x2 - x1) * (y2 - y1);
}
const imBand = (p, b) => p[0] >= b[0] && p[0] <= b[0] + b[2] && p[1] >= b[1] && p[1] <= b[1] + b[3];
const imBox = (p, b) => imBand(p, b);

// Zuordnung Gesicht zu Gesicht ueber IoU, gierig nach dem groessten Wert, eins zu eins.
function ordneZu(yunet, n320, schwelle) {
  const kand = [];
  yunet.forEach((y, i) => n320.forEach((n, j) => {
    const w = iou(y.box, n.box);
    if (w >= schwelle) kand.push({ i, j, w });
  }));
  kand.sort((a, b) => b.w - a.w);
  const usedY = new Set();
  const usedN = new Set();
  const paare = [];
  for (const k of kand) {
    if (usedY.has(k.i) || usedN.has(k.j)) continue;
    usedY.add(k.i);
    usedN.add(k.j);
    paare.push(k);
  }
  return { paare, nurY: yunet.map((_, i) => i).filter((i) => !usedY.has(i)), nurN: n320.map((_, j) => j).filter((j) => !usedN.has(j)) };
}

// Mittel und schlechtestes Zehntel (Wert des 10-%-Perzentils und Mittel der schlechtesten 10 %).
function verteilung(werte, stellen = 3) {
  const l = werte.filter((v) => typeof v === 'number').sort((a, b) => a - b);
  if (!l.length) return { n: 0, mittel: null, median: null, p10: null, schlechtestes_zehntel_mittel: null, p90: null };
  const k = Math.max(1, Math.ceil(l.length * 0.1));
  const mittel = (a) => a.reduce((s, v) => s + v, 0) / a.length;
  return { n: l.length, mittel: rund(mittel(l), stellen), median: rund(median(l), stellen), p10: rund(perzentil(l, 0.1), stellen), schlechtestes_zehntel_mittel: rund(mittel(l.slice(0, k)), stellen), p90: rund(perzentil(l, 0.9), stellen) };
}

function paarMasse(y, n, B, H, rand) {
  const zonen = gesichtsZonen(n.box, B, H);
  const baender = mitRand([{ zone: 'eyes', box: zonen.eyes }, { zone: 'mouth', box: zonen.mouth }], rand, B, H);
  const augenBand = baender[0].box;
  const mundBand = baender[1].box;
  const augenBox = yunetAugenBox(y, B, H);
  const mundBox = yunetMundBox(y, B, H);
  const augen = [y.lm[0], y.lm[1]];
  const mund = [y.lm[3], y.lm[4]];
  const augenIn = augen.every((p) => imBand(p, augenBand));
  const mundIn = mund.every((p) => imBand(p, mundBand));
  const grund = (punkte, band) => ({
    hoch: punkte.some((p) => p[1] < band[1]),
    tief: punkte.some((p) => p[1] > band[1] + band[3]),
    seitlich: punkte.some((p) => p[0] < band[0] || p[0] > band[0] + band[2]),
  });
  const rolle = (Math.atan2(y.lm[1][1] - y.lm[0][1], y.lm[1][0] - y.lm[0][0]) * 180) / Math.PI;
  const yh = y.box[3];
  const nh = n.box[3];
  const augenMitteY = (y.lm[0][1] + y.lm[1][1]) / 2;
  const mundMitteY = (y.lm[3][1] + y.lm[4][1]) / 2;
  return {
    augenIn,
    mundIn,
    augenGrund: augenIn ? null : grund(augen, augenBand),
    mundGrund: mundIn ? null : grund(mund, mundBand),
    augenAbdeckung: schnitt(augenBand, augenBox) / Math.max(1, flaeche(augenBox)),
    mundAbdeckung: schnitt(mundBand, mundBox) / Math.max(1, flaeche(mundBox)),
    augenUeber: flaeche(augenBand) / Math.max(1, flaeche(augenBox)),
    mundUeber: flaeche(mundBand) / Math.max(1, flaeche(mundBox)),
    augenGegenGesicht: flaeche(augenBand) / Math.max(1, flaeche(y.box)),
    mundGegenGesicht: flaeche(mundBand) / Math.max(1, flaeche(y.box)),
    rolleBetrag: Math.abs(rolle),
    // Lage in der Gesichtsbox von 320n (0 = Oberkante, 1 = Unterkante)
    augenLinieRel: (augenMitteY - n.box[1]) / Math.max(1, nh),
    mundLinieRel: (mundMitteY - n.box[1]) / Math.max(1, nh),
    augenXRel: [(y.lm[0][0] - n.box[0]) / n.box[2], (y.lm[1][0] - n.box[0]) / n.box[2]],
    hoeheVerhaeltnis: nh / Math.max(1, yh),
    breiteVerhaeltnis: n.box[2] / Math.max(1, y.box[2]),
    mitteYVersatz: (n.box[1] + nh / 2 - (y.box[1] + yh / 2)) / Math.max(1, yh),
    augenInBox: augen.every((p) => imBox(p, n.box)),
    mundInBox: mund.every((p) => imBox(p, n.box)),
    yunetHoehe: yh,
  };
}

function plausibel(g) {
  // Augen oberhalb Mund, alle fuenf Punkte in der Box (kleine Toleranz), Augen nebeneinander
  const [re, le, nase, rm, lm] = g.lm;
  const box = g.box;
  const tol = 0.15;
  const innen = g.lm.every((p) => p[0] >= box[0] - tol * box[2] && p[0] <= box[0] + box[2] * (1 + tol) && p[1] >= box[1] - tol * box[3] && p[1] <= box[1] + box[3] * (1 + tol));
  const oben = Math.max(re[1], le[1]) < Math.min(rm[1], lm[1]) && nase[1] > Math.min(re[1], le[1]) && nase[1] < Math.max(rm[1], lm[1]);
  return { innen, oben };
}

function auswerten(erkannt, eingabeFeld) {
  const ergebnis = {};
  for (const satz of ['sfw', 'nsfw', 'beide']) {
    const bilder = erkannt.filter((e) => satz === 'beide' || e.satz === satz);
    const Z = { bilder: bilder.length };
    Z.bilder_mit_gesicht = { yunet: 0, n320: 0, beide: 0, mindestens_eines: 0 };
    Z.gesichter = { yunet: 0, n320: 0, beide: 0, nur_yunet: 0, nur_n320: 0 };
    Z.gesichter_yunet_schwelle_060 = 0;
    const paare = [];
    const nurYHoehen = [];
    const nurNHoehen = [];
    const beideHoehen = [];
    const plausiblesCount = { gesichter: 0, augen_ueber_mund: 0, punkte_in_box: 0 };
    for (const e of bilder) {
      const y = e[eingabeFeld];
      const n = e.n320;
      if (y.length) Z.bilder_mit_gesicht.yunet++;
      if (n.length) Z.bilder_mit_gesicht.n320++;
      if (y.length && n.length) Z.bilder_mit_gesicht.beide++;
      if (y.length || n.length) Z.bilder_mit_gesicht.mindestens_eines++;
      Z.gesichter.yunet += y.length;
      Z.gesichter.n320 += n.length;
      Z.gesichter_yunet_schwelle_060 += e.yunet60.length;
      for (const g of y) {
        const p = plausibel(g);
        plausiblesCount.gesichter++;
        if (p.oben) plausiblesCount.augen_ueber_mund++;
        if (p.innen) plausiblesCount.punkte_in_box++;
      }
      const z = ordneZu(y, n, IOU_ZUORDNUNG);
      Z.gesichter.beide += z.paare.length;
      Z.gesichter.nur_yunet += z.nurY.length;
      Z.gesichter.nur_n320 += z.nurN.length;
      for (const i of z.nurY) nurYHoehen.push(y[i].box[3]);
      for (const j of z.nurN) nurNHoehen.push(n[j].box[3]);
      for (const p of z.paare) {
        beideHoehen.push(y[p.i].box[3]);
        paare.push({ iou: p.w, ...paarMasse(y[p.i], n[p.j], e.breite, e.hoehe, RAND), ohneRand: paarMasse(y[p.i], n[p.j], e.breite, e.hoehe, 0) });
      }
    }
    const anteil = (f) => rund(paare.filter(f).length / Math.max(1, paare.length), 3);
    const zaehleGrund = (feld, g) => paare.filter((p) => p[feld] && p[feld][g]).length;
    const rollStufen = [['unter_10', (r) => r < 10], ['10_bis_25', (r) => r >= 10 && r < 25], ['ab_25', (r) => r >= 25]];
    Z.paare = paare.length;
    Z.nur_yunet_hoehe_median = rund(median(nurYHoehen), 0);
    Z.nur_n320_hoehe_median = rund(median(nurNHoehen), 0);
    Z.beide_hoehe_median = rund(median(beideHoehen), 0);
    Z.yunet_plausibel = plausiblesCount;
    Z.band_mit_rand_015 = {
      augenpunkte_im_band: anteil((p) => p.augenIn),
      mundwinkel_im_band: anteil((p) => p.mundIn),
      augen_abdeckung: verteilung(paare.map((p) => p.augenAbdeckung)),
      mund_abdeckung: verteilung(paare.map((p) => p.mundAbdeckung)),
      augen_band_zu_yunet_augenbox: verteilung(paare.map((p) => p.augenUeber), 2),
      mund_band_zu_yunet_mundbox: verteilung(paare.map((p) => p.mundUeber), 2),
      augen_band_zu_yunet_gesichtsbox: verteilung(paare.map((p) => p.augenGegenGesicht), 3),
      mund_band_zu_yunet_gesichtsbox: verteilung(paare.map((p) => p.mundGegenGesicht), 3),
    };
    Z.band_ohne_rand = {
      augenpunkte_im_band: rund(paare.filter((p) => p.ohneRand.augenIn).length / Math.max(1, paare.length), 3),
      mundwinkel_im_band: rund(paare.filter((p) => p.ohneRand.mundIn).length / Math.max(1, paare.length), 3),
      augen_abdeckung: verteilung(paare.map((p) => p.ohneRand.augenAbdeckung)),
      mund_abdeckung: verteilung(paare.map((p) => p.ohneRand.mundAbdeckung)),
    };
    Z.fehlschlaege_mit_rand = {
      augen_paare_daneben: paare.filter((p) => !p.augenIn).length,
      augen_zu_hoch: zaehleGrund('augenGrund', 'hoch'),
      augen_zu_tief: zaehleGrund('augenGrund', 'tief'),
      augen_seitlich: zaehleGrund('augenGrund', 'seitlich'),
      mund_paare_daneben: paare.filter((p) => !p.mundIn).length,
      mund_zu_hoch: zaehleGrund('mundGrund', 'hoch'),
      mund_zu_tief: zaehleGrund('mundGrund', 'tief'),
      mund_seitlich: zaehleGrund('mundGrund', 'seitlich'),
    };
    Z.nach_kopfneigung_mit_rand = Object.fromEntries(rollStufen.map(([name, f]) => {
      const gruppe = paare.filter((p) => f(p.rolleBetrag));
      return [name, { paare: gruppe.length, augen_daneben: gruppe.filter((p) => !p.augenIn).length, mund_daneben: gruppe.filter((p) => !p.mundIn).length }];
    }));
    Z.lage_in_320n_box = {
      augenlinie_rel_hoehe: verteilung(paare.map((p) => p.augenLinieRel)),
      mundlinie_rel_hoehe: verteilung(paare.map((p) => p.mundLinieRel)),
      band_augen_unverandert: [0.22, 0.46],
      band_mund_unverandert: [0.66, 0.9],
      hoehe_320n_zu_yunet: verteilung(paare.map((p) => p.hoeheVerhaeltnis), 2),
      breite_320n_zu_yunet: verteilung(paare.map((p) => p.breiteVerhaeltnis), 2),
      mitte_y_versatz_rel_yunet_hoehe: verteilung(paare.map((p) => p.mitteYVersatz), 3),
      iou: verteilung(paare.map((p) => p.iou), 3),
    };
    ergebnis[satz] = Z;
  }
  return ergebnis;
}

// Zuordnung bei anderen IoU-Schwellen (Empfindlichkeit)
function empfindlichkeit(erkannt, feld) {
  const aus = {};
  for (const s of [0.1, 0.3, 0.5]) {
    const z = { beide: 0, nur_yunet: 0, nur_n320: 0, augen_im_band: 0, mund_im_band: 0 };
    for (const e of erkannt) {
      const m = ordneZu(e[feld], e.n320, s);
      z.beide += m.paare.length;
      z.nur_yunet += m.nurY.length;
      z.nur_n320 += m.nurN.length;
      for (const p of m.paare) {
        const w = paarMasse(e[feld][p.i], e.n320[p.j], e.breite, e.hoehe, RAND);
        if (w.augenIn) z.augen_im_band++;
        if (w.mundIn) z.mund_im_band++;
      }
    }
    z.augen_anteil = rund(z.augen_im_band / Math.max(1, z.beide), 3);
    z.mund_anteil = rund(z.mund_im_band / Math.max(1, z.beide), 3);
    aus[`iou_${s}`] = z;
  }
  return aus;
}

// Erkundung (nicht an unabhaengigen Bildern geprueft): wie schlagen sich nach oben verschobene Baender ohne YuNet?
// Verschiebung dy in Anteilen der Hoehe der 320n-Box; Breiten und Hoehen der Baender bleiben, Rand 0,15 wie sonst.
function bandVarianten(erkannt, feld) {
  const aus = {};
  for (const dy of [0, -0.04, -0.06, -0.08]) {
    const Z = { paare: 0, augen_im_band: 0, mund_im_band: 0, augen_abdeckung: [], mund_abdeckung: [], augen_ueber: [], mund_ueber: [] };
    for (const e of erkannt) {
      const m = ordneZu(e[feld], e.n320, IOU_ZUORDNUNG);
      for (const p of m.paare) {
        const y = e[feld][p.i];
        const n = e.n320[p.j];
        // Verschiebung der ganzen Box nach oben verschiebt auch die beiden Baender; Rundung und Begrenzung wie im Produkt.
        const [x, yy, w, h] = n.box;
        const zonen = gesichtsZonen([x, yy + dy * h, w, h], e.breite, e.hoehe);
        const [ab, mb] = mitRand([{ zone: 'eyes', box: zonen.eyes }, { zone: 'mouth', box: zonen.mouth }], RAND, e.breite, e.hoehe).map((f) => f.box);
        const augenBox = yunetAugenBox(y, e.breite, e.hoehe);
        const mundBox = yunetMundBox(y, e.breite, e.hoehe);
        Z.paare++;
        if ([y.lm[0], y.lm[1]].every((q) => imBand(q, ab))) Z.augen_im_band++;
        if ([y.lm[3], y.lm[4]].every((q) => imBand(q, mb))) Z.mund_im_band++;
        Z.augen_abdeckung.push(schnitt(ab, augenBox) / Math.max(1, flaeche(augenBox)));
        Z.mund_abdeckung.push(schnitt(mb, mundBox) / Math.max(1, flaeche(mundBox)));
        Z.augen_ueber.push(flaeche(ab) / Math.max(1, flaeche(augenBox)));
        Z.mund_ueber.push(flaeche(mb) / Math.max(1, flaeche(mundBox)));
      }
    }
    aus[`verschiebung_${dy}`] = {
      paare: Z.paare,
      augenpunkte_im_band: rund(Z.augen_im_band / Math.max(1, Z.paare), 3),
      mundwinkel_im_band: rund(Z.mund_im_band / Math.max(1, Z.paare), 3),
      augen_abdeckung_mittel: verteilung(Z.augen_abdeckung).mittel,
      mund_abdeckung_mittel: verteilung(Z.mund_abdeckung).mittel,
      augen_ueber_median: verteilung(Z.augen_ueber, 2).median,
      mund_ueber_median: verteilung(Z.mund_ueber, 2).median,
    };
  }
  return aus;
}

// ---------- Browser ----------
async function messeChromium(port, zuerst, max) {
  const browser = await chromium.launch({ headless: true, channel: 'chromium' });
  try {
    const version = browser.version();
    const seite = await (await browser.newContext()).newPage();
    seite.on('pageerror', (e) => console.error('chromium-seitenfehler:', String(e).slice(0, 300)));
    await seite.goto(`http://127.0.0.1:${port}/?zuerst=${zuerst}&max=${max}`);
    await seite.waitForFunction(() => document.documentElement.dataset.fertig === '1', null, { timeout: 900_000, polling: 500 });
    const { fehler, ergebnis } = await seite.evaluate(() => ({ fehler: document.documentElement.dataset.fehler ?? null, ergebnis: document.documentElement.dataset.ergebnis ?? null }));
    if (fehler) throw new Error(fehler);
    return { version, daten: JSON.parse(ergebnis) };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function messeFirefox(port, zuerst, max) {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').setBinary(firefoxBin).addArguments('-headless');
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  try {
    await driver.manage().setTimeouts({ pageLoad: 60_000, script: 600_000 });
    const version = (await driver.getCapabilities()).get('browserVersion') ?? '';
    await driver.get(`http://127.0.0.1:${port}/?zuerst=${zuerst}&max=${max}`);
    const start = Date.now();
    let fertig = null;
    while (Date.now() - start < 900_000) {
      fertig = await driver.executeScript("return document.documentElement.dataset.fertig ?? null");
      if (fertig === '1') break;
      await new Promise((r) => setTimeout(r, 500));
    }
    if (fertig !== '1') throw new Error('Zeitlimit ueberschritten');
    const fehler = await driver.executeScript('return document.documentElement.dataset.fehler ?? null');
    if (fehler) throw new Error(fehler);
    const ergebnis = await driver.executeScript('return document.documentElement.dataset.ergebnis');
    return { version, daten: JSON.parse(ergebnis) };
  } finally {
    await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
  }
}

function fasseZeiten(daten) {
  const aus = {};
  for (const [id, z] of Object.entries(daten.zeiten)) {
    aus[id] = {};
    for (const stufe of ['vor', 'inf', 'nach', 'gesamt']) aus[id][stufe] = { median: rund(median(z[stufe]), 2), p90: rund(perzentil(z[stufe], 0.9), 2) };
  }
  aus.dekodieren = { median: rund(median(daten.dekodMs), 2), p90: rund(perzentil(daten.dekodMs, 0.9), 2) };
  return aus;
}

// Paritaet Browser gegen Node (YuNet 640, 320n): gleiche Anzahl Gesichter und mittlere IoU gepaarter Boxen.
function paritaet(browserErkannt, nodeErkannt) {
  const nodeJe = new Map(nodeErkannt.map((e) => [`${e.satz}/${e.name}`, e]));
  const z = { bilder: 0, yunet_gleiche_anzahl: 0, n320_gleiche_anzahl: 0, yunet_iou: [], n320_iou: [] };
  for (const b of browserErkannt) {
    const n = nodeJe.get(`${b.satz}/${b.name}`);
    if (!n) continue;
    z.bilder++;
    if (b.yunet.length === n.yunet.length) z.yunet_gleiche_anzahl++;
    if (b.n320.length === n.n320.length) z.n320_gleiche_anzahl++;
    for (const [feld, ziel] of [['yunet', z.yunet_iou], ['n320', z.n320_iou]]) {
      const m = ordneZu(b[feld], n[feld], 0.1);
      for (const p of m.paare) ziel.push(p.w);
    }
  }
  return { bilder: z.bilder, yunet_gleiche_anzahl: z.yunet_gleiche_anzahl, n320_gleiche_anzahl: z.n320_gleiche_anzahl, yunet_iou_mittel: rund(z.yunet_iou.reduce((a, v) => a + v, 0) / Math.max(1, z.yunet_iou.length), 3), n320_iou_mittel: rund(z.n320_iou.reduce((a, v) => a + v, 0) / Math.max(1, z.n320_iou.length), 3) };
}

// ---------- Ablauf ----------
const t0 = Date.now();
const ergebnisDatei = { werkzeug: 'scripts/messung/yunet.mjs', datum: new Date().toISOString(), argumente: { teil, browser: browserWahl, laeufe: laeufeAnzahl, max: maxBilder } };
ergebnisDatei.versionen = {
  node: process.version,
  onnxruntime_node: JSON.parse(readFileSync(path.join(wurzel, 'node_modules/onnxruntime-node/package.json'), 'utf8')).version,
  onnxruntime_web: JSON.parse(readFileSync(path.join(wurzel, 'node_modules/onnxruntime-web/package.json'), 'utf8')).version,
  sharp: JSON.parse(readFileSync(path.join(wurzel, 'node_modules/sharp/package.json'), 'utf8')).version,
  playwright: JSON.parse(readFileSync(path.join(wurzel, 'node_modules/@playwright/test/package.json'), 'utf8')).version,
};
ergebnisDatei.einstellungen = { yunet_schwelle: YUNET_SCHWELLE, yunet_nms: YUNET_NMS, n320_schwelle: N320_SCHWELLE, n320_nms: 0.45, band_rand: RAND, zuordnung_iou: IOU_ZUORDNUNG, arbeitsbild_max: MAX_SEITE };

const liste = [];
for (const satz of ['sfw', 'nsfw']) {
  const l = await leseSatz(satz);
  for (const name of maxBilder ? l.slice(0, maxBilder) : l) liste.push({ satz, name });
}
console.log(`Bilder: ${liste.filter((b) => b.satz === 'sfw').length} sfw, ${liste.filter((b) => b.satz === 'nsfw').length} nsfw`);

let nodeErkannt = null;
if (teil === 'genauigkeit' || teil === 'alles') {
  console.log('Genauigkeit (onnxruntime-node) ...');
  nodeErkannt = await erkenneAlle(liste);
  ergebnisDatei.genauigkeit_eingabe_640 = auswerten(nodeErkannt, 'yunet');
  ergebnisDatei.genauigkeit_eingabe_320 = auswerten(nodeErkannt, 'yunet320');
  ergebnisDatei.empfindlichkeit_zuordnung_640 = empfindlichkeit(nodeErkannt, 'yunet');
  ergebnisDatei.erkundung_baender_verschoben_640 = bandVarianten(nodeErkannt, 'yunet');
  console.log(JSON.stringify(ergebnisDatei.genauigkeit_eingabe_640.beide, null, 1).slice(0, 3000));
}

if (teil === 'kosten' || teil === 'alles') {
  const { server, port } = await starteServer();
  console.log(`Messserver auf 127.0.0.1:${port}`);
  ergebnisDatei.kosten = {};
  try {
    const arten = browserWahl === 'beide' ? ['chromium', 'firefox'] : [browserWahl];
    for (const art of arten) {
      const laeufe = [];
      let version = '';
      for (let i = 0; i < laeufeAnzahl; i++) {
        // Lauf 1 und 3: YuNet zuerst gebaut, Lauf 2: 320n zuerst (Anteil der WASM-Initialisierung am Kaltstart sichtbar machen)
        const zuerst = i === 1 ? '320n' : 'yunet';
        console.log(`${art}: Lauf ${i + 1}/${laeufeAnzahl} (zuerst ${zuerst}) ...`);
        const r = art === 'chromium' ? await messeChromium(port, zuerst, maxBilder) : await messeFirefox(port, zuerst, maxBilder);
        version = r.version;
        laeufe.push(r.daten);
      }
      const jeLauf = laeufe.map((d) => ({ zuerst: d.zuerst, bilder: d.bilder, numThreads: d.numThreads, kalt: d.kalt, zeiten: fasseZeiten(d), gesamtMs: rund(d.gesamtMs, 0) }));
      // Paritaet gegen Node (erster Lauf)
      let par = null;
      if (nodeErkannt) par = paritaet(laeufe[0].erkannt, nodeErkannt);
      ergebnisDatei.kosten[art] = { version, laeufe: jeLauf, paritaet_node: par };
      // Browser-Erkennungen fuer die Auswertung mit den Browserzahlen (Namen aus nsfw bleiben draussen)
      ergebnisDatei.kosten[art].genauigkeit_aus_browserlauf_640 = auswerten(laeufe[0].erkannt.map((e) => ({ ...e, yunet60: e.yunet })), 'yunet').beide;
    }
  } finally {
    server.close();
  }
}

// Namen aus dem Satz nsfw nicht ablegen (hier gibt es keine Bildlisten im Ergebnis, nur Zahlen)
const datei = path.join(hier, `ergebnis-yunet-${zeitstempel()}.json`);
await writeFile(datei, JSON.stringify(ergebnisDatei, null, 2));
console.log(`Ergebnis: ${path.relative(wurzel, datei)} (${Math.round((Date.now() - t0) / 1000)} s)`);
process.exit(0);
