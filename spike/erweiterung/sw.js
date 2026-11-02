// Wegwerf-Spike, Chrome: Service Worker. Sorgt nur dafuer, dass das Offscreen-Dokument existiert,
// und beantwortet "wecke". Alles andere beantwortet das Offscreen-Dokument selbst (erkenner.js).
importScripts('steuer.js');
const SW_INSTANZ = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
let erzeugen = null;

async function stelleOffscreenSicher() {
  const vorhandene = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
  if (vorhandene.length > 0) return 'vorhanden';
  if (!erzeugen) {
    erzeugen = chrome.offscreen.createDocument({
      url: 'offscreen.html',
      reasons: ['WORKERS', 'BLOBS'],
      justification: 'Image checking with a local model',
    }).finally(() => { erzeugen = null; });
  }
  await erzeugen;
  return 'erzeugt';
}

chrome.runtime.onInstalled.addListener(() => { stelleOffscreenSicher().catch(() => {}); registriere().catch(() => {}); });
chrome.runtime.onStartup.addListener(() => { stelleOffscreenSicher().catch(() => {}); });

// Strategie B: Schleier-CSS zur Laufzeit registrieren statt im Manifest.
async function registriere() {
  const k = await (await fetch(chrome.runtime.getURL('konfig.json'))).json();
  if (k.strategie !== 'b') return;
  const vorhandene = await chrome.scripting.getRegisteredContentScripts({ ids: ['veil-schleier'] }).catch(() => []);
  if (vorhandene.length) await chrome.scripting.unregisterContentScripts({ ids: ['veil-schleier'] });
  await chrome.scripting.registerContentScripts([{
    id: 'veil-schleier',
    matches: ['<all_urls>'],
    css: ['schleier.css'],
    runAt: 'document_start',
    allFrames: true,
    matchOriginAsFallback: true,
    persistAcrossSessions: true,
  }]);
}

// "sw"-Nachrichten; auch direkt aus steuer.js im Service Worker aufrufbar (ein Kontext kann sich nicht selbst benachrichtigen).
async function bearbeiteSw(nachricht) {
  const t0 = performance.now();
  switch (nachricht.typ) {
    case 'wecke': {
      const stand = await stelleOffscreenSicher();
      return { ok: true, swInstanz: SW_INSTANZ, offscreen: stand, ms: Math.round(performance.now() - t0) };
    }
    case 'schliesseOffscreen': {
      const vorhandene = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      if (vorhandene.length) await chrome.offscreen.closeDocument();
      return { ok: true, geschlossen: vorhandene.length > 0 };
    }
    case 'swStatus': {
      const vorhandene = await chrome.runtime.getContexts({ contextTypes: ['OFFSCREEN_DOCUMENT'] });
      return { ok: true, swInstanz: SW_INSTANZ, offscreenOffen: vorhandene.length > 0 };
    }
    case 'setzeReferer': {
      // Sitzungsregel: Referer fuer die eigenen Abrufe der Erweiterung (tabId -1) setzen oder entfernen.
      await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [7001] });
      if (nachricht.referer) {
        await chrome.declarativeNetRequest.updateSessionRules({ addRules: [{
          id: 7001, priority: 1,
          action: { type: 'modifyHeaders', requestHeaders: [{ header: 'referer', operation: 'set', value: nachricht.referer }] },
          condition: { tabIds: [chrome.tabs.TAB_ID_NONE], urlFilter: '*', resourceTypes: ['image', 'xmlhttprequest', 'other', 'media'] },
        }] });
      }
      const regeln = await chrome.declarativeNetRequest.getSessionRules();
      return { ok: true, regeln: regeln.length };
    }
    case 'registriere': {
      await registriere();
      return { ok: true };
    }
    default: return { ok: false, fehler: 'unbekannt' };
  }
}
self.veilBearbeiteSw = bearbeiteSw;

chrome.runtime.onMessage.addListener((nachricht, absender, antworte) => {
  if (!nachricht) return undefined;
  if (nachricht.typ === 'steuer') {
    // Steuerfunktionen mit tabs-API (sammleTab, messeS2, freigabenVonTab) laufen im Service Worker.
    stelleOffscreenSicher().then(() => self.veil[nachricht.fn](nachricht.params)).then(antworte, (e) => antworte({ ok: false, fehler: String(e && e.message ? e.message : e) }));
    return true;
  }
  if (nachricht.ziel !== 'sw') return undefined;
  bearbeiteSw(nachricht).then(antworte, (e) => antworte({ ok: false, fehler: String(e && e.message ? e.message : e) }));
  return true;
});
