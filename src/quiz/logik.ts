// Reine Quiz-Logik (Auftrag Q): Auswahl, Pruefen, Verweigern. Keine Browser-Aufrufe, Zufall einspritzbar (Einheitstests).
import { SCHWEREN, type AufgabenTyp, type Frage, type FrageWahl, type Geraet, type QuizBank, type Schwere } from './vertrag.ts';

export type Zufall = () => number;
export type Lage = { geraet: 'desktop' | 'touch'; ruhig: boolean };

// Aufgaben, in denen Woerter laufen: entfallen im Ruhig-Modus und bei prefers-reduced-motion.
export const RUHIG_VERBOTEN: readonly AufgabenTyp[] = ['zaehlen', 'pink-klicken', 'wort-blitz'];
// Geraet, das ein Aufgabentyp von sich aus braucht (gilt vor dem Feld `geraet` der Frage, falls das Pack sich irrt).
export const AUFGABE_GERAET: Record<AufgabenTyp, Geraet> = {
  'spirale-ansehen': 'desktop',
  'wort-tippen': 'beide',
  zaehlen: 'beide',
  'im-kreis': 'desktop',
  'klicken-zaehlen': 'beide',
  'buchstaben-takt': 'desktop',
  'pink-klicken': 'beide',
  countdown: 'beide',
  'leertaste-halten': 'desktop',
  widerstehen: 'beide',
  'wort-blitz': 'beide',
  'buchstaben-raetsel': 'beide',
  'finger-halten': 'touch',
  'finger-tippen': 'touch',
};
// Typen mit Spirale: davor kommt einmal die Warnung vor Fotosensibilitaet.
export const SPIRAL_TYPEN: readonly AufgabenTyp[] = ['spirale-ansehen', 'klicken-zaehlen', 'finger-halten', 'finger-tippen'];

export function braucheGeraet(f: Frage): Geraet {
  if (f.art === 'aufgabe') {
    const eigen = AUFGABE_GERAET[f.aufgabe.typ];
    if (eigen !== 'beide') return eigen;
  }
  return f.geraet;
}

export function zulaessig(f: Frage, lage: Lage): boolean {
  const g = braucheGeraet(f);
  if (g === 'desktop' && lage.geraet === 'touch') return false;
  if (g === 'touch' && lage.geraet === 'desktop') return false;
  if (lage.ruhig && f.art === 'aufgabe' && RUHIG_VERBOTEN.includes(f.aufgabe.typ)) return false;
  return true;
}

export function brauchtWarnung(f: Frage): boolean {
  return f.art === 'aufgabe' && SPIRAL_TYPEN.includes(f.aufgabe.typ);
}

// ---------- Auswahl ----------
const SCHWERE_GEWICHT: Record<Schwere, number> = { leicht: 4, mittel: 4, fies: 2 };

export interface AuswahlStand {
  benutzt: string[]; // ids der laufenden Runde
  letzte: string | null;
}
export const neuerAuswahlStand = (): AuswahlStand => ({ benutzt: [], letzte: null });

const index = (z: number, n: number): number => Math.min(n - 1, Math.max(0, Math.floor(z * n)));

// Zieht die naechste Frage: erst alle zulaessigen Fragen einer Runde, dann von vorn (nie dieselbe zweimal in Folge); die Schwere
// ist gemischt (leicht und mittel je 4, fies 2 Teile). Weniger als zwei zulaessige Fragen: frage null.
export const zaehleZulaessige = (bank: QuizBank, lage: Lage): number => bank.fragen.filter((f) => zulaessig(f, lage)).length;

export function waehleFrage(bank: QuizBank, stand: AuswahlStand, lage: Lage, zufall: Zufall = Math.random): { frage: Frage | null; stand: AuswahlStand } {
  const geeignet = bank.fragen.filter((f) => zulaessig(f, lage));
  // Weniger als zwei zulaessige Fragen: keine Auswahl moeglich ohne Wiederholung in Folge, der Riegel zeigt sich nicht.
  if (geeignet.length < 2) return { frage: null, stand };
  const ids = new Set(geeignet.map((f) => f.id));
  let benutzt = new Set(stand.benutzt.filter((i) => ids.has(i)));
  let rest = geeignet.filter((f) => !benutzt.has(f.id) && f.id !== stand.letzte);
  if (rest.length === 0) {
    benutzt = new Set(stand.letzte && ids.has(stand.letzte) ? [stand.letzte] : []);
    rest = geeignet.filter((f) => f.id !== stand.letzte);
  }
  const klassen = SCHWEREN.filter((s) => rest.some((f) => f.schwere === s));
  const summe = klassen.reduce((a, s) => a + SCHWERE_GEWICHT[s], 0);
  let w = zufall() * summe;
  let klasse = klassen[klassen.length - 1]!;
  for (const s of klassen) {
    if (w < SCHWERE_GEWICHT[s]) {
      klasse = s;
      break;
    }
    w -= SCHWERE_GEWICHT[s];
  }
  const pool = rest.filter((f) => f.schwere === klasse);
  const frage = pool[index(zufall(), pool.length)]!;
  benutzt.add(frage.id);
  return { frage, stand: { benutzt: [...benutzt], letzte: frage.id } };
}

// Reihenfolge der Antworten (Indizes in `antworten`), gemischt.
export function mischeReihenfolge(n: number, zufall: Zufall = Math.random): number[] {
  const o = Array.from({ length: n }, (_, i) => i);
  for (let i = n - 1; i > 0; i--) {
    const j = index(zufall(), i + 1);
    [o[i], o[j]] = [o[j]!, o[i]!];
  }
  return o;
}
export const istWahlRichtig = (f: FrageWahl, gewaehlt: number): boolean => gewaehlt === f.richtig;

// ---------- Verweigern ----------
export type Urteil = 'richtig' | 'falsch' | 'verweigert';

// Sitzung eines Riegels: Auswahl plus Verweigern. Falsch = sofort neue Frage (keine Wartezeit liegt hier). Verweigert wird nur eine
// richtige Antwort, mit dem eingestellten Anteil, und nie zwei Antworten hintereinander.
// Zustand, der ueber Riegel hinweg gilt (ein Tab: Modulebene im Content-Script): Auswahlstand (keine Wiederholung ueber Riegel hinweg) und
// ob die letzte richtige Antwort verweigert wurde.
export interface SitzungsZustand {
  stand: AuswahlStand;
  zuletztVerweigert: boolean;
}
export const neuerSitzungsZustand = (): SitzungsZustand => ({ stand: neuerAuswahlStand(), zuletztVerweigert: false });

// Sitzung eines Riegels: Auswahl plus Verweigern. Falsch = sofort neue Frage (keine Wartezeit liegt hier). Verweigert wird nur eine
// richtige Antwort, mit dem eingestellten Anteil. Nach einer Verweigerung gilt die Sperre, bis eine Antwort wirklich als `richtig`
// durchgeht: falsche Antworten dazwischen heben sie nicht auf.
export class QuizSitzung {
  private bank: QuizBank;
  private lage: Lage;
  private zufall: Zufall;
  private anteil: number;
  private z: SitzungsZustand;
  constructor(bank: QuizBank, lage: Lage, anteil: number, zufall: Zufall = Math.random, zustand: SitzungsZustand = neuerSitzungsZustand()) {
    this.bank = bank;
    this.lage = lage;
    this.zufall = zufall;
    this.anteil = Number.isFinite(anteil) ? Math.min(0.3, Math.max(0, anteil)) : 0;
    this.z = zustand;
  }
  naechste(): Frage | null {
    const r = waehleFrage(this.bank, this.z.stand, this.lage, this.zufall);
    this.z.stand = r.stand;
    return r.frage;
  }
  // Erzwingt die erste Frage (Tests): sie zaehlt als gezogen; unzulaessige Fragen werden nicht erzwungen (null).
  erzwinge(id: string): Frage | null {
    const f = this.bank.fragen.find((x) => x.id === id) ?? null;
    if (f && !zulaessig(f, this.lage)) return null; // auch erzwungen nur, was Geraet und Ruhig-Modus erlauben
    if (f && zulaessig(f, this.lage)) this.z.stand = { benutzt: [...this.z.stand.benutzt, f.id], letzte: f.id };
    return f;
  }
  bewerte(korrekt: boolean): Urteil {
    if (!korrekt) return 'falsch';
    if (this.z.zuletztVerweigert) {
      this.z.zuletztVerweigert = false;
      return 'richtig';
    }
    const verweigern = this.zufall() < this.anteil;
    this.z.zuletztVerweigert = verweigern;
    return verweigern ? 'verweigert' : 'richtig';
  }
}

// ---------- Tippen und Aufgaben pruefen ----------
// Abtippen: Gross- und Kleinschreibung, ALLE Satzzeichen (auch mitten im Satz, typografische Anfuehrungszeichen) und Leerraum sind egal;
// Woerter und Trigger muessen stimmen. Ein Apostroph zwischen Buchstaben bleibt Teil des Wortes ("don't" ist nicht "dont").
export function normalisiereTippen(s: string): string {
  return s
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u201b\u02bc\u00b4`]/g, "'")
    .replace(/(?<![\p{L}\p{N}])'|'(?![\p{L}\p{N}])/gu, ' ')
    .replace(/[^\p{L}\p{N}'\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}
export const pruefeTippen = (satz: string, eingabe: string): boolean => normalisiereTippen(satz) === normalisiereTippen(eingabe);

const woerterVon = (s: string): string[] => normalisiereTippen(s).split(' ').filter(Boolean);

export function pruefeWortTippen(eingabe: string, wort: string, anzahl: number): boolean {
  const w = woerterVon(eingabe);
  const soll = normalisiereTippen(wort);
  return w.length === anzahl && w.join(' ') === Array(anzahl).fill(soll).join(' ');
}
export function pruefeCountdown(eingabe: string, von: number, wort: string): boolean {
  const soll = [...Array.from({ length: von }, (_, i) => String(von - i)), ...normalisiereTippen(wort).split(' ')];
  const w = woerterVon(eingabe);
  return w.length === soll.length && w.every((x, i) => x === soll[i]);
}
// Beide ueber `normalisiereTippen`: Satzzeichen, Leerraum und Schreibweise sind egal ("OBEY." und "5." gelten).
export const pruefeZahl = (eingabe: string, n: number): boolean => /^\d{1,3}$/.test(normalisiereTippen(eingabe)) && Number(normalisiereTippen(eingabe)) === n;
export const pruefeBuchstaben = (eingabe: string, wort: string): boolean =>
  normalisiereTippen(eingabe).replace(/ /g, '') === normalisiereTippen(wort).replace(/ /g, '');

// Folge fuer `zaehlen`: `anzahl` Woerter, das Zielwort 2 bis zur Haelfte der Folge mal (nie zwei Mal nebeneinander), nie zwei gleiche
// Woerter direkt hintereinander; Rueckgabe samt richtiger Zahl.
export function waehleZaehlFolge(woerter: string[], wort: string, anzahl: number, zufall: Zufall = Math.random): { folge: string[]; richtig: number } {
  const ziel = wort.toLowerCase();
  const andere = woerter.filter((w) => w.toLowerCase() !== ziel);
  // mindestens zwei verschiedene Fuellwoerter, sonst mit Standardwoertern auffuellen (keine gleichen Nachbarn moeglich)
  const fuell = [...andere];
  for (const w of ['DOWN', 'OBEY', 'pink', 'DEEP']) if (fuell.length < 2 && w.toLowerCase() !== ziel && !fuell.includes(w)) fuell.push(w);
  const treffer = Math.min(Math.ceil(anzahl / 2), 2 + index(zufall(), Math.max(1, Math.floor(anzahl / 2) - 1)));
  // Plaetze fuer das Zielwort: zufaellig, keine zwei nebeneinander
  const plaetze = new Set<number>();
  for (const p of mischeReihenfolge(anzahl, zufall)) {
    if (plaetze.size >= treffer) break;
    if (!plaetze.has(p - 1) && !plaetze.has(p + 1)) plaetze.add(p);
  }
  const folge: string[] = [];
  for (let i = 0; i < anzahl; i++) {
    if (plaetze.has(i)) {
      folge.push(wort);
      continue;
    }
    const vorher = folge[i - 1];
    const wahl = fuell.length > 1 ? fuell.filter((w) => w !== vorher) : fuell;
    folge.push(wahl[index(zufall(), wahl.length)]!);
  }
  return { folge, richtig: plaetze.size };
}

// Folge fuer `pink-klicken`: ein Wort davon pink (nie das erste), nie zwei gleiche Woerter direkt hintereinander.
export function waehlePinkFolge(woerter: string[], anzahl: number, zufall: Zufall = Math.random): { folge: string[]; pink: number } {
  const folge: string[] = [];
  for (let i = 0; i < anzahl; i++) {
    const wahl = woerter.length > 1 ? woerter.filter((w) => w !== folge[i - 1]) : woerter;
    folge.push(wahl[index(zufall(), wahl.length)]!);
  }
  return { folge, pink: 1 + index(zufall(), Math.max(1, anzahl - 1)) };
}

// Buchstaben-Raetsel: gemischt, aber nie gleich dem Wort (wenn es einen anderen Ordnung gibt).
export function mischeBuchstaben(wort: string, zufall: Zufall = Math.random): string {
  const b = [...wort.replace(/\s+/g, '')];
  if (new Set(b).size < 2) return b.join(' ');
  for (let versuch = 0; versuch < 20; versuch++) {
    const o = mischeReihenfolge(b.length, zufall).map((i) => b[i]!);
    if (o.join('') !== b.join('')) return o.join(' ');
  }
  return [...b].reverse().join(' ');
}
