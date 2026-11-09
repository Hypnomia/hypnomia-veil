// Popup: Statuszeile, Pause, Schwelle ("Mia's mood"), Stil, Strict, Zonen und Ausnahme fuer den aktuellen Host.
// Alle Einstellungen laufen ueber src/einstellungen.ts (storage.local); der Schleier reagiert ueber storage.onChanged.
import { fensterNachVorn } from '../../src/fenster';
import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import {
  BEDECKBARE_ZONEN,
  SCHWELLE_MAX,
  SCHWELLE_MIN,
  ZONEN,
  aendereEinstellungen,
  beiEinstellungsAenderung,
  ladeEinstellungen,
  STANDARD,
  STUFEN_WAHL,
  type Einstellungen,
  type StufeWahl,
  type Zone,
} from '../../src/einstellungen';
import { hebeStufe, istStrengeZeit, naechsterWechselMs } from '../../src/kontrolle/streng';
import { STEIGERUNG_SCHLUESSEL, anzeigeStufe, vervollstaendigeStand, type SteigerungStand, type SteigerungStufe } from '../../src/steigerung';
import { STUFEN_TEXT, formatiereRest, hatErwachsenFunktionen, posePopup, waehleSatz } from '../../src/oberflaeche/erwachsen';
import { zeigeChibi } from '../../src/oberflaeche/chibi-platz';
import * as T from './texte';
import { FEHLER_SPEICHERN, STUFE_TEXT, stimmungsWort } from '../../src/oberflaeche/gemeinsam';
import type { Texte } from '../../src/quiz/vertrag';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, ladePackKurz, presetFuerPackKurz, type PackKurz } from '../../src/pack/vertrag';
import { PRESETS } from '../../src/presets';
import { presetVorschau } from '../../src/oberflaeche/presets-ansicht';
import { beobachteGesichter, type GesichterStand } from '../../src/oberflaeche/gesichter-status';
import { packHinweis, presetSatz, zonenHinweis } from '../../src/oberflaeche/preset-texte';
// Session 11 (PHASE-6-AUFTRAEGE-SESSION-11.md): eigene Module je Auftrag, jedes zeichnet nur seinen Platz.
import './einstieg-hinweis';
import './version-hinweis';
import './ledger-kurz';
import './design';
import './werbung-frage';
import { aufEigenerListe, aufStandardListe, leseSeite, musterFuerSeite, zeichneDieseSeite } from './diese-seite';
import { hilfeAdresse } from '../../src/hilfe/anker';
import { belebeRegler } from '../../src/oberflaeche/design/regler';

belebeRegler(); // Phase 8b: gemeinsamer Regler, Fuellung bis zum Wert auch in Chromium

const ZONEN_NAMEN: Record<Zone, string> = {
  eyes: 'Eyes',
  mouth: 'Mouth',
  face: 'Face',
  head: 'Head',
  breast: 'Breasts',
  genitals: 'Genitals',
  buttocks: 'Buttocks',
  belly: 'Belly',
  feet: 'Feet',
  armpits: 'Armpits',
};

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element ${id} fehlt`);
  return e as T;
}

const statusZeile = el<HTMLParagraphElement>('status');
const pauseKnopf = el<HTMLButtonElement>('pause');
const stimmung = el<HTMLInputElement>('stimmung');
const stimmungWert = el<HTMLOutputElement>('stimmung-wert');
const strict = el<HTMLInputElement>('strict');
const zonenListe = el<HTMLUListElement>('zonen');
const ausnahmeKnopf = el<HTMLButtonElement>('ausnahme');
const pauseZeile = el<HTMLParagraphElement>('pause-zeile');
const pauseKuerzel = el<HTMLParagraphElement>('pause-kuerzel');
const abdeckungKurz = el<HTMLParagraphElement>('abdeckung-kurz');
const aendernKnopf = el<HTMLButtonElement>('aendern');
const gruppe = el<HTMLDivElement>('abdeckung-gruppe');
const heiss = el<HTMLDivElement>('heiss');
const heissFelder = [...document.querySelectorAll<HTMLInputElement>('input[name="stufe"]')];
const gripSatz = el<HTMLParagraphElement>('grip-satz');
const packHinweis_ = el<HTMLParagraphElement>('pack-hinweis');
const zonenHinweisZeile = el<HTMLParagraphElement>('zonen-hinweis');
const presetBild = el<HTMLSpanElement>('preset-bild');
const presetName = el<HTMLElement>('preset-name');
const presetAendern = el<HTMLButtonElement>('preset-aendern');
const packLink = el<HTMLButtonElement>('pack-link');
const fehlerZeile = el<HTMLParagraphElement>('fehler');
el<HTMLSpanElement>('ende-links').textContent = T.REGLER_ENDE_LINKS;
el<HTMLSpanElement>('ende-rechts').textContent = T.REGLER_ENDE_RECHTS;

const erwAn = el<HTMLInputElement>('erw-an');
const erwErsatz = el<HTMLInputElement>('erw-ersatz');
const erwErsatzZeile = el<HTMLLabelElement>('erw-ersatz-zeile');
const erwInhalt = el<HTMLInputElement>('erw-inhalt');
const erwSchalter = el<HTMLDivElement>('erwachsen-schalter');
const erwMehr = el<HTMLElement>('erwachsen-mehr');
const erwHinweis = el<HTMLParagraphElement>('erwachsen-hinweis');
const erwPackLink = el<HTMLButtonElement>('erwachsen-pack-link');
const erwChibi = el<HTMLImageElement>('erwachsen-chibi');
const steigerungBlock = el<HTMLDivElement>('steigerung');
const stufeZeile = el<HTMLParagraphElement>('stufe-zeile');
const stufeZeit = el<HTMLParagraphElement>('stufe-zeit');
const stufeText = el<HTMLParagraphElement>('stufe-text');
const strengZeile = el<HTMLParagraphElement>('streng-zeile');
const strengText = el<HTMLParagraphElement>('streng-text');
// Mias Kommentar in der strengen Zeit (Entwuerfe, TEXTE-PHASE-5-SESSION-10.md E3), einer je Oeffnen des Popups.
const STRENG_SAETZE = ['I’m stricter right now. You set these hours, I keep them.', 'Strict time right now. Be good for me, pet.', 'I’m stricter right now, pet.'];

let stand: SteigerungStand = vervollstaendigeStand(undefined);
let texte: Texte | null = null;
const zufall = Math.random(); // ein Satz je Oeffnen des Popups, kein Flackern bei jeder Aenderung
let chibiPose = '';

let aktuell: Einstellungen | null = null;
let pack: PackKurz | null = null;
let seite: URL | null = null;

// ---------- Anzeige ----------

function statusText(e: Einstellungen): string {
  if (e.pause) return "Paused on every page. I’ll be here when you want me back.";
  if (!seite) return 'Nothing to veil on this page. Everywhere else, I have it covered.';
  if (aufStandardListe(seite)) return 'This site is on my never-touch list: banks, mail, that sort of thing. Nothing is covered here.';
  if (aufEigenerListe(seite, e)) return T.STATUS_AUSNAHME;
  return "On watch. I’ll keep the pages quiet for you.";
}

// UX-Fund 6: ein Wort statt der rohen Zahl, auch als aria-valuetext des Reglers.
function zeigeStimmung(schwelle: number): void {
  const wort = stimmungsWort(schwelle) + (Math.round(schwelle * 100) === Math.round(STANDARD.schwelle * 100) ? ' (my default)' : '');
  stimmungWert.textContent = wort;
  stimmung.setAttribute('aria-valuetext', wort);
}

function zeichne(e: Einstellungen): void {
  aktuell = e;
  document.documentElement.dataset.ruhig = String(e.ruhig);
  statusZeile.textContent = statusText(e);

  pauseKnopf.textContent = e.pause ? 'Let Mia back in' : 'Pause Mia';
  pauseKnopf.setAttribute('aria-pressed', String(e.pause));
  // Fund 17: im Pausenzustand eine Zeile unter dem Knopf, die Karten darunter blasser (main:has im CSS).
  pauseZeile.textContent = e.pause ? T.PAUSE_ZEILE : '';
  pauseZeile.hidden = !e.pause;

  if (document.activeElement !== stimmung) stimmung.value = e.schwelle.toFixed(2);
  zeigeStimmung(e.schwelle);

  zeichnePreset(e);
  strict.checked = e.strict;

  for (const zone of ZONEN) {
    const an = document.querySelector<HTMLInputElement>(`input[data-zone="${zone}"]`);
    if (an) an.checked = e.zonen[zone].an;
    const bedeckt = document.querySelector<HTMLInputElement>(`input[data-bedeckt="${zone}"]`);
    if (bedeckt) {
      bedeckt.checked = !!e.zonen[zone].bedeckt;
      bedeckt.disabled = !e.zonen[zone].an;
    }
  }

  abdeckungKurz.textContent = PRESETS[e.preset].augen === 'nur-balken' ? T.ABDECKUNG_AUGENBALKEN : T.ABDECKUNG_KURZ(ZONEN.filter((z) => e.zonen[z].an).map((z) => ZONEN_NAMEN[z].toLowerCase()));
  zeichneDieseSeite(e, seite);
  zeichneErwachsen(e);
}

// Stand der Gesichtssuche (Zahl der Patch-Bilder mit Gesicht im Satz)
let gesichter: GesichterStand | null = null;
let beobachtung: (() => void) | null = null;
function beobachteNeu(): void {
  beobachtung?.();
  beobachtung = beobachteGesichter((s) => {
    gesichter = s;
    if (aktuellE) zeichnePreset(aktuellE);
  });
}
let aktuellE: Einstellungen | null = null;

// Cover style: das Preset, das wirklich gilt (Mia-Presets nur mit Pack), mit Vorschau, Name und Satz; gewaehlt wird auf der Einstellungsseite.
function zeichnePreset(e: Einstellungen): void {
  aktuellE = e;
  const frei = istFreigeschaltet(pack, 'stil:mia-patch');
  const gilt = presetFuerPackKurz(e.preset, pack);
  presetBild.innerHTML = presetVorschau(gilt, 'popup');
  presetName.textContent = PRESETS[gilt].name;
  // Sperre der Mia-Presets: der Hinweis auf das Pack hat Vorrang, sonst der Satz zum Preset.
  const gesperrt = PRESETS[e.preset].braucht === 'pack' && !frei;
  // Ohne Pack steht dabei, was bis dahin gilt (Mosaik); mit Pack aber ohne brauchbares Patch der Hinweis des Packs allein.
  packHinweis_.textContent = gesperrt ? packHinweis(frei, pack) + (pack ? '' : T.PACK_HINWEIS_BIS_DAHIN) : presetSatz(gilt, frei, frei && gesichter?.fertig ? gesichter.mit : null);
  // Mia-Preset gilt, aber Face steht aus: sagen, was dann gilt (der Satz der Karte klaenge sonst nach mehr)
  if (!gesperrt && PRESETS[gilt].gesicht === 'mia-gesicht' && !e.zonen.face.an) packHinweis_.textContent += ` ${T.HINWEIS_FACE_AUS}`;
  const zh = zonenHinweis(gilt);
  zonenHinweisZeile.hidden = zh === '';
  zonenHinweisZeile.textContent = zh;
  // Beschriftung und Ziel aus derselben Bedingung: mit Pack "settings" (#stand), ohne Pack "Get the Mia Pack" (#neu)
  packLink.textContent = pack ? T.PACK_KNOPF_MIT : T.PACK_KNOPF_OHNE;
}

// ---------- Adult sites ----------

// Schalter nur mit Pack (und passender Freischaltung), sonst ein Hinweis. Die Steigerung nur mit `zensur:steigerung`.
function zeichneErwachsen(e: Einstellungen): void {
  // Drei Lagen: kein Pack (Hinweis und Weg zum Pack), Pack ohne Erwachsenen-Freischaltung (Abschnitt bleibt still), Pack mit Funktionen.
  const mitErw = hatErwachsenFunktionen(pack);
  const mitSteigerung = istFreigeschaltet(pack, 'zensur:steigerung');
  const ohnePack = !pack;
  el<HTMLElement>('erwachsen').hidden = !ohnePack && !mitErw && !mitSteigerung;
  erwSchalter.hidden = !mitErw;
  erwMehr.hidden = !(mitErw && istFreigeschaltet(pack, 'erwachsen:ersatz'));
  // Die Saetze zu Adult-site mode nur mit `erwachsen:vorschau`; sonst bleibt der Hinweis verborgen (ausser ohne Pack).
  erwHinweis.hidden = !ohnePack && !istFreigeschaltet(pack, 'erwachsen:vorschau');
  erwPackLink.hidden = !ohnePack;
  erwAn.checked = e.erwachsen.an;
  erwErsatz.checked = e.erwachsen.komplettErsatz;
  erwInhalt.checked = e.erwachsen.erkennenAmInhalt;
  // Fund 10: "How hot do I get?" als Dreier-Wahl, nur mit erwachsen:vorschau (wie auf der Einstellungsseite).
  heiss.hidden = !istFreigeschaltet(pack, 'erwachsen:vorschau');
  for (const f of heissFelder) f.checked = f.value === e.erwachsen.stufe;
  erwAn.closest('label')!.hidden = !istFreigeschaltet(pack, 'erwachsen:vorschau');
  erwErsatzZeile.hidden = !istFreigeschaltet(pack, 'erwachsen:ersatz');
  steigerungBlock.hidden = !mitSteigerung;
  if (ohnePack) {
    erwHinweis.textContent = 'These sites need the Mia Pack. Get it and I’ll look after them properly.';
  } else if (e.pause) {
    erwHinweis.textContent = "Paused, so I’m keeping my hands off these sites too.";
  } else {
    erwHinweis.textContent = e.erwachsen.an ? "I know the usual places. Nothing there gets by me." : T.ERW_HINWEIS_AUS;
  }
  zeichneStufe(e);
}

function zeichneStufe(e: Einstellungen): void {
  const hat = istFreigeschaltet(pack, 'zensur:steigerung');
  const a = anzeigeStufe(stand, Date.now());
  // Strenge Zeit (Auftrag Z1): Freischaltung `kontrolle:zeitplan`, ein Fenster passt jetzt, keine Pause. Die Stufe steigt dann um eins,
  // der gespeicherte Stand bleibt unveraendert.
  const jetzt = new Date();
  const zeiten = e.kontrolle.zeiten;
  const streng = !e.pause && istFreigeschaltet(pack, 'kontrolle:zeitplan') && istStrengeZeit(zeiten, jetzt);
  const stufe = hebeStufe(a.stufe, streng && hat) as SteigerungStufe;
  const pose = posePopup(e.pause, hat ? stufe : 0);
  if (pose !== chibiPose) {
    chibiPose = pose;
    erwChibi.dataset.pose = pose;
    void zeigeChibi(erwChibi, pose, pack);
  }
  // Sekundentakt nur, solange die Steigerung oder eine strenge Zeit sichtbar ist.
  const sichtbar = hat || streng;
  if (sichtbar && tickerId === null) tickerId = window.setInterval(() => aktuell && zeichneStufe(aktuell), 1000);
  if (!sichtbar && tickerId !== null) {
    clearInterval(tickerId);
    tickerId = null;
  }
  strengZeile.hidden = !streng;
  strengText.hidden = !streng;
  if (streng) {
    const ms = naechsterWechselMs(zeiten, jetzt);
    const ende = ms === null ? null : new Date(jetzt.getTime() + ms);
    strengZeile.textContent = ende ? `Strict time until ${ende.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}` : 'Strict time, around the clock';
    strengText.textContent = STRENG_SAETZE[Math.min(STRENG_SAETZE.length - 1, Math.floor(zufall * STRENG_SAETZE.length))]!;
  } else {
    strengZeile.textContent = '';
    strengText.textContent = '';
  }
  if (!hat) return;
  gripSatz.textContent = PRESETS[e.preset].augen === 'nur-balken' ? `${T.GRIP_SATZ} ${T.GRIP_AUGENBALKEN}` : T.GRIP_SATZ;
  const stufeKlein = STUFE_TEXT(stufe);
  stufeZeile.textContent = stufeKlein.charAt(0).toUpperCase() + stufeKlein.slice(1);
  // Pause zaehlt sofort (Einstellungen), nicht erst, wenn der Hintergrund `pauseSeit` geschrieben hat.
  if (a.stufe === 0) stufeZeit.textContent = streng ? 'One level up for these hours.' : 'Nothing to count down yet.';
  else if (e.pause || a.pausiert) stufeZeit.textContent = "Paused, so the clock stands still. It picks up where it stopped.";
  else stufeZeit.textContent = `Next level down in ${formatiereRest(a.bisAbsenkungMs ?? 0)}`;
  const gruppe = texte?.gruppen[`stufe${stufe}` as 'stufe1'];
  stufeText.textContent = waehleSatz(stufe === 0 ? undefined : gruppe, STUFEN_TEXT[stufe], zufall);
}
let tickerId: number | null = null;
window.addEventListener('pagehide', () => {
  if (tickerId !== null) clearInterval(tickerId);
  tickerId = null;
});

// Der Wert wird beim Ereignis festgehalten (nicht erst in der Schreibkette gelesen): schnelle Folgeklicks ueberholen sich nicht.
erwAn.addEventListener('change', () => {
  const wert = erwAn.checked;
  void aendere((alt) => ({ erwachsen: { ...alt.erwachsen, an: wert } }));
});
erwErsatz.addEventListener('change', () => {
  const wert = erwErsatz.checked;
  void aendere((alt) => ({ erwachsen: { ...alt.erwachsen, komplettErsatz: wert } }));
});
erwInhalt.addEventListener('change', () => {
  const wert = erwInhalt.checked;
  void aendere((alt) => ({ erwachsen: { ...alt.erwachsen, erkennenAmInhalt: wert } }));
});
// UX-Fund 7: die Pack-Knoepfe oeffnen die Einstellungsseite gleich beim Pack-Abschnitt (#neu ohne Pack, #stand mit Pack).
// Ist die Einstellungsseite schon offen, wird dieser Tab nach vorn geholt und auf den Anker gesetzt (kein zweiter Tab); ohne neues Recht
// sieht die Erweiterung die Adressen ihrer eigenen Seiten. Scheitert etwas, faellt es auf openOptionsPage() zurueck.
// Session 17: dieselbe Logik fuer die Hilfe-Seite (`seite` = '/hilfe.html').
async function oeffneOptionen(anker: string, seite = '/options.html'): Promise<void> {
  const basis = (browser.runtime.getURL as (p: string) => string)(seite);
  const adresse = anker ? `${basis}#${anker}` : basis;
  try {
    const offene = (await browser.tabs.query({})).filter((t) => (t.url ?? '').split('#')[0] === basis);
    const da = offene[0];
    if (da?.id !== undefined) {
      await browser.tabs.update(da.id, { url: adresse, active: true });
      await fensterNachVorn(da.windowId);
    } else {
      await browser.tabs.create({ url: adresse });
    }
    window.close();
  } catch {
    if (seite === '/options.html') void browser.runtime.openOptionsPage().then(() => window.close(), () => {});
  }
}
erwPackLink.addEventListener('click', () => void oeffneOptionen('neu'));
for (const f of heissFelder) {
  f.addEventListener('change', () => {
    if (!f.checked || !(STUFEN_WAHL as readonly string[]).includes(f.value)) return;
    const wert = f.value as StufeWahl;
    void aendere((alt) => ({ erwachsen: { ...alt.erwachsen, stufe: wert } }));
  });
}

async function ladeStand(): Promise<void> {
  const a = await browser.storage.local.get(STEIGERUNG_SCHLUESSEL);
  stand = vervollstaendigeStand(a[STEIGERUNG_SCHLUESSEL]);
}

async function ladeTexte(): Promise<void> {
  const kennung = pack ? `${pack.id}|${pack.importiert}` : '';
  if (!pack || (!hatErwachsenFunktionen(pack) && !istFreigeschaltet(pack, 'zensur:steigerung'))) {
    texte = null;
    return;
  }
  let neu: Texte | null = null;
  try {
    const antwort = (await browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' })) as { ok?: boolean; daten?: unknown };
    const d = antwort?.daten as Texte | null | undefined;
    neu = d && typeof d === 'object' && 'gruppen' in d ? d : null;
  } catch {
    neu = null;
  }
  // Nur uebernehmen, wenn das Pack in der Zwischenzeit nicht gewechselt hat.
  if (pack && `${pack.id}|${pack.importiert}` === kennung) texte = neu;
}

// ---------- Zonen aufbauen ----------

for (const zone of ZONEN) {
  const zeile = document.createElement('li');
  const name = document.createElement('label');
  name.className = 'schalter';
  const an = document.createElement('input');
  an.type = 'checkbox';
  an.setAttribute('role', 'switch');
  an.dataset.zone = zone;
  const regler = document.createElement('span');
  regler.className = 'regler';
  regler.setAttribute('aria-hidden', 'true');
  const text = document.createElement('span');
  text.textContent = ZONEN_NAMEN[zone];
  name.append(an, regler, text);
  zeile.append(name);

  if (BEDECKBARE_ZONEN.has(zone)) {
    const auch = document.createElement('label');
    auch.className = 'auch';
    auch.title = 'Also cover this when it is under clothing';
    const bedeckt = document.createElement('input');
    bedeckt.type = 'checkbox';
    bedeckt.dataset.bedeckt = zone;
    // UX-Fund 12: der Bildschirmleser nennt die Zone mit (wie auf der Einstellungsseite).
    bedeckt.setAttribute('aria-label', `${ZONEN_NAMEN[zone]}: even when clothed`);
    auch.append(bedeckt, document.createTextNode('even when clothed'));
    zeile.append(auch);
  }
  zonenListe.append(zeile);
}

// ---------- Aenderungen schreiben (immer auf den frisch geladenen Stand aufsetzen) ----------

// Die Funktion wird innerhalb der Kette von aendereEinstellungen auf den frisch gelesenen Stand angewendet (atomar auch gegen
// Hintergrund und Content-Skripte).
// `offen` zaehlt noch nicht geschriebene Aenderungen: solange eine laeuft, setzt kein Neuzeichnen (weder das Ergebnis eines frueheren
// Schreibens noch storage.onChanged) einen spaeteren Klick zurueck. Nach dem letzten Schreiben zeigt die Anzeige den gespeicherten Stand.
// Scheitert das Speichern (UX-Fund 26), kommt der gemeinsame Fehlersatz und Schalter und Regler springen auf den gespeicherten Stand zurueck.
let offen = 0;
let fehlerSeitRuhe = false;
let letzteSchreibung = 0;
async function aendere(teil: (alt: Einstellungen) => Partial<Einstellungen>): Promise<void> {
  offen++;
  let neu: Einstellungen | null = null;
  let gescheitert = false;
  try {
    neu = await aendereEinstellungen(teil);
  } catch {
    gescheitert = true;
  }
  offen--;
  letzteSchreibung = Date.now();
  // Ein Fehler bleibt stehen, bis alle offenen Schreibvorgaenge durch sind; ein spaeterer, gelungener Klick blendet ihn nicht aus.
  if (gescheitert) {
    fehlerSeitRuhe = true;
    fehlerZeile.textContent = FEHLER_SPEICHERN;
    fehlerZeile.hidden = false;
  }
  if (offen > 0) return;
  if (!fehlerSeitRuhe) {
    fehlerZeile.hidden = true;
    fehlerZeile.textContent = '';
  }
  // Die Anzeige wird gleich auf den gespeicherten Stand gestellt; ab dem naechsten Schreibvorgang zaehlt neu.
  const hatteFehler = fehlerSeitRuhe;
  fehlerSeitRuhe = false;
  if (neu && !hatteFehler) {
    zeichne(neu);
    return;
  }
  try {
    const gespeichert = await ladeEinstellungen();
    if (document.activeElement === stimmung) stimmung.value = gespeichert.schwelle.toFixed(2);
    zeichne(gespeichert);
  } catch {
    /* Anzeige bleibt, der Fehlersatz steht */
  }
}

// Das Ziel wird beim Klick aus der Beschriftung festgehalten, nicht in der Schreibkette aus dem frischen Stand umgekehrt:
// hat ein anderes Fenster inzwischen pausiert, hebt der Klick auf "Pause Mia" die Pause nicht auf.
pauseKnopf.addEventListener('click', () => {
  const ziel = pauseKnopf.getAttribute('aria-pressed') !== 'true';
  pauseKnopf.setAttribute('aria-pressed', String(ziel));
  void aendere(() => ({ pause: ziel }));
});

stimmung.min = String(SCHWELLE_MIN);
stimmung.max = String(SCHWELLE_MAX);
// Beim Ziehen nur die Zahl nachfuehren; gespeichert wird erst beim Loslassen (change). Jede Speicherung setzt auf allen Seiten
// alle Urteile zurueck, ein Schreiben im Takt waehrend des Ziehens liesse sie laufend neu pruefen.
stimmung.addEventListener('input', () => {
  zeigeStimmung(Number(stimmung.value));
});
stimmung.addEventListener('change', () => {
  const wert = Number(stimmung.value);
  void aendere(() => ({ schwelle: wert }));
});

presetAendern.addEventListener('click', () => void oeffneOptionen('abschnitt-stil'));

strict.addEventListener('change', () => {
  const wert = strict.checked;
  void aendere(() => ({ strict: wert }));
});

zonenListe.addEventListener('change', (ereignis) => {
  const feld = ereignis.target as HTMLInputElement;
  const zone = (feld.dataset.zone ?? feld.dataset.bedeckt) as Zone | undefined;
  if (!zone) return;
  const istAn = !!feld.dataset.zone;
  const wert = feld.checked;
  void aendere((alt) => {
    const z = { ...alt.zonen[zone] };
    if (istAn) z.an = wert;
    else z.bedeckt = wert;
    return { zonen: { ...alt.zonen, [zone]: z } };
  });
});

// Einstellungsseite des Packs oeffnen; das Popup schliesst sich danach von selbst (Firefox) bzw. wir schliessen es.
packLink.addEventListener('click', () => void oeffneOptionen(pack ? 'stand' : 'neu'));

ausnahmeKnopf.addEventListener('click', () => {
  if (!seite) return;
  const url = seite;
  const muster = musterFuerSeite(url);
  if (!muster) return;
  // Die Richtung steht beim Klick fest (nach der Beschriftung des Knopfs), nicht nach dem frischen Stand.
  const hinzu = ausnahmeKnopf.dataset.modus !== 'weg';
  ausnahmeKnopf.dataset.modus = hinzu ? 'weg' : 'hinzu';
  void aendere((alt) => {
    // Entfernen: alle eigenen Muster, die diese Seite treffen. Hinzufuegen: das Host-Muster, ohne Doppelte.
    const ausnahmen = hinzu
      ? [...new Set([...alt.ausnahmen, muster])]
      : alt.ausnahmen.filter((m) => !passtAusnahme(url, [m]));
    return { ausnahmen };
  });
});

// ---------- Start ----------

el<HTMLAnchorElement>('version').textContent = `v${browser.runtime.getManifest().version}`;

// Fund 16 und 27: Fuss-Links und "?" an My grip nur ueber die festen Hilfe-Anker (Erweiterungsseite, neuer Tab).
el<HTMLAnchorElement>('version').href = hilfeAdresse('updates');
{
  const versionText = `What’s new in v${browser.runtime.getManifest().version}`;
  el<HTMLAnchorElement>('version').title = versionText;
  el<HTMLAnchorElement>('version').setAttribute('aria-label', versionText);
}
el<HTMLAnchorElement>('deinstallieren').href = hilfeAdresse('uninstall');
const gripHilfe = el<HTMLAnchorElement>('grip-hilfe');
gripHilfe.href = hilfeAdresse('grip');
gripHilfe.setAttribute('aria-label', T.GRIP_HILFE);
gripHilfe.title = T.GRIP_HILFE;

// Fund 15: das Kuerzel zur Pause steht leise unter dem Knopf, gelesen aus den Tastenbelegungen des Browsers (eine geaenderte Belegung
// stimmt dann auch). Leer, wenn es keine Belegung gibt (Android hat keine Kuerzel).
void (async () => {
  try {
    const befehle = await browser.commands.getAll();
    const kuerzel = befehle.find((b) => b.name === 'pause-umschalten')?.shortcut ?? '';
    pauseKuerzel.textContent = kuerzel ? T.PAUSE_KUERZEL(kuerzel) : '';
    pauseKuerzel.hidden = !kuerzel;
  } catch {
    pauseKuerzel.hidden = true;
  }
})();

// Fund 2: "Change" klappt Mood, Zonen und Strict auf. Der Zustand bleibt in localStorage (nur eine Bequemlichkeit, ohne ihn ist es zu).
const GRUPPE_SCHLUESSEL = 'veil-popup-aendern';
function setzeGruppe(offen: boolean, merken: boolean): void {
  gruppe.hidden = !offen;
  aendernKnopf.setAttribute('aria-expanded', String(offen));
  aendernKnopf.textContent = offen ? T.AENDERN_AUF : T.AENDERN_ZU;
  if (!merken) return;
  try {
    localStorage.setItem(GRUPPE_SCHLUESSEL, offen ? '1' : '0');
  } catch {
    /* ohne Speicher bleibt es beim Zustand dieser Sitzung */
  }
}
let gemerkt = false;
try {
  gemerkt = localStorage.getItem(GRUPPE_SCHLUESSEL) === '1';
} catch {
  gemerkt = false;
}
setzeGruppe(gemerkt, false);
aendernKnopf.addEventListener('click', () => setzeGruppe(aendernKnopf.getAttribute('aria-expanded') !== 'true', true));

// Ereignisse eigener, frueherer Schreibvorgaenge koennen nach dem letzten Zeichnen eintreffen und einen alten Stand zeigen: waehrend
// offener Schreibvorgaenge und kurz danach wird nicht aus dem Ereignis gezeichnet, sondern spaeter aus dem gespeicherten Stand.
const abmelden = beiEinstellungsAenderung((e) => {
  if (offen > 0) {
    aktuell = e;
    return;
  }
  if (Date.now() - letzteSchreibung < 300) {
    window.setTimeout(() => {
      if (offen === 0) void ladeEinstellungen().then((g) => offen === 0 && zeichne(g), () => undefined);
    }, 320);
    return;
  }
  zeichne(e);
});
// Das Pack (storage.local.pack) kann sich aendern, waehrend das Popup offen ist (Import auf der Einstellungsseite).
const packHorcher = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
  if (bereich === 'local' && STEIGERUNG_SCHLUESSEL in aenderungen) {
    stand = vervollstaendigeStand(aenderungen[STEIGERUNG_SCHLUESSEL]?.newValue);
    if (aktuell) zeichneStufe(aktuell);
  }
  if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aenderungen)) return;
  const neu = aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue as PackKurz | undefined;
  pack = neu && typeof neu === 'object' && typeof neu.id === 'string' ? neu : null;
  chibiPose = '';
  texte = null;
  void ladeTexte().then(() => aktuell && zeichneStufe(aktuell));
  if (istFreigeschaltet(pack, 'stil:mia-patch')) beobachteNeu();
  if (aktuell && offen === 0) zeichne(aktuell);
};
browser.storage.onChanged.addListener(packHorcher);
window.addEventListener(
  'pagehide',
  () => {
    abmelden();
    browser.storage.onChanged.removeListener(packHorcher);
  },
  { once: true },
);

void (async () => {
  seite = await leseSeite();
  pack = await ladePackKurz().catch(() => null);
  await ladeStand().catch(() => undefined);
  zeichne(await ladeEinstellungen());
  if (istFreigeschaltet(pack, 'stil:mia-patch')) beobachteNeu();
  // Pack-Texte danach nachladen, nur die Stufen-Anzeige neu zeichnen.
  void ladeTexte().then(() => aktuell && zeichneStufe(aktuell));
})();

// Session 11 (Vertrag): Weg zur Einstellungsseite (alle Einstellungen auf einem Bildschirm, Auftrag S).
document.getElementById('alle-einstellungen')?.addEventListener('click', () => void oeffneOptionen(''));
document.getElementById('hilfe')?.addEventListener('click', () => void oeffneOptionen('', '/hilfe.html'));
