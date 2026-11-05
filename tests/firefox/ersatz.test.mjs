// Firefox-Test Auftrag G (Entscheidung 107): Komplett-Ersatz als Galerie in der Seite (geckodriver/WebDriver). Keine Umleitung.
// Ein Waechter in der Testseite (tests/fixtures/ersatz-waechter.js) beweist, dass der Seiteninhalt unter der Verdeckung nie sichtbar war.
// Erweiterungsseiten erreicht der Test wie tests/firefox/pack.test.mjs (feste UUID, Tab ueber den Chrome-Kontext).
// Die Testdomains loest die Einstellung `network.dns.localDomains` auf 127.0.0.1 auf (genaue Hosts, kein Platzhalter).
// Firefox zaehlt nur den sichtbaren Tab als sichtbar: gewartet wird im Tab der Seite, Einstellungen laufen kurz im Erweiterungstab.
import { Builder, By } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { Command } from 'selenium-webdriver/lib/command.js';
import { randomUUID } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { starteFixtureServer } from '../fixtures-server.mjs';
import { baueDummyPack } from '../../scripts/pack/baue-pack.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 240 s ueberschritten');
  process.exit(1);
}, 240_000).unref();

process.env.SE_AVOID_STATS = 'true';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const ausgabe = path.join(wurzel, process.env.VEIL_AUSGABE ?? '.output');
const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47174);
const GECKO_ID = 'veil@hypnomia';
const DUMMY_VORSCHAU = 4;
const HOSTS = ['pornhub.veil-erwachsen.test', 'xhamster.veil-erwachsen.test', 'eigen.test'];
const LISTE = `http://pornhub.veil-erwachsen.test:${port}/ersatz.html`;
const LISTE2 = `http://xhamster.veil-erwachsen.test:${port}/ersatz.html?a=1&b=2`;
const EIGEN = `http://eigen.test:${port}/ersatz.html`;
const NEUTRAL = `http://127.0.0.1:${port}/ersatz.html`;
const LINKSEITE = `http://127.0.0.1:${port}/ersatz-link.html`;
const INHALT = `http://127.0.0.1:${port}/erwachsen-inhalt.html`;

const paketJson = JSON.parse(readFileSync(path.join(wurzel, 'package.json'), 'utf8'));
const paket = path.join(ausgabe, `${paketJson.name}-${paketJson.version}-firefox.zip`);
if (!existsSync(paket)) {
  console.error(`firefox: Paket fehlt: ${path.relative(wurzel, paket)} (npm run zip:firefox)`);
  process.exit(1);
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
let server;
let ordner;
const uuid = randomUUID();
let extTab;
let inhaltTab;

async function installiere(treiber, paketPfad) {
  await treiber.execute(new Command('install addon').setParameter('path', paketPfad).setParameter('temporary', true));
}

async function oeffneExt(seite) {
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

// Code mit `api` (browser-Objekt der Erweiterungsseite) im Tab `extTab`; danach zurueck in den Tab der Seite (sichtbar halten).
async function imExt(code, ...args) {
  await driver.switchTo().window(extTab);
  try {
    const text = await driver.executeAsyncScript(
      `const fertig = arguments[arguments.length - 1];
       const api = (window.wrappedJSObject && window.wrappedJSObject.browser) || window.browser || window.chrome;
       const args = JSON.parse(arguments[0]);
       const abschluss = (w) => fertig(JSON.stringify(w === undefined ? null : w));
       Promise.resolve((async () => { ${code} })()).then(abschluss, (e) => abschluss({ fehlerText: String(e) }));`,
      JSON.stringify(args),
    );
    return JSON.parse(text);
  } finally {
    await driver.switchTo().window(inhaltTab);
  }
}

const setze = (teil) =>
  imExt(
    `const t = args[0];
     const alt = (await api.storage.local.get('einstellungen')).einstellungen ?? {};
     const neu = { ...alt, erwachsen: { ...(alt.erwachsen ?? {}) } };
     if (t.pause !== undefined) neu.pause = t.pause;
     if (t.an !== undefined) neu.erwachsen.an = t.an;
     if (t.komplettErsatz !== undefined) neu.erwachsen.komplettErsatz = t.komplettErsatz;
     if (t.erkennenAmInhalt !== undefined) neu.erwachsen.erkennenAmInhalt = t.erkennenAmInhalt;
     if (t.eigeneSeiten) neu.erwachsen.eigeneSeiten = t.eigeneSeiten;
     if (t.ausnahmen) neu.ausnahmen = t.ausnahmen;
     await api.storage.local.set({ einstellungen: neu });
     return true;`,
    teil,
  );
const regelAnzahl = () => imExt(`return (await api.declarativeNetRequest.getDynamicRules()).length;`);

async function bis(beschreibung, fn, frist = 15_000) {
  const t0 = Date.now();
  let letzter;
  while (Date.now() - t0 < frist) {
    letzter = await fn();
    if (letzter) return Date.now() - t0;
    await warte(40);
  }
  throw new Error(`${beschreibung}: Frist abgelaufen (letzter Wert: ${JSON.stringify(letzter)})`);
}

async function geheZu(adresse) {
  await driver.switchTo().window(inhaltTab);
  await driver.get(adresse);
}
const abbild = async () =>
  JSON.parse((await driver.executeScript(`return document.documentElement.getAttribute('data-veil-ersatz-abbild');`)) ?? 'null');
const hatAttr = () => driver.executeScript(`return document.documentElement.hasAttribute('data-veil-ersatz');`);
const hostDa = () => driver.executeScript(`return !!document.querySelector('[data-veil-ersatz-host]');`);
const warteGalerie = async (text) => {
  await bis(`Galerie ${text}`, async () => ((await abbild())?.breiten ?? []).filter((b) => b > 0).length === DUMMY_VORSCHAU, 20_000);
  return await abbild();
};
const warteOhne = (text) => bis(`ohne Galerie ${text}`, async () => !(await hatAttr()) && !(await hostDa()));
const waechter = () => driver.executeScript(`return window.__e || null;`);

let code = 0;
try {
  ordner = await mkdtemp(path.join(tmpdir(), 'veil-ff-ersatz-'));
  const packPfad = path.join(ordner, 'dummy.miapack');
  await writeFile(packPfad, (await baueDummyPack()).bytes);

  server = await starteFixtureServer(port);
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  optionen.setPreference('extensions.webextensions.uuids', JSON.stringify({ [GECKO_ID]: uuid }));
  optionen.setPreference('network.dns.localDomains', HOSTS.join(','));
  optionen.setPreference('media.autoplay.default', 0);
  optionen.setPreference('media.autoplay.blocking_policy', 0);
  // Ereignisseite schlaeft nach 3 s Leerlauf (Standard 30 s), damit der Test den schlafenden Hintergrund erreicht.
  optionen.setPreference('extensions.background.idle.timeout', 3000);
  const dienst = new firefox.ServiceBuilder().addArguments('--allow-system-access');
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).setFirefoxService(dienst).build();
  await driver.manage().setTimeouts({ pageLoad: 30_000, script: 60_000 });
  const version = (await driver.getCapabilities()).get('browserVersion');
  inhaltTab = (await driver.getAllWindowHandles())[0];
  await installiere(driver, paket);
  console.log(`firefox: Version ${version}`);
  extTab = await oeffneExt('options.html');
  await driver.switchTo().window(inhaltTab);

  // 0. Manifest: keine web_accessible_resources; Erweiterungsseite der Galerie gibt es nicht
  const manifest = await imExt(`return api.runtime.getManifest();`);
  pruefe(!manifest.web_accessible_resources || manifest.web_accessible_resources.length === 0, 'Manifest ohne web_accessible_resources');
  pruefe((manifest.permissions ?? []).includes('declarativeNetRequestWithHostAccess'), 'Referer-Recht bleibt im Manifest');

  // 1. Ohne Pack: keine Galerie, keine bleibende Verdeckung; Dauer der Verdeckung
  await setze({ komplettErsatz: true });
  await geheZu(LISTE);
  await warteOhne('ohne Pack');
  pruefe((await abbild()) === null, 'ohne Pack keine Galerie');
  const t = await driver.executeScript(`return { t0: window.__t0, hat0: window.__hat0, m: window.__m || [] };`);
  const aus = t.m.find((x) => x[0] === 'aus');
  const ms = aus ? Math.round((aus[1] - t.t0) * 10) / 10 : Math.round(t.t0 * 10) / 10;
  console.log(`firefox: Listen-Seite ohne Pack: Verdeckung ${t.hat0 ? 'ab Kopf-Skript' : 'schon vor dem Kopf-Skript vorbei, Obergrenze ab Navigationsbeginn'} ${ms} ms`);
  pruefe(ms < 100, `ohne Pack endet die Verdeckung binnen 100 ms (${ms})`);
  pruefe((await driver.executeScript(`return getComputedStyle(document.getElementById('inhalt')).visibility;`)) === 'visible', 'ohne Pack ist die Seite danach sichtbar');
  await setze({ komplettErsatz: false });

  // 2. Pack importieren, Schalter aus
  await driver.switchTo().window(extTab);
  await driver.findElement(By.css('#datei')).sendKeys(packPfad);
  await bis('Lizenz sichtbar', () => driver.findElement(By.css('#lizenz-block')).isDisplayed());
  await driver.findElement(By.css('#annehmen')).click();
  await bis('Pack-Titel', async () => (await driver.findElement(By.css('#pack-titel')).getText()).includes('Dummy pack'));
  await driver.switchTo().window(inhaltTab);
  await geheZu(LISTE);
  await warteOhne('Schalter aus');
  pruefe((await abbild()) === null, 'Pack da, Schalter aus: keine Galerie');

  // 3. Schalter an: Galerie, Waechter, Scrollen, Audio
  await geheZu(NEUTRAL);
  await bis('Audio spielt auf unbekannter Seite', () => driver.executeScript(`return window.__spielt();`), 8000).catch(() => undefined);
  pruefe((await driver.executeScript(`return window.__spielt();`)) === true, 'Gegenprobe: auf einer unbekannten Seite spielt das Audio');
  await setze({ komplettErsatz: true });
  await geheZu(LISTE2);
  const a = await warteGalerie('Schalter an');
  pruefe(a.popoverOffen === true, 'Galerie in der obersten Ebene (Popover offen)');
  pruefe(a.titel === 'Test greeting line.', `Begruessung aus den Pack-Texten (${a.titel})`);
  pruefe(JSON.stringify(a.links.map((l) => l.text)) === '["Patreon","SubscribeStar"]', 'Links Patreon und SubscribeStar');
  pruefe(a.links.every((l) => l.target === '_blank' && l.rel === 'noopener noreferrer' && /^https:\/\//.test(l.href ?? '')), 'Links: neuer Tab, noopener noreferrer, https');
  pruefe(a.zeile === 'xhamster.veil-erwachsen.test is right behind me.', `Zeile mit dem Hostnamen (${a.zeile})`);
  const gross = await driver.executeScript(`return { b: window.innerWidth, h: window.innerHeight };`);
  pruefe(a.host.w === gross.b && a.host.h === gross.h, 'Galerie fuellt die ganze Seite');
  const w = await waechter();
  pruefe(w.proben > 5, `Waechter hat geprueft (${w.proben})`);
  pruefe(w.ersteProbeMitAttr === true, 'Verdeckung stand schon bei der ersten Probe');
  pruefe(w.sichtbarMitAttr === 0 && w.hgFalsch === 0 && w.ohneAttr === 0, `Seiteninhalt nie sichtbar (sichtbar ${w.sichtbarMitAttr}, Hintergrund ${w.hgFalsch}, ohne Verdeckung ${w.ohneAttr})`);
  pruefe((await driver.executeScript(`return document.elementFromPoint(50, 50).hasAttribute('data-veil-ersatz-host');`)) === true, 'Host liegt oben');
  await driver.actions().sendKeys('').perform(); // Page Down
  await driver.actions().sendKeys('').perform(); // End
  pruefe((await driver.executeScript(`return window.scrollY;`)) === 0, 'Seite nicht scrollbar');
  let nieGespielt = true;
  let immerStumm = true;
  for (let i = 0; i < 6; i++) {
    if (await driver.executeScript(`return window.__spielt();`)) nieGespielt = false;
    if (!(await driver.executeScript(`return document.getElementById('ton').muted;`))) immerStumm = false;
    await warte(250);
  }
  pruefe(nieGespielt, 'Audio der Seite bleibt angehalten');
  pruefe(immerStumm, 'Audio der Seite bleibt stumm');
  // Pause per Klick
  const t0 = Date.now();
  await driver
    .actions({ async: true })
    .move({ x: Math.round(a.pause.x + a.pause.w / 2), y: Math.round(a.pause.y + a.pause.h / 2) })
    .click()
    .perform();
  await warteOhne('Pause per Klick');
  console.log(`firefox: Pause in der Galerie bis Seite sichtbar ${Date.now() - t0} ms`);
  pruefe((await driver.executeScript(`return getComputedStyle(document.getElementById('inhalt')).visibility;`)) === 'visible', 'nach Pause ist die Seite sichtbar');
  pruefe((await driver.executeScript(`return document.getElementById('ton').muted;`)) === false, 'Ton-Zustand zurueck');
  pruefe((await imExt(`return (await api.storage.local.get('einstellungen')).einstellungen.pause;`)) === true, 'Pause steht in den Einstellungen');
  pruefe((await driver.getCurrentUrl()) === LISTE2, 'keine Umleitung');

  // 3b. Klicks und Tasten erreichen die Seite nie
  await setze({ pause: false });
  await geheZu(LISTE);
  const b = await warteGalerie('Schutz');
  const klickeBei = (x, y) => driver.actions({ async: true }).move({ x: Math.round(x), y: Math.round(y) }).click().perform();
  await klickeBei(30, 30);
  await driver.actions({ async: true }).sendKeys('f').perform();
  await driver.actions({ async: true }).sendKeys(' ').perform();
  await driver.actions({ async: true }).sendKeys('\uE007').perform(); // Enter
  const k1 = await driver.executeScript(`return window.__k;`);
  pruefe(Object.keys(k1).length === 0, `Klicks und Tasten in der Galerie erreichen die Seite nicht (${JSON.stringify(k1)})`);
  await klickeBei(b.pause.x + b.pause.w / 2, b.pause.y + b.pause.h / 2);
  await warteOhne('Pause (Schutz)');
  const k2 = await driver.executeScript(`return window.__k;`);
  pruefe(Object.keys(k2).length === 0, `auch der Klick auf Pause kam bei der Seite nicht an (${JSON.stringify(k2)})`);
  await setze({ pause: false });

  // 3c. Dialog, Popover der Seite; Host angefasst; Wurzelelement ausgetauscht
  await geheZu(LISTE);
  const c = await warteGalerie('oberste Ebene');
  const oben = () => driver.executeScript(`return document.elementFromPoint(50, 50).hasAttribute('data-veil-ersatz-host');`);
  await driver.executeScript(`document.getElementById('dlg').showModal();`);
  await bis('Dialog geschlossen', async () => (await driver.executeScript(`return document.getElementById('dlg').open;`)) === false, 5000);
  pruefe(await oben(), 'modaler Dialog der Seite wird geschlossen, die Galerie liegt oben');
  await driver.executeScript(`document.getElementById('pp').showPopover();`);
  await bis('Galerie wieder oben', oben, 5000);
  pruefe(true, 'Popover der Seite: die Galerie kommt wieder nach oben');
  await driver.executeScript(`document.getElementById('pp').hidePopover();`);
  // Modaler Dialog in einer offenen Shadow Root der Seite
  await driver.executeScript(`
    const h = document.createElement('div');
    h.id = 'wurzel-host';
    const w = h.attachShadow({ mode: 'open' });
    w.innerHTML = '<dialog id="sd">Dialog in der Wurzel</dialog>';
    document.body.appendChild(h);`);
  await warte(150);
  await driver.executeScript(`document.getElementById('wurzel-host').shadowRoot.getElementById('sd').showModal();`);
  await bis('Wurzel-Dialog geschlossen', async () => (await driver.executeScript(`return document.getElementById('wurzel-host').shadowRoot.getElementById('sd').open;`)) === false, 5000);
  pruefe(await oben(), 'modaler Dialog in einer Shadow Root der Seite wird geschlossen, die Galerie liegt oben');
  const host = `document.querySelector('[data-veil-ersatz-host]')`;
  await driver.executeScript(`${host}.hidePopover();`);
  await bis('Popover wieder offen', () => driver.executeScript(`return ${host}.matches(':popover-open');`), 5000);
  await driver.executeScript(`${host}.style.cssText = 'display: none';`);
  await bis('Stil wiederhergestellt', async () => (await driver.executeScript(`return getComputedStyle(${host}).display;`)) === 'block', 5000);
  await driver.executeScript(`${host}.removeAttribute('popover');`);
  await bis('Popover-Attribut wiederhergestellt', async () => (await driver.executeScript(`return ${host}.getAttribute('popover');`)) === 'manual', 5000);
  await driver.executeScript(`${host}.remove();`);
  await bis('Host wieder da', () => hostDa(), 5000);
  pruefe(true, 'Aenderungen am Host (Popover zu, Stil, Attribut, entfernt) werden zurueckgenommen');
  // Als Seitenskript (das Skript des Treibers darf document.open in Firefox 128 nicht rufen)
  await driver.executeScript(`const sk = document.createElement('script'); sk.textContent = "document.open(); document.write('<!doctype html><html><head><title>neu</title></head><body><h1 id=\\"inhalt\\">Neu gerendert</h1></body></html>'); document.close();"; document.head.append(sk);`);
  await bis('Galerie nach Austausch des Wurzelelements', async () => (await hatAttr()) && (await hostDa()), 8000);
  pruefe((await driver.executeScript(`return document.documentElement.getAttribute('data-veil-ersatz');`)) === 'galerie', 'Wurzelelement ausgetauscht: Verdeckung und Galerie zurueck');
  pruefe((await driver.executeScript(`return getComputedStyle(document.getElementById('inhalt')).visibility;`)) === 'hidden', 'neu gerenderter Inhalt ist verdeckt');
  await bis('Abbild nach Austausch', async () => ((await abbild())?.pause?.w ?? 0) > 0, 5000);
  const d = await abbild();
  await klickeBei(d.pause.x + d.pause.w / 2, d.pause.y + d.pause.h / 2);
  await warteOhne('Pause nach Austausch');
  pruefe(true, 'nach dem Austausch ist die Galerie bedienbar (Pause per Klick)');
  await setze({ pause: false });

  // 3d. Tab stumm, Stand davor kommt zurueck
  const tabStumm = (u) => imExt(`const t = (await api.tabs.query({})).find((x) => x.url === args[0]); return t ? t.mutedInfo?.muted === true : null;`, u);
  await setze({ pause: true });
  await geheZu(LISTE);
  await warteOhne('Tab stumm: Pause');
  pruefe((await tabStumm(LISTE)) === false, 'Tab ohne Galerie ist nicht stumm');
  await setze({ pause: false });
  await warteGalerie('Tab stumm');
  await bis('Tab stumm', async () => (await tabStumm(LISTE)) === true, 5000);
  pruefe(true, 'Tab ist stumm, solange die Galerie steht');
  await setze({ pause: true });
  await warteOhne('Tab stumm: Ende');
  await bis('Tab wieder laut', async () => (await tabStumm(LISTE)) === false, 5000);
  pruefe(true, 'Tab ist nach der Pause wieder laut');
  await imExt(`const t = (await api.tabs.query({})).find((x) => x.url === args[0]); await api.tabs.update(t.id, { muted: true }); return true;`, LISTE);
  await setze({ pause: false });
  await warteGalerie('Tab war stumm');
  await setze({ pause: true });
  await warteOhne('Tab war stumm: Ende');
  await warte(500);
  pruefe((await tabStumm(LISTE)) === true, 'war der Tab schon stumm, bleibt er es');
  await imExt(`const t = (await api.tabs.query({})).find((x) => x.url === args[0]); await api.tabs.update(t.id, { muted: false }); return true;`, LISTE);
  await setze({ pause: false });

  // 3e. Seite mit Galerie ohne Pause verlassen: Tab nicht mehr stumm
  await geheZu(LISTE);
  await warteGalerie('Verlassen');
  await bis('Tab stumm', async () => (await tabStumm(LISTE)) === true, 5000);
  await geheZu(NEUTRAL);
  await bis('Tab wieder laut nach Navigation', async () => (await tabStumm(NEUTRAL)) === false, 8000);
  pruefe(true, 'Galerie-Seite ohne Pause verlassen: der Tab ist danach nicht mehr stumm');

  // 4. Pause von aussen und zurueck
  await setze({ pause: false });
  await geheZu(LISTE);
  await warteGalerie('nach Pause aus');
  const t1 = Date.now();
  await setze({ pause: true });
  await warteOhne('Pause von aussen');
  console.log(`firefox: Pause von aussen bis Galerie weg ${Date.now() - t1} ms`);
  await setze({ pause: false });
  await warteGalerie('Ende der Pause');
  pruefe(true, 'Pause von aussen nimmt die Galerie weg, Ende der Pause bringt sie zurueck');

  // 5. Schalter aus und an, Pornoseiten-Modus
  await setze({ komplettErsatz: false });
  await warteOhne('Schalter aus');
  await setze({ komplettErsatz: true });
  await warteGalerie('Schalter an');
  await setze({ an: false });
  await warteOhne('Modus aus');
  await setze({ an: true });
  await warteGalerie('Modus an');
  pruefe(true, 'Schalter und Pornoseiten-Modus bei offener Seite');

  // 6. Blitz-Grenze
  await driver.executeScript(`
    const z = (window.__host = []);
    new MutationObserver((l) => {
      for (const m of l) {
        for (const n of m.addedNodes) if (n.hasAttribute && n.hasAttribute('data-veil-ersatz-host')) z.push(['an', performance.now()]);
        for (const n of m.removedNodes) if (n.hasAttribute && n.hasAttribute('data-veil-ersatz-host')) z.push(['aus', performance.now()]);
      }
    }).observe(document.documentElement, { childList: true });`);
  for (let i = 0; i < 10; i++) {
    await setze({ komplettErsatz: i % 2 === 1 });
    await warte(190); // 10 Umschaltungen in etwa 2 s
  }
  await setze({ komplettErsatz: true });
  await warteGalerie('nach Umschalten');
  await warte(1500);
  const z = await driver.executeScript(`return window.__host;`);
  const zeiten = z.map((x) => x[1]);
  let hoechst = 0;
  for (const s of zeiten) hoechst = Math.max(hoechst, zeiten.filter((u) => u >= s && u < s + 1000).length);
  let hoechst125 = 0;
  for (const s of zeiten) hoechst125 = Math.max(hoechst125, zeiten.filter((u) => u >= s && u < s + 1250).length);
  console.log(`firefox: Wechsel der Galerie ${z.length}, hoechstens ${hoechst} je 1-s-Fenster, hoechstens ${hoechst125} je 1,25-s-Fenster`);
  pruefe(z.length > 1 && hoechst <= 3 && hoechst125 <= 3, `Blitz-Grenze mit Abstand: hoechstens 3 Wechsel je Sekunde und je 1,25 s (${hoechst}, ${hoechst125} bei ${z.length})`);
  pruefe(await hostDa(), 'Ende des Umschaltens: Galerie steht');

  // 7. Eigene Ausnahme
  await setze({ ausnahmen: ['pornhub.veil-erwachsen.test'] });
  await geheZu(LISTE);
  await warteOhne('Ausnahme');
  pruefe((await abbild()) === null, 'Ausnahme: keine Galerie');
  pruefe((await waechter()).sichtbarMitAttr === 0, 'Ausnahme: nichts blieb verdeckt sichtbar');
  await geheZu(LISTE2);
  await warteGalerie('andere Domain trotz Ausnahme');
  await setze({ ausnahmen: [] });

  // 8. Eigene Seite
  await geheZu(EIGEN);
  await warteOhne('eigene Seite ohne Eintrag');
  pruefe((await waechter()).ersteProbeMitAttr === false, 'eigene Seite ohne Eintrag: nie verdeckt');
  await setze({ eigeneSeiten: ['eigen.test'] });
  await geheZu(EIGEN);
  await warteGalerie('eigene Seite');
  pruefe((await waechter()).sichtbarMitAttr === 0, 'eigene Seite: Galerie, Inhalt nicht sichtbar');
  await setze({ eigeneSeiten: [] });
  await geheZu(EIGEN);
  await warteOhne('eigene Seite entfernt');
  pruefe(true, 'eigene Seite entfernt: keine Galerie');

  // 9. Am Inhalt erkannte Seite nie
  await setze({ erkennenAmInhalt: true });
  await geheZu(INHALT);
  await warte(1500);
  pruefe(!(await hatAttr()) && !(await hostDa()), 'am Inhalt erkannte Seite bekommt nie die Galerie');
  await setze({ erkennenAmInhalt: false });

  // 10. Link von einer fremden Seite
  await geheZu(LINKSEITE);
  await driver.executeScript(`const a = document.getElementById('l'); a.href = arguments[0]; a.click();`, LISTE);
  await bis('Navigation zur Listen-Domain', async () => (await driver.getCurrentUrl()) === LISTE);
  await warteGalerie('Link von fremder Seite');
  pruefe((await driver.getCurrentUrl()) === LISTE, 'Link von einer fremden Seite zeigt die Galerie');

  // 11. Rahmen
  await geheZu(NEUTRAL);
  await driver.executeScript(`const f = document.createElement('iframe'); f.id = 'rahmen'; f.src = arguments[0]; document.body.append(f);`, LISTE);
  await warte(1500);
  await driver.switchTo().frame(await driver.findElement(By.id('rahmen')));
  const imRahmen = await driver.executeScript(`return document.documentElement.hasAttribute('data-veil-ersatz') || !!document.querySelector('[data-veil-ersatz-host]');`);
  await driver.switchTo().defaultContent();
  pruefe(imRahmen === false, 'Rahmen auf einer Listen-Domain bekommt nie eine Galerie');
  pruefe((await hatAttr()) === false, 'Rahmen: die Elternseite bleibt unberuehrt');

  // 12. Alte Umleitungsregel aus 0.4.0 wird beim Aufwachen entfernt
  const hintergrundStatus = async () => {
    await driver.setContext(firefox.Context.CHROME);
    try {
      return await driver.executeScript(`return WebExtensionPolicy.getByID(arguments[0])?.extension?.backgroundState ?? null;`, GECKO_ID);
    } finally {
      await driver.setContext(firefox.Context.CONTENT);
    }
  };
  await imExt(
    `await api.declarativeNetRequest.updateDynamicRules({ removeRuleIds: [1], addRules: [{ id: 1, priority: 1, action: { type: 'redirect', redirect: { url: args[0] } }, condition: { requestDomains: ['nirgendwo.test'], resourceTypes: ['main_frame'] } }] });
     return true;`,
    NEUTRAL,
  );
  pruefe((await regelAnzahl()) === 1, 'alte Regel steht');
  let schlaeft = '';
  try {
    await bis('Ereignisseite schlaeft', async () => (schlaeft = await hintergrundStatus()) === 'stopped', 25_000);
  } catch {
    // unten ausgewertet
  }
  pruefe(schlaeft === 'stopped', `Ereignisseite schlaeft (${schlaeft})`);
  await imExt(`return await api.runtime.sendMessage({ ziel: 'hintergrund', typ: 'wecke' }).catch(() => null);`);
  try {
    await bis('alte Regel entfernt', async () => (await regelAnzahl()) === 0, 15_000);
    pruefe(true, 'alte Regel wird beim Aufwachen entfernt');
  } catch {
    pruefe(false, 'alte Regel wird beim Aufwachen entfernt');
  }

  // 13. Pack entfernen: Galerie sofort weg
  await geheZu(LISTE);
  await warteGalerie('vor Pack entfernen');
  await driver.switchTo().window(extTab);
  await driver.findElement(By.css('#entfernen')).click();
  await bis('Rueckfrage', () => driver.findElement(By.css('#entfernen-frage')).isDisplayed());
  await driver.findElement(By.css('#entfernen-ja')).click();
  await bis('Pack entfernt', async () => (await driver.findElement(By.css('#pack-status')).getText()).includes('No pack yet'));
  await driver.switchTo().window(inhaltTab);
  await warteOhne('Pack entfernt');
  pruefe(true, 'Pack entfernt: Galerie sofort weg');
} catch (fehler) {
  console.error('firefox: FEHLER', fehler);
  code = 1;
} finally {
  if (driver) await Promise.race([driver.quit().catch(() => {}), warte(10_000)]);
  if (server) server.close();
  if (ordner) await rm(ordner, { recursive: true, force: true });
}
console.log(`firefox: ersatz.test ${ok} gruen, ${rot} rot`);
process.exit(code || (rot > 0 ? 1 : 0));
