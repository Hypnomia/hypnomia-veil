// Beispielbilder der Live-Vorschau (Phase 11 Etappe 5, Entscheidungen 290 bis 293): vier Bilder einer erfundenen erwachsenen Person (vorn, rueck, sitz,
// portraet), die der Bau aus `../02 Assets Mia/beispielfrau/vorschau/` nach `beispiel/<kennung>.webp` in die Erweiterung kopiert (wxt.config.ts), nie ins Repo
// (CLAUDE.md Regel 3). Der Erkenner laeuft dafuer nicht: je Bild liegen seine gemessenen Treffer als Daten in `data/beispiel-treffer.json`
// (Messung: scripts/messung/vorschau-treffer.mjs). Zwei Saetze je Bild, weil der Erkenner Gesichter mit YuNet nur unter der Bedingung aus
// `src/erkenner/gesichtssuche.ts` sucht und die Treffer sich dann unterscheiden (V6). Kein web_accessible_resources, kein Netzverkehr: der Abruf
// betrifft nur die eigenen Dateien der Erweiterung.
import daten from '../data/beispiel-treffer.json' with { type: 'json' };
import type { Treffer } from './nachrichten';

export const BEISPIEL_ORDNER = 'beispiel';
// Die Schwelle, bei der die Treffer abgelegt sind (das Minimum der Einstellung). Wer eine hoehere Schwelle zeigt, filtert `score >= schwelle`.
export const BEISPIEL_SCHWELLE = daten.schwelle;
export const BEISPIEL_KENNUNGEN = ['vorn', 'rueck', 'sitz', 'portraet'] as const;
export type BeispielKennung = (typeof BEISPIEL_KENNUNGEN)[number];

export interface BeispielBild {
  kennung: BeispielKennung;
  datei: string; // Dateiname der Quelle im Bauordner (VEIL_BEISPIEL), nicht der Name in der Erweiterung
  sha256: string; // der Bau vergleicht ihn mit der Quelldatei (V5)
  breite: number;
  hoehe: number;
}

interface Eintrag extends BeispielBild {
  trefferMitGesicht: Treffer[];
  trefferOhneGesicht: Treffer[];
}
const EINTRAEGE = daten.bilder as unknown as Eintrag[];

// Die Liste der vier Bilder in der Reihenfolge der Punkte (ohne Treffer, die holt `trefferFuer`).
export const BEISPIELE: readonly BeispielBild[] = EINTRAEGE.map(({ kennung, datei, sha256, breite, hoehe }) => ({ kennung, datei, sha256, breite, hoehe }));

export function istBeispielKennung(wert: unknown): wert is BeispielKennung {
  return typeof wert === 'string' && (BEISPIEL_KENNUNGEN as readonly string[]).includes(wert);
}

// Pfad des Bilds in der Erweiterung (so heisst die Datei im Bau).
export function beispielPfad(kennung: BeispielKennung): string {
  return `${BEISPIEL_ORDNER}/${kennung}.webp`;
}

// Adresse des Bilds innerhalb der Erweiterung oder null, wenn der Bau es nicht mitgebracht hat (HEAD-Abruf wie bei Chibis und Kern-Bildern, je Kennung
// einmal). Nur Erweiterungsseiten rufen sie; kein Weg ueber Content-Script oder Seiten-DOM.
const adressen = new Map<BeispielKennung, Promise<string | null>>();
export function beispielAdresse(kennung: BeispielKennung): Promise<string | null> {
  let p = adressen.get(kennung);
  if (!p) {
    // getURL kennt nur gebaute Seiten als Typ; die Bilder kopiert erst der Bau hinein (wxt.config.ts), darum die Umwandlung.
    const url = (browser.runtime.getURL as (pfad: string) => string)(`/${beispielPfad(kennung)}`);
    p = fetch(url, { method: 'HEAD' }).then(
      (antwort) => (antwort.ok ? url : null),
      () => null,
    );
    adressen.set(kennung, p);
  }
  return p;
}

// Die gemessenen Treffer des Bilds bei Schwelle `BEISPIEL_SCHWELLE`: mit Gesichtssuche (YuNet lief, Gesichtszonen kombiniert) oder ohne (nur 320n).
// `mitGesichtssuche` kommt aus `brauchtGesichtssuche(einstellungen)` (src/erkenner/gesichtssuche.ts), derselben Bedingung wie im Erkenner.
// Liefert eine frische Kopie (der Aufrufer darf sie veraendern) und eine leere Liste bei unbekannter Kennung.
export function trefferFuer(kennung: BeispielKennung, mitGesichtssuche: boolean): Treffer[] {
  const e = EINTRAEGE.find((x) => x.kennung === kennung);
  if (!e) return [];
  return (mitGesichtssuche ? e.trefferMitGesicht : e.trefferOhneGesicht).map((t) => ({ ...t, box: [...t.box] as Treffer['box'] }));
}
