// Soll-Liste der Bedienelemente der Einstellungsseite (Phase 11 E4d1, Nacharbeit N2), gemeinsam fuer Chromium und Firefox. Die Seite hat sieben Panels;
// der Test liest ALLE Bedienelemente darin und vergleicht ids und Zahl mit dieser Liste. Jedes zusaetzliche und jedes fehlende Element ist rot.
//
// Herkunft:
// - HEAD_STATISCH: die Bedienelemente mit id in `entrypoints/options/index.html` im Stand HEAD (cf27a8f, vor E4d1), ohne #pause und #pause-leiste
//   (sie stehen in Kopf und Leiste, ausserhalb der Panels).
// - ERZEUGT: Bedienelemente, die Module der Seite im Stand HEAD beim Laden bauen: ordnung.ts (`<karte>-zu-knopf`), pack-karte.ts und pack.ts
//   (Dateiwahl, Lizenz, Annehmen, Entfernen), werbung-frage.ts (`werbung-frage-ja`, `-nein`), pack-einrichten.ts (`einrichten-*`), ton.ts (`ton-an`,
//   `ton-lautstaerke`, `ton-probe`), ledger.ts (`ledger-loeschen`, `-ja`, `-nein`), ueber.ts (`ue-pruefen`). Mit und ohne Pack ist die Liste gleich,
//   weil die Module alles beim Laden bauen und nur ein- und ausblenden (gemessen im Stand E4d1, Chromium, beide Zustaende je 85 Elemente).
// - Ohne id, aber ausdruecklich erlaubt: die Radios `stufe` (index.html HEAD, drei) und `einrichten-stufe` (pack-einrichten.ts, drei), gefuehrt
//   ueber den Namen der Gruppe.
// - Behaelter mit wechselndem Inhalt, deren Kinder nicht einzeln gelistet werden, sondern ueber ihre Regel: #zonen (grund.ts: je Zone ein Schalter
//   `data-zone`, sechs Kaestchen `data-bedeckt`), #preset-karten (presets-ansicht.ts: zwoelf Radios `preset-<id>`), #ausnahmen-liste, #seiten-liste,
//   #kon-zeiten (Zeilen entstehen mit den gespeicherten Listen und dem Knopf "Add a strict time"), #wort-chips (Themen des Packs). Im Ausgangszustand
//   der Tests (leere Listen, kein Pack mit Themen) stehen darin keine Bedienelemente ausser den zwoelf und sechzehn der ersten beiden.
export const HEAD_STATISCH = [
  'augenbalken', 'video-zonen', 'stimmung', 'strict', 'ausnahme-feld', 'ausnahme-add', 'erw-an', 'erw-ersatz', 'erw-inhalt', 'seite-feld', 'seite-add',
  'verweigern', 'freilegen', 'ruhig', 'kon-werbung', 'kon-blitz', 'kon-leerlauf', 'kon-minuten', 'kon-tabtitel', 'kon-cursor', 'kon-meldungen',
  'kon-besuche', 'kon-zeit-neu', 'kon-warnung-ok', 'interview-neu',
];
export const ERZEUGT = [
  'erwachsen-zu-knopf', 'kontrolle-zu-knopf', 'ton-zu-knopf', 'werbung-frage-ja', 'werbung-frage-nein', 'einrichten-erw-an', 'einrichten-warnung-ok',
  'einrichten-blitz', 'einrichten-leerlauf', 'einrichten-fertig', 'einrichten-spaeter', 'lizenz-zeigen', 'pack-sperre-knopf', 'datei', 'annehmen', 'abbrechen',
  'entfernen', 'entfernen-ja', 'entfernen-nein', 'ton-an', 'ton-lautstaerke', 'ton-probe', 'ledger-loeschen', 'ledger-ja', 'ledger-nein', 'ue-pruefen',
];
export const SOLL_IDS = [...HEAD_STATISCH, ...ERZEUGT].sort();
export const SOLL_OHNE_ID = ['input[name=stufe]', 'input[name=einrichten-stufe]'];
export const BEHAELTER = ['#zonen', '#preset-karten', '#ausnahmen-liste', '#seiten-liste', '#kon-zeiten', '#wort-chips'];
export const PRESET_IDS_SOLL = [
  'mia-wort', 'mia-mosaik', 'mia-mosaik-wort', 'mia-blur', 'mia-sticker', 'sticker', 'mosaik', 'mosaik-wort', 'blur', 'zensurbalken', 'person-mosaik', 'person-blur',
];
export const ZONEN_SOLL = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
export const BEDECKT_SOLL = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];

// Skript fuer den Seitenkontext: liest alle Bedienelemente der Panels und gibt { schluessel (sortiert), ohneId, behaelter } zurueck.
export const SAMMLE_SKRIPT = `
  const BEHAELTER = ${JSON.stringify(BEHAELTER)};
  const alle = [...document.querySelectorAll('[role=tabpanel] :is(input, select, textarea, button, [role=switch], [role=radio], [role=slider], [contenteditable])')];
  const schluessel = [];
  const ohneId = {};
  const inBehaelter = { zonen: [], bedeckt: [], presets: [], sonst: [] };
  for (const e of alle) {
    const b = e.closest(BEHAELTER.join(','));
    if (b) {
      if (b.id === 'zonen') (e.dataset.zone ? inBehaelter.zonen : e.dataset.bedeckt ? inBehaelter.bedeckt : inBehaelter.sonst).push(e.dataset.zone || e.dataset.bedeckt || e.tagName);
      else if (b.id === 'preset-karten') inBehaelter.presets.push(e.id.replace(/^preset-/, ''));
      else inBehaelter.sonst.push(b.id + ':' + (e.id || e.tagName));
      continue;
    }
    if (e.id) schluessel.push(e.id);
    else { const k = e.tagName.toLowerCase() + '[name=' + e.getAttribute('name') + ']'; ohneId[k] = (ohneId[k] || 0) + 1; }
  }
  schluessel.sort();
  return { schluessel, ohneId, inBehaelter, anzahl: alle.length };`;

// Vergleicht das Ergebnis des Skripts mit der Soll-Liste; gibt eine Liste von Abweichungen zurueck (leer = gruen).
export function vergleicheBedienelemente(ist) {
  const fehler = [];
  const zaehle = (l) => l.reduce((a, k) => ((a[k] = (a[k] || 0) + 1), a), {});
  const istZ = zaehle(ist.schluessel);
  const sollZ = zaehle(SOLL_IDS);
  for (const k of new Set([...Object.keys(istZ), ...Object.keys(sollZ)])) {
    if ((istZ[k] || 0) !== (sollZ[k] || 0)) fehler.push(`id ${k}: ${istZ[k] || 0} statt ${sollZ[k] || 0}`);
  }
  if (ist.schluessel.length !== SOLL_IDS.length) fehler.push(`Zahl der Bedienelemente mit id ${ist.schluessel.length} statt ${SOLL_IDS.length}`);
  for (const k of new Set([...Object.keys(ist.ohneId), ...SOLL_OHNE_ID])) {
    if ((ist.ohneId[k] || 0) !== (SOLL_OHNE_ID.includes(k) ? 3 : 0)) fehler.push(`ohne id ${k}: ${ist.ohneId[k] || 0}`);
  }
  const b = ist.inBehaelter;
  if (JSON.stringify([...b.zonen].sort()) !== JSON.stringify([...ZONEN_SOLL].sort())) fehler.push(`Zonenschalter ${JSON.stringify(b.zonen)}`);
  if (JSON.stringify([...b.bedeckt].sort()) !== JSON.stringify([...BEDECKT_SOLL].sort())) fehler.push(`Kaestchen bedeckt ${JSON.stringify(b.bedeckt)}`);
  if (JSON.stringify([...b.presets].sort()) !== JSON.stringify([...PRESET_IDS_SOLL].sort())) fehler.push(`Stilkarten ${JSON.stringify(b.presets)}`);
  if (b.sonst.length) fehler.push(`unerwartet in Behaeltern ${JSON.stringify(b.sonst)}`);
  return fehler;
}
