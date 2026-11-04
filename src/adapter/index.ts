// Adapter-Auswahl und Vorschau-Entscheidung (reine Funktionen, kein Browser-Zugriff ausser ueber das uebergebene Element).
import type { SeitenName } from './liste';
import { allgemein } from './allgemein.ts';
import { fansly } from './fansly.ts';
import { onlyfans } from './onlyfans.ts';
import { pornhub } from './pornhub.ts';
import type { Adapter, ElementLike } from './typen';
import { xhamster } from './xhamster.ts';
import { xnxx, xvideos } from './xvideos.ts';

export type { Adapter, ElementLike } from './typen';

const ADAPTER: Readonly<Record<SeitenName, Adapter>> = { pornhub, xhamster, xvideos, xnxx, onlyfans, fansly, allgemein };

// Adapter fuer einen Seitennamen; unbekannte Namen fallen auf den allgemeinen Rueckfall.
export function adapterFuer(name: SeitenName | null | undefined): Adapter {
  return (name && ADAPTER[name]) || allgemein;
}

// Kleinste Kantenlaenge (dargestellt, in Pixeln), ab der ein Bild als Vorschaubild getauscht wird: Symbole, Avatare und Logos bleiben.
export const VORSCHAU_MIN_KANTE = 80;

// Ein einzelner kaputter Selektor darf die anderen nicht lahmlegen: jeder wird einzeln versucht, der erste Treffer zaehlt.
function probiere(selektoren: readonly string[], aktion: (s: string) => boolean): boolean {
  for (const s of selektoren) {
    try {
      if (aktion(s)) return true;
    } catch {
      // Selektor vom Browser nicht verstanden: ueberspringen
    }
  }
  return false;
}

// Links auf die Startseite, Ankerlinks und Skript-Links fuehren nicht zu einer Videoseite.
// Mit `basis` (Adresse der Seite) werden auch absolute Links auf die eigene Startseite ausgeschlossen, mit `nurEigenerHost` zusaetzlich Links
// auf fremde Hosts (Werbung im Rueckfall).
export function istVideoLink(href: string | null, basis?: string, nurEigenerHost = false): boolean {
  if (href === null) return true; // Karte ohne href (Einzelseiten-App): gilt
  const h = href.trim().toLowerCase();
  if (h === '' || h === '/' || h.startsWith('#') || h.startsWith('javascript:') || h.startsWith('mailto:')) return false;
  if (basis) {
    try {
      const ziel = new URL(href.trim(), basis);
      const eigen = new URL(basis);
      const ohneWww = (x: string) => x.replace(/^www\./, '');
      if (ziel.pathname === '/' && !ziel.search) return false; // Startseite (auch absolut)
      if (nurEigenerHost && ohneWww(ziel.hostname) !== ohneWww(eigen.hostname)) return false;
    } catch {
      return false;
    }
  }
  return true;
}

// Steht das Element in einem Vorschau-Zusammenhang dieses Adapters (Link zu einer Videoseite, Vorschau-Bild, Karte)?
// Die Groesse prueft der Aufrufer (VORSCHAU_MIN_KANTE), hier zaehlt nur der Aufbau.
export function istVorschau(el: ElementLike, adapter: Adapter, basis?: string): boolean {
  if (adapter.vorschauBilder.length && probiere(adapter.vorschauBilder, (s) => el.matches(s))) return true;
  let treffer = false;
  probiere(adapter.vorschauLinks, (s) => {
    const k = el.closest(s);
    if (k && istVideoLink(k.getAttribute('href'), basis, adapter.name === 'allgemein')) treffer = true;
    return treffer;
  });
  return treffer;
}

// Ist es ein Hover-Vorschauvideo dieses Adapters (wird im Tausch-Modus versteckt)?
export function istHoverVideo(el: ElementLike, adapter: Adapter): boolean {
  return adapter.hoverVideos.length > 0 && probiere(adapter.hoverVideos, (s) => el.matches(s));
}
