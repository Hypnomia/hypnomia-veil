// Wegwerf-Spike: Steuerfunktionen. Laufen in steuer.html, im Service Worker (Chrome), in der Hintergrundseite (Firefox)
// und als Content-Script auf der Brueckenseite. Alles in einer Funktion gekapselt, damit keine Namen mit erkenner.js kollidieren.
(() => {
const api = typeof browser !== 'undefined' ? browser : chrome;
// Laeuft in steuer.html, in der Hintergrundseite (Firefox) und als Content-Script auf der Brueckenseite.
const ausgabe = typeof document !== 'undefined' ? document.getElementById('ausgabe') : null;
const zeige = (o) => { if (ausgabe) ausgabe.textContent = JSON.stringify(o, null, 2); };
const jetzt = () => performance.now();
const runde = (x) => Math.round(x * 100) / 100;
const ZONEN = ['eyes', 'mouth', 'face', 'head', 'breast', 'genitals', 'buttocks', 'belly', 'feet', 'armpits'];
const SFW_VERBOTEN = ['breast', 'genitals', 'buttocks', 'belly', 'armpits'];
function median(a) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
function perzentil(a, p) { if (!a.length) return 0; const s = [...a].sort((x, y) => x - y); return s[Math.min(s.length - 1, Math.ceil(p * s.length) - 1)]; }

// Fehlende Empfaenger (Kontext startet gerade) liefern undefined statt einer Ausnahme.
const sende = (n) => (!n.ziel && self.veilBearbeite ? Promise.resolve(self.veilBearbeite(n)) : n.ziel === 'sw' && self.veilBearbeiteSw ? Promise.resolve(self.veilBearbeiteSw(n)) : api.runtime.sendMessage(n)).catch((e) => ({ ok: false, fehler: String(e && e.message ? e.message : e), keinEmpfaenger: true }));
// Wecken mit Wiederholung: der Erkenner laedt erst ORT, dann sein Skript; bis dahin antwortet niemand.
async function wecke() {
  const t0 = jetzt();
  let sw = null;
  let erk = null;
  let versuche = 0;
  while (jetzt() - t0 < 20000) {
    versuche++;
    if (!sw || !sw.ok) sw = await sende({ typ: 'wecke', ziel: 'sw' });
    erk = await sende({ typ: 'wecke' });
    if (erk && erk.ok) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { sw, erkenner: erk, versuche, weckenMs: runde(jetzt() - t0) };
}

// S1 im Erweiterungskontext: Testbilder vom lokalen Messserver pruefen lassen, Treffer gegen Soll zaehlen.
async function messeS1(p = {}) {
  const server = p.server ?? 'http://127.0.0.1:47180';
  const saetze = p.saetze ?? ['nsfw', 'sfw'];
  const liste = (await (await fetch(`${server}/api/bilder`)).json()).filter((b) => saetze.includes(b.satz));
  const bilder = p.max ? liste.slice(0, p.max) : liste;
  const soll = (await (await fetch(`${server}/soll-zonen.json`)).json()).bilder ?? {};
  const w = await wecke();
  if (p.modell || p.backend) await sende({ typ: 'lade', modell: p.modell, backend: p.backend });
  const status0 = await sende({ typ: 'status' });
  const zaehlung = {};
  for (const z of ZONEN) zaehlung[z] = { soll_sichtbar: 0, treffer_sichtbar: 0, treffer_irgendwie: 0, soll_bedeckt: 0, fehlalarm_nsfw: 0, fehlalarm_sfw: 0 };
  const ms = { netz: [], dekod: [], vor: [], inf: [], nach: [], gesamt: [], rundlauf: [] };
  const jeBild = {};
  let kaltstart = null;
  let sfwFehl = 0;
  for (const b of bilder) {
    const t0 = jetzt();
    const a = await sende({ typ: 'pruefeUrl', url: `${server}/bild/${b.satz}/${encodeURIComponent(b.name)}`, kanal: p.kanal, schwelle: p.schwelle });
    const rund = jetzt() - t0;
    const k = `${b.satz}/${b.name}`;
    if (!a || !a.ok) { jeBild[k] = { fehler: a?.fehler ?? a?.status ?? 'keine Antwort' }; continue; }
    if (a.kalt && a.kaltstart) kaltstart = a.kaltstart;
    for (const f of Object.keys(ms)) if (f !== 'rundlauf' && a.ms[f] !== undefined) ms[f].push(a.ms[f]);
    ms.rundlauf.push(rund);
    jeBild[k] = { treffer: a.treffer, ist: a.zonen, ms: a.ms, rundlaufMs: runde(rund), kalt: a.kalt };
    const istS = new Set(a.zonen.sichtbar);
    const istB = new Set(a.zonen.bedeckt);
    if (b.satz === 'sfw') {
      let fehl = false;
      for (const z of istS) if (SFW_VERBOTEN.includes(z)) { zaehlung[z].fehlalarm_sfw++; fehl = true; }
      if (fehl) sfwFehl++;
      continue;
    }
    const s = soll[k];
    if (!s) continue;
    const sollS = new Set(s.sichtbar ?? []);
    const sollB = new Set(s.bedeckt ?? []);
    for (const z of ZONEN) {
      if (sollS.has(z)) { zaehlung[z].soll_sichtbar++; if (istS.has(z)) zaehlung[z].treffer_sichtbar++; if (istS.has(z) || istB.has(z)) zaehlung[z].treffer_irgendwie++; }
      else if (sollB.has(z)) zaehlung[z].soll_bedeckt++;
      else if (istS.has(z)) zaehlung[z].fehlalarm_nsfw++;
    }
  }
  let sollG = 0; let treffG = 0; let fehlN = 0;
  for (const z of SFW_VERBOTEN) { sollG += zaehlung[z].soll_sichtbar; treffG += zaehlung[z].treffer_sichtbar; fehlN += zaehlung[z].fehlalarm_nsfw; }
  const anzahlSfw = bilder.filter((b) => b.satz === 'sfw').length;
  const status1 = await sende({ typ: 'status' });
  const ergebnis = {
    browser: p.browser ?? 'ext', kontext: status1.konfig?.kontext, modell: status1.sessionInfo?.modell, backend: status1.sessionInfo?.genutztesBackend, numThreads: status1.sessionInfo?.numThreads,
    crossOriginIsolated: status1.crossOriginIsolated, gpu: status1.gpu, kanal: p.kanal ?? status1.konfig?.kanal ?? 'rgb', schwelle: p.schwelle ?? status1.konfig?.schwelle ?? 0.2,
    wecken: w, instanzVorher: status0.instanz, instanzNachher: status1.instanz, kaltstartInDiesemLauf: kaltstart, sessionZeiten: status1.sessionInfo?.zeiten,
    anzahl: ms.inf.length, anzahlSfw,
    netzMedianMs: runde(median(ms.netz)), dekodMedianMs: runde(median(ms.dekod)), vorMedianMs: runde(median(ms.vor)),
    infMedianMs: runde(median(ms.inf)), infP90Ms: runde(perzentil(ms.inf, 0.9)), infP95Ms: runde(perzentil(ms.inf, 0.95)), nachMedianMs: runde(median(ms.nach)),
    gesamtMedianMs: runde(median(ms.gesamt)), rundlaufMedianMs: runde(median(ms.rundlauf)), rundlaufP90Ms: runde(perzentil(ms.rundlauf, 0.9)),
    bilderProSekunde: runde(1000 / (median(ms.rundlauf) || 1)),
    koerperzonen: { soll_sichtbar: sollG, treffer_sichtbar: treffG, verpasst_prozent: sollG ? runde(100 * (1 - treffG / sollG)) : null, fehlalarm_nsfw: fehlN, sfw_bilder_mit_fehlalarm: sfwFehl, sfw_bilder_mit_fehlalarm_prozent: anzahlSfw ? runde(100 * sfwFehl / anzahlSfw) : null },
    zonen: Object.fromEntries(ZONEN.map((z) => [z, { ...zaehlung[z], verpasst_prozent: zaehlung[z].soll_sichtbar ? runde(100 * (1 - zaehlung[z].treffer_sichtbar / zaehlung[z].soll_sichtbar)) : null }])),
    jeBild,
  };
  try {
    const r = await fetch(`${server}/api/ergebnis`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...ergebnis, backend: `ext-${ergebnis.backend}` }) });
    ergebnis.datei = (await r.json()).datei;
  } catch (e) { ergebnis.datei = `POST-Fehler ${e}`; }
  const kurz = { ...ergebnis };
  delete kurz.jeBild;
  zeige(kurz);
  return kurz;
}

// Kaltstart nach Leerlauf: ein Bild pruefen, warten, wieder pruefen. Instanz-Wechsel zeigt den Neustart des Kontexts.
async function kaltstart(p = {}) {
  const server = p.server ?? 'http://127.0.0.1:47180';
  const url = p.url ?? `${server}/bild/sfw/${encodeURIComponent(p.bild ?? 'sfw-001-portraet.jpg')}`;
  const schritte = [];
  async function schritt(name) {
    const t0 = jetzt();
    const w = await wecke();
    const t1 = jetzt();
    const a = await sende({ typ: 'pruefeUrl', url });
    const t2 = jetzt();
    schritte.push({ name, weckenMs: runde(t1 - t0), weckVersuche: w.versuche, swInstanz: w.sw?.swInstanz, offscreen: w.sw?.offscreen, antwortMs: runde(t2 - t1), gesamtMs: runde(t2 - t0), instanz: a?.instanz, kalt: a?.kalt, kaltstart: a?.kaltstart, ms: a?.ms, ok: a?.ok, fehler: a?.fehler });
  }
  await schritt('erster');
  await schritt('warm');
  const warten = p.wartenMs ?? 35000;
  await new Promise((r) => setTimeout(r, warten));
  await schritt(`nach ${warten} ms Leerlauf`);
  await schritt('warm danach');
  if (p.schliessen) {
    const g = await sende({ typ: 'schliesseOffscreen', ziel: 'sw' }).catch((e) => ({ fehler: String(e) }));
    schritte.push({ name: 'offscreen geschlossen', g });
    await schritt('nach Schliessen');
  }
  const e = { wartenMs: warten, schritte };
  zeige(e);
  return e;
}

// S2: Adressen aus einem Tab einsammeln und im Erkenner holen (Varianten Referer / Cookies).
async function sammleTab(p) {
  p = p ?? {};
  const tabs = await api.tabs.query({});
  const tab = p.tabId ? tabs.find((t) => t.id === p.tabId) : p.url ? tabs.find((t) => t.url && t.url.startsWith(p.url.split('?')[0])) : tabs.find((t) => t.active);
  if (!tab) return { fehler: 'Tab nicht gefunden', tabs: tabs.map((t) => t.url) };
  if (p.nurId) return { tabId: tab.id, url: tab.url };
  return { tabId: tab.id, url: tab.url, ...(await api.tabs.sendMessage(tab.id, { typ: 'sammle', ziel: 'inhalt', max: p.max ?? 50 }, { frameId: 0 })) };
}
async function holeListe(p) {
  await wecke();
  const varianten = p.varianten ?? [{ name: 'ohne', credentials: 'omit' }, { name: 'mit-cookies', credentials: 'include' }, ...(p.seitenReferer ? [{ name: 'referer-gesetzt', credentials: 'omit', referer: p.seitenReferer }, { name: 'referer-und-cookies', credentials: 'include', referer: p.seitenReferer }] : [])];
  const aus = {};
  for (const v of varianten) {
    // Referer der Erweiterungs-Abrufe setzen (Chrome: DNR-Sitzungsregel, Firefox: webRequest) oder entfernen.
    const regel = await sende({ typ: 'setzeReferer', ziel: 'sw', referer: v.referer ?? null });
    const r = await sende({ typ: 'hole', urls: p.urls, credentials: v.credentials, cache: p.cache ?? 'no-store', parallel: p.parallel ?? 6, dekod: p.dekod ?? true, S: p.S ?? 320 });
    r.regel = regel;
    const stat = {};
    for (const e of r.ergebnisse) { const k = e.fehler ? 'fehler' : String(e.status); stat[k] = (stat[k] ?? 0) + 1; }
    aus[v.name] = { gueltig: !!(r.regel && r.regel.ok), regel: r.regel, gesamtMs: r.gesamtMs, anzahl: r.anzahl, statusVerteilung: stat, verweigert: r.ergebnisse.filter((e) => e.fehler || e.status >= 400).length, netzMedianMs: runde(median(r.ergebnisse.map((e) => e.netzMs ?? 0))), netzP95Ms: runde(perzentil(r.ergebnisse.map((e) => e.netzMs ?? 0), 0.95)), dekodMedianMs: runde(median(r.ergebnisse.filter((e) => e.dekodMs).map((e) => e.dekodMs))), bytesGesamt: r.ergebnisse.reduce((s, e) => s + (e.bytes ?? 0), 0), bilderProSekunde: r.gesamtMs ? runde(1000 * r.anzahl / r.gesamtMs) : null, hosts: Object.fromEntries(Object.entries(r.ergebnisse.reduce((m, e) => { m[e.host] = (m[e.host] ?? 0) + 1; return m; }, {}))), fehler: r.ergebnisse.filter((e) => e.fehler).slice(0, 5).map((e) => e.fehler) };
  }
  // Referer-Regel wieder entfernen, sonst traegt jeder spaetere Abruf den Referer der letzten Seite.
  await sende({ typ: 'setzeReferer', ziel: 'sw', referer: null });
  return aus;
}
async function messeS2(p = {}) {
  const gesammelt = await sammleTab({ tabId: p.tabId, url: p.tabId ? undefined : p.url, max: p.max ?? 50 });
  if (gesammelt.fehler) return gesammelt;
  const urls = gesammelt.bilder.map((b) => b.url);
  const ergebnis = {
    seite: (() => { try { return new URL(gesammelt.url).host; } catch { return '?'; } })(),
    gueltig: gesammelt.bilder.length > 0 || gesammelt.videos.length > 0, bilderGefunden: gesammelt.bilder.length, bilderImShadow: gesammelt.bilderImShadow ?? 0, sichtbare: gesammelt.bilder.filter((b) => b.sichtbar).length,
    canvasLesbar: gesammelt.bilder.filter((b) => b.canvas?.lesbar).length, canvasGesperrt: gesammelt.bilder.filter((b) => b.canvas && !b.canvas.lesbar).length,
    bildHosts: Object.entries(gesammelt.bilder.reduce((m, b) => { const h = (() => { try { return new URL(b.url).host; } catch { return '?'; } })(); m[h] = (m[h] ?? 0) + 1; return m; }, {})),
    videos: gesammelt.videos.map((v) => ({ art: v.art, host: v.host, breite: v.breite, readyState: v.readyState, canvas: v.canvas })),
    shadowGefunden: gesammelt.shadowGefunden, frames: gesammelt.frames, roh: { tabId: gesammelt.tabId, tabUrl: gesammelt.url, felder: Object.keys(gesammelt) },
    varianten: urls.length ? await holeListe({ urls, seitenReferer: (() => { try { return new URL(gesammelt.url).origin + '/'; } catch { return null; } })(), dekod: true, S: p.S ?? 320 }) : null,
  };
  if (p.videoBild && gesammelt.videos.some((v) => v.url)) {
    const v = gesammelt.videos.find((x) => x.url);
    ergebnis.videoBildErkenner = await sende({ typ: 'videoBild', url: v.url, zeit: 0.5 });
  }
  if (p.videoPixel && gesammelt.videos.length) {
    ergebnis.videoPixel = await api.tabs.sendMessage(gesammelt.tabId, { typ: 'videoPixel', ziel: 'inhalt', index: p.videoIndex ?? 0, S: p.S ?? 320 }, { frameId: 0 });
  }
  if (p.speichern !== false) {
    try {
      const r = await fetch(`${p.server ?? 'http://127.0.0.1:47180'}/api/ergebnis-s2`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ browser: p.browser ?? 'ext', ...ergebnis }) });
      ergebnis.datei = (await r.json()).datei;
    } catch (e) { ergebnis.datei = `POST-Fehler ${e}`; }
  }
  zeige(ergebnis);
  return ergebnis;
}
async function freigabenVonTab(p) {
  return api.tabs.sendMessage(p.tabId, { typ: 'freigaben', ziel: 'inhalt' }, { frameId: 0 });
}

async function status() { await wecke(); const s = await sende({ typ: 'status' }); zeige(s); return s; }
const G = typeof window !== 'undefined' ? window : self;
G.veil = { wecke, messeS1, kaltstart, sammleTab, holeListe, messeS2, freigabenVonTab, status, sende };
if (ausgabe) document.documentElement.dataset.bereit = '1';
})();
