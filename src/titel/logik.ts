// Reine Logik fuer den Titel mit Mias Kommentar (Auftrag T): Kuerzen, stabile Satzwahl, Zusammenbau. Ohne Browser-Zugriff, damit Einheitstests
// sie unter Node aufrufen koennen.
import { fuelleSatz } from '../quiz/vertrag.ts';

// Laenge des Originaltitels im Satz (Zeichen, danach "…").
export const TITEL_MAX = 60;

// Leerraum zusammenziehen (wie `document.title` es tut) und auf etwa 60 Zeichen kuerzen. Zaehlt Zeichen, nicht UTF-16-Einheiten.
export function kuerzeTitel(roh: string, max: number = TITEL_MAX): string {
  const sauber = roh.replace(/\s+/g, ' ').trim();
  const zeichen = Array.from(sauber);
  if (zeichen.length <= max) return sauber;
  return zeichen.slice(0, max).join('').trimEnd() + '…';
}

// FNV-1a ueber den Text: gleicher Titel, gleicher Wert, in jedem Frame und nach jedem Neuaufbau der Seite.
export function hashText(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

// Satz zum Originaltitel. Die Wahl haengt nur vom bereinigten Schluessel (Standard: der Titel) und der Zahl der Saetze ab (stabil). Der
// Schluessel erlaubt, dass Text und Tooltip-Attribut desselben Titels denselben Satz bekommen. Ohne Saetze oder Titel: null.
export function titelMitKommentar(original: string, saetze: readonly string[] | undefined, schluessel?: string): string | null {
  if (!saetze || saetze.length === 0) return null;
  const sauber = original.replace(/\s+/g, ' ').trim();
  if (sauber === '') return null;
  const wahl = (schluessel ?? sauber).replace(/\s+/g, ' ').trim();
  const satz = saetze[hashText(wahl) % saetze.length]!;
  return fuelleSatz(satz, { title: kuerzeTitel(sauber) });
}

// Mindestlaenge einer von der Seite gekuerzten Fassung unseres Textes (ohne die Auslassungspunkte), damit sie als unser Text gilt.
export const MIN_KURZFASSUNG = 20;

// Ist der Text ein Ergebnis von uns? Nur, was wir selbst erzeugt haben (Gleichheit), oder eine von der Seite gekuerzte Fassung davon: der
// Anfang eines Ergebnisses, mindestens MIN_KURZFASSUNG Zeichen lang, ohne die Auslassungspunkte am Ende. Fremde Titel gelten nie als unser Text,
// auch wenn sie wie ein Satz anfangen oder enden.
export function istEigenerText(text: string, erzeugt: ReadonlySet<string> | undefined): boolean {
  if (!erzeugt || erzeugt.size === 0) return false;
  if (erzeugt.has(text)) return true;
  const kern = text.replace(/(\.{2,3}|…)\s*$/, '');
  if (kern === text || kern.length < MIN_KURZFASSUNG) return false;
  for (const e of erzeugt) if (e.startsWith(kern)) return true;
  return false;
}

// Elemente, durch die hindurch Text noch zum Titel gehoert (Betonung, Absaetze). Alles andere (span, i, Symbole, Laufzeit-Angaben) gehoert
// nicht dazu, solange der Titel auch direkt darunter steht.
export const TITEL_TAGS: ReadonlySet<string> = new Set(['B', 'EM', 'STRONG', 'U', 'MARK', 'FONT', 'SUB', 'SUP', 'S', 'SMALL', 'P', 'DIV']);
