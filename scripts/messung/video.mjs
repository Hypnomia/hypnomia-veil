// Messwerkzeug: CPU-Last des ganzen Browser-Prozessbaums bei laufender Video-Nachpruefung (PHASE-2-BAUPLAN 10.2), kein Produktcode.
// Aufruf: node scripts/messung/video.mjs [--browser chromium|firefox|beide] [--laeufe 3] [--dauer 30] [--aufwaermen 5] [--md <Pfad>]
// Faelle: 0, 1 und 4 laufende Videos, je Erweiterung aktiv und pausiert (Pause ueber den Testhaken veil-test). Seite: tests/fixtures/video-lauf.html
// (nimmt beim ersten Laden eines Browserstarts ein Testvideo auf, 10 s, ausserhalb der Messung; danach kommt es aus dem localStorage).
// Je Lauf ein frischer Browser (headless wie die Tests) mit allen sechs Faellen nacheinander, Reihenfolge je Lauf gewechselt.
// Last: Summe der %CPU aller Nachkommen dieses Prozesses (ohne geckodriver und ps) aus `ps`, je Sekunde; 100 % = ein voller Kern.
// Gegenprobe: Zuwachs der CPU-Zeit (cputime) dieser Prozesse ueber das Fenster geteilt durch die Wanduhrzeit.
// Port: VEIL_FIXTURE_PORT (Standard 47573) und Port plus 2.
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { loadavg, cpus } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { starteFixtureServer } from '../../tests/fixtures-server.mjs';
import { starteChromium, starteFirefox } from './browser.mjs';
import { argumente, fasse, firefoxVersion, median, paketJson, warte, wurzel, zeitstempel, ausgabeOrdner } from './hilfe.mjs';

const ausfuehren = promisify(execFile);
const hier = path.dirname(fileURLToPath(import.meta.url));
const args = argumente();
const browserListe = args.browser === 'chromium' ? ['chromium'] : args.browser === 'firefox' ? ['firefox'] : ['chromium', 'firefox'];
const laeufe = Number(args.laeufe ?? 3);
const DAUER_S = Number(args.dauer ?? 30);
const AUFWAERMEN_S = Number(args.aufwaerm ?? args.aufwaermen ?? 5);
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47573);
const basis = `http://127.0.0.1:${port}`;
const BILD = 'IMG_0260.jpg';
const dez = (v) => (v === null || v === undefined ? 'n/a' : String(v).replace('.', ','));

const FAELLE = [];
for (const n of [0, 1, 4]) for (const pausiert of [false, true]) FAELLE.push({ n, pausiert, name: `${n} Video${n === 1 ? '' : 's'}, ${pausiert ? 'pausiert' : 'aktiv'}` });

// ---------- Prozessbaum ----------

function zeitZuSekunden(t) {
  // [[DD-]HH:]MM:SS.ss
  let tage = 0;
  let rest = t.trim();
  if (rest.includes('-')) [tage, rest] = [Number(rest.split('-')[0]), rest.split('-')[1]];
  const teile = rest.split(':').map(Number);
  let s = 0;
  for (const x of teile) s = s * 60 + x;
  return tage * 86400 + s;
}

async function lesePs() {
  const { stdout } = await ausfuehren('ps', ['-axo', 'pid=,ppid=,%cpu=,cputime=,comm='], { maxBuffer: 16 * 1024 * 1024 });
  const tabelle = new Map();
  for (const zeile of stdout.split('\n')) {
    const m = /^\s*(\d+)\s+(\d+)\s+([\d.]+)\s+(\S+)\s+(.*)$/.exec(zeile);
    if (!m) continue;
    tabelle.set(Number(m[1]), { pid: Number(m[1]), ppid: Number(m[2]), cpu: Number(m[3]), zeit: zeitZuSekunden(m[4]), comm: m[5] });
  }
  return tabelle;
}

// Nachkommen dieses Prozesses (der Browser und seine Kinder), ohne den Treiber und das eigene ps.
function browserBaum(tabelle) {
  const kinder = new Map();
  for (const p of tabelle.values()) {
    if (!kinder.has(p.ppid)) kinder.set(p.ppid, []);
    kinder.get(p.ppid).push(p);
  }
  const ergebnis = [];
  const sammle = (pid) => {
    for (const k of kinder.get(pid) ?? []) {
      if (/\/geckodriver$|\/ps$/.test(k.comm)) {
        if (/geckodriver$/.test(k.comm)) sammle(k.pid); // Firefox haengt unter dem Treiber; der Treiber selbst zaehlt nicht
        continue;
      }
      ergebnis.push(k);
      sammle(k.pid);
    }
  };
  sammle(process.pid);
  return ergebnis;
}

async function probe() {
  const t = await lesePs();
  const baum = browserBaum(t);
  const w = Date.now();
  return {
    w,
    anzahl: baum.length,
    summeCpu: baum.reduce((s, p) => s + p.cpu, 0),
    zeiten: new Map(baum.map((p) => [p.pid, p.zeit])),
  };
}

// ---------- Browser-spezifisch ----------

function schnittstelle(b) {
  if (b.art === 'chromium') {
    let seite = null;
    return {
      async oeffne(url) {
        const alt = seite;
        seite = await b.context.newPage();
        await seite.setViewportSize({ width: 1280, height: 1000 });
        if (alt) await alt.close();
        for (const p of b.context.pages()) if (p !== seite) await p.close().catch(() => {});
        await seite.goto(url);
      },
      auswerten: (skript, arg) => seite.evaluate(skript, arg),
      async leer() {
        const alt = seite;
        seite = await b.context.newPage();
        if (alt) await alt.close();
      },
    };
  }
  const d = b.driver;
  return {
    async oeffne(url) {
      await d.manage().window().setRect({ width: 1280, height: 1000 }).catch(() => {});
      await d.get(url);
    },
    // Skript ist ein Funktionsausdruck (arg) => ...; selenium bekommt ihn als Rumpf.
    auswerten: (skript, arg) => d.executeScript(`return (${skript.toString()})(arguments[0])`, arg ?? null),
    async leer() {
      await d.get('about:blank');
    },
  };
}

async function bis(beschreibung, lies, frist = 30_000) {
  const t0 = Date.now();
  let letzter = null;
  while (Date.now() - t0 < frist) {
    try {
      letzter = await lies();
      if (letzter) return letzter;
    } catch { /* Seite wechselt gerade */ }
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert ${JSON.stringify(letzter)})`);
}

const LIES_STATUS = () => {
  const r = document.documentElement.dataset.veilStatus;
  return r ? JSON.parse(r) : null;
};
const LIES_FILM = () => document.documentElement.dataset.filmBereit ?? null;
const SETZE_PAUSE = (p) => {
  document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ einstellungen: { pause: p } }) }));
  return true;
};
const LIES_SEITE = () => document.documentElement.getAttribute('data-veil-seite');
const LEGE_VIDEOS = (n) => {
  for (let i = 1; i <= n; i++) window.neuesVideo({ id: 'v' + i, autoplay: true });
  return n;
};
const LIES_VIDEOS = () => {
  const h = window.innerHeight;
  return [...document.querySelectorAll('video')].map((v) => {
    const r = v.getBoundingClientRect();
    return { urteil: v.getAttribute('data-veil') ?? '', laeuft: !v.paused && !v.ended && v.readyState >= 2, ct: v.currentTime, imAusschnitt: r.bottom > 0 && r.top < h, sichtbarKomplett: r.top >= 0 && r.bottom <= h };
  });
};

// ---------- ein Fall ----------

async function messeFall(b, s, fall) {
  await s.oeffne(`${basis}/video-lauf.html?bild=${encodeURIComponent(BILD)}`);
  await bis('Film bereit', () => s.auswerten(LIES_FILM), 40_000);
  // Pause setzen und warten, bis der Schleier sie angenommen hat (Wurzelattribut data-veil-seite).
  await bis('Status da', () => s.auswerten(LIES_STATUS), 20_000);
  await s.auswerten(SETZE_PAUSE, fall.pausiert);
  await bis(`Pause ${fall.pausiert}`, async () => ((await s.auswerten(LIES_SEITE)) === 'aus') === fall.pausiert || (!fall.pausiert && (await s.auswerten(LIES_SEITE)) === null), 10_000);
  await warte(500);
  if (fall.n > 0) await s.auswerten(LEGE_VIDEOS, fall.n);
  if (fall.n > 0 && !fall.pausiert) {
    await bis('alle Videos mit Urteil', async () => {
      const v = await s.auswerten(LIES_VIDEOS);
      return v.length === fall.n && v.every((x) => x.urteil === 'frei' || x.urteil === 'verdeckt' || x.urteil === 'zensiert');
    }, 40_000);
  }
  await warte(AUFWAERMEN_S * 1000);

  const videosVor = await s.auswerten(LIES_VIDEOS);
  const statusVor = await s.auswerten(LIES_STATUS);
  const proben = [await probe()];
  const pruefReihe = [statusVor?.videoPruefungen ?? 0];
  const wechselReihe = [statusVor?.videoWechsel ?? 0];
  const t0 = Date.now();
  const lastVor = loadavg()[0];
  for (let i = 1; i <= DAUER_S; i++) {
    const ziel = t0 + i * 1000;
    await warte(Math.max(0, ziel - Date.now()));
    proben.push(await probe());
    const st = await s.auswerten(LIES_STATUS);
    pruefReihe.push(st?.videoPruefungen ?? null);
    wechselReihe.push(st?.videoWechsel ?? null);
  }
  const videosNach = await s.auswerten(LIES_VIDEOS);

  // %CPU: Summe je Abtastpunkt, Mittel ueber die Fenstersekunden (Punkte 1 bis DAUER_S).
  const summen = proben.slice(1).map((p) => p.summeCpu);
  const mittelPs = summen.reduce((a, c) => a + c, 0) / summen.length;
  // Gegenprobe: cputime-Zuwachs.
  let zuwachs = 0;
  for (let i = 1; i < proben.length; i++) {
    for (const [pid, z] of proben[i].zeiten) {
      const vorher = proben[i - 1].zeiten.get(pid);
      zuwachs += vorher === undefined ? z : Math.max(0, z - vorher);
    }
  }
  const wand = (proben[proben.length - 1].w - proben[0].w) / 1000;
  const mittelZeit = (zuwachs / wand) * 100;
  const pruefungen = pruefReihe[pruefReihe.length - 1] - pruefReihe[0];
  return {
    fall: fall.name,
    n: fall.n,
    pausiert: fall.pausiert,
    cpuPs: mittelPs,
    cpuPsSpitze: Math.max(...summen),
    cpuZeit: mittelZeit,
    prozesse: Math.round(median(proben.map((p) => p.anzahl))),
    pruefungenGesamt: pruefungen,
    pruefungenJeS: pruefungen / DAUER_S,
    wechselGesamt: wechselReihe[wechselReihe.length - 1] - wechselReihe[0],
    pruefReihe,
    summen,
    wandS: wand,
    ladung: { vor: lastVor, nach: loadavg()[0] },
    videosVor,
    videosNach,
  };
}

function reihenfolge(lauf) {
  const l = [...FAELLE];
  if (lauf % 3 === 1) return l.reverse();
  if (lauf % 3 === 2) return [...l.slice(3), ...l.slice(0, 3)];
  return l;
}

async function haupt() {
  const server = [await starteFixtureServer(port), await starteFixtureServer(port + 2)];
  const ergebnis = { meta: {}, laeufe: [] };
  const versionen = {};
  try {
    for (const art of browserListe) {
      for (let lauf = 0; lauf < laeufe; lauf++) {
        const b = art === 'chromium' ? await starteChromium() : await starteFirefox();
        versionen[art] = b.version || versionen[art];
        try {
          const s = schnittstelle(b);
          // Vorlauf: Testvideo aufnehmen (10 s, nicht gemessen), danach Ruhe.
          await s.oeffne(`${basis}/video-lauf.html?bild=${encodeURIComponent(BILD)}`);
          await bis('Film bereit (Vorlauf)', () => s.auswerten(LIES_FILM), 60_000);
          await warte(3000);
          await s.leer();
          await warte(2000);
          for (const fall of reihenfolge(lauf)) {
            const r = await messeFall(b, s, fall);
            ergebnis.laeufe.push({ browser: art, lauf: lauf + 1, ...r });
            const v = r.videosNach;
            console.log(
              `${art} Lauf ${lauf + 1} ${fall.name}: ps ${r.cpuPs.toFixed(1)} % (Spitze ${r.cpuPsSpitze.toFixed(0)}), cputime ${r.cpuZeit.toFixed(1)} %, Prozesse ${r.prozesse}, ` +
                `Pruefungen ${r.pruefungenGesamt} (${r.pruefungenJeS.toFixed(2)}/s), Wechsel ${r.wechselGesamt}, Videos [${v.map((x) => `${x.urteil || '-'}${x.laeuft ? '+' : '.'}${x.imAusschnitt ? 'S' : '_'}`).join(' ')}]`,
            );
            await s.leer();
            await warte(3000);
          }
        } finally {
          await b.schliesse();
        }
        await warte(3000);
      }
    }
  } finally {
    for (const sv of server) sv.close();
  }
  if (browserListe.includes('firefox')) versionen.firefox = versionen.firefox || firefoxVersion();
  ergebnis.meta = {
    werkzeug: 'scripts/messung/video.mjs',
    befehl: `node scripts/messung/video.mjs --browser ${args.browser ?? 'beide'} --laeufe ${laeufe} --dauer ${DAUER_S} --aufwaermen ${AUFWAERMEN_S}`,
    datum: new Date().toISOString(),
    paket: `${paketJson.name} ${paketJson.version}`,
    ausgabeordner: path.relative(wurzel, ausgabeOrdner),
    versionen,
    kerne: cpus().length,
    kopflos: true,
    seite: 'tests/fixtures/video-lauf.html (Testvideo 10 s, 240 x 180 gezeigt, loop, autoplay, stumm)',
    fenster: '1280 x 1000',
  };
  const datei = path.join(hier, `ergebnis-video-${zeitstempel()}.json`);
  await writeFile(datei, JSON.stringify(ergebnis, null, 1));
  console.log(`Ergebnis: ${path.relative(wurzel, datei)}`);

  const md = [];
  md.push('| Browser | Fall | CPU % (ps) Median | Spannweite | CPU % (cputime) Median | Pruefungen je s Median | Einzelwerte ps |');
  md.push('|---|---|---|---|---|---|---|');
  for (const art of browserListe) {
    for (const fall of FAELLE) {
      const l = ergebnis.laeufe.filter((x) => x.browser === art && x.fall === fall.name);
      const ps = fasse(l.map((x) => x.cpuPs), 1);
      const zt = fasse(l.map((x) => x.cpuZeit), 1);
      const pr = fasse(l.map((x) => x.pruefungenJeS), 2);
      md.push(`| ${art} ${versionen[art]} | ${fall.name} | ${dez(ps.median)} | ${dez(ps.min)} bis ${dez(ps.max)} | ${dez(zt.median)} | ${dez(pr.median)} | ${ps.werte.map(dez).join('; ')} |`);
    }
  }
  if (typeof args.md === 'string') await writeFile(args.md, md.join('\n'));
  console.log(md.join('\n'));
}

haupt().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
