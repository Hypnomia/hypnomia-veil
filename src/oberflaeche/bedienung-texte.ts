// Gemeinsame Texte der neuen Bedienung (Phase 11 E4t, Festlegung W11): was Einstellungsseite und Interview gleich zeigen, steht genau einmal hier
// (Zonenwahl, Kleidungsfrage, Karten der Erwachsenenseiten, die Saetze zu verworfenen Handlungen). Die Namen kommen aus dem Woerterbuch in gemeinsam.ts.
// Englisch, Mias Stimme, typografisches Apostroph, keine Gedankenstriche. Reine Daten, keine Laufzeit-Importe (Einheitstests mit Node).
import { NAME_ERWACHSEN, NAME_HITZE, NAME_KLEIDUNG, NAME_ZONEN } from './gemeinsam.ts';

// Der Hinweis zur Stimmung (Einstellungsseite, Interview, Popup: im Popup steht er als Literal in index.html, ein Einheitstest haelt die Gleichheit).
export const STIMMUNG_HINWEIS = 'When I’m suspicious, I cover more. When I’m relaxed, borderline pictures get through.';

export const ZONEN_TEXTE = {
  titel: NAME_ZONEN,
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
  titel: NAME_KLEIDUNG,
  erklaerung: {
    knopfLabel: 'What does this do?',
    text: 'One answer for every zone I can find under clothes. “Under clothes too” covers it even when it’s dressed. “Bare skin only” leaves clothed parts alone.',
  },
  antworten: {
    haut: { titel: 'Bare skin only', satz: 'I cover only what is bare.' },
    'auch-bedeckt': { titel: 'Under clothes too', satz: 'I cover these parts even when they are clothed.' },
  },
} as const;

// Die Teile des einen Hinweises der Kleidungsfrage bei einem gemischten Stand (keine Antwort markiert). "Nichts unter Kleidung" sagt, dass etwas NICHT
// verdeckt wird, und wird nie verdraengt (W5); der Satz "Pick an answer ..." ist der gewoehnliche Teil.
export const KLEIDUNG_HEUTE_NICHTS = 'Right now I cover nothing under clothes.';
export const KLEIDUNG_HEUTE = (namen: readonly string[]): string => `Right now I also cover under clothes: ${namen.join(', ')}.`;
export const KLEIDUNG_ANTWORT_GILT = 'Pick an answer and it counts for every zone.';

export const ERWACHSEN_TEXTE = {
  titel: NAME_HITZE,
  karten: {
    off: { titel: 'Off', satz: 'I treat them like any other site.' },
    on: { titel: 'On', satz: 'Extra care: when I cover a preview clip there, I cover all of it.' },
    tease: { titel: 'Tease', satz: 'I only hint.' },
    hot: { titel: 'Hot', satz: 'I show more.' },
    explicit: { titel: 'Explicit', satz: 'Nothing held back.' },
  },
  // Die drei Stufen bleiben gesperrt: ohne Pack und mit einem Pack ohne `erwachsen:vorschau` (K10, zwei Wortlaute).
  gesperrt: 'My pictures set how hot I get, so Tease, Hot and Explicit unlock with the Mia Pack.',
  gesperrtAltesPack: 'My pictures set how hot I get, so Tease, Hot and Explicit need a newer Mia Pack.',
} as const;

// Eine Zonen-Handlung, die verworfen wurde, weil sich der gespeicherte Stand zwischen Anzeige und Klick geaendert hat.
export const ZONEN_VERWORFEN = 'Your zones changed elsewhere while you chose, so I kept the saved ones. Choose again if you still want it.';

// Eine Wahl der Erwachsenenseiten, die verworfen wurde, weil sich die Form der Gruppe zwischen Klick und Speichern geaendert hat (Pack kam oder ging).
export const ERWACHSEN_VERWORFEN = `${NAME_ERWACHSEN} changed elsewhere while you chose, so I kept the saved choice. Choose again if you still want it.`;

// ---------- Custom-Baukasten (Phase 11 E6b, B11) ----------
// Karte "Custom" in der Gruppe "Your own mix" und die drei Zeilen darunter (nur Einstellungsseite). Der Satz unter der Wahl steht an der Definition (CUSTOM_SATZ in src/presets.ts).
export const BAUKASTEN_TEXTE = {
  gruppe: 'Your own mix',
  karte: 'Custom',
  zeilen: { face: 'Face', flaeche: 'Everything else', woerter: 'Words' },
  face: { nothing: 'Nothing', bar: 'Bar', mia: 'My face', sticker: 'Sticker', mosaik: 'Mosaic', blur: 'Blur', schwarz: 'Black' },
  flaeche: { schwarz: 'Black', mosaik: 'Mosaic', blur: 'Blur', sticker: 'Stickers' },
  hinweisNothing: 'Faces stay open. Face is off in your zones.',
  hinweisBar: 'Just a black bar over the eyes. The rest of the face stays open.',
  hinweisWortNein: 'Words need Black or Mosaic to sit on.',
  // Ein Baustein ohne Freischaltung: Name fuer Vorleser (Antippen startet die Schau); steht er schon im Speicher, gilt der eine Satz (auch im Popup).
  gesperrtName: (name: string): string => `${name}, comes with my Pack, preview`,
  gespeichertGesperrt: 'Part of your mix needs my Pack. That part is Mosaic for now.',
} as const;

// Schau gesperrter Stile ohne Pack (E6b B8): die Marke an der Kachel, der Satz (Karte oder Baustein) und der Knopf zum Beenden. Die Schau schreibt nichts.
export const SCHAU_TEXTE = {
  marke: 'Pack',
  satzKarte: 'With my Pack it looks like this. Right now I use Mosaic for you.',
  satzBaustein: 'With my Pack it looks like this. Right now that part is Mosaic.',
  zurueck: 'Back to yours',
  // Name des Bedienelements einer gesperrten Karte fuer Vorleser
  kartenName: (name: string): string => `${name}, comes with my Pack, preview`,
} as const;

// Interview (B9): Custom hat dort keine Karte; steht es im Speicher, sagt diese Zeile es.
export const INTERVIEW_CUSTOM_ZEILE = 'Your own mix is on. You change it in the settings.';
