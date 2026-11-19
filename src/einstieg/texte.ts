// Einstieg (Auftrag E): eingebaute Texte, Entwuerfe fuer den Texter. Amerikanisches Englisch in Mias Stimme, typografisches Apostroph,
// keine Gedankenstriche. Sicherheitshinweise mit sachlichem Kern. Tests pruefen gegen diese Konstanten, nicht gegen den Wortlaut.
import { stimmungsWort } from '../oberflaeche/gemeinsam.ts';
import { STUFENLISTEN } from '../oberflaeche/bausteine/stufen-daten.ts';
import type { StufenListe } from '../oberflaeche/bausteine/stufen.ts';

export const TEXT = {
  seitenTitel: 'HYPNOMIA VEIL: Welcome',
  schrittVon: (nr: number, von: number) => `Step ${nr} of ${von}`,
  // Fund 19: beim Wiederholen des Interviews zaehlen nur die Interview-Seiten.
  frageVon: (nr: number, von: number) => `Question ${nr} of ${von}`,

  warnungTitel: 'Before you begin',
  // Wortlaut der SFW-Zeile aus SICHERHEITSGRENZEN.md
  warnungKern: 'Not for you if you have photosensitive epilepsy or are prone to seizures.',
  warnungText:
    'Some of my tricks flash words or spin a spiral across your screen. I never go past 3 full-screen changes per second, and Calm mode slows my spiral and turns flash words off. Limits aren’t a guarantee, though. If any of this could harm you, stop here and remove me.',
  warnungEntfernen: 'Want out? Removing me is easy:',
  warnungOk: 'I understand',
  // Fund 8: Calm mode gleich auf der Warnseite anbieten.
  warnungRuhig: 'Calm mode on, then continue',
  // Fund 19: Etappen unter der Bahn, die aktuelle ist fett.
  etappen: { warnung: 'Safety', alter: 'Age', einwilligung: 'Consent', interview: 'Questions' },
  etappenAria: 'Steps',

  alterTitel: 'Adults only',
  alterFrage: 'I’m strictly for grown-ups. Are you 18 or older, and is adult content legal where you are?',
  alterJa: 'Yes, both',
  alterNein: 'No',
  // aria-label am Ja-Knopf: der volle Satz der Zusage
  alterJaAria: 'I’m 18 or older, and adult content is legal where I am.',
  alterZurueck: 'I tapped the wrong one',
  alterAbsage: 'Then I’m not for you. Good call. I didn’t save your answer. Remove me like this:',
  entfernenChrome: 'Open chrome://extensions (edge://extensions in Edge), find HYPNOMIA VEIL and click Remove.',
  entfernenFirefox: 'In Firefox, open the menu, go to Add-ons, find HYPNOMIA VEIL and choose Remove.',

  einwilligungTitel: 'Handing me the reins',
  einwilligungPunkte: [
    'You’re handing me control over how your browser looks and acts. Freely, on purpose, and only because you want to.',
    'Pausing me is always allowed and never costs a thing: the button in my popup, or Alt+Shift+M on a desktop. Everything stops at once.',
    'Uninstalling works the normal way, any time. No lock, no trick.',
    'Sharing this browser or computer? Whoever uses it sees what I do, my pictures and flash words included.',
    'Nothing about you leaves your browser: no account, no analytics. What does go out is a second look at a page’s own pictures so I can check them, a version check at most once a day (Chrome and Edge only), and, with Visits on, my own pages opening in a new tab.',
  ],
  // Fund 2: ehrlich sagen, was schon laeuft und was bei "Not now" gilt.
  einwilligungLaeuft: 'I’m already covering pictures. Agree to unlock the Mia Pack.',
  einwilligungOk: 'I agree',
  einwilligungNein: 'Not now',
  einwilligungNeinHinweis: 'Not now? I keep covering pictures, and the pack waits. The Meet Mia button in my popup brings you back here.',

  weiter: 'Next',
  zurueck: 'Back',
  fertig: 'Finish',
  ueberspringen: 'Skip the rest',
  ueberspringenHinweis: 'Skipping keeps everything on the next pages as it is. On a fresh install, that’s exactly how I like it.',

  // ---------- Interview (Phase 11 E4e, Regeln I1 bis I11; Texte vorlaeufig, die Texterin legt sie in Schritt (e) fest) ----------
  // Namen der Schritte links (mit Pack alle sechs, ohne Pack die ersten vier).
  schritteNamen: ['Zones', 'Clothes', 'Style', 'Mood', 'Adult sites', 'Extras'],
  schritteAria: 'Questions',
  vorschauKopf: 'Preview',
  vorschauLabel: 'Preview of your cover style',

  // 1 Zones
  i1Titel: 'What do I cover?',
  i1Text: 'Pick how much I hunt for. You can fine-tune each zone in the settings later.',
  // 2 Clothes
  i2Titel: 'Also under clothes?',
  i2Text: 'One answer for every part I can cover under clothes.',
  // 3 Style
  i3Titel: 'How do I cover it?',
  i3Text: 'Classic and Whole person work right away. The styles with my face need the Mia Pack.',
  // Fund 8: Calm mode steht ohne Pack auf der Stil-Seite (er wirkt dort auf bewegte Stile).
  ruhigTitel: 'Calm mode',
  ruhigText: 'slower spiral, no moving or flashing words',
  // 4 Mood
  i4Titel: 'How suspicious am I?',
  i4Text: 'When I’m suspicious, I cover more. When I’m relaxed, borderline pictures get through.',
  strictTitel: 'Strict',
  strictText: 'hide each page until I’ve checked it (a little slower)',
  // 5 Adult sites (nur mit Pack beim Einstieg)
  i5Titel: 'Adult sites',
  i5Text: 'On the adult sites I know, I swap the thumbnails for mine. The quiz, full replacement and your own sites wait in the settings.',
  // Nur wenn Komplett-Ersatz gespeichert an ist: der Warnsatz bleibt sichtbar, auch wenn das Interview den Schalter nicht mehr fragt (Regel I8 (5)).
  ersatzAn: 'Full replacement is on, set in the settings: listed and your own sites show my gallery instead. Pause me, or put a site on my list of sites I leave alone, to see the real one.',
  // 6 Extras (nur mit Pack beim Einstieg)
  i6Titel: 'Calm or playful?',
  i6Text: 'The bits where I take a little more of the wheel. All of it stops the moment you pause me.',
  blitzTitel: 'Flash words',
  blitzAus: 'Off',
  blitzSelten: 'Now and then',
  blitzOft: 'Often',
  // Fund 4: je Seite ein Satz, was das Pack hier zeigt, und ein Link zum Pack-Abschnitt der Einstellungen.
  ohnePack5: 'Set these now. Once the Mia Pack is in, my own pictures replace the thumbnails and my quiz gets its questions.',
  ohnePack6: 'Set these now. Once the Mia Pack is in, my flash words get their words, my spiral and my pointer show up, and my sounds can play.',
  packLink: 'Get the Mia Pack',

  // Bausteine (Zonenwahl, Kleidungsfrage, Stufenwahl, Gruppe der Erwachsenenseiten): dieselben Namen wie auf der Einstellungsseite.
  zonenTitel: 'Zones',
  zonenKarten: {
    koerper: { titel: 'Body', satz: 'Breasts, genitals and buttocks.' },
    'koerper-gesicht': { titel: 'Body and face', satz: 'The body, and faces as well.' },
    alles: { titel: 'Everything', satz: 'All ten zones.' },
  },
  zonenEinzeln: { titel: 'Pick zones one by one', stand: (an: number, gesamt: number): string => `${an} of ${gesamt} on`, gruppenLabel: 'Zones, one by one' },
  zonenNamen: {
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
  },
  wahlKeine: 'Your zones match none of these, so nothing is picked. Choose one to reset them.',
  // Eine Zonen-Handlung, die verworfen wurde, weil sich der gespeicherte Stand zwischen Anzeige und Klick geaendert hat.
  zonenVerworfen: 'The zones changed somewhere else while you were choosing, so I kept the saved ones. Choose again if you still want it.',
  kleidungTitel: 'Under clothes',
  kleidungErklaerung: {
    knopfLabel: 'What does this do?',
    text: 'One answer for every zone that can be covered under clothes. “Under clothes too” covers it even when it is dressed. “Bare skin only” leaves clothed parts alone.',
  },
  kleidungAntworten: {
    haut: { titel: 'Bare skin only', satz: 'I cover only what is bare.' },
    'auch-bedeckt': { titel: 'Under clothes too', satz: 'I cover these parts even when they are clothed.' },
  },
  // Der eine Hinweis der Frage bei einem gemischten Stand (keine Antwort markiert): nennt genau, was heute unter Kleidung gedeckt wird.
  kleidungHeuteNichts: 'Right now I cover nothing under clothes.',
  kleidungHeute: (namen: readonly string[]) => `Right now I also cover under clothes: ${namen.join(', ')}.`,
  kleidungAntwortGilt: 'Pick an answer and it counts for every zone.',
  stimmungTitel: 'Mood',
  stimmungExakt: { titel: 'Exact value', reglerLabel: 'Exact mood value' },
  erwachsenTitel: 'My pictures on adult sites',
  erwachsenKarten: {
    off: { titel: 'Off', satz: 'No picture swaps on adult sites.' },
    on: { titel: 'On', satz: 'I treat adult sites as adult sites.' },
    tease: { titel: 'Tease', satz: 'I only hint.' },
    hot: { titel: 'Hot', satz: 'I show more.' },
    explicit: { titel: 'Explicit', satz: 'Nothing held back.' },
  },
  // Ohne die Freischaltung `erwachsen:vorschau` bleiben die drei Stufen gesperrt.
  erwachsenGesperrt: 'My pictures decide how hot I get, so this unlocks with the Mia Pack.',
  // Fund 3: was ab Werk schon an ist und nicht abgefragt wird.
  // Fund 3: nennt nur, was gerade wirklich an ist.
  auchAnNamen: { werbung: 'my ads', tabtitel: 'my tab titles', meldungen: 'my little notes' },
  // Fund 21: eigener Absatz, der Link fuehrt zu den Einstellungen.
  auchAn: (namen: readonly string[]) => `Also on: ${namen.join(', ')}.`,
  auchAnLink: 'Change them in the settings',

  endeTitel: 'That’s everything.',
  endeText: 'I’m already on watch. The Mia Pack is what makes you properly mine, and all of this waits in the settings.',
  endeTextMitPack: 'I’m already on watch. Your Mia Pack is in, so I’m properly in charge. All of this waits in the settings.',
  endePack: 'Get the Mia Pack',
  endeEinstellungen: 'All settings',
  endeSchliessen: 'Close',
  endeHilfe: 'Help and guides',
  // Fund 3: Checkliste zum Abschluss, je Browser erkannt.
  endeListeAria: 'Three things to know',
  endePinTitel: 'Pin me.',
  endePinChrome: 'Click the puzzle piece next to the address bar, then the pin next to HYPNOMIA VEIL. In Edge it may be an eye.',
  endePinFirefox: 'Click the puzzle piece in the toolbar, then the gear next to HYPNOMIA VEIL, and choose Pin to Toolbar.',
  endePinTitelAndroid: 'Find me.',
  endePinAndroid: 'Firefox menu (three dots), Extensions, HYPNOMIA VEIL.',
  endePinLink: 'More on pinning',
  endePauseTitel: 'Pause any time.',
  endePauseNurPopup: 'Pause Mia, at the top of my popup.',
  endePauseKuerzel: (kuerzel: string) => `Pause Mia in my popup, or ${kuerzel}.`,
  endeVersuchTitel: 'Try me.',
  endeVersuch: 'Open any page with pictures and watch me veil them.',
} as const;

// Zahl ohne Gleitkomma-Reste, sonst genau: 0.1049 bleibt 0.1049 (kein Runden auf zwei Stellen), wie auf der Einstellungsseite.
export function zahlGenau(wert: number): string {
  return String(Number(wert.toPrecision(12)));
}

// Namen der Stimmung wie auf der Einstellungsseite: die Woerter, die `stimmungsWort` fuer die drei Stufenwerte liefert (ein Wortschatz mit Kopf und Popup),
// wenn das drei verschiedene sind, sonst die Platzhalter aus STUFENLISTEN. Ein Test in Chromium vergleicht sie mit den Stufen der Einstellungsseite.
export const STIMMUNG_STUFEN_INTERVIEW: StufenListe = (() => {
  const basis = STUFENLISTEN.stimmung;
  const woerter = basis.stufen.map((st) => stimmungsWort(st.wert));
  if (new Set(woerter).size !== basis.stufen.length) return basis;
  return { ...basis, stufen: basis.stufen.map((st, i) => ({ name: woerter[i] as string, wert: st.wert })) };
})();
