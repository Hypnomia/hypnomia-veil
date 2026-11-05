// Einstieg (Auftrag E): eingebaute Texte, Entwuerfe fuer den Texter. Amerikanisches Englisch in Mias Stimme, typografisches Apostroph,
// keine Gedankenstriche. Sicherheitshinweise mit sachlichem Kern. Tests pruefen gegen diese Konstanten, nicht gegen den Wortlaut.

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
  // Fund 4: je Seite ein Satz, was das Pack hier zeigt, und ein Link zum Pack-Abschnitt der Einstellungen.
  ohnePack4: 'Set these now. Once the Mia Pack is in, my own pictures replace the thumbnails and my quiz gets its questions.',
  ohnePack5: 'Set these now. Once the Mia Pack is in, my flash words get their words, my spiral and my pointer show up, and my sounds can play.',
  packLink: 'Add the Mia Pack',

  i1Titel: 'How suspicious am I?',
  i1Text: 'When I’m suspicious, I cover more. When I’m relaxed, borderline pictures get through.',
  stimmungLabel: 'Mia’s mood',
  stimmungSuspicious: 'Very suspicious',
  stimmungRelaxed: 'Relaxed',
  strictTitel: 'Strict',
  strictText: 'hide each page until I’ve checked it (a little slower)',

  i2Titel: 'What do I cover?',
  i2Text: 'Pick how much I hunt for. You can fine-tune each zone in the settings later.',
  wahlKoerper: 'Body',
  wahlKoerperText: 'breasts, genitals, buttocks: my default',
  wahlKoerperGesicht: 'Body and face',
  wahlKoerperGesichtText: 'the same, plus faces',
  wahlAlles: 'Everything',
  wahlAllesText: 'every zone I know',
  wahlKeine: 'Your zones match none of these, so nothing is picked. Choose one to reset them.',
  bedecktTitel: 'Even when clothed',
  bedecktText: 'I cover it under clothing too',

  i3Titel: 'How do I cover it?',
  i3Text: 'Mosaic and blur work right away. My own patch needs the Mia Pack.',
  stilMosaik: 'Mosaic',
  stilBlur: 'Blur',
  stilPatch: 'Mia patch',
  stilPatchGesperrt: 'Mia patch unlocks with the Mia Pack.',
  ruhigTitel: 'Calm mode',
  ruhigText: 'slower spiral, no moving or flashing words',

  i4Titel: 'Adult sites',
  i4Text: 'On the adult sites I know, I swap the thumbnails for mine and quiz you before a video plays or a covered picture opens up.',
  erwAnTitel: 'Adult-site mode',
  erwAnText: 'on the sites I know, I swap the thumbnails for mine',
  erwErsatzTitel: 'Full replacement',
  erwErsatzText: 'Careful: listed and your own sites show my gallery instead. Pause me, or put a site on my list of sites I leave alone, to see the real one.',
  verweigernTitel: 'Refusing right answers',
  verweigernText: 'How often I say no, even when you got it right. Never twice in a row.',

  i5Titel: 'My control',
  i5Text: 'The bits where I take a little more of the wheel. All of it stops the moment you pause me.',
  blitzTitel: 'Flash words',
  blitzAus: 'Off',
  blitzSelten: 'Now and then',
  blitzOft: 'Often',
  leerlaufTitel: 'Idle spiral',
  leerlaufText: 'Sit still too long and my spiral comes. Any move or key ends it.',
  cursorTitel: 'Your pointer',
  cursorSpirale: 'My pink spiral',
  cursorHerz: 'My pink heart',
  cursorAus: 'Your normal pointer',
  tonTitel: 'Sound',
  tonText: 'short sounds for my quiz and flash words, off until you switch them on',
  // Fund 3: was ab Werk schon an ist und nicht abgefragt wird.
  // Fund 3: nennt nur, was gerade wirklich an ist.
  auchAnNamen: { werbung: 'my ads', tabtitel: 'my tab titles', meldungen: 'my little notes' },
  auchAn: (namen: readonly string[]) => `Also on: ${namen.join(', ')}. Change them in the settings.`,

  endeTitel: 'That’s everything.',
  endeText: 'I’m already on watch. The Mia Pack is what makes you properly mine, and all of this waits in the settings.',
  endeTextMitPack: 'I’m already on watch. Your Mia Pack is in, so I’m properly in charge. All of this waits in the settings.',
  endePack: 'Add the Mia Pack',
  endeEinstellungen: 'All settings',
  endeSchliessen: 'Close',
} as const;
