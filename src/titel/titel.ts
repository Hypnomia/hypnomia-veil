// Titel mit Mias Kommentar (Auftrag T, Session 8, PHASE-4-BAUPLAN Abschnitt 3): Titel in Karten, auf der Videoseite und im Tab-Titel werden
// zu Mias Kommentar (Pack-Gruppe `titel` mit `{{title}}`), nur auf Listen-Seiten und eigenen Seiten (nicht am Inhalt erkannt).
// Eigenes Modul neben dem Schleier (kein Eingriff in src/schleier/schleier.ts): Stand der Seite ueber src/adapter/status.ts, Selektoren aus
// `adapterFuer(name).titel`, Pause ueber src/einstellungen.ts.
// Ablauf: Bedingungen (Einstellungen, Pack, Stand der Seite) laufen in `pruefeLage`. Gelten sie, laden wir die Saetze einmal je Pack ueber den
// Hintergrund und beobachten die Seite; jede Aenderung wird gebuendelt nachgezogen. Gelten sie nicht mehr (Pause, Ausnahme, Pack weg,
// Seite nicht mehr auf der Liste, Ende des Kontexts), stellen wir alle Originale sofort zurueck und beobachten nicht mehr.
// Texte gehen nur ueber Textknoten und Attribute (`data`, `setAttribute`), nie ueber innerHTML.
import { ersetzeTabtitelOriginal } from '../kontrolle/dokumenttitel';
import { passtAusnahme } from '../../scripts/ausnahmen-muster.mjs';
import { beiLokalerPause, istLokalePause } from '../pause-lokal';
import { adapterFuer } from '../adapter';
import { beiErwachsenStatus, erwachsenStatus } from '../adapter/status';
import { beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../einstellungen';
import type { AntwortPackDaten, NachrichtHintergrundPackDaten } from '../nachrichten';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, kurzAusRoh, ladePackKurz, type PackKurz } from '../pack/vertrag';
import { pruefeTexte, type Texte } from '../quiz/vertrag';
import { AdressBeobachter } from '../schleier/adresse';
import type { KontextLeicht } from '../schleier/schleier';
import { MARKE, TitelFrueh } from './frueh';
import { istEigenerText, TITEL_TAGS, titelMitKommentar } from './logik';

// Mindestabstand zwischen zwei Durchlaeufen (ms): bei Endlos-Scrollen und Neuaufbau durch die Seite sparsam bleiben.
const MIN_ABSTAND_MS = 80;
// Ab dieser Zahl vorgemerkter Knoten lohnt sich der Gesamtdurchlauf mehr als die Einzelpruefung.
const MAX_VORGEMERKT = 1500;
const MAX_LADEVERSUCHE = 3;
// Frist fuer die Antwort des Hintergrunds (ms): ein haengender Aufruf blockiert weitere Versuche nicht.
const LADE_FRIST_MS = 5000;
// Ab dieser Zahl Eintraege in der Merkliste raeumen wir tote und abgehaengte aus.
const RAEUME_AB = 200;

// Ein ersetzter Titel. `text`: ein oder mehrere Textknoten (der Satz steht im ersten, die uebrigen sind leer). `attr`: das Attribut `title`.
type Eintrag =
  | { art: 'text'; knoten: Text[]; originale: string[]; ersetzt: string }
  | { art: 'attr'; ziel: Element; original: string; ersetzt: string };

function adresseFuerAusnahmen(): { hostname: string; pathname: string } {
  if (location.hostname) return location;
  try {
    return new URL(document.baseURI);
  } catch {
    return { hostname: '', pathname: '/' };
  }
}

function istOberste(): boolean {
  try {
    return window === window.top;
  } catch {
    return false;
  }
}

export function starteTitel(ctx: KontextLeicht): void {
  // Titel liegen in der obersten Seite; in Rahmen laeuft dieses Modul gar nicht (Ausnahmen gelten je Tab, siehe Adresse der obersten Seite).
  if (!istOberste()) return;
  // Titel ohne Aufblitzen: auf Listen-Seiten gleich beim Start verstecken, bis die Lage entschieden ist (src/titel/frueh.ts).
  const frueh = new TitelFrueh();
  frueh.starte();
  let packFertig = false;
  let abgebaut = false;
  let einstellungen: Einstellungen | null = null;
  let pack: PackKurz | null = null;
  let einstellungenGehoert = false;
  let packGehoert = false;
  let texte: Texte | null = null;
  let texteSchluessel: string | null = null;
  let laedtSchluessel: string | null = null;
  let ladeVersuche = 0;
  let ladeTimer: ReturnType<typeof setTimeout> | null = null;
  let ladeEinstellungenLaeuft = false;

  // ---------- Merkliste der Originale ----------
  let textEintraege = new WeakMap<Text, Extract<Eintrag, { art: 'text' }>>();
  let attrEintraege = new WeakMap<Element, Extract<Eintrag, { art: 'attr' }>>();
  let elementEintraege = new WeakMap<Element, Extract<Eintrag, { art: 'text' }>>(); // letzter Titel-Eintrag je Element (Seite tauscht den Knoten aus)
  let geleert = new WeakSet<Text>(); // Textknoten, die wir fuer einen mehrteiligen Titel leer gemacht haben
  const alle = new Set<WeakRef<Eintrag>>();
  // Alles, was wir geschrieben haben: nur das gilt als unser Text, wenn die Seite es zurueckschreibt (siehe logik.ts).
  const erzeugt = new Set<string>();
  const merkeErzeugt = (t: string): void => {
    if (erzeugt.size >= 3000) erzeugt.clear();
    erzeugt.add(t);
  };
  let raeumeAb = RAEUME_AB;
  let tab: { original: string; ersetzt: string } | null = null;

  const lebt = (): boolean => !abgebaut && ctx.isValid;

  // ---------- Bedingungen ----------
  const schluesselVonPack = (p: PackKurz | null): string | null => (p ? `${p.id}|${p.version}|${p.importiert}` : null);

  // Gelten die Bedingungen fuer diese Seite (ohne die Saetze)?
  function bedingungenErfuellt(): boolean {
    const e = einstellungen;
    if (!e || e.pause || istLokalePause(e) || !e.erwachsen.an) return false;
    if (!istFreigeschaltet(pack, 'erwachsen:titel')) return false;
    // Nur Liste und eigene Seiten, nicht die am Inhalt erkannten.
    if (erwachsenStatus().liste === null) return false;
    return !passtAusnahme(adresseFuerAusnahmen(), e.ausnahmen);
  }

  const saetzeAktuell = (): readonly string[] | null => {
    const s = texte?.gruppen.titel;
    return s && s.length > 0 ? s : null;
  };

  // ---------- Saetze holen ----------
  async function holeTexte(): Promise<Texte | null> {
    try {
      const n: NachrichtHintergrundPackDaten = { ziel: 'hintergrund', typ: 'packdaten', rolle: 'texte' };
      const a = (await browser.runtime.sendMessage(n)) as AntwortPackDaten | undefined;
      if (!a || a.ok !== true || !a.daten) return null;
      // Noch einmal pruefen: nie Daten verwenden, die das Schema nicht bestehen.
      return pruefeTexte(a.daten);
    } catch {
      return null;
    }
  }

  async function ladeTexte(schluessel: string): Promise<void> {
    if (laedtSchluessel === schluessel) return;
    laedtSchluessel = schluessel;
    let fristTimer: ReturnType<typeof setTimeout> | null = null;
    const frist = new Promise<null>((ok) => {
      fristTimer = setTimeout(() => ok(null), LADE_FRIST_MS);
    });
    const geladen = await Promise.race([holeTexte(), frist]);
    if (fristTimer) clearTimeout(fristTimer);
    if (laedtSchluessel === schluessel) laedtSchluessel = null;
    if (!lebt() || schluesselVonPack(pack) !== schluessel) return;
    if (geladen) {
      // Gueltige Saetze (auch ohne Gruppe `titel`): das Ergebnis ist endgueltig; ohne Titel-Saetze gibt pruefeLage das Original frei.
      texte = geladen;
      texteSchluessel = schluessel;
      ladeVersuche = 0;
      pruefeLage();
      return;
    }
    // Keine Antwort: nichts aendern. Der Hintergrund kann gerade erst aufwachen, darum ein paar spaetere Versuche; danach gibt das Original frei.
    if (ladeVersuche >= MAX_LADEVERSUCHE) frueh.gibFrei();
    if (ladeVersuche < MAX_LADEVERSUCHE) {
      ladeVersuche++;
      if (ladeTimer) clearTimeout(ladeTimer);
      ladeTimer = setTimeout(() => {
        ladeTimer = null;
        if (lebt()) pruefeLage();
      }, 1000 * ladeVersuche);
    }
  }

  // ---------- Lage neu bewerten ----------
  function beiAenderung(): void {
    ladeVersuche = 0;
    pruefeLage();
  }

  // Der Adress-Beobachter fragt in Browsern ohne Navigation API im Takt ab: nur starten, wo es etwas zu entscheiden gibt (Pack mit Freischaltung,
  // Modus an, Seite auf der Liste, Ausnahmen mit Pfad moeglich). Pause und Ausnahme selbst stoppen ihn nicht, sonst kaeme das Ende nie an.
  function steuereAdresse(): void {
    const noetig = !!einstellungen && einstellungen.erwachsen.an && einstellungen.ausnahmen.length > 0 && istFreigeschaltet(pack, 'erwachsen:titel') && erwachsenStatus().liste !== null;
    if (noetig) adresse.start();
    else adresse.stopp();
  }

  function pruefeLage(): void {
    if (!lebt()) return;
    steuereAdresse();
    if (!bedingungenErfuellt()) {
      beendeEinsatz();
      if (frueh.istEntschieden || lageKlarOhneEinsatz()) frueh.gibFrei();
      return;
    }
    const schluessel = schluesselVonPack(pack)!;
    if (texteSchluessel !== schluessel) {
      // Anderes Pack: alte Saetze und alles, was mit ihnen ersetzt wurde, verwerfen.
      stelleZurueck();
      texte = null;
      texteSchluessel = null;
      void ladeTexte(schluessel);
      return;
    }
    if (!saetzeAktuell()) {
      beendeEinsatz();
      if (texte !== null || ladeVersuche >= MAX_LADEVERSUCHE) frueh.gibFrei();
      return;
    }
    starteBeobachter();
  }

  // Steht fest, dass hier nichts ersetzt wird (dann zeigt sich das Original sofort)? Offen bleibt es, solange Pack oder Einstellungen fehlen
  // oder nur die Listen-Zuordnung des Schleiers noch aussteht.
  function lageKlarOhneEinsatz(): boolean {
    if (!packFertig) return false;
    if (!istFreigeschaltet(pack, 'erwachsen:titel')) return true;
    const e = einstellungen;
    if (!e) return false;
    if (e.pause || istLokalePause(e) || !e.erwachsen.an) return true;
    if (passtAusnahme(adresseFuerAusnahmen(), e.ausnahmen)) return true;
    return erwachsenStatus().liste !== null;
  }

  // Pause, Ausnahme, Pack weg, Seite nicht (mehr) auf der Liste: Beobachter ab, Originale sofort zurueck.
  function beendeEinsatz(): void {
    stoppeBeobachter();
    stelleZurueck();
  }

  // ---------- Beobachter ----------
  let beobachter: MutationObserver | null = null;
  let geplant = false;
  let letzterLauf = 0;
  let planTimer: ReturnType<typeof setTimeout> | null = null;
  let gesamt = true; // naechster Durchlauf prueft die ganze Seite
  const tiefe = new Set<Node>(); // vorgemerkt: Knoten samt allem darunter
  const flache = new Set<Node>(); // vorgemerkt: nur der Knoten und seine Vorfahren (Textaenderung)

  function starteBeobachter(): void {
    if (!beobachter) {
      beobachter = new MutationObserver(beiMutationen);
      beobachter.observe(document, {
        subtree: true,
        childList: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['title'],
      });
    }
    gesamt = true;
    plane();
  }

  function stoppeBeobachter(): void {
    beobachter?.disconnect();
    beobachter = null;
    if (planTimer) clearTimeout(planTimer);
    planTimer = null;
    geplant = false;
    tiefe.clear();
    flache.clear();
    gesamt = false;
  }

  const elternElement = (k: Node): Element | null => (k instanceof Element ? k : k.parentElement);

  function beiMutationen(liste: MutationRecord[]): void {
    if (!lebt()) return;
    for (const m of liste) {
      if (m.type === 'childList') {
        for (const n of Array.from(m.addedNodes)) {
          if (n instanceof Element) tiefe.add(n);
          else if (n instanceof Text) flache.add(n);
        }
        flache.add(m.target);
      } else {
        flache.add(m.target);
      }
    }
    if (tiefe.size + flache.size > MAX_VORGEMERKT) {
      gesamt = true;
      tiefe.clear();
      flache.clear();
    }
    plane();
  }

  function plane(): void {
    if (geplant) return;
    geplant = true;
    const warte = Math.max(0, letzterLauf + MIN_ABSTAND_MS - performance.now());
    planTimer = setTimeout(durchlauf, warte);
  }

  // ---------- Durchlauf ----------
  function selektor(): string {
    const name = erwachsenStatus().liste;
    if (!name) return '';
    return (adapterFuer(name).titel ?? []).join(',');
  }

  function durchlauf(): void {
    geplant = false;
    planTimer = null;
    letzterLauf = performance.now();
    const saetze = saetzeAktuell();
    if (!lebt() || !beobachter || !saetze || !bedingungenErfuellt()) return;
    const sel = selektor();
    const ziele = new Set<Element>();
    if (sel) {
      try {
        if (gesamt) {
          document.querySelectorAll(sel).forEach((e) => ziele.add(e));
        } else {
          for (const k of tiefe) {
            if (!k.isConnected) continue;
            const el = elternElement(k);
            if (!el) continue;
            const vorfahr = el.closest(sel);
            if (vorfahr) ziele.add(vorfahr);
            el.querySelectorAll(sel).forEach((e) => ziele.add(e));
          }
          for (const k of flache) {
            if (!k.isConnected) continue;
            const vorfahr = elternElement(k)?.closest(sel);
            if (vorfahr) ziele.add(vorfahr);
          }
        }
      } catch {
        // ungueltiger Selektor: die Seite bleibt unveraendert
        ziele.clear();
      }
    }
    gesamt = false;
    tiefe.clear();
    flache.clear();
    for (const el of ziele) verarbeiteElement(el, saetze);
    // Erster Durchlauf nach der Entscheidung: Original-Tab-Titel zurueck und gleich ersetzt. Die Versteck-Regel bleibt fuer spaeter eingefuegte
    // Titel stehen (sie versteckt nur Titel ohne Marke) und faellt mit dem Ende des Einsatzes.
    frueh.stelleTitelHer();
    verarbeiteTabTitel(saetze);
    frueh.entscheide();
    raeumeMerkliste();
  }

  // Die Textknoten, die zusammen den Titel bilden: Text direkt im Element und in Betonungen und Absaetzen darunter (Titel-Tags). Fehlt der,
  // gilt der laengste Textknoten irgendwo darunter (Titel in einem span, daneben Symbole). Von uns geleerte Knoten gehoeren weiter dazu.
  function titelKnoten(el: Element): Text[] {
    const direkt: Text[] = [];
    let laengster: Text | null = null;
    let laenge = 0;
    const gang = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let n = gang.nextNode() as Text | null; n; n = gang.nextNode() as Text | null) {
      const eltern = n.parentElement;
      if (eltern && (eltern.tagName === 'SCRIPT' || eltern.tagName === 'STYLE')) continue;
      const l = (n.nodeValue ?? '').trim().length;
      if (l === 0 && !geleert.has(n)) continue;
      if (l > laenge) {
        laenge = l;
        laengster = n;
      }
      let ok = true;
      for (let p: Element | null = eltern; p && p !== el; p = p.parentElement) {
        if (!TITEL_TAGS.has(p.tagName)) {
          ok = false;
          break;
        }
      }
      if (ok) direkt.push(n);
    }
    if (direkt.some((k) => (k.nodeValue ?? '').trim() !== '')) return direkt;
    return laengster ? [laengster] : [];
  }

  // Ursprung des Tooltips (Attribut `title`): der Wert vor unserer Ersetzung. Er bestimmt den Satz auch fuer den sichtbaren Text.
  function attrUrsprung(el: Element | null): string | null {
    const wert = el?.getAttribute('title') ?? null;
    if (wert === null) return null;
    const e = attrEintraege.get(el!);
    return e && wert === e.ersetzt ? e.original : wert;
  }

  function verarbeiteElement(el: Element, saetze: readonly string[]): void {
    // Bearbeitet gilt auch ohne Kommentar: die Marke nimmt das Element aus der Versteck-Regel (src/titel/frueh.ts).
    if (!el.hasAttribute(MARKE)) el.setAttribute(MARKE, '');
    const link = el.closest('a');
    const schluessel = attrUrsprung(el) ?? (link ? attrUrsprung(link) : null) ?? undefined;
    const knoten = titelKnoten(el);
    if (knoten.length > 0) verarbeiteTexte(el, knoten, saetze, schluessel);
    // Das Attribut `title` am Element und am umgebenden Link (Tooltip). `alt` bleibt unberuehrt.
    verarbeiteAttribut(el, saetze);
    if (link && link !== el) verarbeiteAttribut(link, saetze);
  }

  const gleicheKnoten = (a: Text[], b: Text[]): boolean => a.length === b.length && a.every((k, i) => k === b[i]);

  function verarbeiteTexte(el: Element, knoten: Text[], saetze: readonly string[], schluessel: string | undefined): void {
    const erster = knoten[0]!;
    let eintrag = textEintraege.get(erster);
    const gleich = !!eintrag && gleicheKnoten(eintrag.knoten, knoten);
    if (gleich && erster.data === eintrag!.ersetzt && knoten.slice(1).every((k) => k.data === '')) return;
    // Originale: was die Seite jetzt hat; Knoten, die noch unseren Stand tragen, behalten ihr gemerktes Original.
    const originale = knoten.map((k, i) => (gleich && k.data === (i === 0 ? eintrag!.ersetzt : '') ? eintrag!.originale[i]! : k.data));
    const roh = originale.join('');
    if (istEigenerText(roh.trim(), erzeugt)) {
      // Die Seite hat unseren Text (oder einen gekuerzten Teil davon) zurueckgeschrieben: nicht noch einmal umhuellen, aber merken.
      if (gleich) eintrag!.ersetzt = erster.data;
      else {
        // Die Seite hat den Knoten ausgetauscht (textContent): das Original vom alten Eintrag des Elements uebernehmen, damit die Pause es herstellt.
        const alt = elementEintraege.get(el);
        if (alt && knoten.length === 1) {
          const e = { art: 'text' as const, knoten, originale: [alt.originale.join('')], ersetzt: erster.data };
          textEintraege.set(erster, e);
          elementEintraege.set(el, e);
          alle.add(new WeakRef<Eintrag>(e));
        }
      }
      return;
    }
    const neu = titelMitKommentar(roh, saetze, schluessel);
    if (neu === null || (knoten.length === 1 && neu === roh)) return;
    if (gleich) {
      eintrag!.originale = originale;
      eintrag!.ersetzt = neu;
    } else {
      eintrag = { art: 'text', knoten, originale, ersetzt: neu };
      textEintraege.set(erster, eintrag);
      alle.add(new WeakRef<Eintrag>(eintrag));
    }
    elementEintraege.set(el, eintrag!);
    merkeErzeugt(neu);
    erster.data = neu;
    for (let i = 1; i < knoten.length; i++) {
      knoten[i]!.data = '';
      geleert.add(knoten[i]!);
    }
  }

  function verarbeiteAttribut(el: Element, saetze: readonly string[]): void {
    const jetzt = el.getAttribute('title');
    if (jetzt === null) return;
    let eintrag = attrEintraege.get(el);
    if (eintrag && jetzt === eintrag.ersetzt) return;
    if (istEigenerText(jetzt, erzeugt)) {
      if (eintrag) eintrag.ersetzt = jetzt;
      return;
    }
    const neu = titelMitKommentar(jetzt, saetze);
    if (neu === null || neu === jetzt) return;
    if (eintrag) {
      eintrag.original = jetzt;
      eintrag.ersetzt = neu;
    } else {
      eintrag = { art: 'attr', ziel: el, original: jetzt, ersetzt: neu };
      attrEintraege.set(el, eintrag);
      alle.add(new WeakRef<Eintrag>(eintrag));
    }
    merkeErzeugt(neu);
    el.setAttribute('title', neu);
  }

  // Raeumt tote und abgehaengte Eintraege aus der Merkliste (Endlos-Scrollen, Neuaufbau durch die Seite). Die Schwelle waechst mit dem Rest mit.
  function raeumeMerkliste(): void {
    if (alle.size < raeumeAb) return;
    for (const ref of alle) {
      const e = ref.deref();
      if (!e) alle.delete(ref);
    }
    raeumeAb = Math.max(RAEUME_AB, alle.size * 2);
  }

  function verarbeiteTabTitel(saetze: readonly string[]): void {
    // Im verborgenen Tab gehoert der Titel dem Tab-Titel-Modul (K1); sonst streiten beide. Beim Sichtbarwerden stellt K1 zuerst her.
    if (document.visibilityState === 'hidden') return;
    const jetzt = document.title;
    if (tab && jetzt === tab.ersetzt) return;
    if (istEigenerText(jetzt, erzeugt)) {
      if (tab) tab.ersetzt = jetzt;
      return;
    }
    const neu = titelMitKommentar(jetzt, saetze);
    if (neu === null || neu === jetzt) return;
    merkeErzeugt(neu);
    document.title = neu;
    // Der Browser normalisiert den Titel beim Setzen; der gelesene Wert ist der, den wir wiedererkennen muessen.
    tab = { original: jetzt, ersetzt: document.title };
    merkeErzeugt(document.title);
  }

  // ---------- Zurueckstellen ----------
  // Stellt jeden Text zurueck, den wir ersetzt haben und den die Seite seither nicht selbst neu geschrieben hat.
  function stelleZurueck(): void {
    for (const ref of alle) {
      const e = ref.deref();
      if (!e) continue;
      try {
        if (e.art === 'text') {
          if (e.knoten[0]!.data === e.ersetzt) e.knoten.forEach((k, i) => (k.data = e.originale[i]!));
        } else if (e.ziel.getAttribute('title') === e.ersetzt) {
          e.ziel.setAttribute('title', e.original);
        }
      } catch {
        // ein Knoten, der nicht mehr zu retten ist, stoppt den Rest nicht
      }
    }
    alle.clear();
    textEintraege = new WeakMap();
    attrEintraege = new WeakMap();
    geleert = new WeakSet();
    elementEintraege = new WeakMap();
    erzeugt.clear();
    raeumeAb = RAEUME_AB;
    if (tab) {
      try {
        if (document.title === tab.ersetzt) document.title = tab.original;
        // Steht gerade Mias Tab-Satz (K1, verborgener Tab) und haelt K1 unsere Fassung als Original, stellt K1 spaeter unser Original her.
        else ersetzeTabtitelOriginal(tab.ersetzt, tab.original);
      } catch {
        // Dokument weg
      }
      tab = null;
    }
  }

  // ---------- Anmeldung ----------
  // Einstellungen lesen wir erst, wenn das Pack die Freischaltung hat (sonst hat dieses Modul nichts zu tun).
  function sichereEinstellungen(): void {
    if (einstellungen || ladeEinstellungenLaeuft || !istFreigeschaltet(pack, 'erwachsen:titel')) return;
    ladeEinstellungenLaeuft = true;
    ladeEinstellungen()
      .catch(() => null)
      .then((e) => {
        ladeEinstellungenLaeuft = false;
        if (!einstellungenGehoert && e) einstellungen = e;
        beiAenderung();
      });
  }

  const abmelden = beiEinstellungsAenderung((neu) => {
    einstellungenGehoert = true;
    einstellungen = neu;
    beiAenderung();
    // Das Ende einer lokalen Pause setzt der Pause-Vertrag in derselben Meldung zurueck: danach noch einmal bewerten.
    setTimeout(() => lebt() && pruefeLage(), 0);
  });
  const packHoerer = (aenderungen: Record<string, { newValue?: unknown }>, bereich: string): void => {
    if (bereich !== 'local' || !(PACK_SPEICHER_SCHLUESSEL in aenderungen)) return;
    packGehoert = true;
    packFertig = true;
    pack = kurzAusRoh(aenderungen[PACK_SPEICHER_SCHLUESSEL]?.newValue);
    sichereEinstellungen();
    beiAenderung();
  };
  browser.storage.onChanged.addListener(packHoerer);
  const statusAb = beiErwachsenStatus(() => beiAenderung());
  // Die Pause im Riegel gilt sofort, auch wenn der Hintergrund nicht antwortet.
  const lokalAb = beiLokalerPause(() => {
    beendeEinsatz();
    frueh.gibFrei();
  });
  // Adresswechsel ohne Neuladen (pushState, popstate): Ausnahmen mit Pfad greifen dann neu.
  const adresse = new AdressBeobachter(
    () => location.href,
    () => lebt() && beiAenderung(),
  );

  ladePackKurz()
    .catch(() => null)
    .then((p) => {
      packFertig = true;
      if (!packGehoert) pack = p;
      sichereEinstellungen();
      beiAenderung();
    });

  ctx.onInvalidated(() => {
    // Erst zurueckstellen (lebt() ist ab jetzt falsch), dann abmelden.
    abgebaut = true;
    stoppeBeobachter();
    stelleZurueck();
    frueh.gibFrei();
    if (ladeTimer) clearTimeout(ladeTimer);
    adresse.stopp();
    lokalAb();
    try {
      abmelden();
      statusAb();
      browser.storage.onChanged.removeListener(packHoerer);
    } catch {
      // Kontext weg: die Anmeldungen sind es auch
    }
  });
}
