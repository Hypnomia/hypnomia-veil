// Messwerkzeug Phase 4, Session 8 (kein Produktcode): Galerie in der Seite (D), Player-Riegel (E), Freilegen (F), Titel (T).
//   VEIL_AUSGABE=.output-m VEIL_FIXTURE_PORT=47383 VEIL_FIXTURE_PORT_FREMD=47385 node scripts/messung/session8.mjs --browser beide --teil D1,D2,D3,D4,E1,E2,F,T [--laeufe 8]
// Teile: D1 Listen-Seite ohne Pack (Dauer der Verdeckung), D2 mit Pack und Schalter (Waechter), D3 Pause in der Galerie bis Seite sichtbar,
// D4 Blitz (Schalter 10 Mal in 2 s), E1 Player-Riegel (currentTime beim Erscheinen, Zeit bis Riegel), E2 Blitz des Riegels (5 Pausen, kleiner und grosser Anker),
// F Freilegen (sichtbare Dauer gegen Soll 3000 und 10000 ms), T Titel (Zeit bis ersetzt, Zeit des Originals).
// Firefox 128: VEIL_FIREFOX_BIN setzen (Pfad nie in Dateien). Vor jeder Reihe wird das Lastmittel (1 min) gelesen (Grenze 4,5, bis 20 min warten).
import { createServer } from 'node:http';
import os from 'node:os';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { starteFixtureServer } from '../../tests/fixtures-server.mjs';
import { baueDummyPack } from '../pack/baue-pack.mjs';
import { DUMMY_QUIZ } from '../pack/dummy-inhalte.mjs';
import { argumente, fasse, rund, warte, wurzel, zeitstempel } from './hilfe.mjs';
import { starteChromiumMitPack, starteFirefoxMitPack } from './pack-browser.mjs';

const arg = argumente();
const browserWahl = String(arg.browser ?? 'beide');
const teile = String(arg.teil ?? 'D1,D2,D3,D4,E1,E2,F,T').split(',');
const laeufeStandard = Number(arg.laeufe ?? 8);
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47383);
const portVor = port + 10;
const LAST_GRENZE = 4.5;
const FRAGEN = DUMMY_QUIZ.fragen.filter((f) => f.art === 'wissen' || f.art === 'allgemein');
const HOSTS = ['pornhub.veil-erwachsen.test', 'xhamster.veil-erwachsen.test'];
const LISTE = `http://pornhub.veil-erwachsen.test:${port}/ersatz.html`;
const SPIELER = `http://127.0.0.1:${port}/erwachsen-player.html`;
const FREILEGEN = `http://127.0.0.1:${port}/freilegen.html`;
const TITEL = `http://pornhub.veil-erwachsen.test:${portVor}/erwachsen-titel.html`;
const DUMMY_VORSCHAU = 4;

const last = () => os.loadavg()[0];
async function warteAufRuhe(name) {
  const t0 = Date.now();
  let l = last();
  while (l > LAST_GRENZE && Date.now() - t0 < 20 * 60_000) {
    console.log(`Last ${rund(l, 2)} ueber ${LAST_GRENZE}, warte (${name})`);
    await warte(110_000);
    l = last();
  }
  return { vor: rund(l, 2), unterLast: l > LAST_GRENZE };
}

async function bis(beschreibung, fn, frist = 15_000, schritt = 40) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return Date.now() - t0;
    await warte(schritt);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)?.slice(0, 200)})`);
}

// Gemeinsame Seitenschicht fuer Chromium (Playwright) und Firefox (WebDriver). Seitencode wird als Funktion uebergeben (toString).
function seite(b) {
  if (b.art === 'chromium') {
    let p = null;
    return {
      async oeffne() {
        p = await b.context.newPage();
      },
      async zu() {
        if (p) await p.close().catch(() => {});
        p = null;
      },
      async gehe(url) {
        await p.goto(url, { waitUntil: 'domcontentloaded' });
      },
      ev: (fn, a) => p.evaluate(`(${fn.toString()})(${JSON.stringify(a ?? null)})`),
      klick: (x, y) => p.mouse.click(x, y),
    };
  }
  const d = b.driver;
  return {
    async oeffne() {
      await d.switchTo().window(b.hauptFenster);
    },
    async zu() {},
    async gehe(url) {
      await d.switchTo().window(b.hauptFenster);
      await d.get(url);
    },
    async ev(fn, a) {
      const r = await d.executeAsyncScript(
        `const fertig = arguments[arguments.length - 1];
         Promise.resolve((${fn.toString()})(${JSON.stringify(a ?? null)})).then((w) => fertig(w === undefined ? null : w), (e) => fertig({ fehlerText: String(e) }));`,
      );
      if (r && typeof r === 'object' && r.fehlerText) throw new Error(`Seite: ${r.fehlerText}`);
      return r;
    },
    async klick(x, y) {
      await d.actions({ async: true }).move({ x: Math.round(x), y: Math.round(y), origin: 'viewport' }).click().perform();
    },
  };
}

const maxInSekunde = (zeiten) => {
  let h = 0;
  for (const t of zeiten) h = Math.max(h, zeiten.filter((u) => u >= t && u < t + 1000).length);
  return h;
};

// ---------- Seitencode (laeuft in der Seite) ----------
const seiteLeseErsatz = () => ({
  t0: window.__t0,
  hat0: window.__hat0,
  m: window.__m,
  e: window.__e,
  sicht: getComputedStyle(document.getElementById('inhalt')).visibility,
  attr: document.documentElement.hasAttribute('data-veil-ersatz'),
  host: !!document.querySelector('[data-veil-ersatz-host]'),
});
const seiteAbbildErsatz = () => document.documentElement.getAttribute('data-veil-ersatz-abbild');
const seiteZustandErsatz = () => ({ attr: document.documentElement.hasAttribute('data-veil-ersatz'), host: !!document.querySelector('[data-veil-ersatz-host]') });
const seiteBeobachterErsatz = () => {
  const z = (window.__host = []);
  const a = (window.__attr = []);
  new MutationObserver((l) => {
    for (const m of l) {
      for (const n of m.addedNodes) if (n.hasAttribute && n.hasAttribute('data-veil-ersatz-host')) z.push(['an', performance.now()]);
      for (const n of m.removedNodes) if (n.hasAttribute && n.hasAttribute('data-veil-ersatz-host')) z.push(['aus', performance.now()]);
    }
  }).observe(document.documentElement, { childList: true });
  new MutationObserver(() => a.push([document.documentElement.getAttribute('data-veil-ersatz'), performance.now()])).observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['data-veil-ersatz'],
  });
  return true;
};
const seiteLeseBeobachter = () => ({ host: window.__host, attr: window.__attr });
// Pause-Messung: Zeitpunkt (Epoche) des Wegfalls von Verdeckung und Host in der Seite.
const seiteBeobachterPause = () => {
  const E = (window.__pause = { attrWeg: null, hostWeg: null });
  const epoche = () => performance.timeOrigin + performance.now();
  new MutationObserver(() => {
    if (!document.documentElement.hasAttribute('data-veil-ersatz') && E.attrWeg === null) E.attrWeg = epoche();
    if (!document.querySelector('[data-veil-ersatz-host]') && E.hostWeg === null) E.hostWeg = epoche();
  }).observe(document.documentElement, { attributes: true, childList: true, subtree: true });
  return true;
};
const seiteLesePause = () => ({ ...window.__pause, sicht: getComputedStyle(document.getElementById('inhalt')).visibility });

const seiteStartePlayer = (opt) => {
  const M = (window.__rm = { frames: 0, maxMedia: 0, t0: performance.now(), host: null, offen: null, playing: null, ende: null, rvfc: false });
  const probe = (name) => {
    const v = window.findeVideo('haupt');
    const p = v ? v.played : null;
    return {
      name,
      t: performance.now(),
      ct: v ? v.currentTime : null,
      paused: v ? v.paused : null,
      playedEnde: p && p.length ? p.end(p.length - 1) : 0,
      playedN: p ? p.length : 0,
      frames: M.frames,
      maxMedia: M.maxMedia,
      muted: v ? v.muted : null,
    };
  };
  new MutationObserver(() => {
    if (!M.host && document.querySelector('[data-veil-riegel-host]')) M.host = probe('host');
    const a = document.documentElement.getAttribute('data-veil-riegel');
    if (a && !M.offen) {
      try {
        const j = JSON.parse(a);
        if (j.offen && j.zustand === 'frage') {
          M.offen = probe('offen');
          setTimeout(() => (M.ende = probe('ende')), 1500);
        }
      } catch (e) {
        // Abbild noch unvollstaendig
      }
    }
  }).observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['data-veil-riegel'] });
  const v = window.neuesVideo({ id: 'haupt', autoplay: true, ziel: opt && opt.ziel });
  M.tVideo = performance.now();
  if (v.requestVideoFrameCallback) {
    M.rvfc = true;
    const cb = (jetzt, md) => {
      M.frames++;
      M.maxMedia = Math.max(M.maxMedia, md.mediaTime);
      v.requestVideoFrameCallback(cb);
    };
    v.requestVideoFrameCallback(cb);
  }
  v.addEventListener('playing', () => {
    if (!M.playing) M.playing = probe('playing');
  });
  return true;
};
const seiteLesePlayer = () => window.__rm;
const seiteRiegelAbbild = () => document.documentElement.getAttribute('data-veil-riegel');
const seiteRiegelHost = () => !!document.querySelector('[data-veil-riegel-host]');
const seiteBeobachterRiegel = (opt) => {
  const z = (window.__riegelZ = []);
  const hat = (n) => n.nodeType === 1 && (n.hasAttribute('data-veil-riegel-host') || !!n.querySelector('[data-veil-riegel-host]'));
  new MutationObserver((l) => {
    for (const m of l) {
      for (const n of m.addedNodes) if (hat(n)) z.push(['an', performance.now()]);
      for (const n of m.removedNodes) if (hat(n)) z.push(['aus', performance.now()]);
    }
  }).observe(document.documentElement, { childList: true, subtree: true });
  window.neuesVideo({ id: 'haupt', autoplay: true, ziel: opt.ziel });
  return true;
};
const seiteLeseRiegelZ = () => ({ z: window.__riegelZ, jetzt: performance.now() });
const seiteHoehe = (id) => {
  const e = document.getElementById(id);
  return e ? e.getBoundingClientRect().height : null;
};

const seiteStarteFreilegen = () => {
  const el = document.getElementById('a');
  const F = (window.__fr = { log: [], frames: [], zweite: false });
  const ist = () => ({ t: performance.now(), v: el.getAttribute('data-veil'), orig: !String(el.getAttribute('src') || '').startsWith('data:') });
  F.log.push(ist());
  new MutationObserver(() => F.log.push(ist())).observe(el, { attributes: true, attributeFilter: ['data-veil', 'src'] });
  const schritt = () => {
    setTimeout(() => {
      const s = ist();
      if (s.orig && el.complete) F.frames.push(s.t);
    }, 0);
    requestAnimationFrame(schritt);
  };
  requestAnimationFrame(schritt);
  return true;
};
const seiteLeseFreilegen = () => window.__fr;
const seiteAttr = (name) => document.documentElement.getAttribute(name);
const seiteVeil = (id) => {
  const e = document.getElementById(id);
  return e ? e.getAttribute('data-veil') : null;
};
const seiteSchnell = () => document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ zweiterVersuchMs: 500 }) }));

const seiteLeseTitel = () => window.__t;

// ---------- Messsonde der Titel (kommt ueber den Vorschalt-Server als erstes Skript in den Kopf) ----------
const SONDE_TITEL = `<script>(function(){
var M=window.__t={frames:0,tKarteErst:null,tKarteErsetzt:null,tTabErst:null,tTabErsetzt:null,tSeiteErst:null,tSeiteErsetzt:null,tLoad:null,
 origKarteFrames:0,origTabFrames:0,origSeiteFrames:0,fKarteErsetzt:null,fTabErsetzt:null,fKarteErst:null,fertig:false};
var P='Test title:';
function karte(){var e=document.getElementById('t1');return e?e.textContent:null;}
function seiteT(){var e=document.getElementById('seitentitel-text');return e?e.textContent:null;}
function mut(){var t=performance.now();var k=karte(),s=seiteT(),d=document.title;
 if(k!==null){if(M.tKarteErst===null)M.tKarteErst=t;if(k.indexOf(P)===0&&M.tKarteErsetzt===null)M.tKarteErsetzt=t;}
 if(s!==null){if(M.tSeiteErst===null)M.tSeiteErst=t;if(s.indexOf(P)===0&&M.tSeiteErsetzt===null)M.tSeiteErsetzt=t;}
 if(d){if(M.tTabErst===null)M.tTabErst=t;if(d.indexOf(P)===0&&M.tTabErsetzt===null)M.tTabErsetzt=t;}}
new MutationObserver(mut).observe(document,{childList:true,subtree:true,characterData:true});
function probe(){var t=performance.now();M.frames++;var k=karte(),s=seiteT(),d=document.title;
 if(k==='Original card one'){M.origKarteFrames++;if(M.fKarteErst===null)M.fKarteErst=t;}
 if(k!==null&&k.indexOf(P)===0&&M.fKarteErsetzt===null)M.fKarteErsetzt=t;
 if(d==='Original tab title')M.origTabFrames++;
 if(d.indexOf(P)===0&&M.fTabErsetzt===null)M.fTabErsetzt=t;
 if(s==='Original page title')M.origSeiteFrames++;
 if(M.fKarteErsetzt!==null&&M.fTabErsetzt!==null&&t-Math.max(M.fKarteErsetzt,M.fTabErsetzt)>1000)M.fertig=true;
 if(t>10000)M.fertig=true;}
function schritt(){setTimeout(probe,0);requestAnimationFrame(schritt);}
window.addEventListener('load',function(){M.tLoad=performance.now();});
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
          const html = puffer.toString('utf8').replace(/<head[^>]*>/i, (h) => `${h}${SONDE_TITEL}`);
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

// ---------- Einstellungen ----------
const ERSATZ = (an, extra = {}) => ({ erwachsen: { an: true, komplettErsatz: an, erkennenAmInhalt: true, eigeneSeiten: [] }, ...extra });
const EINST_PLAYER = { pause: false, quiz: { verweigern: 0, freilegenMs: 10000 }, erwachsen: { an: true, komplettErsatz: false, erkennenAmInhalt: true, eigeneSeiten: ['127.0.0.1'] } };

// ---------- Teile ----------
async function teilD1(b, s, n) {
  await b.setzeEinstellungen(ERSATZ(true, { pause: false }));
  const laeufe = [];
  for (let i = 0; i < n + 1; i++) {
    await s.oeffne();
    try {
      await s.gehe(LISTE);
      await bis('Verdeckung weg', async () => {
        const z = await s.ev(seiteZustandErsatz);
        return !z.attr && !z.host;
      }, 15_000, 25);
      await warte(300);
      const r = await s.ev(seiteLeseErsatz);
      const aus = (r.m ?? []).find((x) => x[0] === 'aus');
      const absolut = aus ? aus[1] : r.t0;
      const ms = aus ? aus[1] - r.t0 : r.t0;
      const l = { warmlauf: i === 0, hat0: r.hat0, msAbKopfSkript: rund(ms), msAbNavigation: rund(absolut), sichtbarDanach: r.sicht === 'visible', wechsel: (r.m ?? []).length };
      laeufe.push(l);
      console.log(`${b.art} D1 #${i} ${l.warmlauf ? '(Warmlauf) ' : ''}hat0 ${l.hat0}: ${l.msAbKopfSkript} ms ab Kopf-Skript, ${l.msAbNavigation} ms ab Navigation, sichtbar ${l.sichtbarDanach}`);
    } finally {
      await s.zu();
    }
    await warte(250);
  }
  const echte = laeufe.filter((l) => !l.warmlauf);
  return {
    laeufe: echte,
    warmlauf: laeufe[0],
    abKopfSkript: fasse(echte.map((l) => l.msAbKopfSkript), 2),
    abNavigation: fasse(echte.map((l) => l.msAbNavigation), 2),
    alleSichtbar: echte.every((l) => l.sichtbarDanach),
    hat0Anzahl: echte.filter((l) => l.hat0).length,
  };
}

async function warteGalerie(s, frist = 20_000) {
  await bis('Galerie', async () => {
    const t = await s.ev(seiteAbbildErsatz);
    if (!t) return false;
    return (JSON.parse(t).breiten ?? []).filter((x) => x > 0).length === DUMMY_VORSCHAU;
  }, frist, 40);
  return JSON.parse(await s.ev(seiteAbbildErsatz));
}

async function teilD2(b, s, n) {
  await b.setzeEinstellungen(ERSATZ(true, { pause: false }));
  const laeufe = [];
  for (let i = 0; i < n; i++) {
    await s.oeffne();
    try {
      await s.gehe(LISTE);
      const t0 = Date.now();
      await warteGalerie(s);
      const bisGalerie = Date.now() - t0;
      await warte(500);
      const r = await s.ev(seiteLeseErsatz);
      const e = r.e;
      const l = { proben: e.proben, sichtbarMitAttr: e.sichtbarMitAttr, hgFalsch: e.hgFalsch, ohneAttr: e.ohneAttr, ersteProbeMitAttr: e.ersteProbeMitAttr, bisGalerieMs: bisGalerie };
      laeufe.push(l);
      console.log(`${b.art} D2 #${i + 1}: Proben ${l.proben}, sichtbar ${l.sichtbarMitAttr}, Hintergrund falsch ${l.hgFalsch}, ohne Verdeckung ${l.ohneAttr}, erste Probe verdeckt ${l.ersteProbeMitAttr}`);
    } finally {
      await s.zu();
    }
    await warte(250);
  }
  const summe = (k) => laeufe.reduce((a, l) => a + l[k], 0);
  return {
    laeufe,
    proben: summe('proben'),
    treffer: summe('sichtbarMitAttr') + summe('hgFalsch') + summe('ohneAttr'),
    sichtbarMitAttr: summe('sichtbarMitAttr'),
    hgFalsch: summe('hgFalsch'),
    ohneAttr: summe('ohneAttr'),
    ersteProbeImmerVerdeckt: laeufe.every((l) => l.ersteProbeMitAttr === true),
  };
}

async function teilD3(b, s, n) {
  const laeufe = [];
  for (let i = 0; i < n; i++) {
    await b.setzeEinstellungen(ERSATZ(true, { pause: false }));
    await warte(300);
    await s.oeffne();
    try {
      await s.gehe(LISTE);
      const a = await warteGalerie(s);
      await warte(400);
      await s.ev(seiteBeobachterPause);
      const t0 = Date.now();
      const e0 = performance.timeOrigin + performance.now();
      await s.klick(a.pause.x + a.pause.w / 2, a.pause.y + a.pause.h / 2);
      const poll = await bis('Seite sichtbar', async () => {
        const z = await s.ev(seiteZustandErsatz);
        return !z.attr && !z.host;
      }, 10_000, 15);
      const r = await s.ev(seiteLesePause);
      const l = {
        pollMs: poll,
        gesamtMs: Date.now() - t0,
        inSeiteAttrMs: r.attrWeg !== null ? rund(r.attrWeg - e0) : null,
        inSeiteHostMs: r.hostWeg !== null ? rund(r.hostWeg - e0) : null,
        sichtbar: r.sicht === 'visible',
      };
      laeufe.push(l);
      console.log(`${b.art} D3 #${i + 1}: Pause bis Seite sichtbar in der Seite ${l.inSeiteAttrMs} ms (Verdeckung), ${l.inSeiteHostMs} ms (Galerie), Abfrage ${l.pollMs} ms, sichtbar ${l.sichtbar}`);
    } finally {
      await s.zu();
    }
  }
  await b.setzeEinstellungen({ pause: false });
  return {
    laeufe,
    verdeckungWeg: fasse(laeufe.map((l) => l.inSeiteAttrMs), 1),
    galerieWeg: fasse(laeufe.map((l) => l.inSeiteHostMs), 1),
    abfrage: fasse(laeufe.map((l) => l.pollMs), 0),
    alleSichtbar: laeufe.every((l) => l.sichtbar),
  };
}

async function teilD4(b, s, n) {
  const wechsle = b.art === 'firefox' ? (x) => b.setzeSchnell(x) : (x) => b.setzeEinstellungen(x);
  await b.setzeEinstellungen(ERSATZ(true, { pause: false }));
  const laeufe = [];
  for (let i = 0; i < n; i++) {
    await s.oeffne();
    try {
      await s.gehe(LISTE);
      await warteGalerie(s);
      await warte(300);
      await s.ev(seiteBeobachterErsatz);
      const start = Date.now();
      const echt = [];
      for (let k = 0; k < 10; k++) {
        const soll = k * 200;
        const rest = soll - (Date.now() - start);
        if (rest > 0) await warte(rest);
        const a0 = Date.now() - start;
        await wechsle(ERSATZ(k % 2 === 1));
        echt.push([a0, Date.now() - start]);
      }
      const dauerWechsel = Date.now() - start;
      await wechsle(ERSATZ(true));
      await warteGalerie(s, 25_000);
      await warte(1500);
      const r = await s.ev(seiteLeseBeobachter);
      const hz = (r.host ?? []).map((x) => x[1]);
      const az = (r.attr ?? []).map((x) => x[1]);
      const l = {
        wechselDauerMs: dauerWechsel,
        wechselStart: echt.map((x) => x[0]),
        hostEreignisse: hz.length,
        hoechstHostJeSekunde: maxInSekunde(hz),
        attrEreignisse: az.length,
        hoechstAttrJeSekunde: maxInSekunde(az),
        galerieSteht: (await s.ev(seiteZustandErsatz)).host,
      };
      laeufe.push(l);
      console.log(`${b.art} D4 #${i + 1}: 10 Umschaltungen in ${l.wechselDauerMs} ms, Galerie-Wechsel ${l.hostEreignisse}, hoechstens ${l.hoechstHostJeSekunde} je Sekunde (Verdeckung: ${l.attrEreignisse}, ${l.hoechstAttrJeSekunde}), Galerie steht ${l.galerieSteht}`);
    } finally {
      await s.zu();
    }
    await warte(300);
  }
  await b.setzeEinstellungen(ERSATZ(true, { pause: false }));
  return {
    laeufe,
    umschaltDauer: fasse(laeufe.map((l) => l.wechselDauerMs), 0),
    ereignisse: fasse(laeufe.map((l) => l.hostEreignisse), 0),
    hoechstHost: fasse(laeufe.map((l) => l.hoechstHostJeSekunde), 0),
    hoechstAttr: fasse(laeufe.map((l) => l.hoechstAttrJeSekunde), 0),
    alleGalerieSteht: laeufe.every((l) => l.galerieSteht),
  };
}

async function teilE1(b, s, n) {
  await b.setzeEinstellungen(EINST_PLAYER);
  await warte(300);
  const laeufe = [];
  for (let i = 0; i < n + 1; i++) {
    await s.oeffne();
    try {
      await s.gehe(SPIELER);
      await bis('Film bereit', async () => (await s.ev(seiteAttr, 'data-film-bereit')) !== null || (await s.ev(() => document.documentElement.dataset.filmBereit === '1')), 40_000, 100);
      await s.ev(seiteStartePlayer, {});
      await bis('Riegel offen', async () => (await s.ev(seiteLesePlayer)).offen, 15_000, 50);
      await warte(1800);
      const m = await s.ev(seiteLesePlayer);
      const l = {
        warmlauf: i === 0,
        rvfc: m.rvfc,
        bisHostMs: rund(m.host.t - m.tVideo),
        bisOffenMs: rund(m.offen.t - m.tVideo),
        abNavigationOffenMs: rund(m.offen.t),
        ctBeiHost: m.host.ct,
        ctBeiOffen: m.offen.ct,
        playedEndeBeiHost: m.host.playedEnde,
        playedEndeBeiOffen: m.offen.playedEnde,
        bilderBeiHost: m.host.frames,
        bilderBeiOffen: m.offen.frames,
        maxMediaBeiOffen: m.offen.maxMedia,
        pausedBeiOffen: m.offen.paused,
        mutedBeiOffen: m.offen.muted,
        playingVorRiegel: m.playing ? rund(m.offen.t - m.playing.t) : null,
        ctNach1500: m.ende ? m.ende.ct : null,
        bilderNach1500: m.ende ? m.ende.frames : null,
        pausedNach1500: m.ende ? m.ende.paused : null,
      };
      laeufe.push(l);
      console.log(`${b.art} E1 #${i}${l.warmlauf ? ' (Warmlauf)' : ''}: Riegel nach ${l.bisHostMs} ms (Host) / ${l.bisOffenMs} ms (offen); currentTime ${l.ctBeiHost}/${l.ctBeiOffen}, gespielt bis ${l.playedEndeBeiOffen}, Bilder ${l.bilderBeiOffen}, paused ${l.pausedBeiOffen}, nach 1,5 s ct ${l.ctNach1500} Bilder ${l.bilderNach1500}`);
    } finally {
      await s.zu();
    }
    await warte(300);
  }
  const echte = laeufe.filter((l) => !l.warmlauf);
  return {
    laeufe: echte,
    warmlauf: laeufe[0],
    bisHost: fasse(echte.map((l) => l.bisHostMs), 1),
    bisOffen: fasse(echte.map((l) => l.bisOffenMs), 1),
    abNavigationOffen: fasse(echte.map((l) => l.abNavigationOffenMs), 1),
    ctBeiOffen: fasse(echte.map((l) => l.ctBeiOffen), 3),
    playedEndeMax: Math.max(...echte.map((l) => l.playedEndeBeiOffen ?? 0)),
    bilderBeiOffenMax: Math.max(...echte.map((l) => l.bilderBeiOffen ?? 0)),
    ctNach1500Max: Math.max(...echte.map((l) => l.ctNach1500 ?? 0)),
    bilderNach1500Max: Math.max(...echte.map((l) => l.bilderNach1500 ?? 0)),
  };
}

async function teilE2(b, s, n) {
  const wechsle = b.art === 'firefox' ? (x) => b.setzeSchnell(x) : (x) => b.setzeEinstellungen(x);
  await b.setzeEinstellungen(EINST_PLAYER);
  await warte(300);
  const ergebnis = {};
  for (const anker of [
    { name: 'klein', ziel: 'player', id: 'player' },
    { name: 'gross', ziel: 'fremd', id: 'fremd' },
  ]) {
    const laeufe = [];
    for (let i = 0; i < n; i++) {
      await wechsle({ pause: false });
      await warte(300);
      await s.oeffne();
      try {
        await s.gehe(SPIELER);
        await bis('Film bereit', () => s.ev(() => document.documentElement.dataset.filmBereit === '1'), 40_000, 100);
        const hoehe = await s.ev(seiteHoehe, anker.id);
        await s.ev(seiteBeobachterRiegel, { ziel: anker.ziel });
        await bis('Riegel offen', () => s.ev(seiteRiegelHost), 20_000, 50);
        await warte(800);
        const start = Date.now();
        for (let k = 0; k < 5; k++) {
          await wechsle({ pause: true });
          await warte(120);
          await wechsle({ pause: false });
          await warte(120);
        }
        const schnell = Date.now() - start;
        // Zur Ruhe kommen: Riegel steht und seit 2 s kein Ereignis mehr.
        await bis('Ruhe', async () => {
          const r = await s.ev(seiteLeseRiegelZ);
          const letztes = r.z.length ? r.z[r.z.length - 1][1] : 0;
          return (await s.ev(seiteRiegelHost)) && r.jetzt - letztes > 2000;
        }, 40_000, 200);
        const r = await s.ev(seiteLeseRiegelZ);
        const zeiten = r.z.map((x) => x[1]);
        const aufNachAnfang = r.z.filter((x) => x[1] > 0);
        const l = {
          ankerHoehe: rund(hoehe, 0),
          schnelleDauerMs: schnell,
          ereignisse: zeiten.length,
          hoechstJeSekunde: maxInSekunde(zeiten),
          riegelSteht: await s.ev(seiteRiegelHost),
          dauerBisRuheMs: Math.round((r.jetzt - zeiten[0]) / 1) - 2000,
          anOeffnungen: aufNachAnfang.filter((x) => x[0] === 'an').length,
        };
        laeufe.push(l);
        console.log(`${b.art} E2 ${anker.name} (${l.ankerHoehe} px) #${i + 1}: 5 Pausen in ${l.schnelleDauerMs} ms, Wechsel ${l.ereignisse} (Oeffnungen ${l.anOeffnungen}), hoechstens ${l.hoechstJeSekunde} je Sekunde, Riegel steht ${l.riegelSteht}`);
      } finally {
        await s.zu();
      }
    }
    await wechsle({ pause: false });
    ergebnis[anker.name] = {
      laeufe,
      ankerHoehe: laeufe[0]?.ankerHoehe,
      ereignisse: fasse(laeufe.map((l) => l.ereignisse), 0),
      hoechst: fasse(laeufe.map((l) => l.hoechstJeSekunde), 0),
      alleRiegelSteht: laeufe.every((l) => l.riegelSteht),
    };
  }
  return ergebnis;
}

async function loeseRiegel(b, s) {
  for (let versuch = 0; versuch < 6; versuch++) {
    let a = null;
    await bis('Frage', async () => {
      const t = await s.ev(seiteRiegelAbbild);
      a = t ? JSON.parse(t) : null;
      return a && a.zustand === 'frage';
    }, 15_000, 50);
    for (let i = 0; i < 20; i++) {
      await warte(150);
      const t = await s.ev(seiteRiegelAbbild);
      const bb = t ? JSON.parse(t) : null;
      if (!bb || bb.zustand !== 'frage') {
        a = bb;
        break;
      }
      const gleich = JSON.stringify(bb.antworten) === JSON.stringify(a.antworten);
      a = bb;
      if (gleich) break;
    }
    if (!a || a.zustand !== 'frage') return;
    const f = FRAGEN.find((q) => q.id === a.frage.id);
    if (!f) throw new Error(`Frage ${a.frage.id} unbekannt`);
    const ziel = a.antworten.find((x) => x.text === f.antworten[f.richtig]);
    await s.klick(ziel.x + ziel.w / 2, ziel.y + ziel.h / 2);
    await warte(600);
    const t = await s.ev(seiteRiegelAbbild);
    const danach = t ? JSON.parse(t) : null;
    if (!danach || danach.zustand !== 'frage' || danach.frage.id !== a.frage.id) return;
  }
  throw new Error('Riegel nicht zu loesen');
}

async function teilF(b, s, n) {
  const ergebnis = {};
  for (const soll of [3000, 10000]) {
    await b.setzeEinstellungen({ pause: false, quiz: { verweigern: 0, freilegenMs: soll } });
    await warte(400);
    const laeufe = [];
    for (let i = 0; i < n; i++) {
      await s.oeffne();
      try {
        await s.gehe(FREILEGEN);
        await bis('Status', async () => (await s.ev(seiteAttr, 'data-veil-status')) !== null, 20_000, 100);
        if (b.art === 'chromium') await s.ev(seiteSchnell);
        await bis('zensiert', async () => (await s.ev(seiteVeil, 'a')) === 'zensiert' && (await s.ev(seiteVeil, 'hg')) === 'zensiert', 90_000, 150);
        await s.ev(seiteStarteFreilegen);
        let knopf = null;
        await bis('Knopf', async () => {
          const t = await s.ev(seiteAttr, 'data-veil-freilegen');
          knopf = t ? (JSON.parse(t).knoepfe ?? []).find((k) => k.id === 'a') : null;
          return !!knopf;
        }, 15_000, 100);
        await s.klick(knopf.x + knopf.w / 2, knopf.y + knopf.h / 2);
        await loeseRiegel(b, s);
        await bis('frei', async () => (await s.ev(seiteVeil, 'a')) === 'frei', 12_000, 20);
        await bis('wieder zensiert', async () => (await s.ev(seiteVeil, 'a')) === 'zensiert', soll + 8000, 50);
        await warte(400);
        const F = await s.ev(seiteLeseFreilegen);
        const log = F.log;
        const tFrei = log.find((x) => x.v === 'frei')?.t;
        const tWeg = log.find((x) => x.t > tFrei && x.v !== 'frei')?.t;
        const tZens = log.find((x) => x.t > tWeg && x.v === 'zensiert')?.t;
        const tSrcZurueck = log.find((x) => x.t > tFrei && x.orig === false)?.t;
        const fr = F.frames.filter((t) => t >= tFrei - 50 && t <= tWeg + 2000);
        const l = {
          dauerMs: rund(tWeg - tFrei),
          abweichungMs: rund(tWeg - tFrei - soll),
          bisZensiertMs: rund(tZens - tWeg),
          bisQuelleZurueckMs: tSrcZurueck !== undefined ? rund(tSrcZurueck - tWeg) : null,
          frameDauerMs: fr.length ? rund(fr[fr.length - 1] - fr[0]) : null,
          frameAbweichungMs: fr.length ? rund(fr[fr.length - 1] - fr[0] - soll) : null,
          letzterOriginalFrameNachEndeMs: fr.length ? rund(fr[fr.length - 1] - tWeg) : null,
        };
        laeufe.push(l);
        console.log(`${b.art} F ${soll} #${i + 1}: sichtbar ${l.dauerMs} ms (Abweichung ${l.abweichungMs}), Frames ${l.frameDauerMs} ms, Ende bis zensiert ${l.bisZensiertMs} ms, Quelle zurueck ${l.bisQuelleZurueckMs} ms, letzter Original-Frame ${l.letzterOriginalFrameNachEndeMs} ms nach Ende`);
      } finally {
        await s.zu();
      }
      await warte(300);
    }
    ergebnis[soll] = {
      laeufe,
      dauer: fasse(laeufe.map((l) => l.dauerMs), 1),
      abweichung: fasse(laeufe.map((l) => l.abweichungMs), 1),
      frameAbweichung: fasse(laeufe.map((l) => l.frameAbweichungMs), 1),
      bisZensiert: fasse(laeufe.map((l) => l.bisZensiertMs), 1),
      bisQuelleZurueck: fasse(laeufe.map((l) => l.bisQuelleZurueckMs), 1),
      letzterOriginalFrameNachEnde: fasse(laeufe.map((l) => l.letzterOriginalFrameNachEndeMs), 1),
    };
  }
  return ergebnis;
}

async function teilT(b, s, n) {
  await b.setzeEinstellungen({ pause: false });
  await warte(300);
  const laeufe = [];
  for (let i = 0; i < n + 1; i++) {
    await s.oeffne();
    try {
      await s.gehe(TITEL);
      await bis('Sonde fertig', async () => (await s.ev(seiteLeseTitel))?.fertig === true, 20_000, 100);
      const m = await s.ev(seiteLeseTitel);
      const l = {
        warmlauf: i === 0,
        karteErsetztMs: rund(m.tKarteErsetzt),
        tabErsetztMs: rund(m.tTabErsetzt),
        seiteErsetztMs: rund(m.tSeiteErsetzt),
        loadMs: rund(m.tLoad),
        karteNachLoadMs: m.tKarteErsetzt !== null && m.tLoad !== null ? rund(m.tKarteErsetzt - m.tLoad) : null,
        tabNachLoadMs: m.tTabErsetzt !== null && m.tLoad !== null ? rund(m.tTabErsetzt - m.tLoad) : null,
        originalKarteImDomMs: m.tKarteErsetzt !== null && m.tKarteErst !== null ? rund(m.tKarteErsetzt - m.tKarteErst) : null,
        originalTabMs: m.tTabErsetzt !== null && m.tTabErst !== null ? rund(m.tTabErsetzt - m.tTabErst) : null,
        originalSeiteImDomMs: m.tSeiteErsetzt !== null && m.tSeiteErst !== null ? rund(m.tSeiteErsetzt - m.tSeiteErst) : null,
        originalKarteFrames: m.origKarteFrames,
        originalTabFrames: m.origTabFrames,
        originalSeiteFrames: m.origSeiteFrames,
        frames: m.frames,
      };
      laeufe.push(l);
      console.log(`${b.art} T #${i}${l.warmlauf ? ' (Warmlauf)' : ''}: Karte ersetzt ${l.karteErsetztMs} ms, Tab ${l.tabErsetztMs} ms, Seitentitel ${l.seiteErsetztMs} ms (load ${l.loadMs} ms); Original im DOM Karte ${l.originalKarteImDomMs} ms, Tab ${l.originalTabMs} ms; Frames mit Original: Karte ${l.originalKarteFrames}, Tab ${l.originalTabFrames}, Seite ${l.originalSeiteFrames}`);
    } finally {
      await s.zu();
    }
    await warte(300);
  }
  const echte = laeufe.filter((l) => !l.warmlauf);
  const f = (k, st = 1) => fasse(echte.map((l) => l[k]), st);
  return {
    laeufe: echte,
    warmlauf: laeufe[0],
    karteErsetzt: f('karteErsetztMs'),
    tabErsetzt: f('tabErsetztMs'),
    seiteErsetzt: f('seiteErsetztMs'),
    load: f('loadMs'),
    karteNachLoad: f('karteNachLoadMs'),
    tabNachLoad: f('tabNachLoadMs'),
    originalKarteImDom: f('originalKarteImDomMs'),
    originalTab: f('originalTabMs'),
    originalSeiteImDom: f('originalSeiteImDomMs'),
    originalKarteFramesSumme: echte.reduce((a, l) => a + l.originalKarteFrames, 0),
    originalTabFramesSumme: echte.reduce((a, l) => a + l.originalTabFrames, 0),
    originalSeiteFramesSumme: echte.reduce((a, l) => a + l.originalSeiteFrames, 0),
  };
}

// ---------- Ablauf ----------
const serverFix = await starteFixtureServer(port);
const vor = await starteVorschalt(port, portVor);
const ordner = await mkdtemp(path.join(tmpdir(), 'veil-session8-'));
const ergebnis = { werkzeug: 'scripts/messung/session8.mjs', datum: new Date().toISOString(), teile, browser: {} };
const DAUER = { D1: 20, D2: 10, D3: 8, D4: 5, E1: 8, E2: 5, F: 5, T: 10 };
try {
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack({ quiz: { version: 1, fragen: FRAGEN } })).bytes);
  const arten = browserWahl === 'beide' ? ['chromium', 'firefox'] : [browserWahl];
  for (const art of arten) {
    const b =
      art === 'chromium'
        ? await starteChromiumMitPack({ hostRegeln: ['MAP *.veil-erwachsen.test 127.0.0.1'], extraArgs: ['--autoplay-policy=no-user-gesture-required'] })
        : await starteFirefoxMitPack({
            hosts: HOSTS,
            praefs: { 'media.autoplay.default': 0, 'media.autoplay.blocking_policy': 0 },
          });
    console.log(`${art} ${b.version}`);
    const res = { version: b.version, teile: {} };
    try {
      if (art === 'chromium') await b.warteAufErkenner();
      if (art === 'firefox') await b.oeffneDauerhaft();
      const s = seite(b);
      let packDa = false;
      for (const t of teile) {
        if (t !== 'D1' && !packDa) {
          await b.importierePack(packPfad);
          if (art === 'chromium') await b.warteAufErkenner();
          packDa = true;
        }
        const n = arg.laeufe ? laeufeStandard : DAUER[t];
        const ruhe = await warteAufRuhe(`${art} ${t}`);
        const fn = { D1: teilD1, D2: teilD2, D3: teilD3, D4: teilD4, E1: teilE1, E2: teilE2, F: teilF, T: teilT }[t];
        try {
          const r = await fn(b, s, n);
          res.teile[t] = { ...r, last: { ...ruhe, nach: rund(last(), 2) } };
        } catch (e) {
          console.log(`${art} ${t}: FEHLER ${e.message}`);
          res.teile[t] = { fehler: String(e.message), last: { ...ruhe, nach: rund(last(), 2) } };
        }
      }
    } finally {
      await b.schliesse();
    }
    ergebnis.browser[art] = res;
  }
} finally {
  vor.close();
  serverFix.close?.();
  await rm(ordner, { recursive: true, force: true });
}
const datei = path.join(wurzel, 'scripts/messung', `ergebnis-session8-${teile.join('')}-${zeitstempel()}.json`);
writeFileSync(datei, JSON.stringify(ergebnis, null, 1));
console.log(`geschrieben: ${path.relative(wurzel, datei)}`);
process.exit(0);
