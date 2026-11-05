// Messwerkzeug M2 (Phase 3): Rechenlast auf der TikTok-Nachbildung tests/fixtures/seite-tiktok.html (zwei Videos, je eine Leinwand, die das
// Video abmalt), kein Produktcode. Die Seite kommt vom Testserver aus tests/fixtures.
// Aufruf: node scripts/messung/tiktok-last.mjs --ausgabe <ordner|keine> [--browser chromium|firefox|beide] [--laeufe 3] [--dauer 30] [--aufwaermen 5]
//   --ausgabe <ordner>   Bauordner mit chrome-mv3 und Firefox-Zip (relativ zum Repo); "keine" startet den Browser ganz ohne Erweiterung (Basis)
//   VEIL_FIXTURE_PORT    Port des Testservers (sonst ein freier Port), der zweite Ursprung laeuft auf Port plus 2
// Ablauf je Lauf (frischer Browser, kopflos, Fenster 1280 x 1000): Vorlauf (die Seite nimmt ihr Testvideo auf, 10 s, nicht gemessen, danach
// aus dem localStorage), Seite neu laden, mit Erweiterung warten bis beide Videos ein Urteil haben, Aufwaermen, dann DAUER Sekunden messen.
// Last: Summe der %CPU aller Nachkommen dieses Prozesses (ohne geckodriver und ps) aus `ps`, je Sekunde; 100 % = ein voller Kern.
// Gegenprobe: Zuwachs der CPU-Zeit (cputime) dieser Prozesse ueber das Fenster geteilt durch die Wanduhrzeit.
import { execFile } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { cpus, loadavg } from 'node:os';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const ausfuehren = promisify(execFile);
const hier = path.dirname(fileURLToPath(import.meta.url));

function liesArgumente(argv) {
  const a = {};
  for (let i = 0; i < argv.length; i++) {
    if (!argv[i].startsWith('--')) continue;
    const n = argv[i + 1];
    if (n === undefined || n.startsWith('--')) a[argv[i].slice(2)] = true;
    else { a[argv[i].slice(2)] = n; i++; }
  }
  return a;
}
const args = liesArgumente(process.argv.slice(2));
const ohneErweiterung = args.ausgabe === 'keine';
if (typeof args.ausgabe === 'string' && !ohneErweiterung) process.env.VEIL_AUSGABE = args.ausgabe;

const { starteFixtureServer } = await import('../../tests/fixtures-server.mjs');
const { starteChromium, starteFirefox } = await import('./browser.mjs');
const { ausgabeOrdner, fasse, firefoxBin, firefoxVersion, freierPort, median, paketJson, tempProfil, warte, wurzel, zeitstempel } = await import('./hilfe.mjs');
const { chromium } = await import('@playwright/test');
const { Builder } = await import('selenium-webdriver');
const { default: firefox } = await import('selenium-webdriver/firefox.js');
process.env.SE_AVOID_STATS = 'true';

const browserListe = args.browser === 'chromium' ? ['chromium'] : args.browser === 'firefox' ? ['firefox'] : ['chromium', 'firefox'];
const laeufe = Number(args.laeufe ?? 3);
const DAUER_S = Number(args.dauer ?? 30);
const AUFWAERMEN_S = Number(args.aufwaermen ?? 5);
const BILD = 'IMG_0260.jpg';
const dez = (v) => (v === null || v === undefined ? 'n/a' : String(v).replace('.', ','));

// ---------- Prozessbaum (wie video.mjs) ----------

function zeitZuSekunden(t) {
  let tage = 0;
  let rest = t.trim();
  if (rest.includes('-')) [tage, rest] = [Number(rest.split('-')[0]), rest.split('-')[1]];
  let s = 0;
  for (const x of rest.split(':').map(Number)) s = s * 60 + x;
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
        if (/geckodriver$/.test(k.comm)) sammle(k.pid);
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
  const baum = browserBaum(await lesePs());
  return { w: Date.now(), anzahl: baum.length, summeCpu: baum.reduce((s, p) => s + p.cpu, 0), zeiten: new Map(baum.map((p) => [p.pid, p.zeit])) };
}

// ---------- Browser ohne Erweiterung (Basis) ----------

async function chromiumOhne() {
  const profil = await tempProfil('veil-last-');
  const context = await chromium.launchPersistentContext(profil.ordner, { channel: 'chromium', headless: true });
  const seite = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(seite);
  const version = String((await cdp.send('Browser.getVersion')).product).replace(/^.*Chrome\//, '');
  await cdp.detach().catch(() => {});
  return { art: 'chromium', version, context, async schliesse() { await context.close().catch(() => {}); await profil.aufraeumen(); } };
}

async function firefoxOhne() {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  const dienst = new firefox.ServiceBuilder();
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  const version = (await driver.getCapabilities()).get('browserVersion') ?? '';
  return { art: 'firefox', version, driver, async schliesse() { await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]); } };
}

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
      async leer() { const alt = seite; seite = await b.context.newPage(); if (alt) await alt.close(); },
    };
  }
  const d = b.driver;
  return {
    async oeffne(url) { await d.manage().window().setRect({ width: 1280, height: 1000 }).catch(() => {}); await d.get(url); },
    auswerten: (skript, arg) => d.executeScript(`return (${skript.toString()})(arguments[0])`, arg ?? null),
    async leer() { await d.get('about:blank'); },
  };
}

async function bis(beschreibung, lies, frist = 30_000) {
  const t0 = Date.now();
  let letzter = null;
  while (Date.now() - t0 < frist) {
    try { letzter = await lies(); if (letzter) return letzter; } catch { /* Seite wechselt gerade */ }
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert ${JSON.stringify(letzter)})`);
}

const LIES_STATUS = () => { const r = document.documentElement.dataset.veilStatus; return r ? JSON.parse(r) : null; };
const LIES_FILM = () => document.documentElement.dataset.filmBereit ?? null;
const LIES_URTEILE = () => window.testUrteile();
const LIES_ENDE = () => ({ urteile: window.testUrteile(), abweichung: window.__abweichung, wechsel: window.__wechsel.length, spielt: window.__karten.map((k) => !k.v.paused && k.v.readyState >= 2), ct: window.__karten.map((k) => k.v.currentTime) });
const VIDEOS_MIT_URTEIL = () => { const u = window.testUrteile(); return !!u.v1 && !!u.v2; };

async function laufEins(b, s, basis) {
  const url = `${basis}/seite-tiktok.html?bild=${encodeURIComponent(BILD)}`;
  // Vorlauf: Aufnahme des Testvideos, nicht gemessen.
  await s.oeffne(url);
  await bis('Film bereit (Vorlauf)', () => s.auswerten(LIES_FILM), 60_000);
  await warte(3000);
  await s.leer();
  await warte(2000);
  await s.oeffne(url);
  await bis('Film bereit', () => s.auswerten(LIES_FILM), 40_000);
  let urteileDa = null;
  if (!ohneErweiterung) {
    urteileDa = true;
    try { await bis('Videos mit Urteil', () => s.auswerten(VIDEOS_MIT_URTEIL), 40_000); } catch { urteileDa = false; }
  }
  await warte(AUFWAERMEN_S * 1000);

  const statusVor = ohneErweiterung ? null : await s.auswerten(LIES_STATUS);
  const proben = [await probe()];
  const pruefReihe = [statusVor?.videoPruefungen ?? 0];
  const t0 = Date.now();
  const lastVor = loadavg()[0];
  for (let i = 1; i <= DAUER_S; i++) {
    await warte(Math.max(0, t0 + i * 1000 - Date.now()));
    proben.push(await probe());
    if (!ohneErweiterung) pruefReihe.push((await s.auswerten(LIES_STATUS))?.videoPruefungen ?? null);
  }
  const ende = await s.auswerten(LIES_ENDE);
  const statusNach = ohneErweiterung ? null : await s.auswerten(LIES_STATUS);

  const summen = proben.slice(1).map((p) => p.summeCpu);
  const mittelPs = summen.reduce((a, c) => a + c, 0) / summen.length;
  let zuwachs = 0;
  for (let i = 1; i < proben.length; i++) {
    for (const [pid, z] of proben[i].zeiten) {
      const vorher = proben[i - 1].zeiten.get(pid);
      zuwachs += vorher === undefined ? z : Math.max(0, z - vorher);
    }
  }
  const wand = (proben[proben.length - 1].w - proben[0].w) / 1000;
  const pruefungen = ohneErweiterung ? null : pruefReihe[pruefReihe.length - 1] - pruefReihe[0];
  return {
    cpuPs: mittelPs,
    cpuPsSpitze: Math.max(...summen),
    cpuZeit: (zuwachs / wand) * 100,
    prozesse: Math.round(median(proben.map((p) => p.anzahl))),
    pruefungenGesamt: pruefungen,
    pruefungenJeS: pruefungen === null ? null : pruefungen / DAUER_S,
    urteileVorMessung: urteileDa,
    ende,
    videoWechsel: statusNach?.videoWechsel ?? null,
    videoFristen: statusNach?.videoFristen ?? null,
    summen,
    wandS: wand,
    ladung: { vor: lastVor, nach: loadavg()[0] },
  };
}

async function haupt() {
  const port = Number(process.env.VEIL_FIXTURE_PORT) || (await freierPort());
  const server = [await starteFixtureServer(port), await starteFixtureServer(port + 2)];
  const basis = `http://127.0.0.1:${port}`;
  const ergebnis = { meta: {}, laeufe: [] };
  const versionen = {};
  try {
    for (const art of browserListe) {
      for (let lauf = 1; lauf <= laeufe; lauf++) {
        const b = ohneErweiterung ? (art === 'chromium' ? await chromiumOhne() : await firefoxOhne()) : art === 'chromium' ? await starteChromium() : await starteFirefox();
        versionen[art] = b.version || versionen[art];
        try {
          const r = await laufEins(b, schnittstelle(b), basis);
          ergebnis.laeufe.push({ browser: art, lauf, ...r });
          const u = r.ende.urteile;
          console.log(`${art} Lauf ${lauf}: ps ${r.cpuPs.toFixed(1)} % (Spitze ${r.cpuPsSpitze.toFixed(0)}), cputime ${r.cpuZeit.toFixed(1)} %, Prozesse ${r.prozesse}, Pruefungen ${r.pruefungenGesamt === null ? 'n/a' : `${r.pruefungenGesamt} (${r.pruefungenJeS.toFixed(2)}/s)`}, Wechsel ${r.videoWechsel ?? 'n/a'}, Urteile v1 ${u.v1 || '-'} v2 ${u.v2 || '-'} c1 ${u.c1 || '-'} c2 ${u.c2 || '-'}, Abweichungen ${r.ende.abweichung}`);
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
    werkzeug: 'scripts/messung/tiktok-last.mjs',
    befehl: `${process.env.VEIL_FIXTURE_PORT ? 'VEIL_FIXTURE_PORT=<port> ' : ''}node scripts/messung/tiktok-last.mjs --ausgabe ${ohneErweiterung ? 'keine' : path.relative(wurzel, ausgabeOrdner)} --browser ${args.browser ?? 'beide'} --laeufe ${laeufe} --dauer ${DAUER_S} --aufwaermen ${AUFWAERMEN_S}`,
    datum: new Date().toISOString(),
    paket: `${paketJson.name} ${paketJson.version}`,
    erweiterung: ohneErweiterung ? 'keine' : path.relative(wurzel, ausgabeOrdner),
    versionen,
    kerne: cpus().length,
    kopflos: true,
    seite: 'tests/fixtures/seite-tiktok.html (zwei Videos 10 s, loop, je eine 2d-Leinwand 270 x 300, die jedes Bild abmalt)',
    fenster: '1280 x 1000',
  };
  const datei = path.join(hier, `ergebnis-tiktok-${ohneErweiterung ? 'ohne' : path.basename(ausgabeOrdner).replace(/^\./, '')}-${zeitstempel()}.json`);
  await writeFile(datei, JSON.stringify(ergebnis, null, 1));
  console.log(`Ergebnis: ${path.relative(wurzel, datei)}`);
  for (const art of browserListe) {
    const l = ergebnis.laeufe.filter((x) => x.browser === art);
    const ps = fasse(l.map((x) => x.cpuPs), 1);
    const zt = fasse(l.map((x) => x.cpuZeit), 1);
    console.log(`| ${art} ${versionen[art]} | ${dez(ps.median)} (${dez(ps.min)} bis ${dez(ps.max)}) | ${dez(zt.median)} | ${ps.werte.map(dez).join('; ')} |`);
  }
}

haupt().then(() => process.exit(0), (e) => { console.error(e); process.exit(1); });
