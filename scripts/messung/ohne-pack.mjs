// Messwerkzeug Phase 4 (kein Produktcode): ohne Pack auf dem Nachbau erwachsen-pornhub.html (Testdomain) kein Vorschau-Tausch und kein Riegel.
//   VEIL_AUSGABE=.output-messung VEIL_FIXTURE_PORT=47333 node scripts/messung/ohne-pack.mjs
import { starteFixtureServer } from '../../tests/fixtures-server.mjs';
import { warte } from './hilfe.mjs';
import { starteChromiumMitPack, starteFirefoxMitPack } from './pack-browser.mjs';

const port = Number(process.env.VEIL_FIXTURE_PORT ?? 47333);
const URL_ = `http://pornhub.veil-erwachsen.test:${port}/erwachsen-pornhub.html`;
const server = await starteFixtureServer(port);
const PRUEFE = `
await new Promise((r) => setTimeout(r, 2500));
const ids = [1, 2, 3, 4, 5, 6].map((i) => 'v' + i);
const bilder = ids.map((id) => { const e = document.getElementById(id); return { veil: e.getAttribute('data-veil'), orig: /^\\/synthetisch\\//.test(e.getAttribute('src') || ''), ersetztMarke: e.hasAttribute('data-veil-ersetzt') }; });
document.dispatchEvent(new CustomEvent('veil-test', { detail: JSON.stringify({ riegel: { oeffne: { frage: 'test-w1' } } }) }));
await new Promise((r) => setTimeout(r, 3000));
return { bilder, erwachsen: document.documentElement.getAttribute('data-veil-erwachsen'), ergebnis: document.documentElement.getAttribute('data-veil-riegel-ergebnis'), abbild: document.documentElement.getAttribute('data-veil-riegel'), hostDa: document.querySelector('[data-veil-riegel-host]') !== null, aufblitzen: window.__aufblitzen };`;
const aus = {};
try {
  const c = await starteChromiumMitPack({ hostRegeln: ['MAP *.veil-erwachsen.test 127.0.0.1'] });
  try {
    await c.warteAufErkenner();
    const s = await c.context.newPage();
    await s.goto(URL_);
    aus.chromium = { version: c.version, testdomain: await s.evaluate(`(async()=>{${PRUEFE}})()`) };
    await s.goto(`http://127.0.0.1:${port}/erwachsen-pornhub.html`);
    await s.waitForFunction(() => document.documentElement.hasAttribute('data-veil-status'), null, { timeout: 15_000 });
    aus.chromium.haken = await s.evaluate(`(async()=>{${PRUEFE}})()`);
  } finally {
    await c.schliesse();
  }
  const f = await starteFirefoxMitPack({ hosts: ['pornhub.veil-erwachsen.test'] });
  try {
    await f.driver.get(URL_);
    const lauf = async () => JSON.parse(await f.driver.executeAsyncScript(`const done = arguments[arguments.length - 1]; (async()=>{${PRUEFE}})().then((w) => done(JSON.stringify(w)));`));
    aus.firefox = { version: f.version, testdomain: await lauf() };
    await f.driver.get(`http://127.0.0.1:${port}/erwachsen-pornhub.html`);
    for (let i = 0; i < 100; i++) {
      if (await f.driver.executeScript("return document.documentElement.hasAttribute('data-veil-status')")) break;
      await warte(150);
    }
    aus.firefox.haken = await lauf();
  } finally {
    await f.schliesse();
  }
} finally {
  server.close?.();
}
console.log(JSON.stringify(aus, null, 1));
process.exit(0);
