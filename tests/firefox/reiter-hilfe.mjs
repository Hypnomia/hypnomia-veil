// Hilfe fuer die Firefox-Tests der Einstellungsseite (Phase 11 E4d1): seit den sieben Reitern ist nur der gewaehlte Reiter sichtbar. Wer ein Element
// mit echten WebDriver-Handlungen (Klick, Tasten) bedient, bekommt vorher den Reiter geoeffnet, in dem das Element liegt, mit einem Klick auf den
// Reiter, so wie die Person es tut. `mitReitern` ersetzt dazu `driver.findElement`; auf allen anderen Seiten (Popup, Willkommen, Hilfe) tut es nichts.
// Pruefungen (Sichtbarkeit, Lage) oeffnen keinen Reiter: wer sie braucht, ruft `oeffneReiterFuer` oder `oeffneReiter` selbst.

import { WebElementPromise } from 'selenium-webdriver';

export async function oeffneReiter(driver, name) {
  await driver.executeScript(
    `const t = [...document.querySelectorAll('[role=tab]')].find((e) => e.textContent === arguments[0]); if (t && t.getAttribute('aria-selected') !== 'true') t.click();`,
    name,
  );
}

// Oeffnet den Reiter des ersten Elements, das zum CSS-Selektor passt (nichts, wenn es keinen Reiter gibt oder das Element fehlt).
export async function oeffneReiterFuer(driver, css) {
  await driver.executeScript(
    `const e = document.querySelector(arguments[0]); const p = e && e.closest && e.closest('[role=tabpanel]'); if (p && p.hidden) document.getElementById(p.getAttribute('aria-labelledby')).click();`,
    css,
  );
}

export function mitReitern(driver) {
  const echt = driver.findElement.bind(driver);
  // Eine WebElementPromise bleibt es, damit `driver.findElement(...).click()` und `.getAttribute(...)` wie gewohnt gehen.
  driver.findElement = (by) =>
    new WebElementPromise(
      driver,
      echt(by).then(async (element) => {
        await driver.executeScript(
          `const p = arguments[0].closest && arguments[0].closest('[role=tabpanel]'); if (p && p.hidden) document.getElementById(p.getAttribute('aria-labelledby')).click();`,
          element,
        );
        return element;
      }),
    );
  return driver;
}

// ---------- Bedienelemente aus den Bausteinen (Phase 11 E4d2) ----------
// Jeder Baustein hat die Wurzel mit einer festen id (`stimmung-wahl`, `zonen-wahl`, `kleidung-frage`, `erw-stufe-wahl`, `verweigern-wahl`,
// `freilegen-wahl`, `lautstaerke-wahl`). Echte WebDriver-Klicks (kein element.click() im Seitenskript); `mitReitern(driver)` oeffnet vorher den Reiter.
import { By } from 'selenium-webdriver';

// Eine Person scrollt das Ziel ins Bild, bevor sie es drueckt; die klebende Leiste oben soll es nicht verdecken (der Treiber richtet es sonst am oberen Rand aus).
const insBild = (driver, el) => driver.executeScript(`arguments[0].scrollIntoView({ block: 'center' })`, el);
export async function oeffneAuf(driver, wahl) {
  const kopf = await driver.findElement(By.css(`#${wahl} .v-aufklapper .v-auf-kopf`));
  await insBild(driver, kopf);
  if ((await kopf.getAttribute('aria-expanded')) !== 'true') await kopf.click();
}
// Klickt die Stufe oder Karte mit diesem Namen.
export const stufeKlick = async (driver, wahl, name) => {
  const k = await driver.findElement(By.xpath(`//*[@id='${wahl}']//*[@role='radio'][normalize-space(.)='${name}' or ./strong[normalize-space(.)='${name}']]`));
  await insBild(driver, k);
  await k.click();
};
export const chipKlick = async (driver, zone) => {
  await oeffneAuf(driver, 'zonen-wahl');
  const c = await driver.findElement(By.css(`#zonen-wahl .v-chip[data-zone="${zone}"]`));
  await insBild(driver, c);
  await c.click();
};
// Der Text der markierten Karte oder Stufe (oder null).
export const markierteKarte = (driver, wahl) =>
  driver.executeScript(`const k = document.querySelector('#' + arguments[0] + ' [role=radio][aria-checked=true]'); return k ? k.textContent : null`, wahl);
export const reglerCss = (wahl) => `#${wahl} input[type=range]`;
