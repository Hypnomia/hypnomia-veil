// Einstellungsseite, Abschnitte 'Your Mia Pack' (#stand) und 'Add the Mia Pack' (#neu): Pack pruefen, Lizenz zeigen, importieren, entfernen
// (PHASE-2-BAUPLAN Abschnitt 9.3, PHASE-6-BAUPLAN Abschnitt 9). Session 12 (Vertragsschritt): aus main.ts herausgeloest, gehoert Auftrag P.
// Eigene Seite statt Popup, weil sich das Popup beim Dateidialog schliesst. Alle Texte aus dem Pack kommen nur per textContent auf die Seite.
import './pack.css';
import { PackFehler, pruefePack, quelleAusBlob, type GeprueftesPack } from '../../src/pack/format';
import { vergleichePacks, ersetztVorhandenes, type PackVergleich } from '../../src/pack/ersetzen';
import { PackSpeicherFehler, PackVorhandenGeaendert, entfernePack, gleicheAb, importierePack, leseMeta, type AbgleichErgebnis } from '../../src/pack/speicher';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { einstiegFertig, ladeEinstieg } from '../../src/einstieg/vertrag';
import { datumLang } from '../../src/oberflaeche/gemeinsam';
import { fokussiereEinrichten } from './pack-einrichten';
import {
  KNOPF_ANNEHMEN,
  KNOPF_ANNEHMEN_AELTER,
  KNOPF_LIZENZ_ZEIGEN,
  KNOPF_LIZENZ_ZU,
  STATUS_DA,
  STATUS_LEER,
  STATUS_VERWAIST,
  TEXT_ABGEBROCHEN,
  TEXT_ABGLEICH_ENTFERNT,
  TEXT_ABGLEICH_NACHGESCHRIEBEN,
  TEXT_ENTFERNEN_FEHLER,
  TEXT_ENTFERNEN_TEILWEISE,
  TEXT_ENTFERNT,
  TEXT_FORTSCHRITT_LESEN,
  TEXT_PACK_GEAENDERT,
  TEXT_VORHANDENES_NICHT_LESBAR,
  textFortschrittPruefen,
  textFortschrittSpeichern,
  textFortschrittStart,
  textLizenzKopf,
  textPatchBilder,
  TEXT_ABLAGE,
  TEXT_ABLAGE_UEBER,
  TEXT_BESCHAEFTIGT,
  TEXT_DATEI_KEINE,
  TEXT_KARTE_ERSETZEN,
  TEXT_EINSTIEG_ZUERST,
  TEXT_ERSETZT_KURZFASSUNG_OK,
  TEXT_FERTIG,
  TEXT_FERTIG_ERSETZT,
  TEXT_FERTIG_STIL,
  TEXT_FERTIG_STIL_FACE_AUS,
  TEXT_FERTIG_STIL_FEHLT,
  TEXT_KEINE_DATEI,
  TEXT_KURZFASSUNG_FEHLT,
  TEXT_KURZFASSUNG_STIL,
  TEXT_LIZENZ_NICHT_LESBAR,
  TEXT_MEHRERE_DATEIEN,
  TEXT_NICHT_GESPEICHERT,
  TEXT_ORDNER,
  ersetzenHinweis,
  fehlerText,
  megabyte,
} from './pack-texte';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element ${id} fehlt`);
  return e as T;
}

const packStatus = el<HTMLParagraphElement>('pack-status');
const packDaten = el<HTMLElement>('pack-daten');
const entfernenZeile = el<HTMLDivElement>('entfernen-zeile');
const entfernenKnopf = el<HTMLButtonElement>('entfernen');
const entfernenFrage = el<HTMLDivElement>('entfernen-frage');
const dateiFeld = el<HTMLInputElement>('datei');
const fortschrittZeile = el<HTMLDivElement>('fortschritt-zeile');
const fortschritt = el<HTMLProgressElement>('fortschritt');
const fortschrittText = el<HTMLSpanElement>('fortschritt-text');
const lizenzBlock = el<HTMLDivElement>('lizenz-block');
const lizenzKopf = el<HTMLParagraphElement>('lizenz-kopf');
const lizenzText = el<HTMLPreElement>('lizenz-text');
const annehmen = el<HTMLButtonElement>('annehmen');
const abbrechen = el<HTMLButtonElement>('abbrechen');
const meldung = el<HTMLParagraphElement>('meldung');
const ersetzenHinweisEl = el<HTMLParagraphElement>('ersetzen-hinweis');
const lizenzZeile = el<HTMLDivElement>('lizenz-zeile');
const lizenzZeigen = el<HTMLButtonElement>('lizenz-zeigen');
const lizenzAnsicht = el<HTMLDivElement>('lizenz-ansicht');
const lizenzAnsichtText = el<HTMLPreElement>('lizenz-ansicht-text');
const ablage = el<HTMLDivElement>('ablage');
const ablageText = el<HTMLParagraphElement>('ablage-text');
const dateiName = el<HTMLSpanElement>('datei-name');
const dateiDetails = el<HTMLDetailsElement>('datei-details');
const dateiSummary = el<HTMLElement>('datei-summary');
const packOhne = el<HTMLDivElement>('pack-ohne');
let hatPack: boolean | null = null;

// Fund 6: der Name der gewaehlten Datei steht neben dem eigenen Pillenknopf (das Feld selbst ist nur unsichtbar).
function zeigeDateiName(datei: File | null): void {
  dateiName.textContent = datei ? datei.name : TEXT_DATEI_KEINE;
}
function leereFeld(): void {
  dateiFeld.value = '';
  zeigeDateiName(null);
}

let gewaehlt: { datei: File; geprueft: GeprueftesPack; fall: PackVergleich } | null = null;
let beschaeftigt = false;

function zeigeMeldung(text: string, fehler = false): void {
  meldung.textContent = text;
  meldung.classList.toggle('fehler', fehler);
}

// ---------- Anzeige des Packs ----------

// ---------- Lizenz jederzeit ansehen ----------

let lizenzOffen = false;
let lizenzLauf = 0;

function schliesseLizenzAnsicht(): void {
  lizenzOffen = false;
  lizenzLauf++;
  lizenzAnsicht.hidden = true;
  lizenzAnsichtText.textContent = '';
  lizenzZeigen.setAttribute('aria-expanded', 'false');
  lizenzZeigen.textContent = KNOPF_LIZENZ_ZEIGEN;
}

// Liest den Text aus dem gespeicherten Pack (nicht aus der Kurzfassung). Kann er nicht gelesen werden, steht ein Satz statt eines leeren Kastens.
async function fuelleLizenzAnsicht(): Promise<void> {
  const lauf = ++lizenzLauf;
  let text = '';
  try {
    text = (await leseMeta())?.lizenzText ?? '';
  } catch (e) {
    console.warn('Lizenz lesen fehlgeschlagen', e);
  }
  if (lauf !== lizenzLauf || !lizenzOffen) return;
  lizenzAnsichtText.textContent = text.trim() ? text : TEXT_LIZENZ_NICHT_LESBAR;
}

lizenzZeigen.addEventListener('click', () => {
  if (lizenzOffen) {
    schliesseLizenzAnsicht();
    return;
  }
  lizenzOffen = true;
  lizenzAnsicht.hidden = false;
  lizenzZeigen.setAttribute('aria-expanded', 'true');
  lizenzZeigen.textContent = KNOPF_LIZENZ_ZU;
  lizenzAnsichtText.textContent = '';
  void fuelleLizenzAnsicht();
});

function zeichneZustand(mit: boolean): void {
  packOhne.hidden = mit;
  dateiSummary.hidden = !mit;
  dateiSummary.textContent = TEXT_KARTE_ERSETZEN;
  dateiDetails.classList.toggle('ohne', !mit);
  // Ohne Pack steht die Dateiwahl offen; mit Pack ist sie zugeklappt, bis die Person sie braucht. Nur beim Wechsel umstellen.
  if (hatPack !== mit) dateiDetails.open = !mit;
  hatPack = mit;
}

function zeichneStand(pack: PackKurz | null, verwaist = false): void {
  entfernenFrage.hidden = true;
  zeichneZustand(!!pack);
  if (!pack) {
    // Verwaist: Bilder liegen noch auf dem Geraet, aber ohne Pack-Eintrag. Entfernbar, damit nichts Unbenutzbares zurueckbleibt.
    packStatus.textContent = verwaist ? STATUS_VERWAIST : STATUS_LEER;
    packDaten.hidden = true;
    entfernenZeile.hidden = !verwaist;
    schliesseLizenzAnsicht();
    lizenzZeile.hidden = true;
    return;
  }
  packStatus.textContent = STATUS_DA;
  el('pack-titel').textContent = pack.titel;
  el('pack-version').textContent = pack.version;
  el('pack-bilder').textContent = String(pack.bilder);
  el('pack-groesse').textContent = megabyte(pack.groesse);
  el('pack-datum').textContent = datumLang(pack.importiert, true);
  packDaten.hidden = false;
  entfernenZeile.hidden = false;
  lizenzZeile.hidden = false;
  if (lizenzOffen) void fuelleLizenzAnsicht();
}

async function frischeStandAuf(): Promise<void> {
  zeichneStand(await ladePackKurz());
}

// IndexedDB (die Wahrheit) und storage.local abgleichen, Abweichungen heilen und den Stand zeigen. Liefert das Ergebnis des Abgleichs,
// null, wenn der Abgleich selbst scheitert (dann zeigt die Seite, was storage.local sagt).
async function gleicheAbUndZeige(): Promise<AbgleichErgebnis | null> {
  try {
    const abgleich = await gleicheAb();
    zeichneStand(abgleich.kurz, abgleich.ergebnis === 'verwaiste-dateien');
    return abgleich;
  } catch (e) {
    console.warn('Abgleich fehlgeschlagen', e);
    await frischeStandAuf();
    return null;
  }
}

function setzeBeschaeftigt(an: boolean): void {
  beschaeftigt = an;
  // Vor dem Einstieg bleibt das Dateifeld gesperrt (grund-pack.ts setzt die Sperre).
  dateiFeld.disabled = an || document.body.dataset.packGesperrt === '1';
  annehmen.disabled = an;
  abbrechen.disabled = an;
  entfernenKnopf.disabled = an;
}

// Runde 3, N3: Fokus auf ein Element setzen, das sonst keinen Fokus nimmt (Ueberschrift, Statuszeile), und es ins Bild holen.
function fokussiere(ziel: HTMLElement): void {
  if (!ziel.hasAttribute('tabindex') && !(ziel instanceof HTMLButtonElement) && !(ziel instanceof HTMLInputElement)) ziel.tabIndex = -1;
  ziel.focus();
}

// Lesung Runde 3, Nr. 1: Chrome meldet einen gerade verborgenen oder gesperrten Knopf noch als activeElement; das zaehlt als verloren.
function fokusVerloren(): boolean {
  const a = document.activeElement as HTMLElement | null;
  if (!a || a === document.body) return true;
  if (a.closest('[hidden]') || (a as HTMLButtonElement).disabled) return true;
  return a.getClientRects().length === 0;
}

function vergissAuswahl(): void {
  gewaehlt = null;
  lizenzBlock.hidden = true;
  lizenzText.textContent = '';
  lizenzKopf.textContent = '';
  ersetzenHinweisEl.hidden = true;
  ersetzenHinweisEl.textContent = '';
  ersetzenHinweisEl.classList.remove('stark');
  annehmen.textContent = KNOPF_ANNEHMEN;
  fortschrittZeile.hidden = true;
  leereFeld();
}

// ---------- Datei waehlen und pruefen ----------

// Gemeinsamer Weg fuer Dateifeld und Ablage: Einstieg pruefen, beschaeftigt pruefen, pruefePack, Lizenz und Hinweis zum Ersetzen zeigen.
async function pruefeDatei(datei: File): Promise<void> {
  if (beschaeftigt) {
    zeigeMeldung(TEXT_BESCHAEFTIGT, true);
    return;
  }
  // Die Sperre gilt sofort, vor dem ersten await: zwei Wuerfe oder Feld plus Wurf starten nie zwei Pruefungen.
  setzeBeschaeftigt(true);
  try {
    vergissAuswahl();
    zeigeDateiName(datei);
    dateiDetails.open = true;
    zeigeMeldung('');
    // Das Mia Pack wartet auf den Einstieg (Entscheidung 133): der Speicher entscheidet, nicht nur die Anzeige.
    if (!(await ladeEinstieg().then(einstiegFertig, () => false))) {
      zeigeMeldung(TEXT_EINSTIEG_ZUERST, true);
      return;
    }
    fortschrittZeile.hidden = false;
    fortschritt.removeAttribute('value');
    fortschrittText.textContent = TEXT_FORTSCHRITT_LESEN;
    const geprueft = await pruefePack(quelleAusBlob(datei), browser.runtime.getManifest().version, (fertig, gesamt) => {
      fortschritt.max = Math.max(1, gesamt);
      fortschritt.value = fertig;
      fortschrittText.textContent = textFortschrittPruefen(fertig, gesamt);
    });
    const m = geprueft.manifest;
    // Das vorhandene Pack kommt aus IndexedDB (die Wahrheit). Kann es nicht gelesen werden, wird die Datei nicht angeboten:
    // sonst wuerde ein vorhandenes Pack als "erstes" behandelt (keine Warnung, Stil umgestellt).
    let alt: Awaited<ReturnType<typeof leseMeta>>;
    try {
      alt = await leseMeta();
    } catch (e) {
      console.warn('Vorhandenes Pack lesen fehlgeschlagen', e);
      fortschrittZeile.hidden = true;
      leereFeld();
      zeigeMeldung(TEXT_VORHANDENES_NICHT_LESBAR, true);
      return;
    }
    const fall = vergleichePacks(alt, { id: m.id, version: m.version, titel: m.titel });
    gewaehlt = { datei, geprueft, fall };
    fortschrittZeile.hidden = true;
    lizenzKopf.textContent = textLizenzKopf(m.titel, m.version, geprueft.patches, geprueft.groesse);
    lizenzText.textContent = geprueft.lizenzText;
    const hinweis = ersetzenHinweis(fall, alt, { titel: m.titel, version: m.version });
    ersetzenHinweisEl.textContent = hinweis ?? '';
    ersetzenHinweisEl.hidden = hinweis === null;
    ersetzenHinweisEl.classList.toggle('stark', fall === 'aelter');
    annehmen.textContent = fall === 'aelter' ? KNOPF_ANNEHMEN_AELTER : KNOPF_ANNEHMEN;
    lizenzBlock.hidden = false;
    // Runde 3, N3: Fokus zur Lizenz, damit Tastatur und Bildschirmleser beim Hauptweg bleiben ("Accept and add" liegt darunter).
    fokussiere(lizenzBlock.querySelector<HTMLElement>("h3") ?? lizenzBlock);
  } catch (e) {
    fortschrittZeile.hidden = true;
    leereFeld();
    zeigeMeldung(fehlerText(e), true);
  } finally {
    setzeBeschaeftigt(false);
    // Runde 3, N3: verschwindet der geklickte Knopf (Lizenzblock, Rueckfrage), landet der Fokus auf der Meldung statt auf body.
    if (fokusVerloren()) fokussiere(meldung);
  }
}

dateiFeld.addEventListener('change', () => {
  const datei = dateiFeld.files?.[0];
  if (datei) void pruefeDatei(datei);
});

// ---------- Ziehen und Ablegen ----------

// Der Browser oeffnet eine abgelegte Datei (oder einen Link) sonst als Seite und die Einstellungsseite waere weg: auf der ganzen Seite
// abfangen. Ausserhalb der Ablage zeigt der Zeiger "nicht hier" und ein Wurf passiert nichts. Eingabefelder behalten ihr Text-Ablegen.
const istEingabe = (t: EventTarget | null): boolean => t instanceof HTMLElement && t.closest('input, textarea, [contenteditable]') !== null;
for (const art of ['dragover', 'drop'] as const) {
  window.addEventListener(art, (e) => {
    if (ablage.contains(e.target as Node | null) || istEingabe(e.target)) return;
    e.preventDefault();
    if (art === 'dragover' && e.dataTransfer) e.dataTransfer.dropEffect = 'none';
  });
}

let ablageTiefe = 0;
function ablageHervorheben(an: boolean): void {
  ablage.classList.toggle('ueber', an);
  ablageText.textContent = an ? TEXT_ABLAGE_UEBER : TEXT_ABLAGE;
}

// In der Ablage wird jede Art Wurf angenommen und beantwortet (auch Links und Text: der Satz sagt, dass es eine Datei sein muss).
ablage.addEventListener('dragenter', (e) => {
  e.preventDefault();
  ablageTiefe++;
  ablageHervorheben(true);
});
ablage.addEventListener('dragover', (e) => {
  e.preventDefault();
  if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
});
ablage.addEventListener('dragleave', () => {
  ablageTiefe = Math.max(0, ablageTiefe - 1);
  if (ablageTiefe === 0) ablageHervorheben(false);
});
ablage.addEventListener('drop', (e) => {
  e.preventDefault();
  ablageTiefe = 0;
  ablageHervorheben(false);
  const dt = e.dataTransfer;
  const dateien = dt ? Array.from(dt.files) : [];
  const eintraege = dt ? Array.from(dt.items ?? []) : [];
  zeigeMeldung('');
  if (dateien.length > 1 || eintraege.filter((i) => i.kind === 'file').length > 1) {
    zeigeMeldung(TEXT_MEHRERE_DATEIEN, true);
    return;
  }
  const ordner = eintraege.some((i) => i.kind === 'file' && i.webkitGetAsEntry?.()?.isDirectory === true);
  if (ordner) {
    zeigeMeldung(TEXT_ORDNER, true);
    return;
  }
  if (dateien.length === 0) {
    zeigeMeldung(TEXT_KEINE_DATEI, true);
    return;
  }
  void pruefeDatei(dateien[0]!);
});

// ---------- Annehmen und importieren ----------

annehmen.addEventListener('click', async () => {
  if (!gewaehlt || beschaeftigt) return;
  const { datei, geprueft, fall: fallVorab } = gewaehlt;
  // Sperre sofort (ein Doppelklick startet keinen zweiten Import, Abbrechen ist gesperrt).
  setzeBeschaeftigt(true);
  try {
    // Wurde der Einstieg zurueckgesetzt, waehrend die Lizenz offen war, gilt die Sperre auch hier.
    if (!(await ladeEinstieg().then(einstiegFertig, () => false))) {
      vergissAuswahl();
      zeigeMeldung(TEXT_EINSTIEG_ZUERST, true);
      return;
    }
    zeigeMeldung('');
    fortschrittZeile.hidden = false;
    fortschritt.removeAttribute('value');
    fortschrittText.textContent = textFortschrittStart(geprueft.groesse);
    try {
      const { kurz, stilGesetzt, fall, faceAn: faceEin } = await importierePack(
        datei,
        geprueft,
        (fertig, gesamt) => {
          fortschritt.max = Math.max(1, gesamt);
          fortschritt.value = fertig;
          fortschrittText.textContent = textFortschrittSpeichern(fertig, gesamt);
        },
        fallVorab,
      );
      vergissAuswahl();
      zeichneStand(kurz);
      const ersetzt = ersetztVorhandenes(fall);
      const nachsatz = ersetzt
        ? TEXT_FERTIG_ERSETZT
        : !istFreigeschaltet(kurz, 'stil:mia-patch')
          ? ''
          : stilGesetzt
            ? faceEin
              ? TEXT_FERTIG_STIL
              : TEXT_FERTIG_STIL_FACE_AUS
            : TEXT_FERTIG_STIL_FEHLT;
      // Ohne Nachsatz kein Leerzeichen am Ende (Fund aus dem Text-Einbau).
      zeigeMeldung(`${TEXT_FERTIG} ${textPatchBilder(kurz.bilder)} added.` + (nachsatz ? ` ${nachsatz}` : ''));
      // Fund 5 und 12: Dateiwahl wieder zu, Fokus zur Frage "Show my ads?" bzw. zu "Set me up", sonst bleibt er beim Erfolgssatz.
      dateiDetails.open = false;
      if (!(await fokussiereEinrichten())) fokussiere(meldung);
    } catch (e) {
      fortschrittZeile.hidden = true;
      console.warn('Pack-Import fehlgeschlagen', e);
      if (e instanceof PackVorhandenGeaendert) {
        // Das vorhandene Pack hat sich seit der Pruefung geaendert: nichts wurde geschrieben, die Datei muss neu geprueft werden.
        vergissAuswahl();
        zeigeMeldung(TEXT_PACK_GEAENDERT, true);
        await frischeStandAuf();
      } else if (e instanceof PackFehler) {
        // Die Datei hat sich seit der Pruefung veraendert: nichts wurde geschrieben.
        vergissAuswahl();
        zeigeMeldung(fehlerText(e), true);
      } else if (e instanceof PackSpeicherFehler && e.ort === 'kurzfassung') {
        // IndexedDB ist fertig, storage.local nicht: die Bilder sind drin, der Abgleich beim naechsten Oeffnen schreibt den Eintrag nach.
        vergissAuswahl();
        const abgleich = await gleicheAbUndZeige();
        if (abgleich?.kurz) {
          zeigeMeldung(TEXT_ERSETZT_KURZFASSUNG_OK + (ersetztVorhandenes(fallVorab) || !istFreigeschaltet(abgleich.kurz, 'stil:mia-patch') ? '' : TEXT_KURZFASSUNG_STIL));
        } else {
          zeigeMeldung(TEXT_KURZFASSUNG_FEHLT, true);
        }
      } else {
        zeigeMeldung(TEXT_NICHT_GESPEICHERT, true);
      }
    }
  } finally {
    setzeBeschaeftigt(false);
    // Runde 3, N3: verschwindet der geklickte Knopf (Lizenzblock, Rueckfrage), landet der Fokus auf der Meldung statt auf body.
    if (fokusVerloren()) fokussiere(meldung);
  }
});

abbrechen.addEventListener('click', () => {
  if (beschaeftigt) return;
  vergissAuswahl();
  zeigeMeldung(TEXT_ABGEBROCHEN);
  fokussiere(dateiFeld.disabled ? meldung : dateiFeld);
});

// ---------- Entfernen mit Rueckfrage ----------

entfernenKnopf.addEventListener('click', () => {
  entfernenFrage.hidden = false;
  el<HTMLButtonElement>('entfernen-nein').focus();
});

// Runde 3, N3 und N4: "Keep it" und Escape schliessen die Frage, der Fokus kehrt zu "Remove Mia Pack" zurueck.
function behalte(): void {
  if (beschaeftigt) return;
  entfernenFrage.hidden = true;
  entfernenKnopf.focus();
}
el<HTMLButtonElement>('entfernen-nein').addEventListener('click', behalte);
entfernenFrage.addEventListener('keydown', (ereignis) => {
  if (ereignis.key === 'Escape') {
    ereignis.preventDefault();
    behalte();
  }
});

el<HTMLButtonElement>('entfernen-ja').addEventListener('click', async () => {
  if (beschaeftigt) return;
  setzeBeschaeftigt(true);
  try {
    await entfernePack();
    zeichneStand(null);
    zeigeMeldung(TEXT_ENTFERNT);
  } catch (e) {
    console.warn('Pack entfernen fehlgeschlagen', e);
    if (e instanceof PackSpeicherFehler && e.ort === 'kurzfassung') {
      // Die Bilder sind weg, die Einstellungen nicht ganz nachgezogen.
      const abgleich = await gleicheAbUndZeige();
      if (abgleich && !abgleich.kurz && abgleich.ergebnis !== 'verwaiste-dateien') {
        zeigeMeldung(TEXT_ENTFERNT);
      } else {
        zeigeMeldung(TEXT_ENTFERNEN_TEILWEISE, true);
      }
    } else {
      zeigeMeldung(TEXT_ENTFERNEN_FEHLER, true);
    }
  } finally {
    setzeBeschaeftigt(false);
    // Runde 3, N3: verschwindet der geklickte Knopf (Lizenzblock, Rueckfrage), landet der Fokus auf der Meldung statt auf body.
    if (fokusVerloren()) fokussiere(meldung);
  }
});

// ---------- Start ----------

const horcher = (aenderungen: Record<string, unknown>, bereich: string): void => {
  if (bereich === 'local' && PACK_SPEICHER_SCHLUESSEL in aenderungen && !beschaeftigt) void frischeStandAuf();
};
browser.storage.onChanged.addListener(horcher);
window.addEventListener('pagehide', () => browser.storage.onChanged.removeListener(horcher), { once: true });

void gleicheAbUndZeige().then((abgleich) => {
  if (abgleich?.ergebnis === 'nachgeschrieben') zeigeMeldung(TEXT_ABGLEICH_NACHGESCHRIEBEN);
  else if (abgleich?.ergebnis === 'kurzfassung-entfernt') zeigeMeldung(TEXT_ABGLEICH_ENTFERNT);
});
