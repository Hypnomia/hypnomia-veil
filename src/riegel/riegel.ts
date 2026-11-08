// Riegel (Auftrag Q, PHASE-4-BAUPLAN Abschnitt 8): Quiz-Oberflaeche in einer geschlossenen Shadow Root, ueber `showPopover()` in der
// obersten Ebene. Spaetere Auftraege (P Player, F Freilegen) rufen `zeigeRiegel` mit einem Aufruf. Ohne Pack oder Freischaltung kommt
// `abgebrochen` zurueck und es erscheint nichts. Der Knopf "Pause Mia" loest den Riegel sofort lokal (Ergebnis `pause`), danach erst geht
// die Nachricht an den Hintergrund; ohne dessen Antwort bleibt alles frei. Bei `ctx.onInvalidated` baut sich jeder Riegel selbst ab.
// Alle sichtbaren Texte sind Entwuerfe (Texter liest gegen); Pack-Texte laufen nur ueber `textContent`.
import { beiEinstellungsAenderung, ladeEinstellungen } from '../einstellungen';
import type { AntwortPackBild, AntwortPackDaten, NachrichtErkennerPackBild, NachrichtHintergrundHilfe, NachrichtHintergrundPackDaten, NachrichtHintergrundPause } from '../nachrichten';
import type { ChibiPose } from '../chibi';
import { begrenzeAufgabe, spiralePeriodeS, WECHSEL_SPERRE_MS, WechselSperre } from '../quiz/grenzen';
import { brauchtWarnung, istWahlRichtig, mischeReihenfolge, neuerSitzungsZustand, pruefeTippen, QuizSitzung, zaehleZulaessige, type Lage } from '../quiz/logik';
import { istFreigeschaltet, ladePackKurz } from '../pack/vertrag';
import { SatzWahl } from '../quiz/saetze';
import { pruefeQuizBank, pruefeTexte, type Frage, type QuizBank, type SatzGruppe, type Texte } from '../quiz/vertrag';
import { AUFGABEN, eingabeZeile, el, type Szene } from './aufgaben';
import { RIEGEL_CSS } from './stil';
import { meldeLokalePause } from '../pause-lokal';
import { installiereTastaturschutz, registriereHost } from './tastatur';
import { HOST_MARKE, schreibeAbbild, testRiegelAktiv } from './testspur';
import { melde } from '../ereignisse';
import { hilfeAdresse } from '../hilfe/anker';
import { augenpaar } from '../oberflaeche/design/motive';
import { ladeSeitenSchriften } from '../oberflaeche/design/schrift';
import { eigeneWurzel } from '../schleier/eigene';

export type RiegelErgebnis = 'geloest' | 'pause' | 'abgebrochen';

export interface RiegelOptionen {
  grund: 'video' | 'freilegen';
  // Flaeche, ueber die der Riegel liegt (Player, zensierte Flaeche). Ohne Anker oder auf schmalen Bildschirmen fuellt er den Sichtbereich.
  anker?: Element | null;
  signal?: AbortSignal;
  // Einspritzbar (Tests, spaetere Auftraege):
  zufall?: () => number;
  ersteFrage?: string;
  verweigern?: number;
  geraet?: 'desktop' | 'touch';
  richtigMs?: number;
  verweigertMs?: number;
  sendePause?: () => Promise<unknown>;
  ladeVerzoegerungMs?: number; // Tests: das Laden der Daten kuenstlich verzoegern
  maxRettungen?: number; // Tests: wie oft der Waechter den Host zurueckholt, bevor der Riegel mit `abgebrochen` endet (Standard 30)
}

// ---------- Kontext ----------
type Kontext = { onInvalidated(rueckruf: () => void): unknown };
let kontext: Kontext | null = null;
// Einmal beim Start des Content-Scripts: Kontext merken und den Tastenschutz installieren (ab document_start).
export function bindeKontext(ctx: Kontext): void {
  kontext = ctx;
  installiereTastaturschutz(ctx);
}

// Nur fuer den Testhaken: der gebundene Kontext (um eine Invalidierung nachzustellen).
export function gebundenerKontext(): Kontext | null {
  return kontext;
}

export const WARNUNG_SCHLUESSEL = 'quizWarnungGesehen';
// Session 17 (UX Fund 24): beim ersten Riegel je Installation steht unter der Frage eine Zeile, warum er kommt (Merker im Speicher).
export const ERKLAERT_SCHLUESSEL = 'riegelErklaert';
const RICHTIG_MS = 900;
const VERWEIGERT_MS = 1600;
const MIN_BREITE = 320;
const MIN_HOEHE = 300;
const SCHMAL = 520;
// Ein Anker unter dieser Hoehe ist zu klein fuer Karte, Chibi und Antworten: der Riegel fuellt dann wie auf schmalen Bildschirmen den Sichtbereich.
const KLEINER_ANKER_HOEHE = 420;

// ---------- Daten ----------
async function holeDaten(rolle: 'quiz' | 'texte'): Promise<QuizBank | Texte | null> {
  try {
    const n: NachrichtHintergrundPackDaten = { ziel: 'hintergrund', typ: 'packdaten', rolle };
    const a = (await browser.runtime.sendMessage(n)) as AntwortPackDaten | undefined;
    if (!a || a.ok !== true || !a.daten) return null;
    // Noch einmal pruefen: nie Daten anzeigen, die das Schema nicht bestehen.
    return rolle === 'quiz' ? pruefeQuizBank(a.daten) : pruefeTexte(a.daten);
  } catch {
    return null;
  }
}

let warnungGemerkt = false;
async function leseWarnung(): Promise<boolean> {
  if (warnungGemerkt) return true;
  try {
    const a = await browser.storage.local.get(WARNUNG_SCHLUESSEL);
    warnungGemerkt = a[WARNUNG_SCHLUESSEL] === true;
  } catch {
    // ohne Speicher gilt: noch nicht gesehen
  }
  return warnungGemerkt;
}
function merkeWarnung(): void {
  warnungGemerkt = true;
  try {
    browser.storage.local.set({ [WARNUNG_SCHLUESSEL]: true }).catch(() => {});
  } catch {
    // Kontext weg
  }
}

let erklaertGemerkt = false;
async function leseErklaert(): Promise<boolean> {
  if (erklaertGemerkt) return true;
  try {
    const a = await browser.storage.local.get(ERKLAERT_SCHLUESSEL);
    erklaertGemerkt = a[ERKLAERT_SCHLUESSEL] === true;
  } catch {
    // ohne Speicher gilt: noch nicht erklaert
  }
  return erklaertGemerkt;
}
function merkeErklaert(): void {
  erklaertGemerkt = true;
  try {
    browser.storage.local.set({ [ERKLAERT_SCHLUESSEL]: true }).catch(() => {});
  } catch {
    // Kontext weg
  }
}

// Hilfe-Seite in neuem Tab (Content-Script: ueber die Adresse der Erweiterung).
function hilfeUrl(): string {
  try {
    return browser.runtime.getURL('/hilfe.html') + hilfeAdresse('quiz').slice('hilfe.html'.length);
  } catch {
    return '';
  }
}

// Der Hintergrund oeffnet den Tab: eine Webseite (und damit ein Content-Script) darf die Adresse der Erweiterung nicht selbst oeffnen.
function oeffneHilfe(e: Event): void {
  e.preventDefault();
  try {
    const n: NachrichtHintergrundHilfe = { ziel: 'hintergrund', typ: 'hilfe', anker: 'quiz' };
    void Promise.resolve(browser.runtime.sendMessage(n)).catch(() => undefined);
  } catch {
    // Kontext weg
  }
}

const chibiCache = new Map<string, Promise<string | null>>();
function ladeChibi(pose: ChibiPose): Promise<string | null> {
  let p = chibiCache.get(pose);
  if (!p) {
    const n: NachrichtErkennerPackBild = { ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: pose };
    const frage = Promise.resolve()
      .then(() => browser.runtime.sendMessage(n) as Promise<AntwortPackBild | { ok: false } | undefined>)
      .then((a) => (a && a.ok === true && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/') ? a.dataUrl : null))
      .catch(() => null);
    const frist = new Promise<null>((ok) => setTimeout(() => ok(null), 5000));
    p = Promise.race([frage, frist]);
    chibiCache.set(pose, p);
    p.then((u) => {
      if (!u) chibiCache.delete(pose);
    });
  }
  return p;
}

function erkenneGeraet(): 'desktop' | 'touch' {
  try {
    return matchMedia('(any-pointer: fine)').matches ? 'desktop' : 'touch';
  } catch {
    return 'desktop';
  }
}
const bewegungReduziert = (): boolean => {
  try {
    return matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
};

// ---------- Spirale ----------
const SVG_NS = 'http://www.w3.org/2000/svg';
function baueSpirale(groesse: number, periodeS: number | null, dreht: boolean): SVGElement {
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', '-50 -50 100 100');
  svg.setAttribute('width', String(groesse));
  svg.setAttribute('height', String(groesse));
  svg.setAttribute('aria-hidden', 'true');
  const grund = document.createElementNS(SVG_NS, 'circle');
  grund.setAttribute('r', '48');
  grund.setAttribute('fill', '#ffffff');
  grund.setAttribute('fill-opacity', '0.7');
  svg.append(grund);
  for (let arm = 0; arm < 2; arm++) {
    let d = '';
    for (let t = 0; t <= 18; t += 0.2) {
      const r = 1 + 2.5 * t;
      const x = (r * Math.cos(t + arm * Math.PI)).toFixed(2);
      const y = (r * Math.sin(t + arm * Math.PI)).toFixed(2);
      d += `${t === 0 ? 'M' : 'L'}${x} ${y} `;
    }
    const pfad = document.createElementNS(SVG_NS, 'path');
    pfad.setAttribute('d', d);
    pfad.setAttribute('fill', 'none');
    pfad.setAttribute('stroke', arm === 0 ? '#ff7ab8' : '#9d7bff');
    pfad.setAttribute('stroke-width', '5');
    pfad.setAttribute('stroke-linecap', 'round');
    svg.append(pfad);
  }
  svg.setAttribute('class', 'spirale');
  if (periodeS !== null) svg.style.animationDuration = `${periodeS}s`;
  schalteDrehen(svg, periodeS !== null && dreht);
  return svg;
}
function schalteAugen(g: SVGElement, an: boolean): void {
  g.classList.toggle('v-dreht', an);
}
function schalteDrehen(svg: SVGElement, an: boolean): void {
  const klasse = (svg.getAttribute('class') ?? '').split(' ').filter((k) => k && k !== 'dreht');
  if (an) klasse.push('dreht');
  svg.setAttribute('class', klasse.join(' '));
}

// ---------- Riegel ----------
// API: ein Riegel je Tab (Frame). Ein zweiter Aufruf mit gleichem Grund und gleichem Anker teilt das Ergebnis des offenen Riegels; ein Aufruf
// mit anderem Grund oder Anker bekommt sofort `abgebrochen`. Die Freischaltung wird je Grund geprueft (`video`: erwachsen:quiz, `freilegen`:
// quiz:freilegen); ohne sie, ohne gueltige Quiz-Bank oder mit weniger als zwei zulaessigen Fragen kommt `abgebrochen` und nichts erscheint.
// Pause bei Aufruf oder waehrend des Ladens: `pause`.
let aktuell: { grund: RiegelOptionen['grund']; anker: Element | null; ergebnis: Promise<RiegelErgebnis> } | null = null;
// Auswahlstand und letzte Verweigerung gelten je Tab ueber Riegel hinweg.
const sitzungsZustand = neuerSitzungsZustand();
const LADE_FRIST_MS = 5000;

// Phase 5 (Vertrag Session 9): steht gerade ein Riegel (auch waehrend er laedt)? Blitzwoerter und Leerlauf-Spirale ruhen dann.
export function riegelOffen(): boolean {
  return aktuell !== null;
}

export function zeigeRiegel(opt: RiegelOptionen): Promise<RiegelErgebnis> {
  const anker = opt.anker ?? null;
  if (aktuell) return aktuell.grund === opt.grund && aktuell.anker === anker ? aktuell.ergebnis : Promise.resolve('abgebrochen');
  const eintrag = { grund: opt.grund, anker, ergebnis: null as unknown as Promise<RiegelErgebnis> };
  eintrag.ergebnis = starte(opt).finally(() => {
    if (aktuell === eintrag) aktuell = null;
  });
  aktuell = eintrag;
  return eintrag.ergebnis;
}

// ---------- Blitz-Grenze ueber Oeffnen und Schliessen hinweg (je Tab, Modulebene) ----------
// Jedes Erscheinen und Verschwinden des Riegels ist ein vollflaechiger Wechsel (CLAUDE.md Regel 9: hoechstens 3 je Sekunde). Schliessen
// (Pause, geloest, abgebrochen) geschieht immer sofort und wird nur gezaehlt. Das Oeffnen (und jede Rettung) wartet unsichtbar: ein
// Oeffnen zaehlt doppelt (es folgt immer ein Schliessen), darum darf im gleitenden Fenster von 1 s vorher hoechstens ein Wechsel liegen.
const wechselZeiten: number[] = [];
// 1 s plus Sicherheitsabstand: Zeichenverzug des Browsers darf einen Wechsel nicht in das naechste Sekundenfenster schieben
// (Messung MESSUNG-PHASE-4 B2: mit genau 1 s einmal 4 Wechsel in Chromium).
const WECHSEL_FENSTER_MS = 1250;
function merkeWechsel(): void {
  wechselZeiten.push(performance.now());
  if (wechselZeiten.length > 8) wechselZeiten.shift();
}
// Wartezeit bis zum naechsten erlaubten Oeffnen in ms (0 = sofort).
function oeffnenIn(): number {
  if (wechselZeiten.length < 2) return 0;
  return Math.max(0, wechselZeiten[wechselZeiten.length - 2]! + WECHSEL_FENSTER_MS - performance.now());
}

// Wartet auf `p`, hoechstens `ms`, und bricht mit dem Signal ab; Zeitablauf und Abbruch liefern `null`.
function mitFrist<T>(p: Promise<T>, ms: number, signal?: AbortSignal): Promise<T | null> {
  return new Promise((ok) => {
    const id = setTimeout(() => ok(null), ms);
    const ab = () => ok(null);
    signal?.addEventListener('abort', ab, { once: true });
    p.then(
      (w) => ok(w),
      () => ok(null),
    ).finally(() => {
      clearTimeout(id);
      signal?.removeEventListener('abort', ab);
    });
  });
}

async function starte(opt: RiegelOptionen): Promise<RiegelErgebnis> {
  installiereTastaturschutz(kontext ?? undefined);
  void ladeSeitenSchriften(); // Phase 8b: Schriften einmal je Seite; scheitert es, bleibt die Systemschrift
  if (opt.signal?.aborted) return 'abgebrochen';
  // Pause (auch aus anderem Tab oder Popup) waehrend des Ladens: schon jetzt zuhoeren, nicht erst im Riegel.
  let pauseWaehrendLaden = false;
  let wecke: (() => void) | null = null;
  const abmelden = beiEinstellungsAenderung((neu) => {
    if (neu.pause) {
      pauseWaehrendLaden = true;
      wecke?.();
    }
  });
  const geladen = await mitFrist(
    (async () => {
      const einst = await ladeEinstellungen();
      if (einst.pause) return { pause: true as const };
      if (opt.ladeVerzoegerungMs) await new Promise((ok) => setTimeout(ok, opt.ladeVerzoegerungMs));
      const [pack, bank, texte, warnGesehen, erklaertGesehen] = await Promise.all([ladePackKurz(), holeDaten('quiz'), holeDaten('texte'), leseWarnung(), leseErklaert()]);
      // Pause waehrend des Ladens: kein Riegel
      const spaeter = await ladeEinstellungen();
      return { pause: spaeter.pause, einst: spaeter, pack, bank, texte, warnGesehen, erklaertGesehen };
    })(),
    LADE_FRIST_MS,
    opt.signal,
  );
  if (pauseWaehrendLaden) return abmelden(), 'pause';
  if (!geladen || opt.signal?.aborted) return abmelden(), 'abgebrochen';
  if (geladen.pause || !('bank' in geladen)) return abmelden(), 'pause';
  // Drosselung: unsichtbar warten, bis ein Oeffnen die Blitz-Grenze nicht verletzt; Pause und Signal beenden das Warten sofort.
  while (oeffnenIn() > 0) {
    await new Promise<void>((ok) => {
      const id = setTimeout(ok, oeffnenIn());
      const ab = () => {
        clearTimeout(id);
        ok();
      };
      wecke = ab;
      opt.signal?.addEventListener('abort', ab, { once: true });
    });
    wecke = null;
    if (pauseWaehrendLaden) return abmelden(), 'pause';
    if (opt.signal?.aborted) return abmelden(), 'abgebrochen';
  }
  abmelden();
  const { einst, pack, bank, texte, warnGesehen, erklaertGesehen } = geladen;
  if (!istFreigeschaltet(pack, opt.grund === 'video' ? 'erwachsen:quiz' : 'quiz:freilegen') || !bank) return 'abgebrochen';
  const lage: Lage = { geraet: opt.geraet ?? erkenneGeraet(), ruhig: einst.ruhig || bewegungReduziert() };
  const sitzung = new QuizSitzung(bank as QuizBank, lage, opt.verweigern ?? einst.quiz.verweigern, opt.zufall ?? Math.random, sitzungsZustand);
  // Frage vor dem Aufbau ziehen: gibt es keine (weniger als zwei zulaessige), erscheint nichts.
  if (zaehleZulaessige(bank as QuizBank, lage) < 2 && !opt.ersteFrage) return 'abgebrochen';
  // Eine erzwungene Frage muss zulaessig sein (Geraet, Ruhig-Modus), sonst erscheint nichts.
  const erste = opt.ersteFrage ? sitzung.erzwinge(opt.ersteFrage) : sitzung.naechste();
  if (!erste) return 'abgebrochen';
  return zeige(opt, sitzung, erste, (texte as Texte | null) ?? null, einst.ruhig, warnGesehen, erklaertGesehen);
}

function zeige(opt: RiegelOptionen, sitzung: QuizSitzung, ersteFrage: Frage, texte: Texte | null, ruhigEinst: boolean, warnGesehen: boolean, erklaertGesehen: boolean): Promise<RiegelErgebnis> {
  return new Promise<RiegelErgebnis>((fertig) => {
    const zufall = opt.zufall ?? Math.random;
    const bewegungAus = bewegungReduziert();
    const periode = spiralePeriodeS(undefined, { ruhig: !!ruhigEinst, bewegungAus });
    const saetze = new SatzWahl(texte, zufall);
    const sperre = new WechselSperre(() => performance.now());
    let warnOk = warnGesehen;
    let beendet = false;

    // ----- Aufbau -----
    const host = document.createElement('div');
    host.setAttribute('popover', 'manual');
    if (testRiegelAktiv()) host.setAttribute(HOST_MARKE, '');
    const wurzel = eigeneWurzel(host);
    const stil = document.createElement('style');
    stil.textContent = RIEGEL_CSS;
    const huelle = el('div', 'huelle');
    const karte = el('div', 'karte');
    karte.tabIndex = -1;
    karte.setAttribute('role', 'dialog');
    // Nur der Riegel ueber dem ganzen Sichtbereich ist modal; ueber einem Player oder einer Flaeche bleibt der Rest der Seite bedienbar.
    const vollflaechig = !opt.anker;
    if (vollflaechig) karte.setAttribute('aria-modal', 'true');
    karte.setAttribute('aria-describedby', 'frage');
    karte.setAttribute('aria-label', 'Mia quiz');
    const kopf = el('div', 'kopf');
    const pauseKnopf = el('button', 'pause', 'Pause Mia');
    pauseKnopf.type = 'button';
    // Marke: Augenpaar des Gestaltungs-Systems und "Mia’s quiz". Drehen wie die Augen vor Phase 8b: erst nach der Warnung, im Ruhig-Modus langsamer (Periode), aus bei reduzierter Bewegung.
    const marke = el('span', 'marke');
    const paar = augenpaar(26, false);
    const augenSpiralen = [...paar.querySelectorAll('g')] as SVGElement[];
    for (const g of augenSpiralen) {
      if (periode !== null) g.style.animationDuration = `${periode}s`;
      schalteAugen(g, periode !== null && warnOk);
    }
    marke.append(paar, document.createTextNode('Mia’s quiz'));
    kopf.append(marke, pauseKnopf);
    const miaZeile = el('div', 'mia');
    const chibiBild = el('img', 'chibi');
    chibiBild.hidden = true;
    chibiBild.alt = '';
    const satzFeld = el('p', 'satz');
    satzFeld.setAttribute('aria-live', 'polite');
    miaZeile.append(chibiBild, satzFeld);
    const buehne = el('div', 'buehne');
    const scroll = el('div', 'scroll');
    scroll.append(miaZeile, buehne);
    // Unsichtbare Ansage fuer Bildschirmleser: jede neue Frage (auch die sofort folgende nach einer falschen Antwort) wird hoeflich angesagt.
    const ansage = el('div', 'ansage');
    ansage.setAttribute('aria-live', 'polite');
    ansage.setAttribute('role', 'status');
    const fuss = el('div', 'fuss');
    const fussNummer = el('span', 'fuss-nr');
    fuss.append(fussNummer);
    if (ruhigEinst) fuss.append(el('span', 'fuss-ruhig', 'Calm mode is on'));
    // Fund 24: das "?" in der Fusszeile fuehrt immer zur Hilfe (Quiz); beim ersten Riegel je Installation steht dazu eine Zeile unter der Frage.
    const hilfeLink = el('a', 'hilfe-link', '?');
    hilfeLink.href = hilfeUrl();
    hilfeLink.addEventListener('click', oeffneHilfe);
    hilfeLink.setAttribute('aria-label', 'Help: Quiz');
    fuss.append(hilfeLink);
    let erklaerung: HTMLElement | null = null;
    let erklaerungLink: HTMLElement | null = null;
    if (!erklaertGesehen) {
      erklaerung = el('p', 'erklaerung', 'First time? On adult sites I quiz you before videos and reveals. Pause Mia, top right, always lets you out. ');
      const wasLink = el('a', 'hilfe-link', 'How my quiz works');
      wasLink.href = hilfeLink.href;
      wasLink.addEventListener('click', oeffneHilfe);
      erklaerung.append(wasLink);
      erklaerungLink = wasLink;
      merkeErklaert();
    }
    karte.append(kopf, scroll, ...(erklaerung ? [erklaerung] : []), fuss, ansage);
    huelle.append(karte);
    wurzel.append(stil, huelle);

    // ----- Zustand -----
    const aufraeumer: (() => void)[] = []; // Riegel insgesamt
    const frageAufr: (() => void)[] = []; // je Frage
    let tastenFns: ((e: KeyboardEvent) => void)[] = [];
    let fokusZiel: HTMLElement | null = null;
    let zustand = 'start';
    let aktuelleFrage: Frage | null = null;
    let aufgabenZustand = '';
    let chibiPose: ChibiPose = 'sprechblase';
    let abbildOffen = false;

    function abbild(): unknown {
      const r = (e: Element | null) => {
        if (!e) return null;
        const b = e.getBoundingClientRect();
        return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
      };
      const eingabeFeld = buehne.querySelector('input');
      const sp = buehne.querySelector('.spirale');
      return {
        offen: !beendet,
        zustand,
        frage: aktuelleFrage ? { id: aktuelleFrage.id, art: aktuelleFrage.art, typ: aktuelleFrage.art === 'aufgabe' ? aktuelleFrage.aufgabe.typ : null, text: aktuelleFrage.frage } : null,
        satz: satzFeld.textContent,
        ansage: ansage.textContent,
        ansageLive: ansage.getAttribute('aria-live'),
        antworten: [...buehne.querySelectorAll('.antworten button')].map((b) => ({ text: b.textContent, ...(r(b) as object) })),
        eingabe: eingabeFeld ? { wert: eingabeFeld.value, ...(r(eingabeFeld) as object) } : null,
        knoepfe: [...buehne.querySelectorAll('button')].map((b) => ({ text: b.textContent, ...(r(b) as object) })),
        pause: r(pauseKnopf),
        spirale: r(sp),
        kreis: r(buehne.querySelector('.kreis')),
        wort: buehne.querySelector('.wortfeld')?.textContent ?? null,
        wortPink: !!buehne.querySelector('.wortfeld.pink'),
        augenPeriodeS: augenSpiralen[0]!.style.animationDuration || null,
        augenDrehen: augenSpiralen[0]!.classList.contains('v-dreht'),
        fussNummer: fussNummer.textContent,
        erklaerung: erklaerung?.textContent ?? null,
        erklaerungBox: r(erklaerung),
        erklaerungLink: r(erklaerungLink),
        hilfe: r(hilfeLink),
        hilfeHref: hilfeLink.getAttribute('href'),
        marke: marke.textContent,
        aufgabe: aufgabenZustand,
        chibiPose,
        chibiBild: !chibiBild.hidden,
        fokusImRiegel: document.activeElement === host,
        host: r(host),
        karte: r(karte),
        // Sichtbarer Rollbereich der Karte: Antworten ausserhalb davon muss man erst hineinrollen (Session 18).
        scrollBox: r(scroll),
        kartenFarbe: getComputedStyle(karte).backgroundImage.slice(0, 60),
        zitat: buehne.querySelector('.zitat')?.textContent ?? null,
      };
    }
    function schreibe(): void {
      if (!testRiegelAktiv() || abbildOffen) return;
      abbildOffen = true;
      queueMicrotask(() => {
        abbildOffen = false;
        schreibeAbbild(abbild());
      });
    }
    // Nur Testbau: verschiebt sich das Layout ohne Zustandswechsel (Chibi-Bild oder Schrift geladen, Groessenwechsel, Rollen in der Karte),
    // zieht das Abbild nach. Sonst klickt ein Test auf veraltete Rechtecke (Wackler Firefox freilegen, Chromium quiz 375 px, Session 18).
    if (testRiegelAktiv() && typeof ResizeObserver === 'function') {
      const lage = new ResizeObserver(() => schreibe());
      for (const e of [karte, kopf, miaZeile, buehne]) lage.observe(e);
      scroll.addEventListener('scroll', schreibe, { passive: true });
      aufraeumer.push(() => {
        lage.disconnect();
        scroll.removeEventListener('scroll', schreibe);
      });
    }

    // ----- Beenden (alles synchron, Pause braucht keinen Hintergrund) -----
    function beende(ergebnis: RiegelErgebnis): void {
      if (beendet) return;
      beendet = true;
      zustand = 'zu';
      for (const f of frageAufr.splice(0)) f();
      for (const f of aufraeumer.splice(0)) {
        try {
          f();
        } catch {
          // Kontext weg
        }
      }
      try {
        if (host.matches(':popover-open')) host.hidePopover();
      } catch {
        // kein Popover
      }
      host.remove();
      merkeWechsel(); // Schliessen: sofort, nur gezaehlt
      if (testRiegelAktiv()) schreibeAbbild(abbild());
      fertig(ergebnis);
    }

    // ----- Szene fuer die Aufgaben -----
    const szene: Szene = {
      buehne,
      zufall,
      jetzt: () => performance.now(),
      zeit(fn, ms) {
        const id = setTimeout(() => !beendet && fn(), ms);
        frageAufr.push(() => clearTimeout(id));
      },
      takt(fn, ms) {
        const id = setInterval(() => !beendet && fn(), ms);
        frageAufr.push(() => clearInterval(id));
      },
      hoere(ziel, typ, fn, o) {
        ziel.addEventListener(typ, fn, o);
        frageAufr.push(() => ziel.removeEventListener(typ, fn, o));
      },
      taste(fn) {
        tastenFns.push(fn);
      },
      fokus(e) {
        fokusZiel = e;
        try {
          e.focus({ preventScroll: true });
          // im gescrollten Kartenbereich sichtbar machen (nur dort, die Seite scrollt nicht)
          e.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        } catch {
          // nicht fokussierbar
        }
      },
      spirale: (g) => baueSpirale(g, periode, warnOk),
      zustand(t) {
        aufgabenZustand = t;
        schreibe();
      },
    };

    // ----- Texte, Pose, Tint -----
    function setzeSatz(gruppe: SatzGruppe): void {
      satzFeld.textContent = saetze.hole(gruppe);
    }
    function setzePose(pose: ChibiPose): void {
      chibiPose = pose;
      ladeChibi(pose).then((url) => {
        if (beendet || chibiPose !== pose) return;
        if (url) {
          chibiBild.src = url;
          chibiBild.dataset.pose = pose; // UX-Pruefung 8b Nr. 3: die gemalte leere Blase der Pose sprechblase schneidet das CSS ab
          chibiBild.hidden = false;
        } else chibiBild.hidden = true;
        schreibe();
      });
    }
    // Farbwechsel der ganzen Karte nur ueber die Sperre (hoechstens 3 je Sekunde).
    // Die Toenung nimmt nach mindestens WECHSEL_SPERRE_MS wieder ab (auch das ist ein Wechsel und geht ueber die Sperre).
    let abnehmen = 0;
    function tint(klasse: 'richtig' | 'falsch'): void {
      if (!sperre.versuche()) return;
      karte.classList.remove('richtig', 'falsch');
      karte.classList.add(klasse);
      clearTimeout(abnehmen);
      const versuche = () => {
        if (beendet) return;
        if (sperre.versuche()) karte.classList.remove('richtig', 'falsch');
        else abnehmen = window.setTimeout(versuche, WECHSEL_SPERRE_MS / 2);
      };
      abnehmen = window.setTimeout(versuche, WECHSEL_SPERRE_MS);
    }
    aufraeumer.push(() => clearTimeout(abnehmen));
    function leereFrage(): void {
      for (const f of frageAufr.splice(0)) f();
      tastenFns = [];
      buehne.replaceChildren();
      aufgabenZustand = '';
    }
    function warte(ms: number): Promise<void> {
      return new Promise((ok) => {
        const id = setTimeout(ok, ms);
        aufraeumer.push(() => clearTimeout(id));
      });
    }

    // ----- Tasten (laufen ueber den Tastenschutz, siehe tastatur.ts) -----
    const abmeldenHost = registriereHost(host, (e) => {
      if (e.type === 'keydown' && e.key === 'Tab') {
        const liste = [...wurzel.querySelectorAll<HTMLElement>('button:not([disabled]), input, [tabindex="0"]')].filter((x) => !x.hidden);
        if (liste.length === 0) return;
        const jetzt = liste.indexOf(wurzel.activeElement as HTMLElement);
        const naechster = e.shiftKey ? (jetzt <= 0 ? liste.length - 1 : jetzt - 1) : jetzt === liste.length - 1 ? 0 : jetzt + 1;
        e.preventDefault();
        szene.fokus(liste[naechster]!);
        return;
      }
      for (const f of [...tastenFns]) f(e);
    });
    aufraeumer.push(abmeldenHost);

    // ----- Pause: sofort lokal, dann erst die Nachricht -----
    pauseKnopf.addEventListener('click', () => {
      beende('pause');
      meldeLokalePause(); // alle anderen Teile der Seite (Titel, Freilegen, Galerie, andere Videos) sofort frei
      try {
        const n: NachrichtHintergrundPause = { ziel: 'hintergrund', typ: 'pause', an: true };
        (opt.sendePause ? opt.sendePause() : (browser.runtime.sendMessage(n) as Promise<unknown>)).catch(() => {});
      } catch {
        // Hintergrund nicht erreichbar: der Riegel ist trotzdem weg
      }
    });

    // ----- Quellen fuer ein Ende von aussen -----
    aufraeumer.push(beiEinstellungsAenderung((neu) => neu.pause && beende('pause')));
    if (opt.signal) {
      const ab = () => beende('abgebrochen');
      opt.signal.addEventListener('abort', ab);
      aufraeumer.push(() => opt.signal!.removeEventListener('abort', ab));
    }
    try {
      const entferne = kontext?.onInvalidated(() => beende('abgebrochen'));
      if (typeof entferne === 'function') aufraeumer.push(entferne as () => void);
    } catch {
      // ohne Kontext bleibt es bei den anderen Wegen
    }

    // ----- Lage auf der Seite -----
    function legePosition(): void {
      const vb = document.documentElement.clientWidth || innerWidth;
      const vh = document.documentElement.clientHeight || innerHeight;
      let x = 0;
      let y = 0;
      let w = vb;
      let h = vh;
      const a = opt.anker;
      if (a && a.isConnected && vb >= SCHMAL) {
        const r = a.getBoundingClientRect();
        if (r.width > 0 && r.height >= KLEINER_ANKER_HOEHE) {
          w = Math.min(vb, Math.max(MIN_BREITE, r.width));
          h = Math.min(vh, Math.max(MIN_HOEHE, r.height));
          x = Math.min(Math.max(0, r.left + r.width / 2 - w / 2), vb - w);
          y = Math.min(Math.max(0, r.top + r.height / 2 - h / 2), vh - h);
        }
      }
      const s = host.style;
      const setze = (k: string, v: string) => s.setProperty(k, v, 'important');
      setze('position', 'fixed');
      setze('left', `${Math.round(x)}px`);
      setze('top', `${Math.round(y)}px`);
      setze('right', 'auto');
      setze('bottom', 'auto');
      setze('width', `${Math.round(w)}px`);
      setze('height', `${Math.round(h)}px`);
      setze('max-width', 'none');
      setze('max-height', 'none');
      setze('margin', '0');
      setze('padding', '0');
      setze('border', '0');
      setze('background', 'transparent');
      setze('overflow', 'visible');
      setze('display', 'block');
      setze('z-index', '2147483647');
      setze('color-scheme', 'light');
      setze('visibility', 'visible');
      setze('opacity', '1');
      setze('transform', 'none');
      schreibe();
    }
    let plan = 0;
    const planePosition = () => {
      if (plan) return;
      plan = requestAnimationFrame(() => {
        plan = 0;
        if (!beendet) legePosition();
      });
    };
    function zeigePopover(): void {
      try {
        if (typeof host.showPopover === 'function' && !host.matches(':popover-open')) host.showPopover();
      } catch {
        // ohne Popover bleibt die feste Lage mit hohem z-index
      }
    }
    legePosition();
    (document.documentElement ?? document.body).append(host);
    zeigePopover();
    merkeWechsel(); // Erscheinen
    aufraeumer.push(() => {
      if (plan) cancelAnimationFrame(plan);
    });
    window.addEventListener('resize', planePosition);
    window.addEventListener('scroll', planePosition, { capture: true, passive: true });
    aufraeumer.push(() => {
      window.removeEventListener('resize', planePosition);
      window.removeEventListener('scroll', planePosition, true);
    });
    if (opt.anker) {
      try {
        const ro = new ResizeObserver(planePosition);
        ro.observe(opt.anker);
        const io = new IntersectionObserver(planePosition);
        io.observe(opt.anker);
        // Verschiebt sich der Anker ohne Groessenwechsel (Umbruch der Seite), melden die Beobachter nichts: ein langsamer Takt faengt das ab.
        const lagePruefung = setInterval(planePosition, 400);
        aufraeumer.push(() => {
          ro.disconnect();
          io.disconnect();
          clearInterval(lagePruefung);
        });
      } catch {
        // Positionsbeobachter fehlen: Fenster- und Scroll-Ereignisse reichen
      }
    }
    // Vollbild: das Popover noch einmal in die oberste Ebene holen.
    const beiVollbild = () => {
      if (beendet) return;
      try {
        if (host.matches(':popover-open')) host.hidePopover();
      } catch {
        // egal
      }
      zeigePopover();
      szene.fokus(fokusZiel ?? karte);
    };
    document.addEventListener('fullscreenchange', beiVollbild);
    aufraeumer.push(() => document.removeEventListener('fullscreenchange', beiVollbild));
    // Waechter: entfernt die Seite den Host oder schliesst das Popover, holt er ihn zurueck. Die Rettungen laufen im Takt der Wechselsperre
    // (hoechstens 3 je Sekunde, kein Flackern bei einer Seite, die den Host im Kreis entfernt); sind sie aufgebraucht, endet der Riegel mit
    // `abgebrochen` (die Seite zeigt sich dann ohne Riegel, kein Lock).
    const maxRettungen = opt.maxRettungen ?? 30;
    const RETTUNG_ABSTAND_MS = 2 * WECHSEL_SPERRE_MS;
    let letzteRettung = Number.NEGATIVE_INFINITY;
    let rettungen = 0;
    let rettungGeplant = false;
    let verlustGemerkt = false;
    const rette = () => {
      if (beendet) return;
      const verloren = !host.isConnected;
      if (!verloren && (typeof host.matches !== 'function' || host.matches(':popover-open'))) return;
      if (rettungen >= maxRettungen) return beende('abgebrochen');
      // Schliessen der Seite plus unser Zeigen sind zwei Wechsel: Rettungen laufen ueber dieselbe Blitz-Grenze wie das Oeffnen,
      // und mindestens 2 x Sperre auseinander
      if (!verlustGemerkt) {
        verlustGemerkt = true;
        merkeWechsel(); // das Verschwinden (durch die Seite)
      }
      const warte = Math.max(RETTUNG_ABSTAND_MS - (performance.now() - letzteRettung), oeffnenIn());
      if (warte > 0) {
        if (!rettungGeplant) {
          rettungGeplant = true;
          const id = setTimeout(() => {
            rettungGeplant = false;
            rette();
          }, warte + 5);
          aufraeumer.push(() => clearTimeout(id));
        }
        return;
      }
      rettungen++;
      verlustGemerkt = false;
      letzteRettung = performance.now();
      if (verloren) (document.documentElement ?? document.body).append(host);
      zeigePopover();
      merkeWechsel(); // Erscheinen
      schreibe();
    };
    const waechter = new MutationObserver(rette);
    waechter.observe(document.documentElement, { childList: true });
    aufraeumer.push(() => waechter.disconnect());
    host.addEventListener('toggle', rette);
    // Fokus im Riegel halten (die Seite darf ihn nicht still stehlen).
    const fokusWacht = setInterval(() => {
      if (beendet || !document.hasFocus() || document.activeElement === host) return;
      // Mit Anker liegt der Riegel nur ueber einer Flaeche: Suchfeld, Kommentare u. a. der Seite behalten ihren Fokus. Zurueckgeholt wird nur,
      // wenn der Fokus nirgends liegt (body) oder im Anker.
      if (opt.anker) {
        const f = document.activeElement;
        if (f && f !== document.body && f !== document.documentElement && !opt.anker.contains(f)) return;
      }
      szene.fokus(fokusZiel && fokusZiel.isConnected ? fokusZiel : karte);
    }, 600);
    aufraeumer.push(() => clearInterval(fokusWacht));
    if (testRiegelAktiv()) {
      const beob = new MutationObserver(schreibe);
      beob.observe(wurzel, { subtree: true, childList: true, characterData: true, attributes: true });
      const tick = setInterval(schreibe, 200);
      aufraeumer.push(() => {
        beob.disconnect();
        clearInterval(tick);
      });
    }
    szene.fokus(karte);

    // ----- Ablauf -----
    function zeigeWarnung(): Promise<void> {
      return new Promise((weiter) => {
        zustand = 'warnung';
        buehne.append(
          el(
            'p',
            'warnung',
            'Safety first. This uses a turning spiral and moving words. Do not continue if you have photosensitive epilepsy or are prone to seizures. Calm mode slows the spiral and removes moving words, and Pause Mia stops everything at any time.',
          ),
        );
        const ok = el('button', '', 'Got it, go on');
        ok.type = 'button';
        buehne.append(ok);
        szene.hoere(ok, 'click', () => {
          warnOk = true;
          merkeWarnung();
          for (const g of augenSpiralen) schalteAugen(g, periode !== null);
          weiter();
        });
        szene.fokus(ok);
        schreibe();
      });
    }

    function zeigeWahl(frage: Extract<Frage, { art: 'wissen' | 'allgemein' }>): Promise<boolean> {
      return new Promise((ok) => {
        const fragePara = el('p', 'frage', frage.frage);
        fragePara.id = 'frage';
        buehne.append(fragePara);
        const liste = el('div', 'antworten');
        const reihenfolge = mischeReihenfolge(frage.antworten.length, zufall);
        let entschieden = false;
        const waehle = (i: number) => {
          if (entschieden) return;
          entschieden = true;
          ok(istWahlRichtig(frage, i));
        };
        reihenfolge.forEach((i, pos) => {
          const b = el('button', '', frage.antworten[i]!);
          b.type = 'button';
          b.title = String(pos + 1);
          szene.hoere(b, 'click', () => waehle(i));
          liste.append(b);
        });
        buehne.append(liste);
        szene.taste((e) => {
          if (e.type !== 'keydown' || e.ctrlKey || e.metaKey || e.altKey) return;
          const n = Number(e.key);
          if (Number.isInteger(n) && n >= 1 && n <= reihenfolge.length) waehle(reihenfolge[n - 1]!);
        });
        szene.fokus(liste.querySelector('button')!);
      });
    }

    async function zeigeTippen(frage: Extract<Frage, { art: 'tippen' }>): Promise<boolean> {
      const fragePara = el('p', 'frage', frage.frage);
      fragePara.id = 'frage';
      buehne.append(fragePara, el('div', 'zitat', frage.satz));
      return pruefeTippen(frage.satz, await eingabeZeile(szene));
    }

    let quizStartGemeldet = false;
    let frageNr = 0;
    async function frageAnzeigen(frage: Frage): Promise<boolean> {
      leereFrage();
      aktuelleFrage = frage;
      fussNummer.textContent = `Question ${++frageNr}`;
      if (brauchtWarnung(frage) && !warnOk) {
        await zeigeWarnung();
        if (beendet) return false;
        leereFrage();
      }
      // Session 11: einmal je Riegel, wenn die erste Frage wirklich steht (nach einer Warnung).
      if (!quizStartGemeldet) {
        quizStartGemeldet = true;
        melde({ art: 'quiz-start' });
      }
      zustand = 'frage';
      ansage.textContent = frage.frage;
      setzePose('sprechblase');
      schreibe();
      if (frage.art === 'aufgabe') {
        const sicher = begrenzeAufgabe(frage.aufgabe.typ, frage.aufgabe.param);
        return AUFGABEN[frage.aufgabe.typ](szene, sicher, frage);
      }
      if (frage.art === 'tippen') return zeigeTippen(frage);
      return zeigeWahl(frage);
    }

    (async () => {
      let frage: Frage | null = ersteFrage;
      setzeSatz('start');
      setzePose('sprechblase');
      while (!beendet) {
        if (!frage) return beende('abgebrochen');
        const korrekt = await frageAnzeigen(frage);
        if (beendet) return;
        const urteil = sitzung.bewerte(korrekt);
        if (urteil === 'richtig') {
          leereFrage();
          zustand = 'richtig';
          melde({ art: 'quiz-richtig' });
          setzeSatz('richtig');
          setzePose('jubeln');
          tint('richtig');
          schreibe();
          await warte(opt.richtigMs ?? RICHTIG_MS);
          return beende('geloest');
        }
        if (urteil === 'verweigert') {
          leereFrage();
          zustand = 'verweigert';
          melde({ art: 'quiz-verweigert' });
          setzeSatz('verweigert');
          setzePose('schmollen');
          tint('falsch');
          schreibe();
          await warte(opt.verweigertMs ?? VERWEIGERT_MS);
        } else {
          // Falsch: sofort die naechste Frage, keine Wartezeit.
          melde({ art: 'quiz-falsch' });
          setzeSatz('falsch');
          tint('falsch');
        }
        frage = sitzung.naechste();
      }
    })().catch(() => beende('abgebrochen'));
  });
}
