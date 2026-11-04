// Messwerkzeug Phase 4 (kein Produktcode): Browser-Start mit Pack-Import fuer vorschau.mjs und quiz-blitz.mjs.
// Chromium: Playwright mit geladener Erweiterung, Pack ueber die Einstellungsseite (wie tests/chromium/erwachsen.spec.ts).
// Firefox: geckodriver, temporaere Installation des Zips, Einstellungsseite im Chrome-Kontext geoeffnet (wie tests/firefox/erwachsen.test.mjs).
// Beide brauchen den Testbau mit Testhaken (VEIL_AUSGABE, Standard .output-test).
import { chromium } from '@playwright/test';
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync } from 'node:fs';
import { chromeErweiterung, firefoxBin, firefoxZip, GECKO_ID, tempProfil, warte } from './hilfe.mjs';

process.env.SE_AVOID_STATS = 'true';

async function bis(beschreibung, fn, frist = 30_000, schritt = 100) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return letzter;
    await warte(schritt);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)?.slice(0, 300)})`);
}

export async function starteChromiumMitPack({ hostRegeln = [] } = {}) {
  if (!existsSync(chromeErweiterung)) throw new Error(`Build fehlt: ${chromeErweiterung}`);
  const profil = await tempProfil('veil-messung-p4-');
  const args = [`--disable-extensions-except=${chromeErweiterung}`, `--load-extension=${chromeErweiterung}`];
  if (hostRegeln.length) args.push(`--host-resolver-rules=${hostRegeln.join(',')}`);
  const context = await chromium.launchPersistentContext(profil.ordner, { channel: 'chromium', headless: true, args });
  let worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const erweiterungsId = new URL(worker.url()).host;
  const optionsUrl = `chrome-extension://${erweiterungsId}/options.html`;
  const seite0 = context.pages()[0] ?? (await context.newPage());
  const cdp = await context.newCDPSession(seite0);
  const version = String((await cdp.send('Browser.getVersion')).product).replace(/^.*Chrome\//, '');
  await cdp.detach().catch(() => {});

  const imWorker = async (fn, arg) => {
    for (let v = 0; v < 4; v++) {
      try {
        return await worker.evaluate(fn, arg);
      } catch (e) {
        if (v === 3) throw e;
        worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
      }
    }
  };
  const api = {
    art: 'chromium',
    version,
    context,
    optionsUrl,
    async setzeEinstellungen(neu) {
      await imWorker(async (n) => {
        const c = globalThis.chrome;
        const alt = (await c.storage.local.get('einstellungen')).einstellungen ?? {};
        await c.storage.local.set({ einstellungen: { ...alt, ...n } });
      }, neu);
    },
    loescheEinstellungen: () => imWorker(() => globalThis.chrome.storage.local.remove('einstellungen')),
    sendeAnErkenner: (n) => imWorker((m) => globalThis.chrome.runtime.sendMessage(m), n),
    async importierePack(pfad) {
      const s = await context.newPage();
      try {
        await s.goto(optionsUrl);
        await s.locator('#datei').setInputFiles(pfad);
        await s.locator('#annehmen').click();
        await s.locator('#meldung').filter({ hasText: 'The pack is in' }).waitFor({ timeout: 30_000 });
        await s.evaluate(() => globalThis.chrome.storage.local.set({ quizWarnungGesehen: true }));
      } finally {
        await s.close();
      }
    },
    async entfernePack() {
      const s = await context.newPage();
      try {
        await s.goto(optionsUrl);
        await warte(400);
        if (await s.locator('#entfernen').isVisible()) {
          await s.locator('#entfernen').click();
          await s.locator('#entfernen-ja').click();
          await s.locator('#entfernen').waitFor({ state: 'hidden', timeout: 15_000 });
        }
      } finally {
        await s.close();
      }
    },
    async warteAufErkenner() {
      await bis('Erkenner', async () => {
        try {
          return (await api.sendeAnErkenner({ ziel: 'erkenner', typ: 'wecke' }))?.ok === true;
        } catch {
          return false;
        }
      }, 40_000, 200);
    },
    async schliesse() {
      await context.close().catch(() => {});
      await profil.aufraeumen();
    },
  };
  return api;
}

export async function starteFirefoxMitPack({ hosts = [] } = {}) {
  if (!existsSync(firefoxZip)) throw new Error(`Paket fehlt: ${firefoxZip.split('/').slice(-2).join('/')}`);
  const uuid = randomUUID();
  const optionen = new firefox.Options().addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  if (hosts.length) optionen.setPreference('network.dns.localDomains', hosts.join(','));
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  const hauptFenster = (await driver.getAllWindowHandles())[0];
  const version = (await driver.getCapabilities()).get('browserVersion') ?? '';
  await driver.execute(new Command('install addon').setParameter('path', firefoxZip).setParameter('temporary', true));
  await warte(1500);

  async function oeffneErweiterung(name) {
    const vorher = await driver.getAllWindowHandles();
    await driver.setContext(firefox.Context.CHROME);
    try {
      await driver.executeScript(
        `const w = Services.wm.getMostRecentWindow('navigator:browser');
         w.gBrowser.selectedTab = w.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
        `moz-extension://${uuid}/${name}`,
      );
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
    }
    let neu;
    for (let i = 0; i < 100 && !neu; i++) {
      neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
      if (!neu) await warte(50);
    }
    if (!neu) throw new Error(`Erweiterungsseite ${name} nicht geoeffnet`);
    await driver.switchTo().window(neu);
    await bis('Erweiterungsseite geladen', async () => {
      try {
        return await driver.executeScript(`return document.readyState === 'complete' && !!(window.browser || window.chrome) && location.protocol === 'moz-extension:'`);
      } catch {
        return false;
      }
    });
  }
  async function zurueck() {
    const alle = await driver.getAllWindowHandles();
    if (alle.length > 1) await driver.close();
    await driver.switchTo().window(hauptFenster);
  }
  async function imSeitenkontext(code, ...args) {
    const t = await driver.executeAsyncScript(
      `const fertig = arguments[arguments.length - 1];
       const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
       const args = JSON.parse(arguments[0]);
       const abschluss = (w) => fertig(JSON.stringify(w === undefined ? null : w));
       Promise.resolve((async () => { ${code} })()).then(abschluss, (e) => abschluss({ fehlerText: String(e) }));`,
      JSON.stringify(args),
    );
    return JSON.parse(t);
  }
  async function mitOptionen(fn) {
    await oeffneErweiterung('options.html');
    try {
      return await fn();
    } finally {
      await zurueck();
    }
  }
  const text = (css) => driver.findElement(By.css(css)).getText();
  const sichtbar = (css) => driver.findElement(By.css(css)).isDisplayed();

  return {
    art: 'firefox',
    version,
    driver,
    uuid,
    hauptFenster,
    setzeEinstellungen: (neu) =>
      mitOptionen(() =>
        imSeitenkontext(
          `const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
           await api.storage.local.set({ einstellungen: { ...alt, ...args[0] } }); return true;`,
          neu,
        ),
      ),
    loescheEinstellungen: () => mitOptionen(() => imSeitenkontext(`await api.storage.local.remove('einstellungen'); return true;`)),
    sendeAnErkenner: (n) => mitOptionen(() => imSeitenkontext(`const a = await api.runtime.sendMessage(args[0]); return JSON.parse(JSON.stringify(a));`, n)),
    importierePack: (pfad) =>
      mitOptionen(async () => {
        await driver.findElement(By.css('#datei')).sendKeys(pfad);
        await bis('Lizenz sichtbar', () => sichtbar('#lizenz-block'));
        await driver.findElement(By.css('#annehmen')).click();
        await bis('Erfolgsmeldung', async () => (await text('#meldung')).includes('The pack is in'));
        await imSeitenkontext(`await api.storage.local.set({ quizWarnungGesehen: true }); return true;`);
      }),
    entfernePack: () =>
      mitOptionen(async () => {
        await bis('Optionsseite da', async () => (await text('#pack-status').catch(() => '')).length > 0);
        await warte(300);
        if (await sichtbar('#entfernen')) {
          await driver.findElement(By.css('#entfernen')).click();
          await bis('Rueckfrage', () => sichtbar('#entfernen-frage'));
          await driver.findElement(By.css('#entfernen-ja')).click();
          await bis('Pack entfernt', async () => (await text('#pack-status')).includes('No pack yet'));
        }
      }),
    async schliesse() {
      await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
    },
  };
}
