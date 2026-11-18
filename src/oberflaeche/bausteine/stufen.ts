// Stufenwahl, reine Logik (Phase 11 E4c0, Regel B5). Rein, ohne DOM und ohne Browser: in Node pruefbar.
// Eine Stufe ist markiert, wenn der gespeicherte Wert ihr bis auf Gleitkomma-Reste gleich ist (Abstand unter einem Millionstel der Einheit der
// Einstellung: Hundertstel, ganze Sekunden). Sonst ist KEINE Stufe markiert und die Oberflaeche zeigt den genauen Wert.
// Nichts hier rundet auf eine Stufe (Nacharbeit R3): 0,1049 ist nicht "Careful".

export interface Stufe {
  readonly name: string; // Platzhalter, die Texterin entscheidet in Schritt (e)
  readonly wert: number; // im Speichermass der Einstellung (zum Beispiel 0.15 oder 10000 Millisekunden)
}

export interface StufenListe {
  readonly einheit: number; // Groesse einer Einheit im Speichermass: 0.01 (Hundertstel) oder 1000 (ganze Sekunden in Millisekunden)
  readonly min: number; // heutige Grenzen aus src/einstellungen.ts
  readonly max: number;
  readonly schritt: number; // Schritt des Reglers "Exact value"
  readonly standard: number; // heutiger Standardwert, ist immer eine Stufe
  readonly stufen: readonly Stufe[];
}

export interface StufenAnsicht {
  readonly markiert: number | null; // Index der markierten Stufe oder null
  readonly zwischenwert: boolean; // true, wenn keine Stufe passt: dann ist der Aufklapper "Exact value" offen
}

// Wert in Einheiten (nur fuer die Pruefung der Listen und die Gleichheit; es wird nicht gerundet).
export function inEinheiten(wert: number, einheit: number): number {
  return wert / einheit;
}

// Abstand in Einheiten, ab dem zwei Werte als verschieden gelten: ein Millionstel faengt Gleitkomma-Reste, aber keinen echten Zwischenwert.
export const GLEICH_BIS = 1e-6;

export function markierteStufe(stufen: readonly Stufe[], gespeichert: number, einheit: number): number | null {
  if (!Number.isFinite(gespeichert) || !(einheit > 0)) return null;
  const ziel = inEinheiten(gespeichert, einheit);
  const i = stufen.findIndex((s) => Math.abs(inEinheiten(s.wert, einheit) - ziel) < GLEICH_BIS);
  return i < 0 ? null : i;
}

export function stufenAnsicht(liste: Pick<StufenListe, 'stufen' | 'einheit'>, gespeichert: number): StufenAnsicht {
  const markiert = markierteStufe(liste.stufen, gespeichert, liste.einheit);
  return { markiert, zwischenwert: markiert === null };
}

// Pruefung einer Liste gegen ihre Grenzen (Tests und Entwicklung): aufsteigend, alle Werte in den Grenzen, der Standard ist eine Stufe.
export function pruefeStufenliste(liste: StufenListe): string[] {
  const fehler: string[] = [];
  const werte = liste.stufen.map((s) => s.wert);
  for (const w of werte) if (!(w >= liste.min && w <= liste.max)) fehler.push(`Wert ${w} liegt ausserhalb ${liste.min} bis ${liste.max}`);
  for (let i = 1; i < werte.length; i++) {
    if (!((werte[i] as number) - (werte[i - 1] as number) > liste.einheit * GLEICH_BIS)) fehler.push(`Stufen nicht aufsteigend bei Index ${i}`);
  }
  if (markierteStufe(liste.stufen, liste.standard, liste.einheit) === null) fehler.push(`Standard ${liste.standard} ist keine Stufe`);
  return fehler;
}
