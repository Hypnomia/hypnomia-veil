// Spuren der Meldungen fuer Tests (nur Testbau, nur auf 127.0.0.1 und localhost). Die Namen stehen nur hinter `TESTHAKEN`, damit der
// Release-Bau keine Spur enthaelt. Die Shadow Root bleibt auch im Testbau geschlossen: Tests sehen ein JSON-Abbild am html-Element.
import { TESTHAKEN } from '../schleier/konstanten';
import { testhakenAktiv } from '../schleier/status';

export const testMeldung = (): boolean => TESTHAKEN && testhakenAktiv();

export const HOST_MARKE: string = TESTHAKEN ? 'data-veil-meldung-host' : '';
export const ZEIT_MARKE: string = TESTHAKEN ? 'data-veil-meldung-zeit' : '';
const ABBILD: string = TESTHAKEN ? 'data-veil-meldung' : '';
const ANTWORT: string = TESTHAKEN ? 'data-veil-meldung-antwort' : '';

export function schreibeAbbild(daten: unknown): void {
  if (!testMeldung()) return;
  try {
    document.documentElement.setAttribute(ABBILD, JSON.stringify(daten));
  } catch {
    // Dokument weg
  }
}

export function schreibeAntwort(daten: unknown): void {
  if (!testMeldung()) return;
  try {
    document.documentElement.setAttribute(ANTWORT, JSON.stringify(daten));
  } catch {
    // Dokument weg
  }
}
