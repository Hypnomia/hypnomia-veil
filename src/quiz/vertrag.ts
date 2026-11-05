// Vertrag fuer Quiz-Bank und Mias Saetze (PHASE-4-BAUPLAN Abschnitte 2 und 8). Vom Orchestrator geschrieben; Auftrag Q darf
// AUFGABEN_TYPEN und die Parameter-Pruefung ergaenzen, alle anderen lesen nur.
// Beide Dateien liegen im Pack (Rollen `quiz` und `texte`, Entscheidung 100), nie im Repo; im Repo nur synthetische Testdaten.
// Keine Laufzeit-Importe (laeuft in Einheitstests mit `node --experimental-strip-types`, im Pack-Bau und im Browser).
// Pruefung: unbekannte Felder verwerfen, Laengen begrenzen, nur Text. Angezeigt wird ausschliesslich ueber `textContent`.

// ---------- Quiz-Bank ----------
export const QUIZ_ARTEN = ['wissen', 'tippen', 'aufgabe', 'allgemein'] as const;
export type QuizArt = (typeof QUIZ_ARTEN)[number];
export const SCHWEREN = ['leicht', 'mittel', 'fies'] as const;
export type Schwere = (typeof SCHWEREN)[number];
// Wo eine Frage gezogen werden darf: `desktop` braucht Maus oder Tastatur, `touch` ist eine Finger-Aufgabe (Android), `beide` geht ueberall.
export const GERAETE = ['beide', 'desktop', 'touch'] as const;
export type Geraet = (typeof GERAETE)[number];

// Hypno-Aufgaben (QUIZ-ENTWURF Teil 3). Die Blitz-Grenzen deckelt der Code unabhaengig von den Parametern (Pruefer-Fund 6).
export const AUFGABEN_TYPEN = [
  'spirale-ansehen', // H01: Spirale ansehen ohne Mausbewegung (param sekunden)
  'wort-tippen', // H02: Wort mehrmals tippen (param wort, anzahl)
  'zaehlen', // H03: Woerter nacheinander, eines zaehlen (param wort, woerter = Komma-Liste, laeuft Woerter: entfaellt im Ruhig-Modus)
  'im-kreis', // H04: Zeiger im Kreis halten (param sekunden)
  'klicken-zaehlen', // H05: genau n Klicks mit Mindestabstand (param anzahl, abstandMs)
  'buchstaben-takt', // H06: Wort Buchstabe fuer Buchstabe im Takt (param wort)
  'pink-klicken', // H07: Klick, wenn das pinke Wort erscheint (laeuft Woerter: entfaellt im Ruhig-Modus)
  'countdown', // H08: Countdown tippen (param von, wort)
  'leertaste-halten', // H09: Leertaste halten (param sekunden)
  'widerstehen', // H10: Knopf nicht klicken (param sekunden)
  'wort-blitz', // H11: Wort einmal kurz zeigen, dann tippen (param wort; entfaellt im Ruhig-Modus)
  'buchstaben-raetsel', // H12: Buchstaben ordnen (param wort, gemischt)
  'finger-halten', // Android: Finger auf der Spirale halten (param sekunden)
  'finger-tippen', // Android: genau n mal tippen mit Mindestabstand (param anzahl, abstandMs)
] as const;
export type AufgabenTyp = (typeof AUFGABEN_TYPEN)[number];

interface FrageBasis {
  id: string;
  art: QuizArt;
  schwere: Schwere;
  geraet: Geraet;
  // Ueberschrift bzw. Anweisung, die die Person liest ("Type it exactly.", die Wissensfrage, der Aufgabentext).
  frage: string;
}
// `wissen` (Mia-Wissen) und `allgemein` (Allgemeinwissen zum Aergern): Auswahl, die Reihenfolge mischt der Code.
export interface FrageWahl extends FrageBasis {
  art: 'wissen' | 'allgemein';
  antworten: string[];
  richtig: number; // Index in `antworten` (vor dem Mischen)
}
// `tippen`: Satz exakt abtippen (Woerter und Trigger exakt, Satzzeichen am Ende sowie Gross- und Kleinschreibung egal, Entscheidung 100).
export interface FrageTippen extends FrageBasis {
  art: 'tippen';
  satz: string;
}
export interface FrageAufgabe extends FrageBasis {
  art: 'aufgabe';
  aufgabe: { typ: AufgabenTyp; param: Record<string, string | number> };
}
export type Frage = FrageWahl | FrageTippen | FrageAufgabe;

export interface QuizBank {
  version: 1;
  fragen: Frage[];
}

// ---------- Mias Saetze ----------
// Gruppen (QUIZ-ENTWURF Teil 5, PHASE-4-BAUPLAN Abschnitte 2, 9, 10). Platzhalter: `{{title}}` (nur `titel`), `{{seconds}}` (nur
// `freigelegt`). Die Gruppen `stufe1` bis `stufe4` sind Mias Kommentar zur Steigerung der Zensur im Popup (fehlen sie, nimmt das Popup
// seinen eingebauten Text). Phase 5 (PHASE-5-AUFTRAEGE-SESSION-9.md): `blitzwoerter` (einzelne Woerter oder kurze Wortgruppen fuer die
// Blitzwoerter, hoechstens MAX_BLITZWORT_ZEICHEN), `leerlauf` (Mias Satz auf der Leerlauf-Spirale), `werbung` (Kennzeichnung der
// getauschten Werbung, muss "Mia" enthalten und hoechstens MAX_WERBE_ZEICHEN haben, Mozilla-Regel O1 b).
// Session 10 (PHASE-5-AUFTRAEGE-SESSION-10.md): `tabtitel` (Titel eines Tabs im Hintergrund, hoechstens MAX_TABTITEL_ZEICHEN), Meldungen je
// Anlass `meldungZensiert` (Platzhalter `{{count}}`, Pflicht in dieser Gruppe), `meldungStufe`, `meldungErwachsen`, `meldungStreng`
// (je hoechstens MAX_MELDUNG_ZEICHEN), `besuch` (Hinweis vor einem Pflicht-Besuch, hoechstens MAX_MELDUNG_ZEICHEN).
export const SATZ_GRUPPEN = [
  'start',
  'richtig',
  'falsch',
  'verweigert',
  'freigelegt',
  'wiederZensiert',
  'titel',
  'begruessung',
  'stufe1',
  'stufe2',
  'stufe3',
  'stufe4',
  'blitzwoerter',
  'leerlauf',
  'werbung',
  'tabtitel',
  'meldungZensiert',
  'meldungStufe',
  'meldungErwachsen',
  'meldungStreng',
  'besuch',
] as const;
export type SatzGruppe = (typeof SATZ_GRUPPEN)[number];
// Ohne diese Gruppen (mindestens ein Satz) gilt die Texte-Datei als ungueltig.
export const PFLICHT_GRUPPEN: readonly SatzGruppe[] = ['start', 'richtig', 'falsch', 'verweigert', 'freigelegt', 'wiederZensiert', 'titel'];

export interface Texte {
  version: 1;
  gruppen: Partial<Record<SatzGruppe, string[]>>;
}

// ---------- Grenzen ----------
export const MAX_FRAGEN = 2000;
export const MIN_FRAGEN = 3; // sonst kann die Auswahl Wiederholungen in Folge nicht vermeiden
export const MAX_ANTWORTEN = 6;
export const MIN_ANTWORTEN = 2;
export const MAX_FRAGE_ZEICHEN = 200;
export const MAX_ANTWORT_ZEICHEN = 120;
export const MAX_SATZ_ZEICHEN = 160;
export const MAX_PARAM = 12;
export const MAX_PARAM_ZEICHEN = 80;
export const MAX_SAETZE_JE_GRUPPE = 200;
export const MAX_TEXT_ZEICHEN = 200;
export const MAX_BLITZWORT_ZEICHEN = 24;
export const MAX_WERBE_ZEICHEN = 40;
export const MAX_TABTITEL_ZEICHEN = 60;
export const MAX_MELDUNG_ZEICHEN = 120;
const MELDUNG_GRUPPEN: ReadonlySet<string> = new Set(['meldungZensiert', 'meldungStufe', 'meldungErwachsen', 'meldungStreng', 'besuch']);
const ID_MUSTER = /^[a-z0-9][a-z0-9-]{0,39}$/i;
const PARAM_NAME = /^[a-zA-Z]{1,20}$/;

// ---------- Pruefung ----------
const istObjekt = (x: unknown): x is Record<string, unknown> => !!x && typeof x === 'object' && !Array.isArray(x);

// Ein reiner Text: Steuerzeichen raus, Leerraum zusammengezogen, keine spitzen Klammern (kein HTML, auch nicht als Zitat).
// Liefert null, wenn der Text leer, zu lang oder kein String ist.
export function sichererText(x: unknown, max: number): string | null {
  if (typeof x !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const t = x.replace(/[\u0000-\u001f\u007f-\u009f\u200b-\u200f\u2028-\u202e\u2066-\u2069]/g, ' ').replace(/\s+/g, ' ').trim();
  if (t.length === 0 || [...t].length > max || /[<>]/.test(t)) return null;
  return t;
}

function pruefeParam(roh: unknown): Record<string, string | number> | null {
  if (roh === undefined) return {};
  if (!istObjekt(roh)) return null;
  const aus: Record<string, string | number> = {};
  let n = 0;
  for (const [k, v] of Object.entries(roh)) {
    if (!PARAM_NAME.test(k) || ++n > MAX_PARAM) return null;
    if (typeof v === 'number') {
      if (!Number.isFinite(v) || Math.abs(v) > 1e6) return null;
      aus[k] = v;
    } else {
      const t = sichererText(v, MAX_PARAM_ZEICHEN);
      if (t === null) return null;
      aus[k] = t;
    }
  }
  return aus;
}

// Eine Frage pruefen; ungueltige Fragen fallen weg (die Bank bleibt brauchbar), unbekannte Felder werden nicht uebernommen.
export function pruefeFrage(roh: unknown): Frage | null {
  if (!istObjekt(roh)) return null;
  if (typeof roh.id !== 'string' || !ID_MUSTER.test(roh.id)) return null;
  if (!(QUIZ_ARTEN as readonly unknown[]).includes(roh.art)) return null;
  if (!(SCHWEREN as readonly unknown[]).includes(roh.schwere)) return null;
  const geraet: Geraet = roh.geraet === undefined ? 'beide' : (GERAETE as readonly unknown[]).includes(roh.geraet) ? (roh.geraet as Geraet) : 'beide';
  if (roh.geraet !== undefined && geraet !== roh.geraet) return null;
  const frage = sichererText(roh.frage, MAX_FRAGE_ZEICHEN);
  if (frage === null) return null;
  const basis = { id: roh.id, schwere: roh.schwere as Schwere, geraet, frage };
  switch (roh.art as QuizArt) {
    case 'wissen':
    case 'allgemein': {
      if (!Array.isArray(roh.antworten) || roh.antworten.length < MIN_ANTWORTEN || roh.antworten.length > MAX_ANTWORTEN) return null;
      const antworten = roh.antworten.map((a) => sichererText(a, MAX_ANTWORT_ZEICHEN));
      if (antworten.some((a) => a === null)) return null;
      if (new Set(antworten.map((a) => a!.toLowerCase())).size !== antworten.length) return null;
      if (typeof roh.richtig !== 'number' || !Number.isInteger(roh.richtig) || roh.richtig < 0 || roh.richtig >= antworten.length) return null;
      return { ...basis, art: roh.art as 'wissen' | 'allgemein', antworten: antworten as string[], richtig: roh.richtig };
    }
    case 'tippen': {
      const satz = sichererText(roh.satz, MAX_SATZ_ZEICHEN);
      if (satz === null) return null;
      return { ...basis, art: 'tippen', satz };
    }
    case 'aufgabe': {
      if (!istObjekt(roh.aufgabe)) return null;
      if (!(AUFGABEN_TYPEN as readonly unknown[]).includes(roh.aufgabe.typ)) return null;
      const param = pruefeParam(roh.aufgabe.param);
      if (param === null) return null;
      return { ...basis, art: 'aufgabe', aufgabe: { typ: roh.aufgabe.typ as AufgabenTyp, param } };
    }
  }
  return null;
}

// Prueft eine rohe Quiz-Bank (geparstes JSON). Liefert die bereinigte Bank oder null (dann gilt die Datei als ungueltig und die
// Freischaltungen `erwachsen:quiz` und `quiz:freilegen` fallen weg). Doppelte ids: die erste gilt.
export function pruefeQuizBank(roh: unknown): QuizBank | null {
  if (!istObjekt(roh) || roh.version !== 1 || !Array.isArray(roh.fragen)) return null;
  if (roh.fragen.length > MAX_FRAGEN) return null;
  const ids = new Set<string>();
  const fragen: Frage[] = [];
  for (const f of roh.fragen) {
    const g = pruefeFrage(f);
    if (!g || ids.has(g.id)) continue;
    ids.add(g.id);
    fragen.push(g);
  }
  if (fragen.length < MIN_FRAGEN) return null;
  return { version: 1, fragen };
}

// Prueft eine rohe Texte-Datei. Unbekannte Gruppen fallen weg, ungueltige Saetze ebenso; fehlt eine Pflichtgruppe: null.
export function pruefeTexte(roh: unknown): Texte | null {
  if (!istObjekt(roh) || roh.version !== 1 || !istObjekt(roh.gruppen)) return null;
  const gruppen: Partial<Record<SatzGruppe, string[]>> = {};
  for (const g of SATZ_GRUPPEN) {
    const liste = roh.gruppen[g];
    if (!Array.isArray(liste)) continue;
    const saetze = liste
      .slice(0, MAX_SAETZE_JE_GRUPPE)
      .map((s) => sichererText(s, MAX_TEXT_ZEICHEN))
      .filter((s): s is string => s !== null)
      // Platzhalter nur dort, wo sie ersetzt werden.
      .filter((s) => (g === 'titel' ? s.includes('{{title}}') : !s.includes('{{title}}')))
      .filter((s) => g === 'freigelegt' || !s.includes('{{seconds}}'))
      .filter((s) => (g === 'meldungZensiert' ? s.includes('{{count}}') : !s.includes('{{count}}')))
      .filter((s) => g !== 'tabtitel' || [...s].length <= MAX_TABTITEL_ZEICHEN)
      .filter((s) => !MELDUNG_GRUPPEN.has(g) || [...s].length <= MAX_MELDUNG_ZEICHEN)
      .filter((s) => g !== 'blitzwoerter' || [...s].length <= MAX_BLITZWORT_ZEICHEN)
      // Werbe-Kennzeichnung immer erkennbar von Mia (Entscheidung 99, Mozilla O1 b).
      .filter((s) => g !== 'werbung' || ([...s].length <= MAX_WERBE_ZEICHEN && /\bmia\b/i.test(s)));
    if (saetze.length > 0) gruppen[g] = saetze;
  }
  if (PFLICHT_GRUPPEN.some((g) => !gruppen[g])) return null;
  return { version: 1, gruppen };
}

// Setzt Platzhalter ein. Ergebnis ist Text fuer `textContent`, nie fuer innerHTML.
export function fuelleSatz(satz: string, werte: { title?: string; seconds?: number; count?: number }): string {
  // Ein Durchgang: ein eingesetzter Seitentitel mit `{{seconds}}` wird nicht noch einmal ersetzt (Pruefer-Fund 8); nicht endliche Zahlen ergeben ''.
  const zahl = (x: number | undefined) => (x !== undefined && Number.isFinite(x) ? String(Math.round(x)) : '');
  return satz.replace(/\{\{(title|seconds|count)\}\}/g, (_, name: string) =>
    name === 'title' ? (werte.title ?? '') : name === 'seconds' ? zahl(werte.seconds) : zahl(werte.count),
  );
}
