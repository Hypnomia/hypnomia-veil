// Hintergrund: Klaenge aus dem Pack (Auftrag T, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 7). Antwortet auf `packton { name }` mit dem Klang
// der Rolle `ton` als Data-URL, aber nur mit Freischaltung `ton`; ohne Pack, ohne Freischaltung, ohne diesen Klang, bei einer Datei ueber dem
// Limit, einer kaputten Datei oder einem Fehler lautet die Antwort `dataUrl: null` (nie ein Fehler). Die Datei liest der Hintergrund aus
// IndexedDB (src/pack/db.ts); das Content-Script hat dort keinen Zugriff. Kein Netz.
import type { AntwortPackTon, NachrichtHintergrundPackTon } from '../nachrichten';
import { leseDatei, leseMeta } from '../pack/db';
import { MAX_TON_BYTES, tonNameAusDatei } from '../pack/format';
import { TON_NAMEN, type TonName } from '../ton/vertrag';

// Zwischenspeicher je Importzeitpunkt (der Service Worker darf jederzeit enden; dann liest der naechste Aufruf neu).
let zwischen: { schluessel: string; klaenge: Map<TonName, string | null> } | null = null;

function alsBase64(bytes: Uint8Array): string {
  let text = '';
  const block = 0x8000;
  for (let i = 0; i < bytes.length; i += block) text += String.fromCharCode(...bytes.subarray(i, i + block));
  return btoa(text);
}

async function lade(name: TonName): Promise<string | null> {
  const meta = await leseMeta();
  if (!meta || !Array.isArray(meta.freischaltungen) || !meta.freischaltungen.includes('ton')) return null;
  const schluessel = `${meta.id}:${meta.importiert}`;
  if (zwischen?.schluessel !== schluessel) zwischen = { schluessel, klaenge: new Map() };
  if (zwischen.klaenge.has(name)) return zwischen.klaenge.get(name) ?? null;
  let ergebnis: string | null = null;
  try {
    const eintrag = meta.dateien.find((d) => d.rolle === 'ton' && tonNameAusDatei(d.name) === name);
    const datei = eintrag ? await leseDatei(eintrag.name) : null;
    if (datei && datei.blob.size > 0 && datei.blob.size <= MAX_TON_BYTES) {
      ergebnis = `data:${datei.typ};base64,${alsBase64(new Uint8Array(await datei.blob.arrayBuffer()))}`;
    }
  } catch {
    // Voruebergehender Lesefehler: nichts zwischenspeichern, der naechste Aufruf liest neu.
    return null;
  }
  zwischen.klaenge.set(name, ergebnis);
  return ergebnis;
}

export async function bearbeitePackTon(n: NachrichtHintergrundPackTon): Promise<AntwortPackTon> {
  if (!(TON_NAMEN as readonly string[]).includes(n.name)) return { ok: true, dataUrl: null };
  try {
    return { ok: true, dataUrl: await lade(n.name) };
  } catch {
    return { ok: true, dataUrl: null };
  }
}
