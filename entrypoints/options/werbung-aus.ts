// Einstellungsseite, "Mia’s control": Liste "Sites without my ads" (Session 17, Fund 3). Das Etikett-Menue der Werbung kann "Hide my ads on this
// site" in `kontrolle.werbungAus` ablegen; hier steht die Liste und jeder Eintrag laesst sich mit einem Knopf zuruecknehmen. Das Modul haengt seinen
// Block per Code hinter den Schalter "My ads" (#kon-werbung-zeile) und fasst kontrolle.ts nicht an. Leere Liste: der Block bleibt verborgen.
import { FEHLER_SPEICHERN } from '../../src/oberflaeche/gemeinsam';
import { aendereEinstellungen, beiEinstellungsAenderung, ladeEinstellungen, type Einstellungen } from '../../src/einstellungen';

export const WERBUNG_AUS_TEXTE = {
  titel: 'Sites without my ads',
  hinweis: 'You asked me to keep my ads off these sites.',
  zurueck: 'Show my ads here again',
  danach: (muster: string) => `${muster} gets my ads again.`,
} as const;

const zeile = document.getElementById('kon-werbung-zeile');
if (zeile) {
  const block = document.createElement('div');
  block.id = 'kon-werbung-aus';
  block.hidden = true;
  const titel = document.createElement('h3');
  titel.id = 'kon-werbung-aus-titel';
  titel.className = 'regel-titel';
  titel.textContent = WERBUNG_AUS_TEXTE.titel;
  const hinweis = document.createElement('p');
  hinweis.className = 'hinweis';
  hinweis.textContent = WERBUNG_AUS_TEXTE.hinweis;
  const ul = document.createElement('ul');
  ul.id = 'kon-werbung-aus-liste';
  ul.className = 'liste';
  ul.setAttribute('aria-labelledby', titel.id);
  const meldung = document.createElement('p');
  meldung.id = 'kon-werbung-aus-meldung';
  meldung.setAttribute('role', 'status');
  meldung.setAttribute('aria-live', 'polite');
  block.append(titel, hinweis, ul);
  // Hinter den Schalter (und hinter den Hilfe-Rahmen, falls ordnung.ts ihn schon darum gelegt hat). Die Statuszeile steht direkt hinter dem
  // Block, nicht darin: nimmt die Person den letzten Eintrag zurueck, verschwindet der Block, die Bestaetigung bleibt sichtbar und hoerbar
  // (Lesung 17 R2-7).
  const anker = zeile.parentElement?.classList.contains('mit-hilfe') ? zeile.parentElement : zeile;
  anker.after(block, meldung);

  let gezeichnet = '';
  const zeichne = (e: Einstellungen): void => {
    const liste = e.kontrolle.werbungAus;
    block.hidden = liste.length === 0;
    const schluessel = JSON.stringify(liste);
    if (schluessel === gezeichnet) return;
    const vorher = JSON.parse(gezeichnet || '[]') as string[];
    gezeichnet = schluessel;
    const fokusMuster = (document.activeElement as HTMLElement | null)?.dataset?.muster ?? null;
    ul.replaceChildren();
    for (const muster of liste) {
      const li = document.createElement('li');
      const name = document.createElement('span');
      name.textContent = muster;
      const knopf = document.createElement('button');
      knopf.type = 'button';
      knopf.className = 'klein ruhig';
      knopf.dataset.muster = muster;
      knopf.textContent = WERBUNG_AUS_TEXTE.zurueck;
      knopf.setAttribute('aria-label', `${WERBUNG_AUS_TEXTE.zurueck}: ${muster}`);
      knopf.addEventListener('click', () => {
        const stelle = (JSON.parse(gezeichnet) as string[]).indexOf(muster);
        void aendereEinstellungen((alt) => ({ kontrolle: { ...alt.kontrolle, werbungAus: alt.kontrolle.werbungAus.filter((m) => m !== muster) } })).then(
          (neu) => {
            meldung.classList.remove('fehler');
            meldung.textContent = WERBUNG_AUS_TEXTE.danach(muster);
            zeichne(neu);
            // Fokus nicht verlieren: naechster Knopf, sonst der vorherige, sonst der Schalter.
            const knoepfe = ul.querySelectorAll<HTMLButtonElement>('button');
            (knoepfe[Math.min(stelle, knoepfe.length - 1)] ?? zeile.querySelector<HTMLInputElement>('input'))?.focus();
          },
          () => {
            meldung.classList.add('fehler');
            meldung.textContent = FEHLER_SPEICHERN;
          },
        );
      });
      li.append(name, knopf);
      ul.append(li);
      if (muster === fokusMuster && vorher.includes(muster)) knopf.focus();
    }
  };
  void ladeEinstellungen().then(zeichne, () => undefined);
  beiEinstellungsAenderung(zeichne);
}
