// Gemeinsame Bausteine der Oberflaeche (Phase 11 E4c0, Entscheidung 245): Funktionen, die DOM-Elemente bauen, fuer die Einstellungsseite (E4c)
// und das Interview (E4d). Kein Framework. Kein Baustein enthaelt einen Satz der Oberflaeche: Titel, Hinweise, Erklaerungen, Namen und
// Beschriftungen kommen als Eingabe. Diese Datei wird nur von Erweiterungsseiten benutzt, nie von einem Content-Script (Regel B8).
// Jeder Baustein gibt ein Handle zurueck: `element` (zum Einhaengen), den Stand lesen und setzen, und bei Aenderung durch den Nutzer ruft er
// `beiAenderung` auf. `setze...` ruft `beiAenderung` nie auf (das Setzen kommt vom Aufrufer).
import { ZONEN, type Zone } from '../../einstellungen.ts';
import { zonenDerWahl, zonenWahl, setzeZonenWahl, type ZonenStand, type ZonenWahl, ZONEN_WAHLEN } from '../../einstieg/zonen.ts';
import { baueErklaerungTeile, baueTitel, el, HinweisFach, knopf, markiereRadios, neueKennung, radioTastatur, wurzel, type ErklaerungEingabe } from './dom.ts';
import { kleidungsStand, setzeEineZone, setzeKleidung, type KleidungsAntwort } from './kleidung.ts';
import { stufenAnsicht, type StufenAnsicht, type StufenListe } from './stufen.ts';

export { baueErklaerungTeile as baueErklaerung, baueHinweis, baueTitel, type ErklaerungEingabe, type TitelEingabe, type TitelHandle } from './dom.ts';
export { gleicheDeckung, kleidungsStand, setzeEineZone, setzeKleidung, zonenSchreibteil, zonenUnterKleidung, type KleidungsAntwort, type KleidungsStand } from './kleidung.ts';
export { inEinheiten, markierteStufe, pruefeStufenliste, stufenAnsicht, type Stufe, type StufenAnsicht, type StufenListe } from './stufen.ts';
export { STUFENLISTEN, type StufenSchluessel } from './stufen-daten.ts';

// ---------- Schalter ----------
export interface SchalterEingabe {
  titel: string;
  hinweis?: string; // hoechstens einer
  erklaerung?: ErklaerungEingabe;
  an: boolean;
  gesperrt?: boolean; // aria-disabled, nicht disabled: der Schalter und sein Hinweis bleiben per Tab erreichbar
  beiAenderung?: (an: boolean) => void;
}
export interface SchalterHandle {
  element: HTMLElement;
  knopf: HTMLButtonElement; // der Schalter selbst: button mit role="switch" und aria-checked
  an(): boolean;
  setze(an: boolean): void;
  setzeGesperrt(gesperrt: boolean): void;
  setzeHinweis(text: string | null): void;
}

export function baueSchalter(e: SchalterEingabe): SchalterHandle {
  const w = wurzel('schalter');
  const zeile = el('div', 'v-schalter-zeile');
  const k = knopf('v-schalter-knopf');
  k.setAttribute('role', 'switch');
  const bahn = el('span', 'v-bahn');
  bahn.setAttribute('aria-hidden', 'true');
  k.append(bahn);
  const titel = baueTitel({ titel: e.titel, erklaerung: e.erklaerung });
  k.setAttribute('aria-labelledby', titel.titel.id);
  const text = el('div', 'v-schalter-text');
  text.append(titel.element);
  zeile.append(k, text);
  w.append(zeile);
  const fach = new HinweisFach(titel.element, k, e.hinweis);
  let an = e.an;
  const zeige = () => k.setAttribute('aria-checked', String(an));
  zeige();
  const umschalten = () => {
    if (k.getAttribute('aria-disabled') === 'true') return; // gesperrt: bleibt mit Tab erreichbar, ein Druck aendert nichts
    an = !an;
    zeige();
    e.beiAenderung?.(an);
  };
  k.addEventListener('click', umschalten);
  // Ein Druck auf den Titeltext schaltet ebenfalls (grosse Trefferflaeche mit Maus und Finger); der "?" und der Hinweis schalten nicht.
  titel.titel.addEventListener('click', umschalten);
  if (e.gesperrt) k.setAttribute('aria-disabled', 'true');
  return {
    element: w,
    knopf: k,
    an: () => an,
    setze: (neu) => {
      an = neu;
      zeige();
    },
    setzeGesperrt: (g) => {
      if (g) k.setAttribute('aria-disabled', 'true');
      else k.removeAttribute('aria-disabled');
    },
    setzeHinweis: (t) => fach.setze(t),
  };
}

// ---------- Aufklapper ----------
export interface AufklapperEingabe {
  titel: string;
  stand?: string; // Kurzstand rechts im Kopf, zum Beispiel "3 of 10 on"
  erklaerung?: ErklaerungEingabe;
  offen?: boolean;
  inhalt?: Node;
  beiUmschalten?: (offen: boolean) => void;
}
export interface AufklapperHandle {
  element: HTMLElement;
  kopf: HTMLButtonElement; // button mit aria-expanded und aria-controls
  inhalt: HTMLElement; // hier hinein kommt der Inhalt
  offen(): boolean;
  setzeOffen(offen: boolean): void;
  setzeStand(text: string): void;
}

export function baueAufklapper(e: AufklapperEingabe): AufklapperHandle {
  const w = wurzel('aufklapper');
  const kopfzeile = el('div', 'v-auf-kopfzeile');
  const kopf = knopf('v-auf-kopf');
  const titelText = el('span', 'v-auf-titel', e.titel);
  const stand = el('span', 'v-auf-stand', e.stand ?? '');
  kopf.append(titelText, stand);
  kopfzeile.append(kopf);
  const inhalt = el('div', 'v-auf-inhalt');
  inhalt.id = neueKennung('aufklapper-inhalt');
  kopf.setAttribute('aria-controls', inhalt.id);
  if (e.erklaerung) {
    const t = baueErklaerungTeile(e.erklaerung);
    kopfzeile.append(t.knopf);
    w.append(kopfzeile, t.feld);
  } else w.append(kopfzeile);
  w.append(inhalt);
  if (e.inhalt) inhalt.append(e.inhalt);
  let offen = !!e.offen;
  const zeige = () => {
    kopf.setAttribute('aria-expanded', String(offen));
    inhalt.hidden = !offen;
    w.classList.toggle('v-offen', offen);
  };
  zeige();
  kopf.addEventListener('click', () => {
    offen = !offen;
    zeige();
    e.beiUmschalten?.(offen);
  });
  return {
    element: w,
    kopf,
    inhalt,
    offen: () => offen,
    setzeOffen: (o) => {
      offen = o;
      zeige();
    },
    setzeStand: (t) => {
      stand.textContent = t;
    },
  };
}

// ---------- Wahlkarten (gemeinsame Gruppe) ----------
export interface Wahlkarte {
  id: string;
  titel: string;
  satz?: string; // der eigene Satz der Karte (kein Hinweis)
  bild?: Node; // zum Beispiel ein SVG, vom Aufrufer gebaut
}

interface KartenGruppe {
  gruppe: HTMLElement;
  knoepfe: HTMLButtonElement[];
  setze(id: string | null): void;
  setzeGesperrt(ids: readonly string[]): void;
  markiert(): string | null;
}

function baueKartenGruppe(karten: readonly Wahlkarte[], wert: string | null, spalten: number, beschriftetDurch: string, beiWahl: (id: string) => void): KartenGruppe {
  const gruppe = el('div', 'v-wahl');
  gruppe.setAttribute('role', 'radiogroup');
  gruppe.setAttribute('aria-labelledby', beschriftetDurch);
  gruppe.style.setProperty('--v-spalten', String(spalten));
  // Schmale Fenster: Karten mit Bild bleiben zu zweit, Karten ohne Bild stehen untereinander.
  gruppe.style.setProperty('--v-spalten-schmal', String(karten.some((k) => k.bild) ? Math.min(spalten, 2) : 1));
  const knoepfe = karten.map((k) => {
    const b = knopf('v-wahl-karte');
    b.setAttribute('role', 'radio');
    b.dataset.id = k.id;
    if (k.bild) {
      const bild = el('span', 'v-wahl-bild');
      bild.append(k.bild);
      b.append(bild);
    }
    b.append(el('strong', 'v-wahl-titel', k.titel));
    if (k.satz) b.append(el('span', 'v-wahl-satz', k.satz));
    const haken = el('span', 'v-haken');
    haken.setAttribute('aria-hidden', 'true');
    b.append(haken);
    b.addEventListener('click', () => beiWahl(k.id));
    return b;
  });
  gruppe.append(...knoepfe);
  let markiert = wert;
  const zeige = () => markiereRadios(knoepfe, markiert === null ? null : karten.findIndex((k) => k.id === markiert));
  zeige();
  radioTastatur(gruppe);
  return {
    gruppe,
    knoepfe,
    setze: (id) => {
      markiert = id;
      zeige();
    },
    // Gesperrte Karten tragen `disabled` (kein Klick, keine Eingabe, keine Leertaste, die Pfeile ueberspringen sie, der Tab-Halt meidet sie).
    setzeGesperrt: (ids) => {
      knoepfe.forEach((k) => (k.disabled = ids.includes(k.dataset.id ?? '')));
      zeige();
    },
    markiert: () => markiert,
  };
}

export interface WahlkartenEingabe {
  titel: string;
  erklaerung?: ErklaerungEingabe;
  hinweis?: string;
  karten: readonly Wahlkarte[];
  wert: string | null; // null: keine Karte markiert
  spalten?: number;
  beiAenderung?: (id: string) => void;
}
export interface WahlkartenHandle {
  element: HTMLElement;
  gruppe: HTMLElement; // role="radiogroup"
  wert(): string | null;
  setze(id: string | null): void;
  // Vertrag (E4d2 G4): sperrt genau diese Karten und gibt alle anderen frei. Eine gesperrte Karte ist durch Bedienung nie waehlbar; `setze()` darf sie aber
  // als gespeicherten Stand anzeigen.
  setzeGesperrt(ids: readonly string[]): void;
  // K4: legt den Fokus auf den Tab-Halt der Gruppe: die markierte Karte, ist keine markiert (oder die markierte gesperrt) die erste waehlbare. Aendert nie einen Wert.
  setzeFokus(): void;
  setzeHinweis(text: string | null): void;
}

export function baueWahlkarten(e: WahlkartenEingabe): WahlkartenHandle {
  const w = wurzel('wahlkarten');
  const titel = baueTitel({ titel: e.titel, erklaerung: e.erklaerung });
  const g = baueKartenGruppe(e.karten, e.wert, e.spalten ?? 3, titel.titel.id, (id) => {
    g.setze(id);
    e.beiAenderung?.(id);
  });
  w.append(titel.element, g.gruppe);
  const fach = new HinweisFach(g.gruppe, g.gruppe, e.hinweis);
  const setzeFokus = () => g.knoepfe.find((k) => k.tabIndex === 0 && !k.disabled)?.focus();
  return { element: w, gruppe: g.gruppe, wert: g.markiert, setze: g.setze, setzeGesperrt: g.setzeGesperrt, setzeFokus, setzeHinweis: (t) => fach.setze(t) };
}

// ---------- Stufenwahl ----------
export interface StufenwahlEingabe {
  titel: string;
  erklaerung?: ErklaerungEingabe;
  // E4t W8: Id einer Ueberschrift mit demselben Namen ueber dem Baustein: der Baustein zeigt dann keinen Titel, seine Gruppe ist mit dieser Ueberschrift verbunden.
  beschriftetDurch?: string;
  liste: StufenListe; // Stufen mit Namen und Werten (STUFENLISTEN oder eine Kopie mit anderen Namen)
  wert: number; // gespeicherter Wert im Speichermass der Einstellung
  exakt: { titel: string; formatiere: (wert: number) => string; reglerLabel: string }; // Aufklapper "Exact value"
  hinweisFuer?: (ansicht: StufenAnsicht, wert: number) => string | null; // der eine Hinweis, abhaengig vom Stand
  beiAenderung?: (wert: number) => void;
}
export interface StufenwahlHandle {
  element: HTMLElement;
  gruppe: HTMLElement; // role="radiogroup"
  aufklapper: AufklapperHandle; // "Exact value"
  regler: HTMLInputElement;
  wert(): number;
  ansicht(): StufenAnsicht;
  setze(wert: number): void;
}

export function baueStufenwahl(e: StufenwahlEingabe): StufenwahlHandle {
  const w = wurzel('stufenwahl');
  const titel = baueTitel({ titel: e.titel, erklaerung: e.erklaerung, unsichtbar: !!e.beschriftetDurch });
  const gruppe = el('div', 'v-stufen');
  gruppe.setAttribute('role', 'radiogroup');
  gruppe.setAttribute('aria-labelledby', e.beschriftetDurch ?? titel.titel.id);
  const knoepfe = e.liste.stufen.map((s) => {
    const b = knopf('v-stufe', s.name);
    b.setAttribute('role', 'radio');
    return b;
  });
  gruppe.append(...knoepfe);

  const regler = el('input', 'v-regler-eingabe');
  regler.type = 'range';
  regler.min = String(e.liste.min);
  regler.max = String(e.liste.max);
  regler.step = String(e.liste.schritt);
  regler.setAttribute('aria-label', e.exakt.reglerLabel);
  const anzeige = el('output', 'v-wert');
  regler.id = neueKennung('regler');
  anzeige.setAttribute('for', regler.id);
  const reglerZeile = el('div', 'v-regler');
  reglerZeile.append(regler, anzeige);
  const auf = baueAufklapper({ titel: e.exakt.titel, inhalt: reglerZeile });

  let wert = e.wert;
  let manuell = false; // der Nutzer hat den Aufklapper selbst geoeffnet: dann bleibt er offen
  auf.kopf.addEventListener('click', () => {
    manuell = auf.offen();
  });
  const fach = new HinweisFach(gruppe, gruppe);
  let ansicht = stufenAnsicht(e.liste, wert);
  // K1/L1: der Wert, den der Regler zuletzt hatte, als der Baustein ihn meldete oder vom Programm bekam (in der Form, wie der Regler ihn haelt: ein Regler mit
  // Schritt rundet einen Zwischenwert wie 0,1049 auf seinen Schritt, ein Vergleich mit `wert` saehe sonst bei jeder Taste eine Aenderung).
  // Firefox meldet am nativen Regler kein `change`, wenn der Wert nach einem Zuruecksetzen durch die Seite wieder dem Wert des letzten `change` gleicht:
  // dann meldet der Baustein selbst, sobald Taste oder Zeiger losgelassen sind und der Wert vom zuletzt gemeldeten abweicht. Hat der Browser `change` schon
  // gemeldet, ist der Wert gleich und es gibt keinen zweiten Schreibversuch (je Tastendruck und je Ziehen genau einer).
  // L1: genau EINE Stelle setzt `regler.value` vom Programm aus und merkt den Wert im selben Schritt (erster Stand beim Bau, jedes `setze()`, jede Stufe).
  // Der Baustein schreibt nie einen Wert, den der Nutzer nicht gewaehlt hat: ohne Handlung weicht `regler.value` nie von `gemeldet` ab.
  let gemeldet = '';
  const setzeReglerWert = (w: number) => {
    regler.value = String(w);
    gemeldet = regler.value;
  };
  const zeige = (vomRegler = false) => {
    ansicht = stufenAnsicht(e.liste, wert);
    markiereRadios(knoepfe, ansicht.markiert);
    const text = e.exakt.formatiere(wert);
    anzeige.textContent = text;
    auf.setzeStand(text);
    if (!vomRegler) setzeReglerWert(wert); // der Regler selbst hat den Wert schon (Handlung des Nutzers): keine zweite Zuweisung
    regler.setAttribute('aria-valuetext', text);
    // Zwischenwert: der Aufklapper ist offen und zeigt den Wert. Bei einer Stufe schliesst er wieder, ausser der Nutzer hat ihn selbst geoeffnet.
    auf.setzeOffen(ansicht.zwischenwert || manuell);
    fach.setze(e.hinweisFuer ? e.hinweisFuer(ansicht, wert) : null);
  };
  const waehle = (neu: number) => {
    wert = neu;
    zeige();
    e.beiAenderung?.(wert);
  };
  knoepfe.forEach((b, i) => b.addEventListener('click', () => waehle(e.liste.stufen[i]!.wert)));
  radioTastatur(gruppe);
  regler.addEventListener('input', () => {
    wert = Number(regler.value);
    manuell = true; // wer am Regler arbeitet, dem klappt der Aufklapper nicht unter der Hand zu
    zeige(true);
  });
  const meldeReglerWert = () => {
    if (regler.value === gemeldet) return;
    gemeldet = regler.value;
    wert = Number(regler.value);
    e.beiAenderung?.(wert);
  };
  regler.addEventListener('change', meldeReglerWert);
  regler.addEventListener('keyup', meldeReglerWert);
  regler.addEventListener('pointerup', meldeReglerWert);
  w.append(titel.element, gruppe, auf.element);
  zeige();
  return {
    element: w,
    gruppe,
    aufklapper: auf,
    regler,
    wert: () => wert,
    ansicht: () => ansicht,
    setze: (neu) => {
      wert = neu;
      zeige();
    },
  };
}

// ---------- Auswahlfeld ----------
export interface AuswahlOption {
  wert: string;
  text: string;
}
export interface AuswahlEingabe {
  titel: string;
  erklaerung?: ErklaerungEingabe;
  hinweis?: string;
  optionen: readonly AuswahlOption[];
  wert: string;
  beiAenderung?: (wert: string) => void;
}
export interface AuswahlHandle {
  element: HTMLElement;
  auswahl: HTMLSelectElement;
  wert(): string;
  setze(wert: string): void;
  setzeHinweis(text: string | null): void;
}

// Ein echtes select: die gemeinsame Gestalt (Pfeil, Polster, Regel O6) kommt aus tokens.css, die Hoehe 44 Pixel aus bausteine.css.
export function baueAuswahl(e: AuswahlEingabe): AuswahlHandle {
  const w = wurzel('auswahl');
  const titel = baueTitel({ titel: e.titel, erklaerung: e.erklaerung });
  const s = el('select', 'v-auswahl-feld');
  s.setAttribute('aria-labelledby', titel.titel.id);
  for (const o of e.optionen) {
    const opt = el('option', '', o.text);
    opt.value = o.wert;
    s.append(opt);
  }
  s.value = e.wert;
  s.addEventListener('change', () => e.beiAenderung?.(s.value));
  w.append(titel.element, s);
  const fach = new HinweisFach(s, s, e.hinweis);
  return { element: w, auswahl: s, wert: () => s.value, setze: (v) => (s.value = v), setzeHinweis: (t) => fach.setze(t) };
}

// ---------- Zonenwahl ----------
// Zonenwahl und Kleidungsfrage halten KEINE eigene Kopie des Zonenstands (Nacharbeit R5): die Seite gibt eine Lesefunktion `zonen`, die bei jeder
// Handlung den aktuellen gespeicherten Stand liefert. `beiAenderung` bekommt den neuen ganzen Stand; die Seite speichert ihn, danach liefert `zonen`
// ihn. `setze()` zeichnet nur neu, aus `zonen()`. So schreibt ein Chip nach "Under clothes too" nie einen alten Stand zurueck.
export interface ZonenwahlEingabe {
  titel: string;
  erklaerung?: ErklaerungEingabe;
  hinweis?: string;
  beschriftetDurch?: string; // E4t W8, wie bei der Stufenwahl
  karten: Record<ZonenWahl, { titel: string; satz?: string }>; // drei Karten: Body, Body and face, Everything
  einzeln: {
    titel: string; // Aufklapper "Pick zones one by one"
    stand: (anzahlAn: number, gesamt: number) => string; // Kurzstand, zum Beispiel "3 of 10 on"
    gruppenLabel: string;
    namen: Record<Zone, string>;
  };
  zonen: () => ZonenStand; // Lesefunktion: der aktuelle Stand
  beiAenderung?: (zonen: ZonenStand) => void;
}
export interface ZonenwahlHandle {
  element: HTMLElement;
  gruppe: HTMLElement; // role="radiogroup" der drei Karten
  aufklapper: AufklapperHandle;
  chips: Record<Zone, HTMLButtonElement>; // je Zone ein Knopf mit aria-pressed
  setze(): void; // zeichnet neu aus `zonen()`, ruft `beiAenderung` nie
  setzeHinweis(text: string | null): void;
}

// Die Logik (welche Zonen eine Wahl einschaltet) liegt in src/einstieg/zonen.ts; hier steht nur die Darstellung.
export function baueZonenwahl(e: ZonenwahlEingabe): ZonenwahlHandle {
  const w = wurzel('zonenwahl');
  const titel = baueTitel({ titel: e.titel, erklaerung: e.erklaerung, unsichtbar: !!e.beschriftetDurch });
  const karten: Wahlkarte[] = ZONEN_WAHLEN.map((id) => ({ id, ...e.karten[id] }));
  const aendere = (neu: ZonenStand) => {
    zeige(neu);
    e.beiAenderung?.(neu);
  };
  const g = baueKartenGruppe(karten, zonenWahl(e.zonen()), 3, e.beschriftetDurch ?? titel.titel.id, (id) => aendere(setzeZonenWahl(e.zonen(), id as ZonenWahl)));
  const chipsGruppe = el('div', 'v-chips');
  chipsGruppe.setAttribute('role', 'group');
  chipsGruppe.setAttribute('aria-label', e.einzeln.gruppenLabel);
  const chips = {} as Record<Zone, HTMLButtonElement>;
  for (const z of ZONEN) {
    const c = knopf('v-chip');
    c.dataset.zone = z;
    const haken = el('span', 'v-haken');
    haken.setAttribute('aria-hidden', 'true');
    c.append(haken, el('span', 'v-chip-text', e.einzeln.namen[z]));
    c.addEventListener('click', () => {
      const jetzt = e.zonen();
      aendere(setzeEineZone(jetzt, z, !jetzt[z].an));
    });
    chips[z] = c;
    chipsGruppe.append(c);
  }
  const auf = baueAufklapper({ titel: e.einzeln.titel, inhalt: chipsGruppe });
  const fach = new HinweisFach(g.gruppe, g.gruppe, e.hinweis);
  const zeige = (z: ZonenStand) => {
    g.setze(zonenWahl(z));
    let an = 0;
    for (const k of ZONEN) {
      chips[k].setAttribute('aria-pressed', String(z[k].an));
      if (z[k].an) an += 1;
    }
    auf.setzeStand(e.einzeln.stand(an, ZONEN.length));
  };
  zeige(e.zonen());
  w.append(titel.element, g.gruppe, auf.element);
  return { element: w, gruppe: g.gruppe, aufklapper: auf, chips, setze: () => zeige(e.zonen()), setzeHinweis: (t) => fach.setze(t) };
}

// Welche Zonen eine Karte einschaltet (fuer Vorschauen der Seiten), nur durchgereicht aus src/einstieg/zonen.ts.
export { zonenDerWahl };

// ---------- Kleidungsfrage ----------
export interface KleidungsfrageEingabe {
  titel: string;
  erklaerung?: ErklaerungEingabe;
  hinweis?: string;
  antworten: Record<KleidungsAntwort, { titel: string; satz?: string; bild?: Node }>; // "Bare skin only", "Under clothes too"
  zonen: () => ZonenStand; // Lesefunktion: der aktuelle Stand (keine eigene Kopie)
  beiAenderung?: (zonen: ZonenStand) => void; // der neue Zonenstand, nur nach einer Handlung des Nutzers
}
export interface KleidungsfrageHandle {
  element: HTMLElement;
  gruppe: HTMLElement; // role="radiogroup"
  stand(): ReturnType<typeof kleidungsStand>;
  setze(): void; // zeichnet neu aus `zonen()`, ruft `beiAenderung` nie
  setzeHinweis(text: string | null): void;
}

// Bei einem gemischten Stand ist keine Antwort markiert. Geschrieben wird erst, wenn der Nutzer eine Antwort waehlt (Klick, Leertaste, Eingabe).
export function baueKleidungsfrage(e: KleidungsfrageEingabe): KleidungsfrageHandle {
  const w = wurzel('kleidungsfrage');
  const titel = baueTitel({ titel: e.titel, erklaerung: e.erklaerung });
  const abbild = (z: ZonenStand): KleidungsAntwort | null => {
    const s = kleidungsStand(z);
    return s === 'gemischt' ? null : s;
  };
  const karten: Wahlkarte[] = [
    { id: 'haut', ...e.antworten.haut },
    { id: 'auch-bedeckt', ...e.antworten['auch-bedeckt'] },
  ];
  const g = baueKartenGruppe(karten, abbild(e.zonen()), 2, titel.titel.id, (id) => {
    const neu = setzeKleidung(e.zonen(), id as KleidungsAntwort);
    g.setze(abbild(neu));
    e.beiAenderung?.(neu);
  });
  w.append(titel.element, g.gruppe);
  const fach = new HinweisFach(g.gruppe, g.gruppe, e.hinweis);
  return { element: w, gruppe: g.gruppe, stand: () => kleidungsStand(e.zonen()), setze: () => g.setze(abbild(e.zonen())), setzeHinweis: (t) => fach.setze(t) };
}

// ---------- Platz der festen Vorschau ----------
export interface VorschauPlatzEingabe {
  label: string; // Name des Bereichs fuer Screenreader
  etikett?: string; // zum Beispiel "Showing"
}
export interface VorschauPlatzHandle {
  element: HTMLElement;
  flaeche: HTMLElement; // leer, hier zeichnet Etappe 5 die Vorschau
  setzeEtikett(text: string): void;
}

// Nur Rahmen und Etikett (Seitenverhaeltnis 3 zu 4). Der Inhalt kommt in Etappe 5. Nicht bedienbar, nicht fokussierbar.
export function baueVorschauPlatz(e: VorschauPlatzEingabe): VorschauPlatzHandle {
  const w = wurzel('vorschau-platz');
  w.setAttribute('role', 'group');
  w.setAttribute('aria-label', e.label);
  const rahmen = el('div', 'v-vorschau-rahmen');
  const flaeche = el('div', 'v-vorschau-flaeche');
  const etikett = el('span', 'v-vorschau-etikett', e.etikett ?? '');
  etikett.hidden = !e.etikett;
  rahmen.append(flaeche, etikett);
  w.append(rahmen);
  return {
    element: w,
    flaeche,
    setzeEtikett: (t) => {
      etikett.textContent = t;
      etikett.hidden = !t;
    },
  };
}
