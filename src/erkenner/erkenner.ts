// Erkenner: laedt das Modell 320n mit onnxruntime-web (WASM, 1 Thread), prueft Bilder nacheinander
// und liefert Treffer, zusammengefuehrte Flaechen und auf Wunsch das zensierte Bild.
// Ist eine Gesichtszone an, laeuft zusaetzlich das Gesichtsmodell YuNet (yunet.ts) fuer genauere Augen und Mund.

import * as ort from 'onnxruntime-web/wasm';
import { vervollstaendige, type Einstellungen } from '../einstellungen';
import type {
  AntwortErkennerStatus,
  AntwortPruefe,
  Flaeche,
  NachrichtErkennerPruefe,
  Treffer,
  ZeitenPruefung,
} from '../nachrichten';
import { hashe, waehlePatch } from '../pack/patches';
import { geometrieFuer, MODELL_GROESSE, nachverarbeite } from './modell';
import { blobAusDataUrl, ladeNach, type RefererSetzer } from './nachladen';
import { dekodiereBild, ersatzBildFuerBewegtesSvg, svgMitBewegung } from './dekodiere';
import { Schranke } from './schranke';
import { rendereZensur } from './stile';
import {
  ladeYunetSitzung,
  yunetLauf,
  yunetVorverarbeitung,
  type YunetGesicht,
  type YunetSitzung,
} from './yunet';
import { berechneFlaechen, kombiniereGesichter } from './zonen';

// Laengste Seite des Arbeitsbildes: so gross wird gerendert und so beziehen sich Boxen und `breite`/`hoehe` der Antwort.
const MAX_SEITE = 1600;
// Gleichzeitig laufende Pruefungen (Laden, Dekodieren, Arbeitsbild, Rendern): mehr braucht es nicht, weil die Inferenz
// ohnehin einzeln laeuft, und mehr gleichzeitige grosse Bitmaps kosten nur Speicher.
const PARALLELE_PRUEFUNGEN = 2;
// So lange gilt ein fehlgeschlagenes Laden des Modells als Antwort, bevor ein neuer Versuch erlaubt ist.
const LADE_PAUSE_MS = 5000;

// Kennung des Bildes fuer die stabile Patch-Auswahl: Adresse bei `url`, Hash der Daten bei `daten`.
function bildKennung(n: NachrichtErkennerPruefe): string {
  const q = n.quelle;
  if (q.art === 'url') return q.url;
  const d = q.dataUrl;
  return `daten:${d.length}:${hashe(d)}`;
}

// Zu jeder Flaeche ein Patch-Bild aus dem Pack (Auswahl stabil je Bild und Flaeche), dazu die Rueckgabe der geliehenen Bilder
// (nach dem Rendern aufrufen). null, wenn keins zu haben ist: dann Mosaik. `packStand`: das Pack, das der Aufrufer kennt.
async function patchesFuer(
  kennung: string,
  flaechen: readonly Flaeche[],
  packStand: number | undefined,
): Promise<{ bilder: (CanvasImageSource | null)[]; freigeben: () => void } | null> {
  const bilder: (CanvasImageSource | null)[] = [];
  const frei: (() => void)[] = [];
  for (const f of flaechen) {
    const wahl = await waehlePatch(`${kennung}|${f.zone}|${f.box.join(',')}`, packStand);
    bilder.push(wahl ? wahl.bild : null);
    if (wahl) frei.push(wahl.freigeben);
  }
  if (frei.length === 0) return null;
  return { bilder, freigeben: () => frei.forEach((f) => f()) };
}

const jetzt = (): number => performance.now();
const runde = (x: number): number => Math.round(x * 100) / 100;

let session: ort.InferenceSession | null = null;
let eingabeName = '';
let ausgabeName = '';
let ladeVersprechen: Promise<void> | null = null;
let kaltstartMs: number | null = null;
let laeufe = 0;
// Anzahl der Laeufe, die auf die Session warten oder gerade rechnen (die vor der Schranke Wartenden zaehlt Schranke.wartend).
let wartend = 0;
let kette: Promise<unknown> = Promise.resolve();
let ladeFehler: { fehler: unknown; bis: number } | null = null;
// Gesichtsmodell YuNet: eigene Sitzung, wird nach 320n im Hintergrund geladen. Scheitert das Laden, gilt der Weg ohne YuNet.
let gesichtSitzung: YunetSitzung | null = null;
let gesichtLadeVersprechen: Promise<YunetSitzung | null> | null = null;
let gesichtFehlerBis = 0;
// Anzahl der YuNet-Laeufe seit dem Start (ohne Warmlauf), fuer den Status.
let gesichtLaeufe = 0;
const schranke = new Schranke(PARALLELE_PRUEFUNGEN);
let refererSetzer: RefererSetzer = async () => {};
let tensorLeinwand: OffscreenCanvas | null = null;
let tensorKontext: OffscreenCanvasRenderingContext2D | null = null;

export function setzeRefererSetzer(f: RefererSetzer): void {
  refererSetzer = f;
}

export function istBereit(): boolean {
  return session !== null;
}

// YuNet laden (einmal, Mehrfachaufrufe teilen sich den Lauf). Liefert null, wenn es nicht geht: kein Fehler fuer die Seite.
function ladeGesicht(): Promise<YunetSitzung | null> {
  if (gesichtSitzung) return Promise.resolve(gesichtSitzung);
  if (jetzt() < gesichtFehlerBis) return Promise.resolve(null);
  if (!gesichtLadeVersprechen) {
    // Sitzung bauen und Warmlauf laufen in der gemeinsamen Reihe, nie gleichzeitig mit einer anderen Inferenz.
    gesichtLadeVersprechen = ladeYunetSitzung((arbeit) => inReihe(arbeit).then((r) => r.wert))
      .then((neu) => {
        gesichtSitzung = neu;
        return neu;
      })
      .catch((e: unknown) => {
        gesichtFehlerBis = jetzt() + LADE_PAUSE_MS;
        console.warn('Erkenner: YuNet nicht ladbar, es gilt der Weg ohne Gesichtsmodell', e);
        return null;
      })
      .finally(() => {
        gesichtLadeVersprechen = null;
      });
  }
  return gesichtLadeVersprechen;
}

// Mindestens eine Gesichtszone an: dann braucht die Pruefung YuNet.
function brauchtGesicht(zonen: Einstellungen['zonen']): boolean {
  return zonen.eyes.an || zonen.mouth.an || zonen.face.an || zonen.head.an;
}

// Modell und Session aufbauen und mit einem Leerbild warmlaufen lassen. Mehrfachaufrufe teilen sich den Lauf.
export function ladeModell(): Promise<void> {
  if (session) return Promise.resolve();
  // Nach einem Fehlschlag nicht jede Anfrage das 12-MB-Modell neu laden lassen: kurz merken und sofort ablehnen.
  if (ladeFehler && jetzt() < ladeFehler.bis) return Promise.reject(ladeFehler.fehler);
  if (!ladeVersprechen) {
    ladeVersprechen = (async () => {
      const t0 = jetzt();
      ort.env.wasm.wasmPaths = browser.runtime.getURL('/ort/ort-wasm-simd-threaded.wasm').replace(/[^/]*$/, '');
      ort.env.wasm.numThreads = 1;
      ort.env.wasm.proxy = false;
      const antwort = await fetch(browser.runtime.getURL('/modelle/320n.onnx'));
      if (!antwort.ok) throw new Error(`Modell nicht ladbar: HTTP ${antwort.status}`);
      const bytes = new Uint8Array(await antwort.arrayBuffer());
      const neu = await ort.InferenceSession.create(bytes, { executionProviders: ['wasm'], graphOptimizationLevel: 'all' });
      let eingabe: string | undefined;
      let ausgabe: string | undefined;
      try {
        eingabe = neu.inputNames[0];
        ausgabe = neu.outputNames[0];
        if (!eingabe || !ausgabe) throw new Error('Modell ohne Ein- oder Ausgabe');
        const S = MODELL_GROESSE;
        await neu.run({ [eingabe]: new ort.Tensor('float32', new Float32Array(3 * S * S), [1, 3, S, S]) });
        tensorLeinwand = new OffscreenCanvas(S, S);
        tensorKontext = tensorLeinwand.getContext('2d', { willReadFrequently: true });
      } catch (e) {
        // Scheitert etwas nach dem Bauen, die Sitzung nicht liegen lassen.
        await neu.release().catch(() => {});
        throw e;
      }
      eingabeName = eingabe;
      ausgabeName = ausgabe;
      session = neu;
      ladeFehler = null;
      kaltstartMs = Math.round(jetzt() - t0);
      // Erst jetzt, damit der Start von 320n nicht langsamer wird.
      void ladeGesicht();
    })()
      .catch((e: unknown) => {
        ladeFehler = { fehler: e, bis: jetzt() + LADE_PAUSE_MS };
        throw e;
      })
      .finally(() => {
        ladeVersprechen = null;
      });
  }
  return ladeVersprechen;
}

export function status(): AntwortErkennerStatus {
  return {
    ok: true,
    bereit: istBereit(),
    modell: '320n',
    kaltstartMs,
    gesichtBereit: gesichtSitzung !== null,
    gesichtKaltstartMs: gesichtSitzung ? gesichtSitzung.kaltstartMs : null,
    gesichtLaeufe,
    laeufe,
    warteschlange: wartend + schranke.wartend,
  };
}

// Bild auf 320 x 320 bringen (Seitenverhaeltnis bleibt, rechts und unten schwarz) und als RGB-Tensor 0 bis 1 aufbauen.
function baueTensor(quelle: CanvasImageSource, breite: number, hoehe: number): ort.Tensor {
  const S = MODELL_GROESSE;
  const kontext = tensorKontext;
  if (!kontext) throw new Error('Erkenner nicht bereit');
  // Verkleinerung aus Arbeitsbildern bis 1600 px: ohne gute Glaettung entsteht Aliasing.
  kontext.imageSmoothingEnabled = true;
  kontext.imageSmoothingQuality = 'high';
  const skala = S / Math.max(breite, hoehe);
  kontext.fillStyle = 'rgb(0,0,0)';
  kontext.fillRect(0, 0, S, S);
  kontext.drawImage(quelle, 0, 0, Math.max(1, Math.round(breite * skala)), Math.max(1, Math.round(hoehe * skala)));
  const px = kontext.getImageData(0, 0, S, S).data;
  const flaeche = S * S;
  const daten = new Float32Array(3 * flaeche);
  for (let p = 0; p < flaeche; p++) {
    daten[p] = (px[p * 4] ?? 0) / 255;
    daten[flaeche + p] = (px[p * 4 + 1] ?? 0) / 255;
    daten[2 * flaeche + p] = (px[p * 4 + 2] ?? 0) / 255;
  }
  return new ort.Tensor('float32', daten, [1, 3, S, S]);
}

// Laeufe aller Sessions nacheinander (eine gemeinsame Reihe); liefert Wartezeit, Rechenzeit und das Ergebnis.
function inReihe<T>(arbeit: () => Promise<T>): Promise<{ warteMs: number; rechenMs: number; wert: T }> {
  const t0 = jetzt();
  wartend++;
  const lauf = kette.then(async () => {
    const start = jetzt();
    const wert = await arbeit();
    return { warteMs: start - t0, rechenMs: jetzt() - start, wert };
  });
  kette = lauf.catch(() => {}).finally(() => {
    wartend--;
  });
  return lauf;
}

// Lauf von 320n; liefert Wartezeit und Rechenzeit getrennt.
async function nacheinander(tensor: ort.Tensor): Promise<{ warteMs: number; infMs: number; daten: Float32Array; dims: readonly number[] }> {
  const r = await inReihe(async () => {
    const aktuell = session;
    if (!aktuell) throw new Error('Erkenner nicht bereit');
    const aus = await aktuell.run({ [eingabeName]: tensor });
    const roh = aus[ausgabeName];
    if (!roh) throw new Error('Modell lieferte keine Ausgabe');
    laeufe++;
    return { daten: roh.data as Float32Array, dims: roh.dims };
  });
  return { warteMs: r.warteMs, infMs: r.rechenMs, daten: r.wert.daten, dims: r.wert.dims };
}

// Gesichter mit YuNet, wenn eine Gesichtszone an ist. `gesichter` ist null, wenn das Modell fehlt oder der Lauf scheitert
// (dann gelten allein die Baender). Die Wartezeit auf das Laden zaehlt auch dann, wenn das Laden scheitert.
async function sucheGesichter(
  zonen: Einstellungen['zonen'],
  quelle: CanvasImageSource,
  breite: number,
  hoehe: number,
): Promise<{ gesichter: YunetGesicht[] | null; ms: number; warteMs: number } | null> {
  if (!brauchtGesicht(zonen)) return null;
  // Ist YuNet noch im Laden, wartet die Pruefung darauf; diese Zeit gehoert zur Wartezeit.
  const tLade = jetzt();
  const sitzung = await ladeGesicht();
  const ladeWarteMs = jetzt() - tLade;
  if (!sitzung) return { gesichter: null, ms: 0, warteMs: ladeWarteMs };
  let warteMs = ladeWarteMs;
  try {
    const t0 = jetzt();
    const tensor = yunetVorverarbeitung(sitzung, quelle, breite, hoehe);
    const vorMs = jetzt() - t0;
    const r = await inReihe(async () => {
      // Gezaehlt werden Versuche, auch wenn der Lauf scheitert.
      gesichtLaeufe++;
      return yunetLauf(sitzung, tensor, breite, hoehe);
    });
    warteMs += r.warteMs;
    return { gesichter: r.wert, ms: vorMs + r.rechenMs, warteMs };
  } catch (err) {
    console.warn('Erkenner: YuNet-Lauf fehlgeschlagen, es gilt der Weg ohne Gesichtsmodell', err);
    return { gesichter: null, ms: 0, warteMs };
  }
}

// Arbeitsbild: Original auf hoechstens MAX_SEITE begrenzt (OffscreenCanvas bei Verkleinerung, sonst die Bitmap selbst).
function arbeitsbild(bitmap: ImageBitmap): { quelle: CanvasImageSource; breite: number; hoehe: number } {
  const groesste = Math.max(bitmap.width, bitmap.height);
  if (groesste <= MAX_SEITE) return { quelle: bitmap, breite: bitmap.width, hoehe: bitmap.height };
  const f = MAX_SEITE / groesste;
  const breite = Math.max(1, Math.round(bitmap.width * f));
  const hoehe = Math.max(1, Math.round(bitmap.height * f));
  const leinwand = new OffscreenCanvas(breite, hoehe);
  const ctx = leinwand.getContext('2d');
  if (!ctx) throw new Error('kein 2D-Kontext');
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(bitmap, 0, 0, breite, hoehe);
  return { quelle: leinwand, breite, hoehe };
}

function fehlerAntwort(id: string, fehler: string, status?: number): AntwortPruefe {
  return status === undefined ? { ok: false, id, fehler } : { ok: false, id, fehler, status };
}

// Eine Pruefung auf einem der freien Plaetze; die Wartezeit davor fliesst in `ms.warte` ein.
export async function pruefe(n: NachrichtErkennerPruefe, herkunft?: string): Promise<AntwortPruefe> {
  const vorSchranke = jetzt();
  const abgeben = await schranke.betrete();
  try {
    return await pruefeAufPlatz(n, jetzt() - vorSchranke, herkunft);
  } finally {
    abgeben();
  }
}

async function pruefeAufPlatz(n: NachrichtErkennerPruefe, schrankeMs: number, herkunft?: string): Promise<AntwortPruefe> {
  const id = typeof n.id === 'string' ? n.id : '';
  const t0 = jetzt();
  const kalt = session === null;
  const q = n.quelle;
  if (!q || (q.art !== 'daten' && q.art !== 'url')) return fehlerAntwort(id, 'unbekannte Quelle');
  const e = vervollstaendige(n.einstellungen);

  try {
    await ladeModell();
  } catch (err) {
    return fehlerAntwort(id, `Modell: ${err instanceof Error ? err.message : String(err)}`);
  }

  // Bild beschaffen und dekodieren.
  let blob: Blob;
  try {
    if (q.art === 'url') {
      // herkunft: Entscheidung der Netzgrenze aus dem Absender (index.ts); fehlt sie, zaehlt der Referer.
      const geholt = await ladeNach(q.url, q.referer ?? '', refererSetzer, undefined, { herkunft });
      if (!geholt.ok) return fehlerAntwort(id, geholt.fehler, geholt.status);
      blob = geholt.blob;
    } else {
      blob = await blobAusDataUrl(q.dataUrl);
    }
  } catch (err) {
    return fehlerAntwort(id, `Quelle: ${err instanceof Error ? err.message : String(err)}`);
  }
  const tNetz = jetzt();
  let bitmap: ImageBitmap;
  let bewegtesSvg = false;
  try {
    bewegtesSvg = await svgMitBewegung(blob);
    bitmap = bewegtesSvg ? ersatzBildFuerBewegtesSvg({ breite: n.breite, hoehe: n.hoehe }) : await dekodiereBild(blob, { breite: n.breite, hoehe: n.hoehe });
  } catch (err) {
    return fehlerAntwort(id, `Dekodieren: ${err instanceof Error ? err.message : String(err)}`);
  }

  try {
    const arbeit = arbeitsbild(bitmap);
    const tDekod = jetzt();
    const tensor = baueTensor(arbeit.quelle, arbeit.breite, arbeit.hoehe);
    const tVor = jetzt();
    const lauf = await nacheinander(tensor);
    const tInf = jetzt();
    const rohTreffer: Treffer[] = nachverarbeite(lauf.daten, lauf.dims, geometrieFuer(arbeit.breite, arbeit.hoehe), e.schwelle);
    const tRoh = jetzt();
    const gesicht = await sucheGesichter(e.zonen, arbeit.quelle, arbeit.breite, arbeit.hoehe);
    const tNachStart = jetzt();
    const alle = gesicht?.gesichter ? kombiniereGesichter(rohTreffer, gesicht.gesichter, arbeit.breite, arbeit.hoehe) : rohTreffer;
    // Steigerung Stufe 4: ein Treffer einer Frau verdeckt das ganze Bild (eine Flaeche ueber alles), sonst die Zonen wie eingestellt.
    // Aus den rohen 320n-Treffern: kombiniereGesichter ersetzt ein FACE_FEMALE durch die (geschlechtslosen) YuNet-Treffer.
    const frau = n.einstellungen?.ganzVerdecken === true ? rohTreffer.find((t) => t.weiblich) : undefined;
    // Animiertes SVG (Fund 9): nie freigeben, ganzes Bild verdecken.
    const flaechen = bewegtesSvg
      ? [{ zone: 'face' as const, box: [0, 0, arbeit.breite, arbeit.hoehe] as [number, number, number, number] }]
      : frau
      ? [{ zone: frau.zone, box: [0, 0, arbeit.breite, arbeit.hoehe] as [number, number, number, number] }]
      : berechneFlaechen(alle, e, arbeit.breite, arbeit.hoehe);
    const tNach = jetzt();
    let bild: string | undefined;
    if (n.rendern && flaechen.length > 0) {
      // Mia-Patch nur mit Patch-Bildern aus dem Pack; ohne Pack oder ohne Bilder wird es Mosaik.
      const stand = n.einstellungen?.packStand;
      const patches = e.stil === 'mia-patch' ? await patchesFuer(bildKennung(n), flaechen, typeof stand === 'number' ? stand : undefined) : null;
      try {
        bild = await rendereZensur(arbeit.quelle, arbeit.breite, arbeit.hoehe, flaechen, e.stil, patches?.bilder);
      } finally {
        patches?.freigeben();
      }
    }
    const tRender = jetzt();
    const ms: ZeitenPruefung = {
      netz: runde(tNetz - t0),
      dekod: runde(tDekod - tNetz),
      vor: runde(tVor - tDekod),
      warte: runde(schrankeMs + lauf.warteMs + (gesicht?.warteMs ?? 0)),
      inf: runde(lauf.infMs),
      nach: runde(tRoh - tInf + (tNach - tNachStart)),
      render: runde(tRender - tNach),
      gesamt: runde(tRender - t0),
      ...(gesicht?.gesichter ? { gesicht: runde(gesicht.ms) } : {}),
    };
    const treffer = alle;
    return bild === undefined
      ? { ok: true, id, breite: arbeit.breite, hoehe: arbeit.hoehe, treffer, flaechen, ms, kalt }
      : { ok: true, id, breite: arbeit.breite, hoehe: arbeit.hoehe, treffer, flaechen, bild, ms, kalt };
  } catch (err) {
    return fehlerAntwort(id, `Pruefen: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    bitmap.close();
  }
}
