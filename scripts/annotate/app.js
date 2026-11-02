// Oberflaeche des Markierwerkzeugs. Alles lokal, es wird nichts hochgeladen.
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

const el = (id) => document.getElementById(id);

const zustand = {
  zonen: [],
  saetze: { nsfw: [], sfw: [] },
  bilder: {}, // gespeicherte (gepruefte) Eintraege, Schluessel "satz/datei"
  vorschlag: {}, // Modellvorschlag, nur zur Vorbelegung, nie ein gespeicherter Eintrag
  nurVorschlag: false, // Entwurf stammt aus dem Vorschlag und ist noch nicht gespeichert
  satz: 'nsfw',
  index: 0,
  entwurf: null, // Arbeitskopie des aktuellen Bildes
  veraendert: false,
  beschaeftigt: false,
};

const leerEintrag = () => ({ sichtbar: [], bedeckt: [], kein_mensch: false, notiz: '' });

const schluessel = (satz, datei) => `${satz}/${datei}`;
const aktuelleDatei = () => zustand.saetze[zustand.satz][zustand.index] ?? null;
const aktuellerSchluessel = () => {
  const d = aktuelleDatei();
  return d ? schluessel(zustand.satz, d) : null;
};

function meldung(text, warnung = false) {
  const s = el('status');
  s.textContent = text;
  s.classList.toggle('warn', warnung);
}

async function api(methode, pfad, body) {
  const antwort = await fetch(pfad, {
    method: methode,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const daten = await antwort.json().catch(() => ({}));
  if (!antwort.ok) throw new Error(daten.fehler || `Fehler ${antwort.status}`);
  return daten;
}

async function ladeListe() {
  const d = await api('GET', '/api/liste');
  zustand.zonen = d.zonen;
  zustand.saetze = d.saetze;
  zustand.bilder = d.bilder;
  zustand.vorschlag = d.vorschlag && typeof d.vorschlag === 'object' ? d.vorschlag : {};
}

// ---------- Aufbau ----------

function baueZonenTabelle() {
  const tbody = el('zonen');
  tbody.textContent = '';
  zustand.zonen.forEach((zone, i) => {
    const tr = document.createElement('tr');
    const name = document.createElement('td');
    name.className = 'name';
    name.textContent = NAMEN[zone] ?? zone;
    const kbd = document.createElement('kbd');
    kbd.textContent = String((i + 1) % 10);
    name.append(kbd);
    tr.append(name);
    for (const art of ['sichtbar', 'bedeckt']) {
      const td = document.createElement('td');
      const label = document.createElement('label');
      label.className = 'wahl';
      const box = document.createElement('input');
      box.type = 'checkbox';
      box.dataset.zone = zone;
      box.dataset.art = art;
      box.setAttribute('aria-label', `${NAMEN[zone] ?? zone}: ${art === 'sichtbar' ? 'sichtbar (unbedeckt)' : 'bedeckt/bekleidet'}`);
      box.addEventListener('change', () => {
        schalteListe(art, zone, box.checked);
      });
      label.append(box);
      td.append(label);
      tr.append(td);
    }
    tbody.append(tr);
  });
}

function schalteListe(art, zone, an) {
  const liste = zustand.entwurf[art];
  const i = liste.indexOf(zone);
  if (an && i < 0) liste.push(zone);
  if (!an && i >= 0) liste.splice(i, 1);
  zustand.veraendert = true;
  zeichneEntwurf();
}

function zeichneEntwurf() {
  const e = zustand.entwurf;
  for (const box of document.querySelectorAll('#zonen input')) {
    box.checked = e[box.dataset.art].includes(box.dataset.zone);
    box.disabled = e.kein_mensch;
  }
  document.querySelector('.zonen').classList.toggle('gesperrt', e.kein_mensch);
  el('kein-mensch').checked = e.kein_mensch;
  if (document.activeElement !== el('notiz')) el('notiz').value = e.notiz;
}

function zaehleMarkiert(satz) {
  return zustand.saetze[satz].filter((d) => zustand.bilder[schluessel(satz, d)]).length;
}

/** Bilder ohne gespeicherten Eintrag, aber mit Modellvorschlag. */
function zaehleNurVorschlag(satz) {
  return zustand.saetze[satz].filter((d) => {
    const k = schluessel(satz, d);
    return !zustand.bilder[k] && zustand.vorschlag[k];
  }).length;
}

/** Wandelt einen Vorschlag in einen Entwurf; unbekannte Zonen werden verworfen. */
function entwurfAusVorschlag(v) {
  const bekannt = (x) => (Array.isArray(x) ? zustand.zonen.filter((z) => x.includes(z)) : []);
  const kein = v.kein_mensch === true;
  return {
    sichtbar: kein ? [] : bekannt(v.sichtbar),
    bedeckt: kein ? [] : bekannt(v.bedeckt),
    kein_mensch: kein,
    notiz: typeof v.notiz === 'string' ? v.notiz.slice(0, 500) : '',
  };
}

function zeichneVorschlagHinweis() {
  el('vorschlag-hinweis').hidden = !zustand.nurVorschlag;
  document.querySelector('.steuerspalte').classList.toggle('ist-vorschlag', zustand.nurVorschlag);
}

function zeichneKopf() {
  const liste = zustand.saetze[zustand.satz];
  const n = liste.length;
  el('zaehler').textContent = n ? `Bild ${zustand.index + 1} von ${n}, Satz ${zustand.satz}` : `Satz ${zustand.satz}: keine Bilder`;
  const markiert = zaehleMarkiert(zustand.satz);
  const nurVorschlag = zaehleNurVorschlag(zustand.satz);
  el('fortschritt-text').textContent = `geprüft ${markiert} / ${n}, nur Vorschlag ${nurVorschlag}, nichts ${n - markiert - nurVorschlag}`;
  el('balken-fuellung').style.width = n ? `${Math.round((markiert / n) * 100)}%` : '0%';
  for (const s of ['nsfw', 'sfw']) {
    const b = el(`satz-${s}`);
    b.setAttribute('aria-pressed', String(s === zustand.satz));
    b.textContent = `${s} (${zaehleMarkiert(s)}/${zustand.saetze[s].length})`;
  }
}

function zeigeBild() {
  const datei = aktuelleDatei();
  const bild = el('bild');
  if (!datei) {
    bild.hidden = true;
    el('leer').hidden = false;
    el('dateiname').textContent = '';
    zustand.entwurf = leerEintrag();
    zustand.nurVorschlag = false;
    zustand.veraendert = false;
    zeichneEntwurf();
    zeichneVorschlagHinweis();
    zeichneKopf();
    return;
  }
  el('leer').hidden = true;
  bild.hidden = false;
  bild.src = `/bild/${encodeURIComponent(zustand.satz)}/${encodeURIComponent(datei)}`;
  el('dateiname').textContent = schluessel(zustand.satz, datei);

  const gespeichert = zustand.bilder[aktuellerSchluessel()];
  const vorschlag = gespeichert ? null : zustand.vorschlag[aktuellerSchluessel()];
  if (gespeichert) {
    zustand.entwurf = {
      sichtbar: [...gespeichert.sichtbar],
      bedeckt: [...gespeichert.bedeckt],
      kein_mensch: !!gespeichert.kein_mensch,
      notiz: gespeichert.notiz ?? '',
    };
  } else if (vorschlag && typeof vorschlag === 'object') {
    zustand.entwurf = entwurfAusVorschlag(vorschlag);
  } else {
    zustand.entwurf = leerEintrag();
  }
  zustand.nurVorschlag = !gespeichert && !!vorschlag && typeof vorschlag === 'object';
  // Ein Vorschlag wird erst durch Speichern zum Eintrag (Pfeiltasten allein speichern ihn nicht).
  zustand.veraendert = false;
  el('notiz').value = zustand.entwurf.notiz;
  zeichneEntwurf();
  zeichneVorschlagHinweis();
  zeichneKopf();
  if (gespeichert) meldung(`Gespeichert am ${gespeichert.geprueft}.`);
  else meldung(zustand.nurVorschlag ? 'Noch nicht geprüft. Mit "Speichern und weiter" bestätigen.' : 'Noch nicht markiert.');

  // Nachbarn vorladen, damit das Blaettern flott bleibt.
  for (const d of [zustand.saetze[zustand.satz][zustand.index + 1]]) {
    if (d) new Image().src = `/bild/${encodeURIComponent(zustand.satz)}/${encodeURIComponent(d)}`;
  }
}

// ---------- Speichern und Navigation ----------

async function speichere() {
  const k = aktuellerSchluessel();
  if (!k) return true;
  try {
    const e = zustand.entwurf;
    const antwort = await api('PUT', `/api/bild/${encodeURIComponent(k)}`, {
      sichtbar: e.sichtbar,
      bedeckt: e.bedeckt,
      kein_mensch: e.kein_mensch,
      notiz: e.notiz,
    });
    zustand.bilder[k] = antwort.eintrag;
    zustand.veraendert = false;
    zustand.nurVorschlag = false;
    zeichneVorschlagHinweis();
    zeichneKopf();
    meldung(`Gespeichert am ${antwort.eintrag.geprueft}.`);
    return true;
  } catch (fehler) {
    meldung(`Speichern fehlgeschlagen: ${fehler.message}`, true);
    return false;
  }
}

async function geheZu(neuerIndex, { speichern } = { speichern: 'wennGeaendert' }) {
  if (zustand.beschaeftigt) return;
  const n = zustand.saetze[zustand.satz].length;
  if (neuerIndex < 0 || neuerIndex >= n) {
    meldung(neuerIndex < 0 ? 'Das ist das erste Bild.' : 'Das war das letzte Bild des Satzes.');
    if (neuerIndex >= n && speichern === 'immer') await speichere();
    return;
  }
  zustand.beschaeftigt = true;
  try {
    const noetig = speichern === 'immer' || (speichern === 'wennGeaendert' && zustand.veraendert);
    if (noetig && !(await speichere())) return;
    zustand.index = neuerIndex;
    zeigeBild();
  } finally {
    zustand.beschaeftigt = false;
  }
}

async function wechsleSatz(satz) {
  if (satz === zustand.satz || zustand.beschaeftigt) return;
  if (zustand.veraendert && !(await speichere())) return;
  zustand.satz = satz;
  const liste = zustand.saetze[satz];
  const erstes = liste.findIndex((d) => !zustand.bilder[schluessel(satz, d)]);
  zustand.index = erstes >= 0 ? erstes : 0;
  zeigeBild();
}

function ausHash() {
  const h = decodeURIComponent(location.hash.replace(/^#/, ''));
  const [satz, datei] = h.split('/');
  if (!['nsfw', 'sfw'].includes(satz) || !datei) return false;
  const i = zustand.saetze[satz].indexOf(datei);
  if (i < 0) return false;
  zustand.satz = satz;
  zustand.index = i;
  return true;
}

// ---------- Eingaben ----------

function schalteZoneUeberTaste(nr, bedeckt) {
  if (zustand.entwurf.kein_mensch || !aktuelleDatei()) return;
  const zone = zustand.zonen[nr];
  if (!zone) return;
  const art = bedeckt ? 'bedeckt' : 'sichtbar';
  schalteListe(art, zone, !zustand.entwurf[art].includes(zone));
}

function schalteKeinMensch(an) {
  if (!aktuelleDatei()) return;
  zustand.entwurf.kein_mensch = an;
  if (an) {
    zustand.entwurf.sichtbar = [];
    zustand.entwurf.bedeckt = [];
  }
  zustand.veraendert = true;
  zeichneEntwurf();
}

document.addEventListener('keydown', (ev) => {
  if (ev.metaKey || ev.ctrlKey || ev.altKey) return;
  const imFeld = ev.target instanceof HTMLInputElement && ev.target.type === 'text';
  if (imFeld) {
    if (ev.key === 'Enter' || ev.key === 'Escape') {
      ev.preventDefault();
      ev.target.blur();
    }
    return;
  }
  const ziffer = /^Digit(\d)$/.exec(ev.code);
  if (ziffer) {
    ev.preventDefault();
    const d = Number(ziffer[1]);
    schalteZoneUeberTaste((d + 9) % 10, ev.shiftKey);
    return;
  }
  switch (ev.key) {
    case 'ArrowRight':
      ev.preventDefault();
      geheZu(zustand.index + 1);
      break;
    case 'ArrowLeft':
      ev.preventDefault();
      geheZu(zustand.index - 1);
      break;
    case 's':
    case 'S':
      ev.preventDefault();
      speichere();
      break;
    case 'n':
    case 'N':
      ev.preventDefault();
      schalteKeinMensch(!zustand.entwurf.kein_mensch);
      break;
    default:
  }
});

el('kein-mensch').addEventListener('change', (ev) => schalteKeinMensch(ev.target.checked));
el('notiz').addEventListener('input', (ev) => {
  zustand.entwurf.notiz = ev.target.value;
  zustand.veraendert = true;
});
el('zurueck').addEventListener('click', () => geheZu(zustand.index - 1));
el('speichern-weiter').addEventListener('click', () => geheZu(zustand.index + 1, { speichern: 'immer' }));
el('ueberspringen').addEventListener('click', () => geheZu(zustand.index + 1, { speichern: 'nein' }));
el('satz-nsfw').addEventListener('click', () => wechsleSatz('nsfw'));
el('satz-sfw').addEventListener('click', () => wechsleSatz('sfw'));

// Ungespeicherte Aenderungen beim Schliessen sichern (best effort).
window.addEventListener('beforeunload', () => {
  const k = aktuellerSchluessel();
  if (k && zustand.veraendert) {
    const e = zustand.entwurf;
    fetch(`/api/bild/${encodeURIComponent(k)}`, {
      method: 'PUT',
      keepalive: true,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sichtbar: e.sichtbar, bedeckt: e.bedeckt, kein_mensch: e.kein_mensch, notiz: e.notiz }),
    });
  }
});

async function start() {
  try {
    await ladeListe();
  } catch (fehler) {
    el('zaehler').textContent = 'Server nicht erreichbar';
    meldung(fehler.message, true);
    return;
  }
  baueZonenTabelle();
  if (!ausHash()) {
    const liste = zustand.saetze.nsfw;
    const erstes = liste.findIndex((d) => !zustand.bilder[schluessel('nsfw', d)]);
    zustand.satz = 'nsfw';
    zustand.index = erstes >= 0 ? erstes : 0;
  }
  zeigeBild();
}

start();
