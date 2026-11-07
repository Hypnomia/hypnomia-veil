// Phase 8b: Schriften fuer Shadow Roots in fremden Seiten. `@font-face` greift in Shadow Roots nicht; darum holt das Content-Script die
// Dateien einmal je Seite ueber den Hintergrund (Base64, Vertrag NachrichtHintergrundSchrift) und registriert sie per `FontFace` aus einem
// ArrayBuffer in `document.fonts` unter den eigenen Familien (`VEIL Rounded <zufall>`, `VEIL Text <zufall>`, siehe familie.ts). Kein Netz, keine CSP der Seite betroffen.
// Scheitert etwas, bleibt die Systemschrift (Rueckfall in --v-schrift-*), nie ein Fehler fuer den Aufrufer.
import type { AntwortSchrift, NachrichtHintergrundSchrift } from '../../nachrichten';
import { SCHRIFTEN } from './werte';
import { seitenFamilie } from './familie';

// Lesung S2/R Nr. 4: in fremden Seiten nur drei Schnitte (statt sechs, etwa 55 statt 111 KB je Rahmen); 600 und 700 nimmt der Browser vom
// naechsten vorhandenen Schnitt (800).
const SEITEN_SCHNITTE = SCHRIFTEN.filter((s) => s.datei === 'schrift/rounded-800.woff2' || s.datei === 'schrift/text-400.woff2' || s.datei === 'schrift/text-800.woff2');

let laden: Promise<boolean> | null = null;

function puffer(b64: string): ArrayBuffer {
  const text = atob(b64);
  const bytes = new Uint8Array(text.length);
  for (let i = 0; i < text.length; i++) bytes[i] = text.charCodeAt(i);
  return bytes.buffer;
}

async function ladeEine(s: (typeof SCHRIFTEN)[number]): Promise<boolean> {
  const n: NachrichtHintergrundSchrift = { ziel: 'hintergrund', typ: 'schrift', datei: s.datei };
  const a = (await browser.runtime.sendMessage(n)) as AntwortSchrift | undefined;
  if (!a || a.ok !== true || typeof a.base64 !== 'string') return false;
  const ff = new FontFace(seitenFamilie(s.familie), puffer(a.base64), { weight: s.gewicht, style: 'normal', display: 'swap' });
  await ff.load();
  document.fonts.add(ff);
  return true;
}

/** Laedt die Schriften einmal je Dokument; liefert true, wenn alle registriert sind. Mehrfache Aufrufe teilen sich einen Lauf. */
export function ladeSeitenSchriften(): Promise<boolean> {
  if (!laden) {
    laden = (async () => {
      try {
        if (typeof FontFace !== 'function' || !document.fonts) return false;
        const ergebnisse = await Promise.all(SEITEN_SCHNITTE.map((s) => ladeEine(s).catch(() => false)));
        return ergebnisse.every(Boolean);
      } catch {
        return false;
      }
    })();
  }
  return laden;
}
