// Spuren des Riegels fuer Tests (nur Testbau, nur auf 127.0.0.1 und localhost). Die Namen stehen nur hinter `TESTHAKEN`, damit der
// Release-Bau keine Spur enthaelt. Eigene Datei, damit riegel.ts und testhaken.ts sich nicht gegenseitig importieren.
import { TESTHAKEN } from '../schleier/konstanten';
import { testhakenAktiv } from '../schleier/status';

export const testRiegelAktiv = (): boolean => TESTHAKEN && testhakenAktiv();

export const HOST_MARKE: string = TESTHAKEN ? 'data-veil-riegel-host' : '';
const ABBILD: string = TESTHAKEN ? 'data-veil-riegel' : '';
const ERGEBNIS: string = TESTHAKEN ? 'data-veil-riegel-ergebnis' : '';

export function schreibeAbbild(daten: unknown): void {
  if (!testRiegelAktiv()) return;
  try {
    document.documentElement.setAttribute(ABBILD, JSON.stringify(daten));
  } catch {
    // Dokument weg
  }
}

export function schreibeErgebnis(ergebnis: string): void {
  if (!testRiegelAktiv()) return;
  try {
    document.documentElement.setAttribute(ERGEBNIS, ergebnis);
  } catch {
    // Dokument weg
  }
}

export function loescheErgebnis(): void {
  if (!testRiegelAktiv()) return;
  document.documentElement.removeAttribute(ERGEBNIS);
}
