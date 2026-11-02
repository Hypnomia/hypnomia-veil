// Wegwerf-Spike: Bruecke fuer WebDriver. Laeuft nur auf 127.0.0.1-Seiten als Content-Script.
// Die Seite loest ein Ereignis "veil-befehl" aus (detail = JSON mit id, fn, params); die Antwort landet als
// data-veil-antwort-<id> am html-Element. Firefox-WebDriver kann so Erweiterungsfunktionen ohne moz-extension-Seite aufrufen.
(() => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const HINTERGRUND = new Set(['messeS2', 'sammleTab', 'freigabenVonTab']);
  window.addEventListener('veil-befehl', async (e) => {
    let b;
    try { b = JSON.parse(typeof e.detail === 'string' ? e.detail : JSON.stringify(e.detail)); } catch { return; }
    let r;
    console.log('veil-bruecke: befehl', b.fn, typeof window.veil);
    try {
      if (HINTERGRUND.has(b.fn)) r = await api.runtime.sendMessage({ typ: 'steuer', fn: b.fn, params: b.params });
      else r = await window.veil[b.fn](b.params);
    } catch (err) { r = { fehler: String(err && err.message ? err.message : err) }; }
    console.log('veil-bruecke: antwort', b.fn, JSON.stringify(r ?? null).slice(0, 200));
    document.documentElement.setAttribute(`data-veil-antwort-${b.id}`, JSON.stringify(r ?? null));
  });
  document.documentElement.dataset.veilBruecke = '1';
})();
