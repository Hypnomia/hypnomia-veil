// Meldungen (Auftrag M, Phase 5 Session 10, PHASE-5-AUFTRAEGE-SESSION-10.md Abschnitt 5), eingehaengt in entrypoints/content/index.ts.
// Der Hintergrund entscheidet ueber Anlass und Abstand (src/hintergrund/meldungen.ts) und schickt der obersten Seite `inhalt/meldung`; die
// Seite zeigt nur, wenn sie selbst alles erlaubt (Pack, Freischaltung, Schalter, keine Pause, sichtbar, Fokus, kein Vollbild, nichts anderes
// vor der Seite, ein Satz da) und antwortet `{ gezeigt }`. Es gibt keinen Takt auf der Seite: nur den Nachrichten-Horcher, einen fruehen
// passiven Schutz-Horcher (ab document_start), der ohne stehende Meldung sofort zurueckkehrt und nur Ereignisse AUF der Meldung versteckt
// (Bewegung, Rad und Beruehrung ausserhalb gehen immer an die Seite), und, solange eine Meldung steht, einen kurzen Zeitgeber (200 ms).
import { aendereEinstellungen, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../einstellungen';
import { seiteFuer } from '../adapter/liste';
import type { ChibiPose } from '../chibi';
import { andereVorDerSeite, beiBelegtWechsel, istOberstesFenster, kontrolleErlaubt, meldeBelegt, ruhigGewuenscht } from '../kontrolle/gemeinsam';
import { MELDUNG_SICHT_MS } from '../kontrolle/grenzen';
import {
  MELDUNG_ANLAESSE,
  istFuer,
  type AntwortPackBild,
  type AntwortPackDaten,
  type MeldungAnlass,
  type NachrichtErkennerPackBild,
  type NachrichtHintergrundMeldungTest,
  type NachrichtHintergrundPackDaten,
} from '../nachrichten';
import { PACK_SPEICHER_SCHLUESSEL, kurzAusRoh, ladePackKurz, type PackKurz } from '../pack/vertrag';
import { beiLokalerPause, meldeLokalePause } from '../pause-lokal';
import { fuelleSatz, pruefeTexte } from '../quiz/vertrag';
import { TESTHAKEN } from '../schleier/konstanten';
import { grussSchonGezeigt, merkeGruss } from './gruss-merker';
import type { KontextLeicht } from '../schleier/schleier';
import { MeldungAnsicht } from './ansicht';
import { GRUPPE_JE_ANLASS, POSE_JE_ANLASS, waehleSatz } from './logik';
import { schreibeAbbild, schreibeAntwort, testMeldung } from './testspur';
import { WENIGER_SCHLUESSEL, beiAblauf, beiSchliessen, fragtJetzt, nachFrage, vervollstaendigeWeniger, type WenigerStand } from './weniger';

// Begruessung auf Erwachsenenseiten (Wunsch der Inhaberin, Session 17): ein Anlass nur der Seite, nicht des Hintergrunds.
type Anlass = MeldungAnlass | 'gruss';
const GRUSS_GRUPPE = 'begruessung';
const GRUSS_POSE: ChibiPose = 'jubeln';
const GRUSS_VERZOEGERUNG_MS = 2500;
// Testmarke in der Adresse: nur im Testbau, im Release-Bau bleibt weder der Name noch die Pruefung stehen.
const GRUSS_TESTMARKE: string = TESTHAKEN ? 'veil-gruss' : '';

const LADE_FRIST_MS = 5000;
const CHIBI_FRIST_MS = 1200;
const WACHE_MS = 200;
const SPAET_MS = 7000;
// Frueh angemeldet und passiv: Ereignisse, die auf der Meldung selbst landen, erreichen die Seite nicht. Bewegung, Rad und Beruehrungsbewegung fehlen
// absichtlich (sie gehen immer an die Seite).
const EREIGNISSE = [
  'pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'dragstart',
  'touchstart', 'touchend', 'touchcancel', 'keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend',
] as const;

export function starteMeldungen(ctx: KontextLeicht): void {
  if (!istOberstesFenster()) return;
  let ansicht: MeldungAnsicht | null = null;
  let abgebaut = false;
  let aufraeumen: Array<() => void> = [];
  let sichtTimer: ReturnType<typeof setTimeout> | null = null;
  let wache: ReturnType<typeof setInterval> | null = null;
  let abgelaufen = false;
  let aktuelleEinstellungen: Einstellungen | null = null;
  let aktuellesPack: PackKurz | null = null;
  let texteGeladen: { schluessel: string; gruppen: Record<string, string[]> } | null = null;
  const letzterSatz = new Map<Anlass, string>();
  let anlassSteht: Anlass | null = null;
  let wenigerSteht = false;
  let gezeigtZaehler = 0;
  let entscheidungen = 0;
  let ergebnis = '';
  let endeGrund = '';
  let endeZeit = 0;
  let offeneHoerer = 0;
  let sichtbarSeit = 0;
  let zahlSteht: number | null = null;
  let poseSteht: ChibiPose | null = null;
  const lebt = (): boolean => !abgebaut && ctx.isValid;

  // ---------- Testspur ----------
  function abbild(): void {
    if (!TESTHAKEN || !testMeldung()) return;
    schreibeAbbild({
      phase: ansicht ? 'steht' : 'ruhend',
      gezeigt: gezeigtZaehler,
      entscheidungen,
      ergebnis,
      endeGrund,
      endeZeit,
      anlass: anlassSteht,
      zahl: zahlSteht,
      pose: poseSteht,
      satz: ansicht?.satz ?? '',
      chibi: ansicht?.hatBild ?? false,
      deckkraft: ansicht ? ansicht.deckkraft() : null,
      host: ansicht ? ansicht.rect() : null,
      schliessen: ansicht ? ansicht.schliessenRect() : null,
      weniger: ansicht ? ansicht.wenigerRect() : null,
      wenigerFrage: wenigerSteht,
      fokusImHost: ansicht ? document.activeElement === ansicht.host : false,
      sichtbarSeit,
      offeneHoerer,
      jetzt: performance.now(),
    });
  }
  function entscheide(wert: string): void {
    entscheidungen++;
    ergebnis = wert;
    abbild();
  }

  function haenge(typen: readonly string[], fn: (e: Event) => void, liste: Array<() => void>, nichtPassiv = false): void {
    for (const t of typen) {
      window.addEventListener(t, fn, { capture: true, passive: !nichtPassiv });
      offeneHoerer++;
      liste.push(() => {
        window.removeEventListener(t, fn, true);
        offeneHoerer--;
      });
    }
  }

  // ---------- "Fewer notes?" (Fund 25) ----------
  let wenigerKette: Promise<unknown> = Promise.resolve();
  function aendereWeniger(f: (s: WenigerStand) => WenigerStand): Promise<void> {
    const schritt = wenigerKette.then(async () => {
      const alt = vervollstaendigeWeniger((await browser.storage.local.get(WENIGER_SCHLUESSEL))[WENIGER_SCHLUESSEL]);
      await browser.storage.local.set({ [WENIGER_SCHLUESSEL]: f(alt) });
    });
    wenigerKette = schritt.catch(() => undefined);
    return schritt.catch(() => undefined);
  }
  async function leseWeniger(): Promise<WenigerStand> {
    try {
      return vervollstaendigeWeniger((await browser.storage.local.get(WENIGER_SCHLUESSEL))[WENIGER_SCHLUESSEL]);
    } catch {
      return vervollstaendigeWeniger(null);
    }
  }

  // ---------- Ende ----------
  function beende(grund: string): void {
    const a = ansicht;
    if (!a) return;
    ansicht = null;
    if (sichtTimer) clearTimeout(sichtTimer);
    sichtTimer = null;
    if (wache) clearInterval(wache);
    wache = null;
    a.entferne();
    wenigerSteht = false;
    // Fund 25: Schliessen mit dem Kreuz zaehlt, jedes andere Ende (Zeit, Pause, ...) unterbricht die Folge.
    if (grund === 'schliessen') void aendereWeniger((s) => beiSchliessen(s, Date.now()));
    else if (grund === 'zeit') void aendereWeniger((s) => beiAblauf(s));
    const liste = aufraeumen;
    aufraeumen = [];
    for (const f of liste) {
      try {
        f();
      } catch {
        // Kontext weg: die Anmeldungen sind es auch
      }
    }
    meldeBelegt('meldung', false);
    endeGrund = grund;
    endeZeit = performance.now();
    anlassSteht = null;
    abbild();
  }

  // ---------- Erlaubnis ----------
  function lageOk(e: Einstellungen | null, p: PackKurz | null): boolean {
    return !!e && e.kontrolle.meldungen && kontrolleErlaubt(e, p, 'kontrolle:meldungen');
  }
  function sichtOk(): boolean {
    return document.visibilityState === 'visible' && document.hasFocus() && !document.fullscreenElement;
  }

  // Wird bei jeder Aenderung und im Zeitgeber geprueft, solange die Meldung steht.
  function pruefeWeiter(): void {
    if (!ansicht) return;
    if (!lageOk(aktuelleEinstellungen, aktuellesPack)) return beende('einstellung');
    if (document.visibilityState !== 'visible') return beende('verborgen');
    if (document.fullscreenElement) return beende('vollbild');
    if (andereVorDerSeite('meldung')) return beende('andere');
  }

  // ---------- Schutz-Horcher (frueh, passiv) ----------
  function schutz(e: Event): void {
    const a = ansicht;
    if (!a || e.target !== a.host) return;
    // Was auf der Meldung landet, sieht die Seite nicht.
    e.stopImmediatePropagation();
    // Das Druecken auf der Meldung verschiebt weder den Fokus noch beginnt es eine Textauswahl (Standardaktion von mousedown).
    if (e.type === 'mousedown' && e.cancelable) e.preventDefault();
    if (!e.isTrusted) return;
    if (e.type === 'click') {
      const m = e as MouseEvent;
      if (a.trifftSchliessen(m.clientX, m.clientY)) beende('schliessen');
      else if (a.trifftWeniger(m.clientX, m.clientY)) {
        // Die Person will weniger: Meldungen aus. Die Meldung geht mit der Einstellung (pruefeWeiter); sofort schliessen schadet nicht.
        void aendereEinstellungen((alt) => ({ kontrolle: { ...alt.kontrolle, meldungen: false } })).catch(() => undefined);
        beende('weniger');
      }
    }
  }
  const fruehListe: Array<() => void> = [];
  haenge(EREIGNISSE.filter((t) => t !== 'mousedown' && t !== 'pointerdown'), schutz, fruehListe);
  // Nicht passiv, damit preventDefault wirkt (wie die Spirale); sonst ohne stehende Meldung sofort zurueck.
  haenge(['mousedown', 'pointerdown'], schutz, fruehListe, true);

  // ---------- Saetze und Bild ----------
  async function holeTexte(pack: PackKurz): Promise<Record<string, string[]>> {
    const schluessel = `${pack.id}|${pack.version}|${pack.importiert}`;
    if (texteGeladen?.schluessel === schluessel) return texteGeladen.gruppen;
    let frist: ReturnType<typeof setTimeout> | undefined;
    try {
      const n: NachrichtHintergrundPackDaten = { ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' };
      const stopp = new Promise<undefined>((ok) => {
        frist = setTimeout(() => ok(undefined), LADE_FRIST_MS);
      });
      const a = (await Promise.race([browser.runtime.sendMessage(n) as Promise<AntwortPackDaten | undefined>, stopp])) as AntwortPackDaten | undefined;
      if (!a || a.ok !== true || !a.daten) return {};
      const gruppen = (pruefeTexte(a.daten)?.gruppen ?? {}) as Record<string, string[]>;
      texteGeladen = { schluessel, gruppen };
      return gruppen;
    } catch {
      return {};
    } finally {
      if (frist) clearTimeout(frist);
    }
  }

  const bildCache = new Map<string, Promise<string | null>>();
  function ladeChibi(pose: ChibiPose): Promise<string | null> {
    let p = bildCache.get(pose);
    if (!p) {
      const n: NachrichtErkennerPackBild = { ziel: 'erkenner', typ: 'packbild', rolle: 'chibi', schluessel: pose };
      p = Promise.resolve()
        .then(() => browser.runtime.sendMessage(n) as Promise<AntwortPackBild | { ok: false } | undefined>)
        .then((a) => (a && a.ok === true && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/') ? a.dataUrl : null))
        .catch(() => null);
      bildCache.set(pose, p);
      void p.then((u) => {
        if (!u) bildCache.delete(pose);
      });
    }
    return p;
  }

  // ---------- Anzeigen ----------
  async function zeige(anlass: Anlass, zahl: number | undefined): Promise<boolean> {
    const empfangen = performance.now();
    if (!lebt() || ansicht) return false;
    const [e, pack] = await Promise.all([ladeEinstellungen(), ladePackKurz()]);
    aktuelleEinstellungen = e;
    aktuellesPack = pack;
    const vorher = (): string | null => {
      if (!lebt() || ansicht) return 'steht';
      if (!lageOk(aktuelleEinstellungen, aktuellesPack)) return 'einstellung';
      if (!sichtOk()) return 'unsichtbar';
      if (andereVorDerSeite('meldung')) return 'andere';
      return null;
    };
    let grund = vorher();
    if (grund) return abgesagt(grund);
    if (anlass === 'zensiert' && (typeof zahl !== 'number' || !Number.isFinite(zahl))) return abgesagt('zahl');
    const gruppen = await holeTexte(pack!);
    const satzRoh = waehleSatz(gruppen[anlass === 'gruss' ? GRUSS_GRUPPE : GRUPPE_JE_ANLASS[anlass]] ?? [], Math.random(), letzterSatz.get(anlass));
    if (!satzRoh) return abgesagt('kein-satz');
    const satz = fuelleSatz(satzRoh, { count: zahl });
    const pose = (anlass === 'gruss' ? GRUSS_POSE : POSE_JE_ANLASS[anlass]) as ChibiPose;
    let fragt = false;
    const bildLauf = ladeChibi(pose);
    const bild = await Promise.race([bildLauf, new Promise<null>((ok) => setTimeout(() => ok(null), CHIBI_FRIST_MS))]);
    // Nach dem Warten Einstellungen und Pack frisch lesen: eine Pause, ein Schalter oder ein Pack-Wechsel in der Zwischenzeit zaehlt.
    try {
      const [e2, pack2, weniger] = await Promise.all([ladeEinstellungen(), ladePackKurz(), leseWeniger()]);
      aktuelleEinstellungen = e2;
      aktuellesPack = pack2;
      fragt = anlass !== 'gruss' && fragtJetzt(weniger, Date.now());
    } catch {
      return abgesagt('lesen');
    }
    grund = vorher();
    if (grund) return abgesagt(grund);
    // Der Hintergrund wartet 8 s auf die Antwort: wer laenger gebraucht hat, sagt selbst ab (sonst fehlt dort der Abstand).
    if (performance.now() - empfangen > SPAET_MS) return abgesagt('spaet');
    letzterSatz.set(anlass, satzRoh);
    const ruhig = ruhigGewuenscht(aktuelleEinstellungen);
    const a = new MeldungAnsicht(satz, anlass, ruhig);
    ansicht = a;
    anlassSteht = anlass;
    zahlSteht = zahl ?? null;
    poseSteht = pose;
    abgelaufen = false;
    endeGrund = '';
    meldeBelegt('meldung', true);
    if (fragt) {
      a.zeigeWeniger();
      wenigerSteht = true;
      void aendereWeniger((s) => nachFrage(s, Date.now()));
    }
    if (bild) a.setzeBild(bild);
    else void bildLauf.then((u) => lebt() && ansicht === a && u && (a.setzeBild(u), abbild()));
    meldeWachen();
    a.beiZeiger(
      () => abbild(),
      () => {
        abbild();
        if (abgelaufen) beende('zeit');
      },
    );
    a.zeige(ruhig);
    gezeigtZaehler++;
    sichtbarSeit = performance.now();
    sichtTimer = setTimeout(() => {
      sichtTimer = null;
      if (ansicht !== a) return;
      if (a.zeigerDrauf()) abgelaufen = true;
      else beende('zeit');
    }, MELDUNG_SICHT_MS);
    wache = setInterval(() => {
      if (!lebt()) return beende('kontext');
      pruefeWeiter();
      if (TESTHAKEN && ansicht) abbild();
    }, WACHE_MS);
    entscheide('gezeigt');
    return true;
  }

  function abgesagt(grund: string): boolean {
    entscheide(`absage:${grund}`);
    return false;
  }

  function meldeWachen(): void {
    aufraeumen.push(
      beiEinstellungsAenderung((neu) => {
        aktuelleEinstellungen = neu;
        pruefeWeiter();
        // Das Ende einer lokalen Pause setzt der Pause-Vertrag in derselben Meldung zurueck: danach noch einmal bewerten.
        setTimeout(() => lebt() && pruefeWeiter(), 0);
      }),
    );
    const packHoerer = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
      if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aenderungen)) return;
      aktuellesPack = kurzAusRoh(aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue);
      pruefeWeiter();
    };
    browser.storage.onChanged.addListener(packHoerer);
    aufraeumen.push(() => browser.storage.onChanged.removeListener(packHoerer));
    aufraeumen.push(beiLokalerPause(() => beende('pause')));
    // Blitz, Spirale oder Besuch erscheinen: die Meldung raeumt sofort (der Quiz-Riegel wird in der Wache bemerkt).
    aufraeumen.push(beiBelegtWechsel((teil, an) => { if (an && teil !== 'meldung') beende('andere'); }));
    const sicht = (): void => {
      if (document.visibilityState !== 'visible') beende('verborgen');
    };
    document.addEventListener('visibilitychange', sicht);
    aufraeumen.push(() => document.removeEventListener('visibilitychange', sicht));
    const voll = (): void => {
      if (document.fullscreenElement) beende('vollbild');
    };
    document.addEventListener('fullscreenchange', voll);
    aufraeumen.push(() => document.removeEventListener('fullscreenchange', voll));
    const weg = (): void => beende('pagehide');
    window.addEventListener('pagehide', weg);
    aufraeumen.push(() => window.removeEventListener('pagehide', weg));
  }

  // ---------- Nachrichten vom Hintergrund ----------
  const horcher = (nachricht: unknown, _absender: unknown, antworte: (antwort: unknown) => void): boolean | undefined => {
    if (!lebt() || !istFuer(nachricht, 'inhalt') || nachricht.typ !== 'meldung') return undefined;
    const anlass = nachricht.anlass;
    if (!(MELDUNG_ANLAESSE as readonly string[]).includes(anlass)) {
      antworte({ gezeigt: false });
      return true;
    }
    zeige(anlass, typeof nachricht.zahl === 'number' ? nachricht.zahl : undefined).then(
      (gezeigt) => antworte({ gezeigt }),
      () => antworte({ gezeigt: false }),
    );
    return true;
  };
  browser.runtime.onMessage.addListener(horcher as Parameters<typeof browser.runtime.onMessage.addListener>[0]);

  // ---------- Testhaken: CustomEvent veil-test mit { meldung: {...} } (nur Testbau, nur auf 127.0.0.1 und localhost) ----------
  function beiTestEreignis(ev: Event): void {
    try {
      let detail = (ev as CustomEvent).detail as unknown;
      if (typeof detail === 'string') detail = JSON.parse(detail);
      const d = (detail as { meldung?: { nr?: unknown; anlass?: unknown; zahl?: unknown; vergiss?: unknown; lokalePause?: unknown } } | null)?.meldung;
      if (!d) return;
      if (d.lokalePause === true) meldeLokalePause();
      if (typeof d.anlass === 'string' || d.vergiss === true || typeof d.zahl === 'number') {
        const n: NachrichtHintergrundMeldungTest = { ziel: 'hintergrund', typ: 'meldung-test' };
        if (typeof d.anlass === 'string') n.anlass = d.anlass as MeldungAnlass;
        if (typeof d.zahl === 'number') n.zahl = d.zahl;
        if (d.vergiss === true) n.vergiss = true;
        browser.runtime.sendMessage(n).then(
          (antwort) => schreibeAntwort({ nr: d.nr, antwort }),
          (fehler) => schreibeAntwort({ nr: d.nr, fehler: String(fehler) }),
        );
      } else if (typeof d.nr === 'number') {
        abbild();
        schreibeAntwort({ nr: d.nr, antwort: { ok: true } });
      }
    } catch {
      // ungueltiges Ereignis ignorieren
    }
  }
  if (TESTHAKEN && testMeldung()) {
    document.addEventListener('veil-test', beiTestEreignis);
    abbild();
  }

  // ---------- Begruessung auf Erwachsenenseiten ----------
  // Hoechstens einmal je Host in 30 Minuten (Speicher des Skripts und storage.local, nie der Speicher der Seite; src/meldungen/gruss-merker.ts),
  // nur mit Meldungen an (dieselben Bedingungen wie jede Meldung) und nie, wenn die Galerie des Komplett-Ersatzes ohnehin begruesst. Im Testbau nur mit `veil-gruss` in der Adresse, damit fremde Tests ungestoert bleiben.
  const grussUhr = setTimeout(() => void gruesse(), GRUSS_VERZOEGERUNG_MS);
  async function gruesse(): Promise<void> {
    try {
      if (!lebt()) return;
      if (TESTHAKEN && !location.search.includes(GRUSS_TESTMARKE)) return;
      const host = location.hostname;
      if (await grussSchonGezeigt(host)) return;
      const e = await ladeEinstellungen();
      if (!e.erwachsen.an || e.erwachsen.komplettErsatz || seiteFuer(location.href, e.erwachsen.eigeneSeiten) === null) return;
      if (!(await zeige('gruss', undefined))) return;
      await merkeGruss(host);
    } catch {
      // keine Begruessung
    }
  }

  ctx.onInvalidated(() => {
    abgebaut = true;
    clearTimeout(grussUhr);
    beende('kontext');
    for (const f of fruehListe.splice(0)) f();
    try {
      browser.runtime.onMessage.removeListener(horcher as Parameters<typeof browser.runtime.onMessage.addListener>[0]);
      if (TESTHAKEN) document.removeEventListener('veil-test', beiTestEreignis);
    } catch {
      // Kontext weg
    }
  });
}
