// Popup: Zeile "This site" direkt unter der Pause (Phase 9, Paket A, Fund 2). Name der Seite, der Knopf "Leave this site alone" (bzw.
// "Let Mia back on this site") und der Satz dazu. Auf Seiten ohne Zugriff steht der Satz "I can’t reach this page." statt eines gesperrten
// Knopfs. Das Schreiben der Ausnahme bleibt in main.ts (dort laufen alle Aenderungen in einer Kette). Texte nur per textContent.
import liste from '../../data/ausnahmen-standard.json';
import { musterAusListe, passtAusnahme, zerlegeMuster } from '../../scripts/ausnahmen-muster.mjs';
import type { Einstellungen } from '../../src/einstellungen';
import * as T from './texte';

const standardMuster: string[] = musterAusListe(liste);

export async function leseSeite(): Promise<URL | null> {
  try {
    const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
    const url = new URL(tab?.url ?? '');
    return url.protocol === 'http:' || url.protocol === 'https:' ? url : null;
  } catch {
    return null;
  }
}

// Muster fuer die eigene Ausnahme: der Host ohne fuehrendes "www." (deckt dann auch Subdomains).
export function musterFuerSeite(url: URL): string | null {
  const muster = url.hostname.toLowerCase().replace(/^www\./, '');
  return zerlegeMuster(muster) ? muster : null;
}

export function aufStandardListe(seite: URL | null): boolean {
  return !!seite && passtAusnahme(seite, standardMuster);
}

export function aufEigenerListe(seite: URL | null, e: Einstellungen): boolean {
  return !!seite && passtAusnahme(seite, e.ausnahmen);
}

export function zeichneDieseSeite(e: Einstellungen, seite: URL | null): void {
  const knopf = document.getElementById('ausnahme') as HTMLButtonElement;
  const hinweis = document.getElementById('ausnahme-hinweis') as HTMLParagraphElement;
  const name = document.getElementById('diese-seite-name') as HTMLElement;
  const muster = seite ? musterFuerSeite(seite) : null;
  if (!seite || !muster) {
    name.textContent = '';
    name.hidden = true;
    knopf.hidden = true;
    knopf.disabled = true;
    hinweis.textContent = T.DIESE_SEITE_KEIN_ZUGRIFF;
    return;
  }
  name.hidden = false;
  name.textContent = muster;
  knopf.hidden = false;
  if (passtAusnahme(seite, standardMuster)) {
    knopf.textContent = 'On the never-touch list';
    knopf.disabled = true;
    hinweis.textContent = `${muster} stays untouched. Banks and the like are always safe from me.`;
    return;
  }
  knopf.disabled = false;
  if (passtAusnahme(seite, e.ausnahmen)) {
    knopf.textContent = T.AUSNAHME_KNOPF_ZURUECK;
    knopf.dataset.modus = 'weg';
    hinweis.textContent = T.AUSNAHME_NACH(muster);
  } else {
    knopf.textContent = T.AUSNAHME_KNOPF_AN;
    knopf.dataset.modus = 'hinzu';
    hinweis.textContent = T.AUSNAHME_VOR(muster);
  }
}
