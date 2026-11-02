// Erkenner: laedt das Modell 320n mit onnxruntime-web (WASM, 1 Thread), prueft Bilder nacheinander
// und liefert Treffer, zusammengefuehrte Flaechen und auf Wunsch das zensierte Bild.

import * as ort from 'onnxruntime-web/wasm';
import { vervollstaendige } from '../einstellungen';
import type {
  AntwortErkennerStatus,
  AntwortPruefe,
  NachrichtErkennerPruefe,
  Treffer,
  ZeitenPruefung,
} from '../nachrichten';
import { geometrieFuer, MODELL_GROESSE, nachverarbeite } from './modell';
import { blobAusDataUrl, ladeNach, type RefererSetzer } from './nachladen';
import { Schranke } from './schranke';
import { rendereZensur } from './stile';
import { berechneFlaechen } from './zonen';

// Laengste Seite des Arbeitsbildes: so gross wird gerendert und so beziehen sich Boxen und `breite`/`hoehe` der Antwort.
const MAX_SEITE = 1600;
// Gleichzeitig laufende Pruefungen (Laden, Dekodieren, Arbeitsbild, Rendern): mehr braucht es nicht, weil die Inferenz
// ohnehin einzeln laeuft, und mehr gleichzeitige grosse Bitmaps kosten nur Speicher.
const PARALLELE_PRUEFUNGEN = 2;
// So lange gilt ein fehlgeschlagenes Laden des Modells als Antwort, bevor ein neuer Versuch erlaubt ist.
const LADE_PAUSE_MS = 5000;

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
      const eingabe = neu.inputNames[0];
      const ausgabe = neu.outputNames[0];
      if (!eingabe || !ausgabe) throw new Error('Modell ohne Ein- oder Ausgabe');
      const S = MODELL_GROESSE;
      await neu.run({ [eingabe]: new ort.Tensor('float32', new Float32Array(3 * S * S), [1, 3, S, S]) });
      tensorLeinwand = new OffscreenCanvas(S, S);
      tensorKontext = tensorLeinwand.getContext('2d', { willReadFrequently: true });
      eingabeName = eingabe;
      ausgabeName = ausgabe;
      session = neu;
      ladeFehler = null;
      kaltstartMs = Math.round(jetzt() - t0);
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
  return { ok: true, bereit: istBereit(), modell: '320n', kaltstartMs, laeufe, warteschlange: wartend + schranke.wartend };
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

// Laeufe der Session nacheinander; liefert Wartezeit und Rechenzeit getrennt.
function nacheinander(tensor: ort.Tensor): Promise<{ warteMs: number; infMs: number; daten: Float32Array; dims: readonly number[] }> {
  const t0 = jetzt();
  wartend++;
  const lauf = kette.then(async () => {
    const start = jetzt();
    const aktuell = session;
    if (!aktuell) throw new Error('Erkenner nicht bereit');
    const aus = await aktuell.run({ [eingabeName]: tensor });
    const roh = aus[ausgabeName];
    if (!roh) throw new Error('Modell lieferte keine Ausgabe');
    laeufe++;
    return { warteMs: start - t0, infMs: jetzt() - start, daten: roh.data as Float32Array, dims: roh.dims };
  });
  kette = lauf.catch(() => {}).finally(() => {
    wartend--;
  });
  return lauf;
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
export async function pruefe(n: NachrichtErkennerPruefe): Promise<AntwortPruefe> {
  const vorSchranke = jetzt();
  const abgeben = await schranke.betrete();
  try {
    return await pruefeAufPlatz(n, jetzt() - vorSchranke);
  } finally {
    abgeben();
  }
}

async function pruefeAufPlatz(n: NachrichtErkennerPruefe, schrankeMs: number): Promise<AntwortPruefe> {
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
      const geholt = await ladeNach(q.url, q.referer ?? '', refererSetzer);
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
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
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
    const treffer: Treffer[] = nachverarbeite(lauf.daten, lauf.dims, geometrieFuer(arbeit.breite, arbeit.hoehe), e.schwelle);
    const flaechen = berechneFlaechen(treffer, e, arbeit.breite, arbeit.hoehe);
    const tNach = jetzt();
    let bild: string | undefined;
    if (n.rendern && flaechen.length > 0) {
      bild = await rendereZensur(arbeit.quelle, arbeit.breite, arbeit.hoehe, flaechen, e.stil);
    }
    const tRender = jetzt();
    const ms: ZeitenPruefung = {
      netz: runde(tNetz - t0),
      dekod: runde(tDekod - tNetz),
      vor: runde(tVor - tDekod),
      warte: runde(schrankeMs + lauf.warteMs),
      inf: runde(lauf.infMs),
      nach: runde(tNach - tInf),
      render: runde(tRender - tNach),
      gesamt: runde(tRender - t0),
    };
    return bild === undefined
      ? { ok: true, id, breite: arbeit.breite, hoehe: arbeit.hoehe, treffer, flaechen, ms, kalt }
      : { ok: true, id, breite: arbeit.breite, hoehe: arbeit.hoehe, treffer, flaechen, bild, ms, kalt };
  } catch (err) {
    return fehlerAntwort(id, `Pruefen: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    bitmap.close();
  }
}
