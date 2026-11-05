// Einstellungsseite, Abschnitt "Sites I leave alone" (Session 11, Auftrag S): eigene Ausnahmeliste ansehen, Host hinzufuegen, entfernen.
// Bisher ging das nur im Popup fuer die aktuelle Seite. Die Standardliste (Banken, Mail) ist nicht aenderbar, hier steht nur ihre Zahl.
import liste from '../../data/ausnahmen-standard.json';
import { musterAusListe, passtAusnahme, zerlegeMuster } from '../../scripts/ausnahmen-muster.mjs';
import { FEHLER_SPEICHERN } from '../../src/oberflaeche/gemeinsam';
import { aendereEinstellungen, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';

function el<T extends HTMLElement>(id: string): T {
  const e = document.getElementById(id);
  if (!e) throw new Error(`Element #${id} fehlt`);
  return e as T;
}

const form = el<HTMLFormElement>('ausnahme-form');
const feld = el<HTMLInputElement>('ausnahme-feld');
const meldung = el<HTMLParagraphElement>('ausnahme-meldung');
const ul = el<HTMLUListElement>('ausnahmen-liste');
const standardZahl = el<HTMLSpanElement>('ausnahmen-standard');
const statusAusnahmen = el<HTMLParagraphElement>('status-ausnahmen');

const standardMuster: string[] = musterAusListe(liste);

// Oeffentliche Endungen und Hoster, unter denen viele fremde Seiten liegen: als Ausnahme wuerden sie sehr viele Seiten ausnehmen.
const OEFFENTLICHE_ENDUNGEN = new Set([
  'co.uk', 'org.uk', 'ac.uk', 'gov.uk', 'me.uk', 'com.au', 'net.au', 'org.au', 'co.nz', 'co.jp', 'co.in', 'co.za', 'com.br', 'com.mx', 'com.cn', 'com.tr', 'com.ar',
  'github.io', 'gitlab.io', 'netlify.app', 'vercel.app', 'herokuapp.com', 'blogspot.com', 'wordpress.com', 'web.app', 'firebaseapp.com', 'pages.dev', 'workers.dev', 'appspot.com', 'azurewebsites.net', 'cloudfront.net', 's3.amazonaws.com',
]);

// "https://www.Example.com/pfad" wird zu "example.com/pfad", "bücher.de" zu "xn--bcher-kva.de" (wie im Popup ueber URL.hostname): Schema, fuehrendes
// www. und "*." weg, Endschraegstrich weg. Liefert den Grund, wenn die Eingabe nicht taugt.
function musterAus(eingabe: string): { muster: string } | { grund: 'adresse' | 'endung' } {
  const roh = eingabe.trim().toLowerCase().replace(/^\*\./, '');
  if (!roh) return { grund: 'adresse' };
  let url: URL;
  try {
    url = new URL(/^[a-z][a-z0-9+.-]*:\/\//.test(roh) ? roh : `https://${roh}`);
  } catch {
    return { grund: 'adresse' };
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return { grund: 'adresse' };
  const host = url.hostname.replace(/^www\./, '').replace(/\.$/, '');
  const pfad = url.pathname.replace(/\/+$/, '');
  const muster = host + pfad;
  const z = zerlegeMuster(muster);
  // Mindestens zwei Labels, sonst waere "com" eine Ausnahme fuer alles darunter.
  if (!z || z.host.split('.').length < 2) return { grund: 'adresse' };
  if (OEFFENTLICHE_ENDUNGEN.has(z.host)) return { grund: 'endung' };
  return { muster };
}

const alsAdresse = (muster: string): URL => new URL(`https://${muster.includes('/') ? muster : `${muster}/`}`);

// Gezaehlt werden verschiedene Seiten (Hosts), nicht Muster: Pfadmuster wie amazon.de/gp/buy gehoeren zur selben Seite.
const standardSeiten = new Set(standardMuster.map((m) => zerlegeMuster(m)?.host ?? m)).size;
standardZahl.textContent = `My never-touch list keeps ${standardSeiten} sites safe from me, like banks and mail. That list is fixed.`;

let gezeichnet = '';
let aktuellListe: string[] = [];
function zeichne(e: Einstellungen): void {
  aktuellListe = e.ausnahmen;
  statusAusnahmen.textContent =
    e.ausnahmen.length === 0 ? 'You haven’t asked me to leave a single site alone.' : `${e.ausnahmen.length} ${e.ausnahmen.length === 1 ? 'site' : 'sites'} you asked me to leave alone.`;
  const schluessel = JSON.stringify(e.ausnahmen);
  if (schluessel === gezeichnet) return;
  gezeichnet = schluessel;
  const fokusMuster = (document.activeElement as HTMLElement | null)?.dataset?.muster ?? null;
  ul.replaceChildren();
  if (e.ausnahmen.length === 0) {
    const leer = document.createElement('li');
    leer.className = 'leer';
    leer.textContent = 'Nothing here yet. Outside my never-touch list, I’m on watch everywhere.';
    ul.append(leer);
    return;
  }
  for (const muster of e.ausnahmen) {
    const li = document.createElement('li');
    const name = document.createElement('span');
    name.textContent = muster;
    const weg = document.createElement('button');
    weg.type = 'button';
    weg.className = 'klein ruhig';
    weg.dataset.muster = muster;
    weg.textContent = 'Remove';
    weg.setAttribute('aria-label', `Remove ${muster}`);
    weg.addEventListener('click', () => {
      const stelle = (JSON.parse(gezeichnet) as string[]).indexOf(muster);
      void aendereEinstellungen((alt) => ({ ausnahmen: alt.ausnahmen.filter((m) => m !== muster) })).then(
        (neu) => {
          meldung.classList.remove('fehler');
          meldung.textContent = `${muster} is back under my watch.`;
          zeichne(neu);
          // Fokus nicht verlieren: naechster Knopf, sonst der vorherige, sonst das Eingabefeld.
          const knoepfe = ul.querySelectorAll<HTMLButtonElement>('button');
          (knoepfe[Math.min(stelle, knoepfe.length - 1)] ?? feld).focus();
        },
        () => {
          meldung.classList.add('fehler');
          meldung.textContent = FEHLER_SPEICHERN;
        },
      );
    });
    li.append(name, weg);
    ul.append(li);
    if (muster === fokusMuster) weg.focus();
  }
}

form.addEventListener('submit', (ereignis) => {
  ereignis.preventDefault();
  const ergebnis = musterAus(feld.value);
  meldung.classList.toggle('fehler', !('muster' in ergebnis));
  if (!('muster' in ergebnis)) {
    meldung.textContent =
      ergebnis.grund === 'endung'
        ? 'That ending is shared by a whole crowd of unrelated sites, and I’d leave every one of them alone. Add the exact address instead.'
        : 'That doesn’t look like a site address. Try something like example.com.';
    return;
  }
  const muster = ergebnis.muster;
  // Schon abgedeckt (gleiches Muster, uebergeordneter Host oder Pfad), wie das Popup mit passtAusnahme.
  const deckt = aktuellListe.find((m) => passtAusnahme(alsAdresse(muster), [m]));
  if (deckt) {
    meldung.classList.remove('fehler');
    meldung.textContent = deckt === muster ? `${muster} is on your list already.` : `${muster} is already on your list through ${deckt}.`;
    feld.value = '';
    return;
  }
  if (passtAusnahme(alsAdresse(muster), standardMuster)) {
    meldung.classList.remove('fehler');
    meldung.textContent = `${muster} is on my never-touch list already.`;
    feld.value = '';
    return;
  }
  let schonDa = false;
  aendereEinstellungen((alt) => {
    schonDa = alt.ausnahmen.includes(muster);
    return schonDa ? {} : { ausnahmen: [...alt.ausnahmen, muster] };
  }).then(
    (neu) => {
      meldung.classList.remove('fehler');
      meldung.textContent = schonDa ? `${muster} is on your list already.` : `Added ${muster}. I’ll leave it alone from now on.`;
      feld.value = '';
      zeichne(neu);
    },
    () => {
      meldung.classList.add('fehler');
      meldung.textContent = FEHLER_SPEICHERN;
    },
  );
});

const abmelden = beiEinstellungsAenderung(zeichne);
window.addEventListener('pagehide', abmelden, { once: true });
void ladeEinstellungen().then(zeichne);
