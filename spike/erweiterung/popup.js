// Wegwerf-Spike: Popup fuer den Lauf, den der Inhaber selbst startet (Entscheidung 49).
// Speichert keine Bilder: nur Hosts, Statuscodes, Bytes und Zeiten gehen an den lokalen Messserver.
const api = typeof browser !== 'undefined' ? browser : chrome;
const aus = document.getElementById('ausgabe');
document.getElementById('messen').addEventListener('click', async () => {
  aus.textContent = 'Measuring...';
  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const t0 = performance.now();
    let erk = null;
    while (performance.now() - t0 < 20000) {
      try { await api.runtime.sendMessage({ typ: 'wecke', ziel: 'sw' }); erk = await api.runtime.sendMessage({ typ: 'wecke' }); } catch { erk = null; }
      if (erk && erk.ok) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const g = await api.tabs.sendMessage(tab.id, { typ: 'sammle', ziel: 'inhalt', max: 50 }, { frameId: 0 });
    const urls = g.bilder.map((b) => b.url);
    const varianten = {};
    for (const v of [{ name: 'ohne', credentials: 'omit' }, { name: 'mit-cookies', credentials: 'include' }]) {
      const r = await api.runtime.sendMessage({ typ: 'hole', urls, credentials: v.credentials, parallel: 6, dekod: true, S: 320 });
      const stat = {};
      for (const e of r.ergebnisse) { const k = e.fehler ? 'fehler' : String(e.status); stat[k] = (stat[k] ?? 0) + 1; }
      varianten[v.name] = { gesamtMs: r.gesamtMs, anzahl: r.anzahl, statusVerteilung: stat, verweigert: r.ergebnisse.filter((e) => e.fehler || e.status >= 400).length, bytesGesamt: r.ergebnisse.reduce((s, e) => s + (e.bytes ?? 0), 0), fehler: r.ergebnisse.filter((e) => e.fehler).slice(0, 5).map((e) => e.fehler), hosts: r.ergebnisse.reduce((m, e) => { m[e.host] = (m[e.host] ?? 0) + 1; return m; }, {}) };
    }
    let videoBild = null;
    const direkt = g.videos.find((v) => v.url);
    if (direkt) videoBild = await api.runtime.sendMessage({ typ: 'videoBild', url: direkt.url, zeit: 0.5 });
    const ergebnis = {
      browser: 'live-' + (navigator.userAgent.includes('Firefox') ? 'firefox' : 'chrome'),
      seite: new URL(tab.url).host,
      bilderGefunden: g.bilder.length, sichtbare: g.bilder.filter((b) => b.sichtbar).length,
      canvasLesbar: g.bilder.filter((b) => b.canvas?.lesbar).length, canvasGesperrt: g.bilder.filter((b) => b.canvas && !b.canvas.lesbar).length,
      bildHosts: g.bilder.reduce((m, b) => { let h = '?'; try { h = new URL(b.url).host; } catch { /* egal */ } m[h] = (m[h] ?? 0) + 1; return m; }, {}),
      videos: g.videos.map((v) => ({ art: v.art, host: v.host, breite: v.breite, hoehe: v.hoehe, readyState: v.readyState, crossorigin: v.crossorigin, canvas: v.canvas })),
      videoBildErkenner: videoBild, shadowGefunden: g.shadowGefunden, frames: g.frames, varianten,
    };
    const r = await fetch('http://127.0.0.1:47180/api/ergebnis-s2', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(ergebnis) });
    ergebnis.datei = (await r.json()).datei;
    aus.textContent = JSON.stringify(ergebnis, null, 1);
  } catch (e) {
    aus.textContent = `Error: ${e && e.message ? e.message : e}`;
  }
});
