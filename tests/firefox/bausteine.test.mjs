// Firefox (geckodriver): Phase 11 E4c0, gemeinsame Bausteine. Gewoehnliche Testseite ohne Erweiterung (tests/fixtures/bausteine.html, Buendel baut
// tests/bausteine-server.mjs). Gemessen: Fingerziel bei 360 und 1280 Pixel Breite (nur Maus: Firefox kann am Rechner kein Finger-Zeigergeraet
// vortaeuschen), Tastatur je Baustein, aria folgt, Zwischenwert ohne markierte Stufe. Stumm (media.volume_scale 0.0).
import { Builder, By, Key } from 'selenium-webdriver';
import firefox from 'selenium-webdriver/firefox.js';
import { starteBausteineServer } from '../bausteine-server.mjs';

setTimeout(() => {
  console.error('firefox: Zeitlimit von 90 s ueberschritten');
  process.exit(1);
}, 90_000).unref();
process.env.SE_AVOID_STATS = 'true';

const firefoxBin = process.env.VEIL_FIREFOX_BIN ?? '/Applications/Firefox.app/Contents/MacOS/firefox';
let server;
let driver;
let code = 0;
const fehler = [];
const pruefe = (bedingung, text) => {
  if (!bedingung) {
    fehler.push(text);
    console.error(`ROT: ${text}`);
  }
};
const attr = (e, n) => e.getAttribute(n);
const js = (s, ...a) => driver.executeScript(s, ...a);

try {
  server = await starteBausteineServer();
  const optionen = new firefox.Options().setPreference('media.volume_scale', '0.0').addArguments('-headless').setBinary(firefoxBin);
  driver = await new Builder().forBrowser('firefox').setFirefoxOptions(optionen).build();
  console.log(`firefox: Version ${(await driver.getCapabilities()).get('browserVersion')}`);

  async function lade(breite) {
    await driver.manage().window().setRect({ width: breite + 16, height: 1000 }); // Rand des Fensters kommt dazu
    await driver.get(server.url);
    await driver.wait(async () => (await js("return document.documentElement.dataset.bereit ?? null")) === '1', 15_000);
    await js('return document.fonts.ready.then(() => true)');
    const innen = await js('return window.innerWidth');
    // innerWidth auf die Sollbreite ziehen (Firefox-Fenster haben Rahmen)
    if (innen !== breite) await driver.manage().window().setRect({ width: breite + 16 + (breite - innen), height: 1000 });
    return js('return window.innerWidth');
  }

  for (const breite of [360, 1280]) {
    // Firefox-Fenster sind mindestens rund 500 Pixel breit: 360 Pixel messen wir in einem Rahmen (iframe) dieser Breite, die Seite darin sieht 360.
    await lade(1280);
    if (breite === 360) {
      await js(`const f = document.createElement('iframe'); f.id = 'schmal'; f.src = arguments[0]; f.style.cssText = 'width:360px;height:900px;border:0'; document.body.innerHTML = ''; document.body.append(f);`, server.url);
      await driver.wait(async () => (await js(`try { return document.getElementById('schmal').contentDocument.documentElement.dataset.bereit ?? null } catch { return null }`)) === '1', 15_000);
      await driver.switchTo().frame(await driver.findElement(By.id('schmal')));
      await js('return document.fonts.ready.then(() => true)');
    }
    const ist = await js('return window.innerWidth');
    pruefe(ist === breite, `Messbreite ${ist} gleich ${breite}`);
    console.log(`firefox: Breite ${ist}`);
    await js(`for (const k of document.querySelectorAll('[aria-expanded="false"]')) k.click();`);
    const k = await js(`
      return [...document.querySelectorAll('button:not([id^="fremd-"]), select, input, [role="switch"], [role="radio"]')]
        .filter((e) => e.id !== 'nackt' && e.getClientRects().length)
        .map((e) => { const r = e.getBoundingClientRect(); return [e.className, r.width, r.height, r.left, r.top, r.right, r.bottom]; });`);
    pruefe(k.length > 40, `${breite}: genug Elemente gemessen (${k.length})`);
    const klein = k.filter(([, b, h]) => b < 43.99 || h < 43.99);
    pruefe(klein.length === 0, `${breite}: Elemente unter 44 px: ${JSON.stringify(klein.slice(0, 5))}`);
    // R13: keine Trefferflaeche ueberlappt eine andere (reine Geometrie, in Firefox nur mit Maus)
    const ueber = [];
    for (let i = 0; i < k.length; i++)
      for (let j = i + 1; j < k.length; j++) {
        const a = k[i], c = k[j];
        if (Math.min(a[5], c[5]) - Math.max(a[3], c[3]) > 0.5 && Math.min(a[6], c[6]) - Math.max(a[4], c[4]) > 0.5) ueber.push(`${a[0]} / ${c[0]}`);
      }
    pruefe(ueber.length === 0, `${breite}: Trefferflaechen ueberlappen: ${JSON.stringify(ueber.slice(0, 4))}`);
    const scroll = await js('return [document.documentElement.scrollWidth, document.documentElement.clientWidth]');
    pruefe(scroll[0] <= scroll[1] + 1, `${breite}: waagrechtes Scrollen ${scroll}`);
    const kleinste = Math.min(...k.map(([, b, h]) => Math.min(b, h)));
    console.log(`firefox: ${breite} px: ${k.length} Elemente, kleinste Kante ${kleinste.toFixed(2)} px`);
    // Auswahlfeld nach O6: Gestalt gleich dem nackten select, Hoehe 44
    const o6 = await js(`
      const m = (s) => { const c = getComputedStyle(document.querySelector(s)); return { h: document.querySelector(s).getBoundingClientRect().height, pr: c.paddingRight, br: c.borderTopLeftRadius, bp: c.backgroundPositionX, bs: c.backgroundSize, ap: c.appearance }; };
      return [m('[data-fall="auswahl"] select'), m('#nackt')];`);
    pruefe(o6[0].h >= 43.99, `${breite}: Auswahlfeld Hoehe ${o6[0].h}`);
    for (const f of ['pr', 'br', 'bp', 'bs', 'ap']) pruefe(o6[0][f] === o6[1][f], `${breite}: Auswahlfeld ${f} ${o6[0][f]} gegen nackt ${o6[1][f]}`);
    await driver.switchTo().defaultContent();
  }

  // Tastatur und aria bei 1280
  await lade(1280);
  const sw = await driver.findElement(By.css('[data-fall="schalter"] [role="switch"]'));
  await sw.sendKeys(Key.SPACE);
  pruefe((await attr(sw, 'aria-checked')) === 'true', 'Schalter: Leertaste schaltet ein');
  await sw.sendKeys(Key.ENTER);
  pruefe((await attr(sw, 'aria-checked')) === 'false', 'Schalter: Enter schaltet aus');

  const radios = await driver.findElements(By.css('[data-fall="stimmung"] [role="radio"]'));
  await radios[0].sendKeys(Key.ARROW_RIGHT);
  pruefe((await js('return document.activeElement === arguments[0]', radios[1])) === true, 'Stufenwahl: Pfeil rechts bewegt den Fokus');
  pruefe((await attr(radios[0], 'aria-checked')) === 'true' && (await attr(radios[1], 'aria-checked')) === 'false', 'Stufenwahl: ein Pfeil waehlt nichts (R6)');
  await radios[1].sendKeys(Key.END);
  pruefe((await js('return document.activeElement === arguments[0]', radios[2])) === true, 'Stufenwahl: Ende bewegt den Fokus ans Ende');
  await radios[2].sendKeys(Key.ARROW_RIGHT);
  pruefe((await js('return document.activeElement === arguments[0]', radios[0])) === true, 'Stufenwahl: umlaufend');
  pruefe((await js('return window.__b.log.filter((l) => l.von === "stimmung").length')) === 0, 'Stufenwahl: Pfeile rufen keinen Rueckruf');
  await radios[0].sendKeys(Key.ARROW_RIGHT);
  await radios[1].sendKeys(Key.SPACE);
  pruefe((await attr(radios[1], 'aria-checked')) === 'true', 'Stufenwahl: Leertaste waehlt');
  await radios[1].sendKeys(Key.HOME);
  await radios[0].sendKeys(Key.ENTER);
  pruefe((await attr(radios[0], 'aria-checked')) === 'true', 'Stufenwahl: Eingabe waehlt');
  pruefe((await driver.findElements(By.css('[data-fall="stimmung"] [role="radio"][tabindex="0"]'))).length === 1, 'Stufenwahl: ein Tab-Halt');

  // Zwischenwert
  await js('window.__b.stimmung.setze(0.13)');
  const marken = await js(`return [...document.querySelectorAll('[data-fall="stimmung"] [role="radio"]')].map((e) => e.getAttribute('aria-checked'))`);
  pruefe(marken.join() === 'false,false,false', `Zwischenwert: keine Stufe markiert (${marken})`);
  pruefe((await js(`return document.querySelector('[data-fall="stimmung"] .v-auf-kopf').getAttribute('aria-expanded')`)) === 'true', 'Zwischenwert: Exact value offen');
  pruefe((await js(`return document.querySelector('[data-fall="stimmung"] .v-wert').textContent`)) === '0.13', 'Zwischenwert: zeigt 0.13');

  // Gesperrter Schalter: aria-disabled, ein Druck aendert nichts
  const gesperrt = await driver.findElement(By.css('[data-fall="gesperrt"] [role="switch"]'));
  await gesperrt.sendKeys(Key.SPACE);
  pruefe((await attr(gesperrt, 'aria-checked')) === 'true' && (await attr(gesperrt, 'aria-disabled')) === 'true', 'Gesperrter Schalter: Leertaste aendert nichts');

  // Aufklapper und "?"
  const kopf = await driver.findElement(By.css('[data-fall="aufklapper"] .v-auf-kopf'));
  await kopf.sendKeys(Key.ENTER);
  pruefe((await attr(kopf, 'aria-expanded')) === 'true', 'Aufklapper: Enter oeffnet');
  await kopf.sendKeys(Key.SPACE);
  pruefe((await attr(kopf, 'aria-expanded')) === 'false', 'Aufklapper: Leertaste schliesst');
  const frage = await driver.findElement(By.css('[data-fall="aufklapper"] .v-frage'));
  await frage.sendKeys(Key.ENTER);
  pruefe((await attr(frage, 'aria-expanded')) === 'true', '"?": Enter oeffnet');
  await frage.sendKeys(Key.ESCAPE);
  pruefe((await attr(frage, 'aria-expanded')) === 'false', '"?": Escape schliesst');

  // Kleidungsfrage: gemischt, nichts markiert, Wahl schreibt
  const kl = await driver.findElements(By.css('[data-fall="kleidung"] [role="radio"]'));
  pruefe((await attr(kl[0], 'aria-checked')) === 'false' && (await attr(kl[1], 'aria-checked')) === 'false', 'Kleidungsfrage: Standard gemischt, nichts markiert');
  pruefe((await js('return window.__b.log.filter((l) => l.von === "kleidung").length')) === 0, 'Kleidungsfrage: nichts geschrieben ohne Handlung');
  await kl[1].click();
  pruefe((await attr(kl[1], 'aria-checked')) === 'true', 'Kleidungsfrage: Wahl markiert');

  // Hoechstens ein Hinweis
  await js(`for (const t of ['eins', 'zwei', 'drei']) window.__b.auswahl.setzeHinweis(t)`);
  pruefe((await js(`return document.querySelectorAll('[data-fall="auswahl"] .v-hinweis').length`)) === 1, 'Hinweis: nach dreimal Setzen genau einer');

  // ---- K1 (E4k): der Regler "Exact value" meldet nach keyup und pointerup selbst, wenn sein Wert vom zuletzt gemeldeten oder ueber setze() gesetzten abweicht ----
  // Firefox 160 meldet am nativen Regler kein `change`, wenn der Wert nach einem Zuruecksetzen durch die Seite wieder dem Wert des letzten `change` gleicht.
  // Die Seite scheitert hier "von Hand": nach jeder Meldung stellt der Test den gespeicherten Stand per setze() zurueck (wie die Seite nach einem Speicherfehler).
  await lade(1280);
  const kMeldungen = () => js('return window.__b.log.filter((l) => l.von === "stimmung").map((l) => l.wert)');
  await js(`document.querySelector('[data-fall="stimmung"] .v-auf-kopf').click()`);
  const kRegler = await driver.findElement(By.css('[data-fall="stimmung"] input[type="range"]'));
  const kFokus = () => js('arguments[0].focus()', kRegler);
  const nahe = (a, b) => Math.abs(a - b) < 1e-9;
  for (const [taste, name, start, schritt] of [[Key.ARROW_LEFT, 'Pfeil links', 0.22, -0.01], [Key.ARROW_RIGHT, 'Pfeil rechts', 0.1, 0.01]]) {
    await js('window.__b.log.length = 0; window.__b.stimmung.setze(arguments[0])', start);
    await kFokus();
    for (let i = 1; i <= 3; i++) {
      await kRegler.sendKeys(taste);
      const m = await kMeldungen();
      pruefe(m.length === i && nahe(m.at(-1), start + schritt), `K1 ${name}: Taste ${i} meldet genau einen Schreibversuch mit ${(start + schritt).toFixed(2)} (gemeldet: ${JSON.stringify(m)})`);
      await js('window.__b.stimmung.setze(arguments[0])', start); // die Seite stellt den gespeicherten Stand zurueck (Speichern gescheitert)
      pruefe(nahe(Number(await js('return arguments[0].value', kRegler)), start), `K1 ${name}: nach dem Zuruecksetzen steht der gespeicherte Stand da`);
    }
  }
  // Ohne Zuruecksetzen (Speichern gelungen): jede Taste genau eine Meldung, kein doppeltes Speichern
  await js('window.__b.log.length = 0; window.__b.stimmung.setze(0.1)');
  await kFokus();
  for (let i = 1; i <= 4; i++) {
    await kRegler.sendKeys(Key.ARROW_RIGHT);
    const m = await kMeldungen();
    pruefe(m.length === i && nahe(m.at(-1), 0.1 + 0.01 * i), `K1 ohne Zuruecksetzen: Taste ${i} meldet genau einen Schreibversuch (gemeldet: ${JSON.stringify(m)})`);
  }
  // Ziehen mit der Maus: je Ziehen genau eine Meldung, auch nach dem Zuruecksetzen
  await js('window.__b.log.length = 0; window.__b.stimmung.setze(0.1)');
  for (let i = 1; i <= 2; i++) {
    await driver.actions({ async: true }).move({ origin: kRegler }).press().move({ origin: kRegler, x: 40 }).release().perform();
    const m = await kMeldungen();
    pruefe(m.length === i, `K1 Ziehen ${i}: genau ein Schreibversuch (gemeldet: ${JSON.stringify(m)})`);
    await js('window.__b.stimmung.setze(0.1)');
  }
  // Ein Zwischenwert (0,1049, der Regler haelt ihn als 0,10): eine Taste ohne Wirkung am Regler meldet nichts (keine stille Aenderung durch das Runden)
  await js('window.__b.log.length = 0; window.__b.stimmung.setze(0.1049)');
  await kFokus();
  await kRegler.sendKeys('a');
  await kRegler.sendKeys(Key.SHIFT);
  pruefe((await kMeldungen()).length === 0, 'K1: eine Taste ohne Wirkung am Regler meldet bei einem Zwischenwert nichts');

  // ---- L1 (E4k Nachr.): ein frisch gebauter Regler (ohne setze()) meldet ohne Handlung nichts ----
  for (const start of [0.15, 0.1051]) {
    await lade(1280);
    await js('window.__b.baueFrisch(arguments[0])', start);
    await js(`document.querySelector('[data-fall="frisch"] .v-auf-kopf').click()`);
    const reg = await driver.findElement(By.css('[data-fall="frisch"] input[type="range"]'));
    await js('arguments[0].focus()', reg); // Fokus
    for (const t of [Key.SHIFT, Key.CONTROL, 'a', Key.ESCAPE, Key.TAB]) await driver.actions({ async: true }).sendKeys(t).perform();
    await js('arguments[0].focus()', reg);
    await driver.actions({ async: true }).sendKeys(Key.chord(Key.SHIFT, Key.TAB)).perform();
    // Klick auf den Daumen ohne Bewegung (Browser-Pixel aus der Lage des Reglers und dem Wert)
    const p = await js(`const r = arguments[0]; const b = r.getBoundingClientRect(); const a = (Number(r.value) - Number(r.min)) / (Number(r.max) - Number(r.min)); return [b.left + 8 + (b.width - 16) * a, b.top + b.height / 2];`, reg);
    await driver.actions({ async: true }).move({ x: Math.round(p[0]), y: Math.round(p[1]) }).press().release().perform();
    await js('arguments[0].blur()', reg); // Fokusverlust
    const m = await js('return window.__b.log.filter((l) => l.von === "frisch").map((l) => l.wert)');
    pruefe(m.length === 0, `L1 Start ${start}: Fokus, Shift, Strg, Taste ohne Wirkung, Tab, Daumenklick, Fokusverlust melden nichts (gemeldet: ${JSON.stringify(m)})`);
    pruefe((await js(`return document.querySelector('[data-fall="frisch"] .v-wert').textContent`)) === String(start), `L1 Start ${start}: die Anzeige bleibt der gespeicherte Wert`);
  }
} catch (e) {
  console.error('firefox: Fehler', e);
  code = 1;
} finally {
  await driver?.quit().catch(() => {});
  await server?.schliesse().catch(() => {});
}
if (fehler.length) code = 1;
console.log(code === 0 ? 'firefox bausteine: alles gruen' : `firefox bausteine: ${fehler.length} Fehler`);
process.exit(code);
