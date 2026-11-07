// Phase 8b: Schriftdateien fuer Shadow Roots in fremden Seiten (Vertrag NachrichtHintergrundSchrift in src/nachrichten.ts).
// Liest nur Dateien aus der festen Liste SCHRIFTEN; Ergebnis je Datei im Speicher des Hintergrunds zwischengespeichert.
import type { AntwortSchrift, NachrichtHintergrundSchrift } from '../nachrichten';
import { SCHRIFTEN } from '../oberflaeche/design/werte';

const ERLAUBT = new Set<string>(SCHRIFTEN.map((s) => s.datei));
const cache = new Map<string, Promise<string | null>>();

function base64(puffer: ArrayBuffer): string {
  const bytes = new Uint8Array(puffer);
  let text = '';
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

export async function bearbeiteSchrift(n: NachrichtHintergrundSchrift): Promise<AntwortSchrift> {
  if (typeof n.datei !== 'string' || !ERLAUBT.has(n.datei)) return { ok: false };
  let p = cache.get(n.datei);
  if (!p) {
    p = fetch(browser.runtime.getURL('/') + n.datei)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then(base64)
      .catch(() => null);
    cache.set(n.datei, p);
    p.then((w) => {
      if (w === null) cache.delete(n.datei);
    });
  }
  const wert = await p;
  return wert === null ? { ok: false } : { ok: true, base64: wert };
}
