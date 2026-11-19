// Einstieg (Auftrag E, PHASE-6-AUFTRAEGE-SESSION-11.md, PHASE-6-BAUPLAN Abschnitt 2): Erweiterungsseite, immer nur ein Schritt sichtbar.
// Reihenfolge: Warnung, 18+, Einwilligung, Interview (6 Seiten mit Pack, 4 ohne, jede Antwort sofort gespeichert; die Bedienelemente stehen in interview.ts), Abschluss. Texte nur per textContent.
import { aendereEinstellungen, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';
import { QUIZ_WARNUNG_SCHLUESSEL, WARNUNG_SPIRALE_SCHLUESSEL } from '../../src/kontrolle/grenzen';
import { PACK_SPEICHER_SCHLUESSEL, kurzAusRoh, ladePackKurz, type PackKurz } from '../../src/pack/vertrag';
import { WILLKOMMEN_KANAL, aendereEinstieg } from '../../src/einstieg/speicher';
import { einstiegFertig, ladeEinstieg, type EinstiegStand } from '../../src/einstieg/vertrag';
import type { ChibiPose } from '../../src/chibi';
import { ETAPPEN, etappe, fortschritt, interviewSeiten, istInterview, naechster, startSchritt, vorheriger, type Schritt } from '../../src/einstieg/schritte';
import { INTERVIEW_SEITEN } from '../../src/einstieg/vertrag';
import '../../src/oberflaeche/bausteine/bausteine.css';
import { hilfeAdresse } from '../../src/hilfe/anker';
import { baueSchritteListe, baueSeite, baueVorschau, type Kontext, type Seite, type Speicherergebnis } from './interview';
import { TEXT } from '../../src/einstieg/texte';
import { FEHLER_SPEICHERN } from '../../src/oberflaeche/gemeinsam';
import { zeigeKernBilder } from '../../src/oberflaeche/kern-platz';
import { gibChibiFrei, zeigeChibi } from '../../src/oberflaeche/chibi-platz';
import { augenpaar } from '../../src/oberflaeche/design/motive';
import { belebeRegler } from '../../src/oberflaeche/design/regler';

belebeRegler(); // Phase 8b: gemeinsamer Regler, Fuellung bis zum Wert auch in Chromium

// Anker des Pack-Abschnitts ("Add a pack") auf der Einstellungsseite: die id `neu` steht in entrypoints/options/index.html.
const PACK_ANKER = '#neu';
// Merkt das Interview-Schritt im Tab (sessionStorage), damit Neuladen nicht auf Seite 1 zurueckwirft. Am Gate hilft das nie.
const SCHRITT_MERKER = 'veil-einstieg-schritt';
const merke = (s: string | null) => {
  try {
    if (s) sessionStorage.setItem(SCHRITT_MERKER, s);
    else sessionStorage.removeItem(SCHRITT_MERKER);
  } catch {
    // ohne Speicher einfach ohne Merken
  }
};
const gemerkt = (): string | null => {
  try {
    return sessionStorage.getItem(SCHRITT_MERKER);
  } catch {
    return null;
  }
};

// ---------- kleine Helfer (nur textContent, nie innerHTML) ----------

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element ${id} fehlt`);
  return e as T;
}

function knoten<K extends keyof HTMLElementTagNameMap>(tag: K, klasse?: string, text?: string, id?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  if (klasse) e.className = klasse;
  if (text !== undefined) e.textContent = text;
  if (id) e.id = id;
  return e;
}

function knopf(id: string, text: string, klasse: string, beiKlick: () => void): HTMLButtonElement {
  const k = knoten('button', klasse, text, id);
  k.type = 'button';
  k.addEventListener('click', beiKlick);
  return k;
}

// ---------- Zustand ----------

const platz = el<HTMLElement>('schritt');
const fortschrittZeile = el<HTMLDivElement>('fortschritt-zeile');
const fortschrittBalken = el<HTMLProgressElement>('fortschritt');
const fortschrittText = el<HTMLSpanElement>('fortschritt-text');

let einstieg: EinstiegStand;
let einst: Einstellungen;
let pack: PackKurz | null = null;
let aktualisiere: ((e: Einstellungen, p: PackKurz | null, erzwingen?: boolean) => void) | null = null;

const istFirefox = location.protocol === 'moz-extension:';
// Beim Wiederholen des Interviews zaehlen nur seine Seiten ("Question 1 of 5", Fund 19).
let wiederholung = false;
// Zahl der Interview-Seiten dieses Durchgangs: mit Pack beim Einstieg 6, ohne Pack 4 (Fund 7). Gilt ab Seite 1 bis zum Abschluss.
let seiten = INTERVIEW_SEITEN;
// Fund 26: scheitert ein Speichern, steht der Satz FEHLER_SPEICHERN auf der Seite und das Bedienelement springt auf den gespeicherten Stand.
let fehlerZeile: HTMLParagraphElement | null = null;
function zeigeFehler(): void {
  if (!fehlerZeile) return;
  // Erst leeren, dann im naechsten Frame setzen: so kuendigt ein Screenreader auch den zweiten gleichen Fehler an.
  const z = fehlerZeile;
  z.textContent = '';
  z.hidden = false;
  requestAnimationFrame(() => {
    z.textContent = FEHLER_SPEICHERN;
  });
}
async function nachFehler(): Promise<void> {
  zeigeFehler();
  try {
    einst = await ladeEinstellungen();
  } catch {
    // dann gilt der zuletzt gesehene gespeicherte Stand
  }
  aktualisiere?.(einst, pack, true); // E4e H1: nach einem Speicherfehler zeigt jedes Element den gespeicherten Stand, auch ein Regler mit Fokus
}
// Schreibt auf den frisch gelesenen Stand. Liefert `teil` null, wird nicht geschrieben (auch nicht der unveraenderte Stand, I8a) und ein stehender Fehlersatz
// bleibt stehen (RN4). Nach einem Fehler und nach einer verworfenen Handlung zeigt jedes Element den gespeicherten Stand.
async function speichere(teil: (alt: Einstellungen) => Partial<Einstellungen> | null): Promise<Speicherergebnis> {
  let verworfen = false;
  try {
    await aendereEinstellungen((alt) => {
      const t = teil(alt);
      if (t === null) verworfen = true;
      return t;
    });
  } catch {
    await nachFehler();
    return 'fehler';
  }
  if (verworfen) {
    try {
      einst = await ladeEinstellungen();
    } catch {
      // dann gilt der zuletzt gesehene Stand
    }
    aktualisiere?.(einst, pack, true);
    return 'verworfen';
  }
  if (fehlerZeile) fehlerZeile.hidden = true;
  return 'gespeichert';
}
const kontext: Kontext = { einst: () => einst, speichere, pfadOptionen: (anker) => pfadOptionen(anker) };
const pfadOptionen = (anker = '') => (browser.runtime.getURL as (p: string) => string)('/options.html') + anker;

async function schliesse(): Promise<void> {
  try {
    const tab = await browser.tabs.getCurrent();
    if (tab?.id !== undefined) {
      await browser.tabs.remove(tab.id);
      return;
    }
  } catch {
    // Fallback unten
  }
  window.close();
}

// ---------- Gate und Einwilligung ----------

function seiteWarnung(): HTMLElement {
  const s = knoten('div');
  s.append(
    knoten('p', 'kern', TEXT.warnungKern, 'warnung-kern'),
    knoten('p', undefined, TEXT.warnungText),
    knoten('p', 'hinweis', `${TEXT.warnungEntfernen} ${istFirefox ? TEXT.entfernenFirefox : TEXT.entfernenChrome}`, 'warnung-entfernen'),
    (() => {
      // Die Bestaetigung hier zaehlt auch als gesehene Warnung von Quiz und Leerlauf-Spirale (PHASE-6-BAUPLAN Abschnitt 2).
      // Fund 8: der zweite, gleich starke Knopf schaltet zusaetzlich Calm mode ein.
      const weiter = (ruhig: boolean) =>
        void Promise.all([
          aendereEinstieg({ warnung: true }),
          browser.storage.local.set({ [QUIZ_WARNUNG_SCHLUESSEL]: true, [WARNUNG_SPIRALE_SCHLUESSEL]: true }),
          ruhig ? aendereEinstellungen({ ruhig: true }) : Promise.resolve(),
        ]).then(() => zeige(naechster('warnung')), zeigeFehler);
      const k = knoten('div', 'knoepfe');
      k.append(
        knopf('warnung-ok', TEXT.warnungOk, 'gross', () => weiter(false)),
        knopf('warnung-ruhig', TEXT.warnungRuhig, 'gross', () => weiter(true)),
      );
      return k;
    })(),
  );
  return s;
}

function seiteAlter(): HTMLElement {
  const s = knoten('div');
  const frage = knoten('div', undefined, undefined, 'alter-frage');
  const absage = knoten('div', undefined, undefined, 'alter-absage');
  absage.hidden = true;
  absage.setAttribute('role', 'alert');
  absage.append(
    knoten('p', undefined, TEXT.alterAbsage),
    knoten('p', 'kern', istFirefox ? TEXT.entfernenFirefox : TEXT.entfernenChrome, 'alter-entfernen'),
    // Fund 18: wer aus Versehen "No" getippt hat, kommt zur Frage zurueck. Gespeichert wurde nichts.
    knopf('alter-zurueck', TEXT.alterZurueck, 'klein ruhig', () => {
      absage.hidden = true;
      frage.hidden = false;
      fortschrittZeile.hidden = false;
      el<HTMLButtonElement>('alter-ja').focus();
    }),
  );
  frage.append(
    knoten('p', undefined, TEXT.alterFrage),
    (() => {
      const k = knoten('div', 'knoepfe');
      k.append(
        (() => {
          const ja = knopf('alter-ja', TEXT.alterJa, 'gross', () => {
            void aendereEinstieg({ alter: true }).then(() => zeige(naechster('alter')), zeigeFehler);
          });
          ja.setAttribute('aria-label', TEXT.alterJaAria);
          return ja;
        })(),
        // "I’m not": nichts wird gespeichert, es gibt kein Weiter.
        knopf('alter-nein', TEXT.alterNein, 'klein ruhig', () => {
          frage.hidden = true;
          absage.hidden = false;
          absage.tabIndex = -1;
          absage.focus();
          fortschrittZeile.hidden = true;
        }),
      );
      return k;
    })(),
  );
  s.append(frage, absage);
  return s;
}

let szeneBild: HTMLElement | null = null;
function seiteEinwilligung(): HTMLElement {
  const s = knoten('div');
  const liste = knoten('ul', 'punkte', undefined, 'einwilligung-punkte');
  for (const p of TEXT.einwilligungPunkte) liste.append(knoten('li', undefined, p));
  const k = knoten('div', 'knoepfe');
  const nein = knopf('einwilligung-nein', TEXT.einwilligungNein, 'klein ruhig', () => void schliesse());
  nein.setAttribute('aria-describedby', 'einwilligung-nein-hinweis');
  k.append(
    knopf('einwilligung-ok', TEXT.einwilligungOk, 'gross', () => {
      void aendereEinstieg({ einwilligung: true, zeit: Date.now() }).then(() => zeige(naechster('einwilligung')), zeigeFehler);
    }),
    // "Not now": nichts wird gespeichert, die Seite schliesst. Der Satz darunter sagt, was dann gilt (Fund 2).
    nein,
  );
  // Phase 7 (Auftrag I3, Entscheidung 150): "erste Seite" heisst die Einwilligungsseite, die erste nach Warnung und 18+. Ein Kern-Bild von Mia, erst wenn es geladen ist (ohne Kern-Bilder im Bau bleibt der Platz weg).
  // Die Warn- und die 18+-Seite bleiben ohne Bild. Phase 8b (Auftrag W): das Bild steht links neben der Karte (Szene), gebaut in zeige().
  szeneBild = knoten('div', 'mia-bild', undefined, 'kern-bild');
  szeneBild.hidden = true;
  const bild = szeneBild;
  void zeigeKernBilder(bild, 1, () => bild.isConnected);
  s.append(
    liste,
    knoten('p', undefined, TEXT.einwilligungLaeuft, 'einwilligung-laeuft'),
    k,
    knoten('p', 'hinweis', TEXT.einwilligungNeinHinweis, 'einwilligung-nein-hinweis'),
  );
  return s;
}

// ---------- Interview ----------
// Die Seiten stehen in interview.ts (Bausteine); hier nur Navigation, Mia mit Sprechblase und das Raster.
let abbauSeite: (() => void) | null = null;
window.addEventListener('pagehide', () => abbauSeite?.(), { once: true });

function navigation(s: Schritt): HTMLElement {
  const zeile = knoten('div', 'knoepfe');
  const zurueck = vorheriger(s);
  const letzte = naechster(s, seiten) === 'ende';
  if (zurueck) zeile.append(knopf('iv-zurueck', TEXT.zurueck, 'klein ruhig', () => zeige(zurueck)));
  const weiter = knopf('iv-weiter', letzte ? TEXT.fertig : TEXT.weiter, 'gross', () => {
    if (!letzte) return zeige(naechster(s, seiten));
    void aendereEinstieg({ interview: 'fertig' }).then(() => zeige('ende'), zeigeFehler);
  });
  weiter.classList.add('rechts');
  zeile.append(weiter);
  return zeile;
}

const POSE_JE_SEITE: Record<string, ChibiPose> = {
  'interview-1': 'schild',
  'interview-2': 'arme',
  'interview-3': 'nein',
  'interview-4': 'arme',
  'interview-5': 'schmollen',
  'interview-6': 'jubeln',
};

// Eine Interview-Seite: links die Schritte, in der Mitte die Frage, rechts (schmal oben) der Platz der Vorschau (I9).
function seiteInterview(s: Schritt, titel: HTMLElement, fehler: HTMLElement): HTMLElement[] {
  abbauSeite?.();
  const nr = Number(s.slice(-1));
  const s1: Seite = baueSeite(nr, kontext, seiten);
  abbauSeite = s1.abbau ?? null;
  const vorschau = baueVorschau();
  const innen = s1.aktualisiere;
  let letztes: PackKurz | null | undefined;
  let chibi: HTMLImageElement | null = null;
  const pose = POSE_JE_SEITE[s] ?? 'arme';
  aktualisiere = (e, p, erzwingen) => {
    innen(e, p, erzwingen);
    vorschau.zeichne(e, p);
    if (chibi && p !== letztes) {
      letztes = p;
      void zeigeChibi(chibi, pose, p);
    }
  };
  // Phase 8b (Auftrag W): der Erklaertext steht in einer Sprechblase neben dem Chibi (Demo-Chibi oder Pack-Chibi ueber den vorhandenen Weg).
  const erklaer = s1.knoten.firstElementChild;
  if (erklaer && erklaer.tagName === 'P') {
    chibi = knoten('img', 'chibi');
    chibi.alt = '';
    chibi.hidden = true;
    erklaer.classList.add('blase');
    const zeile = knoten('div', 'mia-zeile');
    zeile.append(chibi, erklaer);
    s1.knoten.prepend(zeile);
  }
  aktualisiere(einst, pack);
  const alles = knoten('div');
  alles.append(s1.knoten, navigation(s));
  // Auf der letzten Seite tut "Skip the rest" dasselbe wie "Finish", dort fehlt der Block (Fund 20).
  if (naechster(s, seiten) !== 'ende') {
    const ueber = knoten('div', 'ueberspringen');
    ueber.append(
      knopf('iv-ueberspringen', TEXT.ueberspringen, 'textlink', () => {
        // Nur der Stand des Einstiegs aendert sich, nie ein Wert der Einstellungen.
        void aendereEinstieg((alt) => ({ interview: alt.interview === 'fertig' ? 'fertig' : 'uebersprungen' })).then(() => zeige('ende'), zeigeFehler);
      }),
      knoten('p', 'hinweis', TEXT.ueberspringenHinweis),
    );
    alles.append(ueber);
  }
  const karte = knoten('div', 'iv-karte');
  karte.append(titel, alles, fehler);
  return [baueSchritteListe(nr, seiten), karte, vorschau.element];
}

// ---------- Abschluss ----------

// Fund 3: drei Zeilen mit Ikone: Anheften (je Browser erkannt), Pause (mit dem Kuerzel aus den Browser-Kurzbefehlen), Ausprobieren.
function endeCheckliste(): HTMLElement {
  const liste = knoten('ul', 'checkliste', undefined, 'ende-liste');
  liste.setAttribute('aria-label', TEXT.endeListeAria);
  const zeile = (id: string, ikone: string, titel: string, text: string): { li: HTMLLIElement; text: HTMLSpanElement } => {
    const li = knoten('li', undefined, undefined, id);
    const i = knoten('span', 'ikone', ikone);
    i.setAttribute('aria-hidden', 'true');
    const t = knoten('span', 'text');
    const satz = knoten('span', undefined, text);
    t.append(knoten('strong', undefined, titel), satz);
    li.append(i, t);
    liste.append(li);
    return { li, text: satz };
  };
  const android = /Android/i.test(navigator.userAgent);
  const pinText = android ? TEXT.endePinAndroid : istFirefox ? TEXT.endePinFirefox : TEXT.endePinChrome;
  const pin = zeile('ende-pin', '1', android ? TEXT.endePinTitelAndroid : TEXT.endePinTitel, `${pinText} `);
  const pinLink = knoten('a', undefined, TEXT.endePinLink, 'ende-pin-link');
  pinLink.href = hilfeAdresse('pin');
  pinLink.target = '_blank';
  pinLink.rel = 'noopener';
  pin.text.append(pinLink);
  const pause = zeile('ende-pause', '2', TEXT.endePauseTitel, TEXT.endePauseNurPopup);
  if (!android) {
    // Das Kuerzel steht erst, wenn der Browser es nennt; ohne eines bleibt nur das Popup.
    void (async () => {
      try {
        const alle = await browser.commands?.getAll?.();
        const kuerzel = alle?.find((c) => c.name === 'pause-umschalten')?.shortcut;
        if (kuerzel && pause.li.isConnected) pause.text.textContent = TEXT.endePauseKuerzel(kuerzel);
      } catch {
        // dann bleibt es beim Popup
      }
    })();
  }
  zeile('ende-versuch', '3', TEXT.endeVersuchTitel, TEXT.endeVersuch);
  return liste;
}

function seiteEnde(): HTMLElement {
  const s = knoten('div');
  // Beide Knoepfe gehen im selben Tab zur Einstellungsseite (Fund 22); openOptionsPage kennt keinen Anker.
  const packKnopf = knopf('ende-pack', TEXT.endePack, 'gross', () => {
    location.href = pfadOptionen(PACK_ANKER);
  });
  const text = knoten('p', 'blase', undefined, 'ende-text');
  // UX-Pruefung 8b Nr. 15: Mia jubelt zum Abschluss (Demo- oder Pack-Chibi), der Satz steht in ihrer Sprechblase.
  const chibi = knoten('img', 'chibi');
  chibi.alt = '';
  chibi.hidden = true;
  const zeile = knoten('div', 'mia-zeile');
  zeile.append(chibi, text);
  const einstellungenKnopf = knopf('ende-einstellungen', TEXT.endeEinstellungen, 'klein', () => {
    location.href = pfadOptionen();
  });
  const k = knoten('div', 'knoepfe');
  k.append(packKnopf, einstellungenKnopf, knopf('ende-schliessen', TEXT.endeSchliessen, 'klein ruhig', () => void schliesse()));
  // Session 17: Anleitungen (Hilfe-Seite) im selben Tab erreichbar.
  const hilfe = knoten('p', 'hinweis-leise');
  const hilfeLink = knoten('a', undefined, TEXT.endeHilfe, 'ende-hilfe');
  hilfeLink.href = hilfeAdresse();
  hilfe.append(hilfeLink);
  s.append(zeile, endeCheckliste(), k, hilfe);
  let letztes: PackKurz | null | undefined;
  aktualisiere = (_e, p) => {
    packKnopf.hidden = p !== null;
    // Mit Pack ist "All settings" der Hauptknopf (UX-Pruefung 8b Nr. 15), ohne Pack bleibt es der Pack-Knopf.
    einstellungenKnopf.className = p !== null ? 'gross' : 'klein';
    // Fund 21: mit Pack sagt der Satz nicht mehr, dass es fehlt.
    text.textContent = p !== null ? TEXT.endeTextMitPack : TEXT.endeText;
    if (p !== letztes) {
      letztes = p;
      void zeigeChibi(chibi, 'jubeln', p);
    }
  };
  aktualisiere(einst, pack);
  return s;
}

// ---------- Schritte zeigen ----------

const TITEL: Partial<Record<Schritt, string>> = {
  warnung: TEXT.warnungTitel,
  alter: TEXT.alterTitel,
  einwilligung: TEXT.einwilligungTitel,
  ende: TEXT.endeTitel,
};

const fragenNr = (s: Schritt) => fortschritt(s, true, seiten).nr;

// Fund 19: die Etappen unter der Bahn, die aktuelle fett und fuer Hilfsmittel als aktueller Schritt.
function zeigeEtappen(s: Schritt): void {
  const ol = el<HTMLOListElement>('etappen');
  ol.setAttribute('aria-label', TEXT.etappenAria);
  const jetzt = etappe(s);
  ol.replaceChildren(
    ...ETAPPEN.map((e) => {
      const li = knoten('li', undefined, TEXT.etappen[e]);
      li.dataset.etappe = e;
      if (e === jetzt) li.setAttribute('aria-current', 'step');
      return li;
    }),
  );
}

function zeige(s: Schritt): void {
  aktualisiere = null;
  // Fund 7: die Zahl der Interview-Seiten steht beim Eintritt ins Interview fest (Pack da oder nicht); bis dahin folgt sie dem Pack (Gate-Zaehler).
  if (!istInterview(platz.dataset.schritt as Schritt)) seiten = interviewSeiten(pack !== null);
  platz.dataset.schritt = s;
  merke(istInterview(s) ? s : null);
  platz.querySelectorAll('img.chibi').forEach((b) => gibChibiFrei(b as HTMLImageElement));
  platz.replaceChildren();
  const titel = knoten('h2', undefined, istInterview(s) ? TEXT[`i${s.slice(-1)}Titel` as 'i1Titel'] : (TITEL[s] ?? ''), 'schritt-titel');
  titel.tabIndex = -1;
  fehlerZeile = knoten('p', 'fehler', undefined, 'fehler');
  fehlerZeile.setAttribute('role', 'alert');
  fehlerZeile.hidden = true;
  let inhalt: HTMLElement = platz;
  let teile: HTMLElement[] | null = null;
  if (s === 'warnung') inhalt = seiteWarnung();
  else if (s === 'alter') inhalt = seiteAlter();
  else if (s === 'einwilligung') inhalt = seiteEinwilligung();
  else if (istInterview(s)) teile = seiteInterview(s, titel, fehlerZeile);
  else inhalt = seiteEnde();
  if (teile) {
    const raster = knoten('div', 'iv-raster');
    raster.append(...teile);
    platz.append(raster);
  } else if (s === 'einwilligung' && szeneBild) {
    // Zweispaltige Szene: Mia-Bild mit Namensschild links, Glas-Karte rechts (unter 640 px gestapelt).
    const links = knoten('div', 'szene-links');
    const schild = knoten('div', 'namensschild');
    schild.append(augenpaar(22), knoten('span', undefined, 'Mia'));
    links.append(szeneBild, schild);
    const karte = knoten('div', 'szene-karte');
    karte.append(titel, inhalt, fehlerZeile);
    platz.append(links, karte);
  } else {
    platz.append(titel, inhalt, fehlerZeile);
  }

  if (s === 'ende') {
    fortschrittZeile.hidden = true;
  } else {
    const nurFragen = wiederholung && istInterview(s);
    const f = fortschritt(s, nurFragen, seiten);
    fortschrittZeile.hidden = false;
    fortschrittBalken.max = f.von;
    fortschrittBalken.value = f.nr;
    fortschrittZeile.style.setProperty('--anteil', String(f.nr / f.von));
    fortschrittText.id = 'fortschritt-text';
    // Fund 19: im Interview "Question n of m", davor "Step n of m" (m zaehlt Gate und die Fragen dieses Durchgangs).
    fortschrittText.textContent = istInterview(s) ? TEXT.frageVon(fragenNr(s), seiten) : TEXT.schrittVon(f.nr, f.von);
    zeigeEtappen(s);
  }
  titel.focus({ preventScroll: true });
}

async function start(): Promise<void> {
  document.title = TEXT.seitenTitel;
  el<HTMLElement>('marke').prepend(augenpaar(26));
  // Antwortet dem Popup ("Meet Mia") mit der eigenen Tab-Nummer, damit es diesen Tab nach vorn holt statt einen zweiten zu oeffnen.
  const kanal = new BroadcastChannel(WILLKOMMEN_KANAL);
  kanal.onmessage = (e) => {
    if (e.data !== 'ping') return;
    void browser.tabs.getCurrent().then((tab) => {
      if (tab?.id !== undefined) kanal.postMessage({ tabId: tab.id });
    }, () => {});
  };
  [einstieg, einst, pack] = await Promise.all([ladeEinstieg(), ladeEinstellungen(), ladePackKurz()]);
  beiEinstellungsAenderung((neu) => {
    einst = neu;
    aktualisiere?.(einst, pack);
  });
  browser.storage.onChanged.addListener((aenderungen, bereich) => {
    if (bereich !== 'local') return;
    if (PACK_SPEICHER_SCHLUESSEL in aenderungen) {
      pack = kurzAusRoh(aenderungen[PACK_SPEICHER_SCHLUESSEL].newValue);
      aktualisiere?.(einst, pack);
    }
    if ('einstieg' in aenderungen) void ladeEinstieg().then((e) => (einstieg = e));
  });
  window.addEventListener('hashchange', () => {
    // Ist die Seite schon offen und der Einstieg fertig, springt `#interview` direkt ins Interview.
    if (location.hash === '#interview' && einstiegFertig(einstieg)) {
      wiederholung = true;
      zeige('interview-1');
    }
  });
  wiederholung = einstiegFertig(einstieg) && (location.hash === '#interview' || einstieg.interview !== 'offen');
  let start = startSchritt(einstieg, location.hash);
  const alt = gemerkt() as Schritt | null;
  // Ein gemerkter Schritt jenseits der Seitenzahl dieses Durchgangs (ohne Pack nur 3) gilt nicht.
  if (start === 'interview-1' && alt && istInterview(alt) && Number(alt.slice(-1)) <= interviewSeiten(pack !== null)) start = alt;
  zeige(start);
}

void start();
