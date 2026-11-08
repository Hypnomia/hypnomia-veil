// Einstellungsseite, Karte "Mia Pack" (Session 17, Paket C, UX-Pruefung Phase 9 Funde 1, 5, 6, 7, 12). Eine Karte mit zwei Zustaenden statt zwei
// Abschnitten: ohne Pack Kern-Bilder, Kauf, Dateiwahl; mit Pack Begruessung, "Set me up", Daten, Bildreihe, Lizenz, zugeklappt "Update or
// replace the pack" und abgesetzt "Remove Mia Pack". Das Modul baut beim Import SYNCHRON das ganze DOM in `#stand` (main.ts importiert es als
// ersten Import, alle anderen Module der Seite finden ihre ids danach im DOM). Alle ids der frueheren Abschnitte `#stand` und `#neu` bleiben.
// Texte nur per textContent, Adressen nur aus data/links.json und hilfeAdresse().
import links from '../../data/links.json';
import { hilfeAdresse } from '../../src/hilfe/anker';
import { logoSvg } from '../../src/oberflaeche/design/logos';
import { baueEinrichten } from './pack-einrichten';
import {
  KNOPF_ANNEHMEN,
  TEXT_ABLAGE,
  TEXT_DATEI_KEINE,
  TEXT_KARTE_ERSETZEN,
  TEXT_KARTE_HILFE,
  TEXT_KARTE_TITEL,
  TEXT_KAUF_PATREON,
  TEXT_KAUF_PREIS,
  TEXT_KAUF_SUBSCRIBESTAR,
  TEXT_KAUF_TITEL,
  TEXT_KAUF_TRENNER,
  TEXT_KERN,
  TEXT_KNOPF_DATEI,
  TEXT_NEU_EINLEITUNG,
  TEXT_BILDREIHE,
} from './pack-texte';

interface Optionen {
  id?: string;
  klasse?: string;
  text?: string;
  hidden?: boolean;
  attr?: Record<string, string>;
}

function e<K extends keyof HTMLElementTagNameMap>(tag: K, o: Optionen = {}, ...kinder: (Node | string)[]): HTMLElementTagNameMap[K] {
  const x = document.createElement(tag);
  if (o.id) x.id = o.id;
  if (o.klasse) x.className = o.klasse;
  if (o.text !== undefined) x.textContent = o.text;
  if (o.hidden) x.hidden = true;
  for (const [k, v] of Object.entries(o.attr ?? {})) x.setAttribute(k, v);
  x.append(...kinder);
  return x;
}

function kaufLink(id: string, adresse: string, logo: 'patreon' | 'subscribestar', text: string): HTMLAnchorElement {
  const a = e('a', { id, klasse: 'kauf-knopf', attr: { href: adresse, target: '_blank', rel: 'noopener' } });
  a.append(logoSvg(logo, 24), e('span', { text }));
  return a;
}

function baueKarte(stand: HTMLElement): void {
  // Ein altes `#neu` (aus einer HTML-Fassung vor Session 17) weicht; die Karte setzt dieselbe id an den Kaufblock.
  document.getElementById('neu')?.remove();
  stand.replaceChildren();
  stand.classList.add('pack-karte');
  stand.setAttribute('aria-labelledby', 'stand-titel');

  const titel = e('h2', { id: 'stand-titel', text: TEXT_KARTE_TITEL, attr: { tabindex: '-1' } });
  const status = e('p', { id: 'pack-status', attr: { role: 'status', 'aria-live': 'polite' } });
  // Erfolgs- und Fehlersaetze stehen oben in der Karte (Fund 5), der Fokus geht nach dem Import hierher oder zur Frage darunter.
  const meldung = e('p', { id: 'meldung', attr: { role: 'status', 'aria-live': 'polite' } });

  const begruessung = e('div', { id: 'begruessung', klasse: 'mia-zeile', hidden: true });
  const chibi = e('img', { id: 'begruessung-chibi', klasse: 'chibi', hidden: true, attr: { alt: '', width: '96', height: '96' } });
  begruessung.append(chibi, e('p', { id: 'begruessung-text' }));

  // ---------- Zustand ohne Pack ----------
  const ohne = e('div', { id: 'pack-ohne' });
  const kern = e('div', { id: 'kern-streifen', hidden: true });
  kern.append(e('div', { id: 'kern-bilder', klasse: 'kern-bilder', hidden: true }), e('p', { id: 'kern-text', text: TEXT_KERN }));
  const kauf = e('div', { id: 'neu', klasse: 'kauf' });
  const knoepfe = e('div', { klasse: 'knoepfe kauf-knoepfe' });
  knoepfe.append(
    kaufLink('kauf-patreon', links.patreon, 'patreon', TEXT_KAUF_PATREON),
    kaufLink('kauf-subscribestar', links.subscribestar, 'subscribestar', TEXT_KAUF_SUBSCRIBESTAR),
  );
  kauf.append(e('h3', { id: 'neu-titel', text: TEXT_KAUF_TITEL }), e('p', { id: 'kauf-preis', text: TEXT_KAUF_PREIS }), knoepfe);
  ohne.append(
    e('p', { id: 'neu-einleitung', text: TEXT_NEU_EINLEITUNG }),
    kern,
    kauf,
    e('h3', { id: 'datei-trenner', klasse: 'trenner', text: TEXT_KAUF_TRENNER }),
  );

  // ---------- Zustand mit Pack ----------
  const daten = e('dl', { id: 'pack-daten', hidden: true });
  for (const [name, id] of [
    ['Title', 'pack-titel'],
    ['Version', 'pack-version'],
    ['Patch pictures', 'pack-bilder'],
    ['Size', 'pack-groesse'],
    ['Added', 'pack-datum'],
  ] as const) {
    daten.append(e('div', {}, e('dt', { text: name }), e('dd', { id })));
  }
  // Bildreihe aus Tease-Bildern des Packs (kern-streifen.ts fuellt sie).
  const reihe = e('div', { id: 'pack-bildreihe-zeile', hidden: true });
  reihe.append(e('div', { id: 'pack-bildreihe', klasse: 'kern-bilder' }), e('p', { id: 'pack-bildreihe-text', klasse: 'hinweis', text: TEXT_BILDREIHE }));

  const lizenzZeile = e('div', { id: 'lizenz-zeile', hidden: true });
  lizenzZeile.append(
    e('button', { id: 'lizenz-zeigen', klasse: 'klein ruhig', text: 'Read the license', attr: { type: 'button', 'aria-expanded': 'false', 'aria-controls': 'lizenz-ansicht' } }),
  );
  const lizenzAnsicht = e('div', { id: 'lizenz-ansicht', hidden: true });
  lizenzAnsicht.append(e('pre', { id: 'lizenz-ansicht-text', attr: { tabindex: '0', 'aria-label': 'License text of your Mia Pack' } }));

  // ---------- Dateiwahl (ein Satz Elemente fuer beide Zustaende) ----------
  const sperre = e('div', { id: 'pack-sperre', klasse: 'warnblock', hidden: true });
  sperre.append(
    e('p', { id: 'pack-sperre-text', text: 'Meet me first, then bring the Mia Pack. It takes a minute.' }),
    e('button', { id: 'pack-sperre-knopf', klasse: 'klein', text: 'Meet Mia first', attr: { type: 'button' } }),
  );
  const details = e('details', { id: 'datei-details', klasse: 'datei-details ohne' });
  details.open = true;
  const ablage = e('div', { id: 'ablage', klasse: 'ablage' });
  // Fund 6: das Dateifeld bleibt (Tastatur, Bildschirmleser, setInputFiles), ist aber nur unsichtbar; sichtbar ist ein Pillenknopf im Look der Seite.
  const feld = e('input', { id: 'datei', attr: { type: 'file', accept: '.miapack', 'aria-describedby': 'pack-sperre-text datei-name' } });
  feld.disabled = true;
  const wahl = e('label', { klasse: 'pack-wahl' }, e('span', { klasse: 'pack-wahl-knopf', text: TEXT_KNOPF_DATEI }), feld);
  ablage.append(wahl, e('span', { id: 'datei-name', klasse: 'hinweis', text: TEXT_DATEI_KEINE }), e('p', { id: 'ablage-text', klasse: 'hinweis', text: TEXT_ABLAGE }));
  details.append(e('summary', { id: 'datei-summary', text: TEXT_KARTE_ERSETZEN }), ablage);

  const fortschrittZeile = e('div', { id: 'fortschritt-zeile', hidden: true });
  const fortschritt = e('progress', { id: 'fortschritt', attr: { max: '1', value: '0', 'aria-labelledby': 'fortschritt-text' } });
  fortschrittZeile.append(fortschritt, e('span', { id: 'fortschritt-text' }));

  const lizenzBlock = e('div', { id: 'lizenz-block', hidden: true });
  const knoepfeLizenz = e('div', { klasse: 'knoepfe' });
  knoepfeLizenz.append(
    e('button', { id: 'annehmen', klasse: 'gross', text: KNOPF_ANNEHMEN, attr: { type: 'button' } }),
    e('button', { id: 'abbrechen', klasse: 'klein ruhig', text: 'Not yet', attr: { type: 'button' } }),
  );
  lizenzBlock.append(
    e('h3', { text: 'Before it goes in' }),
    e('p', { id: 'lizenz-kopf', klasse: 'hinweis' }),
    e('p', { id: 'ersetzen-hinweis', klasse: 'warnblock', hidden: true }),
    e('pre', { id: 'lizenz-text', attr: { tabindex: '0', 'aria-label': 'License text of the pack' } }),
    e('p', { klasse: 'hinweis', text: 'The pictures are mine. This license says what you may do with them. Accept it to add the pack.' }),
    knoepfeLizenz,
  );

  // ---------- Entfernen, ganz unten und abgesetzt ----------
  const entfernenZeile = e('div', { id: 'entfernen-zeile', klasse: 'entfernen', hidden: true });
  entfernenZeile.append(e('button', { id: 'entfernen', klasse: 'klein', text: 'Remove Mia Pack', attr: { type: 'button' } }));
  const entfernenFrage = e('div', { id: 'entfernen-frage', klasse: 'frage', hidden: true, attr: { role: 'alertdialog', 'aria-labelledby': 'entfernen-text' } });
  const entfernenKnoepfe = e('div', { klasse: 'knoepfe' });
  entfernenKnoepfe.append(
    e('button', { id: 'entfernen-ja', klasse: 'klein', text: 'Remove', attr: { type: 'button' } }),
    e('button', { id: 'entfernen-nein', klasse: 'klein ruhig', text: 'Keep it', attr: { type: 'button' } }),
  );
  entfernenFrage.append(
    e('p', {
      id: 'entfernen-text',
      text: 'Remove the Mia Pack? My pictures, sounds and words go with it, and if Mia patch is your cover style, it goes back to Mosaic. Your settings stay. You can add it again whenever you like, as long as you keep the pack file.',
    }),
    entfernenKnoepfe,
  );

  const hilfe = e('p', { klasse: 'hinweis pack-hilfe' }, e('a', { id: 'pack-hilfe', text: TEXT_KARTE_HILFE, attr: { href: hilfeAdresse('pack'), target: '_blank', rel: 'noopener' } }));

  stand.append(
    titel,
    status,
    meldung,
    begruessung,
    ohne,
    baueEinrichten(),
    daten,
    reihe,
    lizenzZeile,
    lizenzAnsicht,
    sperre,
    details,
    fortschrittZeile,
    lizenzBlock,
    entfernenZeile,
    entfernenFrage,
    hilfe,
  );
}

const stand = document.getElementById('stand');
if (stand) baueKarte(stand);
