// Einstieg (Auftrag E, PHASE-6-AUFTRAEGE-SESSION-11.md, PHASE-6-BAUPLAN Abschnitt 2): Erweiterungsseite, immer nur ein Schritt sichtbar.
// Reihenfolge: Warnung, 18+, Einwilligung, Interview (5 Seiten, jede Antwort sofort gespeichert), Abschluss. Texte nur per textContent.
import {
  SCHWELLE_MAX,
  SCHWELLE_MIN,
  VERWEIGERN_MAX,
  VERWEIGERN_MIN,
  aendereEinstellungen,
  beiEinstellungsAenderung,
  ladeEinstellungen,
  type BlitzHaeufigkeit,
  type CursorArt,
  type Einstellungen,
  type Stil,
} from '../../src/einstellungen';
import { QUIZ_WARNUNG_SCHLUESSEL, WARNUNG_SPIRALE_SCHLUESSEL } from '../../src/kontrolle/grenzen';
import { PACK_SPEICHER_SCHLUESSEL, istFreigeschaltet, kurzAusRoh, ladePackKurz, wirksamerStil, type PackKurz } from '../../src/pack/vertrag';
import { WILLKOMMEN_KANAL, aendereEinstieg } from '../../src/einstieg/speicher';
import { einstiegFertig, ladeEinstieg, type EinstiegStand } from '../../src/einstieg/vertrag';
import { fortschritt, istInterview, naechster, startSchritt, vorheriger, type Schritt } from '../../src/einstieg/schritte';
import { ZONEN_WAHLEN, bedecktAlle, setzeBedeckt, setzeZonenWahl, zonenWahl, type ZonenWahl } from '../../src/einstieg/zonen';
import { TEXT } from '../../src/einstieg/texte';
import { FEHLER_SPEICHERN, stimmungsWort } from '../../src/oberflaeche/gemeinsam';

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

interface Schalter {
  zeile: HTMLLabelElement;
  feld: HTMLInputElement;
}
function schalter(id: string, titel: string, text: string, beiAenderung: (an: boolean) => void): Schalter {
  const zeile = knoten('label', 'schalter');
  const feld = knoten('input', undefined, undefined, id);
  feld.type = 'checkbox';
  feld.setAttribute('role', 'switch');
  const regler = knoten('span', 'regler');
  regler.setAttribute('aria-hidden', 'true');
  const t = knoten('span', 'text');
  t.append(knoten('strong', undefined, titel), knoten('small', undefined, text));
  zeile.append(feld, regler, t);
  feld.addEventListener('change', () => beiAenderung(feld.checked));
  return { zeile, feld };
}

interface WahlKarte {
  label: HTMLLabelElement;
  feld: HTMLInputElement;
}
function wahlKarte(id: string, name: string, wert: string, titel: string, text: string, beiWahl: () => void): WahlKarte {
  const label = knoten('label');
  const feld = knoten('input', undefined, undefined, id);
  feld.type = 'radio';
  feld.name = name;
  feld.value = wert;
  const t = knoten('span', 'text');
  t.append(knoten('strong', undefined, titel));
  if (text) t.append(knoten('small', undefined, text));
  label.append(feld, t);
  feld.addEventListener('change', () => {
    if (feld.checked) beiWahl();
  });
  return { label, feld };
}

function auswahl(id: string, optionen: ReadonlyArray<[string, string]>, beiAenderung: (wert: string) => void): HTMLSelectElement {
  const s = knoten('select', undefined, undefined, id);
  for (const [wert, text] of optionen) {
    const o = knoten('option', undefined, text);
    o.value = wert;
    s.append(o);
  }
  s.addEventListener('change', () => beiAenderung(s.value));
  return s;
}

// ---------- Zustand ----------

const platz = el<HTMLElement>('schritt');
const fortschrittZeile = el<HTMLDivElement>('fortschritt-zeile');
const fortschrittBalken = el<HTMLProgressElement>('fortschritt');
const fortschrittText = el<HTMLSpanElement>('fortschritt-text');

let einstieg: EinstiegStand;
let einst: Einstellungen;
let pack: PackKurz | null = null;
let aktualisiere: ((e: Einstellungen, p: PackKurz | null) => void) | null = null;

const istFirefox = location.protocol === 'moz-extension:';
// Beim Wiederholen des Interviews zaehlen nur seine Seiten ("Question 1 of 5", Fund 19).
let wiederholung = false;
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
  aktualisiere?.(einst, pack);
}
const speichere = (teil: Parameters<typeof aendereEinstellungen>[0]) =>
  void aendereEinstellungen(teil).then(
    () => {
      if (fehlerZeile) fehlerZeile.hidden = true;
    },
    () => void nachFehler(),
  );
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
    knopf('warnung-ok', TEXT.warnungOk, 'gross', () => {
      // Die Bestaetigung hier zaehlt auch als gesehene Warnung von Quiz und Leerlauf-Spirale (PHASE-6-BAUPLAN Abschnitt 2).
      void Promise.all([
        aendereEinstieg({ warnung: true }),
        browser.storage.local.set({ [QUIZ_WARNUNG_SCHLUESSEL]: true, [WARNUNG_SPIRALE_SCHLUESSEL]: true }),
      ]).then(() => zeige(naechster('warnung')), zeigeFehler);
    }),
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
  s.append(
    knoten('p', undefined, TEXT.einwilligungLaeuft, 'einwilligung-laeuft'),
    liste,
    k,
    knoten('p', 'hinweis', TEXT.einwilligungNeinHinweis, 'einwilligung-nein-hinweis'),
  );
  return s;
}

// ---------- Interview ----------

interface Seite {
  knoten: HTMLElement;
  aktualisiere: (e: Einstellungen, p: PackKurz | null) => void;
}

// Fund 4: ohne Pack ein Satz, was das Pack auf dieser Seite zeigt, und der Link zum Pack-Abschnitt (die Seite merkt sich den Schritt).
function packHinweis(text: string): HTMLParagraphElement {
  const p = knoten('p', 'hinweis', `${text} `, 'iv-ohne-pack');
  const link = knoten('a', undefined, TEXT.packLink, 'iv-pack-link');
  link.href = pfadOptionen(PACK_ANKER);
  // Fund N11: neuer Tab, das Interview bleibt auf seiner Seite (Zurueck-Taste und gemerkter Schritt bleiben unberuehrt).
  link.target = '_blank';
  link.rel = 'noopener';
  p.append(link);
  p.hidden = true;
  return p;
}

function seite1(): Seite {
  const k = knoten('div');
  k.append(knoten('p', undefined, TEXT.i1Text));
  const kopf = knoten('div', 'kopf');
  const wert = knoten('output', undefined, undefined, 'iv-stimmung-wert');
  wert.htmlFor.add('iv-stimmung');
  kopf.append(knoten('span', undefined, TEXT.stimmungLabel, 'iv-stimmung-titel'), wert);
  const regler = knoten('input', undefined, undefined, 'iv-stimmung');
  regler.type = 'range';
  regler.min = String(SCHWELLE_MIN);
  regler.max = String(SCHWELLE_MAX);
  regler.step = '0.01';
  regler.setAttribute('aria-labelledby', 'iv-stimmung-titel');
  // Beim Ziehen nur die Anzeige, gespeichert wird beim Loslassen (change).
  const zeigeWort = () => {
    const w = stimmungsWort(Number(regler.value));
    wert.textContent = w;
    regler.setAttribute('aria-valuetext', w);
  };
  regler.addEventListener('input', zeigeWort);
  regler.addEventListener('change', () => speichere({ schwelle: Number(regler.value) }));
  const enden = knoten('div', 'enden');
  enden.append(knoten('span', undefined, TEXT.stimmungSuspicious), knoten('span', undefined, TEXT.stimmungRelaxed));
  const strict = schalter('iv-strict', TEXT.strictTitel, TEXT.strictText, (an) => speichere({ strict: an }));
  k.append(kopf, regler, enden, strict.zeile);
  return {
    knoten: k,
    aktualisiere: (e) => {
      regler.value = String(e.schwelle);
      zeigeWort();
      strict.feld.checked = e.strict;
    },
  };
}

function seite2(): Seite {
  const k = knoten('div');
  k.append(knoten('p', undefined, TEXT.i2Text));
  const gruppe = knoten('div', 'wahl');
  gruppe.setAttribute('role', 'radiogroup');
  gruppe.setAttribute('aria-labelledby', 'schritt-titel');
  const infos: Record<ZonenWahl, [string, string, string]> = {
    koerper: ['iv-zonen-koerper', TEXT.wahlKoerper, TEXT.wahlKoerperText],
    'koerper-gesicht': ['iv-zonen-koerper-gesicht', TEXT.wahlKoerperGesicht, TEXT.wahlKoerperGesichtText],
    alles: ['iv-zonen-alles', TEXT.wahlAlles, TEXT.wahlAllesText],
  };
  const karten = {} as Record<ZonenWahl, WahlKarte>;
  for (const w of ZONEN_WAHLEN) {
    const [id, titel, text] = infos[w];
    karten[w] = wahlKarte(id, 'iv-zonen', w, titel, text, () => speichere((alt) => ({ zonen: setzeZonenWahl(alt.zonen, w) })));
    gruppe.append(karten[w].label);
  }
  const keine = knoten('p', 'hinweis', TEXT.wahlKeine, 'iv-zonen-keine');
  keine.hidden = true;
  const bedeckt = schalter('iv-bedeckt', TEXT.bedecktTitel, TEXT.bedecktText, (an) => speichere((alt) => ({ zonen: setzeBedeckt(alt.zonen, an) })));
  k.append(gruppe, keine, bedeckt.zeile);
  return {
    knoten: k,
    aktualisiere: (e) => {
      const w = zonenWahl(e.zonen);
      for (const z of ZONEN_WAHLEN) karten[z].feld.checked = z === w;
      keine.hidden = w !== null;
      bedeckt.feld.checked = bedecktAlle(e.zonen);
    },
  };
}

function seite3(): Seite {
  const k = knoten('div');
  k.append(knoten('p', undefined, TEXT.i3Text));
  const gruppe = knoten('div', 'wahl');
  gruppe.setAttribute('role', 'radiogroup');
  gruppe.setAttribute('aria-labelledby', 'schritt-titel');
  const stile: Array<[Stil, string]> = [
    ['mosaik', TEXT.stilMosaik],
    ['blur', TEXT.stilBlur],
    ['mia-patch', TEXT.stilPatch],
  ];
  const felder = new Map<Stil, HTMLInputElement>();
  for (const [stil, titel] of stile) {
    const karte = wahlKarte(`iv-stil-${stil}`, 'iv-stil', stil, titel, '', () => speichere({ stil }));
    felder.set(stil, karte.feld);
    gruppe.append(karte.label);
  }
  const sperre = knoten('p', 'hinweis', TEXT.stilPatchGesperrt, 'iv-stil-sperre');
  sperre.hidden = true;
  k.append(gruppe, sperre);
  return {
    knoten: k,
    aktualisiere: (e, p) => {
      const patchFrei = istFreigeschaltet(p, 'stil:mia-patch');
      felder.get('mia-patch')!.disabled = !patchFrei;
      sperre.hidden = patchFrei;
      const wirksam = wirksamerStil(e.stil, p);
      for (const [stil, feld] of felder) feld.checked = stil === wirksam;
    },
  };
}

function seite4(): Seite {
  const k = knoten('div');
  k.append(knoten('p', undefined, TEXT.i4Text));
  const hinweis = packHinweis(TEXT.ohnePack4);
  const an = schalter('iv-erw-an', TEXT.erwAnTitel, TEXT.erwAnText, (a) =>
    speichere((alt) => ({ erwachsen: { ...alt.erwachsen, an: a } })),
  );
  const ersatz = schalter('iv-erw-ersatz', TEXT.erwErsatzTitel, TEXT.erwErsatzText, (a) =>
    speichere((alt) => ({ erwachsen: { ...alt.erwachsen, komplettErsatz: a } })),
  );
  const kopf = knoten('div', 'kopf');
  const wert = knoten('output', undefined, undefined, 'iv-verweigern-wert');
  wert.htmlFor.add('iv-verweigern');
  kopf.append(knoten('span', undefined, TEXT.verweigernTitel, 'iv-verweigern-titel'), wert);
  const regler = knoten('input', undefined, undefined, 'iv-verweigern');
  regler.type = 'range';
  regler.min = String(Math.round(VERWEIGERN_MIN * 100));
  regler.max = String(Math.round(VERWEIGERN_MAX * 100));
  regler.step = '1';
  regler.setAttribute('aria-labelledby', 'iv-verweigern-titel');
  regler.addEventListener('input', () => {
    wert.textContent = `${regler.value}%`;
  });
  regler.addEventListener('change', () => speichere((alt) => ({ quiz: { ...alt.quiz, verweigern: Number(regler.value) / 100 } })));
  k.append(hinweis, an.zeile, ersatz.zeile, kopf, regler, knoten('p', 'hinweis', TEXT.verweigernText));
  return {
    knoten: k,
    aktualisiere: (e, p) => {
      hinweis.hidden = p !== null;
      an.feld.checked = e.erwachsen.an;
      ersatz.feld.checked = e.erwachsen.komplettErsatz;
      const prozent = Math.round(e.quiz.verweigern * 100);
      regler.value = String(prozent);
      wert.textContent = `${prozent}%`;
    },
  };
}

function seite5(): Seite {
  const k = knoten('div');
  k.append(knoten('p', undefined, TEXT.i5Text));
  const hinweis = packHinweis(TEXT.ohnePack5);
  const blitz = auswahl(
    'iv-blitz',
    [
      ['aus', TEXT.blitzAus],
      ['selten', TEXT.blitzSelten],
      ['oft', TEXT.blitzOft],
    ],
    (w) => speichere((alt) => ({ kontrolle: { ...alt.kontrolle, blitz: w as BlitzHaeufigkeit } })),
  );
  blitz.setAttribute('aria-labelledby', 'iv-blitz-titel');
  const blitzZeile = knoten('div', 'regel');
  blitzZeile.append(knoten('strong', undefined, TEXT.blitzTitel, 'iv-blitz-titel'), blitz);
  const leerlauf = schalter('iv-leerlauf', TEXT.leerlaufTitel, TEXT.leerlaufText, (a) =>
    speichere((alt) => ({ kontrolle: { ...alt.kontrolle, leerlauf: a } })),
  );
  const ruhig = schalter('iv-ruhig', TEXT.ruhigTitel, TEXT.ruhigText, (an) => speichere({ ruhig: an }));
  const cursor = auswahl(
    'iv-cursor',
    [
      ['spirale', TEXT.cursorSpirale],
      ['herz', TEXT.cursorHerz],
      ['aus', TEXT.cursorAus],
    ],
    (w) => speichere((alt) => ({ kontrolle: { ...alt.kontrolle, cursor: w as CursorArt } })),
  );
  cursor.setAttribute('aria-labelledby', 'iv-cursor-titel');
  const cursorZeile = knoten('div', 'regel');
  cursorZeile.append(knoten('strong', undefined, TEXT.cursorTitel, 'iv-cursor-titel'), cursor);
  const ton = schalter('iv-ton', TEXT.tonTitel, TEXT.tonText, (a) => speichere((alt) => ({ ton: { ...alt.ton, an: a } })));
  const auchAn = knoten('p', 'hinweis', undefined, 'iv-auch-an');
  k.append(hinweis, blitzZeile, leerlauf.zeile, ruhig.zeile, cursorZeile, ton.zeile, auchAn);
  return {
    knoten: k,
    aktualisiere: (e, p) => {
      hinweis.hidden = p !== null;
      blitz.value = e.kontrolle.blitz;
      leerlauf.feld.checked = e.kontrolle.leerlauf;
      ruhig.feld.checked = e.ruhig;
      const an = (['werbung', 'tabtitel', 'meldungen'] as const).filter((n) => e.kontrolle[n]).map((n) => TEXT.auchAnNamen[n]);
      auchAn.textContent = an.length ? TEXT.auchAn(an) : '';
      auchAn.hidden = an.length === 0;
      cursor.value = e.kontrolle.cursor;
      ton.feld.checked = e.ton.an;
    },
  };
}

const INTERVIEW: Record<string, { titel: string; bauen: () => Seite }> = {
  'interview-1': { titel: TEXT.i1Titel, bauen: seite1 },
  'interview-2': { titel: TEXT.i2Titel, bauen: seite2 },
  'interview-3': { titel: TEXT.i3Titel, bauen: seite3 },
  'interview-4': { titel: TEXT.i4Titel, bauen: seite4 },
  'interview-5': { titel: TEXT.i5Titel, bauen: seite5 },
};

function navigation(s: Schritt): HTMLElement {
  const zeile = knoten('div', 'knoepfe');
  const zurueck = vorheriger(s);
  const letzte = naechster(s) === 'ende';
  if (zurueck) zeile.append(knopf('iv-zurueck', TEXT.zurueck, 'klein ruhig', () => zeige(zurueck)));
  const weiter = knopf('iv-weiter', letzte ? TEXT.fertig : TEXT.weiter, 'gross', () => {
    if (!letzte) return zeige(naechster(s));
    void aendereEinstieg({ interview: 'fertig' }).then(() => zeige('ende'), zeigeFehler);
  });
  weiter.classList.add('rechts');
  zeile.append(weiter);
  return zeile;
}

function seiteInterview(s: Schritt): HTMLElement {
  const s1 = INTERVIEW[s]!.bauen();
  aktualisiere = s1.aktualisiere;
  s1.aktualisiere(einst, pack);
  const alles = knoten('div');
  alles.append(s1.knoten, navigation(s));
  // Auf der letzten Seite tut "Skip the rest" dasselbe wie "Finish", dort fehlt der Block (Fund 20).
  if (naechster(s) === 'ende') return alles;
  const ueber = knoten('div', 'ueberspringen');
  ueber.append(
    knopf('iv-ueberspringen', TEXT.ueberspringen, 'klein', () => {
      void aendereEinstieg((alt) => ({ interview: alt.interview === 'fertig' ? 'fertig' : 'uebersprungen' })).then(() => zeige('ende'), zeigeFehler);
    }),
    knoten('p', 'hinweis', TEXT.ueberspringenHinweis),
  );
  alles.append(ueber);
  return alles;
}

// ---------- Abschluss ----------

function seiteEnde(): HTMLElement {
  const s = knoten('div');
  // Beide Knoepfe gehen im selben Tab zur Einstellungsseite (Fund 22); openOptionsPage kennt keinen Anker.
  const packKnopf = knopf('ende-pack', TEXT.endePack, 'gross', () => {
    location.href = pfadOptionen(PACK_ANKER);
  });
  const text = knoten('p', undefined, undefined, 'ende-text');
  const k = knoten('div', 'knoepfe');
  k.append(
    packKnopf,
    knopf('ende-einstellungen', TEXT.endeEinstellungen, 'klein', () => {
      location.href = pfadOptionen();
    }),
    knopf('ende-schliessen', TEXT.endeSchliessen, 'klein ruhig', () => void schliesse()),
  );
  s.append(text, k);
  aktualisiere = (_e, p) => {
    packKnopf.hidden = p !== null;
    // Fund 21: mit Pack sagt der Satz nicht mehr, dass es fehlt.
    text.textContent = p !== null ? TEXT.endeTextMitPack : TEXT.endeText;
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

function zeige(s: Schritt): void {
  aktualisiere = null;
  platz.dataset.schritt = s;
  merke(istInterview(s) ? s : null);
  platz.replaceChildren();
  const titel = knoten('h2', undefined, INTERVIEW[s]?.titel ?? TITEL[s] ?? '', 'schritt-titel');
  titel.tabIndex = -1;
  let inhalt: HTMLElement;
  if (s === 'warnung') inhalt = seiteWarnung();
  else if (s === 'alter') inhalt = seiteAlter();
  else if (s === 'einwilligung') inhalt = seiteEinwilligung();
  else if (istInterview(s)) inhalt = seiteInterview(s);
  else inhalt = seiteEnde();
  fehlerZeile = knoten('p', 'fehler', undefined, 'fehler');
  fehlerZeile.setAttribute('role', 'alert');
  fehlerZeile.hidden = true;
  platz.append(titel, inhalt, fehlerZeile);

  if (s === 'ende') {
    fortschrittZeile.hidden = true;
  } else {
    const nurFragen = wiederholung && istInterview(s);
    const f = fortschritt(s, nurFragen);
    fortschrittZeile.hidden = false;
    fortschrittBalken.max = f.von;
    fortschrittBalken.value = f.nr;
    fortschrittText.id = 'fortschritt-text';
    fortschrittText.textContent = nurFragen ? TEXT.frageVon(f.nr, f.von) : TEXT.schrittVon(f.nr, f.von);
  }
  titel.focus({ preventScroll: true });
}

async function start(): Promise<void> {
  document.title = TEXT.seitenTitel;
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
  if (start === 'interview-1' && alt && istInterview(alt)) start = alt;
  zeige(start);
}

void start();
