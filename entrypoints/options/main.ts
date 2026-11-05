// Einstellungsseite: Mia Pack pruefen, Lizenz zeigen, importieren und entfernen (PHASE-2-BAUPLAN Abschnitt 9.3).
// Eigene Seite statt Popup, weil sich das Popup beim Dateidialog schliesst. Alle Texte aus dem Pack kommen nur per textContent auf die Seite.
import { PackFehler, pruefePack, quelleAusBlob, type GeprueftesPack, type PackFehlerCode } from '../../src/pack/format';
import { PackSpeicherFehler, entfernePack, gleicheAb, importierePack, type AbgleichErgebnis } from '../../src/pack/speicher';
import { PACK_SPEICHER_SCHLUESSEL, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { FREILEGEN_MAX_MS, FREILEGEN_MIN_MS, VERWEIGERN_MAX, VERWEIGERN_MIN, aendereEinstellungen, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';
import { hostAus } from '../../src/adapter/liste';
import { hatErwachsenFunktionen, waehleSatz } from '../../src/oberflaeche/erwachsen';
import { zeigeChibi } from '../../src/oberflaeche/chibi-platz';
import type { Texte } from '../../src/quiz/vertrag';
import { einstiegFertig, ladeEinstieg } from '../../src/einstieg/vertrag';
// Phase 5: Abschnitt "Mia’s control" (eigenes Modul).
import './kontrolle';
// Session 11 (Auftrag S): Grundeinstellungen, Ausnahmen, Einstieg und Pack-Sperre als eigene Module.
import './grund';
import './grund-ausnahmen';
import './grund-pack';
import './grund-erwachsen';
// Session 11: eigene Module je Auftrag (Ton T, Ledger L, Ueber/Version V), jedes fuellt nur seinen Abschnitt.
import './ton';
import './ledger';
import './ueber';

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

let gewaehlt: { datei: File; geprueft: GeprueftesPack } | null = null;
let beschaeftigt = false;

// ---------- Texte ----------

// Dezimal-MB, wie die Grenze von 300 MB (300 000 000 Bytes) im Format.
// Unter 1 MB in KB, damit kleine Packs nicht als "0.0 MB" erscheinen.
function megabyte(bytes: number): string {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toFixed(1)} MB`;
}

function fehlerText(e: unknown): string {
  const nichtsGespeichert = ' Nothing was stored.';
  if (!(e instanceof PackFehler)) return `Something went wrong while reading that file.${nichtsGespeichert} Try downloading the pack again.`;
  const code: PackFehlerCode = e.code;
  switch (code) {
    case 'zu-klein':
    case 'kennung':
    case 'manifest-groesse':
    case 'manifest-ungueltig':
    case 'format':
    case 'format-version':
      return `That doesn't look like a Mia Pack, so I can't read it.${nichtsGespeichert}`;
    case 'zu-gross':
      return `That file is bigger than a pack is allowed to be (300 MB).${nichtsGespeichert}`;
    case 'bildmasse':
    case 'bild-zu-gross':
      return `A picture inside is too large (over 4096 pixels on a side), or its size can't be read.${nichtsGespeichert}`;
    case 'veil-zu-alt':
      return `This pack needs a newer version of HYPNOMIA VEIL. Update first, then try again.${nichtsGespeichert}`;
    case 'sha256':
    case 'signatur':
    case 'utf8':
    case 'bereich':
    case 'ueberlappung':
    case 'lesefehler':
      return `Something inside the pack doesn't add up. The file may be damaged or cut short.${nichtsGespeichert} Try downloading the pack again.`;
    case 'lizenz':
      return `The pack has no usable license text, and I don't add packs without one.${nichtsGespeichert}`;
    case 'ton-zu-gross':
      return `One of the sounds in this pack is too big for me (1 MB at most), so the pack stays out.${nichtsGespeichert}`;
    default:
      return `The pack contains something that isn't allowed (only pictures, sounds, text and data files are), so it stays out.${nichtsGespeichert}`;
  }
}

function zeigeMeldung(text: string, fehler = false): void {
  meldung.textContent = text;
  meldung.classList.toggle('fehler', fehler);
}

// ---------- Anzeige des Packs ----------

function zeichneStand(pack: PackKurz | null, verwaist = false): void {
  entfernenFrage.hidden = true;
  if (!pack) {
    // Verwaist: Bilder liegen noch auf dem Geraet, aber ohne Pack-Eintrag. Entfernbar, damit nichts Unbenutzbares zurueckbleibt.
    packStatus.textContent = verwaist
      ? 'I found leftover pictures from an earlier pack. Remove them to start clean.'
      : 'No pack yet. Mosaic and Blur work without it.';
    packDaten.hidden = true;
    entfernenZeile.hidden = !verwaist;
    return;
  }
  packStatus.textContent = 'Pack in place. Stored on this device only.';
  el('pack-titel').textContent = pack.titel;
  el('pack-version').textContent = pack.version;
  el('pack-bilder').textContent = String(pack.bilder);
  el('pack-groesse').textContent = megabyte(pack.groesse);
  el('pack-datum').textContent = new Date(pack.importiert).toLocaleString('en-GB');
  packDaten.hidden = false;
  entfernenZeile.hidden = false;
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

function vergissAuswahl(): void {
  gewaehlt = null;
  lizenzBlock.hidden = true;
  lizenzText.textContent = '';
  lizenzKopf.textContent = '';
  fortschrittZeile.hidden = true;
  dateiFeld.value = '';
}

// ---------- Datei waehlen und pruefen ----------

dateiFeld.addEventListener('change', async () => {
  const datei = dateiFeld.files?.[0];
  if (!datei || beschaeftigt) return;
  vergissAuswahl();
  zeigeMeldung('');
  // Das Mia Pack wartet auf den Einstieg (Entscheidung 133): der Speicher entscheidet, nicht nur die Anzeige.
  if (!(await ladeEinstieg().then(einstiegFertig, () => false))) {
    zeigeMeldung('Meet me first, then bring the pack. Use the button above.', true);
    return;
  }
  setzeBeschaeftigt(true);
  fortschrittZeile.hidden = false;
  fortschritt.removeAttribute('value');
  fortschrittText.textContent = 'Reading the pack';
  try {
    const geprueft = await pruefePack(quelleAusBlob(datei), browser.runtime.getManifest().version, (fertig, gesamt) => {
      fortschritt.max = Math.max(1, gesamt);
      fortschritt.value = fertig;
      fortschrittText.textContent = `Checking file ${Math.min(fertig + 1, gesamt)} of ${gesamt} in the pack`;
    });
    gewaehlt = { datei, geprueft };
    fortschrittZeile.hidden = true;
    lizenzKopf.textContent = `${geprueft.manifest.titel}, version ${geprueft.manifest.version}, ${geprueft.patches} pictures, ${megabyte(geprueft.groesse)}. Everything checked out.`;
    lizenzText.textContent = geprueft.lizenzText;
    lizenzBlock.hidden = false;
  } catch (e) {
    fortschrittZeile.hidden = true;
    dateiFeld.value = '';
    zeigeMeldung(fehlerText(e), true);
  } finally {
    setzeBeschaeftigt(false);
  }
});

// ---------- Annehmen und importieren ----------

annehmen.addEventListener('click', async () => {
  if (!gewaehlt || beschaeftigt) return;
  const { datei, geprueft } = gewaehlt;
  // Wurde der Einstieg zurueckgesetzt, waehrend die Lizenz offen war, gilt die Sperre auch hier.
  if (!(await ladeEinstieg().then(einstiegFertig, () => false))) {
    vergissAuswahl();
    zeigeMeldung('Meet me first, then bring the pack. Use the button above.', true);
    return;
  }
  setzeBeschaeftigt(true);
  zeigeMeldung('');
  fortschrittZeile.hidden = false;
  fortschritt.removeAttribute('value');
  // Faustwert: kurzzeitig bis etwa das Doppelte der Pack-Groesse an freiem Arbeitsspeicher (siehe src/pack/speicher.ts).
  fortschrittText.textContent = `Storing the pictures. This can briefly use up to ${megabyte(geprueft.groesse * 2)} of memory.`;
  try {
    const { kurz, stilGesetzt } = await importierePack(datei, geprueft, (fertig, gesamt) => {
      fortschritt.max = Math.max(1, gesamt);
      fortschritt.value = fertig;
      fortschrittText.textContent = `Storing the pictures, file ${Math.min(fertig + 1, gesamt)} of ${gesamt}`;
    });
    vergissAuswahl();
    zeichneStand(kurz);
    zeigeMeldung(
      `There it is. The pack is in, and it never left your browser. ${kurz.bilder} pictures added. ` +
        (stilGesetzt ? 'Mia patch is your cover style now.' : "I couldn't switch the cover style for you, so pick Mia patch under Cover style."),
    );
  } catch (e) {
    fortschrittZeile.hidden = true;
    console.warn('Pack-Import fehlgeschlagen', e);
    if (e instanceof PackFehler) {
      // Die Datei hat sich seit der Pruefung veraendert: nichts wurde geschrieben.
      vergissAuswahl();
      zeigeMeldung(fehlerText(e), true);
    } else if (e instanceof PackSpeicherFehler && e.ort === 'kurzfassung') {
      // IndexedDB ist fertig, storage.local nicht: die Bilder sind drin, der Abgleich beim naechsten Oeffnen schreibt den Eintrag nach.
      vergissAuswahl();
      const abgleich = await gleicheAbUndZeige();
      if (abgleich?.kurz) {
        zeigeMeldung("The pictures are stored, and I've finished setting up the pack. Pick Mia patch under Cover style to use it.");
      } else {
        zeigeMeldung("The pictures are stored, but I couldn't finish setting up the pack. Open this page again and I'll sort it out.", true);
      }
    } else {
      zeigeMeldung("The pictures couldn't be stored, and nothing changed. Try again in a moment.", true);
    }
  } finally {
    setzeBeschaeftigt(false);
  }
});

abbrechen.addEventListener('click', () => {
  if (beschaeftigt) return;
  vergissAuswahl();
  zeigeMeldung('Not yet, then. Nothing was stored.');
});

// ---------- Entfernen mit Rueckfrage ----------

entfernenKnopf.addEventListener('click', () => {
  entfernenFrage.hidden = false;
});

el<HTMLButtonElement>('entfernen-nein').addEventListener('click', () => {
  entfernenFrage.hidden = true;
});

el<HTMLButtonElement>('entfernen-ja').addEventListener('click', async () => {
  if (beschaeftigt) return;
  setzeBeschaeftigt(true);
  try {
    await entfernePack();
    zeichneStand(null);
    zeigeMeldung('Pack removed. The cover style is back to Mosaic.');
  } catch (e) {
    console.warn('Pack entfernen fehlgeschlagen', e);
    if (e instanceof PackSpeicherFehler && e.ort === 'kurzfassung') {
      // Die Bilder sind weg, die Einstellungen nicht ganz nachgezogen.
      const abgleich = await gleicheAbUndZeige();
      if (abgleich && !abgleich.kurz && abgleich.ergebnis !== 'verwaiste-dateien') {
        zeigeMeldung('Pack removed. The cover style is back to Mosaic.');
      } else {
        zeigeMeldung("The pictures are gone, but I couldn't update everything else. Open this page again and I'll finish the cleanup.", true);
      }
    } else {
      zeigeMeldung("I couldn't remove the pictures just now, so nothing changed. Try again in a moment.", true);
    }
  } finally {
    setzeBeschaeftigt(false);
  }
});

// ---------- Adult sites ----------

const seiteForm = el<HTMLFormElement>('seite-form');
const seiteFeld = el<HTMLInputElement>('seite-feld');
const seiteMeldung = el<HTMLParagraphElement>('seite-meldung');
const seitenListe = el<HTMLUListElement>('seiten-liste');
const verweigern = el<HTMLInputElement>('verweigern');
const verweigernWert = el<HTMLOutputElement>('verweigern-wert');
const freilegen = el<HTMLInputElement>('freilegen');
const freilegenWert = el<HTMLOutputElement>('freilegen-wert');
const ruhig = el<HTMLInputElement>('ruhig');
const erwPackHinweis = el<HTMLParagraphElement>('erw-pack-hinweis');
const begruessung = el<HTMLDivElement>('begruessung');
const begruessungText = el<HTMLParagraphElement>('begruessung-text');
const begruessungChibi = el<HTMLImageElement>('begruessung-chibi');

verweigern.min = String(Math.round(VERWEIGERN_MIN * 100));
verweigern.max = String(Math.round(VERWEIGERN_MAX * 100));
freilegen.min = String(FREILEGEN_MIN_MS / 1000);
freilegen.max = String(FREILEGEN_MAX_MS / 1000);

const FEHLER_SPEICHERN = "I couldn't save that just now. Try again in a moment.";
let gezeichneteListe = '';
function zeichneErwachsen(e: Einstellungen): void {
  const schluessel = JSON.stringify(e.erwachsen.eigeneSeiten);
  // Nur neu bauen, wenn sich die Liste aendert (fremde Aenderungen wie Pause aus dem Popup lassen den Fokus in Ruhe).
  if (schluessel !== gezeichneteListe) {
    gezeichneteListe = schluessel;
    const fokusHost = (document.activeElement as HTMLElement | null)?.dataset?.host ?? null;
    seitenListe.replaceChildren();
    for (const host of e.erwachsen.eigeneSeiten) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = host;
      const weg = document.createElement('button');
      weg.type = 'button';
      weg.className = 'klein ruhig';
      weg.dataset.host = host;
      weg.textContent = 'Remove';
      weg.setAttribute('aria-label', `Remove ${host}`);
      weg.addEventListener('click', () => {
        const stelle = (JSON.parse(gezeichneteListe) as string[]).indexOf(host);
        void aendereEinstellungen((alt) => ({ erwachsen: { ...alt.erwachsen, eigeneSeiten: alt.erwachsen.eigeneSeiten.filter((h) => h !== host) } })).then(
          (neu) => {
            // Fokus nicht verlieren: naechster Remove-Knopf, sonst der vorherige, sonst das Eingabefeld.
            zeichneErwachsen(neu);
            const knoepfe = seitenListe.querySelectorAll<HTMLButtonElement>('button');
            (knoepfe[Math.min(stelle, knoepfe.length - 1)] ?? seiteFeld).focus();
          },
          () => {
            seiteMeldung.classList.add('fehler');
            seiteMeldung.textContent = FEHLER_SPEICHERN;
          },
        );
      });
      li.append(name, weg);
      seitenListe.append(li);
      if (host === fokusHost) weg.focus();
    }
  }
  if (document.activeElement !== verweigern) verweigern.value = String(Math.round(e.quiz.verweigern * 100));
  verweigernWert.textContent = `${Math.round(e.quiz.verweigern * 100)}%`;
  verweigern.setAttribute('aria-valuetext', verweigernWert.textContent);
  if (document.activeElement !== freilegen) freilegen.value = String(Math.round(e.quiz.freilegenMs / 1000));
  freilegenWert.textContent = `${Math.round(e.quiz.freilegenMs / 1000)} s`;
  freilegen.setAttribute('aria-valuetext', freilegenWert.textContent);
  ruhig.checked = e.ruhig;
}

seiteForm.addEventListener('submit', (ereignis) => {
  ereignis.preventDefault();
  const host = hostAus(seiteFeld.value);
  seiteMeldung.classList.toggle('fehler', !host);
  if (!host) {
    seiteMeldung.textContent = "That doesn't look like a site address. Try something like example.com.";
    return;
  }
  let schonDa = false;
  aendereEinstellungen((alt) => {
    schonDa = alt.erwachsen.eigeneSeiten.includes(host);
    return schonDa ? {} : { erwachsen: { ...alt.erwachsen, eigeneSeiten: [...alt.erwachsen.eigeneSeiten, host] } };
  }).then(
    () => {
      seiteMeldung.classList.remove('fehler');
      seiteMeldung.textContent = schonDa ? `${host} is on the list already.` : `Added ${host}. I’ll treat it like the rest.`;
      seiteFeld.value = '';
    },
    () => {
      seiteMeldung.classList.add('fehler');
      seiteMeldung.textContent = FEHLER_SPEICHERN;
    },
  );
});

verweigern.addEventListener('input', () => {
  verweigernWert.textContent = `${verweigern.value}%`;
  verweigern.setAttribute('aria-valuetext', verweigernWert.textContent);
});
verweigern.addEventListener('change', () => {
  void aendereEinstellungen((alt) => ({ quiz: { ...alt.quiz, verweigern: Number(verweigern.value) / 100 } }));
});
freilegen.addEventListener('input', () => {
  freilegenWert.textContent = `${freilegen.value} s`;
  freilegen.setAttribute('aria-valuetext', freilegenWert.textContent);
});
freilegen.addEventListener('change', () => {
  void aendereEinstellungen((alt) => ({ quiz: { ...alt.quiz, freilegenMs: Number(freilegen.value) * 1000 } }));
});
ruhig.addEventListener('change', () => void aendereEinstellungen({ ruhig: ruhig.checked }));

// Begruessung mit Chibi, solange ein Pack drin ist (Platz `chibi`, ohne Bild nur Text). Satz aus der Pack-Gruppe `begruessung`, sonst eingebaut.
let begruessungFuer = '';
// Begruessung: nur kurz nach einem Import (unter einer Minute) und nur einmal je Import (storage.local `begruesstFuer`).
const BEGRUESST_SCHLUESSEL = 'begruesstFuer';
async function zeichneBegruessung(pack: PackKurz | null): Promise<void> {
  const kennung = pack ? `${pack.id}|${pack.importiert}` : '';
  let mitPack = !!pack && begruessungFuer === kennung;
  if (pack && !mitPack && Date.now() - pack.importiert < 60_000) {
    try {
      mitPack = (await browser.storage.local.get(BEGRUESST_SCHLUESSEL))[BEGRUESST_SCHLUESSEL] !== kennung;
      if (mitPack) await browser.storage.local.set({ [BEGRUESST_SCHLUESSEL]: kennung });
    } catch {
      mitPack = false;
    }
  }
  erwPackHinweis.textContent = hatErwachsenFunktionen(pack)
    ? 'Everything here is yours to set.'
    : 'These settings only work with the Mia Pack. Set them now and they’ll be ready.';
  begruessung.hidden = !mitPack;
  if (!pack || !mitPack) {
    begruessungFuer = '';
    return;
  }
  if (begruessungFuer === kennung) return;
  begruessungFuer = kennung;
  let texte: Texte | null = null;
  try {
    const a = (await browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' })) as { daten?: unknown } | undefined;
    const d = a?.daten as Texte | null | undefined;
    texte = d && typeof d === 'object' && 'gruppen' in d ? d : null;
  } catch {
    texte = null;
  }
  begruessungText.textContent = waehleSatz(texte?.gruppen.begruessung, "Welcome in. Make yourself comfortable.", Math.random());
  void zeigeChibi(begruessungChibi, 'jubeln', pack);
}

beiEinstellungsAenderung(zeichneErwachsen);
void ladeEinstellungen().then(zeichneErwachsen);
void ladePackKurz().then((p) => zeichneBegruessung(p));
browser.storage.onChanged.addListener((aenderungen: Record<string, unknown>, bereich: string) => {
  if (bereich === 'local' && PACK_SPEICHER_SCHLUESSEL in aenderungen) void ladePackKurz().then((p) => zeichneBegruessung(p));
});

// ---------- Start ----------

const horcher = (aenderungen: Record<string, unknown>, bereich: string): void => {
  if (bereich === 'local' && PACK_SPEICHER_SCHLUESSEL in aenderungen && !beschaeftigt) void frischeStandAuf();
};
browser.storage.onChanged.addListener(horcher);
window.addEventListener('pagehide', () => browser.storage.onChanged.removeListener(horcher), { once: true });

void gleicheAbUndZeige().then((abgleich) => {
  if (abgleich?.ergebnis === 'nachgeschrieben') zeigeMeldung('I found your pictures and set the pack up again.');
  else if (abgleich?.ergebnis === 'kurzfassung-entfernt') zeigeMeldung('I found a pack entry with no pictures behind it and cleaned it up.');
});
