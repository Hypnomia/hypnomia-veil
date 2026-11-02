// Bild per Adresse nachladen (fetch ohne Anmeldedaten). Erst ohne Referer; bei 403 oder Netzfehler einmal
// den Referer fuer den Host setzen lassen und wiederholen. Kein anderer Netzverkehr.
// Jeder Abruf hat eine Zeitgrenze (Verbindung und Lesen zusammen) und eine Groessenobergrenze: ein haengender oder endloser
// Bildserver darf keinen Platz der Schranke im Erkenner auf Dauer belegen.

// Zeitgrenze je Abruf in Millisekunden (Verbindung bis zum letzten Byte).
export const NACHLADEN_MAX_MS = 9000;
// Groessenobergrenze je Bild in Bytes.
export const NACHLADEN_MAX_BYTES = 25 * 1024 * 1024;

export interface NachladenGrenzen {
  maxMs: number;
  maxBytes: number;
}
const STANDARD_GRENZEN: NachladenGrenzen = { maxMs: NACHLADEN_MAX_MS, maxBytes: NACHLADEN_MAX_BYTES };

export type RefererSetzer = (host: string, referer: string) => Promise<void>;

export interface Nachgeladen {
  ok: true;
  blob: Blob;
}
export interface NachladenFehler {
  ok: false;
  fehler: string;
  status?: number;
  // Zeitgrenze oder Groessenobergrenze: eine Wiederholung mit Referer brachte nichts.
  endgueltig?: boolean;
}

// Liest den Rumpf in Stuecken und bricht ab, sobald die Obergrenze ueberschritten ist.
async function leseBegrenzt(antwort: Response, maxBytes: number): Promise<Blob | 'zugross'> {
  const angekuendigt = Number(antwort.headers.get('content-length'));
  if (Number.isFinite(angekuendigt) && angekuendigt > maxBytes) {
    await antwort.body?.cancel().catch(() => {});
    return 'zugross';
  }
  const leser = antwort.body?.getReader();
  if (!leser) return antwort.blob();
  const stuecke: Uint8Array[] = [];
  let summe = 0;
  for (;;) {
    const { done, value } = await leser.read();
    if (done) break;
    summe += value.byteLength;
    if (summe > maxBytes) {
      await leser.cancel().catch(() => {});
      return 'zugross';
    }
    stuecke.push(value);
  }
  return new Blob(stuecke as BlobPart[], { type: antwort.headers.get('content-type') ?? '' });
}

async function einmal(url: string, grenzen: NachladenGrenzen): Promise<Nachgeladen | NachladenFehler> {
  const abbruch = new AbortController();
  let abgelaufen = false;
  const uhr = setTimeout(() => {
    abgelaufen = true;
    abbruch.abort();
  }, grenzen.maxMs);
  try {
    let antwort: Response;
    try {
      antwort = await fetch(url, { credentials: 'omit', cache: 'default', signal: abbruch.signal });
    } catch (e) {
      if (abgelaufen) return { ok: false, fehler: 'fetch: Zeitgrenze', endgueltig: true };
      return { ok: false, fehler: `fetch: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (!antwort.ok) return { ok: false, fehler: `HTTP ${antwort.status}`, status: antwort.status };
    try {
      const blob = await leseBegrenzt(antwort, grenzen.maxBytes);
      if (blob === 'zugross') return { ok: false, fehler: 'lesen: Bild zu gross', endgueltig: true };
      return { ok: true, blob };
    } catch (e) {
      if (abgelaufen) return { ok: false, fehler: 'lesen: Zeitgrenze', endgueltig: true };
      return { ok: false, fehler: `lesen: ${e instanceof Error ? e.message : String(e)}` };
    }
  } finally {
    clearTimeout(uhr);
  }
}

export async function ladeNach(
  url: string,
  referer: string,
  setzeReferer: RefererSetzer,
  grenzen: NachladenGrenzen = STANDARD_GRENZEN,
): Promise<Nachgeladen | NachladenFehler> {
  let ziel: URL;
  try {
    ziel = new URL(url);
  } catch {
    return { ok: false, fehler: 'ungueltige Adresse' };
  }
  if (ziel.protocol !== 'http:' && ziel.protocol !== 'https:') return { ok: false, fehler: 'nur http und https' };
  const erster = await einmal(url, grenzen);
  if (erster.ok) return erster;
  // Nur 403 und Netzfehler lohnen eine Wiederholung mit Referer (Zeitgrenze und zu grosse Bilder nicht).
  const lohntSich = !erster.endgueltig && (erster.status === 403 || erster.status === undefined);
  if (!lohntSich || !referer) return erster;
  try {
    await setzeReferer(ziel.host, referer);
  } catch (e) {
    return { ...erster, fehler: `${erster.fehler}; Referer: ${e instanceof Error ? e.message : String(e)}` };
  }
  return einmal(url, grenzen);
}

// Daten-Adresse (data:...) in einen Blob wandeln.
export async function blobAusDataUrl(dataUrl: string): Promise<Blob> {
  if (!dataUrl.startsWith('data:')) throw new Error('keine Daten-Adresse');
  const antwort = await fetch(dataUrl);
  return antwort.blob();
}
