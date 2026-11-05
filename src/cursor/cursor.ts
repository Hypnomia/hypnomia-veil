// Mauszeiger (Auftrag K2, Phase 5 Session 10, Entscheidung 116): mit Pack ist der Zeiger Mias kleine pinke Spirale (Standard) oder ihr Herz.
// Laeuft in jedem Frame. Wirkung ausschliesslich ueber ein eigenes CSSStyleSheet in `document.adoptedStyleSheets`: es entsteht KEIN Element im
// DOM der Seite. Offene Shadow Roots bekommen ein zweites Blatt, sobald die Maus sie beruehrt (mouseover, elementFromPoint; kein Durchsuchen des
// DOM, kein Takt). Ersetzt die Seite adoptedStyleSheets, haengt das Modul sein Blatt bei Fokus, Sichtbarkeit, Einstellungsaenderung oder dem
// naechsten mouseover (hoechstens alle 500 ms geprueft) wieder an. Geschlossene Shadow Roots erreicht das Modul nicht (sie erben den Zeiger vom
// Host, nur eigene cursor-Regeln darin, etwa pointer an Knoepfen, bleiben).
// Firefox: ein im Content-Script gebautes Blatt darf dort unter Umstaenden nicht ans Dokument; Rueckfall ist ein Blatt aus der Seitenwelt
// (wrappedJSObject). Ein <style>-Element gibt es nie.
import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import { beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../einstellungen';
import { kontrolleErlaubt, istOberstesFenster } from '../kontrolle/gemeinsam';
import { istFuer, type AntwortTab, type NachrichtHintergrundTab, type NachrichtInhalt } from '../nachrichten';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, kurzAusRoh, ladePackKurz, type PackKurz } from '../pack/vertrag';
import { beiLokalerPause } from '../pause-lokal';
import { TAB_FRIST_MS } from '../schleier/konstanten';
import type { KontextLeicht } from '../schleier/schleier';
import { zeigerCss, type ZeigerArt } from './logik';

const PRUEF_ABSTAND_MS = 500;

type Blatt = { blatt: CSSStyleSheet; seitenwelt: boolean };

// Baut ein Blatt; erst im Content-Script, sonst in der Seitenwelt (Firefox).
function baueBlatt(css: string): Blatt | null {
  try {
    const b = new CSSStyleSheet();
    b.replaceSync(css);
    // Probe: laesst das Dokument das Blatt zu?
    document.adoptedStyleSheets = [...document.adoptedStyleSheets, b];
    document.adoptedStyleSheets = document.adoptedStyleSheets.filter((x) => x !== b);
    return { blatt: b, seitenwelt: false };
  } catch {
    // weiter mit der Seitenwelt
  }
  try {
    const S = (window as unknown as { wrappedJSObject?: { CSSStyleSheet: new () => CSSStyleSheet } }).wrappedJSObject?.CSSStyleSheet;
    if (!S) return null;
    const b = new S();
    b.replaceSync(css);
    return { blatt: b, seitenwelt: true };
  } catch {
    return null;
  }
}

type MitBlaettern = { adoptedStyleSheets: CSSStyleSheet[] };
function ziel(wurzel: Document | ShadowRoot, seitenwelt: boolean): MitBlaettern {
  if (!seitenwelt) return wurzel as unknown as MitBlaettern;
  const w = (wurzel as unknown as { wrappedJSObject?: MitBlaettern }).wrappedJSObject;
  return w ?? (wurzel as unknown as MitBlaettern);
}
// Seitenwelt-Blaetter (Firefox): die Liste gehoert der Seite, das Content-Script darf sie nicht durchlaufen oder ersetzen, aber veraendern
// (push, splice, indexOf wirken auf dem ObservableArray der Seite).
function haengeAn(wurzel: Document | ShadowRoot, b: Blatt): void {
  const z = ziel(wurzel, b.seitenwelt);
  if (b.seitenwelt) {
    if (z.adoptedStyleSheets.indexOf(b.blatt) < 0) z.adoptedStyleSheets.push(b.blatt);
    return;
  }
  if (!z.adoptedStyleSheets.includes(b.blatt)) z.adoptedStyleSheets = [...z.adoptedStyleSheets, b.blatt];
}
function loese(wurzel: Document | ShadowRoot, b: Blatt): void {
  try {
    const z = ziel(wurzel, b.seitenwelt);
    if (b.seitenwelt) {
      const i = z.adoptedStyleSheets.indexOf(b.blatt);
      if (i >= 0) z.adoptedStyleSheets.splice(i, 1);
    } else if (z.adoptedStyleSheets.includes(b.blatt)) z.adoptedStyleSheets = z.adoptedStyleSheets.filter((x) => x !== b.blatt);
  } catch {
    // Dokument weg
  }
}

export function starteCursor(ctx: KontextLeicht): void {
  let abgebaut = false;
  const lebt = () => !abgebaut && ctx.isValid;
  const istRahmen = !istOberstesFenster();

  let einstellungen: Einstellungen | null = null;
  let einstellungenGehoert = false;
  let ladeLaeuft = false;
  let pack: PackKurz | null = null;
  let packGehoert = false;

  let dokBlatt: Blatt | null = null;
  let wurzelBlatt: Blatt | null = null;
  let art: ZeigerArt | null = null;
  const wurzeln = new Set<WeakRef<ShadowRoot>>();
  const bekannt = new WeakSet<ShadowRoot>();
  let letztePruefung = -Infinity;

  // Tab-Adresse (nur Rahmen): eigene Ausnahmen gelten je Tab.
  let tabAdresse: URL | null = null;
  let tabBekannt = false;
  let tabFrageLaeuft = false;
  let inhaltHoererAn = false;
  let tabFrist: ReturnType<typeof setTimeout> | null = null;

  function entferne(): void {
    if (dokBlatt) {
      try {
        dokBlatt.blatt.replaceSync('');
      } catch {
        // egal
      }
      loese(document, dokBlatt);
    }
    if (wurzelBlatt) {
      for (const r of wurzeln) {
        const w = r.deref();
        if (w) loese(w, wurzelBlatt);
      }
      try {
        wurzelBlatt.blatt.replaceSync('');
      } catch {
        // egal
      }
    }
    wurzeln.clear();
    dokBlatt = null;
    wurzelBlatt = null;
    art = null;
  }

  function setzeArt(neu: ZeigerArt): void {
    if (art === neu && dokBlatt) {
      haengeAn(document, dokBlatt);
      return;
    }
    if (!dokBlatt) {
      dokBlatt = baueBlatt(zeigerCss(neu, false));
      if (!dokBlatt) return;
    } else {
      dokBlatt.blatt.replaceSync(zeigerCss(neu, false));
    }
    if (!wurzelBlatt) wurzelBlatt = baueBlatt(zeigerCss(neu, true));
    else wurzelBlatt.blatt.replaceSync(zeigerCss(neu, true));
    art = neu;
    try {
      haengeAn(document, dokBlatt);
    } catch {
      // Dokument noch nicht bereit: der naechste Anlass versucht es wieder
    }
  }

  function sicherAngehaengt(): void {
    if (!lebt() || !dokBlatt || !art) return;
    try {
      haengeAn(document, dokBlatt);
    } catch {
      // Dokument weg
    }
  }

  function sichereEinstellungen(): void {
    if (einstellungen || ladeLaeuft || !istFreigeschaltet(pack, 'kontrolle:cursor')) return;
    ladeLaeuft = true;
    ladeEinstellungen()
      .catch(() => null)
      .then((e) => {
        ladeLaeuft = false;
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
    if (!lebt()) return;
    if (!document.hidden && einstellungen?.ausnahmen.length) void frageTab();
    if (!document.hidden) sicherAngehaengt();
  };
  const beiFokus = (): void => sicherAngehaengt();

  function steuereTab(e: Einstellungen): void {
    if (!istRahmen) return;
    if (e.ausnahmen.length > 0) {
      if (!inhaltHoererAn) {
        inhaltHoererAn = true;
        browser.runtime.onMessage.addListener(beiInhaltNachricht);
      }
      if (!tabBekannt && !tabFrageLaeuft) {
        void frageTab();
        if (!tabFrist) {
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
      tabAdresse = null;
      tabBekannt = false;
    }
  }

  function pruefeLage(): void {
    if (!lebt()) return;
    const e = einstellungen;
    if (!e) {
      entferne();
      return;
    }
    steuereTab(e);
    const wartetAufTab = istRahmen && e.ausnahmen.length > 0 && !tabBekannt;
    const tabAus = tabAdresse !== null && passtAusnahme(tabAdresse, e.ausnahmen);
    const gewaehlt = e.kontrolle.cursor;
    if (wartetAufTab || tabAus || gewaehlt === 'aus' || document.fullscreenElement || !kontrolleErlaubt(e, pack, 'kontrolle:cursor')) {
      entferne();
      return;
    }
    setzeArt(gewaehlt);
  }

  // Beruehrt die Maus eine offene Shadow Root, bekommt sie das Wurzel-Blatt; verschachtelte Wurzeln unter dem Zeiger werden ueber
  // elementFromPoint gefunden (composedPath zeigt Firefox im Content-Script die inneren Knoten nicht). Ohne offene Wurzel am Ziel kehrt der
  // Horcher sofort zurueck.
  const beiMausueber = (ev: Event): void => {
    if (!dokBlatt || !lebt()) return;
    const jetzt = performance.now();
    if (jetzt - letztePruefung > PRUEF_ABSTAND_MS) {
      letztePruefung = jetzt;
      sicherAngehaengt();
    }
    const t = ev.target as Element | null;
    if (!wurzelBlatt || !t) return;
    try {
      const m = ev as MouseEvent;
      let w: ShadowRoot | null = t.shadowRoot;
      for (let tiefe = 0; w && tiefe < 10; tiefe++) {
        if (!bekannt.has(w)) {
          bekannt.add(w);
          wurzeln.add(new WeakRef(w));
          haengeAn(w, wurzelBlatt);
        }
        w = w.elementFromPoint(m.clientX, m.clientY)?.shadowRoot ?? null;
      }
    } catch {
      // Wurzel nicht erreichbar
    }
  };
  window.addEventListener('mouseover', beiMausueber, { capture: true, passive: true });
  window.addEventListener('focus', beiFokus, { capture: true, passive: true });
  document.addEventListener('visibilitychange', beiSichtbarkeit);
  // Vollbild (Video-Player blenden den Zeiger dort mit cursor: none aus): in diesem Frame kein Blatt, beim Verlassen sofort wieder.
  const beiVollbild = (): void => pruefeLage();
  document.addEventListener('fullscreenchange', beiVollbild);

  const abmelden = beiEinstellungsAenderung((neu) => {
    einstellungenGehoert = true;
    einstellungen = neu;
    pruefeLage();
    setTimeout(() => lebt() && pruefeLage(), 0); // Ende einer lokalen Pause setzt der Pause-Vertrag in derselben Meldung zurueck
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
    if (lebt()) entferne();
  });

  ladePackKurz()
    .catch(() => null)
    .then((p) => {
      if (!packGehoert) pack = p;
      sichereEinstellungen();
      pruefeLage();
    });

  ctx.onInvalidated(() => {
    abgebaut = true;
    entferne();
    lokalAb();
    if (tabFrist) clearTimeout(tabFrist);
    window.removeEventListener('mouseover', beiMausueber, true);
    window.removeEventListener('focus', beiFokus, true);
    document.removeEventListener('visibilitychange', beiSichtbarkeit);
    document.removeEventListener('fullscreenchange', beiVollbild);
    try {
      if (inhaltHoererAn) browser.runtime.onMessage.removeListener(beiInhaltNachricht);
      abmelden();
      browser.storage.onChanged.removeListener(packHoerer);
    } catch {
      // Kontext weg
    }
  });
}
