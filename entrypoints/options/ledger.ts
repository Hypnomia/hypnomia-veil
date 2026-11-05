// Einstellungsseite: Abschnitt #ledger "Mia’s Ledger" (Auftrag L, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 5). Zeigt die lokalen Zaehler
// (heute und insgesamt, je mit einem Satz von Mia), seit wann Mia da ist und die hoechste Stufe. "Clear my ledger" fragt zurueck und schickt
// dann `ledger-loeschen` an den Hintergrund. Folgt Aenderungen im Speicher. Alle Texte nur per textContent.
import './ledger.css';
import { LEDGER_SCHLUESSEL, LEDGER_ZAEHLER, type Ledger, type LedgerZaehler } from '../../src/ledger/vertrag';
import { neuerTag, tageSeit, vervollstaendigeLedger } from '../../src/ledger/logik';
import {
  LEDGER_EINLEITUNG,
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
} from '../../src/ledger/texte';
import type { NachrichtHintergrundLedgerLoeschen } from '../../src/nachrichten';

const abschnitt = document.getElementById('ledger');

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
  const zeilen: Array<{ z: LedgerZaehler; heute: HTMLElement; gesamt: HTMLElement; satz: HTMLElement }> = [];
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
    zeilen.push({ z, heute, gesamt, satz });
    liste.append(li);
  }
  const stufeZeile = neu('div', 'ledger-zeile ledger-stufe');
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

  abschnitt.replaceChildren(titel, einleitung, seit, liste, stufeZeile, loeschen, frage, meldung);

  // ---------- Anzeige ----------
  function zeige(roh: unknown): void {
    const jetzt = new Date();
    const l: Ledger = neuerTag(vervollstaendigeLedger(roh, jetzt), jetzt);
    const datum = new Date(l.seit).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
    seit.textContent = seitText(datum, tageSeit(l.seit, jetzt));
    for (const r of zeilen) {
      r.heute.textContent = String(l.heute[r.z]);
      r.gesamt.textContent = String(l.gesamt[r.z]);
      r.satz.textContent = satzFuer(r.z, l.gesamt[r.z]);
    }
    stufeZahl.textContent = String(l.hoechsteStufe);
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
    if (bereich !== 'local' || !(LEDGER_SCHLUESSEL in aenderungen)) return;
    zeige(aenderungen[LEDGER_SCHLUESSEL].newValue);
  });
  // Bei offener Seite rollt "Today" um Mitternacht um: neu zeigen, wenn die Seite wieder sichtbar wird und einmal je Minute.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void lade();
  });
  setInterval(() => void lade(), 60_000);
  void lade();
}
