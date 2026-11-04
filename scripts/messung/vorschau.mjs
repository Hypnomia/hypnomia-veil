// Messwerkzeug Phase 4 (kein Produktcode): Vorschau-Tausch auf den Nachbauten der Erwachsenenseiten.
// Je Seite und Lauf: Anteil ersetzter Vorschaubilder, Zahl der Frames mit sichtbarem Original ("Aufblitzer"), Zeit vom Navigationsbeginn
// bis alle ersetzt sind. Eine Messsonde wird ueber einen kleinen Vorschalt-Server in jede Seite eingesetzt (vor allen Seitenskripten),
// damit beide Browser gleich messen; der Waechter der Fixtures (window.__aufblitzen) laeuft zusaetzlich mit.
//   VEIL_AUSGABE=.output-messung VEIL_FIXTURE_PORT=47333 node scripts/messung/vorschau.mjs --browser beide --laeufe 3 [--ohne-pack]
import { createServer } from 'node:http';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { starteFixtureServer } from '../../tests/fixtures-server.mjs';
import { baueDummyPack } from '../pack/baue-pack.mjs';
import { argumente, fasse, firefoxVersion, rund, warte, wurzel, zeitstempel } from './hilfe.mjs';
import { starteChromiumMitPack, starteFirefoxMitPack } from './pack-browser.mjs';
import { writeFileSync } from 'node:fs';

const arg = argumente();
const laeufe = Number(arg.laeufe ?? 3);
const browser = String(arg.browser ?? 'beide');
const ohnePack = !!arg['ohne-pack'];
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47333);
const portVor = port + 10;
const NAMEN = ['pornhub', 'xhamster', 'xvideos', 'onlyfans', 'fansly', 'x'];
const HOSTS = NAMEN.map((n) => `${n}.veil-erwachsen.test`);
const SEITEN = [
  { name: 'pornhub', host: 'pornhub', datei: 'erwachsen-pornhub.html', karten: 6 },
  { name: 'xhamster', host: 'xhamster', datei: 'erwachsen-xhamster.html', karten: 6 },
  { name: 'xvideos', host: 'xvideos', datei: 'erwachsen-xvideos.html', karten: 6 },
  { name: 'onlyfans', host: 'onlyfans', datei: 'erwachsen-onlyfans.html', karten: 4 },
  { name: 'fansly', host: 'fansly', datei: 'erwachsen-fansly.html', karten: 4 },
  { name: 'dynamisch', host: 'x', datei: 'erwachsen-dynamisch.html', karten: 5, ids: ['lazy', 'pimg', 'wechsel', 'hg', 'breit-img'] },
];

// Sonde: eine Pruefung je gezeichnetem Frame (rAF, dann setTimeout 0).
const SONDE = `<script>(function(){
var IDS=null;var M=window.__mess={tAlle:null,tErstes:null,frames:0,origFrames:0,origElemFrames:0,n:0,ersetzt:0,fertig:false,tLoad:null};
var BILD=/^data:image\\/jpeg/;
function istPack(el){var s=el.currentSrc||el.src||'';if(BILD.test(s))return true;return (el.style&&el.style.backgroundImage||'').indexOf('data:image/jpeg')>=0;}
function kandidaten(){if(IDS)return IDS.map(function(i){return document.getElementById(i);}).filter(Boolean);
 return Array.prototype.filter.call(document.querySelectorAll('[id]'),function(e){return /^v\\d+$/.test(e.id);});}
var t0=null,bereit=false;
function probe(){var t=performance.now();var el=kandidaten();M.frames++;M.n=el.length;
 var ers=0,orig=0;
 for(var i=0;i<el.length;i++){var e=el[i];
  if(istPack(e)){ers++;if(M.tErstes===null)M.tErstes=t;continue;}
  var ist=e instanceof HTMLImageElement;
  if(ist&&e.complete&&e.naturalWidth>0&&getComputedStyle(e).opacity!=='0'){orig++;}
 }
 M.ersetzt=ers;if(orig>0){M.origFrames++;M.origElemFrames+=orig;}
 if(M.tAlle===null&&el.length>=M.erwartet&&ers===el.length){M.tAlle=t;}
 if(M.tAlle!==null&&t-M.tAlle>1500)M.fertig=true;
 if(t>12000)M.fertig=true;}
function schritt(){setTimeout(probe,0);requestAnimationFrame(schritt);}
window.addEventListener('load',function(){M.tLoad=performance.now();});
window.__setzeSonde=function(erwartet,ids){M.erwartet=erwartet;IDS=ids||null;};
requestAnimationFrame(schritt);
})();</script>`;

function starteVorschalt(zielPort, hoerPort) {
  return new Promise((ok) => {
    const s = createServer(async (req, res) => {
      try {
        const r = await fetch(`http://127.0.0.1:${zielPort}${req.url}`);
        const typ = r.headers.get('content-type') ?? '';
        const puffer = Buffer.from(await r.arrayBuffer());
        const kopf = { 'content-type': typ, 'cache-control': 'no-store' };
        if (typ.startsWith('text/html')) {
          const m = req.url.match(/[?&]erwartet=(\d+)/);
          let html = puffer.toString('utf8');
          // Datei-spezifische Erwartung kommt aus der URL (erwartet=N, ids=a,b)
          const ids = (req.url.match(/[?&]ids=([^&]+)/) ?? [])[1];
          const start = `<script>window.__vorEnde=1;</script>`;
          const setze = `<script>window.__setzeSonde(${m ? m[1] : 6},${ids ? JSON.stringify(decodeURIComponent(ids).split(',')) : 'null'});</script>`;
          html = html.replace(/<head[^>]*>/i, (h) => `${h}${SONDE}${setze}${start}`);
          res.writeHead(r.status, kopf);
          res.end(html);
        } else {
          res.writeHead(r.status, kopf);
          res.end(puffer);
        }
      } catch (e) {
        res.writeHead(502);
        res.end(String(e));
      }
    });
    s.listen(hoerPort, '127.0.0.1', () => ok(s));
  });
}

const url = (ort) =>
  `http://${ort.host}.veil-erwachsen.test:${portVor}/${ort.datei}?erwartet=${ort.karten}${ort.ids ? `&ids=${ort.ids.join(',')}` : ''}`;

const LESE = () => {
  const m = window.__mess;
  return { m, w: { aufblitzen: window.__aufblitzen, unsichtbar: window.__unsichtbar, proben: window.__proben } };
};

async function messeChromium(b, ort) {
  const s = await b.context.newPage();
  try {
    await s.goto(url(ort), { waitUntil: 'load' });
    await s.waitForFunction(() => window.__mess && window.__mess.fertig, null, { timeout: 30_000, polling: 100 }).catch(() => {});
    return await s.evaluate(LESE);
  } finally {
    await s.close();
  }
}

async function messeFirefox(b, ort) {
  const d = b.driver;
  await d.get(url(ort));
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    if (await d.executeScript('return !!(window.__mess && window.__mess.fertig)')) break;
    await warte(150);
  }
  return d.executeScript(`const m=window.__mess;return {m:m,w:{aufblitzen:window.__aufblitzen,unsichtbar:window.__unsichtbar,proben:window.__proben}};`);
}

function auswerte(roh, ort) {
  const m = roh.m;
  const n = m.n || ort.karten;
  return {
    karten: ort.karten,
    gesehen: n,
    ersetzt: m.ersetzt,
    anteil: n ? m.ersetzt / n : 0,
    origFrames: m.origFrames,
    origElemFrames: m.origElemFrames,
    waechterAufblitzen: roh.w.aufblitzen,
    waechterUnsichtbar: roh.w.unsichtbar,
    tAlle: m.tAlle,
    tLoad: m.tLoad,
    tNachLoad: m.tAlle !== null && m.tLoad !== null ? m.tAlle - m.tLoad : null,
  };
}

const serverFix = await starteFixtureServer(port);
const vor = await starteVorschalt(port, portVor);
const ordner = await mkdtemp(path.join(tmpdir(), 'veil-vorschau-'));
const ergebnis = { werkzeug: 'scripts/messung/vorschau.mjs', datum: new Date().toISOString(), laeufe, ohnePack, browser: {} };
try {
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);
  const arten = browser === 'beide' ? ['chromium', 'firefox'] : [browser];
  for (const art of arten) {
    const b =
      art === 'chromium'
        ? await starteChromiumMitPack({ hostRegeln: ['MAP *.veil-erwachsen.test 127.0.0.1'] })
        : await starteFirefoxMitPack({ hosts: HOSTS });
    console.log(`${art} ${b.version}`);
    try {
      if (art === 'chromium') await b.warteAufErkenner();
      if (!ohnePack) await b.importierePack(packPfad);
      if (art === 'chromium') await b.warteAufErkenner();
      const res = { version: b.version, seiten: {} };
      for (const ort of SEITEN) {
        const laeufeListe = [];
        for (let i = 0; i < laeufe; i++) {
          await warte(300);
          const roh = art === 'chromium' ? await messeChromium(b, ort) : await messeFirefox(b, ort);
          const a = auswerte(roh, ort);
          laeufeListe.push(a);
          console.log(`${art} ${ort.name} #${i + 1}: ${a.ersetzt}/${a.gesehen} ersetzt, Original-Frames ${a.origFrames}, Waechter ${a.waechterAufblitzen}/${a.waechterUnsichtbar}, tAlle ${rund(a.tAlle)} ms, nach load ${rund(a.tNachLoad)} ms`);
        }
        res.seiten[ort.name] = {
          laeufe: laeufeListe,
          anteilMin: Math.min(...laeufeListe.map((l) => l.anteil)),
          origFramesSumme: laeufeListe.reduce((s, l) => s + l.origFrames, 0),
          waechterSumme: laeufeListe.reduce((s, l) => s + l.waechterAufblitzen, 0),
          tAlle: fasse(laeufeListe.map((l) => l.tAlle)),
          tNachLoad: fasse(laeufeListe.map((l) => l.tNachLoad)),
        };
      }
      ergebnis.browser[art] = res;
    } finally {
      await b.schliesse();
    }
  }
} finally {
  vor.close();
  serverFix.close?.();
  await rm(ordner, { recursive: true, force: true });
}
const datei = path.join(wurzel, 'scripts/messung', `ergebnis-vorschau${ohnePack ? '-ohne' : ''}-${zeitstempel()}.json`);
writeFileSync(datei, JSON.stringify(ergebnis, null, 1));
console.log(`geschrieben: ${path.relative(wurzel, datei)}`);
process.exit(0);
