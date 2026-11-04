// Pruefung eines Bildes: Pixel lesen (Canvas-Weg), Erkenner wecken, Anfrage senden, Zwischenspeicher.
// Nachrichten exakt nach src/nachrichten.ts.

import type { Einstellungen } from '../einstellungen';
import type { AntwortPruefe, AntwortPruefeOk, NachrichtErkennerPruefe, Quelle } from '../nachrichten';
import type { WirksameZonen } from '../steigerung';

// Steigerung der Zensur (Auftrag S): der Schleier setzt hier, welche Zonen der Erkenner bei der aktuellen Stufe bekommt (null = die
// eingestellten). So bleiben alle Aufrufe von sendePruefe unveraendert.
let zonenAnpassung: ((e: Einstellungen) => WirksameZonen | null) | null = null;
export function setzeZonenAnpassung(fn: ((e: Einstellungen) => WirksameZonen | null) | null): void {
  zonenAnpassung = fn;
}
import {
  ANTWORT_MAX_MS,
  JPEG_QUALITAET,
  LAENGSTE_SEITE,
  WECKEN_MAX_MS,
  WECKEN_TAKT_MS,
  ZWISCHENSPEICHER_BYTES,
  ZWISCHENSPEICHER_MAX,
} from './konstanten';

const warte = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// ---------- Wecken mit Wiederholung ----------

let weckVersprechen: Promise<boolean> | null = null;

// Weckt Hintergrund und Erkenner. Ein frisch erzeugtes Offscreen-Dokument hoert erst nach dem Laden zu:
// alle 100 ms wiederholen, hoechstens 20 s. Das Ergebnis gilt, solange der Erkenner antwortet: bei Misserfolg und nach einer
// Anfrage ohne Antwort (Erkenner inzwischen gestorben) wird beim naechsten Aufruf neu geweckt.
export function wecke(lebt: () => boolean): Promise<boolean> {
  if (weckVersprechen) return weckVersprechen;
  const lauf = (async () => {
    const t0 = performance.now();
    while (lebt() && performance.now() - t0 < WECKEN_MAX_MS) {
      try {
        await browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'wecke' });
        const antwort = (await browser.runtime.sendMessage({ ziel: 'erkenner', typ: 'wecke' })) as { ok?: boolean } | undefined;
        if (antwort?.ok) return true;
      } catch {
        // Empfaenger noch nicht bereit: weiter versuchen
      }
      await warte(WECKEN_TAKT_MS);
    }
    return false;
  })();
  weckVersprechen = lauf;
  void lauf.then((ok) => {
    if (!ok && weckVersprechen === lauf) weckVersprechen = null;
  });
  return lauf;
}

// Der Erkenner hat nicht geantwortet (Empfaenger weg): beim naechsten Aufruf neu wecken.
export function vergissWecken(): void {
  weckVersprechen = null;
}

// ---------- Pixel lesen (Canvas-Weg) ----------

// Darf das Content-Script die Pixel dieser Quelle selbst lesen? Chrome: ja, die Leinwand des Content-Scripts folgt den Regeln der Seite
// (fremde Bilder ohne CORS verschmutzen sie). Firefox laesst Content-Scripts mit Host-Rechten aber auch fremde Pixel lesen, auch von
// Weiterleitungen ins Heimnetz oder von Bildern, die mit Anmeldedaten geladen wurden; ueber das zensierte Bild kaeme das in die Seite.
// Das Attribut crossorigin hilft nicht als Merkmal: es sagt nur, wie das Element jetzt geladen WUERDE, nicht wie der angezeigte Inhalt
// geladen wurde (die Seite kann es nach dem Laden setzen, ein img zeigt dann weiter das alte Bild, ein video laedt nichts neu).
// Darum liest Firefox Pixel nur bei data: und blob:. Alles mit http(s) (Bilder, Hintergruende) geht den Url-Weg: der Erkenner laedt ohne
// Anmeldedaten und prueft die Endadresse. Videos mit http(s)-Quelle, mit srcObject (MediaStream) oder ohne Adresse werden in Firefox
// ohne Pruefung verdeckt.
export function pixelLesenErlaubt(url: string): boolean {
  if (!import.meta.env.FIREFOX) return true;
  return /^(data|blob):/i.test(url);
}

// Zeichnet die Quelle auf ein Canvas (laengste Seite hoechstens `laengsteSeite`, Standard 1280), prueft die Lesbarkeit mit getImageData(0, 0, 1, 1)
// und liefert ein JPEG als Data-URL. null = nicht lesbar (Canvas verschmutzt) oder keine Pixel.
export function lesePixel(
  quelle: CanvasImageSource,
  breite: number,
  hoehe: number,
  laengsteSeite: number = LAENGSTE_SEITE,
): { dataUrl: string; breite: number; hoehe: number } | null {
  if (!(breite > 0) || !(hoehe > 0)) return null;
  const skala = Math.min(1, laengsteSeite / Math.max(breite, hoehe));
  const b = Math.max(1, Math.round(breite * skala));
  const h = Math.max(1, Math.round(hoehe * skala));
  try {
    const flaeche = document.createElement('canvas');
    flaeche.width = b;
    flaeche.height = h;
    const ctx = flaeche.getContext('2d');
    if (!ctx) return null;
    // JPEG kennt keine Transparenz: auf Weiss zeichnen statt auf Schwarz.
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, b, h);
    ctx.drawImage(quelle, 0, 0, b, h);
    ctx.getImageData(0, 0, 1, 1); // Lesbarkeitsprobe: wirft bei verschmutztem Canvas
    return { dataUrl: flaeche.toDataURL('image/jpeg', JPEG_QUALITAET), breite: b, hoehe: h };
  } catch {
    return null;
  }
}

// ---------- Anfrage ----------

let zaehler = 0;
const idPraefix = Math.random().toString(36).slice(2, 8);

export async function sendePruefe(
  quelle: Quelle,
  breite: number,
  hoehe: number,
  e: Einstellungen,
  rendern: boolean,
  packStand?: number,
): Promise<AntwortPruefe> {
  const id = `${idPraefix}-${++zaehler}`;
  const angepasst = zonenAnpassung?.(e) ?? null;
  const nachricht: NachrichtErkennerPruefe = {
    ziel: 'erkenner',
    typ: 'pruefe',
    id,
    quelle,
    breite,
    hoehe,
    einstellungen: {
      schwelle: e.schwelle,
      zonen: angepasst?.zonen ?? e.zonen,
      rand: e.rand,
      stil: e.stil,
      ...(packStand === undefined ? {} : { packStand }),
      ...(angepasst?.ganzVerdecken ? { ganzVerdecken: true } : {}),
    },
    rendern,
  };
  // Zeitgrenze: ein haengender Erkenner (oder ein haengender Bildserver beim Nachladen) darf das Element nicht ewig offen halten.
  // Nach Ablauf gilt die Anfrage als Fehler; die Antwort, die vielleicht spaeter noch kommt, wird verworfen.
  let uhr: ReturnType<typeof setTimeout> | undefined;
  const zeitgrenze = new Promise<'zeit'>((fertig) => {
    uhr = setTimeout(() => fertig('zeit'), ANTWORT_MAX_MS);
  });
  try {
    const antwort = (await Promise.race([browser.runtime.sendMessage(nachricht) as Promise<AntwortPruefe | undefined>, zeitgrenze])) as
      | AntwortPruefe
      | undefined
      | 'zeit';
    if (antwort === 'zeit') {
      vergissWecken();
      return { ok: false, id, fehler: 'Zeitgrenze' };
    }
    if (antwort && typeof antwort === 'object' && 'ok' in antwort) return antwort;
    vergissWecken();
    return { ok: false, id, fehler: 'keine Antwort' };
  } catch (fehler) {
    vergissWecken();
    return { ok: false, id, fehler: String((fehler as Error)?.message ?? fehler) };
  } finally {
    clearTimeout(uhr);
  }
}

// Herkunft der Seite fuer das Nachladen durch den Erkenner (Netzgrenze: oeffentlich nach privat gesperrt) und Referer-Wert.
// Sie kommt allein vom Ursprung des Dokuments (window.origin: auch in about:blank-, blob:- und srcdoc-Frames der echte, geerbte Ursprung),
// NIE aus document.baseURI: die Seite bestimmt <base href> selbst und koennte sich sonst als Seite im Heimnetz ausgeben.
// Ist der Ursprung undurchsichtig (data:, sandbox ohne allow-same-origin), kommt "null" statt einer leeren Zeichenkette: der Erkenner
// behandelt das als oeffentliche Seite (private Ziele bleiben gesperrt, es wird kein Referer gesetzt). Eine leere Zeichenkette hiesse
// dort "kein Seitenbezug" und bleibt Absendern ohne Tab vorbehalten.
export function refererDerSeite(): string {
  try {
    const ursprung = window.origin || location.origin;
    return ursprung && ursprung !== 'null' && /^https?:\/\//i.test(ursprung) ? `${ursprung}/` : 'null';
  } catch {
    return 'null';
  }
}

// ---------- Zwischenspeicher: Schluessel -> Antwort (LRU, hoechstens 200 Eintraege und 20 MB Data-URLs) ----------

export class Zwischenspeicher {
  // Map haelt die Einfuegereihenfolge: vorn der am laengsten ungenutzte Eintrag.
  private readonly karte = new Map<string, AntwortPruefeOk>();
  private readonly unterwegs = new Map<string, Promise<AntwortPruefe | null>>();
  private bytes = 0;

  private static groesse(antwort: AntwortPruefeOk): number {
    return (antwort.bild?.length ?? 0) + 512;
  }

  // Ein Treffer rueckt den Eintrag ans Ende (zuletzt benutzt).
  hole(schluessel: string): AntwortPruefeOk | undefined {
    const antwort = this.karte.get(schluessel);
    if (antwort) {
      this.karte.delete(schluessel);
      this.karte.set(schluessel, antwort);
    }
    return antwort;
  }

  lege(schluessel: string, antwort: AntwortPruefeOk): void {
    const alt = this.karte.get(schluessel);
    if (alt) this.bytes -= Zwischenspeicher.groesse(alt);
    this.karte.delete(schluessel);
    this.karte.set(schluessel, antwort);
    this.bytes += Zwischenspeicher.groesse(antwort);
    while (this.karte.size > 1 && (this.karte.size > ZWISCHENSPEICHER_MAX || this.bytes > ZWISCHENSPEICHER_BYTES)) {
      const aeltester = this.karte.keys().next().value;
      if (aeltester === undefined) break;
      this.bytes -= Zwischenspeicher.groesse(this.karte.get(aeltester)!);
      this.karte.delete(aeltester);
    }
  }

  // Gleiche Anfrage nur einmal gleichzeitig; weitere Aufrufer haengen sich an dieselbe Anfrage.
  einmal(schluessel: string, start: () => Promise<AntwortPruefe | null>): Promise<AntwortPruefe | null> {
    const laeuft = this.unterwegs.get(schluessel);
    if (laeuft) return laeuft;
    const p = start().finally(() => {
      if (this.unterwegs.get(schluessel) === p) this.unterwegs.delete(schluessel);
    });
    this.unterwegs.set(schluessel, p);
    return p;
  }

  leere(): void {
    this.karte.clear();
    this.unterwegs.clear();
    this.bytes = 0;
  }
}

// ---------- Hintergrund-Ebenen ----------

// Teilt einen background-image-Wert an Kommas auf oberster Ebene (Klammern und Anfuehrungszeichen beachten).
export function zerlegeEbenen(wert: string): string[] {
  const ebenen: string[] = [];
  let tiefe = 0;
  let anf = '';
  let start = 0;
  for (let i = 0; i < wert.length; i++) {
    const z = wert[i];
    if (anf) {
      if (z === '\\') i++;
      else if (z === anf) anf = '';
    } else if (z === '"' || z === "'") anf = z;
    else if (z === '(') tiefe++;
    else if (z === ')') tiefe = Math.max(0, tiefe - 1);
    else if (z === ',' && tiefe === 0) {
      ebenen.push(wert.slice(start, i).trim());
      start = i + 1;
    }
  }
  const rest = wert.slice(start).trim();
  if (rest) ebenen.push(rest);
  return ebenen;
}

// Adresse aus einer Ebene der Form url(...), aufgeloest gegen die Basisadresse. null = keine url-Ebene.
export function urlAusEbene(ebene: string): string | null {
  const treffer = /^url\(\s*(?:"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'|([^)]*?))\s*\)$/i.exec(ebene.trim());
  if (!treffer) return null;
  const roh = (treffer[1] ?? treffer[2] ?? treffer[3] ?? '').replace(/\\(.)/g, '$1');
  if (!roh) return null;
  try {
    return new URL(roh, document.baseURI).href;
  } catch {
    return null;
  }
}
