// Popup: Platz #ledger-kurz (Auftrag L, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 5). Eine Zeile aus Mia’s Ledger: die heute zugedeckten Bilder
// (auch 0, mit eigenem Satz). Folgt Aenderungen im Speicher. Text nur per textContent.
import { LEDGER_SCHLUESSEL } from '../../src/ledger/vertrag';
import { neuerTag, vervollstaendigeLedger } from '../../src/ledger/logik';
import { popupZeile } from '../../src/ledger/texte';

const platz = document.getElementById('ledger-kurz');

if (platz) {
  const zeige = (roh: unknown): void => {
    const jetzt = new Date();
    const l = neuerTag(vervollstaendigeLedger(roh, jetzt), jetzt);
    platz.textContent = popupZeile(l.heute.zensiert);
    platz.hidden = false;
  };
  browser.storage.local.get(LEDGER_SCHLUESSEL).then(
    (ablage) => zeige(ablage[LEDGER_SCHLUESSEL]),
    () => zeige(undefined),
  );
  browser.storage.onChanged.addListener((aenderungen, bereich) => {
    if (bereich !== 'local' || !(LEDGER_SCHLUESSEL in aenderungen)) return;
    zeige(aenderungen[LEDGER_SCHLUESSEL].newValue);
  });
}
