// Eingebaute Texte des Abschnitts "Sound" auf der Einstellungsseite (Entwuerfe, Texter liest gegen). Als Konstanten, damit Tests dagegen
// pruefen und nicht gegen den Wortlaut. Amerikanisches Englisch in Mias Stimme, typografisches Apostroph, keine Gedankenstriche.
export const TON_TEXTE = {
  titel: 'Sound',
  schalterTitel: 'My sounds',
  schalterHinweis: 'A little snap or chime when my quiz starts, when you answer, and when my flash words come.',
  lautstaerke: 'Volume',
  probe: 'Play a sample',
  regel: 'Only for my quiz and flash words, never on sites I leave alone. Pause Mia silences me.',
  hinweisAltesPack: 'My sounds need a newer Mia Pack. Set your volume now and it’ll be ready.',
  hinweisOhnePack: 'My sounds come with the Mia Pack. Set your volume now, so they’re ready.',
  probeKeinKlang: 'I can’t find a sound in your Mia Pack to play.',
  probeGespielt: 'That’s how loud I’ll be.',
  probeStumm: 'That’s silent. Slide the volume up to hear me.',
  probeAbgelehnt: 'Your browser didn’t let me play that. Try once more.',
  probePause: 'I’m paused, so I stay quiet. Let me back in to hear a sample.',
} as const;
