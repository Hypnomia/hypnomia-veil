// Firefox: Live-Vorschau mit Beispielbildern (Phase 11 E5). Zuerst wird gemessen, ob Firefox fuer die vier Beispielbilder dieselben Treffer liefert wie die abgelegten
// (data/beispiel-treffer.json, gemessen in Chromium). Dann V2 im selben Umfang wie moeglich: die Vorschau gleich dem Bild, das `pruefe` mit `rendern: true`
// liefert, byteweise (keine Toleranz). Zuletzt V11 kurz: vier Punkte, Pfeiltasten, Kachel und Dialog. Hilfsfunktionen wie reiter.test.mjs, stumm gestartet.
// Fehlen die Beispielbilder im Testbau, wird der Test laut uebersprungen. Der Aufruf `VEIL_AUSGABE=.output-test node tests/firefox/vorschau.test.mjs`.
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BEISPIELE, trefferFuer } from '../../src/beispiel.ts';
import { vervollstaendige } from '../../src/einstellungen.ts';
import { hashe } from '../../src/pack/hash.ts';
import { presetDef } from '../../src/preset-def.ts';
import { PRESET_IDS } from '../../src/presets.ts';
import { VORSCHAU_ALT_OFFEN, VORSCHAU_NICHTS, VORSCHAU_PUNKT_NAMEN } from '../../src/oberflaeche/gemeinsam.ts';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 900 s ueberschritten');
  process.exit(1);
}, 900_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const GECKO_ID = 'veil@hypnomia';
const BILDER = BEISPIELE.map((b) => b.kennung);
const BILD_ORDNER = path.join(ausgabe, 'firefox-mv3', 'beispiel');

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:firefox)`);
  process.exit(1);
}
if (!BILDER.every((k) => existsSync(path.join(BILD_ORDNER, `${k}.webp`)))) {
  console.log('firefox: AUSNAHME: die Beispielbilder fehlen im Testbau (beispiel/), vorschau.test uebersprungen');
  process.exit(0);
}

async function installiere(treiber, paketPfad) {
  await treiber.execute(new Command('install addon').setParameter('path', paketPfad).setParameter('temporary', true));
}
const warte = (ms) => new Promise((r) => setTimeout(r, ms));
let ok = 0;
let rot = 0;
function pruefe(bedingung, text) {
  if (bedingung) ok++;
  else {
    rot++;
    console.error(`firefox: ROT  ${text}`);
  }
}

let driver;
const uuid = randomUUID();

async function oeffne(seite) {
  const vorher = await driver.getAllWindowHandles();
  await driver.setContext(firefox.Context.CHROME);
  try {
    await driver.executeScript(
      `const w = Services.wm.getMostRecentWindow('navigator:browser');
       w.gBrowser.selectedTab = w.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
      `moz-extension://${uuid}/${seite}`,
    );
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
  let neu;
  for (let i = 0; i < 100 && !neu; i++) {
    neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
    if (!neu) await warte(50);
  }
  if (!neu) throw new Error(`Erweiterungsseite ${seite} nicht geoeffnet`);
  await driver.switchTo().window(neu);
  return neu;
}

async function imSeitenkontext(code, ...args) {
  const text = await driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
     const args = JSON.parse(arguments[0]);
     const abschluss = (w) => fertig(JSON.stringify(w === undefined ? null : w));
     Promise.resolve((async () => { ${code} })()).then(abschluss, (e) => abschluss({ fehlerText: String(e) }));`,
    JSON.stringify(args),
  );
  return JSON.parse(text);
}
async function bis(beschreibung, fn, frist = 15_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(50);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}

const BEDECKBAR = ['breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const ALLE = ['eyes', 'mouth', 'face', 'head', ...BEDECKBAR];
const zonenNur = (an) => Object.fromEntries(ALLE.map((n) => [n, BEDECKBAR.includes(n) ? { an: an.includes(n), bedeckt: true } : { an: an.includes(n) }]));
const ZONEN_ALLE = zonenNur(ALLE);

const dataUrl = (k) => `data:image/webp;base64,${readFileSync(path.join(BILD_ORDNER, `${k}.webp`)).toString('base64')}`;
const kennungVon = (k) => {
  const d = dataUrl(k);
  return `daten:${d.length}:${hashe(d)}`;
};

// Die Pruefung des Erkenners wie der Schleier sie schickt (ohne Pack).
function echteNachricht(k, einstRoh) {
  const e = vervollstaendige(einstRoh);
  const gilt = presetDef(e, null).gilt;
  const b = BEISPIELE.find((x) => x.kennung === k);
  return {
    ziel: 'erkenner',
    typ: 'pruefe',
    id: `vorschau-${k}-${Math.random().toString(36).slice(2, 7)}`,
    quelle: { art: 'daten', dataUrl: dataUrl(k) },
    breite: b.breite,
    hoehe: b.hoehe,
    einstellungen: {
      schwelle: e.schwelle,
      zonen: e.zonen,
      rand: e.rand,
      preset: gilt.id,
      ...(e.augenbalken ? { augenbalken: true } : {}),
      ...(gilt.braucht !== null || gilt.woerter ? { packStand: 0 } : {}),
    },
    rendern: true,
    verschmelzen: true,
  };
}
const echt = (k, einstRoh) => imSeitenkontext(`return await api.runtime.sendMessage(args[0]);`, echteNachricht(k, einstRoh));
const setze = (o) => imSeitenkontext(`await api.storage.local.set(args[0]);`, o);
const haken = () =>
  driver.executeScript(`const t = document.querySelector('[data-veil-vorschau]')?.getAttribute('data-veil-vorschau'); return t ? JSON.parse(t) : null;`);
const kachelSrc = () => driver.executeScript(`return document.querySelector('.vorschau-spalte .v-vorschau-kachel img')?.getAttribute('src') ?? ''`);
const punktKlick = async (k) => (await driver.findElement(By.css(`.vorschau-spalte .v-vorschau-punkte [data-bild="${k}"]`))).click();

let mitBild = 0;
let ohneFlaeche = 0;
// Vergleicht die Vorschau mit `pruefe` je Bild fuer diese gespeicherten Einstellungen; liefert die Abweichungen.
async function vergleiche(etikett, einstRoh) {
  const abw = [];
  await setze({ einstellungen: { version: 1, ...einstRoh } });
  for (const k of BILDER) {
    const kennung = kennungVon(k);
    await driver.executeScript(`document.documentElement.setAttribute('data-veil-vorschau-kennung', arguments[0])`, kennung);
    await punktKlick(k);
    const a = await echt(k, { version: 1, ...einstRoh });
    if (!a?.ok) {
      abw.push(`${etikett} ${k}: pruefe ohne Antwort ${JSON.stringify(a).slice(0, 120)}`);
      continue;
    }
    let letztes = '';
    let gleich = false;
    const frist = Date.now() + 9000;
    while (Date.now() < frist) {
      const h = await haken();
      if (h && h.gezeigt === h.angefordert && h.gezeigt.startsWith(`["${k}"`) && h.gezeigt.endsWith(`${JSON.stringify(kennung)}]`)) {
        letztes = await kachelSrc();
        // Ohne Flaeche liefert `pruefe` kein Bild, die Vorschau zeigt das offene Bild (als `offen` gemeldet, N1).
        if (a.bild === undefined ? letztes.startsWith('data:image/') && h.offen === true : letztes === a.bild) {
          gleich = true;
          break;
        }
      }
      await warte(150);
    }
    if (gleich) a.bild === undefined ? ohneFlaeche++ : mitBild++;
    else abw.push(`${etikett} ${k}: ${a.bild === undefined ? 'pruefe ohne Bild, Vorschau mit Bild' : letztes === '' ? 'Vorschau ohne Bild' : `Bilder verschieden (Laengen ${letztes.length} gegen ${a.bild.length})`}`);
  }
  return abw;
}

let code = 0;
try {
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}`);

  await oeffne('options.html');
  await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen']);`);
  await setze({ einstieg: { version: 1, warnung: true, alter: true, einwilligung: true, interview: 'uebersprungen', zeit: 1 } });
  await driver.navigate().refresh();
  await bis('Seite gezeichnet', async () => driver.executeScript(`return document.body.getAttribute('data-veil-ordnung') === 'bereit'`).catch(() => false));

  // ---- Messung: liefert Firefox dieselben Treffer wie abgelegt? ----
  await bis('Erkenner antwortet', async () => (await echt('vorn', { version: 1, zonen: ZONEN_ALLE }))?.ok === true, 60_000);
  let gleichT = 0;
  let andersT = 0;
  const diffs = [];
  for (const k of BILDER) {
    for (const [mit, einst] of [
      [true, { version: 1, preset: 'mosaik', zonen: ZONEN_ALLE }],
      [false, { version: 1, preset: 'mosaik' }],
    ]) {
      const a = await echt(k, einst);
      const soll = trefferFuer(k, mit).filter((t) => t.score >= 0.1);
      const ist = a.treffer ?? [];
      if (JSON.stringify(ist) === JSON.stringify(soll)) gleichT++;
      else {
        andersT++;
        let boxMax = '-';
        let scoreMax = '-';
        if (soll.length === ist.length) {
          boxMax = Math.max(0, ...soll.flatMap((t, i) => t.box.map((v, j) => Math.abs(v - ist[i].box[j])))).toFixed(1);
          scoreMax = Math.max(0, ...soll.map((t, i) => Math.abs(t.score - ist[i].score))).toFixed(3);
        }
        diffs.push(`${k} ${mit ? 'mit' : 'ohne'} Gesichtssuche: abgelegt ${soll.length} Treffer, Firefox ${ist.length}${soll.length === ist.length ? ` (gleiche Zahl: groesste Boxabweichung ${boxMax} px, groesste Scoreabweichung ${scoreMax})` : ''}`);
      }
    }
  }
  console.log(`firefox: Treffer gegen abgelegte (Schwelle 0,1): ${gleichT} von ${gleichT + andersT} Saetzen bitgleich${diffs.length ? `\n${diffs.join('\n')}` : ''}`);

  // ---- V2 ----
  // Weichen die Treffer von Firefox von den abgelegten ab, kann die Vorschau (sie rechnet mit den abgelegten) nicht gleich dem Bild von `pruefe` sein: der Vergleich
  // sagte dann nur etwas ueber die Treffer. Er laeuft darum nur mit VEIL_VORSCHAU_V2_FIREFOX=1 (oder wenn alle Saetze bitgleich sind).
  const abw = [];
  if (andersT === 0 || process.env.VEIL_VORSCHAU_V2_FIREFOX === '1') {
  let n = 0;
  for (const preset of PRESET_IDS) {
    for (const augenbalken of [false, true]) {
      abw.push(...(await vergleiche(`${preset} Eye bar ${augenbalken ? 'an' : 'aus'} Standard-Zonen`, { preset, augenbalken })));
      n += BILDER.length;
    }
    abw.push(...(await vergleiche(`${preset} alle Zonen`, { preset, zonen: ZONEN_ALLE })));
    n += BILDER.length;
  }
  console.log(`firefox: V2 ${n} Vergleiche (mit Bild ${mitBild}, ohne Flaeche ${ohneFlaeche}), ${abw.length} Abweichungen${abw.length ? `\n${abw.slice(0, 40).join('\n')}` : ''}`);
  pruefe(abw.length === 0, `V2: ${abw.length} Abweichungen von ${n}`);
  } else console.log('firefox: V2 nicht gefahren: die Treffer von Firefox weichen von den abgelegten ab (Zahlen oben), die Vorschau rechnet mit den abgelegten');

  // ---- N1 bis N4 kurz: offenes Bild mit Hinweis genau bei null Flaechen ----
  await setze({ einstellungen: { version: 1, preset: 'mosaik' } });
  await driver.executeScript(`document.documentElement.removeAttribute('data-veil-vorschau-kennung')`);
  const offene = [];
  for (const k of BILDER) {
    await punktKlick(k);
    await bis(`Bild ${k}`, async () => { const h = await haken(); return !!h && h.bild === k && h.gezeigt === h.angefordert; });
    const st = await driver.executeScript(`const h = JSON.parse(document.querySelector('[data-veil-vorschau]').getAttribute('data-veil-vorschau')); const n = document.querySelector('.vorschau-spalte > .v-vorschau-platz > .v-vorschau-offen'); return { offen: h.offen, da: document.querySelectorAll('.vorschau-spalte > .v-vorschau-platz > .v-vorschau-offen').length, sichtbar: !!n && !n.hidden && n.getClientRects().length > 0, text: n && n.textContent, alt: document.querySelector('.vorschau-spalte .v-vorschau-kachel img').getAttribute('alt'), src: document.querySelector('.vorschau-spalte .v-vorschau-kachel img').getAttribute('src').slice(0, 11) };`);
    pruefe(st.da === 1 && st.sichtbar === st.offen && st.src === 'data:image/', `N: ${k} Hinweis sichtbar gleich offen, data-Bild ${JSON.stringify(st)}`);
    pruefe(st.offen ? st.alt === VORSCHAU_ALT_OFFEN && st.text === VORSCHAU_NICHTS : st.alt !== VORSCHAU_ALT_OFFEN, `N: ${k} Alt und Text ${JSON.stringify(st)}`);
    if (st.offen) offene.push(k);
  }
  console.log(`firefox: N1 bis N4: offen auf ${offene.join(', ') || 'keinem Bild'}`);
  pruefe(offene.length > 0, 'N: bei Standard-Einstellungen mindestens ein Bild ohne Flaeche');

  // ---- V11 kurz ----
  await setze({ einstellungen: { version: 1, preset: 'mosaik', zonen: ZONEN_ALLE } });
  await driver.executeScript(`document.documentElement.removeAttribute('data-veil-vorschau-kennung')`);
  await bis('Vorschau gezeichnet', async () => { const h = await haken(); return !!h && h.anzahl >= 1 && h.gezeigt === h.angefordert; });
  const punkte = await driver.executeScript(
    `return [...document.querySelectorAll('.vorschau-spalte .v-vorschau-punkte button')].map((b) => { const r = b.getBoundingClientRect(); return { name: b.getAttribute('aria-label'), b: r.width, h: r.height, aktuell: b.getAttribute('aria-current') }; })`,
  );
  pruefe(punkte.length === 4 && JSON.stringify(punkte.map((p) => p.name)) === JSON.stringify(VORSCHAU_PUNKT_NAMEN), `vier Punkte mit Namen ${JSON.stringify(punkte.map((p) => p.name))}`);
  pruefe(punkte.every((p) => p.b >= 43.5 && p.h >= 43.5), `Trefferflaeche der Punkte mindestens 44 px ${JSON.stringify(punkte.map((p) => [p.b, p.h]))}`);
  pruefe(punkte.filter((p) => p.aktuell === 'true').length === 1, 'genau ein Punkt mit aria-current');
  const erster = await driver.findElement(By.css('.vorschau-spalte .v-vorschau-punkte [data-bild="vorn"]'));
  await erster.click();
  await erster.sendKeys(Key.ARROW_RIGHT);
  await bis('Pfeil rechts blaettert', async () => (await haken())?.bild === 'rueck');
  pruefe(await driver.executeScript(`return document.activeElement?.getAttribute('data-bild') === 'rueck'`), 'der Fokus wandert mit dem Pfeil');
  const kachel = await driver.findElement(By.css('.vorschau-spalte .v-vorschau-kachel'));
  await kachel.click();
  pruefe(await driver.executeScript(`return document.querySelector('.vorschau-spalte dialog').open`), 'Kachel oeffnet den Dialog');
  pruefe((await driver.executeScript(`return document.querySelector('.vorschau-spalte dialog img.v-vorschau-gross').getAttribute('src')`)) === (await kachelSrc()), 'der Dialog zeigt dasselbe Bild');
  await driver.actions().sendKeys(Key.ESCAPE).perform();
  await bis('Escape schliesst', async () => !(await driver.executeScript(`return document.querySelector('.vorschau-spalte dialog').open`)));
  pruefe(await driver.executeScript(`return document.activeElement?.classList.contains('v-vorschau-kachel')`), 'der Fokus kehrt zur Kachel zurueck');
  await kachel.click();
  await (await driver.findElement(By.css('.vorschau-spalte dialog .v-vorschau-zu'))).click();
  pruefe(!(await driver.executeScript(`return document.querySelector('.vorschau-spalte dialog').open`)), 'Close schliesst');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await imSeitenkontext(`await api.storage.local.remove(['pack', 'einstellungen', 'einstieg']);`).catch(() => {});
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
}
console.log(`firefox: vorschau.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
