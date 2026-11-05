// Leerlauf-Spirale (Auftrag L, Phase 5, PHASE-5-AUFTRAEGE-SESSION-9.md Abschnitt 5), eingehaengt in entrypoints/content/index.ts.
// Der Hintergrund erkennt Leerlauf mit `browser.idle` und schickt der obersten Seite `inhalt/leerlauf`. Es gibt keine Leerlauf-Erkennung auf der
// Seite: nur den Nachrichten-Horcher und einen fruehen Schutz-Horcher (ab document_start, wie der Tastenschutz in src/riegel/tastatur.ts), der ohne
// Spirale, Warnkarte oder Nachlauf sofort zurueckkehrt. Er steht VOR allen Seitenskripten, darum erreicht das beendende Ereignis (und jedes
// Ereignis auf der Warnkarte) die Seite nicht. Bewegung, Rad und Beruehrung hoeren wir nur, solange etwas steht (nicht passiv, damit
// preventDefault wirkt). Die Eingabe-Wache aus kontrolle/gemeinsam startet L nicht: bei echtem Leerlauf waere sie wertlos.
import { beiEinstellungsAenderung, aendereEinstellungen, ladeEinstellungen, type Einstellungen } from '../einstellungen';
import { andereVorDerSeite, eingabeAktiv, kontrolleErlaubt, istOberstesFenster, meldeBelegt, merkeWarnung, ruhigGewuenscht, warnungGesehen } from '../kontrolle/gemeinsam';
import type { AntwortPackDaten, NachrichtHintergrundLeerlaufTest, NachrichtHintergrundPackDaten } from '../nachrichten';
import { istFuer } from '../nachrichten';
import { PACK_SPEICHER_SCHLUESSEL, kurzAusRoh, ladePackKurz, type PackKurz } from '../pack/vertrag';
import { beiLokalerPause, meldeLokalePause } from '../pause-lokal';
import { pruefeTexte } from '../quiz/vertrag';
import { registriereHost } from '../riegel/tastatur';
import { TESTHAKEN } from '../schleier/konstanten';
import type { KontextLeicht } from '../schleier/schleier';
import { LeerlaufAnsicht } from './ansicht';
import {
  absageGrund,
  drehungFuer,
  LeerlaufZustand,
  mausBewegt,
  NACHLAUF_MAX_MS,
  NACHLAUF_NACH_LOSLASSEN_MS,
  NACHLAUF_NACH_LOSLASSEN_TOUCH_MS,
  waehleSatz,
  type Absage,
  type Drehung,
} from './logik';
import { schreibeAbbild, schreibeAntwort, testSpirale } from './testspur';
import { bilderGesamt, stelleUhrVor, type Bildstand } from './zeichne';
import { melde } from '../ereignisse';

const LADE_FRIST_MS = 5000;
// Frueh angemeldet (ab document_start, nicht scroll-blockierend): Zeiger- und Tastenereignisse.
const ZEIGER_FRUEH = ['pointerdown', 'pointerup', 'pointercancel', 'mousedown', 'mouseup', 'click', 'dblclick', 'auxclick', 'contextmenu', 'dragstart'] as const;
const TASTEN = ['keydown', 'keyup', 'keypress', 'beforeinput', 'input', 'compositionstart', 'compositionupdate', 'compositionend'] as const;
// Erst angemeldet, solange Spirale oder Karte steht (nicht passiv: Rad und Beruehrung blockieren sonst das Scrollen der Seite von Anfang an).
const SPAET = ['pointermove', 'mousemove', 'wheel', 'touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
const TOUCH = ['touchstart', 'touchmove', 'touchend', 'touchcancel'] as const;
const LOSLASSEN_ZEIGER = ['pointerup', 'mouseup', 'touchend', 'pointercancel', 'touchcancel'];
const BEWEGUNG = ['pointermove', 'mousemove'];
// Ereignisse, deren Rest (Loslassen, Klick) zur selben Geste gehoert.
const GESTE_ZEIGER = ['pointerdown', 'mousedown', 'touchstart', 'contextmenu', 'dragstart'];
const GESTE_FERTIG = ['click', 'dblclick', 'auxclick'];

type NachlaufArt = 'taste' | 'zeiger';
interface Nachlauf {
  art: NachlaufArt;
  touch: boolean;
  timer: ReturnType<typeof setTimeout> | null;
  grenze: ReturnType<typeof setTimeout>;
  abmelden: () => void;
}

export function starteSpirale(ctx: KontextLeicht): void {
  if (!istOberstesFenster()) return;
  const zustand = new LeerlaufZustand();
  let ansicht: LeerlaufAnsicht | null = null;
  let lauf = 0; // erhoeht bei jedem Start und jedem Abbruch: laufende Pruefungen merken, dass sie veraltet sind
  let aufraeumen: Array<() => void> = [];
  let nachlauf: Nachlauf | null = null;
  let texteGeladen: { schluessel: string; liste: string[] } | null = null;
  let aktuelleEinstellungen: Einstellungen | null = null;
  let aktuellesPack: PackKurz | null = null;
  let drehung: Drehung | null = null;
  let entscheidungen = 0;
  let ergebnis = '';
  let endeGrund = '';
  let endeZeit = 0;
  let letzterAbbild = 0;
  let letzteMaus: { x: number; y: number } | null = null;
  let offeneHoerer = 0;
  let abgebaut = false;
  const lebt = (): boolean => !abgebaut && ctx.isValid;

  // Anmeldung mit Buchfuehrung (der Test belegt: nach dem Ende ist nichts mehr angemeldet).
  function haenge(ziel: EventTarget, typen: readonly string[], fn: (e: Event) => void, nichtPassiv: boolean, liste: Array<() => void>): void {
    for (const t of typen) {
      ziel.addEventListener(t, fn, { capture: true, passive: !nichtPassiv });
      offeneHoerer++;
      liste.push(() => {
        ziel.removeEventListener(t, fn, true);
        offeneHoerer--;
      });
    }
  }

  // ---------- Testspur ----------
  function abbild(bildstand?: Bildstand | null): void {
    if (!TESTHAKEN || !testSpirale()) return;
    const b = bildstand ?? ansicht?.stand() ?? null;
    schreibeAbbild({
      phase: zustand.phase,
      gesperrt: zustand.gesperrt,
      entscheidungen,
      ergebnis,
      endeGrund,
      endeZeit,
      satz: ansicht?.satz ?? '',
      arme: drehung?.arme ?? null,
      umdrehungen: drehung?.umdrehungenJeSekunde ?? null,
      hz: drehung?.hz ?? null,
      ruhig: drehung?.ruhig ?? null,
      deckkraft: b?.deckkraft ?? null,
      winkel: b?.winkel ?? null,
      winkelZeit: b?.winkelZeit ?? null,
      stehend: b?.stehend ?? null,
      bilder: b?.bilder ?? null,
      bilderGesamt: bilderGesamt(),
      offeneHoerer,
      nachlaufAktiv: nachlauf !== null,
      aufloesung: ansicht?.aufloesung ?? null,
      host: ansicht ? ansicht.rect(ansicht.host) : null,
      knoepfe: ansicht?.knopfRechtecke() ?? null,
      jetzt: performance.now(),
    });
  }

  function entscheide(wert: string): void {
    entscheidungen++;
    ergebnis = wert;
    abbild();
  }

  // ---------- Schlucken ----------
  // Das Ereignis erreicht weder die Seite noch (bei Abbruch) deren Standardaktion (Scrollen, Fokuswechsel, Link).
  function schlucke(e: Event, standardAuch = true): void {
    e.stopImmediatePropagation();
    if (standardAuch && e.cancelable) e.preventDefault();
  }

  // ---------- Nachlauf: der Rest der Geste, die beendet hat, erreicht die Seite nicht ----------
  function beendeNachlauf(): void {
    const n = nachlauf;
    if (!n) return;
    nachlauf = null;
    if (n.timer) clearTimeout(n.timer);
    clearTimeout(n.grenze);
    n.abmelden();
    abbild();
  }

  // `schonLos`: die Geste ist beim Ende schon fertig (Klick, keyup): der Nachlauf laeuft nur kurz aus.
  function starteNachlauf(art: NachlaufArt, touch: boolean, schonLos: boolean): void {
    beendeNachlauf();
    const liste: Array<() => void> = [];
    // Touch-Ereignisse nur fuer den Nachlauf anmelden (die frueh angemeldeten Zeiger- und Tastenhoerer sind schon da).
    if (art === 'zeiger') haenge(window, TOUCH, schutz, true, liste);
    const n: Nachlauf = {
      art,
      touch,
      timer: null,
      grenze: setTimeout(beendeNachlauf, NACHLAUF_MAX_MS),
      abmelden: () => {
        for (const f of liste) f();
      },
    };
    nachlauf = n;
    // Kommt das Loslassen nie an (Fenster verlassen, Tab verborgen), endet der Nachlauf sofort: der naechste Tastendruck oder Klick gehoert der Seite.
    const beiBlur = (e: Event): void => {
      if (e.target === window) beendeNachlauf();
    };
    window.addEventListener('blur', beiBlur, true);
    const beiSicht = (): void => {
      if (document.visibilityState !== 'visible') beendeNachlauf();
    };
    document.addEventListener('visibilitychange', beiSicht);
    liste.push(() => {
      window.removeEventListener('blur', beiBlur, true);
      document.removeEventListener('visibilitychange', beiSicht);
    });
    if (schonLos) plane(n);
  }

  function plane(n: Nachlauf): void {
    if (n.timer) clearTimeout(n.timer);
    n.timer = setTimeout(beendeNachlauf, n.art === 'taste' ? 0 : n.touch ? NACHLAUF_NACH_LOSLASSEN_TOUCH_MS : NACHLAUF_NACH_LOSLASSEN_MS);
  }

  function behandleNachlauf(e: Event): void {
    const n = nachlauf;
    if (!n) return;
    const typen: readonly string[] = n.art === 'taste' ? TASTEN : [...ZEIGER_FRUEH, ...TOUCH];
    if (!typen.includes(e.type)) return;
    schlucke(e);
    if (n.art === 'taste' ? e.type === 'keyup' : LOSLASSEN_ZEIGER.includes(e.type)) plane(n);
  }

  // ---------- Ende ----------
  function raeumeHoererAuf(): void {
    const liste = aufraeumen;
    aufraeumen = [];
    for (const f of liste) {
      try {
        f();
      } catch {
        // Kontext weg: die Anmeldungen sind es auch
      }
    }
  }

  // Beendet Spirale oder Warnkarte sofort (ein einziger Wechsel, kein Ausblenden). `geste`: die beendende Geste wird zu Ende geschluckt.
  function beende(grund: string, geste?: { art: NachlaufArt; touch?: boolean; schonLos?: boolean }): void {
    const warSpirale = zustand.phase === 'spirale';
    const warKarte = zustand.phase === 'warnung';
    if (!warSpirale && !warKarte) return;
    const a = ansicht;
    ansicht = null;
    a?.entferne();
    raeumeHoererAuf();
    meldeBelegt('spirale', false);
    const jetzt = performance.now();
    if (warSpirale) zustand.endeSpirale(jetzt);
    else zustand.schliesseWarnung(jetzt);
    if (geste) starteNachlauf(geste.art, geste.touch === true, geste.schonLos === true);
    endeGrund = grund;
    endeZeit = jetzt;
    abbild();
  }

  // ---------- Wachen, solange etwas steht ----------
  function pruefeWeiter(e: Einstellungen | null, p: PackKurz | null): void {
    if (zustand.phase !== 'spirale' && zustand.phase !== 'warnung') return;
    if (!e || !kontrolleErlaubt(e, p, 'kontrolle:leerlauf') || !e.kontrolle.leerlauf) beende('einstellung');
  }

  function meldeWachen(mitEingabe: boolean): void {
    aufraeumen.push(
      beiEinstellungsAenderung((neu) => {
        aktuelleEinstellungen = neu;
        pruefeWeiter(neu, aktuellesPack);
        // Das Ende einer lokalen Pause setzt der Pause-Vertrag in derselben Meldung zurueck: danach noch einmal bewerten.
        setTimeout(() => lebt() && pruefeWeiter(aktuelleEinstellungen, aktuellesPack), 0);
      }),
    );
    const packHoerer = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
      if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aenderungen)) return;
      aktuellesPack = kurzAusRoh(aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue);
      pruefeWeiter(aktuelleEinstellungen, aktuellesPack);
    };
    browser.storage.onChanged.addListener(packHoerer);
    aufraeumen.push(() => browser.storage.onChanged.removeListener(packHoerer));
    aufraeumen.push(beiLokalerPause(() => beende('pause')));
    const sicht = () => {
      if (document.visibilityState !== 'visible') beende('verborgen');
    };
    document.addEventListener('visibilitychange', sicht);
    aufraeumen.push(() => document.removeEventListener('visibilitychange', sicht));
    const voll = () => {
      if (document.fullscreenElement) beende('vollbild');
    };
    document.addEventListener('fullscreenchange', voll);
    aufraeumen.push(() => document.removeEventListener('fullscreenchange', voll));
    // Bewegung, Rad und Beruehrung: nur solange die Spirale steht (unter der Warnkarte scrollt die Seite ungebremst weiter).
    if (mitEingabe) haenge(window, SPAET, schutz, true, aufraeumen);
    letzteMaus = null;
  }

  // ---------- Der Schutz-Horcher (frueh angemeldet) ----------
  function schutz(e: Event): void {
    if (!e.isTrusted) return;
    if (zustand.phase === 'spirale') behandleSpirale(e);
    else if (zustand.phase === 'warnung') behandleKarte(e);
    else if (nachlauf) behandleNachlauf(e);
  }

  function behandleSpirale(e: Event): void {
    const typ = e.type;
    if (BEWEGUNG.includes(typ)) {
      const m = e as MouseEvent;
      const touch = (e as PointerEvent).pointerType === 'touch';
      const pos = { x: m.screenX, y: m.screenY };
      const bewegt = touch || mausBewegt(letzteMaus, { ...pos, bewegungX: m.movementX, bewegungY: m.movementY });
      letzteMaus = pos;
      schlucke(e);
      if (bewegt) beende('maus-bewegt');
      return;
    }
    schlucke(e);
    const taste = (TASTEN as readonly string[]).includes(typ);
    const touch = typ.startsWith('touch') || (e as PointerEvent).pointerType === 'touch';
    const zeiger = GESTE_ZEIGER.includes(typ) || GESTE_FERTIG.includes(typ);
    const fertig = GESTE_FERTIG.includes(typ) || typ === 'keyup' || LOSLASSEN_ZEIGER.includes(typ);
    beende(`eingabe-${typ}`, taste ? { art: 'taste', schonLos: fertig } : zeiger || LOSLASSEN_ZEIGER.includes(typ) ? { art: 'zeiger', touch, schonLos: fertig } : undefined);
  }

  // Die Warnkarte ist modal: Zeiger auf ihr und alle Tasten gehen nur an die Karte, nie an die Seite.
  function behandleKarte(e: Event): void {
    const typ = e.type;
    if ((TASTEN as readonly string[]).includes(typ)) {
      kartenTaste(e as KeyboardEvent);
      return;
    }
    if (!ansicht || BEWEGUNG.includes(typ)) return;
    if (e.target !== ansicht.host) return;
    // Zeiger: die Seite sieht nichts davon. Standardaktion bleibt (Beruehrung muss einen Klick ergeben), nur der Klick selbst wird gewertet.
    schlucke(e, typ === 'click' || typ === 'auxclick' || typ === 'dblclick' || typ === 'contextmenu');
    if (typ !== 'click') return;
    const m = e as MouseEvent;
    // Ein Klick ohne Position (Tastenaktivierung) wird ueber die Tasten gewertet.
    if (m.detail === 0 && m.clientX === 0 && m.clientY === 0) return;
    const wo = ansicht.trifft(m.clientX, m.clientY);
    if (wo === 'ja') antwortKarte('verstanden', { art: 'zeiger', schonLos: true });
    else if (wo === 'nein') antwortKarte('nein', { art: 'zeiger', schonLos: true });
    else if (wo === 'daneben') antwortKarte('zu', { art: 'zeiger', schonLos: true });
  }

  function kartenTaste(e: KeyboardEvent): void {
    schlucke(e);
    if (e.type !== 'keydown' || !ansicht) return;
    if (e.key === 'Escape') antwortKarte('zu', { art: 'taste' }, 'warnung-escape');
    else if (e.key === 'Tab') ansicht.fokusWeiter(e.shiftKey);
    else if (e.key === 'Enter' || e.key === ' ') {
      const k = ansicht.aktiverKnopf();
      if (k === 'ja') antwortKarte('verstanden', { art: 'taste' });
      else if (k === 'nein') antwortKarte('nein', { art: 'taste' });
    }
  }

  function antwortKarte(was: 'verstanden' | 'nein' | 'zu', geste: { art: NachlaufArt; schonLos?: boolean }, grund?: string): void {
    if (zustand.phase !== 'warnung') return;
    if (was === 'verstanden') {
      beende('warnung-verstanden', geste);
      void merkeWarnung();
    } else if (was === 'nein') {
      beende('warnung-nein', geste);
      void aendereEinstellungen((alt) => ({ kontrolle: { ...alt.kontrolle, leerlauf: false } })).catch(() => undefined);
    } else beende(grund ?? 'warnung-daneben', geste);
  }

  // Frueh, vor allen Seitenskripten: ohne Spirale, Karte oder Nachlauf kehrt `schutz` sofort zurueck.
  const fruehListe: Array<() => void> = [];
  haenge(window, [...ZEIGER_FRUEH, ...TASTEN], schutz, true, fruehListe);

  // ---------- Anzeigen ----------
  function zeigeSpirale(e: Einstellungen, satz: string): void {
    if (!zustand.zeigeSpirale()) return;
    drehung = drehungFuer(ruhigGewuenscht(e));
    const a = new LeerlaufAnsicht();
    ansicht = a;
    meldeBelegt('spirale', true);
    melde({ art: 'spirale' }); // Session 11: Ledger
    meldeWachen(true);
    // Tasten, die den Fokus im Host treffen, schluckt der Tastenschutz (src/riegel/tastatur.ts) noch vor allen anderen Horchern.
    aufraeumen.push(
      registriereHost(a.host, (ev) => {
        ev.preventDefault();
        if (ev.isTrusted) beende(`taste-${ev.type}`, { art: 'taste', schonLos: ev.type === 'keyup' });
      }),
    );
    a.zeigeSpirale(satz, drehung, (s) => {
      const jetzt = performance.now();
      if (jetzt - letzterAbbild >= 100 || s.stehend) {
        letzterAbbild = jetzt;
        abbild(s);
      }
    });
    endeGrund = '';
    entscheide('spirale');
  }

  function zeigeWarnung(): void {
    if (!zustand.zeigeWarnung()) return;
    drehung = null;
    const a = new LeerlaufAnsicht();
    ansicht = a;
    meldeWachen(false);
    aufraeumen.push(registriereHost(a.host, (ev) => kartenTaste(ev)));
    endeGrund = '';
    a.zeigeWarnung();
    entscheide('warnung');
  }

  // ---------- Saetze ----------
  async function holeSaetze(pack: PackKurz): Promise<string[]> {
    const schluessel = `${pack.id}|${pack.version}|${pack.importiert}`;
    if (texteGeladen?.schluessel === schluessel) return texteGeladen.liste;
    let frist: ReturnType<typeof setTimeout> | undefined;
    try {
      const n: NachrichtHintergrundPackDaten = { ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' };
      const stopp = new Promise<undefined>((ok) => {
        frist = setTimeout(() => ok(undefined), LADE_FRIST_MS);
      });
      const a = (await Promise.race([browser.runtime.sendMessage(n) as Promise<AntwortPackDaten | undefined>, stopp])) as AntwortPackDaten | undefined;
      if (!a || a.ok !== true || !a.daten) return [];
      const liste = pruefeTexte(a.daten)?.gruppen.leerlauf ?? [];
      texteGeladen = { schluessel, liste: [...liste] };
      return texteGeladen.liste;
    } catch {
      return [];
    } finally {
      if (frist) clearTimeout(frist);
    }
  }

  // ---------- Leerlauf beginnt ----------
  async function beiIdle(): Promise<void> {
    const jetztMs = performance.now();
    if (!zustand.versucheStart(jetztMs)) {
      entscheide(zustand.warumNicht(jetztMs));
      return;
    }
    const meiner = ++lauf;
    const veraltet = (): boolean => !lebt() || meiner !== lauf || zustand.phase !== 'laedt';
    const lage = (e: Einstellungen, p: PackKurz | null, satz: string): Absage | null =>
      absageGrund({
        oberste: istOberstesFenster(),
        schalterAn: e.kontrolle.leerlauf,
        erlaubt: kontrolleErlaubt(e, p, 'kontrolle:leerlauf'),
        sichtbar: document.visibilityState === 'visible',
        tippt: eingabeAktiv(),
        belegt: andereVorDerSeite('spirale'),
        vollbild: !!document.fullscreenElement,
        satz,
      });
    try {
      const [e, pack] = await Promise.all([ladeEinstellungen(), ladePackKurz()]);
      if (veraltet()) return;
      aktuelleEinstellungen = e;
      aktuellesPack = pack;
      // Erst die Lage ohne Satz (spart den Weg zum Hintergrund), dann die Saetze.
      const vorab = lage(e, pack, 'x');
      if (vorab) return abgesagt(vorab);
      const satz = waehleSatz(await holeSaetze(pack!), Math.random());
      if (veraltet()) return;
      const absage = lage(e, pack, satz);
      if (absage) return abgesagt(absage);
      const gesehen = await warnungGesehen();
      if (veraltet()) return;
      // Nach dem Warten noch einmal: wer inzwischen tippt, bekommt weder Karte noch Spirale.
      const zuletzt = lage(e, pack, satz);
      if (zuletzt) return abgesagt(zuletzt);
      if (gesehen) zeigeSpirale(e, satz);
      else zeigeWarnung();
    } catch {
      zustand.verwirf();
      entscheide('fehler');
    }
  }

  function abgesagt(grund: Absage): void {
    zustand.verwirf();
    entscheide(`absage:${grund}`);
  }

  function beiAktiv(): void {
    const was = zustand.aktiv();
    if (was === 'spirale-beenden') {
      beende('aktiv');
      zustand.gesperrt = false; // active ist genau der Wechsel, auf den die Sperre wartet
      abbild();
    } else if (was === 'abgebrochen') {
      lauf++;
      entscheide('abgebrochen');
    } else abbild();
  }

  // ---------- Nachrichten vom Hintergrund ----------
  const horcher = (nachricht: unknown): undefined => {
    if (!lebt() || !istFuer(nachricht, 'inhalt') || nachricht.typ !== 'leerlauf') return undefined;
    if (nachricht.an) void beiIdle();
    else beiAktiv();
    return undefined;
  };
  browser.runtime.onMessage.addListener(horcher);

  // ---------- Testhaken: CustomEvent veil-test mit { spirale: {...} } (nur Testbau, nur auf 127.0.0.1 und localhost) ----------
  function beiTestEreignis(ev: Event): void {
    try {
      let detail = (ev as CustomEvent).detail as unknown;
      if (typeof detail === 'string') detail = JSON.parse(detail);
      const d = (detail as { spirale?: { zustand?: unknown; nr?: unknown; lokalePause?: unknown; uhrVor?: unknown } } | null)?.spirale;
      if (!d) return;
      if (d.lokalePause === true) meldeLokalePause();
      if (typeof d.uhrVor === 'number') stelleUhrVor(d.uhrVor);
      if (d.zustand === 'idle' || d.zustand === 'active' || d.zustand === 'locked') {
        const nr = d.nr;
        const n: NachrichtHintergrundLeerlaufTest = { ziel: 'hintergrund', typ: 'leerlauf-test', zustand: d.zustand };
        browser.runtime.sendMessage(n).then(
          (antwort) => schreibeAntwort({ nr, antwort }),
          (fehler) => schreibeAntwort({ nr, fehler: String(fehler) }),
        );
      } else if (typeof d.nr === 'number') {
        abbild();
        schreibeAntwort({ nr: d.nr, antwort: { ok: true } });
      }
    } catch {
      // ungueltiges Ereignis ignorieren
    }
  }
  if (TESTHAKEN && testSpirale()) {
    document.addEventListener('veil-test', beiTestEreignis);
    abbild();
  }

  ctx.onInvalidated(() => {
    abgebaut = true;
    lauf++;
    beende('kontext');
    beendeNachlauf();
    for (const f of fruehListe.splice(0)) f();
    try {
      browser.runtime.onMessage.removeListener(horcher);
      if (TESTHAKEN) document.removeEventListener('veil-test', beiTestEreignis);
    } catch {
      // Kontext weg
    }
  });
}
