// Popup: Platz #version-hinweis (Auftrag V, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 6). Der Platz wandert per DOM hinter den Pause-Knopf,
// damit ein spaet eintreffender Hinweis den Knopf nie verschiebt. Erst der gespeicherte Stand (ohne Abruf), dann `version { pruefen: true }`
// im Hintergrund; nur in Chrome und nur bei neuerer Version erscheint ein Satz mit dem Knopf "How to update" (oeffnet die Einstellungsseite
// bei #ueber). Firefox und alle Fehler: nichts.
import type { AntwortVersion } from '../../src/nachrichten';
import { hilfeAdresse } from '../../src/hilfe/anker';
import { NEUES_LINK } from './texte';

const platz = document.getElementById('version-hinweis');

if (platz) {
  // Unter den leisen Zeilen der Pause (Kuerzel, Pausenzeile), nie zwischen Knopf und diesen Zeilen; der Knopf bleibt, wo er ist.
  (document.getElementById('pause-zeile') ?? document.getElementById('pause'))?.after(platz);
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
  // Fund 27: was neu ist, steht in der Hilfe (Anker `updates`), Erweiterungsseite im neuen Tab.
  const neues = document.createElement('a');
  neues.id = 'version-neues';
  neues.className = 'textlink';
  neues.href = hilfeAdresse('updates');
  neues.target = '_blank';
  neues.rel = 'noopener';
  neues.textContent = NEUES_LINK;
  const knoepfe = document.createElement('div');
  knoepfe.className = 'version-knoepfe';
  knoepfe.append(knopf, neues);
  platz.replaceChildren(satz, knoepfe);

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
