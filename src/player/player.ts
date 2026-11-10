// Player-Riegel (Auftrag P, Session 8, PHASE-4-BAUPLAN Abschnitte 3 und 8 Punkte 8, 10, 14): vor jedem Video einer Erwachsenenseite ein Quiz.
// Eigenes Modul neben dem Schleier (kein Eingriff in src/schleier/schleier.ts): liest den Stand der Seite ueber src/adapter/status.ts
// (`istErwachsenFuerQuiz`, `beiErwachsenStatus`), Pause ueber src/einstellungen.ts und src/pause-lokal.ts, den Riegel ueber src/riegel/riegel.ts.
// Vertrag (Orchestrator): Einstieg `startePlayer(ctx)`, einmal je Frame aus entrypoints/content/index.ts.
//
// Ablauf: Das Hauptvideo (Adapter-Selektor `player`, sonst das groesste sichtbare Video) wird bei jedem Abspielwunsch angehalten und stumm
// geschaltet, bis der Riegel `geloest` meldet. Je Video und Quelle gibt es ein Quiz. Pause gibt alles sofort frei.
// Beobachter und Ereignis-Hoerer haengen nur, solange der Player aktiv ist (Pack, Freischaltung, Erwachsenenseite, keine Pause, keine Ausnahme,
// keine Galerie des Komplett-Ersatzes, Quiz moeglich). Shadow Roots kommen ueber das Hinweis-Ereignis `veil-wurzel` des Hakens in der Seitenwelt.
import { sperrePip as sperrePipGemeinsam } from '../schleier/pip-sperre';
import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import { adapterFuer, istHoverVideo, istVorschau } from '../adapter';
import { beiErwachsenStatus, erwachsenStatus, istErwachsenFuerQuiz } from '../adapter/status';
import { naechsterWechselMs } from '../kontrolle/streng';
import { strengJetzt } from '../kontrolle/gemeinsam';
import { beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../einstellungen';
import type { AntwortPackDaten, NachrichtHintergrundPackDaten } from '../nachrichten';
import { istFreigeschaltet, kurzAusRoh, ladePackKurz, PACK_SPEICHER_SCHLUESSEL, type PackKurz } from '../pack/vertrag';
import { beiLokalerPause, istLokalePause } from '../pause-lokal';
import { zaehleZulaessige, type Lage } from '../quiz/logik';
import { pruefeQuizBank, type QuizBank } from '../quiz/vertrag';
import { zeigeRiegel, type RiegelErgebnis } from '../riegel/riegel';
import { AdressBeobachter } from '../schleier/adresse';
import type { KontextLeicht } from '../schleier/schleier';
import { istStandbildHost, Standbild } from './standbild';
import { istGesteFuer, istGeloest, istListenPfad, quelleVon, quellSchluessel, tasteZaehltAlsGeste, vollbildBetrifft, waehleGroessten, willSpielen, type Geste } from './logik';

interface Sperre {
  warStumm: boolean; // Ton-Zustand vor der Sperre (folgt Aenderungen, die nicht von uns kommen)
  wollte: boolean; // das Video wollte spielen (dann geht es nach der Freigabe weiter)
  laeuft: boolean; // ein Riegel fuer dieses Video ist offen
  abbruch: AbortController | null;
  quelle: string; // Quelle beim Start des Riegels
  zuletzt: number; // Zeitpunkt des letzten Riegelversuchs (Drosselung)
  erwarte: boolean; // wir haben gerade selbst stumm geschaltet: die naechste volumechange-Meldung kommt von uns
  wartet: boolean; // Autoplay ohne Geste auf einer Listenseite: gesperrt, aber noch kein Riegel (kommt bei Geste oder auf einer Videoseite)
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
// Siehe istListenPfad (logik.ts): Startseite, Suche, Kategorien. Dort loest ein Autoplay ohne Geste keinen Riegel aus.
const istListenSeite = (): boolean => istListenPfad(adresseFuerAusnahmen().pathname);

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
  const standbild = new Standbild({ lebt });
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
    // In einer strengen Zeit (Session 10, Auftrag Z1; Freischaltung `kontrolle:zeitplan`) gilt jede Seite als Quiz-Seite.
    return istErwachsenFuerQuiz() || strengJetzt(einst, pack);
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
  let trefferBereit = false; // gilt nach dem letzten bestimmeZiele: ein Adapter-Treffer ist gesperrt oder geloest
  function bestimmeZiele(haltefest: boolean): Set<HTMLVideoElement> {
    const alle = alleVideos().filter((v) => !ausgeschlossen(v));
    const adapter = adapterFuer(erwachsenStatus().liste);
    const sel = adapter.player ?? [];
    // Als Treffer zaehlt nur ein Video mit Quelle und Groesse: ein leeres oder unsichtbares Platzhalter-Video verdraengt kein Rueckfall-Video.
    const treffer = alle.filter((v) => {
      if (quelle(v) === '') return false;
      const g = groesse(v);
      if (!(g.breite > 0 && g.hoehe > 0)) return false;
      return sel.some((s) => {
        try {
          return v.matches(s) || !!v.closest(s);
        } catch {
          return false;
        }
      });
    });
    const ziele = new Set<HTMLVideoElement>(treffer);
    if (!ziele.size) {
      const gross = waehleGroessten(alle.map((v) => ({ el: v, ...groesse(v) })));
      if (gross) ziele.add(gross);
    }
    // Gesperrte bleiben Ziel, solange sie als Rueckfall galten. Erst wenn ein Adapter-Treffer selbst gesperrt oder geloest ist, ist nur noch er
    // Ziel: ein frueher gesperrtes Rueckfall-Video wird dann in durchsuche() ohne Selbststart freigegeben.
    trefferBereit = treffer.some((t) => gesperrt.has(t) || !ungeloest(t));
    if (haltefest && !trefferBereit) for (const v of gesperrt.keys()) ziele.add(v);
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

  // Standbild (Auftrag K2): jedes noch nicht geloeste Hauptvideo einer Erwachsenenseite mit Pack (Freischaltung wie der Vorschau-Tausch) liegt
  // unter einem Mia-Bild, bis das Quiz geloest ist. Pause, Ausnahme, kein Quiz moeglich: kein Standbild, das Video bleibt wie bisher.
  // Kandidaten: die Quiz-Ziele, dazu Adapter-Treffer ohne Quelle (preload none, Quelle kommt erst beim Abspielen) und, wenn nichts passt, das
  // groesste Video mit Poster. Ihre Flaeche ist die des Ankers (Adapter-Selektor, samt Poster-Ebenen der Seite), sonst die des Videos.
  const standbildVideos = new Set<HTMLVideoElement>();
  function standbildKandidaten(ziele: ReadonlySet<HTMLVideoElement>): Set<HTMLVideoElement> {
    const kand = new Set<HTMLVideoElement>(ziele);
    const alle = alleVideos().filter((v) => !ausgeschlossen(v));
    const sel = adapterFuer(erwachsenStatus().liste).player ?? [];
    let treffer = false;
    for (const v of alle) {
      if (quelle(v) !== '' || !(groesse(v).breite > 0)) continue;
      if (
        sel.some((x) => {
          try {
            return v.matches(x) || !!v.closest(x);
          } catch {
            return false;
          }
        })
      ) {
        kand.add(v);
        treffer = true;
      }
    }
    if (!kand.size && !treffer) {
      const gross = waehleGroessten(alle.filter((v) => v.poster !== '').map((v) => ({ el: v, ...groesse(v) })));
      if (gross) kand.add(gross);
    }
    return kand;
  }
  // Bild-in-Bild: ein Video unter dem Standbild darf nicht in ein eigenes Fenster gehen (dort laege das echte Bild offen). Der alte Wert kommt
  // zurueck, sobald das Video kein Standbild mehr hat. Gemeinsame Sperre in src/schleier/pip-sperre.ts (auch die Zonen-Leinwand sperrt).
  function sperrePip(v: HTMLVideoElement, an: boolean): void {
    sperrePipGemeinsam(v, an, 'standbild');
  }
  function pflegeStandbild(ziele?: ReadonlySet<HTMLVideoElement>): void {
    if (!lebt()) return;
    const soll = new Map<HTMLVideoElement, Element>();
    // Das Bild (Vorschau-Tausch) nur auf Seiten der Liste. Der Deckel fuer wartende Videos gilt ueberall, wo der Player sperrt, auch auf am Inhalt
    // erkannten Seiten und in strengen Zeiten (Lesung 17 R2-3): ein wartendes Video liegt nie offen.
    const bildErlaubt = !!pack && istFreigeschaltet(pack, 'erwachsen:vorschau') && erwachsenStatus().liste !== null;
    if (einst && einst.erwachsen.an && aktiv() && (bildErlaubt || [...gesperrt.values()].some((i) => i.wartet))) {
      // Ein Anker bekommt nur ein Standbild (zwei Videos im selben Player: das erste zaehlt), sonst kaempften zwei Hosts um dieselbe Flaeche.
      const belegt = new Set<Element>();
      for (const v of standbildKandidaten(ziele ?? bestimmeZiele(true))) {
        if (!ungeloest(v) || !v.isConnected) continue;
        const anker = ankerFuer(v);
        if (anker !== v) {
          if (belegt.has(anker)) continue;
          belegt.add(anker);
        }
        soll.set(v, anker);
      }
    }
    // Wartende Videos (Listenseite, noch keine Geste) behalten ihren Deckel auch ohne Bild: dunkel mit Etikett, wie ein Standbild ohne Foto.
    const deckel = new Set<HTMLVideoElement>();
    for (const v of soll.keys()) if (gesperrt.get(v)?.wartet) deckel.add(v);
    if (!bildErlaubt) for (const v of [...soll.keys()]) if (!deckel.has(v)) soll.delete(v);
    if (soll.size) standbild.setze(soll, einst!.erwachsen.stufe, pack?.importiert ?? 0, deckel, bildErlaubt);
    else standbild.alleWeg();
    // Sperren (Bild-in-Bild, Vollbild) nur fuer Videos, die wirklich einen Host haben: ohne Bild (gescheitert, Groesse 0, Anker belegt) gilt
    // "wie heute" (K2, zweite Lesung, Fund 5).
    for (const v of [...standbildVideos]) if (!standbild.hat(v)) {
      standbildVideos.delete(v);
      sperrePip(v, false);
    }
    for (const v of soll.keys()) if (standbild.hat(v)) {
      standbildVideos.add(v);
      sperrePip(v, true);
    }
  }
  // Alles weg (Pause, Ausnahme, Abbau): Bild-in-Bild-Sperren zuruecknehmen und das Standbild entfernen.
  function standbildWeg(): void {
    for (const v of [...standbildVideos]) sperrePip(v, false);
    standbildVideos.clear();
    standbild.alleWeg();
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
      info = { warStumm: v.muted, wollte: false, laeuft: false, abbruch: null, quelle: quelle(v), zuletzt: -Infinity, erwarte: false, wartet: false };
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

  // Echte Gesten der Person (Zeigen, Tippen, Taste): nur vertrauenswuerdige Ereignisse, die Seite kann sie nicht erzeugen.
  let geste: Geste | null = null;
  function beiGeste(e: Event): void {
    if (!e.isTrusted) return;
    let taste = e.type === 'keydown';
    // Tippen in ein Feld (Live-Suche) ist keine Geste fuer Videos (Lesung 17 R2-5).
    if (taste && !tasteZaehltAlsGeste((e.composedPath()[0] as Element | undefined) ?? null)) return;
    let x = 0;
    let y = 0;
    const t = (e as TouchEvent).touches?.[0];
    if (t) {
      x = t.clientX;
      y = t.clientY;
    } else if (typeof (e as MouseEvent).clientX === 'number') {
      x = (e as MouseEvent).clientX;
      y = (e as MouseEvent).clientY;
      if (e.type === 'click' && (e as MouseEvent).detail === 0) taste = true; // Enter oder Leertaste auf einem Knopf
    }
    geste = { t: performance.now(), taste, x, y };
  }
  const GESTEN = ['pointerdown', 'touchstart', 'keydown', 'click'];
  // Fund 6: die Horcher stehen von Anfang an (document_start) als Capture auf window, vor den Skripten der Seite, und nicht erst bei `verbinde`:
  // ein Capture-Horcher der Seite auf window, der Zeiger oder Tasten stoppt (verbreitet in Playern), liefe sonst davor, und es gaebe nie eine Geste.
  // Sie merken nur den Zeitpunkt echter Gesten und kosten sonst nichts.
  for (const g of GESTEN) window.addEventListener(g, beiGeste, true);
  function hatGeste(v: HTMLVideoElement): boolean {
    if (!geste) return false;
    const flaechen = [];
    try {
      for (const el of new Set<Element>([v, ankerFuer(v)])) {
        const r = el.getBoundingClientRect();
        flaechen.push({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });
      }
    } catch {
      // Element weg
    }
    return istGesteFuer(geste, performance.now(), flaechen);
  }

  async function starteRiegel(v: HTMLVideoElement, info: Sperre): Promise<void> {
    if (info.laeuft) return;
    // Listenseite: nur eine echte Geste der Person oeffnet den Riegel. Ein Autoplay bleibt angehalten und verdeckt (Standbild), ohne Riegel.
    if (istListenSeite() && !hatGeste(v)) {
      const neu = !info.wartet;
      info.wartet = true;
      // Ein wartendes Video hat keinen Riegel: sein Standbild (oder, wenn das fehlt, ein schlichter dunkler Deckel) verdeckt es (Fund 8).
      if (neu) pflegeStandbild();
      return;
    }
    info.wartet = false;
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
      pflegeStandbild();
      // Weitere gesperrte Videos bekommen jetzt ihren Riegel.
      for (const [w, i] of [...gesperrt]) {
        i.zuletzt = -Infinity;
        if (!i.laeuft) void starteRiegel(w, i);
      }
    } else if (erg === 'pause') {
      gebeAlleFrei(true); // die lokale Pause meldet der Riegel selbst (src/pause-lokal.ts)
      standbildWeg();
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

  // Videos ohne Flaeche (Breite 0, display none, noch nicht eingepasst), die spaeter wachsen: ein ResizeObserver meldet es, dann wird neu bewertet.
  const groessenBeob: ResizeObserver | null = typeof ResizeObserver === 'function' ? new ResizeObserver(() => { if (lebt() && aktiv()) plane(); }) : null;
  let groessenMerk = new WeakSet<HTMLVideoElement>();

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
    for (const v of alleVideos()) {
      if (groessenMerk.has(v) || groesse(v).breite > 0) continue;
      groessenMerk.add(v);
      try {
        groessenBeob?.observe(v);
      } catch {
        // Element weg
      }
    }
    // Erst die neuen Ziele sperren, dann pruefen, wer kein Ziel mehr ist (das Rueckfall-Video faellt erst, wenn der Treffer gesperrt ist).
    for (const v of bestimmeZiele(haltefest)) {
      if (gesperrt.has(v) || !ungeloest(v) || quelle(v) === '' || !willSpielen(v)) continue;
      void starteRiegel(v, sperre(v, true));
    }
    // Gesperrte, die auf eine Videoseite gewartet haben (Einzelseiten-App: Adresswechsel ohne Neuladen): jetzt bekommen sie den Riegel.
    if (!istListenSeite()) for (const [v, i] of [...gesperrt]) if (i.wartet && !i.laeuft) void starteRiegel(v, i);
    const ziele = bestimmeZiele(haltefest);
    const nurTreffer = trefferBereit;
    for (const v of [...gesperrt.keys()]) {
      if (!v.isConnected) entsperre(v, false);
      // Ein Adapter-Treffer verdraengt das Rueckfall-Video: Ton zurueck, aber kein Selbststart. Sonst wie bisher (Video laeuft weiter).
      else if (!ziele.has(v)) entsperre(v, !nurTreffer);
    }
    pflegeStandbild(ziele);
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
    if (aktiv()) plane(); // Groesse oder Poster koennen sich geaendert haben: Standbild neu bewerten
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
    plane();
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
    // Auch Videos unter dem Standbild: im Vollbild laege das echte Bild offen (das Standbild ist ein Geschwister und dort nicht zu sehen).
    for (const v of standbildVideos) verlasseVollbild(v);
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
      if (m.removedNodes.length && gesperrt.size && [...m.removedNodes].some((n) => !istStandbildHost(n))) video = true;
      for (const n of m.addedNodes) {
        if (n.nodeType !== 1 || istStandbildHost(n)) continue;
        if (n.nodeName === 'VIDEO' || (n as Element).querySelector('video')) video = true;
        // Offene Shadow Roots, die der Haken nicht meldet (deklarative Wurzeln aus <template shadowrootmode>).
        if (sammleOffene(n as Element)) video = true;
      }
    }
    if (video) plane();
  }
  const MO_OPTIONEN: MutationObserverInit = { childList: true, subtree: true, attributes: true, attributeFilter: ['src', 'autoplay', 'poster'] };
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
    // Beim Start auch die offenen Wurzeln einbeziehen, die der Haken nicht gemeldet hat (deklarative Shadow Roots), und noch einmal, wenn der
    // Parser fertig ist (eine Parser-Pause kann Wurzeln an den Beobachtern vorbeigeschoben haben).
    nachlesen();
    document.addEventListener('DOMContentLoaded', nachlesen);
    window.addEventListener('load', nachlesen);
  }
  function nachlesen(): void {
    if (verbunden && document.documentElement && sammleOffene(document.documentElement)) plane();
  }

  // Merkt eine Wurzel (aus dem Hinweis des Hakens oder aus `element.shadowRoot`). Gibt zurueck, ob sie neu war.
  function merkeWurzel(w: ShadowRoot): boolean {
    if (wurzelMerk.has(w)) return false;
    wurzelMerk.add(w);
    wurzeln.add(new WeakRef(w));
    if (verbunden) verbindeWurzel(w);
    return true;
  }

  // Alle offenen Wurzeln unter `start` (samt `start` selbst) einbeziehen, auch verschachtelte. Gibt zurueck, ob eine neu war.
  function sammleOffene(start: Element | ShadowRoot): boolean {
    let neu = false;
    const gang = document.createTreeWalker(start, NodeFilter.SHOW_ELEMENT);
    let el: Element | null = start instanceof Element ? start : (gang.nextNode() as Element | null);
    while (el) {
      const w = el.shadowRoot;
      // Nur in neue Wurzeln hinabsteigen: eine bekannte Wurzel hat ihren eigenen Beobachter.
      if (w && merkeWurzel(w)) {
        neu = true;
        sammleOffene(w);
      }
      el = gang.nextNode() as Element | null;
    }
    return neu;
  }
  function trenne(): void {
    if (!verbunden) return;
    verbunden = false;
    for (const [typ, fn] of medienHorcher) document.removeEventListener(typ, fn, true);
    document.removeEventListener('fullscreenchange', beiVollbild, true);
    document.removeEventListener('DOMContentLoaded', nachlesen);
    window.removeEventListener('load', nachlesen);
    beobachter.disconnect();
    groessenBeob?.disconnect();
    groessenMerk = new WeakSet();
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
    if (!w || !merkeWurzel(w)) return;
    if (verbunden) plane();
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

  // Zeitgeber auf den naechsten Wechsel einer strengen Zeit (Auftrag Z1): hoechstens einer je Seite, nur solange die Seite sichtbar ist und
  // Fenster mit Freischaltung gelten (sonst nie angelegt). Der Zeitpunkt wird nur neu gerechnet, wenn sich die Fenster aendern oder er vorbei ist.
  let wechselTimer: ReturnType<typeof setTimeout> | null = null;
  let wechselCache: { schluessel: string; am: number } | null = null;
  function planeWechsel(): void {
    const zeiten = einst?.kontrolle.zeiten ?? [];
    const noetig = lebt() && document.visibilityState === 'visible' && zeiten.length > 0 && istFreigeschaltet(pack, 'kontrolle:zeitplan');
    if (!noetig) {
      if (wechselTimer) clearTimeout(wechselTimer);
      wechselTimer = null;
      wechselCache = null;
      return;
    }
    const schluessel = JSON.stringify(zeiten);
    const jetzt = Date.now();
    if (wechselTimer && wechselCache && wechselCache.schluessel === schluessel && wechselCache.am > jetzt) return;
    if (wechselTimer) clearTimeout(wechselTimer);
    wechselTimer = null;
    const ms = naechsterWechselMs(zeiten, new Date(jetzt));
    wechselCache = ms === null ? null : { schluessel, am: jetzt + ms };
    if (ms === null) return;
    wechselTimer = setTimeout(() => {
      wechselTimer = null;
      wechselCache = null;
      bewerte();
    }, Math.min(ms + 100, 2_000_000_000));
  }
  const beiSichtbarkeit = (): void => {
    planeWechsel();
    if (document.visibilityState === 'visible') bewerte();
  };
  document.addEventListener('visibilitychange', beiSichtbarkeit);

  // Ein Quiz ist offen und nur das Kriterium "Erwachsenenseite oder strenge Zeit" fehlt jetzt (Fenster zu Ende): das laufende Quiz bleibt stehen.
  function nurStrengVorbei(): boolean {
    if (keinQuiz || !einst || einst.pause || istLokalePause(einst) || !einst.erwachsen.an || ersatzDa()) return false;
    if (!istFreigeschaltet(pack, 'erwachsen:quiz') || passtAusnahme(adresseFuerAusnahmen(), einst.ausnahmen)) return false;
    return [...gesperrt.values()].some((i) => i.laeuft);
  }

  function bewerte(): void {
    if (!lebt()) return;
    planeWechsel();
    // Der Adressbeobachter laeuft nur in der obersten Seite und solange der Player grundsaetzlich gilt (auch auf einem Ausnahmepfad).
    if (istOben && grundAktiv() && !ersatzDa()) adresse.start();
    else adresse.stopp();
    if (!aktiv()) {
      if (nurStrengVorbei()) {
        // Neue Videos sind frei (die Horcher pruefen `aktiv()`), das offene Quiz endet von selbst.
        for (const [v, i] of [...gesperrt]) if (!i.laeuft) entsperre(v, true);
        standbildWeg();
        return;
      }
      gebeAlleFrei(true);
      standbildWeg();
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
  const abLokal = beiLokalerPause(() => {
    gebeAlleFrei(true);
    standbildWeg();
  });

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
    standbildWeg();
    trenne();
    for (const g of GESTEN) window.removeEventListener(g, beiGeste, true);
    document.removeEventListener('veil-wurzel', beiWurzelHinweis, true);
    ersatzBeobachter.disconnect();
    adresse.stopp();
    if (wechselTimer) clearTimeout(wechselTimer);
    wechselTimer = null;
    document.removeEventListener('visibilitychange', beiSichtbarkeit);
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
