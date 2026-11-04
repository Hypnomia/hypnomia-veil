// Zaehlung der Urteile (reine Logik, ohne Browser; getrennt von status.ts, damit Einheitstests sie laden koennen).

export interface Zaehlung {
  gesamt: number;
  offen: number;
  frei: number;
  // Zensiert durch den normalen Schleier (eingesetzte Vorschauen zaehlen hier nicht mit, sie stehen unter `ersetzt`).
  zensiert: number;
  verdeckt: number;
  // Eingesetzte Pack-Bilder (Vorschau-Tausch): kein Treffer, getrennt gezaehlt. `gesamt` enthaelt sie.
  ersetzt: number;
}

// Zaehlt Zustaende: eingesetzte Vorschauen (Urteil `zensiert` mit `ersetzt`) stehen unter `ersetzt`, nicht unter `zensiert`.
export function zaehleZustaende(zustaende: Iterable<{ urteil: 'frei' | 'zensiert' | 'verdeckt' | null; ersetzt?: unknown }>): Zaehlung {
  const z: Zaehlung = { gesamt: 0, offen: 0, frei: 0, zensiert: 0, verdeckt: 0, ersetzt: 0 };
  for (const s of zustaende) {
    z.gesamt++;
    if (s.urteil === 'zensiert' && s.ersetzt) z.ersetzt++;
    else if (s.urteil) z[s.urteil]++;
    else z.offen++;
  }
  return z;
}
