// Suche nach Spuren der Testhaken in einem Bau. Gemeinsame Quelle fuer scripts/test-all.mjs (Release-Pruefung) und
// scripts/release/firefox.mjs (Release-Skript). Durchsucht werden JS, HTML, CSS und das Manifest.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';

// Spuren der Testhaken: das, was der Testhaken in Seiten und Erweiterung schreibt oder abhoert. Im Release-Bau darf nichts davon stehen.
//   veil-test             CustomEvent, ueber das Tests Einstellungen setzen und den Erkenner abfragen
//   veil-freigabe         Seitenparameter "Freigabe sperren"
//   data-veil-erkenner    Antwort des Erkenner-Status im Testhaken
//   data-veil-status      Status-Attribut am Wurzelelement
//   data-veil-ms          Zeitstempel je Element
//   hypnomiaVeil, data-hypnomia-veil   Lebenszeichen-Attribut der Hallo-Tests (dataset.hypnomiaVeil)
//   veilHello             Lebenszeichen der Hallo-Tests in storage.local (Hintergrund, nur im Testbau)
//   videoVerzoegerungMs   Testhaken: kuenstlich verzoegerte Video-Antwort (veil-test)
//   steigerungUhrVor, veil-steigerung-takt   Testhaken der Steigerung (Uhr vorstellen, kurzer Melde-Takt)
//   veil-erwachsen        Testdomain veil-erwachsen.test fuer Erwachsenenseiten (src/adapter/liste.ts, Phase 4)
//   (videoZeiten und die anderen Schluessel des Status-Objekts stehen als Namen auch im Release-Bau, werden dort aber nie geschrieben:
//   das Schreiben haengt an testhakenAktiv(). Gesucht wird darum nach dem Attributnamen data-veil-status, nicht nach den Schluesseln.)
export const TESTHAKEN_SPUREN = ['veil-test', 'veil-freigabe', 'data-veil-erkenner', 'data-veil-status', 'data-veil-ms', 'hypnomiaVeil', 'data-hypnomia-veil', 'veilHello', 'videoVerzoegerungMs', 'warteschlangeHalt', 'pruefVerzoegerungMs', 'data-veil-grenze', 'veil-erwachsen', 'data-veil-riegel', 'steigerungUhrVor', 'veil-steigerung-takt', 'data-veil-freilegen', 'data-veil-ersatz-abbild', 'data-veil-ersatz-host', 'data-veil-blitz', 'data-veil-spirale', 'data-veil-werbung', 'veil-werbung.test', 'data-veil-tabtitel', 'veil-besuch', 'data-veil-meldung', 'veil-version-test', 'data-veil-ledger', 'veil-einstieg-test', 'data-veil-ton', 'data-veil-standbild'];
// Diese Spuren schreibt der Testbau wirklich; die Gegenprobe verlangt sie dort (data-hypnomia-veil kommt nur als dataset-Name vor).
export const SPUREN_IM_TESTBAU = ['veil-test', 'veil-freigabe', 'data-veil-erkenner', 'data-veil-status', 'data-veil-ms', 'hypnomiaVeil', 'veilHello', 'videoVerzoegerungMs', 'warteschlangeHalt', 'pruefVerzoegerungMs', 'data-veil-grenze', 'veil-erwachsen', 'data-veil-riegel', 'steigerungUhrVor', 'veil-steigerung-takt', 'data-veil-freilegen', 'data-veil-ersatz-abbild', 'data-veil-ersatz-host', 'data-veil-blitz', 'data-veil-spirale', 'data-veil-werbung', 'veil-werbung.test', 'data-veil-tabtitel', 'veil-besuch', 'data-veil-meldung', 'veil-version-test', 'data-veil-ledger', 'veil-einstieg-test', 'data-veil-ton', 'data-veil-standbild'];

const DURCHSUCHT = /\.(m?js|cjs|html|css)$/;
export const istJs = (name) => /\.(m?js|cjs)$/.test(name);

// Alle durchsuchten Dateien unter einem Ordner (rekursiv).
export function dateien(ordner) {
  const liste = [];
  for (const name of readdirSync(ordner)) {
    const voll = path.join(ordner, name);
    if (statSync(voll).isDirectory()) liste.push(...dateien(voll));
    else if (DURCHSUCHT.test(name) || name === 'manifest.json') liste.push(voll);
  }
  return liste;
}

// Dateiname ohne Inhalts-Hash des Baus (chunks/popup-BJjSF3cq.js -> chunks/popup.js): zwei Baue vergleichen sich ueber die Namen.
export const ohneHash = (rel) => rel.replace(/-[A-Za-z0-9_-]{8}(\.[a-z]+)$/, '$1');

// Zaehlt je Spur die Dateien eines Baus, in denen sie steht.
export function suche(ordner) {
  const alle = dateien(ordner);
  const treffer = Object.fromEntries(TESTHAKEN_SPUREN.map((m) => [m, []]));
  for (const datei of alle) {
    const text = readFileSync(datei, 'utf8');
    for (const muster of TESTHAKEN_SPUREN) if (text.includes(muster)) treffer[muster].push(datei);
  }
  const js = alle.filter((d) => istJs(d)).map((d) => ohneHash(path.relative(ordner, d))).sort();
  return { dateien: alle.length, js, treffer };
}

// Gegenprobe: welche Spuren, die der Testbau schreiben muss, stehen im Ergebnis von suche() eines Testbaus nicht? Leer = die Suche taugt.
export function fehlendeSpuren(testSuche) {
  return SPUREN_IM_TESTBAU.filter((m) => testSuche.treffer[m].length === 0);
}
