// Zusammenfassung: Zaehlung je Zone und Satz, Liste der unmarkierten Bilder.
'use strict';

const NAMEN = {
  eyes: 'Augen',
  mouth: 'Mund',
  face: 'Gesicht',
  head: 'ganzer Kopf',
  breast: 'Brust',
  genitals: 'Intimbereich',
  buttocks: 'Po',
  belly: 'Bauch',
  feet: 'Füße',
  hands: 'Hände',
};
const SAETZE = ['nsfw', 'sfw'];

function zelle(text, tag = 'td') {
  const z = document.createElement(tag);
  z.textContent = String(text);
  return z;
}

async function start() {
  const antwort = await fetch('/api/liste');
  const d = await antwort.json();

  const eintraege = (satz) =>
    d.saetze[satz].map((datei) => d.bilder[`${satz}/${datei}`]).filter(Boolean);

  const zeilen = document.getElementById('zeilen');
  for (const zone of d.zonen) {
    const tr = document.createElement('tr');
    tr.append(zelle(NAMEN[zone] ?? zone));
    for (const satz of SAETZE) {
      const e = eintraege(satz);
      tr.append(zelle(e.filter((x) => x.sichtbar.includes(zone)).length));
      tr.append(zelle(e.filter((x) => x.bedeckt.includes(zone)).length));
    }
    zeilen.append(tr);
  }

  const fuss = document.getElementById('fuss');
  const zeileMarkiert = document.createElement('tr');
  zeileMarkiert.append(zelle('Bilder markiert / gesamt'));
  const zeileKein = document.createElement('tr');
  zeileKein.append(zelle('davon "kein Mensch"'));
  for (const satz of SAETZE) {
    const e = eintraege(satz);
    const t = zelle(`${e.length} / ${d.saetze[satz].length}`);
    t.colSpan = 2;
    zeileMarkiert.append(t);
    const k = zelle(e.filter((x) => x.kein_mensch).length);
    k.colSpan = 2;
    zeileKein.append(k);
  }
  fuss.append(zeileMarkiert, zeileKein);

  const ul = document.createElement('ul');
  ul.className = 'unmarkiert';
  let offen = 0;
  for (const satz of SAETZE) {
    for (const datei of d.saetze[satz]) {
      if (d.bilder[`${satz}/${datei}`]) continue;
      offen += 1;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `/#${encodeURIComponent(satz)}/${encodeURIComponent(datei)}`;
      a.textContent = `${satz}/${datei}`;
      li.append(a);
      ul.append(li);
    }
  }
  const ziel = document.getElementById('unmarkiert');
  if (offen === 0) ziel.textContent = 'Alle Bilder sind markiert.';
  else ziel.append(ul);

  const gesamt = SAETZE.reduce((s, x) => s + d.saetze[x].length, 0);
  document.getElementById('uebersicht').textContent =
    `nsfw: ${d.anzahl.nsfw} Bilder, sfw: ${d.anzahl.sfw} Bilder. Markiert insgesamt ${gesamt - offen} von ${gesamt}.`;
}

start().catch((e) => {
  document.getElementById('uebersicht').textContent = `Fehler: ${e.message}`;
});
