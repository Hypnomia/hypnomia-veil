// Zusammenfassung: Zaehlung je Zone und Satz (nur gepruefte Eintraege), getrennt nach
// geprueft / nur Vorschlag / nichts, Liste der noch nicht geprueften Bilder.
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
  armpits: 'Achseln',
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
  const vorschlag = d.vorschlag ?? {};
  const zeileMarkiert = document.createElement('tr');
  zeileMarkiert.append(zelle('Bilder geprüft / gesamt'));
  const zeileKein = document.createElement('tr');
  zeileKein.append(zelle('davon "kein Mensch"'));
  const zeileVorschlag = document.createElement('tr');
  zeileVorschlag.append(zelle('nur Vorschlag (nicht geprüft)'));
  const zeileNichts = document.createElement('tr');
  zeileNichts.append(zelle('nichts (weder geprüft noch Vorschlag)'));
  for (const satz of SAETZE) {
    const e = eintraege(satz);
    const t = zelle(`${e.length} / ${d.saetze[satz].length}`);
    t.colSpan = 2;
    zeileMarkiert.append(t);
    const k = zelle(e.filter((x) => x.kein_mensch).length);
    k.colSpan = 2;
    zeileKein.append(k);
    const nurV = d.saetze[satz].filter((f) => !d.bilder[`${satz}/${f}`] && vorschlag[`${satz}/${f}`]).length;
    const v = zelle(nurV);
    v.colSpan = 2;
    zeileVorschlag.append(v);
    const n = zelle(d.saetze[satz].length - e.length - nurV);
    n.colSpan = 2;
    zeileNichts.append(n);
  }
  fuss.append(zeileMarkiert, zeileKein, zeileVorschlag, zeileNichts);

  const ul = document.createElement('ul');
  ul.className = 'unmarkiert';
  let offen = 0;
  let offenVorschlag = 0;
  for (const satz of SAETZE) {
    for (const datei of d.saetze[satz]) {
      if (d.bilder[`${satz}/${datei}`]) continue;
      offen += 1;
      const hatVorschlag = !!vorschlag[`${satz}/${datei}`];
      if (hatVorschlag) offenVorschlag += 1;
      const li = document.createElement('li');
      const a = document.createElement('a');
      a.href = `/#${encodeURIComponent(satz)}/${encodeURIComponent(datei)}`;
      a.textContent = hatVorschlag ? `${satz}/${datei} (Vorschlag)` : `${satz}/${datei}`;
      li.append(a);
      ul.append(li);
    }
  }
  const ziel = document.getElementById('unmarkiert');
  if (offen === 0) ziel.textContent = 'Alle Bilder sind geprüft.';
  else ziel.append(ul);

  const gesamt = SAETZE.reduce((s, x) => s + d.saetze[x].length, 0);
  document.getElementById('uebersicht').textContent =
    `nsfw: ${d.anzahl.nsfw} Bilder, sfw: ${d.anzahl.sfw} Bilder. Geprüft ${gesamt - offen} von ${gesamt}, nur Vorschlag ${offenVorschlag}, nichts ${offen - offenVorschlag}.`;
}

start().catch((e) => {
  document.getElementById('uebersicht').textContent = `Fehler: ${e.message}`;
});
