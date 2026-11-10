// Phase 8b: Schriften fuer Shadow Roots in fremden Seiten. `@font-face` greift in Shadow Roots nicht; darum holt das Content-Script die
// Dateien einmal je Seite ueber den Hintergrund (Base64, Vertrag NachrichtHintergrundSchrift) und registriert sie per `FontFace` aus einem
// ArrayBuffer in `document.fonts` unter den eigenen Familien (`VEIL Rounded <zufall>`, `VEIL Text <zufall>`, siehe familie.ts). Kein Netz, keine CSP der Seite betroffen.
// Scheitert etwas, bleibt die Systemschrift (Rueckfall in --v-schrift-*), nie ein Fehler fuer den Aufrufer.
import type { AntwortSchrift, NachrichtHintergrundSchrift } from '../../nachrichten';
import { SCHRIFTEN } from './werte';
import { seitenFamilie } from './familie';
import { SchriftVersuche } from './schrift-versuche';

// Lesung S2/R Nr. 4: in fremden Seiten nur drei Schnitte (statt sechs, etwa 55 statt 111 KB je Rahmen); 600 und 700 nimmt der Browser vom
// naechsten vorhandenen Schnitt (800).
const SEITEN_SCHNITTE = SCHRIFTEN.filter((s) => s.datei === 'schrift/rounded-800.woff2' || s.datei === 'schrift/text-400.woff2' || s.datei === 'schrift/text-800.woff2');

let laden: Promise<boolean> | null = null;
// Ein Fehlschlag wird nicht fuer immer gemerkt: begrenzte Wiederholung (schrift-versuche.ts), schon geladene Schnitte bleiben und werden nicht doppelt angelegt.
let gescheitert = false;
const versuche = new SchriftVersuche();
const geladen = new Set<string>();

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
  if (geladen.has(s.datei)) return true;
  const ff = new FontFace(seitenFamilie(s.familie), puffer(a.base64), { weight: s.gewicht, style: 'normal', display: 'swap' });
  await ff.load();
  document.fonts.add(ff);
  geladen.add(s.datei);
  return true;
}

/** Darf ein neuer Ladeversuch starten (nach einem Fehlschlag erst nach der Pause, nach dem dritten Wiederholen nie mehr)? */
export function schriftVersuchMoeglich(): boolean {
  return !laden || (gescheitert && versuche.darfVersuchen(performance.now()));
}

/** Laedt die Schriften je Dokument; liefert true, wenn alle registriert sind. Mehrfache Aufrufe teilen sich einen Lauf; ein Fehlschlag wird begrenzt wiederholt. */
export function ladeSeitenSchriften(): Promise<boolean> {
  if (!laden || (gescheitert && versuche.darfVersuchen(performance.now()))) {
    gescheitert = false;
    laden = (async () => {
      let ok = false;
      try {
        if (typeof FontFace === 'function' && document.fonts) {
          const ergebnisse = await Promise.all(SEITEN_SCHNITTE.map((s) => ladeEine(s).catch(() => false)));
          ok = ergebnisse.every(Boolean);
        }
      } catch {
        ok = false;
      }
      if (ok) versuche.meldeOk();
      else {
        gescheitert = true;
        versuche.meldeFehl(performance.now());
      }
      return ok;
    })();
  }
  return laden;
}
