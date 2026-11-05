// Synthetische Quiz-Bank und Saetze fuer das Dummy-Pack und die Tests (keine echten Inhalte, keine Mia-Texte; die echte Quiz-Bank
// liegt nur im Pack, Entscheidung 100). Schema: src/quiz/vertrag.ts. Tests lesen die richtigen Antworten von hier.
export const DUMMY_QUIZ = {
  version: 1,
  fragen: [
    { id: 'test-w1', art: 'wissen', schwere: 'leicht', frage: 'Test question one. Pick alpha.', antworten: ['alpha', 'beta', 'gamma'], richtig: 0 },
    { id: 'test-w2', art: 'wissen', schwere: 'mittel', frage: 'Test question two. Pick beta.', antworten: ['alpha', 'beta', 'gamma', 'delta'], richtig: 1 },
    { id: 'test-w3', art: 'wissen', schwere: 'fies', frage: 'Test question three. Pick gamma.', antworten: ['alpha', 'beta', 'gamma'], richtig: 2 },
    { id: 'test-a1', art: 'allgemein', schwere: 'leicht', frage: 'Test question four. Pick two.', antworten: ['one', 'two', 'three'], richtig: 1 },
    { id: 'test-a2', art: 'allgemein', schwere: 'mittel', frage: 'Test question five. Pick three.', antworten: ['one', 'two', 'three'], richtig: 2 },
    { id: 'test-t1', art: 'tippen', schwere: 'leicht', frage: 'Type the test line.', satz: 'This is a test line.' },
    { id: 'test-t2', art: 'tippen', schwere: 'fies', frage: 'Type the second test line.', satz: 'Second test line, DOWN.' },
    { id: 'test-h1', art: 'aufgabe', schwere: 'mittel', geraet: 'beide', frage: 'Type TEST three times.', aufgabe: { typ: 'wort-tippen', param: { wort: 'TEST', anzahl: 3 } } },
    { id: 'test-h2', art: 'aufgabe', schwere: 'leicht', geraet: 'beide', frage: 'Click the spiral 3 times.', aufgabe: { typ: 'klicken-zaehlen', param: { anzahl: 3, abstandMs: 500 } } },
    { id: 'test-h3', art: 'aufgabe', schwere: 'fies', geraet: 'desktop', frage: 'Look at the spiral. Do not move the mouse.', aufgabe: { typ: 'spirale-ansehen', param: { sekunden: 5 } } },
    { id: 'test-h4', art: 'aufgabe', schwere: 'mittel', geraet: 'touch', frage: 'Hold your finger on the spiral.', aufgabe: { typ: 'finger-halten', param: { sekunden: 5 } } },
  ],
};

export const DUMMY_TEXTE = {
  version: 1,
  gruppen: {
    start: ['Test start line.'],
    richtig: ['Test right line.'],
    falsch: ['Test wrong line.'],
    verweigert: ['Test refused line.'],
    freigelegt: ['Test reveal line, {{seconds}} seconds.'],
    wiederZensiert: ['Test censored again line.'],
    titel: ['Test title: {{title}}'],
    begruessung: ['Test greeting line.'],
    stufe1: ['Test level one line.'],
    stufe2: ['Test level two line.'],
    stufe3: ['Test level three line.'],
    stufe4: ['Test level four line.'],
    // Phase 5 (Session 9): Blitzwoerter, Satz der Leerlauf-Spirale, Kennzeichnung der getauschten Werbung (muss "Mia" enthalten).
    blitzwoerter: ['TESTWORD', 'TESTFLASH', 'TESTDOWN'],
    leerlauf: ['Test idle line.'],
    werbung: ['Test ad by Mia'],
    // Session 10: Tab-Titel, Meldungen je Anlass (`{{count}}` nur und Pflicht in meldungZensiert), Hinweis vor einem Pflicht-Besuch.
    tabtitel: ['Test tab title one', 'Test tab title two'],
    meldungZensiert: ['Test censored {{count}} line.'],
    meldungStufe: ['Test level up line.'],
    meldungErwachsen: ['Test adult time line.'],
    meldungStreng: ['Test strict time line.'],
    besuch: ['Test visit line.'],
  },
};
