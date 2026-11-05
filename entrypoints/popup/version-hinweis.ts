// Popup: Platz #version-hinweis (Auftrag V, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 6). Der Platz wandert per DOM hinter den Pause-Knopf,
// damit ein spaet eintreffender Hinweis den Knopf nie verschiebt. Erst der gespeicherte Stand (ohne Abruf), dann `version { pruefen: true }`
// im Hintergrund; nur in Chrome und nur bei neuerer Version erscheint ein Satz mit dem Knopf "How to update" (oeffnet die Einstellungsseite
// bei #ueber). Firefox und alle Fehler: nichts.
import type { AntwortVersion } from '../../src/nachrichten';

const platz = document.getElementById('version-hinweis');

if (platz) {
  document.getElementById('pause')?.after(platz);
  const satz = document.createElement('p');
  satz.className = 'hinweis';
  satz.id = 'version-satz';
  const knopf = document.createElement('button');
  knopf.id = 'version-anleitung';
  knopf.className = 'klein';
  knopf.type = 'button';
  knopf.textContent = 'How to update';
  knopf.addEventListener('click', () => {
    void browser.tabs.create({ url: (browser.runtime.getURL as (p: string) => string)('/options.html#ueber') }).then(() => window.close());
  });
  platz.replaceChildren(satz, knopf);

  const zeige = (a: AntwortVersion | undefined) => {
    const neuer = !!a && a.ok === true && a.browser === 'chrome' && a.neuer && !!a.neueste;
    if (neuer) satz.textContent = `Version ${a.neueste} is out. You’re still on ${a.aktuell}.`;
    platz.hidden = !neuer;
  };
  const frage = async (pruefen: boolean): Promise<AntwortVersion | undefined> => {
    try {
      return (await browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'version', ...(pruefen ? { pruefen: true } : {}) })) as AntwortVersion | undefined;
    } catch {
      return undefined;
    }
  };
  void (async () => {
    zeige(await frage(false));
    zeige(await frage(true));
  })();
}
