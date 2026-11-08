// Einstellungsseite, Abschnitt "About" (Auftrag V, PHASE-6-AUFTRAEGE-SESSION-11.md Abschnitt 6): Version und Baudatum, Stand des Updates
// (Chrome: neueste Version mit Anleitung in vier Schritten; Firefox: "Firefox keeps me up to date by itself."), "Check now", Links der Marke.
// Alle Texte nur per textContent; Links nur aus data/links.json und RELEASE_URL.
import './ueber.css';
import links from '../../data/links.json';
import type { AntwortVersion } from '../../src/nachrichten';
import { RELEASE_URL } from '../../src/version/vertrag';
import { hilfeAdresse, type HilfeAnker } from '../../src/hilfe/anker';

const abschnitt = document.getElementById('ueber');

function neu<K extends keyof HTMLElementTagNameMap>(art: K, text?: string, klasse?: string): HTMLElementTagNameMap[K] {
  const e = document.createElement(art);
  if (text !== undefined) e.textContent = text;
  if (klasse) e.className = klasse;
  return e;
}

function link(text: string, ziel: string): HTMLAnchorElement {
  const a = neu('a', text);
  a.href = ziel;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  return a;
}

// Saetze (Entwuerfe, Texter liest gegen).
export const UEBER_TEXTE = {
  titel: 'About and help',
  mehr: 'More from me: pausing, help pages',
  hilfeAlle: 'All help pages',
  hilfeThemen: [
    ['Pin me to the toolbar', 'pin'],
    ['Pausing me', 'pause'],
    ['Uninstalling me', 'uninstall'],
    ['What’s new', 'updates'],
  ] as const satisfies readonly (readonly [string, HilfeAnker])[],
  aktuell: 'You’re on my newest version.',
  fehler: 'Couldn’t check just now. Try again later.',
  firefox: 'Firefox keeps me up to date by itself.',
  firefoxOhnePruefung: 'Firefox updates me by itself. Nothing for you to do.',
  firefoxErgebnis: {
    update_available: 'A newer me is waiting. Firefox installs it by itself.',
    no_update: 'Nothing newer right now. You’re up to date.',
    throttled: 'Firefox just looked. Try again in a little while.',
    unbekannt: 'Couldn’t check just now. Try again later.',
  },
  chromeNetz: 'At most once a day I ask GitHub if there’s a newer me. No sign-in, and I send nothing about you.',
  pause: 'Pausing me is always allowed and never costs a thing (the Pause Mia button up top, my popup, or Alt+Shift+M on a desktop), and uninstalling works the normal way, any time.',
  schritte: [
    'Grab the new package from the release page.',
    'Unpack it into the very same folder as before and replace the old files, so the new manifest.json sits exactly where the old one was.',
    'Open chrome://extensions (edge://extensions in Edge), find HYPNOMIA VEIL and click Reload (the round arrow in Chrome).',
    'Never move that folder, or your browser forgets me.',
  ],
} as const;

function neueVersion(neueste: string): string {
  return `Version ${neueste} is out. Here’s how you get it:`;
}

if (abschnitt) {
  const titel = neu('h2', UEBER_TEXTE.titel);
  titel.id = 'ueber-titel';
  const zeileVersion = neu('p');
  const version = neu('span');
  version.id = 'ue-version';
  const datum = neu('span');
  datum.id = 'ue-datum';
  zeileVersion.append(neu('span', 'Version '), version, neu('span', ', built '), datum, neu('span', '.'));

  const stand = neu('p', '', 'ue-stand');
  stand.id = 'ue-stand';
  stand.setAttribute('role', 'status');
  stand.setAttribute('aria-live', 'polite');

  const anleitung = neu('ol', undefined, 'ue-anleitung');
  anleitung.id = 'ue-anleitung';
  anleitung.hidden = true;
  UEBER_TEXTE.schritte.forEach((satz, i) => {
    const li = neu('li');
    if (i === 0) {
      const [vor = '', nach = ''] = satz.split('release page');
      li.append(neu('span', vor), link('release page', RELEASE_URL), neu('span', nach));
    } else {
      li.textContent = satz;
    }
    anleitung.append(li);
  });

  const zeile = neu('div', undefined, 'ue-zeile');
  const knopf = neu('button', 'Check now', 'klein');
  knopf.id = 'ue-pruefen';
  knopf.type = 'button';
  const netz = neu('p', '', 'hinweis');
  netz.id = 'ue-netz';
  netz.hidden = true;
  // Nacht N2 (Messziel Fund 4): Version und "Check now" in einer Zeile.
  zeileVersion.id = 'ue-version-zeile';
  zeile.append(zeileVersion, knopf);

  const linkListe = neu('ul', undefined, 'ue-links');
  linkListe.id = 'ue-links';
  for (const [text, ziel] of [
    ['lnk.bio', links.linkbio],
    ['Patreon', links.patreon],
    ['SubscribeStar', links.subscribestar],
  ] as const) {
    const li = neu('li');
    li.append(link(text, ziel));
    linkListe.append(li);
  }
  const pause = neu('p', UEBER_TEXTE.pause, 'hinweis');
  pause.id = 'ue-pause';

  // Hilfe-Seite und die Themen, nach denen man hier am ehesten sucht (Anker aus src/hilfe/anker.ts, immer in neuem Tab).
  const hilfeListe = neu('ul', undefined, 'ue-links');
  hilfeListe.id = 'ue-hilfe';
  for (const [text, kurz] of [[UEBER_TEXTE.hilfeAlle, undefined], ...UEBER_TEXTE.hilfeThemen] as const) {
    const li = neu('li');
    li.append(link(text, hilfeAdresse(kurz)));
    hilfeListe.append(li);
  }

  // Nacht N2 (Messziel Fund 4): Pause-Satz und Hilfe-Themen zugeklappt unter "More"; derselbe Pause-Satz steht kurz in der Fusszeile, "Help" in der Leiste.
  const mehr = neu('details', undefined, 'ue-mehr');
  mehr.id = 'ue-mehr';
  const mehrTitel = neu('summary', UEBER_TEXTE.mehr);
  mehrTitel.id = 'ue-mehr-titel';
  mehr.append(mehrTitel, pause, hilfeListe);

  // Das Interview (#abschnitt-interview, index.html) bleibt als letztes Kind stehen; grund-pack.ts blendet es nach dem Einstieg ein.
  abschnitt.prepend(titel, zeile, stand, anleitung, netz, linkListe, mehr);

  // Firefox 128 kennt runtime.requestUpdateCheck nicht: dann gibt es keinen Knopf, nur den Status-Satz.
  const kannPruefen = !import.meta.env.FIREFOX || typeof (browser.runtime as unknown as { requestUpdateCheck?: unknown }).requestUpdateCheck === 'function';
  knopf.hidden = !kannPruefen;

  const zeige = (a: AntwortVersion, ergebnis?: string) => {
    version.textContent = a.aktuell;
    datum.textContent = a.datum || 'unknown';
    stand.classList.remove('fehler');
    anleitung.hidden = true;
    netz.hidden = a.browser !== 'chrome';
    netz.textContent = a.browser === 'chrome' ? UEBER_TEXTE.chromeNetz : '';
    if (a.browser === 'firefox') {
      stand.textContent = ergebnis ?? (kannPruefen ? UEBER_TEXTE.firefox : UEBER_TEXTE.firefoxOhnePruefung);
      if (ergebnis !== undefined && a.firefoxStatus === 'unbekannt') stand.classList.add('fehler');
      return;
    }
    if (a.neuer && a.neueste) {
      stand.textContent = neueVersion(a.neueste);
      anleitung.hidden = false;
    } else if (a.fehler) {
      stand.textContent = UEBER_TEXTE.fehler;
      stand.classList.add('fehler');
    } else if (a.geprueft !== null && a.neueste) {
      stand.textContent = UEBER_TEXTE.aktuell;
    } else {
      stand.textContent = '';
    }
  };

  const frage = async (n: { pruefen?: boolean; erzwingen?: boolean }): Promise<AntwortVersion | null> => {
    try {
      const a = (await browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'version', ...n })) as AntwortVersion | undefined;
      return a && a.ok === true ? a : null;
    } catch {
      return null;
    }
  };

  // Beim Oeffnen: Chrome prueft, wenn faellig; Firefox zeigt nur den Stand.
  void frage({ pruefen: true }).then((a) => {
    if (a) zeige(a);
    else {
      stand.textContent = UEBER_TEXTE.fehler;
      stand.classList.add('fehler');
    }
  });

  knopf.addEventListener('click', () => {
    knopf.disabled = true;
    void frage({ erzwingen: true })
      .then((a) => {
        if (!a) {
          stand.textContent = UEBER_TEXTE.fehler;
          stand.classList.add('fehler');
          return;
        }
        zeige(a, a.browser === 'firefox' ? UEBER_TEXTE.firefoxErgebnis[a.firefoxStatus ?? 'unbekannt'] : undefined);
      })
      .finally(() => {
        knopf.disabled = false;
      });
  });
}
