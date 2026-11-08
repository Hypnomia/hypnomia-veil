// Einstellungsseite: Abschnitt #ledger "Mia’s Ledger" (Auftrag L, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 5). Zeigt die lokalen Zaehler
// (heute und insgesamt, je mit einem Satz von Mia), seit wann Mia da ist und die hoechste Stufe. "Clear my ledger" fragt zurueck und schickt
// dann `ledger-loeschen` an den Hintergrund. Folgt Aenderungen im Speicher. Alle Texte nur per textContent.
import './ledger.css';
import { LEDGER_SCHLUESSEL, LEDGER_ZAEHLER, type Ledger, type LedgerZaehler } from '../../src/ledger/vertrag';
import { neuerTag, tageSeit, vervollstaendigeLedger } from '../../src/ledger/logik';
import {
  LEDGER_EINLEITUNG,
  LEDGER_MEHR,
  LEDGER_MEHR_NEUER,
  GESAMT_ETIKETT,
  HEUTE_ETIKETT,
  LEDGER_TITEL,
  LOESCHEN_FEHLER,
  LOESCHEN_FERTIG,
  LOESCHEN_FRAGE,
  LOESCHEN_JA,
  LOESCHEN_KNOPF,
  LOESCHEN_NEIN,
  STUFE_NAME,
  ZAEHLER_NAMEN,
  satzFuer,
  seitText,
  stufeSatz,
  stufeWert,
} from '../../src/ledger/texte';
import type { NachrichtHintergrundLedgerLoeschen } from '../../src/nachrichten';
import { datumLang } from '../../src/oberflaeche/gemeinsam';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, kurzAusRoh, ladePackKurz, type Freischaltung, type PackKurz } from '../../src/pack/vertrag';

const abschnitt = document.getElementById('ledger');

// UX-Fund 25: welche Freischaltung (eine davon genuegt) einen Zaehler moeglich macht. Ohne sie und mit Wert 0 bleibt die Zeile weg.
const FREISCHALTUNG: Partial<Record<LedgerZaehler, readonly Freischaltung[]>> = {
  quizGeloest: ['erwachsen:quiz', 'quiz:freilegen'],
  quizFalsch: ['erwachsen:quiz', 'quiz:freilegen'],
  quizVerweigert: ['erwachsen:quiz', 'quiz:freilegen'],
  // Minuten und hoechste Stufe kommen nur mit der Steigerung (src/hintergrund/ledger.ts).
  erwachsenMinuten: ['zensur:steigerung'],
  werbung: ['kontrolle:werbung'],
  blitzwoerter: ['kontrolle:blitz'],
  spiralen: ['kontrolle:leerlauf'],
  besuche: ['kontrolle:besuche'],
};

function neu<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, id?: string, text?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (id) e.id = id;
  if (text !== undefined) e.textContent = text;
  return e;
}

if (abschnitt) {
  // ---------- Aufbau (einmal) ----------
  const titel = neu('h2', undefined, 'ledger-titel', LEDGER_TITEL);
  const einleitung = neu('p', 'hinweis', 'ledger-einleitung', LEDGER_EINLEITUNG);
  const seit = neu('p', 'ledger-seit', 'ledger-seit');
  const liste = neu('ul', 'ledger-liste', 'ledger-liste');
  const zeilen: Array<{ z: LedgerZaehler; li: HTMLElement; heute: HTMLElement; gesamt: HTMLElement; satz: HTMLElement }> = [];
  for (const z of LEDGER_ZAEHLER) {
    const li = neu('li', 'ledger-zeile', `ledger-zeile-${z}`);
    const kopf = neu('div', 'ledger-kopf');
    kopf.append(neu('strong', 'ledger-name', undefined, ZAEHLER_NAMEN[z]));
    const zahlen = neu('span', 'ledger-zahlen');
    zahlen.append(neu('span', 'ledger-etikett', undefined, HEUTE_ETIKETT));
    const heute = neu('span', 'ledger-zahl', `ledger-heute-${z}`, '0');
    zahlen.append(heute, neu('span', 'ledger-etikett', undefined, GESAMT_ETIKETT));
    const gesamt = neu('span', 'ledger-zahl', `ledger-gesamt-${z}`, '0');
    zahlen.append(gesamt);
    kopf.append(zahlen);
    const satz = neu('p', 'ledger-satz hinweis', `ledger-satz-${z}`);
    li.append(kopf, satz);
    zeilen.push({ z, li, heute, gesamt, satz });
    liste.append(li);
  }
  const mehr = neu('p', 'hinweis', 'ledger-mehr', LEDGER_MEHR);
  mehr.hidden = true;
  const stufeZeile = neu('div', 'ledger-zeile ledger-stufe', 'ledger-stufe-zeile');
  const stufeKopf = neu('div', 'ledger-kopf');
  stufeKopf.append(neu('strong', 'ledger-name', undefined, STUFE_NAME));
  const stufeZahl = neu('span', 'ledger-zahl', 'ledger-stufe', '0');
  stufeKopf.append(stufeZahl);
  const stufeSatzEl = neu('p', 'ledger-satz hinweis', 'ledger-stufe-satz');
  stufeZeile.append(stufeKopf, stufeSatzEl);

  const loeschen = neu('button', 'klein ruhig', 'ledger-loeschen', LOESCHEN_KNOPF);
  loeschen.type = 'button';
  const frage = neu('div', 'ledger-frage', 'ledger-frage');
  frage.hidden = true;
  frage.setAttribute('role', 'group');
  frage.setAttribute('aria-labelledby', 'ledger-frage-text');
  const frageText = neu('p', undefined, 'ledger-frage-text', LOESCHEN_FRAGE);
  const ja = neu('button', 'klein', 'ledger-ja', LOESCHEN_JA);
  ja.type = 'button';
  const nein = neu('button', 'klein ruhig', 'ledger-nein', LOESCHEN_NEIN);
  nein.type = 'button';
  const fragenKnoepfe = neu('div', 'ledger-knoepfe');
  fragenKnoepfe.append(ja, nein);
  frage.append(frageText, fragenKnoepfe);
  const meldung = neu('p', 'hinweis', 'ledger-meldung');
  meldung.setAttribute('role', 'status');
  meldung.setAttribute('aria-live', 'polite');

  // Nacht N2: "More counts ..." steht direkt vor dem Knopf, damit beide ab 481 px in einer Zeile stehen koennen (ledger.css).
  abschnitt.replaceChildren(titel, einleitung, seit, liste, stufeZeile, mehr, loeschen, frage, meldung);

  // ---------- Anzeige ----------
  let pack: PackKurz | null = null;
  let zuletztRoh: unknown;
  function zeige(roh: unknown): void {
    zuletztRoh = roh;
    const jetzt = new Date();
    const l: Ledger = neuerTag(vervollstaendigeLedger(roh, jetzt), jetzt);
    const datum = datumLang(l.seit);
    seit.textContent = seitText(datum, tageSeit(l.seit, jetzt));
    let versteckt = false;
    for (const r of zeilen) {
      r.heute.textContent = String(l.heute[r.z]);
      r.gesamt.textContent = String(l.gesamt[r.z]);
      r.satz.textContent = satzFuer(r.z, l.gesamt[r.z]);
      const noetig = FREISCHALTUNG[r.z];
      const frei = !noetig || noetig.some((f) => istFreigeschaltet(pack, f));
      r.li.hidden = !(frei || l.gesamt[r.z] > 0 || l.heute[r.z] > 0);
      if (r.li.hidden) versteckt = true;
    }
    // Die Stufenzeile steht ohne Steigerung und ohne Stufe nicht da (sonst immer "Level 0 of 4").
    stufeZeile.hidden = !istFreigeschaltet(pack, 'zensur:steigerung') && l.hoechsteStufe <= 0;
    if (stufeZeile.hidden) versteckt = true;
    mehr.hidden = !versteckt;
    mehr.textContent = pack ? LEDGER_MEHR_NEUER : LEDGER_MEHR;
    stufeZahl.textContent = stufeWert(l.hoechsteStufe);
    stufeSatzEl.textContent = stufeSatz(l.hoechsteStufe);
  }

  async function lade(): Promise<void> {
    try {
      const ablage = await browser.storage.local.get(LEDGER_SCHLUESSEL);
      zeige(ablage[LEDGER_SCHLUESSEL]);
    } catch {
      zeige(undefined);
    }
  }

  // ---------- Loeschen mit Rueckfrage ----------
  loeschen.addEventListener('click', () => {
    meldung.textContent = '';
    frage.hidden = false;
    loeschen.hidden = true;
    nein.focus();
  });
  nein.addEventListener('click', () => {
    frage.hidden = true;
    loeschen.hidden = false;
    loeschen.focus();
  });
  // Runde 3, N4: Escape behaelt die Zahlen wie "Keep them" (Fokus zurueck auf den Knopf).
  frage.addEventListener('keydown', (ereignis) => {
    if (ereignis.key === 'Escape') {
      ereignis.preventDefault();
      nein.click();
    }
  });
  ja.addEventListener('click', async () => {
    ja.disabled = true;
    try {
      const n: NachrichtHintergrundLedgerLoeschen = { ziel: 'hintergrund', typ: 'ledger-loeschen' };
      const antwort = (await browser.runtime.sendMessage(n)) as { ok?: boolean } | undefined;
      meldung.textContent = antwort?.ok === true ? LOESCHEN_FERTIG : LOESCHEN_FEHLER;
    } catch {
      meldung.textContent = LOESCHEN_FEHLER;
    } finally {
      ja.disabled = false;
      frage.hidden = true;
      loeschen.hidden = false;
      loeschen.focus();
    }
    await lade();
  });

  browser.storage.onChanged.addListener((aenderungen, bereich) => {
    if (bereich !== 'local') return;
    if (PACK_SPEICHER_SCHLUESSEL in aenderungen) {
      pack = kurzAusRoh(aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue);
      zeige(zuletztRoh);
    }
    if (LEDGER_SCHLUESSEL in aenderungen) zeige(aenderungen[LEDGER_SCHLUESSEL].newValue);
  });
  // Bei offener Seite rollt "Today" um Mitternacht um: neu zeigen, wenn die Seite wieder sichtbar wird und einmal je Minute.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void lade();
  });
  setInterval(() => void lade(), 60_000);
  void ladePackKurz().then(
    (p) => {
      pack = p;
      void lade();
    },
    () => void lade(),
  );
}
