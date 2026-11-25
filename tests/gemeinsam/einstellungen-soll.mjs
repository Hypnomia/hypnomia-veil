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
// - Behaelter mit wechselndem Inhalt, deren Kinder nicht einzeln gelistet werden, sondern ueber ihre Regel: #preset-karten (presets-ansicht.ts: zwoelf
//   Radios `preset-<id>`), #wort-chips (Themen des Packs; im Ausgangszustand leer) und die drei Listen #ausnahmen-liste, #seiten-liste, #kon-zeiten
//   (Zeilen entstehen mit den gespeicherten Listen und dem Knopf "Add a strict time"): je Zeile gilt LISTEN_JE_ZEILE, die Zahl der Zeilen mit
//   Bedienelementen gibt der Test an (null in den Ausgangszustaenden, eins im Lauf mit gespeicherten Eintraegen).
// - E4d2: die Bedienelemente aus den Bausteinen (src/oberflaeche/bausteine/) haben keine feste id, ihre Wurzel schon. Jede Wurzel in BAUSTEINE_SOLL ist
//   ein Behaelter mit fester Regel: genau diese Bedienelemente mit Art (Rolle, sonst Tag und Typ) und Kennung (`data-id`, `data-zone`), nicht mehr und
//   nicht weniger. Entfernt gegenueber E4d1 (Grund: F1 bis F4): die ids `stimmung`, `verweigern`, `freilegen`, `ton-lautstaerke` (Regler werden Stufenwahl
//   mit Regler in "Exact value", dessen id die Bausteine zaehlen), `erw-an` (der Schalter "Adult-site mode" geht in die Gruppe Off, Tease, Hot, Explicit
//   auf), die Gruppe `stufe` (drei Radios mit name, ebenso in die Gruppe), der Behaelter #zonen mit zehn Zonenschaltern und sechs Kaestchen `data-bedeckt`
//   (Zonenwahl mit zehn Chips und Kleidungsfrage mit zwei Antworten). Neu: sieben Wurzeln `stimmung-wahl`, `zonen-wahl`, `kleidung-frage`,
//   `erw-stufe-wahl`, `verweigern-wahl`, `freilegen-wahl`, `lautstaerke-wahl`. Dazu zaehlt die Sammlung seit E4d2 auch `[role=checkbox]`, `summary` und
//   `a[role=button]` (Nachtrag RN3 der Lesung E4d1); dadurch erscheinen zwei bisher ungezaehlte `summary` (`datei-summary`, `ue-mehr-titel`) in ERZEUGT.

export const HEAD_STATISCH = [
  'augenbalken', 'video-zonen', 'strict', 'ausnahme-feld', 'ausnahme-add', 'erw-ersatz', 'erw-inhalt', 'seite-feld', 'seite-add',
  'ruhig', 'kon-werbung', 'kon-blitz', 'kon-leerlauf', 'kon-minuten', 'kon-tabtitel', 'kon-cursor', 'kon-meldungen',
  'kon-besuche', 'kon-zeit-neu', 'kon-warnung-ok', 'interview-neu',
];
export const ERZEUGT = [
  'erwachsen-zu-knopf', 'kontrolle-zu-knopf', 'ton-zu-knopf', 'werbung-frage-ja', 'werbung-frage-nein', 'einrichten-erw-an', 'einrichten-warnung-ok',
  'einrichten-blitz', 'einrichten-leerlauf', 'einrichten-fertig', 'einrichten-spaeter', 'lizenz-zeigen', 'pack-sperre-knopf', 'datei', 'annehmen', 'abbrechen',
  'entfernen', 'entfernen-ja', 'entfernen-nein', 'ton-an', 'ton-probe', 'ledger-loeschen', 'ledger-ja', 'ledger-nein', 'ue-pruefen',
  // neu durch die Zaehlung von `summary` (Nachtrag RN3, E4d2): die zwei aufklappbaren Teile von pack.ts und ueber.ts bestanden schon in E4d1
  'datei-summary', 'ue-mehr-titel',
];
export const SOLL_IDS = [...HEAD_STATISCH, ...ERZEUGT].sort();
// Ohne id, aber ausdruecklich erlaubt: die Radios `einrichten-stufe` (pack-einrichten.ts, drei), gefuehrt ueber den Namen der Gruppe ("Set me up").
export const SOLL_OHNE_ID = ['input[name=einrichten-stufe]'];
export const BEHAELTER = ['#preset-karten', '#wort-chips'];
export const PRESET_IDS_SOLL = [
  'mia-wort', 'mia-mosaik', 'mia-mosaik-wort', 'mia-blur', 'mia-sticker', 'sticker', 'mosaik', 'mosaik-wort', 'blur', 'zensurbalken', 'person-mosaik', 'person-blur',
  // E6b: die dreizehnte Karte (Custom) in der Gruppe "Your own mix"
  'custom',
];
// E6b: jede der zwoelf Karten hat ein Bedienelement fuer die Schau gesperrter Stile (`.preset-schau`, ohne id, nur bei gesperrter Karte sichtbar).
export const SCHAU_KARTEN_SOLL = 12;
export const ZONEN_SOLL = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];

// Bausteine (E4d2): Wurzel-id und die Bedienelemente darin als "Art:Kennung" (Art: Rolle, sonst Tag, bei input der Typ).
const stufen3 = ['radio:', 'radio:', 'radio:'];
export const BAUSTEINE_SOLL = {
  'stimmung-wahl': [...stufen3, 'button:', 'button:', 'input:range:'], // Aufklapper "Exact value" und das "?"
  'zonen-wahl': ['radio:koerper', 'radio:koerper-gesicht', 'radio:alles', 'button:', ...ZONEN_SOLL.map((z) => `button:${z}`)], // Kopf des Aufklappers und zehn Chips
  'kleidung-frage': ['radio:haut', 'radio:auch-bedeckt', 'button:'], // das "?"
  // zwei Formen (E4d2 G1): mit Freischaltung `erwachsen:vorschau` Off, Tease, Hot, Explicit; ohne sie dazu die Karte On
  'erw-stufe-wahl': { mit: ['radio:off', 'radio:tease', 'radio:hot', 'radio:explicit'], ohne: ['radio:off', 'radio:on', 'radio:tease', 'radio:hot', 'radio:explicit'] },
  'verweigern-wahl': [...stufen3, 'button:', 'input:range:'],
  'freilegen-wahl': [...stufen3, 'button:', 'input:range:'],
  'lautstaerke-wahl': [...stufen3, 'button:', 'input:range:'],
  // E6b: die drei Zeilen des Baukastens unter der Karte Custom (immer im DOM, sichtbar nur bei gewaehltem Custom). Zeile Face: sieben Radios und je ein Bedienelement der Schau
  // (nur bei gesperrtem Baustein sichtbar); Zeile "Everything else": vier Radios und vier der Schau; Words ist ein Schalter.
  'baukasten-face': [...['nothing', 'bar', 'mia', 'sticker', 'mosaik', 'blur', 'schwarz'].map((w) => `radio:${w}`), ...Array.from({ length: 7 }, () => 'button:')],
  'baukasten-flaeche': [...['schwarz', 'mosaik', 'blur', 'sticker'].map((w) => `radio:${w}`), ...Array.from({ length: 4 }, () => 'button:')],
  'baukasten-woerter': ['switch:'],
};
// Listen mit wechselndem Inhalt: Selektor der Zeile und die Bedienelemente je Zeile (eine Zeile ohne Bedienelement ist nur die Leerzeile `.leer`).
export const LISTEN_ZEILE = { '#ausnahmen-liste': 'li', '#seiten-liste': 'li', '#kon-zeiten': '.zeit-zeile' };
export const LISTEN_JE_ZEILE = {
  '#ausnahmen-liste': ['button:'],
  '#seiten-liste': ['button:'],
  '#kon-zeiten': [...Array(7).fill('input:checkbox:'), 'input:time:', 'input:time:', 'button:'],
};

// Skript fuer den Seitenkontext: liest alle Bedienelemente der Panels und gibt { schluessel (sortiert), ohneId, inBehaelter, bausteine, listen } zurueck.
export const SAMMLE_SKRIPT = `
  const BEHAELTER = ${JSON.stringify(BEHAELTER)};
  const BAUSTEINE = ${JSON.stringify(Object.keys(BAUSTEINE_SOLL))};
  const LISTEN = ${JSON.stringify(LISTEN_ZEILE)};
  const alle = [...document.querySelectorAll('[role=tabpanel] :is(input, select, textarea, button, summary, a[role=button], [role=switch], [role=radio], [role=slider], [role=checkbox], [contenteditable])')];
  const art = (e) => {
    const r = e.getAttribute('role');
    const grund = r || (e.tagName === 'INPUT' ? 'input:' + e.type : e.tagName.toLowerCase());
    return grund + ':' + (e.dataset.id || e.dataset.zone || '');
  };
  const schluessel = [];
  const ohneId = {};
  const inBehaelter = { presets: [], schau: [], sonst: [] };
  const bausteine = {};
  const listen = {};
  for (const k of Object.keys(LISTEN)) listen[k] = { zeilen: [], lose: [] };
  for (const e of alle) {
    const baustein = e.closest(BAUSTEINE.map((b) => '#' + b).join(','));
    if (baustein) { (bausteine[baustein.id] ||= []).push(art(e)); continue; }
    const liste = e.closest(Object.keys(LISTEN).join(','));
    if (liste) {
      const zeile = e.closest(LISTEN['#' + liste.id]);
      if (zeile && liste.contains(zeile)) {
        const z = listen['#' + liste.id].zeilen.find((x) => x.el === zeile) || (listen['#' + liste.id].zeilen.push({ el: zeile, arten: [] }), listen['#' + liste.id].zeilen.at(-1));
        z.arten.push(art(e));
      } else listen['#' + liste.id].lose.push(art(e));
      continue;
    }
    const b = e.closest(BEHAELTER.join(','));
    if (b) {
      if (b.id === 'preset-karten' && e.classList.contains('preset-schau')) inBehaelter.schau.push('schau');
      else if (b.id === 'preset-karten') inBehaelter.presets.push(e.id.replace(/^preset-/, ''));
      else inBehaelter.sonst.push(b.id + ':' + (e.id || e.tagName));
      continue;
    }
    if (e.id) schluessel.push(e.id);
    else { const k = e.tagName.toLowerCase() + '[name=' + e.getAttribute('name') + ']'; ohneId[k] = (ohneId[k] || 0) + 1; }
  }
  schluessel.sort();
  for (const k of Object.keys(bausteine)) bausteine[k].sort();
  const listenAus = {};
  for (const [k, v] of Object.entries(listen)) listenAus[k] = { zeilen: v.zeilen.map((z) => z.arten.slice().sort()), lose: v.lose };
  const fehlende = BAUSTEINE.filter((b) => !document.getElementById(b));
  const doppelte = BAUSTEINE.filter((b) => document.querySelectorAll('#' + b).length > 1);
  return { schluessel, ohneId, inBehaelter, bausteine, listen: listenAus, fehlende, doppelte, anzahl: alle.length };`;

// Vergleicht das Ergebnis des Skripts mit der Soll-Liste; gibt eine Liste von Abweichungen zurueck (leer = gruen).
// `eintraege`: wie viele Zeilen mit Bedienelementen jede Liste haben soll (Standard 0: leere Listen). `optionen.erwachsenFrei`: ob die Freischaltung
// `erwachsen:vorschau` da ist (bestimmt die Form der Gruppe der Erwachsenenseiten, Standard falsch = ohne Pack).
export function vergleicheBedienelemente(ist, eintraege = {}, optionen = {}) {
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
  if (JSON.stringify([...b.presets].sort()) !== JSON.stringify([...PRESET_IDS_SOLL].sort())) fehler.push(`Stilkarten ${JSON.stringify(b.presets)}`);
  if (b.schau.length !== SCHAU_KARTEN_SOLL) fehler.push(`Bedienelemente der Schau an den Karten ${b.schau.length} statt ${SCHAU_KARTEN_SOLL}`);
  if (b.sonst.length) fehler.push(`unerwartet in Behaeltern ${JSON.stringify(b.sonst)}`);
  // Bausteine: Wurzel genau einmal, Inhalt genau nach Regel
  if (ist.fehlende.length) fehler.push(`Baustein fehlt ${JSON.stringify(ist.fehlende)}`);
  if (ist.doppelte.length) fehler.push(`Baustein doppelt ${JSON.stringify(ist.doppelte)}`);
  for (const [id, regel] of Object.entries(BAUSTEINE_SOLL)) {
    const soll = Array.isArray(regel) ? regel : optionen.erwachsenFrei ? regel.mit : regel.ohne;
    const ein = ist.bausteine[id] || [];
    if (JSON.stringify(ein) !== JSON.stringify([...soll].sort())) fehler.push(`Baustein ${id}: ${JSON.stringify(ein)} statt ${JSON.stringify([...soll].sort())}`);
  }
  for (const id of Object.keys(ist.bausteine)) if (!(id in BAUSTEINE_SOLL)) fehler.push(`unbekannter Baustein ${id}`);
  // Listen: je Zeile mit Bedienelementen genau die Regel, Zahl der Zeilen wie angegeben, nichts ausserhalb von Zeilen
  for (const [sel, je] of Object.entries(LISTEN_JE_ZEILE)) {
    const l = ist.listen[sel];
    const soll = JSON.stringify([...je].sort());
    for (const z of l.zeilen) if (JSON.stringify(z) !== soll) fehler.push(`Zeile in ${sel}: ${JSON.stringify(z)} statt ${soll}`);
    if (l.zeilen.length !== (eintraege[sel] || 0)) fehler.push(`${sel}: ${l.zeilen.length} Zeilen mit Bedienelementen statt ${eintraege[sel] || 0}`);
    if (l.lose.length) fehler.push(`${sel}: Bedienelemente ausserhalb von Zeilen ${JSON.stringify(l.lose)}`);
  }
  return fehler;
}
