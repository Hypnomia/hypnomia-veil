// Wegwerf: fasst alle Spike-Ergebnisdateien zu Markdown-Tabellen fuer MESSUNG-PHASE-1.md zusammen.
// Start: node spike/auswertung.mjs [s1|ext|s4|s2|alle]
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const was = process.argv[2] ?? 'alle';
const lese = (ordner, muster) => readdirSync(path.join(hier, ordner)).filter((n) => muster.test(n)).sort().map((n) => ({ name: n, d: JSON.parse(readFileSync(path.join(hier, ordner, n), 'utf8')) }));
const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const f = (v) => (v === null || v === undefined ? '' : typeof v === 'number' ? String(Math.round(v * 10) / 10).replace('.', ',') : String(v));

if (was === 's1' || was === 'alle') {
  console.log('\n## S1 Seite (spike/s1-modell): echte Testbilder\n');
  console.log('| Datei | Browser | Modell | Backend | Threads | Kanal | Pad | Bilder | Kaltstart ms | dekod | vor | inf Median | inf p90 | nach | je Bild | Bilder/s | Verpasst % | Fehl nsfw | SFW-Bilder mit Fehlalarm % |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const { name, d } of lese('s1-modell', /^ergebnis-(chromium|firefox|android)-.*\.json$/)) {
    if (!d.koerperzonen) continue;
    console.log(`| ${name.replace('ergebnis-', '').replace(/-2026.*$/, '')} | ${d.browser} | ${d.modell} | ${d.genutztesBackend} | ${d.numThreads} | ${d.kanal} | ${d.pad} | ${d.anzahl} | ${f(d.kaltstartMs)} | ${f(d.dekodMedianMs)} | ${f(d.vorMedianMs)} | ${f(d.infMedianMs)} | ${f(d.infP90Ms)} | ${f(d.nachMedianMs)} | ${f(d.jeBildMedianMs)} | ${f(d.bilderProSekunde)} | ${f(d.koerperzonen.verpasst_prozent)} | ${d.koerperzonen.fehlalarm_nsfw} | ${f(d.koerperzonen.sfw_bilder_mit_fehlalarm_prozent)} |`);
  }
  console.log('\n### Je Zone (Datei, Zone: Treffer/Soll sichtbar, Verpasst %, Verpasst irgendwie %, Fehlalarm nsfw, Fehlalarm sfw Bilder, bedeckt gemeldet sfw)\n');
  for (const { name, d } of lese('s1-modell', /^ergebnis-chromium-webgpu-(640m|320n)-(rgb|bgr)-.*\.json$/)) {
    if (!d.zonen || d.pad !== 'ru') continue;
    console.log(`\n**${d.modell} ${d.kanal} (${name.replace(/-2026.*$/, '')}, ${d.anzahlNsfw} nsfw, ${d.anzahlSfw} sfw)**\n`);
    console.log('| Zone | Treffer/Soll | Verpasst % | Verpasst irgendwie % | Soll bedeckt | davon gefunden | Fehl nsfw | Fehl sfw | bedeckt sfw |');
    console.log('|---|---|---|---|---|---|---|---|---|');
    for (const z of ZONEN) { const v = d.zonen[z]; console.log(`| ${z} | ${v.treffer_sichtbar}/${v.soll_sichtbar} | ${f(v.verpasst_prozent)} | ${f(v.verpasst_irgendwie_prozent)} | ${v.soll_bedeckt} | ${v.treffer_bedeckt_irgendwie} | ${v.fehlalarm_nsfw} | ${v.fehlalarm_sfw} | ${v.bedeckt_gemeldet_sfw} |`); }
    // SFW-Bilder mit Fehlalarm aufzaehlen (Dateiname und Zonen), damit der Inhaber nachsehen kann.
    const sfwFehl = Object.entries(d.jeBild ?? {}).filter(([k, v]) => k.startsWith('sfw/') && v.ist?.sichtbar?.some((z) => ['breast', 'genitals', 'buttocks', 'belly', 'armpits'].includes(z)));
    console.log(`\nSFW-Bilder mit Fehlalarm (${sfwFehl.length}): ${sfwFehl.map(([k, v]) => `${k.slice(4)} [${v.ist.sichtbar.filter((z) => ['breast', 'genitals', 'buttocks', 'belly', 'armpits'].includes(z)).join(',')} ${v.treffer.filter((t) => !t.klasse.startsWith('FACE')).map((t) => `${t.klasse} ${t.score}`).join('; ')}]`).join('; ')}`);
    const nsfwVerpasst = Object.entries(d.jeBild ?? {}).filter(([k, v]) => k.startsWith('nsfw/') && v.treffer.length === 0);
    console.log(`NSFW-Bilder ganz ohne Treffer (${nsfwVerpasst.length}): ${nsfwVerpasst.map(([k]) => k.slice(5)).join(', ')}`);
  }
}

if (was === 'ext' || was === 'alle') {
  console.log('\n## S1 Erweiterungskontext (spike/s1-modell, ergebnis-*ext-*)\n');
  console.log('| Datei | Browser | Kontext | Modell | Backend | Threads | isoliert | Bilder | Kaltstart ms (Modell/Session/Erstlauf) | netz | dekod | vor | inf Median | inf p90 | nach | Rundlauf Median | Rundlauf p90 | Bilder/s | Verpasst % | SFW Fehl % |');
  console.log('|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|');
  for (const { name, d } of lese('s1-modell', /^ergebnis-(chromiumext|firefoxext)-.*\.json$/)) {
    const k = d.sessionZeiten ?? {};
    console.log(`| ${name.replace('ergebnis-', '').replace(/-2026.*$/, '')} | ${d.browser} | ${d.kontext} | ${d.modell} | ${d.backend} | ${d.numThreads} | ${d.crossOriginIsolated} | ${d.anzahl} | ${f(k.kaltstartMs)} (${f(k.modellLadenMs)}/${f(k.sessionMs)}/${f(k.erstlaufMs)}) | ${f(d.netzMedianMs)} | ${f(d.dekodMedianMs)} | ${f(d.vorMedianMs)} | ${f(d.infMedianMs)} | ${f(d.infP90Ms)} | ${f(d.nachMedianMs)} | ${f(d.rundlaufMedianMs)} | ${f(d.rundlaufP90Ms)} | ${f(d.bilderProSekunde)} | ${f(d.koerperzonen?.verpasst_prozent)} | ${f(d.koerperzonen?.sfw_bilder_mit_fehlalarm_prozent)} |`);
  }
}

if (was === 's4' || was === 'alle') {
  console.log('\n## S4 Aufnahmen (spike/s4-schleier)\n');
  console.log('| Datei | Browser | Erweiterung | Quelle | Bildrate | Frames | Frames mit Magenta | erster | letzter | Kacheln mit Magenta (Fall: Frames, erster Frame ms) |');
  console.log('|---|---|---|---|---|---|---|---|---|---|');
  for (const { name, d } of lese('s4-schleier', /^ergebnis-.*\.json$/)) {
    const k = Object.entries(d.kacheln ?? {}).filter(([, v]) => v.framesMitMagenta > 0).map(([n, v]) => `${n}: ${v.framesMitMagenta}, ${f(v.ersterFrameMs)} ms`).join('; ');
    console.log(`| ${name.replace('ergebnis-', '').replace(/-2026.*$/, '')} | ${d.browser} | ${d.erweiterung} | ${d.quelle} | ${d.bildrate} | ${d.frames} | ${d.framesMitMagenta} | ${f(d.ersterMagentaFrame)} | ${f(d.letzterMagentaFrame)} | ${k || 'keine'} |`);
  }
}

if (was === 's2' || was === 'alle') {
  console.log('\n## S2/S3 (spike/erweiterung, ergebnis-s2-*)\n');
  for (const { name, d } of lese('erweiterung', /^ergebnis-s2-.*\.json$/)) {
    console.log(`\n**${name.replace('ergebnis-s2-', '').replace(/-2026.*$/, '')}**: Seite ${d.seite}, Bilder ${d.bilderGefunden} (sichtbar ${d.sichtbare}), Canvas lesbar ${d.canvasLesbar}, gesperrt ${d.canvasGesperrt}, Shadow Roots ${d.shadowGefunden}, Frames ${d.frames}`);
    if (d.bildHosts) console.log(`Hosts: ${JSON.stringify(d.bildHosts)}`);
    for (const [v, w] of Object.entries(d.varianten ?? {})) console.log(`- Variante ${v}${w.gueltig === false ? ' (Regel nicht gesetzt)' : ''}: ${w.anzahl} Abrufe, verweigert ${w.verweigert}, Status ${JSON.stringify(w.statusVerteilung)}, netz Median ${f(w.netzMedianMs)} / p95 ${f(w.netzP95Ms)} ms, dekod Median ${f(w.dekodMedianMs)} ms, ${f(w.bilderProSekunde)} Bilder/s, ${f((w.bytesGesamt ?? 0) / 1e6)} MB, Fehler ${JSON.stringify(w.fehler)}`);
    if (d.videos?.length) console.log(`- Videos: ${JSON.stringify(d.videos)}`);
    if (d.videoBildErkenner) console.log(`- Videobild im Erkenner: ${JSON.stringify(d.videoBildErkenner)}`);
    if (d.videoPixel) console.log(`- Videobild als Pixelliste (320x320 RGBA als JSON): Rundlauf ${d.videoPixel.rundlaufMs} ms, davon Transport ${d.videoPixel.transportMs} ms, Erkenner ${JSON.stringify(d.videoPixel.antwort?.ms)} ${d.videoPixel.fehler ?? ''}`);
  }
}
