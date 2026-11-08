// Hilfe-Seite (Session 17, Entscheidung 179): zeigt die Anleitungen aus docs/ offline. Links: Themenliste mit Suche; rechts die gewaehlte
// Anleitung. Adresse `hilfe.html#<name>[/<anker>]`, damit Popup, Einstellungen und Willkommensseite direkt auf ein Thema zeigen koennen.
import { baueAnleitungen, filtere, leseAdresse, type Anleitung } from '../../src/hilfe/anleitungen';
import { zeichneDokument } from '../../src/hilfe/darstellung';
import { augenpaar } from '../../src/oberflaeche/design/motive';

const quellen = import.meta.glob('../../docs/*.md', { query: '?raw', import: 'default', eager: true }) as Record<string, string>;
const anleitungen: Anleitung[] = baueAnleitungen(quellen);

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} fehlt`);
  return e as T;
}

const liste = el<HTMLUListElement>('themen-liste');
const leer = el<HTMLParagraphElement>('themen-leer');
const suche = el<HTMLInputElement>('suche');
const inhalt = el<HTMLElement>('inhalt');

el<HTMLDivElement>('marke').prepend(augenpaar(28));

el<HTMLButtonElement>('zu-einstellungen').addEventListener('click', () => {
  void browser.runtime.openOptionsPage();
});

// Sprunglink: nur den Fokus setzen, den Anker nicht aendern (sonst liest `hashchange` "#inhalt" als unbekannte Anleitung und zeigt die Startseite).
document.querySelector<HTMLAnchorElement>('a.springen')?.addEventListener('click', (ereignis) => {
  ereignis.preventDefault();
  inhalt.focus();
});

let aktuell = '';

function zeichneListe(): void {
  const treffer = filtere(anleitungen, suche.value);
  liste.replaceChildren(
    ...treffer.map((a) => {
      const li = document.createElement('li');
      const link = document.createElement('a');
      link.href = `#${a.name}`;
      link.textContent = a.titel;
      link.dataset.name = a.name;
      if (a.name === aktuell) link.setAttribute('aria-current', 'page');
      li.append(link);
      return li;
    }),
  );
  leer.hidden = treffer.length > 0;
}

function zeige(fokus: boolean): void {
  const { name, anker } = leseAdresse(location.hash, anleitungen);
  const a = anleitungen.find((x) => x.name === name);
  aktuell = name;
  if (!a) {
    inhalt.replaceChildren();
    const p = document.createElement('p');
    p.textContent = 'The guides are missing from this build. Find them on GitHub or ask me on Discord.';
    inhalt.append(p);
    return;
  }
  inhalt.replaceChildren(zeichneDokument(a.bloecke, a.name));
  inhalt.dataset.anleitung = a.name;
  document.title = `HYPNOMIA VEIL: ${a.titel}`;
  zeichneListe();
  const ziel = anker ? document.getElementById(`a-${anker}`) : null;
  if (ziel) {
    ziel.setAttribute('tabindex', '-1');
    ziel.scrollIntoView({ block: 'start' });
    if (fokus) ziel.focus({ preventScroll: true });
  } else {
    window.scrollTo({ top: 0 });
    if (fokus) inhalt.focus({ preventScroll: true });
  }
}

suche.addEventListener('input', zeichneListe);
// Enter in der Suche oeffnet den ersten Treffer.
suche.addEventListener('keydown', (ereignis) => {
  if (ereignis.key !== 'Enter') return;
  const erster = liste.querySelector<HTMLAnchorElement>('a');
  if (erster) {
    ereignis.preventDefault();
    location.hash = erster.getAttribute('href') ?? '';
  }
});
window.addEventListener('hashchange', () => zeige(true));
zeige(false);
