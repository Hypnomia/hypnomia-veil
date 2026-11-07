// Nutzerweg mit signierter XPI (Phase 8, Speicher): ohne geckodriver, nur adb und uiautomator, im normalen Profil von Firefox fuer Android.
//   VEIL_ECHTES_PACK=<pfad> node tests/android/nutzerweg.mjs --xpi <signierte xpi>
// Ablauf: Firefox frisch starten, Debug-Menue freischalten (Einstellungen, About, fuenfmal Logo), "Install extension from file", Einstieg
// (I understand, Yes both, I agree, Mias Wahl), Pack ueber "All settings" importieren, Firefox beenden (am force-stop) und neu starten,
// dann pruefen, dass Pack und Einstieg noch da sind. Fotos nach ../03 Recherche/emulator/phase8-nutzerweg-*.png.
// Der Firefox-Willkommensdialog wird im Emulator weggetippt (Entscheidung 152).
import { existsSync } from 'node:fs';
import path from 'node:path';
import * as L from './lib.mjs';

const argv = process.argv.slice(2);
const xpi = argv[argv.indexOf('--xpi') + 1];
const pack = process.env.VEIL_ECHTES_PACK;
if (!xpi || !existsSync(xpi) || !pack || !existsSync(pack)) {
  console.error('Aufruf: VEIL_ECHTES_PACK=<pfad> node tests/android/nutzerweg.mjs --xpi <signierte xpi>');
  process.exit(2);
}
setTimeout(() => {
  console.error('nutzerweg: Zeitlimit 12 min');
  process.exit(1);
}, 12 * 60_000).unref();

const ergebnis = { start: new Date().toISOString(), schritte: [] };
const schritt = (name, daten = {}) => {
  ergebnis.schritte.push({ name, t: Date.now(), ...daten });
  console.log(`nutzerweg: ${name} ${JSON.stringify(daten)}`);
};
const sichtbar = () => L.leseOberflaeche().map((n) => n.text || n.beschreibung).filter(Boolean);
async function bisText(re, frist = 20_000) {
  const t0 = Date.now();
  while (Date.now() - t0 < frist) {
    const k = L.leseOberflaeche();
    if (L.pruefeKeinDialog(k)) {
      await L.raeumeFirefoxDialogeWeg();
      continue;
    }
    const n = L.finde(k, re)[0];
    if (n) return n;
    await L.warte(500);
  }
  throw new Error(`nicht gefunden: ${re} (sichtbar: ${sichtbar().slice(0, 25).join(' | ')})`);
}
async function tippeText(re, frist) {
  const n = await bisText(re, frist);
  L.tippe(n.mx, n.my);
  await L.warte(900);
  return n;
}
async function rolleBis(re, max = 8) {
  for (let i = 0; i < max; i++) {
    const n = L.finde(L.leseOberflaeche(), re)[0];
    if (n) return n;
    L.wischeHoch();
    await L.warte(700);
  }
  throw new Error(`beim Rollen nicht gefunden: ${re}`);
}
const starteFirefox = async () => {
  L.shell(`am start -n ${L.paketName}/.App`);
  await L.warte(3000);
  await L.raeumeFirefoxDialogeWeg();
};
const menue = () => tippeText((n) => /^More options$/.test(n.beschreibung) && n.my < 400);
// Zurueck aus Einstellungen und Erweiterungsseiten in die Browser-Ansicht (Werkzeugleiste mit Tab-Zaehler sichtbar).
async function zurueckZumBrowser() {
  for (let i = 0; i < 6; i++) {
    const k = L.leseOberflaeche();
    if (k.some((n) => n.id === 'ADDRESSBAR_TABS_COUNTER' || /Tabs Open: \d+\. Tap to switch/.test(n.beschreibung))) return;
    L.zurueckTaste();
    await L.warte(800);
  }
  L.shell(`am start -n ${L.paketName}/.App`);
  await L.warte(1500);
}
// Tab mit passendem Titel ueber die Tab-Uebersicht nach vorn holen.
async function zuTab(re) {
  const z = L.leseOberflaeche().find((n) => n.id === 'ADDRESSBAR_TABS_COUNTER' || /Tabs Open: \d+\. Tap to switch/.test(n.beschreibung));
  if (z) {
    L.tippe(z.mx, z.my);
    await L.warte(1200);
  }
  await tippeText((n) => re.test(n.text) && !/^Close tab/.test(n.beschreibung), 15_000);
  await L.warte(1200);
}

let code = 0;
try {
  const xpiName = `hypnomia-veil-${path.basename(xpi).replace(/^.*-(\d+\.\d+\.\d+)\.xpi$/, '$1')}.xpi`;
  L.adb('push', xpi, `/sdcard/Download/${xpiName}`);
  L.adb('push', pack, '/sdcard/Download/mia-pack-0.7.0.miapack');
  // Frisches Firefox im Testhandy (wie geckodriver bei jedem Start): App-Daten loeschen, dann kommt der Willkommensdialog (Entscheidung 152).
  L.shell(`am force-stop ${L.paketName}`);
  L.shell(`pm clear ${L.paketName}`);
  await starteFirefox();
  schritt('firefox-gestartet');
  // Debug-Menue: Einstellungen, About Firefox, fuenfmal Logo
  await menue();
  await tippeText(/^Settings$/);
  await rolleBis(/^About Firefox$/);
  await tippeText(/^About Firefox$/);
  await L.warte(1000);
  const logo = L.leseOberflaeche().filter((n) => /ImageView/.test(n.klasse) && n.my < 1200).sort((a, b) => (b.x2 - b.x1) * (b.y2 - b.y1) - (a.x2 - a.x1) * (a.y2 - a.y1))[0];
  if (!logo) throw new Error('Logo in About Firefox nicht gefunden');
  for (let i = 0; i < 5; i++) {
    L.tippe(logo.mx, logo.my);
    await L.warte(150);
  }
  await L.warte(800);
  L.zurueckTaste();
  await L.warte(800);
  await rolleBis(/Install extension from file/i);
  await tippeText(/Install extension from file/i);
  schritt('debug-menue');
  // Dateiwaehler: Downloads, XPI
  const t0 = Date.now();
  while (Date.now() - t0 < 30_000) {
    const k = L.leseOberflaeche();
    const d = L.finde(k, xpiName)[0];
    if (d) {
      L.tippe(d.mx, d.my);
      break;
    }
    const dl = L.finde(k, /^Downloads?$/)[0] ?? L.finde(k, /Show roots/)[0];
    if (dl) L.tippe(dl.mx, dl.my);
    await L.warte(1200);
  }
  L.foto('nutzerweg', 'installieren-frage');
  await tippeText(/^Add$/, 30_000);
  schritt('installiert-bestaetigt');
  await L.warte(2000);
  L.foto('nutzerweg', 'installiert');
  const ok = L.finde(L.leseOberflaeche(), /^(OK|Okay|Got it)$/)[0];
  if (ok) L.tippe(ok.mx, ok.my);
  await L.warte(800);
  // Einstellungen verlassen, dann die Willkommensseite ueber die Tab-Uebersicht nach vorn holen
  await zurueckZumBrowser();
  await zuTab(/HYPNOMIA VEIL: Welcome/);
  // Einstieg: die Release-Erweiterung oeffnet die Willkommensseite selbst
  await bisText(/^I understand$/, 30_000).catch(() => rolleBis(/^I understand$/));
  await rolleBis(/^I understand$/);
  await tippeText(/^I understand$/);
  await bisText(/^Yes, both$|^I’m 18 or older/, 30_000).catch(() => rolleBis(/^Yes, both$|^I’m 18 or older/));
  await rolleBis(/^Yes, both$|^I’m 18 or older/);
  await tippeText(/^Yes, both$|^I’m 18 or older/);
  await bisText(/^I agree$/, 30_000).catch(() => rolleBis(/^I agree$/));
  await rolleBis(/^I agree$/);
  await tippeText(/^I agree$/);
  L.foto('nutzerweg', 'interview');
  await bisText(/^Skip the rest$|Mia’s choices/, 30_000).catch(() => rolleBis(/^Skip the rest$|Mia’s choices/));
  await rolleBis(/^Skip the rest$|Mia’s choices/);
  await tippeText(/^Skip the rest$|Mia’s choices/);
  await L.warte(1500);
  L.foto('nutzerweg', 'einstieg-ende');
  schritt('einstieg');
  // Pack ueber "Add the Mia Pack" auf der Abschlussseite (oeffnet die Einstellungsseite am Pack-Abschnitt)
  await tippeText(/^Add the Mia Pack$/);
  await L.warte(1500);
  await rolleBis(/Browse|No file selected/, 20);
  await tippeText(/Browse|No file selected/);
  const t1 = Date.now();
  while (Date.now() - t1 < 30_000) {
    const k = L.leseOberflaeche();
    const d = L.finde(k, 'mia-pack-0.7.0.miapack')[0];
    if (d) {
      L.tippe(d.mx, d.my);
      break;
    }
    const dl = L.finde(k, /^Downloads?$/)[0] ?? L.finde(k, /Show roots/)[0];
    if (dl) L.tippe(dl.mx, dl.my);
    await L.warte(1200);
  }
  await rolleBis(/^Accept and add$/);
  await tippeText(/^Accept and add$/);
  await bisText(/Pack in place|The pack is in/, 60_000);
  L.foto('nutzerweg', 'pack-importiert');
  schritt('pack-importiert');
  // Neustart von Firefox
  L.shell(`am force-stop ${L.paketName}`);
  await L.warte(1500);
  await starteFirefox();
  schritt('neu-gestartet');
  await menue();
  await tippeText((n) => /^Extensions\b/.test(n.text || n.beschreibung));
  await tippeText(/^HYPNOMIA VEIL$/);
  await L.warte(1500);
  const popupTexte = sichtbar();
  L.foto('nutzerweg', 'popup-nach-neustart');
  // Das Popup nennt mit Pack "Mia patch uses N of my pictures from the Mia Pack", ohne Pack "Add the Mia Pack" (Stil-Hinweis).
  const packDa = popupTexte.some((t) => /Mia patch uses \d+ of my pictures/.test(t));
  const einstiegDa = !popupTexte.some((t) => /finish setting me up|Welcome/i.test(t));
  schritt('nach-neustart', { packDa, einstiegDa, popup: popupTexte.slice(0, 12) });
  if (!packDa) code = 1;
} catch (e) {
  code = 1;
  console.error('nutzerweg: Abbruch', e?.message ?? e);
  try {
    L.foto('nutzerweg', 'fehler');
  } catch {}
} finally {
  console.log(`nutzerweg: Ergebnis ${L.schreibeErgebnis({ nutzerweg: ergebnis })}`);
}
process.exit(code);
