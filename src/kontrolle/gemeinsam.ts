// Gemeinsames fuer die Kontroll-Teile im Content-Script (Phase 5, Vertrag Session 9, vom Orchestrator geschrieben; Bauer W, B, L lesen nur).
// Bedingung "darf Mia hier", "tippt die Person gerade", "ist schon etwas anderes vor der Seite" und die Warnung vor Fotosensibilitaet.
import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import type { Einstellungen } from '../einstellungen';
import { istFreigeschaltet, type Freischaltung, type PackKurz } from '../pack/vertrag';
import { istLokalePause } from '../pause-lokal';
import { riegelOffen, WARNUNG_SCHLUESSEL } from '../riegel/riegel';
import { TIPP_NACHLAUF_MS, WARNUNG_SPIRALE_SCHLUESSEL } from './grenzen';

export { WARNUNG_SPIRALE_SCHLUESSEL };

// ---------- Ort ----------
export function istOberstesFenster(): boolean {
  try {
    return window.top === window;
  } catch {
    return false;
  }
}

// Adresse fuer die eigenen Ausnahmen (about:blank und srcdoc erben die Adresse des Erzeugers ueber baseURI; nur fuer den Abgleich mit der
// Ausnahmeliste, nie fuer Sicherheitsentscheidungen, SICHERHEITSGRENZEN Netzgrenze).
export function adresseFuerAusnahmen(): { hostname: string; pathname: string } {
  if (location.hostname) return location;
  try {
    return new URL(document.baseURI);
  } catch {
    return { hostname: '', pathname: '/' };
  }
}

// Grundbedingung jedes Kontroll-Teils: Pack mit Freischaltung, keine Pause (gespeichert oder lokal), keine eigene Ausnahme. Die
// Standard-Ausnahmeliste wirkt schon ueber das Manifest (das Content-Script laeuft dort nicht). Den eigenen Schalter prueft jeder Teil selbst.
export function kontrolleErlaubt(e: Einstellungen | null, pack: PackKurz | null, f: Freischaltung): boolean {
  if (!e || !istFreigeschaltet(pack, f)) return false;
  if (e.pause || istLokalePause(e)) return false;
  return !passtAusnahme(adresseFuerAusnahmen(), e.ausnahmen);
}

// Ruhig-Modus oder Wunsch des Systems nach weniger Bewegung.
export function ruhigGewuenscht(e: Einstellungen | null): boolean {
  if (e?.ruhig) return true;
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

// ---------- Nie beim Tippen ----------
let letzteTaste = -Infinity;
let wacheLaeuft = false;

// Einmal je Frame aufrufen (mehrfach ist harmlos): merkt sich die Zeit der letzten Taste (passiv, Erfassungsphase, kein Eingriff).
export function starteEingabeWache(): void {
  if (wacheLaeuft) return;
  wacheLaeuft = true;
  const merke = () => {
    letzteTaste = performance.now();
  };
  for (const typ of ['keydown', 'input', 'compositionstart'] as const) window.addEventListener(typ, merke, { capture: true, passive: true });
}

function tiefstesAktives(): Element | null {
  let el: Element | null = document.activeElement;
  for (let i = 0; i < 20 && el?.shadowRoot?.activeElement; i++) el = el.shadowRoot.activeElement;
  return el;
}

const TEXT_TYPEN = new Set(['', 'text', 'search', 'email', 'url', 'tel', 'password', 'number', 'date', 'time', 'datetime-local', 'month', 'week']);

function istEditierbar(el: Element | null): boolean {
  if (!el) return false;
  if (el instanceof HTMLTextAreaElement) return !el.readOnly && !el.disabled;
  if (el instanceof HTMLInputElement) return TEXT_TYPEN.has(el.type.toLowerCase()) && !el.readOnly && !el.disabled;
  if (el instanceof HTMLSelectElement) return true;
  // Fokus in einem Rahmen: was dort passiert, sieht diese Seite nicht, also gilt es als Eingabe.
  if (el instanceof HTMLIFrameElement || el instanceof HTMLFrameElement || el instanceof HTMLObjectElement || el instanceof HTMLEmbedElement) return true;
  return el instanceof HTMLElement && el.isContentEditable;
}

// Tippt die Person (Eingabefeld, Rahmen oder editierbarer Bereich hat den Fokus, oder eine Taste in den letzten 2 s)?
export function eingabeAktiv(jetzt: number = performance.now()): boolean {
  if (jetzt - letzteTaste < TIPP_NACHLAUF_MS) return true;
  try {
    return istEditierbar(tiefstesAktives());
  } catch {
    return true;
  }
}

// ---------- Belegt ----------
// Blitzwoerter und Spirale stehen nie gleichzeitig vor der Seite, und beide ruhen, solange der Quiz-Riegel steht.
export type KontrollTeil = 'blitz' | 'spirale';
const belegt = new Set<KontrollTeil>();

export function meldeBelegt(teil: KontrollTeil, an: boolean): void {
  if (an) belegt.add(teil);
  else belegt.delete(teil);
}

// Steht schon etwas vor der Seite (anderer Kontroll-Teil, Quiz-Riegel)?
export function andereVorDerSeite(teil: KontrollTeil): boolean {
  if (riegelOffen()) return true;
  for (const t of belegt) if (t !== teil) return true;
  return false;
}

// ---------- Warnung vor Fotosensibilitaet ----------
// Gesehen gilt die Warnung, wenn die Person sie im Quiz (WARNUNG_SCHLUESSEL), auf der Spirale oder in der Einstellungsseite bestaetigt hat.
export async function warnungGesehen(): Promise<boolean> {
  try {
    const a = await browser.storage.local.get([WARNUNG_SCHLUESSEL, WARNUNG_SPIRALE_SCHLUESSEL]);
    return a[WARNUNG_SCHLUESSEL] === true || a[WARNUNG_SPIRALE_SCHLUESSEL] === true;
  } catch {
    return false;
  }
}

export async function merkeWarnung(): Promise<void> {
  try {
    await browser.storage.local.set({ [WARNUNG_SPIRALE_SCHLUESSEL]: true });
  } catch {
    // ohne Speicher erscheint die Warnung beim naechsten Mal wieder
  }
}
