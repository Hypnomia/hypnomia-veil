// Firefox-Test Phase 7, Auftrag I3 (Kern-Bilder). Zwei Baue wie in tests/chromium/kern.spec.ts: der Standard-Testbau (mit Kern-Bildern, wenn
// `../02 Assets Mia/kern/` beim Bau da war) und ein Bau ohne (VEIL_AUSGABE_OHNE_KERN, Standard .output-test-ohnekern).
// Mit: Einwilligungsseite zeigt ein Bild (alt "Mia"), Warn- und 18+-Seite nicht, Einstellungsseite ohne Pack einen Streifen mit 3 Bildern und Text,
// mit Pack keinen. Ohne: nirgends ein Rahmen oder ein Streifen. Die Seitenhoehe misst ein Iframe mit 360 x 640 (Firefox-Fenster werden nicht so schmal).
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 200 s ueberschritten');
  process.exit(1);
}, 200_000).unref();
process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const GECKO_ID = 'veil@hypnomia';
const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const zipIn = (ordner) => path.join(wurzel, ordner, `${paketJson.name}-${paketJson.version}-firefox.zip`);
const mitKern = zipIn(process.env.VEIL_AUSGABE ?? '.output');
const ohneKern = zipIn(process.env.VEIL_AUSGABE_OHNE_KERN ?? '.output-test-ohnekern');

const PFLICHT = process.env.VEIL_KERN_PFLICHT === '1'; // Gesamtlauf: ein fehlender Bau ist rot statt uebersprungen
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
async function bis(beschreibung, fn, frist = 20_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(100);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)?.slice(0, 400)})`);
}

const EINSTIEG = (o) => ({ version: 1, warnung: true, alter: true, einwilligung: false, interview: 'offen', zeit: null, ...o });

async function mitTreiber(paketPfad, fn) {
  const uuid = randomUUID();
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  try {
    await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
    await driver.execute(new Command('install addon').setParameter('path', paketPfad).setParameter('temporary', true));
    await warte(1000);
    const haupt = (await driver.getAllWindowHandles())[0];
    const oeffne = async (seite) => {
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
      if (!neu) throw new Error(`Seite ${seite} nicht geoeffnet`);
      await driver.switchTo().window(neu);
      await bis('Seite geladen', async () => {
        try {
          return await driver.executeScript(`return document.readyState === 'complete' && !!(window.browser || window.chrome) && location.protocol === 'moz-extension:'`);
        } catch {
          return false;
        }
      });
    };
    const setze = async (o) => {
      const text = await driver.executeAsyncScript(
        `const fertig = arguments[arguments.length - 1];
         const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
         api.storage.local.set(JSON.parse(arguments[0])).then(() => fertig('ok'), (e) => fertig('FEHLER ' + e));`,
        JSON.stringify(o),
      );
      if (text !== 'ok') throw new Error(text);
    };
    await fn({ driver, oeffne, setze, haupt });
  } finally {
    await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  }
}

// Seite in einem Iframe 360 x 640 messen, `skript` laeuft mit `d` (Dokument des Iframes) und `fertig`.
const imRahmen = (driver, skript) =>
  driver.executeAsyncScript(
    `const fertig = arguments[arguments.length - 1];
     const f = document.createElement('iframe');
     f.style.cssText = 'width:360px;height:640px;position:fixed;left:0;top:0;border:0';
     f.src = location.href;
     f.onload = () => setTimeout(() => { const d = f.contentDocument; ${skript} }, 1500);
     document.body.append(f);`,
  );
const sichtbar = (driver, css) => driver.executeScript(`const e = document.querySelector(arguments[0]); return !!e && !e.hidden && e.getClientRects().length > 0;`, css);

async function pruefeBau(name, paketPfad, erwarteBilder) {
  await mitTreiber(paketPfad, async ({ driver, oeffne, setze, haupt }) => {
    await oeffne('willkommen.html');
    // Warnung: ohne Bild
    await setze({ einstieg: EINSTIEG({ warnung: false, alter: false }) });
    await driver.navigate().refresh();
    await bis('Warnung', () => sichtbar(driver, '#warnung-ok'));
    pruefe((await driver.findElements(By.css('.mia-bild, #kern-bild'))).length === 0, `${name}: Warnseite ohne Bildplatz`);
    // 18+: ohne Bild
    await setze({ einstieg: EINSTIEG({ alter: false }) });
    await driver.navigate().refresh();
    await bis('Alter', async () => (await driver.executeScript(`return document.getElementById('schritt').dataset.schritt`)) === 'alter');
    pruefe((await driver.findElements(By.css('.mia-bild, #kern-bild'))).length === 0, `${name}: 18+-Seite ohne Bildplatz`);
    // Einwilligung
    await setze({ einstieg: EINSTIEG({}) });
    await driver.navigate().refresh();
    await bis('Einwilligung', () => sichtbar(driver, '#einwilligung-ok'));
    if (erwarteBilder) {
      await bis('Bild da', () => sichtbar(driver, '#kern-bild img'), 15_000);
      const m = await imRahmen(
        driver,
        `const i = d.querySelector('#kern-bild img'); const r = i.getBoundingClientRect();
         fertig({ h: r.height, b: r.width, nat: i.naturalWidth, alt: i.alt, src: i.src, fenster: f.contentWindow.innerHeight, scrollB: d.documentElement.scrollWidth, innen: d.documentElement.clientWidth,
                  y: r.top, textY: d.getElementById('einwilligung-laeuft').getBoundingClientRect().top });`,
      );
      console.log(`firefox I3: ${name}: Willkommen Bild ${Math.round(m.b)} x ${Math.round(m.h)} bei Fenster 360 x ${m.fenster}, natuerlich ${m.nat} px`);
      pruefe(m.nat > 0 && m.alt === 'Mia', `${name}: Bild geladen, alt "Mia"`);
      pruefe(m.h <= m.fenster * 0.4 + 1, `${name}: Bild hoechstens 40 Prozent der Hoehe`);
      pruefe(m.scrollB <= m.innen && m.y < m.textY, `${name}: bei 360 px ueber dem Text, ohne Ueberlauf`);
      pruefe(/^moz-extension:\/\/[^/]+\/kern\/kern-\d\d\.webp$/.test(m.src), `${name}: Bild aus der eigenen Erweiterung (${m.src.replace(/\/\/[^/]+\//, '//<uuid>/')})`);
    } else {
      await warte(800);
      pruefe((await driver.findElements(By.css('#kern-bild img'))).length === 0 && !(await sichtbar(driver, '#kern-bild')), `${name}: kein Bild und kein Rahmen`);
    }
    await driver.close();
    await driver.switchTo().window(haupt);
    // Einstellungsseite ohne Pack
    await oeffne('options.html');
    await setze({ einstieg: EINSTIEG({ einwilligung: true }) });
    await driver.navigate().refresh();
    await bis('Optionen', async () => (await driver.findElement(By.css('#pack-status')).getText()).length > 0);
    if (erwarteBilder) {
      await bis('Streifen sichtbar', () => sichtbar(driver, '#kern-streifen'), 15_000);
      await bis('drei Bilder', async () => (await driver.findElements(By.css('#kern-bilder img'))).length === 3);
      const m = await driver.executeScript(
        `return { geladen: [...document.querySelectorAll('#kern-bilder img')].every((i) => i.naturalWidth > 0), namen: new Set([...document.querySelectorAll('#kern-bilder img')].map((i) => i.src)).size,
                  text: document.getElementById('kern-text').textContent, scrollB: document.documentElement.scrollWidth, innen: document.documentElement.clientWidth };`,
      );
      pruefe(m.geladen && m.namen === 3, `${name}: Streifen mit 3 verschiedenen, geladenen Bildern`);
      pruefe(m.text === 'This is me dressed for the office. The Mia Pack is me off duty.', `${name}: Text unter dem Streifen`);
      // mit Pack kein Streifen
      const ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-kern-'));
      try {
        const pfad = path.join(ordner, 'dummy.miapack');
        await writeFile(pfad, (await baueDummyPack()).bytes);
        await driver.findElement(By.css('#datei')).sendKeys(pfad);
        await bis('Lizenz', () => sichtbar(driver, '#lizenz-block'));
        await driver.findElement(By.css('#annehmen')).click();
        await bis('Pack drin', async () => (await driver.findElement(By.css('#meldung')).getText()).includes('The pack is in'), 30_000);
        await bis('Streifen weg', async () => !(await sichtbar(driver, '#kern-streifen')));
        pruefe(true, `${name}: mit Pack kein Streifen`);
        await driver.executeScript(`document.querySelector('#entfernen').click()`);
        await bis('Rueckfrage', () => sichtbar(driver, '#entfernen-frage'));
        await driver.executeScript(`document.querySelector('#entfernen-ja').click()`);
        await bis('Streifen zurueck', () => sichtbar(driver, '#kern-streifen'), 15_000);
        pruefe(true, `${name}: ohne Pack wieder der Streifen`);
      } finally {
        await rm(ordner, { recursive: true, force: true });
      }
    } else {
      await warte(800);
      pruefe(!(await sichtbar(driver, '#kern-streifen')) && !(await sichtbar(driver, '#kern-text')) && (await driver.findElements(By.css('#kern-bilder img'))).length === 0, `${name}: kein Streifen, kein Text ohne Bild`);
    }
  });
}

let code = 0;
try {
  if (!existsSync(mitKern)) {
    console.error(`firefox: Paket fehlt: ${path.relative(wurzel, mitKern)}`);
    process.exit(1);
  }
  // Hat der Standardbau Kern-Bilder? Das Zip nennt sie (Namen kern/kern-NN.webp).
  const hatKern = await (async () => {
    const { execFileSync } = await import('node:child_process');
    return execFileSync('unzip', ['-l', mitKern], { encoding: 'utf8' }).includes(' kern/kern-');
  })();
  if (hatKern) await pruefeBau('mit Kern-Bildern', mitKern, true);
  else {
    console.log('firefox I3: UEBERSPRUNGEN Fall "mit": der Standardbau hat keine Kern-Bilder (Bau mit VEIL_KERN auf einen Ordner mit kern-NN.webp)');
    pruefe(!PFLICHT, 'Standardbau mit Kern-Bildern im Gesamtlauf');
  }
  if (existsSync(ohneKern)) await pruefeBau('ohne Kern-Bilder', ohneKern, false);
  else {
    console.log(`firefox I3: UEBERSPRUNGEN Fall "ohne": ${path.relative(wurzel, ohneKern)} fehlt`);
    pruefe(!PFLICHT, 'Bau ohne Kern-Bilder im Gesamtlauf');
  }
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
}
console.log(`firefox: kern.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
