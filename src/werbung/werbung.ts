// Werbe-Tausch (Auftrag W, Phase 5, PHASE-5-AUFTRAEGE-SESSION-9.md Abschnitt 3, Entscheidung 116): Werbeflaechen werden zu Mias Werbung,
// immer als Mias Werbung gekennzeichnet; normale Bilder in Werbegroesse bleiben unangetastet.
// Eigenes Modul neben dem Schleier. Laeuft in jedem Frame und bearbeitet nur Elemente des eigenen Dokuments (und offener Shadow Roots).
// Nur mit Pack und Freischaltung `kontrolle:werbung`, eigenem Schalter, ohne Pause und ohne eigene Ausnahme (`kontrolleErlaubt`; in
// Rahmen zaehlt auch die Adresse des Tabs, wie beim Schleier).
// Ablauf: Ein MutationObserver sammelt neue Knoten (gebuendelt, mit Zeitbudget). Kandidaten sind Elemente mit Werbe-Merkmal (iframe, Kennung,
// Kennzeichnung) oder auf Erwachsenenseiten alle Elemente der Tags unten; gemessen wird nur bei ihnen, gebuendelt in einem Lesevorgang,
// billige Pruefungen (Groesse, Format) zuerst. Passt die Box zu einem Werbeformat, holt das Modul ein Bild ueber den Erkenner (rolle
// `werbung`) und zeigt Mias Flaeche in EINEM Host je Dokument (geschlossene Shadow Root, letztes Kind von `html`, z-index 0): nichts im DOM der
// Seite wird angefasst (keine Kinder oder Geschwister von Seitenelementen). Die Flaeche liegt absolut in Dokument-Koordinaten (bei fixierten
// oder sticky Vorfahren fest im Fenster) auf dem Original, beschnitten auf die Clip-Rechtecke der Vorfahren und auf das Dokument (der
// Scrollbereich waechst nie). Alles wird aus Fenster-Koordinaten gerechnet, so wirken scale und zoom richtig. Positionierte Seiteninhalte mit
// z-index ueber 0 (fixierte Leisten, Dialoge, Menues) und der Freilegen-Knopf liegen darueber. Bekanntes Restrisiko: positionierte Inhalte mit
// z-index auto malt der Browser unter Mias Flaeche. Das Original bleibt im Layout, nur `visibility: hidden`. Es wird nichts blockiert.
import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import { adapterFuer, istVideoLink, type Adapter } from '../adapter';
import { seiteFuer } from '../adapter/liste';
import { beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../einstellungen';
import { istOberstesFenster, kontrolleErlaubt } from '../kontrolle/gemeinsam';
import {
  istFuer,
  type AntwortFehler,
  type AntwortPackBild,
  type AntwortPackDaten,
  type AntwortTab,
  type NachrichtErkennerPackBild,
  type NachrichtHintergrundPackDaten,
  type NachrichtHintergrundTab,
  type NachrichtInhalt,
} from '../nachrichten';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, kurzAusRoh, ladePackKurz, type PackKurz, type WerbeFormat } from '../pack/vertrag';
import { beiLokalerPause } from '../pause-lokal';
import { pruefeTexte } from '../quiz/vertrag';
import { AdressBeobachter } from '../schleier/adresse';
import { ANTWORT_MAX_MS, TAB_FRIST_MS } from '../schleier/konstanten';
import { vergissWecken, wecke } from '../schleier/pruefung';
import type { KontextLeicht } from '../schleier/schleier';
import { KENNUNG_ATTRIBUTE, formatFuer, hatKennung, istKennzeichnung, istWerbeAdresse, istWerbeHost, kennzeichnungFuer, linkFuer, passtWerbeName } from './logik';
import { melde } from '../ereignisse';

// Testhaken nur im Testbau: ohne Schalter faellt der Name des Attributs samt Code beim Bauen weg (Release-Pruefung).
const TESTHAKEN: boolean = import.meta.env.WXT_TESTHAKEN === '1';
const ATTR_TEST = TESTHAKEN ? 'data-veil-werbung' : '';

const KAND_TAGS = new Set(['IFRAME', 'INS', 'DIV', 'ASIDE', 'SECTION', 'A', 'IMG']);
const MAX_FLAECHEN = 40;
const MIN_ABSTAND_MS = 50;
const ARBEIT_BUDGET_MS = 8;
const BEWERTE_BUDGET_MS = 4;
const BEWERTE_TEIL = 250;
const MAX_BEOBACHTET = 200;
const TEXTE_FRIST_MS = 3000;
const TAKT_MS = 500;
const DIALOG_ABSTAND_MS = 250; // Suche nach fremden Dialogen hoechstens so oft (auch beim Rollen)
const DIALOG_Z_MIN = 1000; // feste Elemente ab diesem z-index gelten als Dialog oder Overlay der Seite
const DIALOG_WAEHLER = 'dialog[open],[role=dialog],[role=alertdialog],[aria-modal=true]';
const ECKEN_ABSTAND_MS = 120; // Pruefung der Ecken der Kennzeichnung hoechstens so oft
const ATTRIBUT_PAUSE_MS = 400; // dasselbe unbekannte Element wird nach einer Attributaenderung hoechstens so oft gemessen
const MAX_URLS = 16;
const MAX_BILDVERSUCHE = 4;
const HINWEIS = 'Advertisement by Mia, shown by the HYPNOMIA VEIL extension';
const ATTRIBUTE = ['class', 'id', 'style', 'width', 'height', 'src', 'name', 'hidden', ...KENNUNG_ATTRIBUTE];
// Nur Klicks (und Tasten im Fokus) auf Mias Flaeche erreichen die Seite nie. Bewegung, Rad und Beruehrung gehen durch, damit Ziehen und
// Wischen ueber der Werbung weiter funktionieren.
const KLICKS = ['pointerdown', 'mousedown', 'click', 'auxclick', 'dblclick', 'contextmenu'];
const LOESEN = ['pointerup', 'mouseup'];
const TASTEN = ['keydown', 'keyup', 'keypress', 'focusin'];

interface Ui {
  knoten: HTMLElement;
  bild: HTMLImageElement;
  badge: HTMLElement;
  link: HTMLAnchorElement;
}

interface Rk {
  l: number;
  t: number;
  r: number;
  b: number;
}

// Session 11: schon gezaehlte Werbe-Elemente (Ledger).
const werbungGezaehlt = new WeakSet<Element>();

interface Flaeche {
  nr: number;
  el: Element;
  format: WerbeFormat;
  schluessel: string;
  fest: boolean;
  gen: number;
  ui: Ui | null;
  bildName: string;
  link: string;
  kennzeichnung: string;
  versteckt: { wert: string; prio: string; hatteStil: boolean } | null;
  klemmer: Element[]; // Vorfahren mit overflow ungleich visible (Clip-Rechtecke)
  ausgeblendet: boolean; // ein Vorfahr ist visibility hidden
  imFenster: boolean; // beim letzten Nachfuehren im Sichtbereich
  seit: number; // performance.now(), als die Flaeche erkannt wurde
  bildMs: number | null;
  geladen: boolean;
  zugedeckt: boolean; // ein fremder Dialog der Seite liegt ueber der Flaeche: sie bleibt ganz verborgen, bis er weg ist
  ohneKennzeichnungBis: number; // keine freie Stelle fuer die Kennzeichnung: bis zu diesem Zeitpunkt (performance.now) ganz verborgen
  aufraeumen: Array<() => void>; // Horcher in Rahmen dieser Flaeche
}

const SCHATTEN_STIL = `
:host{all:initial}
.f{position:absolute;left:0;top:0;overflow:hidden;pointer-events:auto;margin:0;padding:0;box-sizing:border-box;cursor:pointer;background:#2b1020;display:none}
a.l{display:block;position:absolute;left:0;top:0;width:100%;height:100%;text-decoration:none;color:inherit;margin:0;padding:0;border:0}
img.b{display:block;position:absolute;max-width:none;object-fit:cover;margin:0;padding:0;border:0;-webkit-user-drag:none;user-select:none}
.k{position:absolute;left:0;top:0;width:max-content;max-width:100%;box-sizing:border-box;background:#2b1020;color:#fff;font:600 11px/1.3 system-ui,-apple-system,Segoe UI,sans-serif;padding:2px 6px;border-bottom-left-radius:4px;overflow-wrap:anywhere;z-index:2;text-align:left;cursor:default;pointer-events:auto}
.k.klein{font-size:9px;line-height:1.2;padding:1px 4px}
`;

const schnitt = (a: Rk, b: Rk): Rk => ({ l: Math.max(a.l, b.l), t: Math.max(a.t, b.t), r: Math.min(a.r, b.r), b: Math.min(a.b, b.b) });
const leer = (a: Rk): boolean => a.r - a.l < 1 || a.b - a.t < 1;

export function starteWerbung(ctx: KontextLeicht): void {
  let abgebaut = false;
  const lebt = () => !abgebaut && ctx.isValid;
  const istRahmen = !istOberstesFenster();

  let einstellungen: Einstellungen | null = null;
  let einstellungenGehoert = false;
  let ladeEinstellungenLaeuft = false;
  let pack: PackKurz | null = null;
  let packGehoert = false;
  let aktiv = false;
  let adHostModus = false; // dieser Rahmen gehoert einem Werbe-Host: nur Medien anhalten
  let erwachsen = false;
  let adapter: Adapter | null = null;
  let packSchluessel: string | null = null;
  let saetze: string[] | undefined;
  let texteP: Promise<string[] | undefined> | null = null;

  const aufruf = Math.random().toString(36).slice(2, 10);
  let zaehler = 0;
  const nummern = new WeakMap<Element, number>(); // gleiche Flaeche, gleiche Nummer: gleiches Bild, gleicher Link, gleiche Kennzeichnung
  let generation = 0;
  const flaechen = new Map<Element, Flaeche>();
  let gescheitert = new WeakSet<Element>();
  const versuche = new WeakMap<Element, number>();
  const kandidaten = new Set<Element>();
  const wartend = new Set<Element>(); // passten, aber es war kein Platz (40 Flaechen): kommen dran, wenn eine frei wird
  const wurzeln = new Set<Element>();
  const flach = new Set<Element>();
  const attribute = new Set<Element>();
  const letzteMessung = new WeakMap<Element, number>();
  let gesamt = false;
  let beobachter: MutationObserver | null = null;
  const beobachteteWurzeln = new WeakSet<Node>();
  let groesse: ResizeObserver | null = null;
  const beobachtet = new Set<Element>();
  let planTimer: ReturnType<typeof setTimeout> | null = null;
  let letzterLauf = -Infinity;
  let posRaf = 0;
  let letzteEcken = -Infinity;
  let letzteDialoge = -Infinity;
  let takt: ReturnType<typeof setInterval> | null = null;
  let hoerer = false;
  const urlNachName = new Map<string, string>();
  const modulAufraeumen: Array<() => void> = []; // Horcher in Rahmen, die nicht zu einer Flaeche gehoeren (Werbe-Host-Modus)

  // Der eine Host je Dokument.
  let host: HTMLElement | null = null;
  let wurzel: ShadowRoot | null = null;
  let druckAufHost = false; // der laufende Druck begann auf Mias Flaeche

  // Fruehe Erfassung am Fenster ab document_start: Klicks und Tasten, die auf Mias Flaeche zielen, erreichen die Seite nie. Ohne Host kehrt
  // der Schutz sofort zurueck. Standardaktionen ausserhalb des Mia-Links (Seitenlinks, Kontextmenue auf der Kennzeichnung) werden verhindert.
  const schutz = (ev: Event): void => {
    const h = host;
    if (!h) return;
    const typ = ev.type;
    if (typ === 'pointerdown' || typ === 'mousedown') druckAufHost = ev.target === h;
    if (ev.target !== h) return;
    if (LOESEN.includes(typ) && !druckAufHost) return;
    ev.stopImmediatePropagation();
    if (KLICKS.includes(typ) && wurzel) {
      const m = ev as MouseEvent;
      let imLink = false;
      try {
        const innen = wurzel.elementFromPoint(m.clientX, m.clientY);
        imLink = !!innen?.closest('a.l');
      } catch {
        imLink = false;
      }
      // Nur der Link von Mia darf etwas tun; alles andere auf der Flaeche (Kennzeichnung, Rand) loest nichts aus.
      if (!imLink && ev.cancelable) ev.preventDefault();
    }
  };
  for (const typ of [...KLICKS, ...LOESEN, ...TASTEN]) window.addEventListener(typ, schutz, { capture: true });

  // Tab-Adresse (nur Rahmen): eigene Ausnahmen gelten je Tab.
  let tabAdresse: URL | null = null;
  let tabBekannt = false;
  let tabFrageLaeuft = false;
  let inhaltHoererAn = false;
  let tabFrist: ReturnType<typeof setTimeout> | null = null;

  // ---------- Bedingungen ----------
  const schluesselVonPack = (p: PackKurz | null): string | null => (p ? `${p.id}|${p.version}|${p.importiert}` : null);

  function sichereEinstellungen(): void {
    if (einstellungen || ladeEinstellungenLaeuft || !istFreigeschaltet(pack, 'kontrolle:werbung')) return;
    ladeEinstellungenLaeuft = true;
    ladeEinstellungen()
      .catch(() => null)
      .then((e) => {
        ladeEinstellungenLaeuft = false;
        if (!einstellungenGehoert && e) einstellungen = e;
        pruefeLage();
      });
  }

  async function frageTab(): Promise<void> {
    if (!istRahmen || tabFrageLaeuft || !lebt()) return;
    tabFrageLaeuft = true;
    try {
      const n: NachrichtHintergrundTab = { ziel: 'hintergrund', typ: 'tab' };
      const a = (await browser.runtime.sendMessage(n)) as Partial<AntwortTab> | undefined;
      if (a && a.ok === true) {
        tabAdresse = typeof a.url === 'string' ? new URL(a.url) : null;
        tabBekannt = true;
      }
    } catch {
      // keine verwertbare Antwort
    } finally {
      tabFrageLaeuft = false;
    }
    if (lebt()) pruefeLage();
  }

  const beiInhaltNachricht = (nachricht: unknown): undefined => {
    if (!istRahmen || !lebt() || !istFuer(nachricht, 'inhalt')) return undefined;
    const n = nachricht as NachrichtInhalt;
    if (n.typ !== 'tab' || typeof n.url !== 'string') return undefined;
    try {
      const neu = new URL(n.url);
      if (neu.href !== tabAdresse?.href) {
        tabAdresse = neu;
        tabBekannt = true;
        pruefeLage();
      }
    } catch {
      // ungueltige Adresse
    }
    return undefined;
  };
  const beiSichtbarkeit = (): void => {
    if (!document.hidden && lebt() && einstellungen?.ausnahmen.length) void frageTab();
  };

  // Hoert auf Tab-Adressen, solange es eigene Ausnahmen gibt; ohne Ausnahmen ist die Antwort ohne Folgen.
  function steuereTab(e: Einstellungen): void {
    if (!istRahmen) return;
    if (e.ausnahmen.length > 0) {
      if (!inhaltHoererAn) {
        inhaltHoererAn = true;
        browser.runtime.onMessage.addListener(beiInhaltNachricht);
        document.addEventListener('visibilitychange', beiSichtbarkeit);
      }
      if (!tabBekannt && !tabFrageLaeuft) {
        void frageTab();
        if (!tabFrist) {
          // Nach TAB_FRIST_MS zaehlt nur die eigene Adresse, wenn der Hintergrund nicht antwortet.
          tabFrist = setTimeout(() => {
            tabFrist = null;
            if (!tabBekannt && lebt()) {
              tabBekannt = true;
              pruefeLage();
            }
          }, TAB_FRIST_MS);
        }
      }
    } else if (inhaltHoererAn) {
      inhaltHoererAn = false;
      browser.runtime.onMessage.removeListener(beiInhaltNachricht);
      document.removeEventListener('visibilitychange', beiSichtbarkeit);
      tabAdresse = null;
      tabBekannt = false;
    }
  }

  function pruefeLage(): void {
    if (!lebt()) return;
    const e = einstellungen;
    if (!e) {
      beende();
      return;
    }
    steuereTab(e);
    // Rahmen mit Ausnahmen: bis die Adresse des Tabs bekannt ist, wird nichts getauscht und nichts angehalten.
    const wartetAufTab = istRahmen && e.ausnahmen.length > 0 && !tabBekannt;
    const tabAus = tabAdresse !== null && passtAusnahme(tabAdresse, e.ausnahmen);
    const erlaubt = !wartetAufTab && !tabAus && e.kontrolle.werbung && kontrolleErlaubt(e, pack, 'kontrolle:werbung');
    if (!erlaubt) {
      beende();
      steuereAdresse(e);
      return;
    }
    const neuerSchluessel = schluesselVonPack(pack);
    if (neuerSchluessel !== packSchluessel) {
      // anderes Pack: Bilder und Saetze des alten verwerfen
      alleZurueck();
      gescheitert = new WeakSet();
      urlNachName.clear();
      packSchluessel = neuerSchluessel;
      saetze = undefined;
      texteP = null;
      gesamt = true;
    }
    const liste = seiteFuer(location.href, e.erwachsen.eigeneSeiten);
    const neuErwachsen = liste !== null;
    adapter = neuErwachsen ? adapterFuer(liste) : null;
    if (neuErwachsen !== erwachsen) {
      alleZurueck();
      erwachsen = neuErwachsen;
      gesamt = true;
    }
    steuereAdresse(e);
    starte();
  }

  function steuereAdresse(e: Einstellungen): void {
    if (e.ausnahmen.length > 0 && !istRahmen) adresse.start();
    else adresse.stopp();
  }

  // ---------- Medien anhalten ----------
  function halteMedium(m: HTMLMediaElement): void {
    try {
      m.muted = true;
      m.pause();
    } catch {
      // Medium nicht erreichbar
    }
  }
  // Medien in Rahmen gehoeren zu einem anderen Fenster-Objekt: `instanceof` greift dort nicht, darum der Tag.
  const istMedium = (t: unknown): t is HTMLMediaElement => {
    const tag = (t as Element | null)?.tagName;
    return tag === 'VIDEO' || tag === 'AUDIO';
  };
  const beiPlayRahmen = (ev: Event): void => {
    if (aktiv && istMedium(ev.target)) halteMedium(ev.target);
  };
  // `abmeldeListe`: die Horcher in Rahmen melden sich dort ab, wenn die Flaeche endet (oder das Modul).
  function halteRahmen(r: HTMLIFrameElement, abmeldeListe: Array<() => void>, gesehen: Set<Node>): void {
    const dokument = (): Document | null => {
      try {
        return r.contentDocument;
      } catch {
        return null;
      }
    };
    const an = (): void => {
      const d = dokument();
      if (!d) return;
      if (!gesehen.has(d)) {
        gesehen.add(d);
        d.addEventListener('play', beiPlayRahmen, true);
        abmeldeListe.push(() => {
          try {
            d.removeEventListener('play', beiPlayRahmen, true);
          } catch {
            // Dokument weg
          }
        });
      }
      halteIn(d, abmeldeListe, gesehen);
    };
    an();
    if (!gesehen.has(r)) {
      gesehen.add(r);
      const beiLoad = (): void => {
        if (aktiv) an();
      };
      r.addEventListener('load', beiLoad);
      abmeldeListe.push(() => r.removeEventListener('load', beiLoad));
    }
  }
  function halteIn(w: ParentNode | Element, abmeldeListe: Array<() => void> = modulAufraeumen, gesehen: Set<Node> = modulGesehen): void {
    if (istMedium(w)) halteMedium(w);
    try {
      for (const m of w.querySelectorAll<HTMLMediaElement>('video,audio')) halteMedium(m);
      // Rahmen derselben Herkunft innerhalb der Flaeche (auch ohne eigene Adresse, etwa about:blank): ebenfalls anhalten.
      const rahmen: Element[] = (w as Element).tagName === 'IFRAME' ? [w as Element] : [];
      for (const r of w.querySelectorAll('iframe')) rahmen.push(r);
      for (const r of rahmen) halteRahmen(r as HTMLIFrameElement, abmeldeListe, gesehen);
    } catch {
      // Selektor oder Knoten weg
    }
  }
  const modulGesehen = new Set<Node>();
  const beiPlay = (ev: Event): void => {
    if (!aktiv) return;
    const t = ev.target;
    if (!istMedium(t)) return;
    if (adHostModus) return halteMedium(t);
    for (const f of flaechen.values()) {
      if (f.el === t || f.el.contains(t)) return halteMedium(t);
    }
  };

  // ---------- Start und Ende ----------
  function starte(): void {
    if (aktiv) {
      if (gesamt) plane();
      return;
    }
    aktiv = true;
    // Werbe-Host-Modus nur in Rahmen: wer einen Werbe-Host direkt besucht, bekommt nichts angehalten.
    adHostModus = istRahmen && istWerbeHost(location.hostname);
    if (!hoerer) {
      hoerer = true;
      document.addEventListener('play', beiPlay, true);
    }
    if (adHostModus) {
      // Rahmen eines Werbe-Hosts: nur Medien anhalten und stumm schalten, sonst nichts.
      halteIn(document);
      schreibeTest();
      return;
    }
    gesamt = true;
    if (!texteP) texteP = ladeSaetze();
    beobachter = new MutationObserver(beiMutation);
    beobachter.observe(document, { childList: true, subtree: true, attributes: true, attributeFilter: ATTRIBUTE });
    groesse = new ResizeObserver((eintraege) => {
      for (const en of eintraege) kandidaten.add(en.target);
      plane();
    });
    window.addEventListener('scroll', planePosition, { capture: true, passive: true });
    window.addEventListener('resize', planePosition, { passive: true });
    document.addEventListener('transitionend', planePosition, true);
    document.addEventListener('animationend', planePosition, true);
    document.addEventListener('veil-wurzel', beiWurzelHinweis, true);
    takt = setInterval(tick, TAKT_MS);
    plane();
  }

  function beende(): void {
    const warAktiv = aktiv;
    aktiv = false;
    alleZurueck();
    beobachter?.disconnect();
    beobachter = null;
    groesse?.disconnect();
    groesse = null;
    beobachtet.clear();
    window.removeEventListener('scroll', planePosition, true);
    window.removeEventListener('resize', planePosition);
    document.removeEventListener('transitionend', planePosition, true);
    document.removeEventListener('animationend', planePosition, true);
    document.removeEventListener('veil-wurzel', beiWurzelHinweis, true);
    if (takt) clearInterval(takt);
    takt = null;
    if (planTimer) clearTimeout(planTimer);
    planTimer = null;
    if (posRaf) cancelAnimationFrame(posRaf);
    posRaf = 0;
    kandidaten.clear();
    wartend.clear();
    wurzeln.clear();
    flach.clear();
    attribute.clear();
    gesamt = false;
    erwachsen = false;
    adapter = null;
    packSchluessel = null;
    for (const a of modulAufraeumen.splice(0)) a();
    modulGesehen.clear();
    if (hoerer) {
      hoerer = false;
      document.removeEventListener('play', beiPlay, true);
    }
    if (warAktiv) schreibeTest();
  }

  // Alle Originale sofort zurueck, Mias Flaechen weg (Medien bleiben angehalten).
  function alleZurueck(): void {
    generation++;
    for (const f of [...flaechen.values()]) entferne(f, false);
    flaechen.clear();
  }

  // ---------- Saetze (Kennzeichnung) ----------
  function ladeSaetze(): Promise<string[] | undefined> {
    const holen = (async (): Promise<string[] | undefined> => {
      try {
        const n: NachrichtHintergrundPackDaten = { ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' };
        const a = (await browser.runtime.sendMessage(n)) as AntwortPackDaten | undefined;
        if (!a || a.ok !== true || !a.daten) return undefined;
        const t = pruefeTexte(a.daten);
        const s = t?.gruppen.werbung;
        saetze = s && s.length > 0 ? s : undefined;
        return saetze;
      } catch {
        return undefined;
      }
    })();
    const frist = new Promise<undefined>((ok) => setTimeout(() => ok(undefined), TEXTE_FRIST_MS));
    return Promise.race([holen, frist]);
  }

  // ---------- Bild vom Erkenner ----------
  type BildErgebnis = AntwortPackBild | 'nein' | 'transport';

  async function frageBild(schluessel: string, format: WerbeFormat): Promise<BildErgebnis> {
    if (!(await wecke(lebt))) return 'transport';
    const nachricht: NachrichtErkennerPackBild = { ziel: 'erkenner', typ: 'packbild', rolle: 'werbung', schluessel, format };
    let uhr: ReturnType<typeof setTimeout> | undefined;
    const zeit = new Promise<null>((ok) => {
      uhr = setTimeout(() => ok(null), ANTWORT_MAX_MS);
    });
    try {
      const a = (await Promise.race([browser.runtime.sendMessage(nachricht) as Promise<AntwortPackBild | AntwortFehler | undefined>, zeit])) as
        | AntwortPackBild
        | AntwortFehler
        | undefined
        | null;
      if (a && a.ok === false) return 'nein';
      return a && a.ok === true && typeof a.dataUrl === 'string' && a.dataUrl.startsWith('data:image/') ? a : 'transport';
    } catch {
      return 'transport';
    } finally {
      clearTimeout(uhr);
    }
  }

  async function holeBild(schluessel: string, format: WerbeFormat): Promise<BildErgebnis> {
    let a = await frageBild(schluessel, format);
    if (a === 'transport') {
      vergissWecken();
      a = await frageBild(schluessel, format);
    }
    if (typeof a === 'object') {
      // Gleiche Datei, gleiche Zeichenkette: nur eine Kopie je Dokument halten.
      const bekannt = urlNachName.get(a.name);
      if (bekannt) a = { ...a, dataUrl: bekannt };
      else {
        if (urlNachName.size >= MAX_URLS) urlNachName.delete(urlNachName.keys().next().value as string);
        urlNachName.set(a.name, a.dataUrl);
      }
    }
    return a;
  }

  // ---------- Ausschluss auf Erwachsenenseiten ----------
  function ausgeschlossen(el: Element): boolean {
    try {
      if (el === document.documentElement || el === document.body || el === host) return true;
      if (el.parentElement === document.documentElement) return true; // eigene Hosts (Riegel, Galerie, Freilegen)
      if (el.hasAttribute('data-veil-ersetzt') || el.querySelector('[data-veil-ersetzt]')) return true;
      if (el.tagName === 'VIDEO' || el.querySelector('video')) return true;
      const basis = location.href;
      const ad = adapter ?? adapterFuer(null);
      const nurEigen = ad.name === 'allgemein';
      const umgebend = el.closest('a[href]');
      if (umgebend && istVideoLink(umgebend.getAttribute('href'), basis, nurEigen)) return true;
      let n = 0;
      for (const a of el.querySelectorAll('a[href]')) {
        if (++n > 8) break;
        if (istVideoLink(a.getAttribute('href'), basis, true)) return true;
      }
      for (const s of ad.player ?? []) {
        try {
          if (el.matches(s) || el.closest(s) || el.querySelector(s)) return true;
        } catch {
          // kaputter Selektor
        }
      }
    } catch {
      return true;
    }
    return false;
  }

  // ---------- Merkmale ----------
  const kennungAn = (el: Element): boolean => hatKennung(el.getAttribute('class'), el.getAttribute('id'), (a) => el.hasAttribute(a));
  function kennungNah(el: Element): boolean {
    let p: Element | null = el;
    for (let i = 0; i < 4 && p; i++, p = p.parentElement) if (kennungAn(p)) return true;
    return false;
  }
  function iframeIstWerbung(f: Element): boolean {
    return istWerbeAdresse(f.getAttribute('src'), document.baseURI) || passtWerbeName(f.getAttribute('id')) || passtWerbeName(f.getAttribute('name'));
  }
  function einzigerWerbeRahmen(el: Element): boolean {
    if (el.tagName !== 'DIV' && el.tagName !== 'INS') return false;
    const rahmen = el.querySelectorAll('iframe');
    return rahmen.length === 1 && iframeIstWerbung(rahmen[0]!);
  }
  // Kurzer Text in einem Knoten, ohne den ganzen Teilbaum zu lesen: ein Textknoten oder ein Blatt-Element mit kurzem Text.
  function kurzerText(n: Node | null): boolean {
    if (!n) return false;
    if (n.nodeType === 3) return istKennzeichnung((n as Text).data);
    if (n.nodeType !== 1) return false;
    const e = n as Element;
    if (e.childElementCount !== 0) return false;
    const k = e.firstChild;
    return !!k && k.nodeType === 3 && istKennzeichnung((k as Text).data) && e.childNodes.length === 1;
  }
  function textIn(e: Element | null, max: number): boolean {
    if (!e) return false;
    let i = 0;
    for (const k of e.childNodes) {
      if (++i > max) break;
      if (kurzerText(k)) return true;
    }
    return false;
  }
  function hatKennzeichnung(el: Element): boolean {
    return kurzerText(el.previousSibling) || kurzerText(el.previousElementSibling) || textIn(el, 6) || textIn(el.parentElement, 12);
  }
  function hatMerkmal(el: Element): boolean {
    if (el.tagName === 'IFRAME' && iframeIstWerbung(el)) return true;
    if (kennungNah(el)) return true;
    if (hatKennzeichnung(el)) return true;
    return einzigerWerbeRahmen(el);
  }

  // ---------- Sammeln ----------
  function merkeKandidat(el: Element): void {
    if (KAND_TAGS.has(el.tagName)) kandidaten.add(el);
  }

  // Vorpruefung ohne Layout: nur Elemente mit Werbe-Merkmal (oder auf Erwachsenenseiten alle Kandidaten-Tags) werden spaeter gemessen.
  function pruefeElement(el: Element): void {
    if (el.parentElement === document.documentElement || el === host) return;
    // Kennzeichnungs-Element: Elternelement, Nachbarn und das folgende Geschwister werden Kandidaten.
    const k = el.firstChild;
    if (el.childElementCount === 0 && k && k.nodeType === 3 && (k as Text).data.length <= 40 && istKennzeichnung((k as Text).data)) {
      const eltern = el.parentElement;
      if (eltern && eltern !== document.body && eltern !== document.documentElement) {
        merkeKandidat(eltern);
        let n = 0;
        for (const kind of eltern.children) {
          if (++n > 12) break;
          if (kind !== el) merkeKandidat(kind);
        }
      }
    }
    if (!KAND_TAGS.has(el.tagName)) return;
    if (erwachsen || el.tagName === 'IFRAME' || kennungNah(el) || kurzerText(el.previousSibling) || kurzerText(el.previousElementSibling)) kandidaten.add(el);
  }

  function beobachteWurzel(w: ShadowRoot): void {
    if (!beobachter || beobachteteWurzeln.has(w)) return;
    beobachteteWurzeln.add(w);
    beobachter.observe(w, { childList: true, subtree: true, attributes: true, attributeFilter: ATTRIBUTE });
  }

  function sammle(w: Element | Document | ShadowRoot): void {
    if (w instanceof Element) {
      pruefeElement(w);
      if (w.shadowRoot) {
        beobachteWurzel(w.shadowRoot);
        sammle(w.shadowRoot);
      }
    }
    for (const el of w.querySelectorAll('*')) {
      pruefeElement(el);
      const sr = el.shadowRoot; // nur offene Shadow Roots
      if (sr) {
        beobachteWurzel(sr);
        sammle(sr);
      }
    }
  }

  // Der Haken in der Seitenwelt meldet jede neue Shadow Root als Ereignis `veil-wurzel` am Host (auch an schon bekannten Elementen).
  function beiWurzelHinweis(e: Event): void {
    if (!aktiv || adHostModus) return;
    const h = (e.composedPath()[0] ?? e.target) as Element | null;
    if (!h || h.nodeType !== 1) return;
    const sr = h.shadowRoot; // nur offene Shadow Roots; geschlossene bleiben unsichtbar
    if (!sr) return;
    beobachteWurzel(sr);
    sammle(sr);
    plane();
  }

  function beiMutation(liste: MutationRecord[]): void {
    for (const r of liste) {
      if (r.type === 'attributes') {
        if (r.target instanceof Element) attribute.add(r.target);
        continue;
      }
      if (r.target instanceof Element) flach.add(r.target);
      for (const n of r.addedNodes) if (n.nodeType === 1 && n !== host) wurzeln.add(n as Element);
    }
    plane();
  }

  // ---------- Planung ----------
  function plane(): void {
    if (planTimer || !aktiv || adHostModus) return;
    const warte = Math.max(0, MIN_ABSTAND_MS - (performance.now() - letzterLauf));
    planTimer = setTimeout(() => {
      planTimer = null;
      if (lebt() && aktiv) arbeite();
    }, warte);
  }

  function arbeite(): void {
    letzterLauf = performance.now();
    const t0 = performance.now();
    if (gesamt) {
      gesamt = false;
      wurzeln.clear();
      flach.clear();
      sammle(document);
    } else {
      for (const w of [...wurzeln]) {
        wurzeln.delete(w);
        if (w.isConnected) sammle(w);
        if (performance.now() - t0 > ARBEIT_BUDGET_MS && wurzeln.size > 0) {
          plane();
          break;
        }
      }
      for (const f of [...flach]) {
        flach.delete(f);
        if (!f.isConnected) continue;
        pruefeElement(f);
        // Das Kennzeichnungs-Element kann auch das Geschwister VOR einer Flaeche sein: das naechste Geschwister neu pruefen.
        if (f.nextElementSibling) pruefeElement(f.nextElementSibling);
      }
    }
    // Attributaenderungen: Flaechen und beobachtete Elemente immer, alles andere nur ueber die Vorpruefung und hoechstens alle 400 ms.
    const jetzt = performance.now();
    for (const el of [...attribute]) {
      attribute.delete(el);
      if (!el.isConnected || el === host) continue;
      if (flaechen.has(el) || beobachtet.has(el)) {
        kandidaten.add(el);
        continue;
      }
      if ((letzteMessung.get(el) ?? -Infinity) > jetzt - ATTRIBUT_PAUSE_MS) continue;
      pruefeElement(el);
    }
    bewerte();
  }

  // ---------- Bewerten ----------
  function beobachte(el: Element): void {
    if (!groesse || beobachtet.has(el)) return;
    if (beobachtet.size >= MAX_BEOBACHTET) {
      // Platz schaffen: getrennte Elemente zuerst, sonst das aelteste Element ohne Flaeche.
      raeumeBeobachtet();
      if (beobachtet.size >= MAX_BEOBACHTET) {
        for (const alt of beobachtet) {
          if (!flaechen.has(alt)) {
            groesse.unobserve(alt);
            beobachtet.delete(alt);
            break;
          }
        }
      }
      if (beobachtet.size >= MAX_BEOBACHTET) return;
    }
    beobachtet.add(el);
    groesse.observe(el);
  }

  function raeumeBeobachtet(): void {
    for (const el of [...beobachtet]) {
      if (!el.isConnected) {
        groesse?.unobserve(el);
        beobachtet.delete(el);
      }
    }
  }

  function bewerte(): void {
    if (!aktiv) return;
    const t0 = performance.now();
    const alle = [...kandidaten];
    let i = 0;
    while (i < alle.length) {
      const teil = alle.slice(i, i + BEWERTE_TEIL);
      i += BEWERTE_TEIL;
      for (const el of teil) kandidaten.delete(el);
      bewerteTeil(teil);
      if (i < alle.length && performance.now() - t0 > BEWERTE_BUDGET_MS) {
        plane(); // der Rest kommt im naechsten Durchgang dran, nichts wird verworfen
        break;
      }
    }
    planePosition();
  }

  function bewerteTeil(teil: Element[]): void {
    const lebende = teil.filter((el) => el.isConnected);
    // Lesevorgang: alle Messungen hintereinander, ohne dazwischen zu schreiben.
    const mass = lebende.map((el) => el.getBoundingClientRect());
    const jetzt = performance.now();
    const treffer: Array<{ el: Element; format: WerbeFormat }> = [];
    lebende.forEach((el, i) => {
      const r = mass[i]!;
      letzteMessung.set(el, jetzt);
      const format = formatFuer(r.width, r.height);
      const vorhanden = flaechen.get(el);
      if (vorhanden) {
        if (!format) entferne(vorhanden, true);
        else {
          if (format !== vorhanden.format) neuesFormat(vorhanden, format);
          haltVersteckt(vorhanden);
        }
        return;
      }
      if (!format) {
        // Elemente mit Werbe-Merkmal koennen spaeter eine Groesse bekommen; auf Erwachsenenseiten sind alle Kandidaten: dort nicht beobachten.
        if (!erwachsen) beobachte(el);
        return;
      }
      if (gescheitert.has(el)) return;
      // Erst jetzt die teureren Pruefungen.
      if (!(erwachsen ? !ausgeschlossen(el) : hatMerkmal(el))) return;
      treffer.push({ el, format });
    });
    const menge = new Set(treffer.map((t) => t.el));
    for (const t of treffer) {
      let verdeckt = false;
      for (let p = t.el.parentElement; p; p = p.parentElement) {
        if (menge.has(p) || flaechen.has(p)) {
          verdeckt = true;
          break;
        }
      }
      if (verdeckt) continue;
      for (const [e, f] of [...flaechen]) if (e !== t.el && t.el.contains(e)) entferne(f, false);
      if (flaechen.size >= MAX_FLAECHEN) {
        wartend.add(t.el);
        continue;
      }
      erzeuge(t.el, t.format);
    }
  }

  // ---------- Flaechen ----------
  function erzeuge(el: Element, format: WerbeFormat): void {
    let nr = nummern.get(el);
    if (nr === undefined) {
      nr = ++zaehler;
      nummern.set(el, nr);
    }
    const schluessel = `${aufruf}#${nr}`;
    const f: Flaeche = {
      nr,
      el,
      format,
      schluessel,
      fest: false,
      gen: generation,
      ui: null,
      bildName: '',
      link: linkFuer(schluessel).url,
      kennzeichnung: '',
      versteckt: null,
      klemmer: [],
      ausgeblendet: false,
      imFenster: true,
      seit: performance.now(),
      bildMs: null,
      geladen: false,
      zugedeckt: false,
      ohneKennzeichnungBis: 0,
      aufraeumen: [],
    };
    flaechen.set(el, f);
    halteIn(el, f.aufraeumen, new Set<Node>());
    beobachte(el);
    void ladeFlaeche(f);
  }

  function spaeterNochmal(el: Element, ms: number): void {
    const n = (versuche.get(el) ?? 0) + 1;
    versuche.set(el, n);
    if (n > MAX_BILDVERSUCHE) {
      gescheitert.add(el);
      return;
    }
    const gen = generation;
    setTimeout(() => {
      if (lebt() && aktiv && gen === generation && el.isConnected) {
        kandidaten.add(el);
        plane();
      }
    }, ms);
  }

  async function ladeFlaeche(f: Flaeche): Promise<void> {
    const gen = f.gen;
    const format = f.format;
    const [a, satz] = await Promise.all([holeBild(f.schluessel, format), texteP ?? Promise.resolve(saetze)]);
    if (!lebt() || gen !== generation || flaechen.get(f.el) !== f) return;
    if (f.format !== format) {
      void ladeFlaeche(f); // das Format hat inzwischen gewechselt
      return;
    }
    if (a === 'transport') {
      // voruebergehender Fehler: eine sichtbare Flaeche behaelt ihr Bild, sonst bleibt das Original und es gibt spaeter einen neuen Versuch
      if (!f.ui) {
        entferne(f, false);
        spaeterNochmal(f.el, 3000);
      }
      return;
    }
    if (a === 'nein') {
      // kein Bild (Fehler, Pack kaputt): das Original bleibt, auch bei einer schon sichtbaren Flaeche nach einem Formatwechsel
      entferne(f, false);
      gescheitert.add(f.el);
      return;
    }
    zeige(f, a, satz ?? saetze);
  }

  function neuesFormat(f: Flaeche, format: WerbeFormat): void {
    f.format = format;
    void ladeFlaeche(f);
  }

  // Der eine Host je Dokument: letztes Kind von html, z-index 0 (Seiteninhalt mit z-index ueber 0 und der Freilegen-Knopf liegen darueber).
  function sichereHost(): boolean {
    const de = document.documentElement;
    if (!de) return false;
    if (!host) {
      host = document.createElement('div');
      host.setAttribute(
        'style',
        'all:initial!important;position:absolute!important;left:0!important;top:0!important;width:0!important;height:0!important;margin:0!important;padding:0!important;border:0!important;overflow:visible!important;z-index:0!important;pointer-events:none!important;display:block!important;visibility:visible!important;',
      );
      wurzel = host.attachShadow({ mode: 'closed' });
      const stil = document.createElement('style');
      stil.textContent = SCHATTEN_STIL;
      wurzel.append(stil);
    }
    // Elternknoten: Bildet `body` selbst eine Stapelebene (Seite sperrt das Rollen mit `position: fixed`, `isolation`, Deckkraft), liegen
    // ALLE seine Kinder, auch ein fester Dialog mit z-index 2147483647, in dieser Ebene. Ein Host als Kind von `html` malt dann ueber dem
    // ganzen Body und damit ueber dem Dialog der Seite (chip.de, Sourcepoint). In dem Fall wird der Host letztes Kind von `body`: dann gilt
    // sein z-index 0 innerhalb derselben Ebene, und Dialoge mit positivem z-index liegen darueber.
    const ziel = bodyBildetEbene() ? (document.body as HTMLElement) : de;
    // In `html` bleibt er letztes Kind (wie bisher). In `body` wird er nur eingehaengt, wenn er dort fehlt: staendiges Anhaengen ans Ende
    // wuerde die Beobachter der Seite am Body wecken.
    if (ziel === de ? host.parentNode !== ziel || ziel.lastElementChild !== host : host.parentNode !== ziel) ziel.append(host);
    return true;
  }

  // Bildet `body` eine Stapelebene, ohne den Bezugsrahmen fester Nachfahren zu aendern (transform, filter, perspective, contain, will-change
  // taugen nicht: darin waere `position: fixed` nicht mehr auf das Fenster bezogen)?
  function bodyBildetEbene(): boolean {
    const b = document.body;
    if (!b) return false;
    try {
      const cs = getComputedStyle(b);
      if (cs.transform !== 'none' || cs.filter !== 'none' || cs.perspective !== 'none' || cs.willChange !== 'auto' || (cs.contain !== 'none' && cs.contain !== '')) return false;
      if ((cs as CSSStyleDeclaration & { backdropFilter?: string }).backdropFilter && (cs as CSSStyleDeclaration & { backdropFilter?: string }).backdropFilter !== 'none') return false;
      if (cs.position === 'fixed' || cs.position === 'sticky') return true;
      if (cs.position !== 'static' && cs.zIndex !== 'auto') return true;
      if (cs.isolation === 'isolate' || parseFloat(cs.opacity) < 1 || cs.mixBlendMode !== 'normal') return true;
    } catch {
      // Stil nicht lesbar
    }
    return false;
  }

  // Clip-Vorfahren, ausgeblendete Vorfahren und fixierte Vorfahren neu bestimmen.
  function frischeVorfahren(f: Flaeche): void {
    const klemmer: Element[] = [];
    let aus = false;
    let fest = false;
    try {
      for (let p: Element | null = f.el.parentElement; p; p = p.parentElement) {
        if (p === document.documentElement || p === document.body) continue;
        const cs = getComputedStyle(p);
        if (cs.visibility !== 'visible') aus = true;
        if (cs.position === 'fixed' || cs.position === 'sticky') fest = true;
        if (cs.overflowX !== 'visible' || cs.overflowY !== 'visible') klemmer.push(p);
      }
      if (getComputedStyle(f.el).position === 'fixed') fest = true;
    } catch {
      // Stil nicht lesbar
    }
    f.klemmer = klemmer;
    f.ausgeblendet = aus;
    f.fest = fest;
    if (f.ui) f.ui.knoten.style.position = fest ? 'fixed' : 'absolute';
  }

  function zeige(f: Flaeche, a: AntwortPackBild, satz: readonly string[] | undefined): void {
    f.bildName = a.name;
    f.kennzeichnung = kennzeichnungFuer(satz, f.schluessel);
    if (f.ui) {
      f.ui.bild.src = a.dataUrl;
      f.ui.badge.textContent = f.kennzeichnung;
      return;
    }
    if (!sichereHost() || !wurzel) return;
    // Session 11: Ledger, je Seitenelement einmal (Rotation, Pause-Ende und kurzes Groessenflackern zaehlen nicht erneut).
    if (!werbungGezaehlt.has(f.el)) {
      werbungGezaehlt.add(f.el);
      melde({ art: 'werbung' });
    }
    const knoten = document.createElement('div');
    knoten.className = 'f';
    knoten.setAttribute('role', 'group');
    knoten.setAttribute('aria-label', HINWEIS);
    knoten.title = HINWEIS;
    const link = document.createElement('a');
    link.className = 'l';
    link.href = f.link;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    const bild = document.createElement('img');
    bild.className = 'b';
    bild.alt = '';
    bild.draggable = false;
    link.append(bild);
    // Kennzeichnung neben dem Link: sichtbar, aber nicht klickbar.
    const badge = document.createElement('div');
    badge.className = 'k';
    badge.textContent = f.kennzeichnung;
    knoten.append(link, badge);
    f.ui = { knoten, bild, badge, link };
    frischeVorfahren(f);
    wurzel.append(knoten);
    const fertig = async (): Promise<void> => {
      // Erst zeigen, wenn das Bild dekodiert ist: sonst steht kurz eine leere Flaeche, und das Original ist schon weg.
      try {
        await bild.decode();
      } catch {
        // nicht dekodierbar: error-Ereignis kommt oder das Bild steht trotzdem
      }
      if (flaechen.get(f.el) !== f || !f.ui || f.geladen) return;
      f.geladen = true;
      f.bildMs = Math.round(performance.now() - f.seit);
      verstecke(f);
      positioniere(true); // gleich im selben Zug: Groesse und Lage stehen, bevor die Flaeche gezeichnet wird
      schreibeTest();
    };
    bild.addEventListener('load', () => void fertig());
    bild.addEventListener('error', () => {
      // Seite verbietet Data-URLs (strenge CSP) oder Bild kaputt: Original bleibt.
      if (flaechen.get(f.el) !== f) return;
      entferne(f, false);
      gescheitert.add(f.el);
      schreibeTest();
    });
    bild.src = a.dataUrl;
  }

  function verstecke(f: Flaeche): void {
    const el = f.el as HTMLElement;
    if (!el.style) return;
    if (!f.versteckt) f.versteckt = { wert: el.style.getPropertyValue('visibility'), prio: el.style.getPropertyPriority('visibility'), hatteStil: el.hasAttribute('style') };
    el.style.setProperty('visibility', 'hidden', 'important');
  }

  // Die Seite hat den Stil neu geschrieben: ihr Wert gilt ab jetzt als das Original (auch ein eigenes `hidden`), das Original bleibt unsichtbar.
  function haltVersteckt(f: Flaeche): void {
    const el = f.el as HTMLElement;
    if (!f.ui || !f.geladen || !el.style) return;
    const w = el.style.getPropertyValue('visibility');
    const p = el.style.getPropertyPriority('visibility');
    if (w === 'hidden' && p === 'important') return;
    f.versteckt = { wert: w, prio: p, hatteStil: f.versteckt?.hatteStil ?? true };
    el.style.setProperty('visibility', 'hidden', 'important');
  }

  // Zurueck: Original sichtbar, Mias Flaeche weg. `neuPruefen`: das Element kann spaeter wieder passen (Groesse).
  function entferne(f: Flaeche, neuPruefen: boolean): void {
    const el = f.el as HTMLElement;
    if (f.versteckt && el.style) {
      try {
        if (f.versteckt.wert) el.style.setProperty('visibility', f.versteckt.wert, f.versteckt.prio);
        else el.style.removeProperty('visibility');
        if (!f.versteckt.hatteStil && el.getAttribute('style') === '') el.removeAttribute('style');
      } catch {
        // Element weg
      }
    }
    f.versteckt = null;
    for (const a of f.aufraeumen.splice(0)) a();
    f.ui?.knoten.remove();
    f.ui = null;
    flaechen.delete(f.el);
    if (flaechen.size === 0 && host) {
      host.remove();
      host = null;
      wurzel = null;
      druckAufHost = false;
    }
    if (neuPruefen) {
      beobachte(f.el);
      kandidaten.add(f.el);
    }
    if (wartend.size > 0 && flaechen.size < MAX_FLAECHEN) {
      for (const w of wartend) kandidaten.add(w);
      wartend.clear();
      plane();
    }
    schreibeTest();
  }

  // ---------- Lage nachfuehren ----------
  function tick(): void {
    if (document.hidden || !aktiv) return;
    for (const f of [...flaechen.values()]) {
      if (!f.el.isConnected) {
        entferne(f, false);
        continue;
      }
      if (!f.ui) continue;
      // Vorfahren nur fuer Flaechen im Sichtbereich neu bestimmen (getComputedStyle je Vorfahr).
      if (f.imFenster) frischeVorfahren(f);
      // Die Seite oder der Schleier hat inzwischen Vorschau, Video oder Player daraus gemacht: Mias Flaeche weicht.
      if (erwachsen && f.geladen && ausgeschlossen(f.el)) {
        entferne(f, false);
        gescheitert.add(f.el);
      }
    }
    raeumeBeobachtet();
    if (host) sichereHost();
    planePosition();
  }

  function planePosition(): void {
    if (posRaf || !aktiv) return;
    posRaf = requestAnimationFrame(() => {
      posRaf = 0;
      if (lebt() && aktiv) positioniere(false);
    });
  }

  const innen = (e: Element): Rk => {
    const q = e.getBoundingClientRect();
    return { l: q.left + e.clientLeft, t: q.top + e.clientTop, r: q.left + e.clientLeft + e.clientWidth, b: q.top + e.clientTop + e.clientHeight };
  };

  function positioniere(sofortEcken: boolean): void {
    const h = host;
    const mitUi = [...flaechen.values()].filter((f) => f.ui);
    if (!h || mitUi.length === 0) return;
    // Zuerst lesen: Umzug html <-> body (die Seite sperrt das Rollen erst jetzt) und fremde Dialoge, gedrosselt.
    const jetztDialog = performance.now();
    if (sofortEcken || jetztDialog - letzteDialoge >= DIALOG_ABSTAND_MS) {
      letzteDialoge = jetztDialog;
      sichereHost();
      pruefeDialoge();
    }
    // Lesen, dann schreiben.
    const de = document.documentElement;
    const vb = de.clientWidth;
    const vh = de.clientHeight;
    const basis = h.getBoundingClientRect();
    // Das Dokument: Mias Flaechen werden darauf begrenzt, damit der Scrollbereich nie waechst.
    // Liegt der Host in `body` und die Seite sperrt das Rollen (`body { position: fixed; top: -Npx }`), ist der Bezugspunkt des Hosts der
    // verschobene Body: das Dokument ist dann der Body selbst, nicht die Hoehe des Fensters ab dem Host.
    const dok: Rk = { l: basis.left, t: basis.top, r: basis.left + Math.max(de.scrollWidth, vb), b: basis.top + Math.max(de.scrollHeight, vh) };
    if (h.parentNode === document.body && document.body) {
      const bq = document.body.getBoundingClientRect();
      dok.l = Math.min(dok.l, bq.left);
      dok.t = Math.min(dok.t, bq.top);
      dok.r = Math.max(dok.r, bq.right);
      dok.b = Math.max(dok.b, bq.bottom);
    }
    const fenster: Rk = { l: 0, t: 0, r: vb, b: vh };
    const lese = mitUi.map((f) => ({
      r: f.el.getBoundingClientRect(),
      k: f.klemmer.map(innen),
    }));
    let geaendert = false;
    const sichtbar: Array<{ f: Flaeche; sicht: Rk }> = [];
    mitUi.forEach((f, i) => {
      const { r, k } = lese[i]!;
      const ui = f.ui!;
      if (r.width < 1 || r.height < 1) {
        ui.knoten.style.display = 'none';
        f.imFenster = false;
        return;
      }
      const format = formatFuer(r.width, r.height);
      if (!format) {
        entferne(f, true);
        geaendert = true;
        return;
      }
      if (format !== f.format) {
        neuesFormat(f, format);
        geaendert = true;
      }
      // Sichtbarer Teil: Box, beschnitten auf die Clip-Rechtecke der Vorfahren und (nicht fixierte) auf das Dokument.
      let sicht: Rk = { l: r.left, t: r.top, r: r.right, b: r.bottom };
      for (const c of k) sicht = schnitt(sicht, c);
      if (!f.fest) sicht = schnitt(sicht, dok);
      f.imFenster = !leer(schnitt(sicht, fenster));
      if (leer(sicht) || f.ausgeblendet) {
        ui.knoten.style.display = 'none';
        return;
      }
      ui.knoten.style.display = f.geladen ? 'block' : 'none';
      ui.knoten.style.position = f.fest ? 'fixed' : 'absolute';
      ui.knoten.style.width = `${sicht.r - sicht.l}px`;
      ui.knoten.style.height = `${sicht.b - sicht.t}px`;
      ui.knoten.style.transform = f.fest ? `translate(${sicht.l}px,${sicht.t}px)` : `translate(${sicht.l - basis.left}px,${sicht.t - basis.top}px)`;
      ui.bild.style.left = `${r.left - sicht.l}px`;
      ui.bild.style.top = `${r.top - sicht.t}px`;
      ui.bild.style.width = `${r.width}px`;
      ui.bild.style.height = `${r.height}px`;
      ui.badge.classList.toggle('klein', r.height < 60);
      // Nie ein Bild ohne Kennzeichnung: unter einem fremden Dialog oder ohne freie Stelle fuer die Kennzeichnung ganz verborgen.
      if (f.zugedeckt || performance.now() < f.ohneKennzeichnungBis) ui.knoten.style.display = 'none';
      if (f.geladen && ui.knoten.style.display !== 'none') sichtbar.push({ f, sicht });
    });
    // Kennzeichnung: in eine Ecke legen, an der Mias Flaeche wirklich oben liegt (nicht unter einer fixierten Leiste), gebuendelt und gedrosselt.
    const jetzt = performance.now();
    if (sichtbar.length > 0 && (sofortEcken || jetzt - letzteEcken >= ECKEN_ABSTAND_MS)) {
      letzteEcken = jetzt;
      for (const s of sichtbar) platziereBadge(s.f, s.sicht, fenster);
    }
    if (geaendert || TESTHAKEN) schreibeTest();
  }

  // Fremde Dialoge der Seite ueber Mias Flaechen. Der Host kann nur ein Kind von html oder body sein und nicht in eine tiefere Stapelebene
  // der Seite (Huelle mit eigenem z-index): dort malt er ueber einem Dialog, der in der Seite ueber der Werbung liegt. Liegt so ein Dialog
  // ueber einer Flaeche, bleibt sie GANZ verborgen (das Original bleibt versteckt), bis er weg ist. Nie ein Teilbild ohne Kennzeichnung.
  // Kandidaten billig: dialog[open], role=dialog und alertdialog, aria-modal, dazu feste Kinder von body und html mit z-index ab 1000, jeweils
  // auch in offenen Shadow Roots direkter Kinder von body und html (nicht tiefer). Je Durchlauf einmal geholt; ohne Kandidaten keine Messung.
  interface DialogKandidat {
    el: Element; // zum Abgleich mit elementsFromPoint (bei Shadow Root: der Besitzer, den die Liste liefert)
    rect: DOMRect;
  }
  function holeDialoge(): DialogKandidat[] {
    const aus: DialogKandidat[] = [];
    const de = document.documentElement;
    const fensterFlaeche = Math.max(1, de.clientWidth * de.clientHeight);
    const nimm = (e: Element, hit: Element, nurGross = false): void => {
      if (e === host || (e.parentElement === de && e !== document.body)) return; // eigene Hosts der Module (Kinder von html)
      const cs = getComputedStyle(e);
      if (cs.display === 'none' || cs.visibility !== 'visible' || cs.pointerEvents === 'none' && !e.matches(DIALOG_WAEHLER)) return;
      if (Number(cs.opacity) === 0) return; // ausgeblendete Modals (Ein- und Ausblenden) zaehlen nicht
      const q = e.getBoundingClientRect();
      if (q.width < 2 || q.height < 2) return;
      // Feste Elemente ohne Dialog-Rolle erst ab 15 % der Fensterflaeche: schmale Kopf- und Fussleisten sollen Mia nicht beim Rollen verstecken.
      if (nurGross && (q.width * q.height) / fensterFlaeche < 0.15) return;
      aus.push({ el: hit, rect: q });
    };
    try {
      for (const e of document.querySelectorAll(DIALOG_WAEHLER)) nimm(e, e);
      const body = document.body;
      if (body && body) {
        // Bei sehr vielen Kindern nur die letzten 300 (Overlays haengen Seiten meist ans Ende).
        const kinder = [...body.children].slice(-300);
        for (const k of kinder) {
          if (k === host) continue;
          const cs = getComputedStyle(k);
          if (cs.position === 'fixed' && cs.zIndex !== 'auto' && Number(cs.zIndex) >= DIALOG_Z_MIN) nimm(k, k, true);
          const sr = k.shadowRoot;
          if (sr) {
            for (const e of sr.querySelectorAll(DIALOG_WAEHLER)) nimm(e, k);
            for (const e of sr.children) {
              const c2 = getComputedStyle(e);
              if (c2.position === 'fixed' && c2.zIndex !== 'auto' && Number(c2.zIndex) >= DIALOG_Z_MIN) nimm(e, k, true);
            }
          }
        }
      }
    } catch {
      return aus;
    }
    return aus;
  }

  // Lesevorgang: setzt `zugedeckt` je Flaeche. Liegt Mias Host im Malreihenfolge-Stapel am Mittelpunkt des Schnitts vor dem Dialog (kleinerer
  // Index in elementsFromPoint), malt Mia ueber dem Dialog. Ist die Flaeche schon verborgen, steht der Host nicht mehr in der Liste: dann
  // gilt, dass der Dialog dort noch zuoberst liegt (der Stand der letzten Pruefung), sonst flackerte sie oder kaeme nie zurueck.
  function pruefeDialoge(): void {
    const h = host;
    if (!h) return;
    const dialoge = holeDialoge();
    const de = document.documentElement;
    const fenster: Rk = { l: 0, t: 0, r: de.clientWidth, b: de.clientHeight };
    for (const f of flaechen.values()) {
      if (!f.ui) {
        f.zugedeckt = false;
        continue;
      }
      if (!f.geladen) continue; // Stand behalten: nach einem Formatwechsel nicht kurz ueber dem Dialog erscheinen
      let zu = false;
      if (dialoge.length > 0) {
        const q = f.el.getBoundingClientRect();
        const rf = schnitt({ l: q.left, t: q.top, r: q.right, b: q.bottom }, fenster);
        if (!leer(rf)) {
          for (const d of dialoge) {
            if (d.el.contains(f.el) || f.el.contains(d.el)) continue;
            const sch = schnitt(rf, { l: d.rect.left, t: d.rect.top, r: d.rect.right, b: d.rect.bottom });
            if (leer(sch)) continue;
            let liste: Element[];
            try {
              liste = document.elementsFromPoint((sch.l + sch.r) / 2, (sch.t + sch.b) / 2);
            } catch {
              continue;
            }
            const di = liste.findIndex((e) => e === d.el || d.el.contains(e));
            if (di < 0) continue; // der Dialog trifft dort nichts (durchsichtig fuer Zeiger) oder liegt unter etwas anderem
            // Getroffen: Mia verbirgt sich, egal ob ihr Host ueber dem Dialog laege (Stapelebene) oder gedimmt darunter (Kennzeichnung
            // waere unter der Dialogbox). Zweite Lesung K3, Fund 1 (Orchestrator).
            zu = true;
            break;
          }
        }
      }
      f.zugedeckt = zu;
    }
  }

  // Legt die Kennzeichnung in die erste Ecke des sichtbaren Teils (im Fenster), an der Mias Flaeche zuoberst liegt: oben rechts, oben links,
  // unten rechts, unten links. Liegt keine Ecke frei, an den oberen Rand des ersten unverdeckten Streifens; gibt es keinen, wird die Flaeche fuer 1 s verborgen. Nie abgeschnitten (nur umgebrochen).
  function platziereBadge(f: Flaeche, sicht: Rk, fenster: Rk): void {
    const ui = f.ui;
    const h = host;
    if (!ui || !h) return;
    // Masse der Kennzeichnung erst nach den Schreibvorgaengen lesen (Breite haengt an der Groesse der Flaeche).
    const bw0 = ui.badge.offsetWidth;
    const bh0 = ui.badge.offsetHeight;
    const ziel0 = schnitt(sicht, fenster);
    const ziel = leer(ziel0) ? sicht : ziel0;
    const bw = Math.min(Math.max(bw0, 20), ziel.r - ziel.l);
    const bh = Math.min(Math.max(bh0, 10), ziel.b - ziel.t);
    const ecken: Array<{ l: number; t: number }> = [
      { l: ziel.r - bw, t: ziel.t },
      { l: ziel.l, t: ziel.t },
      { l: ziel.r - bw, t: ziel.b - bh },
      { l: ziel.l, t: ziel.b - bh },
    ];
    const frei = (l: number, t: number): boolean => {
      try {
        const x = l + bw / 2;
        const y = t + bh / 2;
        if (x < 0 || y < 0 || x >= fenster.r || y >= fenster.b) return true; // ausserhalb des Fensters sieht es niemand: nicht pruefbar
        const oben = document.elementsFromPoint(x, y)[0];
        return oben === h;
      } catch {
        return true;
      }
    };
    let wahl = ecken.find((e) => frei(e.l, e.t));
    if (!wahl) {
      // Keine Ecke frei: erster unverdeckter Streifen von oben (Schritt: Hoehe der Kennzeichnung).
      for (let t = ziel.t; t + bh <= ziel.b; t += Math.max(4, bh)) {
        if (frei(ziel.r - bw, t)) {
          wahl = { l: ziel.r - bw, t };
          break;
        }
      }
    }
    if (!wahl) {
      // Keine freie Stelle: lieber ganz weg als ein Bild ohne Kennzeichnung (Mozilla). Nach 1 s neuer Versuch.
      f.ohneKennzeichnungBis = performance.now() + 1000;
      ui.knoten.style.display = 'none';
      return;
    }
    f.ohneKennzeichnungBis = 0;
    const w = wahl;
    ui.badge.style.left = `${Math.max(0, w.l - sicht.l)}px`;
    ui.badge.style.top = `${Math.max(0, w.t - sicht.t)}px`;
  }

  // ---------- Testhaken (nur Testbau) ----------
  function schreibeTest(): void {
    if (!TESTHAKEN) return;
    try {
      const rk = (b: DOMRect) => ({ l: b.left, t: b.top, w: b.width, h: b.height });
      const daten = {
        aktiv,
        adHost: adHostModus,
        erwachsen,
        aufruf,
        flaechen: [...flaechen.values()].map((f) => {
          const box = f.ui?.knoten.getBoundingClientRect();
          const voll = f.ui?.bild.getBoundingClientRect();
          const bd = f.ui?.badge.getBoundingClientRect();
          return {
            nr: f.nr,
            format: f.format,
            tag: f.el.tagName,
            id: f.el.id,
            bildName: f.bildName,
            link: f.link,
            ziel: f.ui?.link.target ?? '',
            rel: f.ui?.link.rel ?? '',
            kennzeichnung: f.kennzeichnung,
            fest: f.fest,
            bildMs: f.bildMs,
            sichtbar: !!f.ui && f.geladen && f.ui.knoten.style.display !== 'none',
            box: box ? rk(box) : null,
            voll: voll ? rk(voll) : null,
            badge: bd
              ? { ...rk(bd), schrift: parseFloat(getComputedStyle(f.ui!.badge).fontSize), abgeschnitten: f.ui!.badge.scrollWidth > f.ui!.badge.clientWidth + 1 || f.ui!.badge.scrollHeight > f.ui!.badge.clientHeight + 1, klickbar: !!f.ui!.badge.closest('a') }
              : null,
            hinweis: f.ui?.knoten.title ?? '',
          };
        }),
      };
      document.documentElement.setAttribute(ATTR_TEST, JSON.stringify(daten));
    } catch {
      // Dokument weg
    }
  }

  // ---------- Anmeldung ----------
  const abmelden = beiEinstellungsAenderung((neu) => {
    einstellungenGehoert = true;
    einstellungen = neu;
    pruefeLage();
    // Das Ende einer lokalen Pause setzt der Pause-Vertrag in derselben Meldung zurueck: danach noch einmal bewerten.
    setTimeout(() => lebt() && pruefeLage(), 0);
  });
  const packHoerer = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
    if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aenderungen)) return;
    packGehoert = true;
    pack = kurzAusRoh(aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue);
    sichereEinstellungen();
    pruefeLage();
  };
  browser.storage.onChanged.addListener(packHoerer);
  const lokalAb = beiLokalerPause(() => {
    // Pause im Riegel oder in der Galerie: sofort alles zurueck, auch ohne Antwort des Hintergrunds.
    if (!lebt()) return;
    beende();
  });
  const adresse = new AdressBeobachter(
    () => location.href,
    () => lebt() && pruefeLage(),
  );

  ladePackKurz()
    .catch(() => null)
    .then((p) => {
      if (!packGehoert) pack = p;
      sichereEinstellungen();
      pruefeLage();
    });

  ctx.onInvalidated(() => {
    abgebaut = true;
    beende();
    adresse.stopp();
    lokalAb();
    if (tabFrist) clearTimeout(tabFrist);
    for (const typ of [...KLICKS, ...LOESEN, ...TASTEN]) window.removeEventListener(typ, schutz, true);
    try {
      if (inhaltHoererAn) browser.runtime.onMessage.removeListener(beiInhaltNachricht);
      document.removeEventListener('visibilitychange', beiSichtbarkeit);
      abmelden();
      browser.storage.onChanged.removeListener(packHoerer);
    } catch {
      // Kontext weg
    }
  });
}
