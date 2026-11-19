// Einstellungsseite, Texte und Listen der Bedienelemente aus den Bausteinen (Phase 11 E4d2, Entscheidungen 245, 279, 280). Alle Texte sind
// vorlaeufig (die Texterin legt sie in Schritt (e) fest) und stehen nur hier; die Bausteine enthalten selbst keinen Satz.
// Amerikanisches Englisch in Mias Stimme, typografisches Apostroph, keine Gedankenstriche.
import type { Zone } from '../../src/einstellungen';
import { STUFENLISTEN, zonenUnterKleidung, type StufenListe } from '../../src/oberflaeche/bausteine/bausteine';
import type { ZonenStand } from '../../src/einstieg/zonen';
import { stimmungsWort } from '../../src/oberflaeche/gemeinsam';
import { TON_TEXTE } from '../../src/ton/texte';

export const ZONEN_NAMEN: Record<Zone, string> = {
  eyes: 'Eyes',
  mouth: 'Mouth',
  face: 'Face',
  head: 'Head',
  breast: 'Breasts',
  genitals: 'Genitals',
  buttocks: 'Buttocks',
  belly: 'Belly',
  feet: 'Feet',
  armpits: 'Armpits',
};

// ---------- Zonen und Kleidung (F1, F2) ----------

export const ZONEN_TEXTE = {
  titel: 'Zones',
  karten: {
    koerper: { titel: 'Body', satz: 'Breasts, genitals and buttocks.' },
    'koerper-gesicht': { titel: 'Body and face', satz: 'The body, and faces as well.' },
    alles: { titel: 'Everything', satz: 'All ten zones.' },
  },
  einzeln: {
    titel: 'Pick zones one by one',
    stand: (an: number, gesamt: number): string => `${an} of ${gesamt} on`,
    gruppenLabel: 'Zones, one by one',
  },
} as const;

export const KLEIDUNG_TEXTE = {
  titel: 'Also under clothes?',
  erklaerung: {
    knopfLabel: 'What does this do?',
    text: 'One answer for every zone that can be covered under clothes. “Under clothes too” covers it even when it is dressed. “Bare skin only” leaves clothed parts alone.',
  },
  antworten: {
    haut: { titel: 'Bare skin only', satz: 'I cover only what is bare.' },
    'auch-bedeckt': { titel: 'Under clothes too', satz: 'I cover these parts even when they are clothed.' },
  },
} as const;

// Der eine Hinweis der Frage bei einem gemischten Stand (keine Antwort markiert): nennt genau die Zonen, die heute eingeschaltet UND unter Kleidung
// gedeckt sind (`zonenUnterKleidung`), nie mehr als gespeichert ist. Die Antwort setzt den Stand fuer alle sechs bedeckbaren Zonen.
export function kleidungHinweis(zonen: ZonenStand): string {
  const liste = zonenUnterKleidung(zonen).map((z) => ZONEN_NAMEN[z]);
  const heute = liste.length === 0 ? 'Right now I cover nothing under clothes.' : `Right now I also cover under clothes: ${liste.join(', ')}.`;
  return `${heute} Pick an answer and it counts for every zone.`;
}

// ---------- Stufen (F3) ----------

// Namen der Stimmung: die Woerter, die `stimmungsWort` fuer die drei Stufenwerte liefert (derselbe Wortschatz wie Kopf der Seite und Popup), wenn das
// drei verschiedene sind; sonst die Platzhalter des Entwurfs (Careful, Normal, Relaxed) aus STUFENLISTEN.
function stimmungsListe(): StufenListe {
  const basis = STUFENLISTEN.stimmung;
  const woerter = basis.stufen.map((s) => stimmungsWort(s.wert));
  if (new Set(woerter).size !== basis.stufen.length) return basis;
  return { ...basis, stufen: basis.stufen.map((s, i) => ({ name: woerter[i] as string, wert: s.wert })) };
}
export const STIMMUNG_STUFEN: StufenListe = stimmungsListe();

// Zahl ohne Gleitkomma-Reste, sonst genau: 0.1049 bleibt 0.1049 (kein Runden auf zwei Stellen).
function zahl(wert: number): string {
  return String(Number(wert.toPrecision(12)));
}

export const STIMMUNG_TEXTE = {
  titel: 'How suspicious am I?',
  hinweis: 'When I’m suspicious, I cover more. When I’m relaxed, borderline pictures get through.',
  erklaerung: { knopfLabel: 'What does this do?', text: 'The mood sets how readily I cover a picture that could go either way. The three words are the usual settings; Exact value sets any value between them.' },
  exakt: { titel: 'Exact value', formatiere: (w: number): string => zahl(w), reglerLabel: 'Exact mood value' },
};

export const VERWEIGERN_TEXTE = {
  titel: 'How often I refuse a right answer',
  hinweis: 'Never twice in a row. Pause Mia is always free, whatever I say.',
  exakt: { titel: 'Exact value', formatiere: (w: number): string => `${zahl(w * 100)}%`, reglerLabel: 'Exact refusal value' },
};

export const FREILEGEN_TEXTE = {
  titel: 'How long a picture stays uncovered after a quiz',
  exakt: { titel: 'Exact value', formatiere: (w: number): string => `${zahl(w / 1000)} s`, reglerLabel: 'Exact uncovered time' },
};

export const LAUTSTAERKE_TEXTE = {
  titel: TON_TEXTE.lautstaerke,
  exakt: { titel: 'Exact value', formatiere: (w: number): string => `${zahl(w * 100)}%`, reglerLabel: 'Exact volume' },
};

// ---------- Erwachsenenseiten (F4) ----------

export const ERWACHSEN_TEXTE = {
  titel: 'My pictures on adult sites',
  karten: {
    off: { titel: 'Off', satz: 'No picture swaps on adult sites.' },
    on: { titel: 'On', satz: 'I treat adult sites as adult sites.' },
    tease: { titel: 'Tease', satz: 'I only hint.' },
    hot: { titel: 'Hot', satz: 'I show more.' },
    explicit: { titel: 'Explicit', satz: 'Nothing held back.' },
  },
  // Ohne Pack mit `erwachsen:vorschau` bleibt die Stufe gesperrt wie bisher (der Satz stand an der Stufenwahl).
  gesperrt: 'My pictures decide how hot I get, so this unlocks with the Mia Pack.',
} as const;

// G3: eine Zonen-Handlung, die verworfen wurde, weil sich der gespeicherte Stand zwischen Anzeige und Klick geaendert hat (vorlaeufig, Texterin in Schritt (e)).
export const ZONEN_VERWORFEN = 'The zones changed somewhere else while you were choosing, so I kept the saved ones. Choose again if you still want it.';

// K2: eine Wahl in der Gruppe der Erwachsenenseiten, die verworfen wurde, weil sich die Form der Gruppe zwischen Klick und Speichern geaendert hat (Pack kam oder ging); vorlaeufig, Texterin in Schritt (e).
export const ERWACHSEN_VERWORFEN = 'The adult sites choices changed while you were choosing, so I kept the saved one. Choose again if you still want it.';
