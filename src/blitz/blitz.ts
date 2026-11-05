// Blitzwoerter (Auftrag B, Phase 5, PHASE-5-AUFTRAEGE-SESSION-9.md Abschnitt 4): selten ein einzelnes Wort von Mia kurz in der Mitte der Seite,
// gelegentlich ein kleiner Schwarm; nie beim Tippen, nie als Flaechenwechsel (kein Hintergrund, keine Abdunklung, nur Schrift).
// Eigenes Modul neben dem Schleier, nur in der obersten Seite, nur mit Pack (`kontrolle:blitz`, Satz-Gruppe `blitzwoerter`) und eigenem Schalter.
// Grenzen (185 ms je Wort, hoechstens 12 Woerter in 2500 ms) gelten ueber `deckleWortPlan` (src/blitz/ereignis.ts) und noch einmal beim Zeigen.
// Zeitplan ueber alle Tabs: src/blitz/zeitplan.ts. Abbruch sofort (alle Woerter weg, bevor der naechste Frame gezeichnet wird).
import { ladeEinstellungen, beiEinstellungsAenderung, type Einstellungen } from '../einstellungen';
import { BLITZ_WORT_MIN_ABSTAND_MS, SCHWARM_MAX_MS, SCHWARM_MAX_WORTE } from '../kontrolle/grenzen';
import { andereVorDerSeite, eingabeAktiv, istOberstesFenster, kontrolleErlaubt, meldeBelegt, ruhigGewuenscht, starteEingabeWache, warnungGesehen } from '../kontrolle/gemeinsam';
import type { AntwortPackDaten, NachrichtHintergrundPackDaten } from '../nachrichten';
import { PACK_SPEICHER_SCHLUESSEL, ladePackKurz, type PackKurz } from '../pack/vertrag';
import { beiLokalerPause, istLokalePause } from '../pause-lokal';
import { pruefeTexte } from '../quiz/vertrag';
import { TESTHAKEN } from '../schleier/konstanten';
import type { KontextLeicht } from '../schleier/schleier';
import { testhakenAktiv } from '../schleier/status';
import { planeEreignis, waehleArt, type Art, type GeplantesWort } from './ereignis';
import { PRUEF_TAKT_MS, ZEITPLAN_SCHLUESSEL, pruefeZeitplan, wirksameHaeufigkeit } from './zeitplan';
import { melde } from '../ereignisse';

const MIAS_PINK = '#ff4fa3';
const KONTUR = '#2a0a1f';
// Reserve fuer die Bildtakt-Rundung beim Ausblenden (ein Frame bei 30 Hz): die 2500 ms gelten fuer das, was auf dem Bildschirm steht.
const FRAME_RESERVE_MS = 40;
// Testabbild (nur Testbau): JSON am html-Element mit den gezeigten Woertern und Zeitpunkten (performance.now()).
const ATTR_ABBILD: string = TESTHAKEN ? 'data-veil-blitz' : '';

const STIL = `
:host { all: initial; }
.w { position: fixed; transform: translate(-50%, -50%); width: max-content; max-width: 90vw; text-align: center; pointer-events: none;
  font: 900 clamp(32px, 8vw, 96px)/1.1 system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; letter-spacing: 0.02em; color: ${MIAS_PINK};
  -webkit-text-stroke: 0.08em ${KONTUR}; paint-order: stroke fill; text-shadow: 0 0 0.06em ${KONTUR}; user-select: none; }
.w[hidden] { display: none; }
`;

interface Lage {
  e: Einstellungen;
  pack: PackKurz;
  woerter: string[];
  // Stand des Zaehlers `epoche` beim Start der Vorpruefung: hat sich seither etwas geaendert (Pause, Einstellung, Pack), wird nicht gezeigt.
  ep: number;
}

export function starteBlitz(ctx: KontextLeicht): void {
  if (!istOberstesFenster()) return;
  starteEingabeWache();
  let abgebaut = false;
  // Zaehler, den jedes Abbruch-Ereignis erhoeht (Pause, Einstellung, Pack, Taste, Fokus, ...): die Vorpruefung wartet mehrfach auf den
  // Speicher und den Hintergrund; was in dieser Zeit passiert, darf nicht verloren gehen, auch wenn noch nichts lief, das man abbrechen koennte.
  let epoche = 0;
  let letzteE: Einstellungen | null = null;
  let letztePack: PackKurz | null = null;
  const lebt = (): boolean => !abgebaut && ctx.isValid;

  // ---------- Bedingungen ----------
  let woerterCache: { schluessel: string; woerter: string[] } | null = null;

  async function holeWoerter(pack: PackKurz): Promise<string[]> {
    const schluessel = `${pack.id}|${pack.version}|${pack.importiert}`;
    if (woerterCache?.schluessel === schluessel) return woerterCache.woerter;
    try {
      const n: NachrichtHintergrundPackDaten = { ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' };
      const a = (await browser.runtime.sendMessage(n)) as AntwortPackDaten | undefined;
      if (!a || a.ok !== true || !a.daten) return [];
      const t = pruefeTexte(a.daten);
      const w = t?.gruppen.blitzwoerter ?? [];
      woerterCache = { schluessel, woerter: w };
      return w;
    } catch {
      return [];
    }
  }

  // Grundbedingungen ohne Ort und Eingabe: Pack, Schalter, Pause, Ausnahme. Liefert die Lage oder den Grund, warum nichts geschieht.
  async function grundLage(): Promise<Lage | string> {
    let e: Einstellungen;
    let pack: PackKurz | null;
    const ep = epoche;
    try {
      [e, pack] = await Promise.all([ladeEinstellungen(), ladePackKurz()]);
    } catch {
      return 'speicher';
    }
    if (!pack) return 'kein-pack';
    if (wirksameHaeufigkeit(e, pack) === null) return 'aus';
    if (!kontrolleErlaubt(e, pack, 'kontrolle:blitz')) return 'nicht-erlaubt';
    // nur wenn sich seit dem Start der Lesung nichts geaendert hat (sonst waere der Stand schon veraltet)
    if (epoche === ep) {
      letzteE = e;
      letztePack = pack;
    }
    return { e, pack, woerter: [], ep };
  }

  // Bedingungen des Augenblicks. Liefert den Grund (Text) oder null, wenn alles passt.
  function augenblickGrund(e: Einstellungen): string | null {
    if (document.visibilityState !== 'visible' || !document.hasFocus()) return 'unsichtbar';
    if (ruhigGewuenscht(e)) return 'ruhig';
    if (eingabeAktiv()) return 'eingabe';
    if (andereVorDerSeite('blitz')) return 'belegt';
    if (document.fullscreenElement) return 'vollbild';
    if (laeuft) return 'laeuft';
    return null;
  }

  async function pruefeAlles(): Promise<Lage | string> {
    const g = await grundLage();
    if (typeof g === 'string') return g;
    const grund = augenblickGrund(g.e);
    if (grund) return grund;
    if (!(await warnungGesehen())) return 'warnung';
    g.woerter = await holeWoerter(g.pack);
    if (g.woerter.length === 0) return 'keine-woerter';
    // Waehrend der Awaits kann sich etwas geaendert haben.
    if (epoche !== g.ep) return 'geaendert';
    return augenblickGrund(g.e) ?? g;
  }

  // ---------- Anzeige ----------
  let laeuft = false;
  let host: HTMLElement | null = null;
  let wortEl: HTMLElement | null = null;
  let rahmenId = 0;
  let letztesWort: string | null = null;
  let lauf: { gezeigt: Array<{ text: string; an: number; aus: number | null }>; beenden: (grund: string) => void } | null = null;
  let nr = 0;

  const abbild = (inhalt: Record<string, unknown>): void => {
    if (!TESTHAKEN || !testhakenAktiv()) return;
    try {
      document.documentElement.setAttribute(ATTR_ABBILD, JSON.stringify({ nr, ...inhalt }));
    } catch {
      // Dokument weg
    }
  };

  // Der Host ist ein Punkt ohne Flaeche (Breite und Hoehe 0), alle Eigenschaften mit important: Seitenregeln wie `div { background: #000 !important }`
  // oder `filter` und `box-shadow` koennen daraus keine Flaeche machen (kein vollflaechiger Wechsel). Die Woerter liegen fest im Shadow Root.
  const HOST_STIL: ReadonlyArray<[string, string]> = [
    ['all', 'initial'],
    ['display', 'block'],
    ['position', 'fixed'],
    ['left', '0'],
    ['top', '0'],
    ['width', '0'],
    ['height', '0'],
    ['margin', '0'],
    ['padding', '0'],
    ['border', '0'],
    ['overflow', 'visible'],
    ['background', 'transparent'],
    ['filter', 'none'],
    ['backdrop-filter', 'none'],
    ['box-shadow', 'none'],
    ['outline', 'none'],
    ['opacity', '1'],
    ['visibility', 'visible'],
    ['transform', 'none'],
    ['z-index', '2147483647'],
    ['pointer-events', 'none'],
  ];

  function baueHost(): void {
    if (host) return;
    // Eigener Elementname statt div: Seitenregeln auf `div` und `div::after` treffen den Host nicht (Inline-Styles erreichen keine Pseudo-Elemente).
    const h = document.createElement('veil-blitz');
    h.setAttribute('aria-hidden', 'true');
    for (const [k, v] of HOST_STIL) h.style.setProperty(k, v, 'important');
    const wurzel = h.attachShadow({ mode: 'closed' });
    const st = document.createElement('style');
    st.textContent = STIL;
    const w = document.createElement('div');
    w.className = 'w';
    w.hidden = true;
    wurzel.append(st, w);
    (document.documentElement ?? document).appendChild(h);
    host = h;
    wortEl = w;
  }

  function entferneHost(): void {
    host?.remove();
    host = null;
    wortEl = null;
  }

  function zeige(plan: GeplantesWort[]): void {
    if (plan.length === 0 || laeuft) return;
    laeuft = true;
    meldeBelegt('blitz', true);
    melde({ art: 'blitz', woerter: plan.length }); // Session 11: Ledger und Ton (Trigger)
    baueHost();
    const gezeigt: Array<{ text: string; an: number; aus: number | null }> = [];
    let naechster = 0;
    let t0: number | null = null;
    let letzterAn = -Infinity;
    let sichtbarBis = 0;
    let sichtbar = false;
    let beendet = false;
    let wortTimer: ReturnType<typeof setTimeout> | null = null;
    let hartTimer: ReturnType<typeof setTimeout> | null = null;
    const geplant = plan.map((w) => ({ text: w.text, beginnMs: w.beginnMs, dauerMs: w.dauerMs }));

    const schreibe = (laufend: boolean, abbruch?: string): void => abbild({ laeuft: laufend, woerter: gezeigt, plan: geplant, abbruch: abbruch ?? null });

    const verberge = (t: number): void => {
      if (!sichtbar) return;
      sichtbar = false;
      if (wortEl) wortEl.hidden = true;
      const z = gezeigt[gezeigt.length - 1];
      if (z && z.aus === null) z.aus = t;
    };

    const beende = (grund: string): void => {
      if (beendet) return;
      beendet = true;
      cancelAnimationFrame(rahmenId);
      if (wortTimer) clearTimeout(wortTimer);
      if (hartTimer) clearTimeout(hartTimer);
      verberge(performance.now());
      entferneHost();
      laeuft = false;
      lauf = null;
      meldeBelegt('blitz', false);
      schreibe(false, grund);
    };
    lauf = { gezeigt, beenden: beende };

    const rahmen = (t: number): void => {
      if (beendet) return;
      if (!lebt()) return beende('kontext');
      // Abbruch: alles, was nicht mehr stimmt (die Ereignisse selbst brechen schon vorher synchron ab).
      if (document.visibilityState !== 'visible') return beende('verborgen');
      if (istLokalePause() || letzteE?.pause) return beende('pause');
      if (letzteE && (wirksameHaeufigkeit(letzteE, letztePack) === null || ruhigGewuenscht(letzteE))) return beende('einstellung');
      if (eingabeAktiv()) return beende('eingabe');
      if (andereVorDerSeite('blitz')) return beende('belegt');
      if (document.fullscreenElement) return beende('vollbild');
      if (t0 === null) t0 = t;
      if (sichtbar && t >= sichtbarBis) verberge(t);
      const w = geplant[naechster];
      if (w) {
        // Die Grenzen noch einmal im Lauf: Mindestabstand 185 ms zum letzten Anfang, hoechstens 12 Woerter, nichts nach 2500 ms.
        const erster = gezeigt[0]?.an ?? t;
        if (gezeigt.length >= SCHWARM_MAX_WORTE || t - erster >= SCHWARM_MAX_MS - FRAME_RESERVE_MS) naechster = geplant.length;
        else if (t - t0 >= w.beginnMs && t - letzterAn >= BLITZ_WORT_MIN_ABSTAND_MS) {
          const p = plan[naechster]!;
          naechster++;
          if (wortEl) {
            wortEl.textContent = w.text;
            wortEl.style.left = `${p.x * 100}%`;
            wortEl.style.top = `${p.y * 100}%`;
            wortEl.hidden = false;
          }
          sichtbar = true;
          letzterAn = t;
          letztesWort = w.text;
          sichtbarBis = Math.min(t + w.dauerMs, erster + SCHWARM_MAX_MS - FRAME_RESERVE_MS);
          // Harter Schluss ohne Bildtakt: bei sehr langsamem Bildtakt (unter 25 Hz) blendet der Zeitgeber das Wort trotzdem aus und beendet nach
          // 2500 ms (abzueglich Reserve) ab dem ersten Wort. Bei ganz blockiertem Hauptthread laufen auch Zeitgeber nicht: dort hilft nichts.
          if (wortTimer) clearTimeout(wortTimer);
          wortTimer = setTimeout(() => verberge(performance.now()), Math.max(0, sichtbarBis - performance.now()));
          if (!hartTimer) hartTimer = setTimeout(() => beende(naechster >= geplant.length ? 'fertig' : 'zeit'), SCHWARM_MAX_MS - FRAME_RESERVE_MS);
          if (gezeigt[gezeigt.length - 1]?.aus === null) gezeigt[gezeigt.length - 1]!.aus = t;
          gezeigt.push({ text: w.text, an: t, aus: null });
          schreibe(true);
        }
      }
      if (naechster >= geplant.length && !sichtbar) return beende('fertig');
      rahmenId = requestAnimationFrame(rahmen);
    };
    schreibe(true);
    rahmenId = requestAnimationFrame(rahmen);
  }

  function brichAb(grund: string): void {
    epoche++;
    lauf?.beenden(grund);
  }

  // ---------- Ereignis ausloesen ----------
  // Synchron, direkt vor dem Zeigen: hat sich seit der Vorpruefung etwas geaendert, wird nichts gezeigt. Liefert den Grund oder null.
  function zeigeMit(l: Lage, art: Art | null, zufall: () => number): string | null {
    if (!lebt()) return 'kontext';
    if (epoche !== l.ep) return 'geaendert';
    const grund = augenblickGrund(l.e);
    if (grund) return grund;
    const a = art ?? waehleArt(zufall());
    const plan = planeEreignis(l.woerter, a, zufall, letztesWort);
    if (plan.length === 0) return 'keine-woerter';
    zeige(plan);
    return null;
  }

  async function feuere(art: Art | null, zufall: () => number): Promise<string | null> {
    const l = await pruefeAlles();
    if (typeof l === 'string') return l;
    return zeigeMit(l, art, zufall);
  }

  // ---------- Zeitplan ----------
  async function takt(jetzt: number = Date.now(), zufall: () => number = Math.random, art: Art | null = null): Promise<string | null> {
    if (!lebt() || document.visibilityState !== 'visible') return 'unsichtbar';
    const g = await grundLage();
    if (typeof g === 'string') return g;
    const h = wirksameHaeufigkeit(g.e, g.pack)!;
    let roh: unknown;
    try {
      roh = (await browser.storage.local.get(ZEITPLAN_SCHLUESSEL))[ZEITPLAN_SCHLUESSEL];
    } catch {
      return 'speicher';
    }
    const erg = pruefeZeitplan(roh, jetzt, h, zufall(), g.pack.importiert);
    if (!erg.faellig) {
      if (erg.schreibe) {
        try {
          await browser.storage.local.set({ [ZEITPLAN_SCHLUESSEL]: erg.plan });
        } catch {
          return 'speicher';
        }
      }
      return 'nicht-faellig';
    }
    // Faellig: erst die volle Vorpruefung (Plan bleibt unberuehrt, das Ereignis bleibt faellig und kommt beim naechsten Nachschauen erneut).
    const l = await pruefeAlles();
    if (typeof l === 'string') return l;
    // Dann zuerst den neuen Plan schreiben, danach zeigen. Faellt das Zeigen doch noch aus, geht der alte Plan zurueck (wieder faellig).
    try {
      await browser.storage.local.set({ [ZEITPLAN_SCHLUESSEL]: erg.plan });
    } catch {
      return 'speicher';
    }
    const grund = zeigeMit(l, art, zufall);
    if (grund) {
      try {
        await browser.storage.local.set({ [ZEITPLAN_SCHLUESSEL]: roh });
      } catch {
        // der naechste Durchlauf legt einen neuen Plan an
      }
    }
    return grund;
  }

  // Alle 30 s, nur solange der Tab sichtbar ist (kein Zeitgeber im Hintergrund). Im Testbau laeuft nichts von selbst: erst das Testereignis
  // `taktMs` schaltet den Zeitgeber ein (mit kurzem Takt), dann gilt dieselbe Sichtbarkeits-Regel.
  let timer: ReturnType<typeof setInterval> | null = null;
  let taktMs = PRUEF_TAKT_MS;
  let taktErlaubt = !TESTHAKEN;
  const steuereTimer = (): void => {
    if (!taktErlaubt) return;
    const sichtbar = document.visibilityState === 'visible';
    if (sichtbar && !timer) {
      timer = setInterval(() => {
        void takt().then((g) => {
          if (TESTHAKEN && g && g !== 'nicht-faellig' && !laeuft) abbild({ laeuft: false, woerter: [], abgelehnt: g, vomTakt: true });
        });
      }, taktMs);
    }
    else if (!sichtbar && timer) {
      clearInterval(timer);
      timer = null;
    }
  };

  // ---------- Abbruch-Ereignisse ----------
  const beiTaste = (): void => brichAb('taste');
  // Mehrere Tasten-Ereignisarten an Fenster und Dokument: faengt eine Seite nur eine Art ab, kommen die anderen an. Ein frueher Seitenhoerer am
  // Fenster, der alle Arten mit stopImmediatePropagation schluckt, ist damit nicht abgedeckt (dann bleibt der Fokus-Check je Frame).
  const TASTEN_EREIGNISSE = ['keydown', 'keyup', 'keypress', 'beforeinput'] as const;
  const beiFokus = (): void => {
    if (laeuft && eingabeAktiv()) brichAb('eingabe');
  };
  const beiSichtbarkeit = (): void => {
    if (document.visibilityState !== 'visible') brichAb('verborgen');
    steuereTimer();
  };
  const beiVollbild = (): void => {
    if (document.fullscreenElement) brichAb('vollbild');
  };
  for (const typ of TASTEN_EREIGNISSE) {
    window.addEventListener(typ, beiTaste, { capture: true, passive: true });
    document.addEventListener(typ, beiTaste, { capture: true, passive: true });
  }
  window.addEventListener('focusin', beiFokus, { capture: true, passive: true });
  document.addEventListener('visibilitychange', beiSichtbarkeit);
  document.addEventListener('fullscreenchange', beiVollbild);
  const lokalAb = beiLokalerPause(() => brichAb('pause'));
  const abmelden = beiEinstellungsAenderung((neu) => {
    letzteE = neu;
    brichAb('einstellung');
  });
  const packHoerer = (aenderungen: Record<string, unknown>, bereich: string): void => {
    if (bereich === 'local' && PACK_SPEICHER_SCHLUESSEL in aenderungen) brichAb('pack');
  };
  browser.storage.onChanged.addListener(packHoerer);
  steuereTimer();

  // ---------- Testhaken ----------
  // Ereignis `veil-test` mit { blitz: { ereignis: 'wort' | 'schwarm', zufall?: number[], takt?: boolean, jetzt?: number } } (JSON-Text oder Objekt).
  // `ereignis` loest sofort ein Ereignis aus (die Bedingungen gelten weiter), `takt` fuehrt einen Zeitplan-Durchlauf aus (mit `jetzt` als Uhrzeit).
  const beiTestEreignis = (ev: Event): void => {
    try {
      let detail = (ev as CustomEvent).detail as unknown;
      if (typeof detail === 'string') detail = JSON.parse(detail);
      const b = (detail as { blitz?: { ereignis?: string; zufall?: number[]; takt?: boolean; jetzt?: number; abbruch?: boolean; taktMs?: number } } | null)?.blitz;
      if (!b) return;
      nr++;
      const reihe = Array.isArray(b.zufall) && b.zufall.length > 0 ? b.zufall : null;
      let i = 0;
      // Werte aus dem Testhaken auf 0 bis unter 1 begrenzen (kaputte Werte werden 0,5), wie sie der Produktcode auch bekommt.
      const klemme = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.min(Math.max(v, 0), 0.999999) : 0.5);
      const zufall = reihe ? () => klemme(reihe[i++ % reihe.length]) : Math.random;
      const meine = nr;
      const melde = (grund: string | null): void => {
        if (grund !== null && nr === meine) abbild({ laeuft: false, woerter: [], abgelehnt: grund });
      };
      if (b.abbruch) return brichAb('test');
      if (typeof b.taktMs === 'number' && b.taktMs >= 50) {
        taktErlaubt = true;
        taktMs = b.taktMs;
        if (timer) clearInterval(timer);
        timer = null;
        steuereTimer();
        return;
      }
      if (b.takt) void takt(typeof b.jetzt === 'number' ? b.jetzt : Date.now(), zufall, b.ereignis === 'schwarm' ? 'schwarm' : b.ereignis === 'wort' ? 'wort' : null).then(melde);
      else if (b.ereignis === 'wort' || b.ereignis === 'schwarm') void feuere(b.ereignis, zufall).then(melde);
    } catch {
      // ungueltiges Ereignis ignorieren
    }
  };
  if (TESTHAKEN && testhakenAktiv()) document.addEventListener('veil-test', beiTestEreignis);

  ctx.onInvalidated(() => {
    abgebaut = true;
    brichAb('kontext');
    entferneHost();
    if (timer) clearInterval(timer);
    for (const typ of TASTEN_EREIGNISSE) {
      window.removeEventListener(typ, beiTaste, { capture: true });
      document.removeEventListener(typ, beiTaste, { capture: true });
    }
    window.removeEventListener('focusin', beiFokus, { capture: true });
    document.removeEventListener('visibilitychange', beiSichtbarkeit);
    document.removeEventListener('fullscreenchange', beiVollbild);
    if (TESTHAKEN) document.removeEventListener('veil-test', beiTestEreignis);
    lokalAb();
    try {
      abmelden();
      browser.storage.onChanged.removeListener(packHoerer);
    } catch {
      // Kontext weg
    }
  });
}
