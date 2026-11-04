// Player-Riegel (Auftrag P, Session 8, PHASE-4-BAUPLAN Abschnitte 3 und 8 Punkte 8, 10, 14): vor jedem Video einer Erwachsenenseite ein Quiz.
// Eigenes Modul neben dem Schleier (kein Eingriff in src/schleier/schleier.ts): liest den Stand der Seite ueber src/adapter/status.ts
// (`istErwachsenFuerQuiz`, `beiErwachsenStatus`), Pause ueber src/einstellungen.ts und src/pause-lokal.ts, den Riegel ueber src/riegel/riegel.ts.
// Vertrag (Orchestrator): Einstieg `startePlayer(ctx)`, einmal je Frame aus entrypoints/content/index.ts.
//
// Ablauf: Das Hauptvideo (Adapter-Selektor `player`, sonst das groesste sichtbare Video) wird bei jedem Abspielwunsch angehalten und stumm
// geschaltet, bis der Riegel `geloest` meldet. Je Video und Quelle gibt es ein Quiz. Pause gibt alles sofort frei.
// Beobachter und Ereignis-Hoerer haengen nur, solange der Player aktiv ist (Pack, Freischaltung, Erwachsenenseite, keine Pause, keine Ausnahme,
// keine Galerie des Komplett-Ersatzes, Quiz moeglich). Shadow Roots kommen ueber das Hinweis-Ereignis `veil-wurzel` des Hakens in der Seitenwelt.
import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import { adapterFuer, istHoverVideo, istVorschau } from '../adapter';
import { beiErwachsenStatus, erwachsenStatus, istErwachsenFuerQuiz } from '../adapter/status';
import { beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../einstellungen';
import type { AntwortPackDaten, NachrichtHintergrundPackDaten } from '../nachrichten';
import { istFreigeschaltet, kurzAusRoh, ladePackKurz, PACK_SPEICHER_SCHLUESSEL, type PackKurz } from '../pack/vertrag';
import { beiLokalerPause, istLokalePause } from '../pause-lokal';
import { zaehleZulaessige, type Lage } from '../quiz/logik';
import { pruefeQuizBank, type QuizBank } from '../quiz/vertrag';
import { zeigeRiegel, type RiegelErgebnis } from '../riegel/riegel';
import { AdressBeobachter } from '../schleier/adresse';
import type { KontextLeicht } from '../schleier/schleier';
import { istGeloest, quelleVon, quellSchluessel, vollbildBetrifft, waehleGroessten, willSpielen } from './logik';

interface Sperre {
  warStumm: boolean; // Ton-Zustand vor der Sperre (folgt Aenderungen, die nicht von uns kommen)
  wollte: boolean; // das Video wollte spielen (dann geht es nach der Freigabe weiter)
  laeuft: boolean; // ein Riegel fuer dieses Video ist offen
  abbruch: AbortController | null;
  quelle: string; // Quelle beim Start des Riegels
  zuletzt: number; // Zeitpunkt des letzten Riegelversuchs (Drosselung)
  erwarte: boolean; // wir haben gerade selbst stumm geschaltet: die naechste volumechange-Meldung kommt von uns
}

const ATTR_ERSATZ = 'data-veil-ersatz'; // Galerie des Komplett-Ersatzes (src/ersatz/ersatz.ts)
const RIEGEL_ABSTAND_MS = 1000; // hoechstens ein Riegelversuch je Video und Sekunde
const ZIEL_ZEIT_MS = 50; // so lange gilt die Zielmenge fuer einzelne Ereignisse

// Adresse fuer den Ausnahmenvergleich (wie der Schleier): in about:blank-Frames die Adresse der Basis.
function adresseFuerAusnahmen(): { hostname: string; pathname: string } {
  if (location.hostname) return location;
  try {
    return new URL(document.baseURI);
  } catch {
    return { hostname: '', pathname: '/' };
  }
}

export function startePlayer(ctx: KontextLeicht): void {
  let abgebaut = false;
  const lebt = () => !abgebaut && ctx.isValid;
  let einst: Einstellungen | null = null;
  let pack: PackKurz | null = null;
  let packBekannt = false;
  let adressWechsel = false;
  // "Kein Quiz moeglich" (zu wenige zulaessige Fragen, Daten fehlen): der Player bleibt aus, bis sich Pack oder Ruhig-Modus aendern.
  let keinQuiz = false;
  let quizStand: Promise<boolean> | null = null;
  const gesperrt = new Map<HTMLVideoElement, Sperre>();
  const geloest = new WeakMap<HTMLVideoElement, string>();
  // Wollte spielen, als es noch keine Quelle gab: beim Laden der Quelle zaehlt das.
  const wollteMerk = new WeakSet<HTMLVideoElement>();
  const objektIds = new WeakMap<object, number>();
  let naechsteId = 1;
  const istOben = (() => {
    try {
      return window === window.top;
    } catch {
      return false;
    }
  })();
  const adresse = new AdressBeobachter(
    () => location.href,
    () => {
      adressWechsel = true;
      bewerte();
    },
  );
  let geplant = false;
  let zielCache: { t: number; satz: Set<HTMLVideoElement> } | null = null;

  // ---------- Bedingungen ----------
  // Alles ausser der pfadabhaengigen Ausnahme: solange das gilt, laeuft der Adressbeobachter (ein pushState kann die Ausnahme beenden).
  function grundAktiv(): boolean {
    if (!einst || einst.pause || istLokalePause(einst) || !einst.erwachsen.an) return false;
    if (!istFreigeschaltet(pack, 'erwachsen:quiz')) return false;
    return istErwachsenFuerQuiz();
  }
  const ersatzDa = (): boolean => !!document.documentElement?.hasAttribute(ATTR_ERSATZ);
  function aktiv(): boolean {
    if (keinQuiz || !grundAktiv() || !einst || ersatzDa()) return false;
    return !passtAusnahme(adresseFuerAusnahmen(), einst.ausnahmen);
  }

  // Quelle eines Videos als Zeichenkette; Videos mit srcObject (MediaStream, MediaSource-Handle) bekommen je Objekt einen eigenen Schluessel.
  function quelle(v: HTMLVideoElement): string {
    const so = v.srcObject as object | null;
    if (so) {
      let id = objektIds.get(so);
      if (id === undefined) {
        id = naechsteId++;
        objektIds.set(so, id);
      }
      return `obj:${id}`;
    }
    return quelleVon(v);
  }
  const ungeloest = (v: HTMLVideoElement): boolean => !istGeloest(geloest.get(v), quelle(v));

  // ---------- Videos finden (Dokument und Shadow Roots) ----------
  const wurzeln = new Set<WeakRef<ShadowRoot>>();
  const wurzelMerk = new WeakSet<ShadowRoot>();
  const wurzelBeobachter = new Map<ShadowRoot, MutationObserver>();

  function lebendeWurzeln(): ShadowRoot[] {
    const liste: ShadowRoot[] = [];
    for (const ref of wurzeln) {
      const w = ref.deref();
      if (!w || !w.host.isConnected) {
        if (!w) wurzeln.delete(ref);
        continue;
      }
      liste.push(w);
    }
    return liste;
  }
  function alleVideos(): HTMLVideoElement[] {
    const liste = [...document.querySelectorAll('video')];
    for (const w of lebendeWurzeln()) liste.push(...w.querySelectorAll('video'));
    return liste;
  }

  function ausgeschlossen(v: HTMLVideoElement): boolean {
    const adapter = adapterFuer(erwachsenStatus().liste);
    try {
      return istHoverVideo(v, adapter) || istVorschau(v, adapter, location.href);
    } catch {
      return false;
    }
  }

  // Sichtbar im Sinne des Rueckfalls: dargestellt, nicht per visibility/opacity weggeblendet (opacity 0 zaehlt nur bei Videos, die der Schleier
  // schon beurteilt hat: sein Verstecken vor dem Urteil setzt selbst opacity 0), im Dokument (nicht links oder oberhalb davon).
  function groesse(v: HTMLVideoElement): { breite: number; hoehe: number } {
    const aus = { breite: 0, hoehe: 0 };
    try {
      const r = v.getBoundingClientRect();
      const cs = getComputedStyle(v);
      if (cs.display === 'none' || cs.visibility === 'hidden') return aus;
      if (cs.opacity === '0' && v.hasAttribute('data-veil')) return aus;
      const de = document.documentElement;
      if (r.right + scrollX <= 0 || r.bottom + scrollY <= 0) return aus;
      if (de && r.left + scrollX >= Math.max(de.scrollWidth, innerWidth)) return aus;
      return { breite: r.width, hoehe: r.height };
    } catch {
      return aus;
    }
  }

  // Hauptvideo: Adapter-Treffer, sonst das groesste sichtbare Video. Bereits gesperrte bleiben dabei (ausser nach Adresswechsel).
  function bestimmeZiele(haltefest: boolean): Set<HTMLVideoElement> {
    const alle = alleVideos().filter((v) => !ausgeschlossen(v));
    const adapter = adapterFuer(erwachsenStatus().liste);
    const sel = adapter.player ?? [];
    const treffer = alle.filter((v) =>
      sel.some((s) => {
        try {
          return v.matches(s) || !!v.closest(s);
        } catch {
          return false;
        }
      }),
    );
    const ziele = new Set<HTMLVideoElement>(treffer);
    if (!ziele.size) {
      const gross = waehleGroessten(alle.map((v) => ({ el: v, ...groesse(v) })));
      if (gross) ziele.add(gross);
    }
    if (haltefest) for (const v of gesperrt.keys()) ziele.add(v);
    return ziele;
  }
  // Fuer einzelne Ereignisse: erst das eine Video ausschliessen, die Zielmenge gilt kurz (kein Layout je Ereignis).
  function istZiel(v: HTMLVideoElement): boolean {
    if (gesperrt.has(v)) return true;
    if (ausgeschlossen(v)) return false;
    const jetzt = performance.now();
    if (!zielCache || jetzt - zielCache.t > ZIEL_ZEIT_MS) zielCache = { t: jetzt, satz: bestimmeZiele(true) };
    return zielCache.satz.has(v);
  }

  function ankerFuer(v: HTMLVideoElement): Element {
    for (const s of adapterFuer(erwachsenStatus().liste).player ?? []) {
      try {
        const a = v.closest(s);
        if (a) return a;
      } catch {
        // Selektor nicht verstanden
      }
    }
    return v;
  }

  function verlasseVollbild(v: HTMLVideoElement): void {
    const fe = document.fullscreenElement;
    if (fe && vollbildBetrifft(fe, v)) {
      try {
        void document.exitFullscreen().catch(() => {});
      } catch {
        // kein Vollbild mehr
      }
    }
  }

  // ---------- Sperren ----------
  function schalteStumm(v: HTMLVideoElement, info: Sperre): void {
    try {
      if (!v.muted) {
        info.erwarte = true;
        v.muted = true;
      }
    } catch {
      // nicht steuerbar
    }
  }

  function sperre(v: HTMLVideoElement, wollte: boolean): Sperre {
    let info = gesperrt.get(v);
    if (!info) {
      info = { warStumm: v.muted, wollte: false, laeuft: false, abbruch: null, quelle: quelle(v), zuletzt: -Infinity, erwarte: false };
      gesperrt.set(v, info);
    }
    if (wollte) info.wollte = true;
    schalteStumm(v, info);
    try {
      v.pause();
    } catch {
      // nicht steuerbar
    }
    verlasseVollbild(v);
    return info;
  }

  function entsperre(v: HTMLVideoElement, fortsetzen: boolean): void {
    const info = gesperrt.get(v);
    if (!info) return;
    gesperrt.delete(v);
    info.abbruch?.abort();
    try {
      v.muted = info.warStumm;
    } catch {
      // egal
    }
    if (fortsetzen && info.wollte && v.isConnected) {
      try {
        const p = v.play();
        if (p) {
          p.catch((e: unknown) => {
            // Ton ohne Bedienung nicht erlaubt: lieber stumm weiter als gar nicht
            if ((e as { name?: string })?.name === 'NotAllowedError' && !v.muted) {
              v.muted = true;
              v.play().catch(() => {});
            }
          });
        }
      } catch {
        // egal
      }
    }
  }

  function gebeAlleFrei(fortsetzen: boolean): void {
    for (const v of [...gesperrt.keys()]) entsperre(v, fortsetzen);
  }

  // Sind Quiz-Daten nutzbar (mindestens zwei zulaessige Fragen in dieser Lage)? Das Ergebnis gilt, bis sich Pack oder Ruhig-Modus aendern.
  function quizMoeglich(): Promise<boolean> {
    if (!quizStand) {
      quizStand = (async () => {
        try {
          const n: NachrichtHintergrundPackDaten = { ziel: 'hintergrund', typ: 'packdaten', rolle: 'quiz' };
          const a = (await browser.runtime.sendMessage(n)) as AntwortPackDaten | undefined;
          if (!a || a.ok !== true || !a.daten) return false;
          const bank = pruefeQuizBank(a.daten);
          if (!bank) return false;
          let fein = true;
          try {
            fein = matchMedia('(any-pointer: fine)').matches;
          } catch {
            // Desktop annehmen
          }
          let ruhigBewegung = false;
          try {
            ruhigBewegung = matchMedia('(prefers-reduced-motion: reduce)').matches;
          } catch {
            // egal
          }
          const lage: Lage = { geraet: fein ? 'desktop' : 'touch', ruhig: !!einst?.ruhig || ruhigBewegung };
          return zaehleZulaessige(bank as QuizBank, lage) >= 2;
        } catch {
          return false;
        }
      })();
    }
    return quizStand;
  }
  function vergissQuiz(): void {
    quizStand = null;
    keinQuiz = false;
  }

  async function starteRiegel(v: HTMLVideoElement, info: Sperre): Promise<void> {
    if (info.laeuft) return;
    const jetzt = performance.now();
    if (jetzt - info.zuletzt < RIEGEL_ABSTAND_MS) return;
    info.zuletzt = jetzt;
    info.laeuft = true;
    info.quelle = quelle(v);
    const abbruch = new AbortController();
    info.abbruch = abbruch;
    let erg: RiegelErgebnis = 'abgebrochen';
    try {
      erg = await zeigeRiegel({ grund: 'video', anker: ankerFuer(v), signal: abbruch.signal });
    } catch {
      erg = 'abgebrochen';
    }
    info.laeuft = false;
    if (!lebt() || gesperrt.get(v) !== info) return;
    if (erg === 'geloest') {
      if (quellSchluessel(quelle(v)) !== quellSchluessel(info.quelle)) {
        // Die Quelle hat gewechselt, waehrend der Riegel offen war: das Quiz galt dem alten Video, das neue bekommt einen eigenen Riegel.
        info.zuletzt = -Infinity;
        void starteRiegel(v, info);
        return;
      }
      geloest.set(v, info.quelle);
      entsperre(v, true);
      // Weitere gesperrte Videos bekommen jetzt ihren Riegel.
      for (const [w, i] of [...gesperrt]) {
        i.zuletzt = -Infinity;
        if (!i.laeuft) void starteRiegel(w, i);
      }
    } else if (erg === 'pause') {
      gebeAlleFrei(true); // die lokale Pause meldet der Riegel selbst (src/pause-lokal.ts)
    } else {
      if (!aktiv()) {
        entsperre(v, true);
        return;
      }
      const da = await quizMoeglich();
      if (!lebt() || gesperrt.get(v) !== info) return;
      // Daten da: nur ein anderer Riegel war offen, das Video bleibt gesperrt und der naechste Abspielversuch fragt erneut.
      if (!da) {
        keinQuiz = true;
        bewerte();
      }
    }
  }

  // Sucht Videos, die spielen wollen, und sperrt sie. Prueft zugleich, ob Gesperrte noch Ziel und noch im Dokument sind.
  function durchsuche(): void {
    const haltefest = !adressWechsel;
    adressWechsel = false;
    zielCache = null;
    for (const w of [...wurzelBeobachter.keys()]) {
      if (!w.host.isConnected) {
        wurzelBeobachter.get(w)?.disconnect();
        wurzelBeobachter.delete(w);
      }
    }
    for (const w of lebendeWurzeln()) verbindeWurzel(w);
    const ziele = bestimmeZiele(haltefest);
    for (const v of [...gesperrt.keys()]) {
      if (!v.isConnected) entsperre(v, false);
      else if (!ziele.has(v)) entsperre(v, true);
    }
    for (const v of ziele) {
      if (gesperrt.has(v) || !ungeloest(v) || quelle(v) === '' || !willSpielen(v)) continue;
      void starteRiegel(v, sperre(v, true));
    }
  }

  function plane(): void {
    if (geplant) return;
    geplant = true;
    queueMicrotask(() => {
      geplant = false;
      if (lebt() && aktiv()) durchsuche();
    });
  }

  // ---------- Ereignisse ----------
  const alsVideo = (e: Event): HTMLVideoElement | null => (e.target instanceof HTMLVideoElement ? e.target : null);

  function beiPlay(e: Event): void {
    const v = alsVideo(e);
    if (!v || !lebt()) return;
    if (quelle(v) === '') {
      wollteMerk.add(v);
      return;
    }
    if (!aktiv()) return;
    const info = gesperrt.get(v);
    if (info) {
      sperre(v, true);
      void starteRiegel(v, info);
      return;
    }
    if (!ungeloest(v) || !istZiel(v)) return;
    void starteRiegel(v, sperre(v, true));
  }

  function beiQuelle(e: Event): void {
    const v = alsVideo(e);
    if (!v || !lebt() || !aktiv()) return;
    const wollte = wollteMerk.has(v) || v.autoplay;
    if (quelle(v) === '') return;
    wollteMerk.delete(v);
    const info = gesperrt.get(v);
    if (info) {
      sperre(v, wollte);
      return;
    }
    if (!wollte || !ungeloest(v) || !istZiel(v)) return;
    void starteRiegel(v, sperre(v, true));
  }

  // Ton waehrend der Sperre: schaltet der Nutzer oder die Seite um (nicht wir), merkt sich die Sperre den neuen Wunsch und bleibt stumm.
  function beiLautstaerke(e: Event): void {
    const v = alsVideo(e);
    const info = v ? gesperrt.get(v) : undefined;
    if (!v || !info) return;
    if (info.erwarte) {
      info.erwarte = false;
      return;
    }
    if (!v.muted) {
      info.warStumm = false;
      schalteStumm(v, info);
    } else {
      info.warStumm = true;
    }
  }

  function beiVollbild(): void {
    for (const v of gesperrt.keys()) verlasseVollbild(v);
  }

  const medienHorcher: Array<[string, (e: Event) => void]> = [
    ['play', beiPlay],
    ['playing', beiPlay],
    ['loadstart', beiQuelle],
    ['loadedmetadata', beiQuelle],
    ['volumechange', beiLautstaerke],
  ];

  function beiMutation(liste: MutationRecord[]): void {
    let video = false;
    for (const m of liste) {
      if (m.type === 'attributes') {
        const n = m.target.nodeName;
        if (n === 'VIDEO' || n === 'SOURCE') video = true;
        continue;
      }
      if (m.removedNodes.length && gesperrt.size) video = true;
      for (const n of m.addedNodes) {
        if (n.nodeType === 1 && (n.nodeName === 'VIDEO' || (n as Element).querySelector('video'))) video = true;
      }
    }
    if (video) plane();
  }
  const MO_OPTIONEN: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'autoplay'] };
  const beobachter = new MutationObserver(beiMutation);

  // ---------- Verbinden und Trennen (nur solange aktiv) ----------
  let verbunden = false;
  function verbindeWurzel(w: ShadowRoot): void {
    if (!verbunden || wurzelBeobachter.has(w)) return;
    for (const [typ, fn] of medienHorcher) w.addEventListener(typ, fn, true);
    const mo = new MutationObserver(beiMutation);
    try {
      mo.observe(w, MO_OPTIONEN);
    } catch {
      // Wurzel weg
    }
    wurzelBeobachter.set(w, mo);
  }
  function verbinde(): void {
    if (verbunden) return;
    verbunden = true;
    for (const [typ, fn] of medienHorcher) document.addEventListener(typ, fn, true);
    document.addEventListener('fullscreenchange', beiVollbild, true);
    try {
      beobachter.observe(document, MO_OPTIONEN);
    } catch {
      // Dokument weg
    }
  }
  function trenne(): void {
    if (!verbunden) return;
    verbunden = false;
    for (const [typ, fn] of medienHorcher) document.removeEventListener(typ, fn, true);
    document.removeEventListener('fullscreenchange', beiVollbild, true);
    beobachter.disconnect();
    for (const [w, mo] of wurzelBeobachter) {
      for (const [typ, fn] of medienHorcher) w.removeEventListener(typ, fn, true);
      mo.disconnect();
    }
    wurzelBeobachter.clear();
  }

  // Der Haken in der Seitenwelt meldet jede neue Shadow Root als Ereignis `veil-wurzel` am Host. Das Merken kostet fast nichts und laeuft immer.
  function beiWurzelHinweis(e: Event): void {
    const host = (e.composedPath()[0] ?? e.target) as Element | null;
    if (!host || host.nodeType !== 1) return;
    let w: ShadowRoot | null = null;
    try {
      w = host.shadowRoot ?? (browser as unknown as { dom?: { openOrClosedShadowRoot?: (x: Element) => ShadowRoot | null } }).dom?.openOrClosedShadowRoot?.(host) ?? null;
      if (!w) w = (host as unknown as { openOrClosedShadowRoot?: ShadowRoot | null }).openOrClosedShadowRoot ?? null;
    } catch {
      w = null;
    }
    if (!w || wurzelMerk.has(w)) return;
    wurzelMerk.add(w);
    wurzeln.add(new WeakRef(w));
    if (verbunden) {
      verbindeWurzel(w);
      plane();
    }
  }
  document.addEventListener('veil-wurzel', beiWurzelHinweis, true);

  // Die Galerie des Komplett-Ersatzes setzt/entfernt ein Attribut am html-Element: danach neu bewerten.
  const ersatzBeobachter = new MutationObserver(() => bewerte());
  function beobachteErsatz(): void {
    const de = document.documentElement;
    if (de) {
      try {
        ersatzBeobachter.observe(de, { attributes: true, attributeFilter: [ATTR_ERSATZ] });
      } catch {
        // egal
      }
      return;
    }
    const warte = new MutationObserver(() => {
      if (!document.documentElement) return;
      warte.disconnect();
      beobachteErsatz();
      bewerte();
    });
    warte.observe(document, { childList: true });
  }
  beobachteErsatz();

  function bewerte(): void {
    if (!lebt()) return;
    // Der Adressbeobachter laeuft nur in der obersten Seite und solange der Player grundsaetzlich gilt (auch auf einem Ausnahmepfad).
    if (istOben && grundAktiv() && !ersatzDa()) adresse.start();
    else adresse.stopp();
    if (!aktiv()) {
      gebeAlleFrei(true);
      trenne();
      return;
    }
    verbinde();
    durchsuche();
  }

  // ---------- Einstellungen, Pack, Seitenstand ----------
  function uebernimmEinstellungen(e: Einstellungen): void {
    if (einst && einst.ruhig !== e.ruhig) vergissQuiz();
    einst = e;
    bewerte();
  }
  const abEinst = beiEinstellungsAenderung(uebernimmEinstellungen);
  const packHorcher = (aend: Record<string, { newValue?: unknown }>, bereich: string): void => {
    if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aend)) return;
    pack = kurzAusRoh(aend[PACK_SPEICHER_SCHLUESSEL].newValue);
    packBekannt = true;
    vergissQuiz();
    bewerte();
  };
  browser.storage.onChanged.addListener(packHorcher);
  const abStatus = beiErwachsenStatus(() => bewerte());
  const abLokal = beiLokalerPause(() => gebeAlleFrei(true));

  void Promise.all([ladeEinstellungen().catch(() => null), ladePackKurz().catch(() => null)]).then(([e, p]) => {
    if (!lebt()) return;
    if (!packBekannt) pack = p;
    if (e && !einst) uebernimmEinstellungen(e);
    else bewerte();
  });

  ctx.onInvalidated(() => {
    abgebaut = true;
    // Ohne Fortsetzen: ein Video, das nur wegen uns stand, startet nicht von selbst (womoeglich mit Ton).
    gebeAlleFrei(false);
    trenne();
    document.removeEventListener('veil-wurzel', beiWurzelHinweis, true);
    ersatzBeobachter.disconnect();
    adresse.stopp();
    abEinst();
    abStatus();
    abLokal();
    try {
      browser.storage.onChanged.removeListener(packHorcher);
    } catch {
      // Kontext weg
    }
  });
}
