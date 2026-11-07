// Pflicht-Besuche, Seite (Auftrag Z2, Session 10, PHASE-5-AUFTRAEGE-SESSION-10.md Abschnitt 7; Entscheidungen 116 und 125).
// Mit eigenem Schalter (ab Werk aus) und Pack-Freischaltung `kontrolle:besuche` oeffnet Mia zufaellig alle 2 bis 4 Stunden selbst einen Tab mit
// einer ihrer Seiten. Die Seite fuehrt nur den Plan (`besuchZeitplan` in storage.local, ueber alle Tabs; Pruefung alle 60 s, nur im sichtbaren Tab)
// und zeigt 5 s lang einen Hinweis mit "Not now"; die harten Schutzregeln (2-Stunden-Grenze, Fenster, Pause) prueft der Hintergrund selbst
// (src/hintergrund/besuche.ts). Der Hinweis steht als eigener Host am Ende von `html` (nie im Seiten-DOM), geschlossene Shadow Root; Klicks
// auf ihn erreichen die Seite nicht (frueher Capture-Horcher am window ab document_start, der ohne Hinweis sofort zurueckkehrt und Bewegung,
// Rad und Beruehrung nie schluckt). Eine Taste, Fokus in ein Eingabefeld, verborgener Tab, Fokusverlust, Vollbild, Pause oder Schalter aus
// brechen den Hinweis ab, ohne neuen Plan (die naechste Pruefung versucht es wieder).
import { aendereEinstellungen, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../einstellungen';
import { BESUCH_ABSTAND_MS, BESUCH_HINWEIS_MS } from '../kontrolle/grenzen';
import { andereVorDerSeite, beiBelegtWechsel, eingabeAktiv, istOberstesFenster, kontrolleErlaubt, meldeBelegt, starteEingabeWache } from '../kontrolle/gemeinsam';
import type { AntwortBesuch, AntwortPackDaten, NachrichtHintergrundBesuch, NachrichtHintergrundPackDaten, NachrichtHintergrundPause } from '../nachrichten';
import { PACK_SPEICHER_SCHLUESSEL, ladePackKurz, type PackKurz } from '../pack/vertrag';
import { beiLokalerPause, meldeLokalePause } from '../pause-lokal';
import { pruefeTexte } from '../quiz/vertrag';
import { TESTHAKEN } from '../schleier/konstanten';
import type { KontextLeicht } from '../schleier/schleier';
import { testhakenAktiv } from '../schleier/status';
import { BESUCH_PLAN_SCHLUESSEL, BESUCH_PRUEF_TAKT_MS, neuerBesuchPlan, pruefeBesuchPlan } from './plan';
import { melde } from '../ereignisse';
import { SEITEN_TOKENS } from '../oberflaeche/design/tokens';
import { HOST_ZUFALL } from '../oberflaeche/design/familie';
import { ladeSeitenSchriften } from '../oberflaeche/design/schrift';
import { spiralAuge } from '../oberflaeche/design/motive';
import { eigeneWurzel } from '../schleier/eigene';

export const NICHT_JETZT = 'Not now';
export const PAUSE_TEXT = 'Pause Mia';
const WIEDERHOLUNG_MS = 10 * 60_000;
// Testabbild (nur Testbau): JSON am html-Element.
const ATTR_ABBILD: string = TESTHAKEN ? 'data-veil-besuch' : '';

const ZEIGER = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'dragstart'] as const;
const TASTEN = ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'compositionstart'] as const;

const STIL = `
:host { all: initial; }
${SEITEN_TOKENS}
* { box-sizing: border-box; }
/* Phase 8b ("Sakura Glas"): Glas-Karte mit Spiral-Auge, Knopf als Pille mit 44 px (vorher 37 px, UEBERGABE-14 Punkt 5). */
.karte { display: flex; align-items: center; gap: 12px; padding: 10px 10px 10px 14px; background: rgba(255, 255, 255, 0.94);
  color: var(--v-text); border: 1px solid var(--v-glas-kante); border-radius: var(--v-r-l); box-shadow: 0 0 0 1px rgba(255, 179, 211, 0.35), var(--v-schatten);
  font: 700 15px/1.4 var(--v-schrift-text); }
@supports ((backdrop-filter: blur(1px)) or (-webkit-backdrop-filter: blur(1px))) {
  .karte { background: rgba(255, 255, 255, 0.92); -webkit-backdrop-filter: var(--v-glas-unschaerfe); backdrop-filter: var(--v-glas-unschaerfe); }
}
.v-auge { flex: none; }
.text { margin: 0; color: var(--v-rosa-800); }
button { font: 800 14px/1 var(--v-schrift-text); color: var(--v-weiss); background: var(--v-verlauf-akzent); border: 0; border-radius: var(--v-r-voll);
  padding: 0 18px; min-height: 44px; cursor: pointer; white-space: nowrap; box-shadow: var(--v-schatten-knopf); }
/* Session 16 (UX 8b Nr. 21): "Pause Mia" als ruhiger zweiter Knopf, genau in dem Moment, in dem Mia gleich einen Tab oeffnet. */
.knoepfe { display: flex; gap: 8px; flex: none; }
button.pause { color: var(--v-rosa-800); background: var(--v-weiss); border: 1px solid var(--v-rand); box-shadow: none; padding: 0 14px; }
@media (max-width: 420px) { .karte { flex-wrap: wrap; } .knoepfe { width: 100%; justify-content: flex-end; } }
`;

const HOST_STIL: ReadonlyArray<[string, string]> = [
  ['all', 'initial'],
  ['display', 'block'],
  ['position', 'fixed'],
  ['left', '50%'],
  ['bottom', '24px'],
  ['top', 'auto'],
  ['right', 'auto'],
  ['width', 'max-content'],
  ['max-width', 'calc(100vw - 32px)'],
  ['height', 'auto'],
  ['margin', '0'],
  ['padding', '0'],
  ['border', '0'],
  ['overflow', 'visible'],
  ['background', 'transparent'],
  ['opacity', '1'],
  ['visibility', 'visible'],
  ['transform', 'translateX(-50%)'],
  ['z-index', '2147483647'],
  ['pointer-events', 'auto'],
];

interface Lage {
  e: Einstellungen;
  pack: PackKurz;
  ep: number;
}

interface Hinweis {
  host: HTMLElement;
  knopf: HTMLButtonElement;
  pauseKnopf: HTMLButtonElement;
  satz: string;
  e: Einstellungen;
  pack: PackKurz;
  erzwungen: boolean;
  hinweisMs: number;
  beginn: number;
  timer: ReturnType<typeof setTimeout>;
  zufall: () => number;
}

export function starteBesuche(ctx: KontextLeicht): void {
  if (!istOberstesFenster()) return;
  starteEingabeWache();
  let abgebaut = false;
  // Jedes Abbruch-Ereignis erhoeht den Zaehler: die Vorpruefung wartet mehrfach auf Speicher und Hintergrund, was in der Zeit geschieht, darf nicht verloren gehen.
  let epoche = 0;
  let letzteE: Einstellungen | null = null;
  let packDa: boolean | null = null;
  let riegelTimer: ReturnType<typeof setInterval> | null = null;
  let hinweis: Hinweis | null = null;
  let nr = 0;
  const lebt = (): boolean => !abgebaut && ctx.isValid;

  const abbild = (inhalt: Record<string, unknown>): void => {
    if (!TESTHAKEN || !testhakenAktiv()) return;
    try {
      const h = hinweis;
      document.documentElement.setAttribute(
        ATTR_ABBILD,
        JSON.stringify({ nr, ...(h ? { host: rechteck(h.host), knopf: rechteck(h.knopf), pauseKnopf: rechteck(h.pauseKnopf) } : {}), jetzt: performance.now(), ...inhalt }),
      );
    } catch {
      // Dokument weg
    }
  };
  const rechteck = (el: Element): { x: number; y: number; w: number; h: number } => {
    const b = el.getBoundingClientRect();
    return { x: Math.round(b.left), y: Math.round(b.top), w: Math.round(b.width), h: Math.round(b.height) };
  };

  // ---------- Bedingungen ----------
  let saetzeCache: { schluessel: string; liste: string[] } | null = null;
  async function holeSaetze(pack: PackKurz): Promise<string[]> {
    const schluessel = `${pack.id}|${pack.version}|${pack.importiert}`;
    if (saetzeCache?.schluessel === schluessel) return saetzeCache.liste;
    try {
      const n: NachrichtHintergrundPackDaten = { ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' };
      const a = (await browser.runtime.sendMessage(n)) as AntwortPackDaten | undefined;
      if (!a || a.ok !== true || !a.daten) return [];
      // Auch eine leere Liste wird je Pack-Stand gemerkt (sonst ginge jede Minute eine Anfrage raus).
      const liste = pruefeTexte(a.daten)?.gruppen.besuch ?? [];
      saetzeCache = { schluessel, liste: [...liste] };
      return saetzeCache.liste;
    } catch {
      return [];
    }
  }

  // Pack, Schalter, Pause, Ausnahme. Liefert die Lage oder den Grund, warum nichts geschieht.
  async function grundLage(): Promise<Lage | string> {
    const ep = epoche;
    let e: Einstellungen;
    let pack: PackKurz | null;
    try {
      [e, pack] = await Promise.all([ladeEinstellungen(), ladePackKurz()]);
    } catch {
      return 'speicher';
    }
    packDa = pack !== null;
    if (!pack) return 'kein-pack';
    if (!e.kontrolle.besuche) return 'aus';
    if (!kontrolleErlaubt(e, pack, 'kontrolle:besuche')) return 'nicht-erlaubt';
    if (epoche === ep) letzteE = e;
    return { e, pack, ep };
  }

  // Browser im Vollbild (F11, macOS-Vollbild): das sieht die Seite ueber display-mode.
  function displayModeVollbild(): boolean {
    try {
      return window.matchMedia('(display-mode: fullscreen)').matches;
    } catch {
      return false;
    }
  }

  // Bedingungen des Augenblicks (Seite sichtbar, Fenster fokussiert, nicht tippen, kein Vollbild, nichts anderes vor der Seite).
  function augenblickGrund(): string | null {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return 'unsichtbar';
    if (eingabeAktiv()) return 'eingabe';
    if (document.fullscreenElement || displayModeVollbild()) return 'vollbild';
    if (andereVorDerSeite('besuch')) return 'belegt';
    return null;
  }

  // ---------- Hinweis ----------
  function baueHost(satz: string): { host: HTMLElement; knopf: HTMLButtonElement; pauseKnopf: HTMLButtonElement } {
    // Eigener Elementname statt div: Seitenregeln auf `div` treffen den Host nicht.
    const host = document.createElement(`mia-hinweis-${HOST_ZUFALL}`);
    host.setAttribute('popover', 'manual');
    for (const [k, v] of HOST_STIL) host.style.setProperty(k, v, 'important');
    const wurzel = eigeneWurzel(host);
    const stil = document.createElement('style');
    stil.textContent = STIL;
    const karte = document.createElement('div');
    karte.className = 'karte';
    karte.setAttribute('role', 'status');
    const text = document.createElement('p');
    text.className = 'text';
    text.textContent = satz;
    const knopf = document.createElement('button');
    knopf.type = 'button';
    knopf.tabIndex = -1; // nie Fokus: die Seite behaelt ihren Fokus und ihre Tasten
    knopf.textContent = NICHT_JETZT;
    const pauseKnopf = document.createElement('button');
    pauseKnopf.type = 'button';
    pauseKnopf.className = 'pause';
    pauseKnopf.tabIndex = -1;
    pauseKnopf.textContent = PAUSE_TEXT;
    const knoepfe = document.createElement('div');
    knoepfe.className = 'knoepfe';
    knoepfe.append(pauseKnopf, knopf);
    karte.append(spiralAuge(32), text, knoepfe);
    wurzel.append(stil, karte);
    void ladeSeitenSchriften();
    (document.documentElement ?? document).appendChild(host);
    try {
      if (typeof host.showPopover === 'function') host.showPopover();
    } catch {
      // ohne Popover bleibt der Host mit z-index ganz oben
    }
    return { host, knopf, pauseKnopf };
  }

  function entferneHinweis(): Hinweis | null {
    const h = hinweis;
    if (!h) return null;
    hinweis = null;
    clearTimeout(h.timer);
    try {
      if (h.host.matches(':popover-open')) h.host.hidePopover();
    } catch {
      // egal
    }
    h.host.remove();
    meldeBelegt('besuch', false);
    if (riegelTimer) clearInterval(riegelTimer);
    riegelTimer = null;
    return h;
  }

  function zeigeHinweis(l: Lage, satz: string, erzwungen: boolean, hinweisMs: number, zufall: () => number): void {
    if (hinweis) return;
    const { host, knopf, pauseKnopf } = baueHost(satz);
    meldeBelegt('besuch', true);
    // Ein Quiz-Riegel, der waehrend des Hinweises aufgeht, bricht ihn ab (der Riegel meldet sich nicht ueber `meldeBelegt`).
    riegelTimer = setInterval(() => {
      if (hinweis && andereVorDerSeite('besuch')) brichAb('belegt');
    }, 200);
    const h: Hinweis = {
      host,
      knopf,
      pauseKnopf,
      satz,
      e: l.e,
      pack: l.pack,
      erzwungen,
      hinweisMs,
      beginn: performance.now(),
      timer: setTimeout(() => void nachFrist(h), hinweisMs),
      zufall,
    };
    hinweis = h;
    abbild({ phase: 'hinweis', satz, hinweisMs });
  }

  // Abbruch ohne neuen Plan (die naechste Pruefung versucht es wieder).
  function brichAb(grund: string): void {
    epoche++;
    const h = entferneHinweis();
    if (h) abbild({ phase: 'ende', ergebnis: 'abbruch', grund, dauerMs: Math.round(performance.now() - h.beginn) });
  }

  async function schreibePlan(zufall: () => number): Promise<void> {
    try {
      await browser.storage.local.set({ [BESUCH_PLAN_SCHLUESSEL]: neuerBesuchPlan(Date.now(), zufall()) });
    } catch {
      // ohne Speicher gilt der alte Plan weiter: der Hintergrund haelt die 2 Stunden trotzdem
    }
  }

  // Nach einer Ablehnung des Hintergrunds (oder ohne Antwort) frueheres Wiederholen verhindern: der Besuch wird in 10 Minuten wieder faellig.
  async function schreibeWiederholung(importiert: number): Promise<void> {
    try {
      // Nur wenn der Plan noch faellig ist: hat ein anderer Tab inzwischen besucht und neu geplant, bleibt dessen Plan.
      const roh = (await browser.storage.local.get(BESUCH_PLAN_SCHLUESSEL))[BESUCH_PLAN_SCHLUESSEL];
      if (!pruefeBesuchPlan(roh, Date.now(), 0.5, importiert).faellig) return;
      const abstandMs = BESUCH_ABSTAND_MS[0];
      await browser.storage.local.set({ [BESUCH_PLAN_SCHLUESSEL]: { zuletzt: Date.now() - abstandMs + WIEDERHOLUNG_MS, abstandMs } });
    } catch {
      // egal
    }
  }

  function nichtJetzt(): void {
    const h = entferneHinweis();
    if (!h) return;
    epoche++;
    abbild({ phase: 'ende', ergebnis: 'nicht-jetzt', dauerMs: Math.round(performance.now() - h.beginn) });
    void schreibePlan(h.zufall).then(() => abbild({ phase: 'ende', ergebnis: 'nicht-jetzt', geplant: true, dauerMs: Math.round(performance.now() - h.beginn) }));
  }

  // "Pause Mia" im Hinweis: sofort lokal frei (wie im Riegel), dann die gespeicherte Pause ueber den Hintergrund. Kein neuer Plan: mit Pause
  // lehnt der Hintergrund jeden Besuch ohnehin ab.
  function pauseAusHinweis(): void {
    brichAb('pause');
    meldeLokalePause();
    try {
      const n: NachrichtHintergrundPause = { ziel: 'hintergrund', typ: 'pause', an: true };
      (browser.runtime.sendMessage(n) as Promise<unknown>).catch(() => {});
    } catch {
      // Hintergrund nicht erreichbar: der Hinweis ist trotzdem weg
    }
  }

  // Die Hinweiszeit ist um: noch einmal alle Bedingungen, dann der Hintergrund.
  async function nachFrist(h: Hinweis): Promise<void> {
    if (hinweis !== h) return;
    const dauerMs = Math.round(performance.now() - h.beginn);
    const grund = !lebt() ? 'kontext' : augenblickGrund() ?? (!kontrolleErlaubt(h.e, h.pack, 'kontrolle:besuche') || !h.e.kontrolle.besuche ? 'nicht-erlaubt' : null);
    entferneHinweis();
    if (grund) {
      epoche++;
      abbild({ phase: 'ende', ergebnis: 'abbruch', grund, dauerMs });
      return;
    }
    const ep = epoche;
    try {
      // Hat inzwischen ein anderer Tab den Besuch gemacht (neuer Plan), ist hier nichts mehr zu tun.
      if (!h.erzwungen) {
        const roh = (await browser.storage.local.get(BESUCH_PLAN_SCHLUESSEL))[BESUCH_PLAN_SCHLUESSEL];
        if (!pruefeBesuchPlan(roh, Date.now(), 0.5, h.pack.importiert).faellig) return abbild({ phase: 'ende', ergebnis: 'erledigt', dauerMs });
      }
      if (!lebt() || epoche !== ep) return abbild({ phase: 'ende', ergebnis: 'abbruch', grund: 'geaendert', dauerMs });
      const n: NachrichtHintergrundBesuch = { ziel: 'hintergrund', typ: 'besuch' };
      const a = (await browser.runtime.sendMessage(n)) as AntwortBesuch | undefined;
      if (a?.ok === true) {
        melde({ art: 'besuch' }); // Session 11: Ledger
        await schreibePlan(h.zufall);
        abbild({ phase: 'ende', ergebnis: 'ok', url: a.url, tabId: a.tabId, dauerMs });
      } else {
        // Zu frueh (anderer Tab oder anderes Fenster war schneller): der Plan wird neu, sonst kaeme der Hinweis jede Minute wieder.
        if (a && a.ok === false && a.grund === 'zu-frueh') await schreibePlan(h.zufall);
        else await schreibeWiederholung(h.pack.importiert);
        abbild({ phase: 'ende', ergebnis: 'abgelehnt', grund: a && a.ok === false ? a.grund : 'keine-antwort', dauerMs });
      }
    } catch {
      await schreibeWiederholung(h.pack.importiert);
      abbild({ phase: 'ende', ergebnis: 'abgelehnt', grund: 'fehler', dauerMs });
    }
  }

  // ---------- Ablauf ----------
  async function pruefeUndZeige(g: Lage, erzwungen: boolean, hinweisMs: number, zufall: () => number): Promise<string | null> {
    const vorab = augenblickGrund();
    if (vorab) return vorab;
    const saetze = await holeSaetze(g.pack);
    if (saetze.length === 0) return 'keine-saetze';
    if (!lebt()) return 'kontext';
    if (epoche !== g.ep) return 'geaendert';
    // Synchron direkt vor dem Zeigen noch einmal.
    const grund = augenblickGrund();
    if (grund) return grund;
    if (hinweis) return 'laeuft';
    zeigeHinweis(g, saetze[Math.min(saetze.length - 1, Math.floor(zufall() * saetze.length))]!, erzwungen, hinweisMs, zufall);
    return null;
  }

  // `erzwungen`: Testhaken, als waere der Besuch faellig (die Bedingungen gelten weiter).
  async function takt(jetzt: number = Date.now(), zufall: () => number = Math.random, erzwungen = false, hinweisMs: number = BESUCH_HINWEIS_MS): Promise<string | null> {
    if (!lebt() || document.visibilityState !== 'visible') return 'unsichtbar';
    if (hinweis) return 'laeuft';
    const g = await grundLage();
    if (typeof g === 'string') return g;
    if (!erzwungen) {
      let roh: unknown;
      try {
        roh = (await browser.storage.local.get(BESUCH_PLAN_SCHLUESSEL))[BESUCH_PLAN_SCHLUESSEL];
      } catch {
        return 'speicher';
      }
      const erg = pruefeBesuchPlan(roh, jetzt, zufall(), g.pack.importiert);
      if (erg.schreibe) {
        try {
          await browser.storage.local.set({ [BESUCH_PLAN_SCHLUESSEL]: erg.plan });
        } catch {
          return 'speicher';
        }
      }
      if (!erg.faellig) return 'nicht-faellig';
    }
    return pruefeUndZeige(g, erzwungen, hinweisMs, zufall);
  }

  // Alle 60 s, nur solange der Tab sichtbar ist. Im Testbau laeuft nichts von selbst: erst das Testereignis `taktMs` schaltet den Zeitgeber ein.
  let timer: ReturnType<typeof setInterval> | null = null;
  let taktMs = BESUCH_PRUEF_TAKT_MS;
  let taktErlaubt = !TESTHAKEN;
  const steuereTimer = (): void => {
    if (!taktErlaubt) return;
    const sichtbar = document.visibilityState === 'visible';
    if (sichtbar && !timer) {
      timer = setInterval(() => {
        // Ohne Schalter oder ohne Pack nichts lesen (Last): die Werte kommen aus dem letzten Durchlauf und den Hoerern.
        if ((letzteE && !letzteE.kontrolle.besuche) || packDa === false) return;
        void takt().then((g) => {
          if (TESTHAKEN && g && g !== 'nicht-faellig' && g !== 'laeuft' && !hinweis) abbild({ phase: 'abgelehnt', abgelehnt: g, vomTakt: true });
        });
      }, taktMs);
    } else if (!sichtbar && timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  // ---------- Der frühe Schutz-Horcher (ab document_start) ----------
  // Ohne Hinweis kehrt er sofort zurueck. Mit Hinweis: Zeiger auf dem Hinweis erreichen die Seite nicht, ein Klick auf "Not now" wird gewertet;
  // eine echte Taste bricht den Hinweis ab (und gehoert der Seite, sie wird nicht geschluckt).
  function schutz(e: Event): void {
    const h = hinweis;
    if (!h) return;
    if ((TASTEN as readonly string[]).includes(e.type)) {
      if (e.isTrusted) brichAb('taste');
      return;
    }
    if (e.target !== h.host) return;
    e.stopImmediatePropagation();
    // Kein Standard (auch nicht bei mousedown und pointerdown): der Knopf bekommt keinen Fokus, die Seite sieht kein focusin.
    if (e.cancelable) e.preventDefault();
    if (e.type !== 'click' || !e.isTrusted) return;
    const m = e as MouseEvent;
    const b = h.knopf.getBoundingClientRect();
    // Ein Klick ohne Position (Tastenaktivierung) gibt es hier nicht: der Knopf bekommt nie den Fokus (tabIndex -1, kein Standard bei mousedown).
    const p = h.pauseKnopf.getBoundingClientRect();
    if (m.clientX >= b.left && m.clientX <= b.right && m.clientY >= b.top && m.clientY <= b.bottom) nichtJetzt();
    else if (m.clientX >= p.left && m.clientX <= p.right && m.clientY >= p.top && m.clientY <= p.bottom) pauseAusHinweis();
  }
  const fruehListe: Array<() => void> = [];
  for (const t of [...ZEIGER, ...TASTEN]) {
    window.addEventListener(t, schutz, { capture: true, passive: false });
    fruehListe.push(() => window.removeEventListener(t, schutz, true));
  }

  // ---------- Abbruch-Ereignisse ----------
  const beiFokus = (): void => {
    if (hinweis && eingabeAktiv()) brichAb('eingabe');
  };
  const beiBlur = (e: Event): void => {
    if (e.target === window) brichAb('fokus-weg');
  };
  const beiSichtbarkeit = (): void => {
    if (document.visibilityState !== 'visible') brichAb('verborgen');
    steuereTimer();
  };
  const beiVollbild = (): void => {
    if (document.fullscreenElement) brichAb('vollbild');
  };
  window.addEventListener('focusin', beiFokus, { capture: true, passive: true });
  window.addEventListener('blur', beiBlur, true);
  document.addEventListener('visibilitychange', beiSichtbarkeit);
  document.addEventListener('fullscreenchange', beiVollbild);
  const lokalAb = beiLokalerPause(() => brichAb('pause'));
  const belegtAb = beiBelegtWechsel((teil, an) => {
    if (an && teil !== 'besuch' && teil !== 'meldung') brichAb('belegt');
  });
  void ladeEinstellungen().then((e) => {
    if (!letzteE) letzteE = e;
  }, () => undefined);
  const abmelden = beiEinstellungsAenderung((neu) => {
    letzteE = neu;
    brichAb('einstellung');
  });
  const packHoerer = (aenderungen: Record<string, unknown>, bereich: string): void => {
    if (bereich === 'local' && PACK_SPEICHER_SCHLUESSEL in aenderungen) {
      packDa = null;
      brichAb('pack');
    }
  };
  browser.storage.onChanged.addListener(packHoerer);
  steuereTimer();

  // ---------- Testhaken ----------
  // Ereignis `veil-test` mit { besuch: { faellig?, takt?, jetzt?, hinweisMs?, zufall?, taktMs?, abbruch? } } (JSON-Text oder Objekt): `faellig` loest
  // sofort die Pruefung aus, als waere der Besuch faellig (Bedingungen gelten weiter); `takt` fuehrt einen Plan-Durchlauf aus (mit `jetzt` als Uhrzeit);
  // `hinweisMs` verkuerzt oder verlaengert den Hinweis (mindestens 200 ms).
  const beiTestEreignis = (ev: Event): void => {
    try {
      let detail = (ev as CustomEvent).detail as unknown;
      if (typeof detail === 'string') detail = JSON.parse(detail);
      const b = (detail as { besuch?: { faellig?: boolean; takt?: boolean; jetzt?: number; hinweisMs?: number; zufall?: number[]; taktMs?: number; abbruch?: boolean; lokalePause?: boolean; einstellungen?: Record<string, unknown>; packAnstossen?: boolean } } | null)?.besuch;
      if (!b) return;
      nr++;
      const meine = nr;
      const reihe = Array.isArray(b.zufall) && b.zufall.length > 0 ? b.zufall : null;
      let i = 0;
      const klemme = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), 0.999999) : 0.5);
      const zufall = reihe ? () => klemme(reihe[i++ % reihe.length]) : Math.random;
      const hinweisMs = typeof b.hinweisMs === 'number' && b.hinweisMs >= 200 ? b.hinweisMs : BESUCH_HINWEIS_MS;
      const melde = (grund: string | null): void => {
        if (grund !== null && nr === meine) abbild({ phase: 'abgelehnt', abgelehnt: grund });
      };
      if (b.abbruch) return brichAb('test');
      // Aenderungen aus der Seite heraus, ohne Tabwechsel (der Fokusverlust wuerde sonst zuerst abbrechen).
      if (b.lokalePause) return meldeLokalePause();
      if (b.einstellungen) {
        const n = b.einstellungen as { kontrolle?: Record<string, unknown> };
        void aendereEinstellungen((alt) => ({ ...(n as object), ...(n.kontrolle ? { kontrolle: { ...alt.kontrolle, ...n.kontrolle } } : {}) }) as Partial<Einstellungen>).catch(() => undefined);
        return;
      }
      if (b.packAnstossen) {
        void browser.storage.local.get(PACK_SPEICHER_SCHLUESSEL).then((r) => {
          const p = r[PACK_SPEICHER_SCHLUESSEL] as { importiert?: number } | undefined;
          if (p) return browser.storage.local.set({ [PACK_SPEICHER_SCHLUESSEL]: { ...p, importiert: (p.importiert ?? 0) + 1 } });
        });
        return;
      }
      if (typeof b.taktMs === 'number' && b.taktMs >= 50) {
        taktErlaubt = true;
        taktMs = b.taktMs;
        if (timer) clearInterval(timer);
        timer = null;
        steuereTimer();
        return;
      }
      if (b.takt || b.faellig) void takt(typeof b.jetzt === 'number' ? b.jetzt : Date.now(), zufall, b.faellig === true, hinweisMs).then(melde);
    } catch {
      // ungueltiges Ereignis ignorieren
    }
  };
  if (TESTHAKEN && testhakenAktiv()) document.addEventListener('veil-test', beiTestEreignis);

  ctx.onInvalidated(() => {
    abgebaut = true;
    brichAb('kontext');
    if (timer) clearInterval(timer);
    for (const f of fruehListe.splice(0)) f();
    window.removeEventListener('focusin', beiFokus, true);
    window.removeEventListener('blur', beiBlur, true);
    document.removeEventListener('visibilitychange', beiSichtbarkeit);
    document.removeEventListener('fullscreenchange', beiVollbild);
    if (TESTHAKEN) document.removeEventListener('veil-test', beiTestEreignis);
    lokalAb();
    belegtAb();
    try {
      abmelden();
      browser.storage.onChanged.removeListener(packHoerer);
    } catch {
      // Kontext weg
    }
  });
}
