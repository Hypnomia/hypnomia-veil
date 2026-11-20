// Einstellungsseite, Texte und Listen der Bedienelemente aus den Bausteinen (Phase 11 E4d2, E4t). Die Texte sind die freigegebenen (E4t) und stehen je Text an genau einer
// Stelle: was Einstellungsseite und Interview gleich zeigen, liegt in src/oberflaeche/bedienung-texte.ts (hier wieder ausgegeben), die Namen im Woerterbuch
// src/oberflaeche/gemeinsam.ts. Amerikanisches Englisch in Mias Stimme, typografisches Apostroph, keine Gedankenstriche.
import { STUFENLISTEN, type StufenListe } from '../../src/oberflaeche/bausteine/bausteine';
import { NAME_FREILEGEN, NAME_STIMMUNG, NAME_VERWEIGERN, STIMMUNG_WOERTER, ZONEN_NAMEN } from '../../src/oberflaeche/gemeinsam';
import { STIMMUNG_HINWEIS } from '../../src/oberflaeche/bedienung-texte';
import { waehleKleidungHinweis } from '../../src/oberflaeche/hinweise';
import { zonenUnterKleidung } from '../../src/oberflaeche/bausteine/bausteine';
import type { ZonenStand } from '../../src/einstieg/zonen';
import { TON_TEXTE } from '../../src/ton/texte';

export { ZONEN_NAMEN };
export { ERWACHSEN_TEXTE, ERWACHSEN_VERWORFEN, KLEIDUNG_TEXTE, ZONEN_TEXTE, ZONEN_VERWORFEN } from '../../src/oberflaeche/bedienung-texte';

// Der eine Hinweis der Frage bei einem gemischten Stand (keine Antwort markiert): nennt genau die Zonen, die heute eingeschaltet UND unter Kleidung
// gedeckt sind (`zonenUnterKleidung`), nie mehr als gespeichert ist. Die Wahl des Hinweises ist die reine Funktion `waehleKleidungHinweis`.
export function kleidungHinweis(zonen: ZonenStand, verworfen = false): string {
  const namen = zonenUnterKleidung(zonen).map((z) => ZONEN_NAMEN[z]);
  return waehleKleidungHinweis({ gemischt: true, namen, verworfen }) ?? '';
}

// ---------- Stufen (F3) ----------

// Namen der Stimmung: die eine Liste aus stufen-daten.ts (ihre Namen sind die Woerter von `stimmungsWort`, ein Einheitstest prueft es).
export const STIMMUNG_STUFEN: StufenListe = STUFENLISTEN.stimmung;

// Zahl ohne Gleitkomma-Reste, sonst genau: 0.1049 bleibt 0.1049 (kein Runden auf zwei Stellen).
function zahl(wert: number): string {
  return String(Number(wert.toPrecision(12)));
}

export const STIMMUNG_TEXTE = {
  titel: NAME_STIMMUNG,
  hinweis: STIMMUNG_HINWEIS,
  erklaerung: {
    knopfLabel: 'What does this do?',
    text: `My mood sets how readily I cover a picture that could go either way. Exact value lets you pick any point from ${STIMMUNG_WOERTER[0]} to a little past ${STIMMUNG_WOERTER[3]}.`,
  },
  exakt: { titel: 'Exact value', formatiere: (w: number): string => zahl(w), reglerLabel: 'Exact mood value' },
};

export const VERWEIGERN_TEXTE = {
  titel: NAME_VERWEIGERN,
  hinweis: 'I may refuse even a right answer, never twice in a row. Pause Mia is always free.',
  exakt: { titel: 'Exact value', formatiere: (w: number): string => `${zahl(w * 100)}%`, reglerLabel: 'Exact refusal rate' },
};

export const FREILEGEN_TEXTE = {
  titel: NAME_FREILEGEN,
  exakt: { titel: 'Exact value', formatiere: (w: number): string => `${zahl(w / 1000)} s`, reglerLabel: 'Exact reveal time' },
};

export const LAUTSTAERKE_TEXTE = {
  titel: TON_TEXTE.lautstaerke,
  exakt: { titel: 'Exact value', formatiere: (w: number): string => `${zahl(w * 100)}%`, reglerLabel: 'Exact volume' },
};
