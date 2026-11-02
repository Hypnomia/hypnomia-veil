// WEGWERF-Messcode (Spike S2/S3): laedt videos.html und bilder.html in Playwright-Chromium (headless)
// und meldet je Element, ob die Seite selbst die Pixel lesen kann (getImageData nach drawImage).
// Das ist die Grundlinie ohne Erweiterung. Start: node spike/s2-s3-fremd/pruefe-seiten.mjs
import { chromium } from '@playwright/test';
import { starteS2Server } from './server.mjs';

const s = await starteS2Server({ stumm: true });
const haupt = `http://127.0.0.1:${s.port}`;
const browser = await chromium.launch({ channel: 'chromium' });
try {
  const seite = await (await browser.newContext()).newPage();
  const fehlerKonsole = [];
  seite.on('console', (m) => { if (m.type() === 'error') fehlerKonsole.push(m.text()); });

  // Hilfsfunktion im Seitenkontext: Pixel lesen versuchen, Fehlername liefern.
  const lese = `(el) => {
    try {
      const c = document.createElement('canvas'); c.width = 16; c.height = 16;
      const g = c.getContext('2d'); g.drawImage(el, 0, 0, 16, 16); g.getImageData(0, 0, 16, 16);
      return { wirft: false, fehler: null };
    } catch (e) { return { wirft: true, fehler: e.name }; }
  }`;

  await seite.goto(`${haupt}/videos.html`);
  await seite.waitForTimeout(2000);
  const videos = await seite.evaluate(`[...document.querySelectorAll('video')].map((v) => {
    const l = (${lese})(v);
    return { fall: v.dataset.fall, readyState: v.readyState, videoWidth: v.videoWidth, blob: v.src.startsWith('blob:'), paused: v.paused, error: v.error ? v.error.code : null, getImageDataWirft: l.wirft, fehler: l.fehler };
  })`);
  const mse = await seite.evaluate('window.__mseStatus');
  console.log('VIDEOS (nach 2 s), MSE-Status:', mse);
  console.table(videos);

  await seite.goto(`${haupt}/bilder.html`);
  await seite.waitForTimeout(5000);
  const bilder = await seite.evaluate(`[...document.querySelectorAll('img')].map((i) => {
    const l = (${lese})(i);
    return { fall: i.dataset.fall, complete: i.complete, naturalWidth: i.naturalWidth, getImageDataWirft: l.wirft, fehler: l.fehler };
  })`);
  console.log('BILDER (nach 5 s)');
  console.table(bilder);

  // Zweiter Durchgang: Cookie setzen (gilt fuer beide Ports, Cookies kennen keine Ports), Seite neu laden.
  await seite.goto(`${haupt}/setze-cookie`);
  await seite.goto(`${haupt}/bilder.html`);
  await seite.waitForTimeout(3000);
  const mitCookie = await seite.evaluate(`[...document.querySelectorAll('img[data-fall^="cookie"]')].map((i) => {
    const l = (${lese})(i);
    return { fall: i.dataset.fall, naturalWidth: i.naturalWidth, getImageDataWirft: l.wirft, fehler: l.fehler };
  })`);
  console.log('COOKIE-BILDER nach /setze-cookie');
  console.table(mitCookie);
  if (fehlerKonsole.length) console.log('Konsolenfehler:', [...new Set(fehlerKonsole)]);
} finally {
  await browser.close();
  await s.schliessen();
}
