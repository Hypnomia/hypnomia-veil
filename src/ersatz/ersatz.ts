// Komplett-Ersatz als Galerie in der Seite (Auftrag G, Session 8, Entscheidung 107): auf Listen-Domains und eigenen Seiten zeigt das
// Content-Script der obersten Seite die Mia-Galerie selbst; die Seite wird geladen, aber nichts davon gezeigt. Keine Umleitung, keine
// fuer Webseiten abrufbare Erweiterungsseite. Einstieg `starteErsatz(ctx)`, einmal je Frame aus entrypoints/content/index.ts, VOR dem Schleier.
//
// Ablauf:
// 1. Frueh verdecken: steht die Adresse schon ohne Einstellungen auf der Liste, setzt der Start synchron html[data-veil-ersatz] (leerer Wert,
//    Fruehphase ohne eigene Farbe; entrypoints/content/style.css verdeckt die Seite). Eigene Seiten sind erst nach dem Laden bekannt.
// 2. Einstellungen und Pack laden, bewerten (src/ersatz/bedingung.ts): gilt der Ersatz, kommt die Galerie (Wert "galerie", jetzt mit Rosa);
//    sonst faellt das Attribut sofort. Laden die Einstellungen nicht binnen 3 s, faellt es ebenfalls (der Schleier schuetzt die Bilder weiter).
// 3. Pause (Knopf, Popup, anderer Tab, lokales Signal), Schalter aus, Pack weg, Ausnahme: Galerie sofort weg. Pause ist immer frei.
// Wache, solange die Galerie steht: holt Attribut, Host, Lage und Popover zurueck (Entfernen, Austausch des Wurzelelements durch
// document.open oder Neurendern, Inline-Aenderungen am Host), schliesst modale Dialoge und Vollbild der Seite, holt den Host nach oben, wenn
// ein anderes Popover aufgeht. Die Rettungen laufen im Takt der Blitz-Grenze und im gleitenden Fenster (hoechstens 30 je Minute). Danach
// gibt die Galerie bewusst auf und die Seite zeigt sich: ein Zaehler, der nie sinkt, wuerde eine lange offene Seite irgendwann ohne Schutz
// lassen, und eine Seite, die den Host im Kreis entfernt, soll den Tab nicht festhalten (kein echter Lock, CLAUDE.md Regel 9).
// Medien: Anhalten im Dokument (medien.ts) plus der ganze Tab stumm ueber den Hintergrund (Nachricht `ersatz-stumm`, antwortet er nicht,
// ist die Seite bei Pause trotzdem sofort sichtbar). Klicks und Tasten in der Galerie erreichen die Seite nie (schutz.ts).
// Blitz-Grenze: Erscheinen und Verschwinden zaehlen als vollflaechige Wechsel (WechselZaehler); das Verschwinden geschieht immer sofort.
import { aendereEinstellungen, ladeEinstellungen, SPEICHER_SCHLUESSEL, type Einstellungen } from '../einstellungen';
import { beiLokalerPause, istLokalePause, meldeLokalePause } from '../pause-lokal';
import { PACK_SPEICHER_SCHLUESSEL, ladePackKurz, type PackKurz } from '../pack/vertrag';
import type { KontextLeicht } from '../schleier/schleier';
import { WechselZaehler, ersatzGilt, frueherKandidat } from './bedingung';
import { Galerie } from './galerie';
import { MedienStopp } from './medien';
import { Schutz } from './schutz';

export const ATTR_ERSATZ = 'data-veil-ersatz';
const STUFE_FRUEH = '';
const STUFE_GALERIE = 'galerie';
const LADE_FRIST_MS = 3000;
const MAX_RETTUNGEN_JE_MINUTE = 30;
const RAEUME_AB_WURZELN = 200; // ab dieser Zahl gemerkter Wurzeln raeumen wir tote und abgehaengte aus
const FENSTER_RETTUNG_MS = 60_000;

// Steht die Verdeckung gerade (Fruehphase oder Galerie)? Andere Teile (Player-Riegel) ruhen dann.
export function ersatzSteht(): boolean {
  try {
    return document.documentElement?.hasAttribute(ATTR_ERSATZ) === true;
  } catch {
    return false;
  }
}

export function starteErsatz(ctx: KontextLeicht): void {
  // Nur die oberste Seite, nie ein Rahmen; nur http und https.
  if (window.top !== window) return;
  if (location.protocol !== 'http:' && location.protocol !== 'https:') return;

  const zaehler = new WechselZaehler(() => performance.now());
  const medien = new MedienStopp();
  const schutz = new Schutz(pausiere);
  let abgebaut = false;
  let verdeckt = false; // Attribut soll stehen
  let stumm = false; // Tab wurde stumm geschaltet
  let galerie: Galerie | null = null;
  let geladen = false;
  let ladeLauf = 0;
  let spaeter: ReturnType<typeof setTimeout> | undefined;
  let hochUhr: ReturnType<typeof setTimeout> | undefined;
  let trenneWache: (() => void) | null = null;
  let rettungGeplant = false;
  const rettungen: number[] = [];
  // Shadow Roots der Seite (Meldung `veil-wurzel` des Hakens in der Seitenwelt): modale Dialoge darin schliesst die Wache ebenfalls.
  const wurzeln = new Set<WeakRef<ShadowRoot>>();
  const wurzelMerk = new WeakSet<ShadowRoot>();
  let offenBeobachter: MutationObserver | null = null;
  let sammeln = frueherKandidat(location.href);

  const lebt = () => !abgebaut && ctx.isValid;

  function setzeVerdeckt(an: boolean, stufe: string = STUFE_FRUEH): void {
    if (verdeckt !== an) {
      verdeckt = an;
      zaehler.merke();
    }
    const wurzel = document.documentElement;
    if (!wurzel) return;
    if (an) {
      if (wurzel.getAttribute(ATTR_ERSATZ) !== stufe) wurzel.setAttribute(ATTR_ERSATZ, stufe);
    } else wurzel.removeAttribute(ATTR_ERSATZ);
  }

  function meldeStumm(an: boolean, abgang = false): void {
    if (stumm === an) return;
    stumm = an;
    try {
      void Promise.resolve(browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'ersatz-stumm', an, abgang })).catch(() => undefined);
    } catch {
      // Kontext weg oder kein Hintergrund: das Anhalten im Dokument bleibt
    }
  }

  // Alles weg: Galerie, Medien, Wache, Verdeckung. Sofort, ohne Warten (Pause ist immer frei).
  function loese(): void {
    clearTimeout(spaeter);
    clearTimeout(hochUhr);
    spaeter = undefined;
    hochUhr = undefined;
    trenneWache?.();
    trenneWache = null;
    const g = galerie;
    galerie = null;
    schutz.setzeZiel(null);
    schutz.entferne(); // ohne Galerie haengt nichts auf window
    g?.entferne();
    medien.stoppe();
    meldeStumm(false);
    setzeVerdeckt(false);
  }

  function zeigeJetzt(): void {
    try {
      clearTimeout(spaeter);
      spaeter = undefined;
      setzeVerdeckt(true, STUFE_GALERIE);
      medien.starte();
      meldeStumm(true);
      if (!galerie) {
        galerie = new Galerie({ hostname: location.hostname, lebt });
        const g = galerie;
        schutz.setzeZiel({ host: g.host, istPauseKlick: (e) => g.istPauseKlick(e) });
        rettungen.length = 0;
      }
      schutz.installiere();
      if (!galerie.zeige()) return;
      void galerie.ladeBilder().catch(() => undefined);
      wache();
    } catch {
      // Fehler beim Aufbau: die Verdeckung darf nicht stehen bleiben
      loese();
    }
  }

  // ----- Wache -----
  function istOk(g: Galerie): boolean {
    const w = document.documentElement;
    return !!w && w.getAttribute(ATTR_ERSATZ) === STUFE_GALERIE && g.host.parentNode === w && g.steht() && g.lageOk();
  }

  function beobachteWurzel(w: ShadowRoot): void {
    try {
      offenBeobachter?.observe(w, { subtree: true, attributes: true, attributeFilter: ['open', 'popover'] });
    } catch {
      // Wurzel nicht mehr beobachtbar
    }
  }

  // Wie player.ts: die Wurzel des gemeldeten Hosts, auch eine geschlossene (ueber die Erweiterungs-Schnittstelle).
  // Ehrliche Luecken: deklarative Shadow Roots (template shadowrootmode) meldet der Haken nicht; ob Chrome geschlossene Wurzeln ueber die
  // Erweiterungs-Schnittstelle herausgibt, ist nicht geprueft; auf eigenen Seiten, die erst nach dem Laden der Einstellungen als Kandidat
  // gelten, fehlen Wurzeln, die vorher entstanden sind.
  function beiWurzelHinweis(e: Event): void {
    // Gesammelt wird nur, wo der Ersatz in Frage kommt (Liste oder Ersatz gilt), sonst wuchse die Liste auf jeder Seite ohne Zweck.
    if (!sammeln) return;
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
    if (wurzeln.size > RAEUME_AB_WURZELN) {
      for (const ref of wurzeln) if (!ref.deref()?.host.isConnected) wurzeln.delete(ref);
    }
    beobachteWurzel(w);
    // Nur raeumen, wenn die Galerie wirklich steht (ein gefaelschter Hinweis der Seite darf keine Dialoge schliessen).
    if (galerie && trenneWache !== null && istOk(galerie)) raeumeAuf();
  }
  document.addEventListener('veil-wurzel', beiWurzelHinweis, true);

  // Schliesst, was sich ueber die Galerie legen oder sie lahmlegen wuerde: modale Dialoge (machen sie inert), Vollbild; ein anderes
  // offenes Popover holt die Galerie danach wieder nach oben.
  function raeumeAuf(): void {
    const g = galerie;
    if (!g || !lebt()) return;
    try {
      for (const d of document.querySelectorAll<HTMLDialogElement>('dialog[open]')) if (d.matches(':modal')) d.close();
    } catch {
      // :modal unbekannt oder Dialog im Umbau
    }
    for (const ref of wurzeln) {
      const w = ref.deref();
      if (!w) {
        wurzeln.delete(ref);
        continue;
      }
      try {
        for (const d of w.querySelectorAll<HTMLDialogElement>('dialog[open]')) if (d.matches(':modal')) d.close();
      } catch {
        // :modal unbekannt oder Dialog im Umbau
      }
    }
    try {
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
    } catch {
      // egal
    }
    try {
      const fremd = [...document.querySelectorAll('[popover]:popover-open')].some((p) => p !== g.host);
      if (fremd) holeHoch(g);
    } catch {
      // :popover-open unbekannt
    }
  }

  // Wieder in die oberste Ebene, im Takt der Blitz-Grenze (der Host wird kurz geschlossen und neu geoeffnet; die Seite bleibt verdeckt).
  function holeHoch(g: Galerie): void {
    if (hochUhr) return;
    hochUhr = setTimeout(() => {
      hochUhr = undefined;
      if (!lebt() || galerie !== g) return;
      zaehler.merke();
      g.holeNachOben();
    }, Math.max(0, zaehler.erscheinenIn()));
  }

  function planeRettung(): void {
    if (rettungGeplant || !galerie || !lebt()) return;
    const g = galerie;
    if (istOk(g)) return;
    rettungGeplant = true;
    // Das Verschwinden (durch die Seite) zaehlt als Wechsel; das Wiederherstellen ist ein Erscheinen und wartet nur, wenn die Blitz-Grenze
    // es verlangt. Das erste Mal geschieht es sofort: die Seite soll nicht laenger als noetig unverdeckt stehen.
    zaehler.merke();
    const warte = Math.max(0, zaehler.erscheinenIn());
    setTimeout(() => {
      rettungGeplant = false;
      if (!lebt() || galerie !== g || istOk(g)) return;
      const jetzt = performance.now();
      while (rettungen.length > 0 && jetzt - rettungen[0]! > FENSTER_RETTUNG_MS) rettungen.shift();
      if (rettungen.length >= MAX_RETTUNGEN_JE_MINUTE) return loese();
      rettungen.push(jetzt);
      zaehler.merke();
      try {
        setzeVerdeckt(true, STUFE_GALERIE);
        g.legeLage();
        g.zeige();
        schutz.installiere(); // document.open loescht die Listener auf window und document
        wache(); // neues Wurzelelement: Beobachter umhaengen
      } catch {
        loese();
      }
    }, warte);
  }

  function wache(): void {
    trenneWache?.();
    trenneWache = null;
    const g = galerie;
    const wurzel = document.documentElement;
    if (!g || !wurzel) return;
    const beob = new MutationObserver(planeRettung);
    beob.observe(document, { childList: true }); // Wurzelelement ausgetauscht (document.open, Neurendern)
    beob.observe(wurzel, { childList: true, attributes: true, attributeFilter: [ATTR_ERSATZ] });
    const hostBeob = new MutationObserver(planeRettung); // Inline-Werte, Popover-Attribut des Hosts
    hostBeob.observe(g.host, { attributes: true });
    const offenBeob = new MutationObserver(raeumeAuf); // Dialoge und Popover der Seite
    offenBeob.observe(wurzel, { subtree: true, attributes: true, attributeFilter: ['open', 'popover'] });
    offenBeobachter = offenBeob;
    for (const ref of wurzeln) {
      const w = ref.deref();
      if (w) beobachteWurzel(w);
    }
    const beiToggle = (e: Event): void => {
      const neu = (e as Event & { newState?: string }).newState;
      if (e.target === g.host) {
        if (neu === 'closed') planeRettung();
      } else if (neu === 'open') raeumeAuf();
    };
    document.addEventListener('toggle', beiToggle, true);
    document.addEventListener('fullscreenchange', raeumeAuf, true);
    trenneWache = () => {
      beob.disconnect();
      hostBeob.disconnect();
      offenBeob.disconnect();
      if (offenBeobachter === offenBeob) offenBeobachter = null;
      document.removeEventListener('toggle', beiToggle, true);
      document.removeEventListener('fullscreenchange', raeumeAuf, true);
    };
  }

  // ----- Bewerten -----
  function bewerte(e: Einstellungen, pack: PackKurz | null): void {
    if (!lebt()) return;
    const gilt = !istLokalePause(e) && ersatzGilt(e, pack, { href: location.href, hostname: location.hostname, pathname: location.pathname });
    if (!gilt) {
      loese();
      return;
    }
    sammeln = true;
    if (galerie) return; // steht schon
    // Schon verdeckt (frueh erkannt): kein weiterer Wechsel. Sonst ist das Erscheinen ein vollflaechiger Wechsel und wartet ggf. auf die Grenze.
    const warte = verdeckt ? 0 : zaehler.erscheinenIn();
    if (warte > 0) {
      clearTimeout(spaeter);
      spaeter = setTimeout(() => void lade(), warte + 5);
      return;
    }
    zeigeJetzt();
  }

  async function lade(): Promise<void> {
    const mein = ++ladeLauf;
    let e: Einstellungen;
    let pack: PackKurz | null;
    try {
      [e, pack] = await Promise.all([ladeEinstellungen(), ladePackKurz()]);
    } catch {
      return; // die Frist unten raeumt auf
    }
    if (mein !== ladeLauf || !lebt()) return;
    geladen = true;
    clearTimeout(fristUhr);
    bewerte(e, pack);
  }

  function pausiere(): void {
    // Zuerst lokal und sofort (die Seite ist gleich zu sehen; das gemeinsame Signal gibt auch Titel und Player frei), dann festhalten.
    meldeLokalePause();
    loese();
    void aendereEinstellungen({ pause: true }).catch(() => undefined);
  }

  // ----- Start -----
  if (frueherKandidat(location.href)) setzeVerdeckt(true, STUFE_FRUEH);
  const fristUhr = setTimeout(() => {
    if (!geladen && lebt()) loese();
  }, LADE_FRIST_MS);

  const beiAenderung = (aenderungen: Record<string, unknown>, bereich: string): void => {
    if (bereich === 'local' && (SPEICHER_SCHLUESSEL in aenderungen || PACK_SPEICHER_SCHLUESSEL in aenderungen)) void lade();
  };
  // Zuerst anmelden, dann laden: eine Aenderung dazwischen geht sonst verloren.
  browser.storage.onChanged.addListener(beiAenderung);
  // Lokale Pause (Riegel, Player oder dieser Knopf): Galerie sofort weg, ohne auf den Speicher zu warten.
  const meldeAb = beiLokalerPause(loese);
  // Seite verlassen ohne Pause (Adresse, Zurueck, Schliessen): Tab wieder laut. Aus dem Seitencache zurueck (pageshow): wieder stumm.
  const beiPagehide = () => meldeStumm(false, true);
  const beiPageshow = () => {
    if (galerie) meldeStumm(true);
  };
  window.addEventListener('pagehide', beiPagehide);
  window.addEventListener('pageshow', beiPageshow);
  void lade();

  ctx.onInvalidated(() => {
    abgebaut = true;
    window.removeEventListener('pagehide', beiPagehide);
    window.removeEventListener('pageshow', beiPageshow);
    document.removeEventListener('veil-wurzel', beiWurzelHinweis, true);
    meldeAb();
    clearTimeout(fristUhr);
    try {
      browser.storage.onChanged.removeListener(beiAenderung);
    } catch {
      // Kontext schon weg
    }
    loese();
    schutz.entferne();
  });
}
