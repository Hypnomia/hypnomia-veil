// Browser-Start fuer die Messwerkzeuge (kein Produktcode).
// Chromium: Playwright, Erweiterung wie in tests/chromium/erkenner.spec.ts geladen.
// Firefox: selenium/geckodriver, temporaere Installation des Zips wie in tests/firefox/schleier.test.mjs.
import { chromium } from '@playwright/test';
import { Builder } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { existsSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { chromeErweiterung, firefoxBin, firefoxZip, GECKO_ID, tempProfil, warte } from './hilfe.mjs';

process.env.SE_AVOID_STATS = 'true';

export async function starteChromium() {
  if (!existsSync(chromeErweiterung)) throw new Error(`Build fehlt: ${chromeErweiterung} (npm test baut den Testbau nach .output-test)`);
  const profil = await tempProfil('veil-messung-');
  const context = await chromium.launchPersistentContext(profil.ordner, {
    channel: 'chromium',
    headless: true,
    args: [`--disable-extensions-except=${chromeErweiterung}`, `--load-extension=${chromeErweiterung}`],
  });
  let worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
  const seite = context.pages()[0] ?? (await context.newPage());
  // Genaue Version ueber das DevTools-Protokoll (der User-Agent zeigt nur 156.0.0.0).
  const cdp = await context.newCDPSession(seite);
  const version = String((await cdp.send('Browser.getVersion')).product).replace(/^.*Chrome\//, '');
  await cdp.detach().catch(() => {});
  const erweiterungsId = new URL(worker.url()).host;

  // Sendet aus dem Service Worker (er erreicht das Offscreen-Dokument); faellt der Worker aus, wird ein neuer abgewartet.
  async function sende(nachricht) {
    for (let versuch = 0; versuch < 4; versuch++) {
      try {
        return await worker.evaluate((n) => globalThis.chrome.runtime.sendMessage(n), nachricht);
      } catch (fehler) {
        if (versuch === 3) throw fehler;
        worker = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', { timeout: 15_000 }));
        await warte(100);
      }
    }
  }

  return {
    art: 'chromium',
    version,
    context,
    erweiterungsId,
    sende,
    async schliesse() {
      await context.close().catch(() => {});
      await profil.aufraeumen();
    },
  };
}

export async function starteFirefox() {
  if (!existsSync(firefoxZip)) throw new Error(`Paket fehlt: ${firefoxZip.split('/').slice(-2).join('/')}`);
  const uuid = randomUUID();
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  // geckodriver --allow-system-access: erlaubt dem Messwerkzeug den Chrome-Kontext, um die Erweiterungsseite zu oeffnen
  // (geckodriver verbietet Navigation zu moz-extension://).
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  // Feste interne UUID, damit moz-extension://<uuid>/popup.html erreichbar ist (Nachrichten an den Erkenner im Hintergrund).
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  const driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 30_000 });
  const caps = await driver.getCapabilities();
  const version = caps.get('browserVersion') ?? '';
  await driver.installAddon(firefoxZip, true);

  // Sendet eine Nachricht von einer Erweiterungsseite aus an den Hintergrund (dort lebt der Erkenner).
  let popupOffen = false;
  let erweiterungsTab = null;
  async function sende(nachricht) {
    if (!popupOffen) {
      const vorher = await driver.getAllWindowHandles();
      await driver.setContext(firefox.Context.CHROME);
      try {
        await driver.executeScript(
          `const w = Services.wm.getMostRecentWindow('navigator:browser');
           w.gBrowser.selectedTab = w.gBrowser.addTab(arguments[0], { triggeringPrincipal: Services.scriptSecurityManager.getSystemPrincipal() });`,
          `moz-extension://${uuid}/popup.html`,
        );
      } finally {
        await driver.setContext(firefox.Context.CONTENT);
      }
      let neu;
      for (let i = 0; i < 100 && !neu; i++) {
        neu = (await driver.getAllWindowHandles()).find((h) => !vorher.includes(h));
        if (!neu) await warte(50);
      }
      if (!neu) throw new Error('Erweiterungsseite nicht geoeffnet');
      await driver.switchTo().window(neu);
      erweiterungsTab = neu;
      popupOffen = true;
    }
    return driver.executeAsyncScript(
      `const fertig = arguments[arguments.length - 1];
       const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
       Promise.resolve(api.runtime.sendMessage(JSON.parse(arguments[0])))
         .then((a) => fertig(JSON.stringify(a === undefined ? null : a)), (e) => fertig(JSON.stringify({ fehlerText: String(e) })));`,
      JSON.stringify(nachricht),
    ).then((t) => JSON.parse(t));
  }

  return {
    art: 'firefox',
    version,
    driver,
    uuid,
    sende,
    // Beim Navigieren auf normale Seiten ist die Erweiterungsseite nicht mehr offen.
    popupVergessen() { popupOffen = false; },
    async schliesse() {
      await Promise.race([driver.quit().catch(() => {}), new Promise((r) => setTimeout(r, 10_000))]);
    },
  };
}
