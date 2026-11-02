// Gesichtsmodell YuNet (2023mar, 0,23 MB): Laden, Vorverarbeitung und Nachverarbeitung wie OpenCV FaceDetectorYN.
// Es laeuft nur, wenn eine Gesichtszone an ist, und liefert Box plus fuenf Punkte (Augen, Nase, Mundwinkel) je Gesicht.
// Die Zonenformeln (Augen, Mund) stehen in zonen.ts. Die Rechnung ist in scripts/messung/yunet-kern.mjs gemessen worden.

import * as ort from 'onnxruntime-web/wasm';
import type { Box } from '../nachrichten';
// Endung .ts, damit auch die Einheitstests in Node das Modul finden.
import { iou } from './modell.ts';

// Die ausgelieferte Datei hat eine feste Eingabe von 640 x 640 (640 findet deutlich mehr Gesichter als 320).
export const YUNET_GROESSE = 640;
export const YUNET_SCHWELLE = 0.75;
export const YUNET_NMS = 0.3;
// Schrittweiten der drei Ausgabestufen.
export const YUNET_SCHRITTE = [8, 16, 32] as const;
// Wie `top_k` in OpenCV FaceDetectorYN: nach dem Sortieren bleiben vor der NMS hoechstens so viele Kandidaten.
// Bewusste Abweichung von OpenCV: Boxen und Punkte bleiben Kommazahlen (OpenCV rundet die Boxen fuer die NMS auf ganze Pixel).
const TOP_K = 5000;
export const YUNET_DATEI = '/modelle/yunet-2023mar.onnx';

export type YunetPunkt = readonly [x: number, y: number];

// Reihenfolge der Punkte wie OpenCV: rechtes Auge, linkes Auge (in der Bildansicht links, rechts), Nase, rechter und linker Mundwinkel.
export interface YunetGesicht {
  score: number;
  // Bildkoordinaten, Kommazahlen
  box: Box;
  punkte: readonly [YunetPunkt, YunetPunkt, YunetPunkt, YunetPunkt, YunetPunkt];
}

// Die zwoelf Ausgaben des Modells: cls_8, cls_16, cls_32, obj_*, bbox_* (N x 4: dx, dy, log w, log h), kps_* (N x 10).
export type YunetAusgaben = Readonly<Record<string, ArrayLike<number> | undefined>>;

// Rohausgabe -> Gesichter in Bildkoordinaten, hoechster Wert zuerst, nach NMS.
// S: Seite des Eingabefeldes, skala: Feldpixel je Bildpixel. Score = Wurzel aus cls mal obj, je auf 0 bis 1 begrenzt.
export function yunetNachverarbeite(
  ausgaben: YunetAusgaben,
  S: number,
  skala: number,
  schwelle: number = YUNET_SCHWELLE,
  nms: number = YUNET_NMS,
): YunetGesicht[] {
  const kandidaten: YunetGesicht[] = [];
  for (const schritt of YUNET_SCHRITTE) {
    const spalten = Math.floor(S / schritt);
    const zeilen = Math.floor(S / schritt);
    const cls = ausgaben[`cls_${schritt}`];
    const obj = ausgaben[`obj_${schritt}`];
    const bbox = ausgaben[`bbox_${schritt}`];
    const kps = ausgaben[`kps_${schritt}`];
    if (!cls || !obj || !bbox || !kps) throw new Error(`YuNet: Ausgabe der Stufe ${schritt} fehlt`);
    for (let r = 0; r < zeilen; r++) {
      for (let c = 0; c < spalten; c++) {
        const i = r * spalten + c;
        const cs = Math.min(1, Math.max(0, cls[i] ?? 0));
        const os = Math.min(1, Math.max(0, obj[i] ?? 0));
        const score = Math.sqrt(cs * os);
        // Wie OpenCV: behalten wird nur, was ueber der Schwelle liegt (genau auf der Schwelle faellt weg).
        if (score <= schwelle) continue;
        const cx = (c + (bbox[i * 4] ?? 0)) * schritt;
        const cy = (r + (bbox[i * 4 + 1] ?? 0)) * schritt;
        const w = Math.exp(bbox[i * 4 + 2] ?? 0) * schritt;
        const h = Math.exp(bbox[i * 4 + 3] ?? 0) * schritt;
        const punkte: YunetPunkt[] = [];
        for (let n = 0; n < 5; n++) {
          punkte.push([(((kps[i * 10 + 2 * n] ?? 0) + c) * schritt) / skala, (((kps[i * 10 + 2 * n + 1] ?? 0) + r) * schritt) / skala]);
        }
        kandidaten.push({
          score,
          box: [(cx - w / 2) / skala, (cy - h / 2) / skala, w / skala, h / skala],
          punkte: punkte as unknown as YunetGesicht['punkte'],
        });
      }
    }
  }
  kandidaten.sort((a, b) => b.score - a.score);
  if (kandidaten.length > TOP_K) kandidaten.length = TOP_K;
  const behalten: YunetGesicht[] = [];
  for (const k of kandidaten) {
    if (behalten.every((b) => iou(k.box, b.box) <= nms)) behalten.push(k);
  }
  return behalten.map((k) => ({ ...k, score: Math.round(k.score * 1000) / 1000 }));
}

// Bildpunkte (RGBA, S x S) -> Tensordaten [1, 3, S, S] float32, BGR, Werte 0 bis 255 (ohne Skalierung, wie OpenCV blobFromImage).
export function yunetTensorDaten(px: ArrayLike<number>, S: number): Float32Array {
  const flaeche = S * S;
  const daten = new Float32Array(3 * flaeche);
  for (let p = 0; p < flaeche; p++) {
    daten[p] = px[p * 4 + 2] ?? 0;
    daten[flaeche + p] = px[p * 4 + 1] ?? 0;
    daten[2 * flaeche + p] = px[p * 4] ?? 0;
  }
  return daten;
}

export interface YunetSitzung {
  session: ort.InferenceSession;
  eingabe: string;
  kontext: OffscreenCanvasRenderingContext2D;
  // Dauer von Laden der Datei, Sitzung bauen und einem Warmlauf mit Leerbild (ohne die Wartezeit auf 320n)
  kaltstartMs: number;
}

// Wie der Erkenner Arbeit in seine gemeinsame Reihe stellt: onnxruntime-web teilt ein WASM-Modul, deshalb darf nichts, was die
// Sitzung baut oder rechnet, gleichzeitig mit einem anderen Lauf arbeiten.
export type Ausfuehrer = <T>(arbeit: () => Promise<T>) => Promise<T>;

// Datei holen, Sitzung bauen und einmal mit einem Leerbild warmlaufen lassen (Bauen und Warmlauf nur ueber `ausfuehren`).
// Die WASM-Pfade setzt der Erkenner vorher (320n zuerst). `kaltstartMs` zaehlt Laden und Rechnen, nicht die Wartezeit in der Reihe.
export async function ladeYunetSitzung(ausfuehren: Ausfuehrer): Promise<YunetSitzung> {
  const t0 = performance.now();
  const antwort = await fetch(browser.runtime.getURL(YUNET_DATEI));
  if (!antwort.ok) throw new Error(`YuNet nicht ladbar: HTTP ${antwort.status}`);
  const bytes = new Uint8Array(await antwort.arrayBuffer());
  const ladeMs = performance.now() - t0;
  const S = YUNET_GROESSE;
  return ausfuehren(async () => {
    const t1 = performance.now();
    const session = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
    try {
      const eingabe = session.inputNames[0];
      if (!eingabe) throw new Error('YuNet ohne Eingabe');
      await session.run({ [eingabe]: new ort.Tensor('float32', new Float32Array(3 * S * S), [1, 3, S, S]) });
      const leinwand = new OffscreenCanvas(S, S);
      const kontext = leinwand.getContext('2d', { willReadFrequently: true });
      if (!kontext) throw new Error('kein 2D-Kontext fuer YuNet');
      return { session, eingabe, kontext, kaltstartMs: Math.round(ladeMs + performance.now() - t1) };
    } catch (e) {
      // Scheitert etwas nach dem Bauen, die Sitzung nicht liegen lassen.
      await session.release().catch(() => {});
      throw e;
    }
  });
}

// Bild auf 640 x 640 bringen (Seitenverhaeltnis bleibt, rechts und unten schwarz) und als BGR-Tensor aufbauen.
export function yunetVorverarbeitung(s: YunetSitzung, quelle: CanvasImageSource, breite: number, hoehe: number): ort.Tensor {
  const S = YUNET_GROESSE;
  const k = s.kontext;
  k.imageSmoothingEnabled = true;
  k.imageSmoothingQuality = 'high';
  const skala = S / Math.max(breite, hoehe);
  k.fillStyle = 'rgb(0,0,0)';
  k.fillRect(0, 0, S, S);
  k.drawImage(quelle, 0, 0, Math.max(1, Math.round(breite * skala)), Math.max(1, Math.round(hoehe * skala)));
  return new ort.Tensor('float32', yunetTensorDaten(k.getImageData(0, 0, S, S).data, S), [1, 3, S, S]);
}

// Ein Lauf auf dem vorbereiteten Tensor; der Aufrufer sorgt dafuer, dass nie zwei Laeufe gleichzeitig rechnen.
export async function yunetLauf(s: YunetSitzung, tensor: ort.Tensor, breite: number, hoehe: number): Promise<YunetGesicht[]> {
  const aus = await s.session.run({ [s.eingabe]: tensor });
  const daten: Record<string, ArrayLike<number>> = {};
  for (const name of s.session.outputNames) {
    const t = aus[name];
    if (t) daten[name] = t.data as Float32Array;
  }
  return yunetNachverarbeite(daten, YUNET_GROESSE, YUNET_GROESSE / Math.max(breite, hoehe));
}
