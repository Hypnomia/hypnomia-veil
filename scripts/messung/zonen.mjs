// Messwerkzeug: Treffer je Zone und Fehlalarme des Produkt-Erkenners auf dem Testsatz (kein Produktcode).
// Aufruf: node scripts/messung/zonen.mjs [--browser chromium|firefox] [--laeufe 3] [--md <Pfad>]
// Je Lauf ein frischer Browserstart mit geladener Erweiterung; je Bild eine `pruefe`-Nachricht (quelle.art 'url', alle zehn Zonen an,
// bedeckt wo moeglich, rendern false) mit Schwelle 0,10 und 0,25. Zaehlregeln wie MESSUNG-PHASE-1 Abschnitt 2 (spike/s1-modell/messung.js).
// Ergebnis: scripts/messung/ergebnis-zonen-<zeit>.json (nur Zahlen und Dateinamen, keine Bilder).
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../../tests/fixtures-server.mjs';
import { starteChromium, starteFirefox } from './browser.mjs';
import { argumente, fasse, firefoxVersion, freierPort, holeJson, median, paketJson, perzentil, rund, warte, wurzel, zeitstempel } from './hilfe.mjs';

const hier = path.dirname(fileURLToPath(import.meta.url));
const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const GESICHT = ['face', 'head', 'eyes', 'mouth'];
const KOERPER = ['breast', 'genitals', 'buttocks', 'belly', 'armpits']; // Koerperzonen wie MESSUNG-PHASE-1
const HART = ['breast', 'genitals', 'buttocks'];
const SCHWELLEN = [0.1, 0.25];

const args = argumente();
const browserArt = args.browser === 'firefox' ? 'firefox' : 'chromium';
const laeufeAnzahl = Number(args.laeufe ?? 3);

function alleZonen() {
  const z = {};
  for (const name of ZONEN) z[name] = BEDECKBAR.includes(name) ? { an: true, bedeckt: true } : { an: true };
  return z;
}

function pruefeNachricht(url, schwelle) {
  return {
    ziel: 'erkenner',
    typ: 'pruefe',
    id: `zonen-${Math.random().toString(36).slice(2, 8)}`,
    quelle: { art: 'url', url, referer: '' },
    breite: 0,
    hoehe: 0,
    einstellungen: { schwelle, zonen: alleZonen(), rand: 0.15, stil: 'mosaik' },
    rendern: false,
  };
}

// Treffer -> Zonen (sichtbar oder bedeckt, sichtbar gewinnt); Gesichtstreffer liefern auch Kopf, Augen und Mund (wie im Spike).
function zonenAus(treffer) {
  const sichtbar = new Set();
  const bedeckt = new Set();
  let gesicht = false;
  for (const t of treffer) {
    if (t.zone === 'face') gesicht = true;
    (t.bedeckt ? bedeckt : sichtbar).add(t.zone);
  }
  if (gesicht) for (const z of GESICHT) sichtbar.add(z);
  for (const z of sichtbar) bedeckt.delete(z);
  return { sichtbar, bedeckt };
}

function auswerten(jeBild, soll) {
  const nsfw = Object.fromEntries(ZONEN.map((z) => [z, { soll_sichtbar: 0, treffer_sichtbar: 0, treffer_irgendwie: 0, soll_bedeckt: 0, bedeckt_gefunden: 0, fehlalarm_nsfw: 0 }]));
  const sfw = Object.fromEntries(ZONEN.map((z) => [z, { bilder_sichtbar: 0, bilder_bedeckt: 0 }]));
  const nsfwOhneKoerper = [];
  const nsfwOhneKoerperAuchBedeckt = [];
  const nsfwOhneTreffer = [];
  // Zaehlweise der Vorphase (reproduziert dort 10 von 63 bei 0,25): Bild mit Koerperzone im Soll, aber keine Koerperzone sichtbar gemeldet.
  const sollMitKoerper = [];
  const sollOhneSichtbareMeldung = [];
  const sollOhneJedeMeldung = [];
  const sfwKoerper = [];
  const sfwHart = [];
  let nsfwBilder = 0;
  let sfwBilder = 0;
  let fehler = 0;
  const ohneSoll = [];
  for (const [schluessel, b] of Object.entries(jeBild)) {
    if (!b.ok) { fehler++; continue; }
    const { sichtbar, bedeckt } = zonenAus(b.treffer);
    const name = schluessel.slice(schluessel.indexOf('/') + 1);
    if (schluessel.startsWith('sfw/')) {
      sfwBilder++;
      for (const z of ZONEN) {
        if (sichtbar.has(z)) sfw[z].bilder_sichtbar++;
        if (bedeckt.has(z)) sfw[z].bilder_bedeckt++;
      }
      if (KOERPER.some((z) => sichtbar.has(z))) sfwKoerper.push(name);
      if (HART.some((z) => sichtbar.has(z))) sfwHart.push(name);
      continue;
    }
    nsfwBilder++;
    if (b.treffer.length === 0) nsfwOhneTreffer.push(name);
    if (!KOERPER.some((z) => sichtbar.has(z))) nsfwOhneKoerper.push(name);
    if (!KOERPER.some((z) => sichtbar.has(z) || bedeckt.has(z))) nsfwOhneKoerperAuchBedeckt.push(name);
    const s = soll[schluessel];
    if (!s) { ohneSoll.push(name); continue; }
    const sollS = new Set(s.sichtbar ?? []);
    const sollB = new Set(s.bedeckt ?? []);
    if (KOERPER.some((z) => sollS.has(z))) {
      sollMitKoerper.push(name);
      if (!KOERPER.some((z) => sichtbar.has(z))) sollOhneSichtbareMeldung.push(name);
      if (!KOERPER.some((z) => sichtbar.has(z) || bedeckt.has(z))) sollOhneJedeMeldung.push(name);
    }
    for (const z of ZONEN) {
      const c = nsfw[z];
      if (sollS.has(z)) {
        c.soll_sichtbar++;
        if (sichtbar.has(z)) c.treffer_sichtbar++;
        if (sichtbar.has(z) || bedeckt.has(z)) c.treffer_irgendwie++;
      } else if (sollB.has(z)) {
        c.soll_bedeckt++;
        if (sichtbar.has(z) || bedeckt.has(z)) c.bedeckt_gefunden++;
      } else if (sichtbar.has(z)) {
        c.fehlalarm_nsfw++;
      }
    }
  }
  const summe = (zonen, feld) => zonen.reduce((a, z) => a + nsfw[z][feld], 0);
  const koerper = {
    soll_sichtbar: summe(KOERPER, 'soll_sichtbar'),
    treffer_sichtbar: summe(KOERPER, 'treffer_sichtbar'),
    soll_bedeckt: summe(KOERPER, 'soll_bedeckt'),
    bedeckt_gefunden: summe(KOERPER, 'bedeckt_gefunden'),
    fehlalarm_nsfw: summe(KOERPER, 'fehlalarm_nsfw'),
  };
  return {
    nsfwBilder, sfwBilder, fehler, ohneSoll, nsfw, sfw, koerper,
    nsfwOhneKoerper, nsfwOhneKoerperAuchBedeckt, nsfwOhneTreffer, sfwKoerper, sfwHart,
    sollMitKoerper, sollOhneSichtbareMeldung, sollOhneJedeMeldung,
  };
}

// Alle Zaehlwerte flach, um Laeufe zu vergleichen.
function flach(a) {
  const f = {};
  for (const z of ZONEN) {
    for (const [k, v] of Object.entries(a.nsfw[z])) f[`nsfw.${z}.${k}`] = v;
    for (const [k, v] of Object.entries(a.sfw[z])) f[`sfw.${z}.${k}`] = v;
  }
  for (const [k, v] of Object.entries(a.koerper)) f[`koerper.${k}`] = v;
  f['nsfw.ohneKoerper'] = a.nsfwOhneKoerper.length;
  f['nsfw.ohneKoerperAuchBedeckt'] = a.nsfwOhneKoerperAuchBedeckt.length;
  f['nsfw.ohneTreffer'] = a.nsfwOhneTreffer.length;
  f['nsfw.sollMitKoerper'] = a.sollMitKoerper.length;
  f['nsfw.sollOhneSichtbareMeldung'] = a.sollOhneSichtbareMeldung.length;
  f['nsfw.sollOhneJedeMeldung'] = a.sollOhneJedeMeldung.length;
  f['sfw.koerper'] = a.sfwKoerper.length;
  f['sfw.hart'] = a.sfwHart.length;
  f['fehler'] = a.fehler;
  return f;
}

async function einLauf(nummer, basis, listen, soll) {
  const b = browserArt === 'chromium' ? await starteChromium() : await starteFirefox();
  try {
    // Warmlauf: Modell bereit (Kaltstart gehoert nicht in die Zeiten je Bild), danach ein synthetisches Bild.
    let bereit = false;
    for (let i = 0; i < 400 && !bereit; i++) {
      try { bereit = (await b.sende({ ziel: 'erkenner', typ: 'wecke' }))?.bereit === true; } catch { /* Hintergrund noch nicht bereit */ }
      if (!bereit) await warte(100);
    }
    if (!bereit) throw new Error('Erkenner wurde nicht bereit');
    await b.sende(pruefeNachricht(`${basis}/synthetisch/1.png`, 0.25));
    const status = await b.sende({ ziel: 'erkenner', typ: 'status' });
    const jeSchwelle = {};
    for (const schwelle of SCHWELLEN) jeSchwelle[schwelle] = { jeBild: {}, inf: [], gesamt: [], netz: [], dekod: [], vor: [], warte: [] };
    const t0 = Date.now();
    for (const satz of ['nsfw', 'sfw']) {
      for (const name of listen[satz]) {
        for (const schwelle of SCHWELLEN) {
          const url = `${basis}/testbild/${satz}/${encodeURIComponent(name)}`;
          const a = await b.sende(pruefeNachricht(url, schwelle));
          const ziel = jeSchwelle[schwelle];
          if (a?.ok) {
            ziel.jeBild[`${satz}/${name}`] = { ok: true, breite: a.breite, hoehe: a.hoehe, treffer: a.treffer.map((t) => ({ zone: t.zone, bedeckt: t.bedeckt, score: t.score })), flaechen: a.flaechen.length };
            for (const k of ['inf', 'gesamt', 'netz', 'dekod', 'vor', 'warte']) ziel[k].push(a.ms[k]);
          } else {
            ziel.jeBild[`${satz}/${name}`] = { ok: false, fehler: a?.fehler ?? JSON.stringify(a) };
          }
        }
      }
    }
    const dauerS = (Date.now() - t0) / 1000;
    const ergebnis = { nummer, version: b.version, kaltstartMs: status?.kaltstartMs ?? null, dauerS: rund(dauerS, 1), schwellen: {} };
    for (const schwelle of SCHWELLEN) {
      const z = jeSchwelle[schwelle];
      ergebnis.schwellen[schwelle] = {
        auswertung: auswerten(z.jeBild, soll),
        ms: Object.fromEntries(['inf', 'gesamt', 'netz', 'dekod', 'vor', 'warte'].map((k) => [k, { anzahl: z[k].length, median: rund(median(z[k]), 2), p90: rund(perzentil(z[k], 0.9), 2), max: rund(Math.max(...z[k]), 2) }])),
        jeBild: z.jeBild,
      };
    }
    return ergebnis;
  } finally {
    await b.schliesse();
  }
}

function fasseLaeufe(laeufe) {
  const z = {};
  for (const schwelle of SCHWELLEN) {
    const flachListe = laeufe.map((l) => flach(l.schwellen[schwelle].auswertung));
    const schluessel = Object.keys(flachListe[0]);
    const werte = {};
    const abweichend = [];
    for (const k of schluessel) {
      const reihe = flachListe.map((f) => f[k]);
      werte[k] = median(reihe);
      if (Math.min(...reihe) !== Math.max(...reihe)) abweichend.push({ schluessel: k, werte: reihe });
    }
    const ms = {};
    for (const m of ['inf', 'gesamt', 'netz', 'dekod', 'vor', 'warte']) {
      ms[m] = {
        median: fasse(laeufe.map((l) => l.schwellen[schwelle].ms[m].median), 2),
        p90: fasse(laeufe.map((l) => l.schwellen[schwelle].ms[m].p90), 2),
      };
    }
    // Treffer je Bild identisch ueber die Laeufe?
    let gleich = true;
    const erste = laeufe[0].schwellen[schwelle].jeBild;
    for (const l of laeufe.slice(1)) if (JSON.stringify(l.schwellen[schwelle].jeBild) !== JSON.stringify(erste)) { gleich = false; break; }
    z[schwelle] = { zaehlwerteMedian: werte, abweichendeZaehlwerte: abweichend, trefferJeBildIdentisch: gleich, ms };
  }
  return z;
}

// ---------- Markdown-Tabellen (Median der Laeufe) ----------
const proz = (teil, ganz) => (ganz ? rund((100 * teil) / ganz, 1).toString().replace('.', ',') : 'n/a');
const dez = (v) => (v === null || v === undefined ? 'n/a' : String(v).replace('.', ','));

function markdown(meta, zus, laeufe) {
  const out = [];
  for (const schwelle of SCHWELLEN) {
    const w = zus[schwelle].zaehlwerteMedian;
    const S = dez(schwelle.toFixed(2));
    out.push(`#### Schwelle ${S}, ${meta.browser} ${meta.version}\n`);
    out.push('| Zone | Treffer/Soll sichtbar | Verpasst % | Soll bedeckt / davon gefunden | Fehlalarm nsfw (Bilder) | Fehlalarm sfw (Bilder, sichtbar gemeldet) | sfw bedeckt gemeldet |');
    out.push('|---|---|---|---|---|---|---|');
    for (const z of ZONEN) {
      const ts = w[`nsfw.${z}.treffer_sichtbar`];
      const ss = w[`nsfw.${z}.soll_sichtbar`];
      const sb = w[`nsfw.${z}.soll_bedeckt`];
      const bg = w[`nsfw.${z}.bedeckt_gefunden`];
      out.push(`| ${z} | ${ts}/${ss} | ${proz(ss - ts, ss)} | ${sb} / ${bg} | ${w[`nsfw.${z}.fehlalarm_nsfw`]} | ${w[`sfw.${z}.bilder_sichtbar`]}${GESICHT.includes(z) ? ' (Gesicht, kein Fehlalarm)' : ''} | ${w[`sfw.${z}.bilder_bedeckt`]} |`);
    }
    const k = (n) => w[`koerper.${n}`];
    out.push(`| Koerperzonen (Brust, Intim, Po, Bauch, Achseln) | ${k('treffer_sichtbar')}/${k('soll_sichtbar')} | ${proz(k('soll_sichtbar') - k('treffer_sichtbar'), k('soll_sichtbar'))} | ${k('soll_bedeckt')} / ${k('bedeckt_gefunden')} | ${k('fehlalarm_nsfw')} | | |`);
    out.push('');
    const nN = laeufe[0].schwellen[schwelle].auswertung.nsfwBilder;
    const nS = laeufe[0].schwellen[schwelle].auswertung.sfwBilder;
    out.push(`Bilder gesamt: Satz A (nsfw) ${nN}, Satz B (sfw) ${nS}; Fehler beim Pruefen: ${w['fehler']}.\n`);
    out.push(`- Satz A, Bilder ganz ohne sichtbar gemeldete Koerperzone: ${w['nsfw.ohneKoerper']} von ${nN} (${proz(w['nsfw.ohneKoerper'], nN)} %); wenn bedeckte Treffer mitzaehlen: ${w['nsfw.ohneKoerperAuchBedeckt']}; Bilder ohne jeden Treffer (auch kein Gesicht): ${w['nsfw.ohneTreffer']}.`);
    out.push(`- Satz A, Bilder mit Koerperzone im Soll: ${w['nsfw.sollMitKoerper']}; davon ohne sichtbar gemeldete Koerperzone: ${w['nsfw.sollOhneSichtbareMeldung']} (${proz(w['nsfw.sollOhneSichtbareMeldung'], w['nsfw.sollMitKoerper'])} % dieser Bilder, ${proz(w['nsfw.sollOhneSichtbareMeldung'], nN)} % von ${nN}); ohne jede Meldung auch bedeckt: ${w['nsfw.sollOhneJedeMeldung']}.`);
    out.push(`- Satz B, Bilder mit mindestens einer sichtbar gemeldeten Koerperzone (Fehlalarm): ${w['sfw.koerper']} von ${nS} (${proz(w['sfw.koerper'], nS)} %); davon harte Zonen (Brust, Intim, Po): ${w['sfw.hart']} (${proz(w['sfw.hart'], nS)} %).`);
    out.push('');
    out.push('| Zeit je Bild (ms) | Median ueber Laeufe (Spannweite) | p90 ueber Laeufe (Spannweite) |');
    out.push('|---|---|---|');
    for (const m of ['inf', 'gesamt']) {
      const a = zus[schwelle].ms[m];
      out.push(`| \`ms.${m}\` | ${dez(a.median.median)} (${dez(a.median.min)} bis ${dez(a.median.max)}) | ${dez(a.p90.median)} (${dez(a.p90.min)} bis ${dez(a.p90.max)}) |`);
    }
    out.push('');
    if (zus[schwelle].abweichendeZaehlwerte.length) {
      out.push(`Hinweis: ${zus[schwelle].abweichendeZaehlwerte.length} Zaehlwerte wichen zwischen den Laeufen ab (Median gezeigt): ${zus[schwelle].abweichendeZaehlwerte.map((a) => `${a.schluessel} ${a.werte.join('/')}`).join('; ')}.\n`);
    } else {
      out.push(`Alle Zaehlwerte in allen ${laeufe.length} Laeufen identisch; Treffer je Bild (Zone, bedeckt, Score, Box-frei) ${zus[schwelle].trefferJeBildIdentisch ? 'bitgleich' : 'NICHT bitgleich'} ueber die Laeufe.\n`);
    }
  }
  return out.join('\n');
}

async function haupt() {
  const port = await freierPort();
  const server = [await starteFixtureServer(port), await starteFixtureServer(port + 2)];
  const basis = `http://127.0.0.1:${port}`;
  try {
    const listen = {
      nsfw: (await holeJson(`${basis}/api/testbilder?satz=nsfw`)).bilder,
      sfw: (await holeJson(`${basis}/api/testbilder?satz=sfw`)).bilder,
    };
    const soll = (await holeJson(`${basis}/soll-zonen.json`)).bilder;
    console.log(`Testsatz: nsfw ${listen.nsfw.length}, sfw ${listen.sfw.length}, Soll-Eintraege ${Object.keys(soll).length}`);
    const laeufe = [];
    for (let i = 1; i <= laeufeAnzahl; i++) {
      console.log(`Lauf ${i} von ${laeufeAnzahl} (${browserArt}) ...`);
      const l = await einLauf(i, basis, listen, soll);
      console.log(`  fertig in ${l.dauerS} s, Browser ${l.version}, kaltstartMs ${l.kaltstartMs}`);
      for (const s of SCHWELLEN) {
        const a = l.schwellen[s].auswertung;
        console.log(`  Schwelle ${s}: nsfw ${a.nsfwBilder}, sfw ${a.sfwBilder}, Fehler ${a.fehler}, inf median ${l.schwellen[s].ms.inf.median} ms, gesamt median ${l.schwellen[s].ms.gesamt.median} ms`);
      }
      laeufe.push(l);
    }
    const zus = fasseLaeufe(laeufe);
    const meta = {
      werkzeug: 'scripts/messung/zonen.mjs',
      befehl: `node scripts/messung/zonen.mjs --browser ${browserArt} --laeufe ${laeufeAnzahl}`,
      browser: browserArt === 'chromium' ? 'Chromium (Playwright, headless)' : 'Firefox (geckodriver, headless)',
      version: laeufe[0].version || (browserArt === 'firefox' ? firefoxVersion() : ''),
      datum: new Date().toISOString(),
      laeufe: laeufeAnzahl,
      paket: `${paketJson.name} ${paketJson.version}`,
      schwellen: SCHWELLEN,
      anzahl: { nsfw: listen.nsfw.length, sfw: listen.sfw.length },
      zonenAn: ZONEN,
      zaehlregeln: 'Treffer = Zone im Soll sichtbar und aus treffer (bedeckt false) gemeldet; face liefert auch head, eyes, mouth; sichtbar gewinnt gegen bedeckt; Koerperzonen = breast, genitals, buttocks, belly, armpits; hart = breast, genitals, buttocks',
    };
    const ergebnis = { meta, zusammenfassung: zus, laeufe };
    const datei = path.join(hier, `ergebnis-zonen-${browserArt}-${zeitstempel()}.json`);
    await writeFile(datei, JSON.stringify(ergebnis, null, 1));
    console.log(`Ergebnis: ${path.relative(wurzel, datei)}`);
    const md = markdown(meta, zus, laeufe);
    if (typeof args.md === 'string') await writeFile(args.md, md);
    // Namenslisten (nur Dateinamen) fuer die Meldung.
    for (const s of SCHWELLEN) {
      const a = laeufe[0].schwellen[s].auswertung;
      console.log(`Schwelle ${s}: nsfw ohne sichtbare Koerperzone: ${a.nsfwOhneKoerper.join(' | ')}`);
      console.log(`Schwelle ${s}: nsfw mit Soll-Koerperzone, keine sichtbar gemeldet: ${a.sollOhneSichtbareMeldung.join(' | ') || '(keins)'}`);
      console.log(`Schwelle ${s}: nsfw ohne jeden Treffer: ${a.nsfwOhneTreffer.join(' | ') || '(keins)'}`);
      console.log(`Schwelle ${s}: sfw mit Koerperzone: ${a.sfwKoerper.join(' | ') || '(keins)'}; hart: ${a.sfwHart.join(' | ') || '(keins)'}`);
    }
  } finally {
    for (const s of server) s.close();
  }
}

haupt().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
