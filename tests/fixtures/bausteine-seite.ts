// Einstieg der Testseite tests/fixtures/bausteine.html: baut jeden Baustein einmal mit Testtexten und legt die Handles in window.__b ab.
// Jede Aenderung des Nutzers landet in window.__b.log. Nur fuer den Test, nie im Release-Bau.
import { STANDARD, ZONEN, type Zone } from '../../src/einstellungen.ts';
import type { ZonenStand } from '../../src/einstieg/zonen.ts';
import {
  baueAufklapper, baueAuswahl, baueErklaerung, baueHinweis, baueKleidungsfrage, baueSchalter, baueStufenwahl, baueVorschauPlatz, baueWahlkarten, baueZonenwahl,
  STUFENLISTEN,
} from '../../src/oberflaeche/bausteine/bausteine.ts';

const log: Array<{ von: string; wert: unknown }> = [];
const melde = (von: string) => (wert: unknown) => void log.push({ von, wert: JSON.parse(JSON.stringify(wert)) });
const erkl = (n: string) => ({ knopfLabel: `What does ${n} do?`, text: `Explanation of ${n}.` });
const sek = (ms: number) => `${(ms / 1000).toFixed(0)} s`;

const namen = Object.fromEntries(ZONEN.map((z) => [z, z.toUpperCase()])) as Record<Zone, string>;
const zonenStart = JSON.parse(JSON.stringify(STANDARD.zonen)) as ZonenStand;
// Der eine gespeicherte Zonenstand der Seite: Zonenwahl und Kleidungsfrage lesen ihn ueber eine Funktion (keine eigene Kopie). Die Rueckrufe
// speichern nur und zeichnen den jeweils anderen Baustein NICHT neu: so zeigt der Test, dass keiner einen alten Stand zurueckschreibt.
let gespeichert: ZonenStand = JSON.parse(JSON.stringify(zonenStart));
const speichere = (von: string) => (neu: ZonenStand) => {
  gespeichert = JSON.parse(JSON.stringify(neu));
  melde(von)(neu);
};
const zeigeGenau = (w: number) => String(Math.round(w * 10000) / 10000); // Zwischenwerte zeigt die Zahl genau
const bild = () => {
  const s = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
  s.setAttribute('viewBox', '0 0 40 30');
  return s;
};

// Fremder Inhalt in einem Aufklapper: ein Knopf, den die Bausteine nicht gestalten duerfen
function fremderInhalt(): HTMLElement {
  const d = document.createElement('div');
  d.append('Inside the fold. ');
  const k = document.createElement('button');
  k.id = 'fremd-innen';
  k.textContent = 'Foreign button';
  d.append(k);
  return d;
}
const handles = {
  schalter: baueSchalter({ titel: 'Test switch', hinweis: 'Switch hint', erklaerung: erkl('the switch'), an: false, beiAenderung: melde('schalter') }),
  schalterAn: baueSchalter({ titel: 'Second switch', an: true, beiAenderung: melde('schalterAn') }),
  gesperrt: baueSchalter({ titel: 'Locked switch', hinweis: 'Locked because of a reason', an: true, gesperrt: true, beiAenderung: melde('gesperrt') }),
  stimmung: baueStufenwahl({
    titel: 'Mood',
    erklaerung: erkl('mood'),
    liste: STUFENLISTEN.stimmung,
    wert: STANDARD.schwelle,
    exakt: { titel: 'Exact value', formatiere: zeigeGenau, reglerLabel: 'Exact mood' },
    hinweisFuer: (a) => (a.markiert === null ? 'In between' : `Stage ${a.markiert}`),
    beiAenderung: melde('stimmung'),
  }),
  freilegen: baueStufenwahl({
    titel: 'Uncover',
    liste: STUFENLISTEN.freilegen,
    wert: STANDARD.quiz.freilegenMs,
    exakt: { titel: 'Exact time', formatiere: sek, reglerLabel: 'Exact seconds' },
    beiAenderung: melde('freilegen'),
  }),
  auswahl: baueAuswahl({
    titel: 'Pointer',
    erklaerung: erkl('the pointer'),
    hinweis: 'Pointer hint',
    optionen: [
      { wert: 'a', text: 'My spiral' },
      { wert: 'b', text: 'My heart' },
      { wert: 'c', text: 'Yours' },
    ],
    wert: 'a',
    beiAenderung: melde('auswahl'),
  }),
  wahlkarten: baueWahlkarten({
    titel: 'Cards',
    erklaerung: erkl('the cards'),
    karten: [
      { id: 'eins', titel: 'One', satz: 'First card', bild: bild() },
      { id: 'zwei', titel: 'Two', satz: 'Second card', bild: bild() },
      { id: 'drei', titel: 'Three' },
    ],
    wert: 'zwei',
    spalten: 3,
    beiAenderung: melde('wahlkarten'),
  }),
  aufklapper: baueAufklapper({ titel: 'Fold', stand: 'closed', erklaerung: erkl('the fold'), inhalt: fremderInhalt() }),
  zonen: baueZonenwahl({
    titel: 'Zones',
    erklaerung: erkl('zones'),
    karten: { koerper: { titel: 'Body', satz: 'default zones' }, 'koerper-gesicht': { titel: 'Body and face' }, alles: { titel: 'Everything' } },
    einzeln: { titel: 'Pick one by one', stand: (n, g) => `${n} of ${g} on`, gruppenLabel: 'Single zones', namen },
    zonen: () => gespeichert,
    beiAenderung: speichere('zonen'),
  }),
  kleidung: baueKleidungsfrage({
    titel: 'Clothes',
    erklaerung: erkl('clothes'),
    antworten: { haut: { titel: 'Bare skin only', satz: 'Clothes stay.', bild: bild() }, 'auch-bedeckt': { titel: 'Under clothes too', satz: 'Clothes too.', bild: bild() } },
    zonen: () => gespeichert,
    beiAenderung: speichere('kleidung'),
  }),
  vorschau: baueVorschauPlatz({ label: 'Preview', etikett: 'Showing' }),
  hinweis: baueHinweis('A single hint.'),
  erklaerung: baueErklaerung(erkl('the loose help')),
  halter: baueAufklapper({ titel: 'Nested', offen: true, inhalt: baueSchalter({ titel: 'Nested switch', an: true }).element }),
};

const wurzel = document.getElementById('wurzel')!;
for (const [name, h] of Object.entries(handles)) {
  const huelle = document.createElement('section');
  huelle.dataset.fall = name;
  if (h instanceof HTMLElement) huelle.append(h);
  else if ('element' in h) huelle.append(h.element);
  else huelle.append(h.knopf, h.feld);
  wurzel.append(huelle);
}
// Gegenstueck ausserhalb jedes Bausteins (Vergleich der Gestalt)
const aussen = document.createElement('button');
aussen.id = 'fremd-aussen';
aussen.textContent = 'Foreign button';
document.body.append(aussen);
// L1: baut eine frische Stufenwahl (Mood) mit diesem Startwert und ruft NIE `setze()`; jede Meldung steht als 'frisch' im Protokoll.
const baueFrisch = (wert: number) => {
  document.querySelector('[data-fall="frisch"]')?.remove();
  const h = baueStufenwahl({
    titel: 'Fresh',
    liste: STUFENLISTEN.stimmung,
    wert,
    exakt: { titel: 'Exact fresh', formatiere: zeigeGenau, reglerLabel: 'Exact fresh mood' },
    beiAenderung: melde('frisch'),
  });
  const huelle = document.createElement('section');
  huelle.dataset.fall = 'frisch';
  huelle.append(h.element);
  wurzel.append(huelle);
  return h;
};
(window as unknown as { __b: unknown }).__b = { ...handles, log, baueFrisch, zonenStart, gespeichert: () => gespeichert, setzeStand: (z: ZonenStand) => (gespeichert = JSON.parse(JSON.stringify(z))) };
document.documentElement.dataset.bereit = '1';
