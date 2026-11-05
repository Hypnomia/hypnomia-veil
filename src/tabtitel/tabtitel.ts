// Tab-Titel (Auftrag K1, Phase 5 Session 10, PHASE-5-AUFTRAEGE-SESSION-10.md Abschnitt 3): verlaesst die Person den Tab, traegt er einen Satz
// von Mia als Titel; kommt sie zurueck, steht dort sofort wieder der Titel der Seite.
// Nur oberste Seite, nur mit Pack (`kontrolle:tabtitel`, Satz-Gruppe `tabtitel`) und eigenem Schalter. Verandert wird ausschliesslich der Text des
// vorhandenen title-Elements (ueber document.title); gibt es keines, legt dieses Modul keines an. Kein weiteres Element, kein Attribut an der Seite
// (ausser dem Testabbild im Testbau).
import { ladeEinstellungen, beiEinstellungsAenderung, type Einstellungen } from '../einstellungen';
import { meldeTabtitelErsetzer } from '../kontrolle/dokumenttitel';
import { istOberstesFenster, kontrolleErlaubt } from '../kontrolle/gemeinsam';
import type { AntwortPackDaten, NachrichtHintergrundPackDaten } from '../nachrichten';
import { PACK_SPEICHER_SCHLUESSEL, ladePackKurz, type PackKurz } from '../pack/vertrag';
import { beiLokalerPause } from '../pause-lokal';
import { pruefeTexte } from '../quiz/vertrag';
import { AdressBeobachter } from '../schleier/adresse';
import { TESTHAKEN } from '../schleier/konstanten';
import type { KontextLeicht } from '../schleier/schleier';
import { testhakenAktiv } from '../schleier/status';
import { AenderungsBremse, waehleSatz, wartezeitBisSetzen } from './logik';

const ATTR_ABBILD: string = TESTHAKEN ? 'data-veil-tabtitel' : '';
const XHTML = 'http://www.w3.org/1999/xhtml';

interface Lage {
  e: Einstellungen;
  pack: PackKurz | null;
  saetze: string[];
}

// Das title-Element der Seite im Sinne von document.title: das erste HTML-title-Element (ein SVG-title zaehlt nicht).
function titelElement(): Element | null {
  for (const el of Array.from(document.getElementsByTagName('title'))) if (el.namespaceURI === XHTML) return el;
  return null;
}

export function starteTabtitel(ctx: KontextLeicht): void {
  if (!istOberstesFenster()) return;
  let abgebaut = false;
  const lebt = (): boolean => !abgebaut && ctx.isValid;

  // ---------- Zustand ----------
  let lage: Lage | null = null;
  let neuesteE: Einstellungen | null = null;
  let ladeNr = 0;
  // Besuch im Hintergrund: `mias` ist der Satz, den Mia gesetzt hat (so, wie document.title ihn zurueckgibt), `original` der letzte Titel der Seite.
  let mias: string | null = null;
  let original: string | null = null;
  let aufgegeben = false;
  let letzterSatz: string | null = null;
  let zuletztGesetzt: number | null = null;
  let setzTimer: ReturnType<typeof setTimeout> | null = null;
  const bremse = new AenderungsBremse();
  let nr = 0;
  let setzungen = 0;
  let aenderungen = 0;
  let letzteLatenzMs: number | null = null;

  const abbild = (grund: string): void => {
    if (!TESTHAKEN || !testhakenAktiv()) return;
    nr++;
    try {
      document.documentElement.setAttribute(ATTR_ABBILD, JSON.stringify({ nr, grund, mias, original, aufgegeben, setzungen, aenderungen, latenzMs: letzteLatenzMs }));
    } catch {
      // Dokument weg
    }
  };

  // Absprache mit dem Titel-Modul (src/kontrolle/dokumenttitel.ts): stellt es zurueck, waehrend Mias Satz steht, uebernimmt K1 dessen Original.
  meldeTabtitelErsetzer((alt, neu) => {
    if (mias === null || original !== alt) return false;
    original = neu;
    return true;
  });

  // ---------- Bedingung ----------
  function erlaubt(): boolean {
    if (!lage || lage.saetze.length === 0) return false;
    return lage.e.kontrolle.tabtitel && kontrolleErlaubt(lage.e, lage.pack, 'kontrolle:tabtitel');
  }

  // Testbau: das kopflose Chromium kennt keine verborgenen Tabs (alle Tabs gelten als sichtbar); der Testhaken `verborgen` stellt den Zustand nach.
  let testVerborgen: boolean | null = null;
  const verborgen = (): boolean => testVerborgen ?? document.visibilityState === 'hidden';

  // ---------- Beobachter auf head und title (nur im Hintergrund) ----------
  const beobachter = new MutationObserver(() => {
    if (lebt()) pruefeTitel();
  });
  function haengeAn(): void {
    beobachter.disconnect();
    try {
      // Austausch des title-Elements oder sein spaeteres Auftauchen: Kinder von head (oder von html, solange head fehlt).
      beobachter.observe(document.head ?? document.documentElement, { childList: true });
      const el = titelElement();
      if (el) beobachter.observe(el, { childList: true, characterData: true, subtree: true });
    } catch {
      // Dokument weg
    }
  }

  // ---------- Setzen und Herstellen ----------
  function setzeMias(): void {
    if (mias === null || !titelElement()) return;
    document.title = mias; // document.title schreibt nur in das vorhandene title-Element
    zuletztGesetzt = performance.now();
    setzungen++;
    // Was die Seite beim Lesen sieht (Leerraum wird vom Getter zusammengefasst); daran erkennen wir spaeter die eigene Setzung.
    mias = document.title;
  }

  function planeSetzen(): void {
    if (setzTimer !== null) return;
    const warte = wartezeitBisSetzen(performance.now(), zuletztGesetzt);
    if (warte === 0) {
      setzeJetzt();
      return;
    }
    setzTimer = setTimeout(setzeJetzt, warte);
  }

  function setzeJetzt(): void {
    setzTimer = null;
    if (!lebt() || mias === null || aufgegeben || !verborgen() || !erlaubt()) return;
    if (titelElement() && document.title !== mias) setzeMias();
    abbild('gesetzt');
  }

  function gibAuf(): void {
    aufgegeben = true;
    mias = null;
    original = null;
    if (setzTimer !== null) clearTimeout(setzTimer);
    setzTimer = null;
    beobachter.disconnect();
    abbild('aufgegeben');
  }

  // Ein Besuch im Hintergrund beginnt (oder die Bedingungen stimmen erst jetzt): Original merken, Mias Satz setzen.
  function beginne(): void {
    if (mias !== null || aufgegeben) return;
    haengeAn();
    if (!titelElement()) return; // kein title-Element: nichts anlegen; taucht eines auf, meldet es der Beobachter
    const t = document.title;
    if (t === '') return; // Seite hat noch keinen Titel: warten, bis sie einen hat
    const satz = waehleSatz(lage!.saetze, letzterSatz, Math.random());
    if (satz === null) return;
    original = t;
    mias = satz;
    letzterSatz = satz;
    setzeMias();
    abbild('beginn');
  }

  // Die Seite hat den Titel (oder das title-Element) veraendert, waehrend der Tab verborgen ist.
  function pruefeTitel(): void {
    if (!verborgen() || aufgegeben) return;
    // Wechselt die Seite per pushState auf eine eigene Ausnahme, bemerkt das im verborgenen Tab (Firefox ohne Navigation API, Takt ruht) oft erst
    // die naechste Titel-Aenderung: dort wird die Bedingung mitgeprueft.
    if (!erlaubt()) {
      stelleHer('adresse');
      return;
    }
    haengeAn(); // auch ein neues title-Element beobachten
    if (!titelElement()) return;
    if (mias === null) {
      beginne();
      return;
    }
    const t = document.title;
    if (t === mias) return; // die eigene Setzung
    aenderungen++;
    original = t;
    if (bremse.melde(performance.now())) {
      gibAuf(); // zu viele Aenderungen: der Titel der Seite bleibt stehen, kein Wettlauf
      return;
    }
    abbild('seite-aendert');
    planeSetzen();
  }

  // Titel der Seite zurueck. Hat die Seite den Titel inzwischen selbst geaendert (noch unbemerkt), bleibt ihre Fassung stehen.
  function stelleHer(grund: string, ereignisZeit?: number): void {
    if (setzTimer !== null) clearTimeout(setzTimer);
    setzTimer = null;
    beobachter.takeRecords();
    beobachter.disconnect();
    if (mias === null) return;
    try {
      if (titelElement() && document.title === mias) document.title = original ?? '';
    } catch {
      // Dokument weg
    }
    mias = null;
    original = null;
    letzteLatenzMs = ereignisZeit === undefined ? null : Math.max(0, performance.now() - ereignisZeit);
    abbild(`zurueck:${grund}`);
  }

  // Bedingungen neu bewerten (Einstellung, Pack, Pause, Adresse): nicht mehr erlaubt = sofort zurueck, wieder erlaubt und verborgen = beginnen.
  function neuBewerten(grund: string): void {
    if (!lebt()) return;
    steuereAdresse();
    if (!erlaubt()) stelleHer(grund);
    else if (verborgen()) beginne();
  }

  // ---------- Sichtbarkeit ----------
  const beiSichtbarkeit = (ev: Event): void => {
    if (!lebt()) return;
    if (verborgen()) {
      if (erlaubt()) beginne();
    } else {
      stelleHer('sichtbar', ev.timeStamp);
      aufgegeben = false;
      bremse.zuruecksetzen();
      zuletztGesetzt = null;
    }
  };
  const beiSeitenende = (): void => stelleHer('pagehide');
  document.addEventListener('visibilitychange', beiSichtbarkeit);
  window.addEventListener('pagehide', beiSeitenende);

  // ---------- Testhaken: CustomEvent veil-test mit { tabtitel: { verborgen: boolean } } (nur Testbau, nur auf 127.0.0.1 und localhost) ----------
  const beiTestEreignis = (ev: Event): void => {
    try {
      let detail = (ev as CustomEvent).detail as unknown;
      if (typeof detail === 'string') detail = JSON.parse(detail);
      const t = (detail as { tabtitel?: { verborgen?: unknown } } | null)?.tabtitel;
      if (!t || typeof t.verborgen !== 'boolean') return;
      testVerborgen = t.verborgen;
      beiSichtbarkeit(new Event('visibilitychange'));
    } catch {
      // ungueltiges Ereignis ignorieren
    }
  };
  if (TESTHAKEN && testhakenAktiv()) document.addEventListener('veil-test', beiTestEreignis);

  // ---------- Einstellungen, Pack, Pause, Adresse ----------
  const abmeldeE = beiEinstellungsAenderung((neu) => {
    neuesteE = neu;
    if (lage) lage = { ...lage, e: neu };
    neuBewerten('einstellung');
  });
  const lokalAb = beiLokalerPause(() => neuBewerten('pause'));
  const packHoerer = (aend: Record<string, unknown>, bereich: string): void => {
    if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aend)) return;
    lage = null; // Pack geaendert oder weg: sofort zurueck, danach neu lesen
    neuBewerten('pack');
    void lade();
  };
  browser.storage.onChanged.addListener(packHoerer);
  const adresse = new AdressBeobachter(
    () => location.href,
    () => neuBewerten('adresse'),
  );
  // Nur solange es eigene Ausnahmen gibt (nur dann kann ein Adresswechsel per pushState etwas aendern), wie im Schleier.
  const steuereAdresse = (): void => {
    if (lage && lage.e.ausnahmen.length > 0) adresse.start();
    else adresse.stopp();
  };

  // ---------- Saetze und Lage lesen ----------
  let saetzeCache: { schluessel: string; saetze: string[] } | null = null;
  async function holeSaetze(pack: PackKurz): Promise<string[]> {
    const schluessel = `${pack.id}|${pack.version}|${pack.importiert}`;
    if (saetzeCache?.schluessel === schluessel) return saetzeCache.saetze;
    try {
      const n: NachrichtHintergrundPackDaten = { ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' };
      const a = (await browser.runtime.sendMessage(n)) as AntwortPackDaten | undefined;
      if (!a || a.ok !== true || !a.daten) return [];
      const s = pruefeTexte(a.daten)?.gruppen.tabtitel ?? [];
      saetzeCache = { schluessel, saetze: s };
      return s;
    } catch {
      return [];
    }
  }

  async function lade(): Promise<void> {
    const mein = ++ladeNr;
    let e: Einstellungen;
    let pack: PackKurz | null;
    try {
      [e, pack] = await Promise.all([ladeEinstellungen(), ladePackKurz()]);
    } catch {
      return;
    }
    const saetze = pack ? await holeSaetze(pack) : [];
    if (mein !== ladeNr || !lebt()) return;
    lage = { e: neuesteE ?? e, pack, saetze };
    neuBewerten('geladen');
  }
  void lade();

  ctx.onInvalidated(() => {
    abgebaut = true;
    meldeTabtitelErsetzer(null);
    // Zuletzt noch den Titel der Seite zurueck (das Modul geht weg, der Satz darf nicht stehen bleiben).
    stelleHer('kontext');
    document.removeEventListener('visibilitychange', beiSichtbarkeit);
    window.removeEventListener('pagehide', beiSeitenende);
    if (TESTHAKEN) document.removeEventListener('veil-test', beiTestEreignis);
    adresse.stopp();
    lokalAb();
    try {
      abmeldeE();
      browser.storage.onChanged.removeListener(packHoerer);
    } catch {
      // Kontext weg
    }
  });
}
