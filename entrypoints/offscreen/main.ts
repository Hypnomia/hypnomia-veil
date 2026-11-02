// Chrome: Offscreen-Dokument, in dem der Erkenner laeuft (der Service Worker kann kein ORT mit WASM und kein DOM-Bild-Handling halten).
import { horcheErkenner, starteErkenner } from '../../src/erkenner';

// Referer fuer eigene Abrufe setzen laesst der Hintergrund (DNR-Sitzungsregel); das Offscreen-Dokument hat kein declarativeNetRequest.
async function setzeReferer(host: string, referer: string): Promise<void> {
  const antwort = (await browser.runtime.sendMessage({ ziel: 'hintergrund', typ: 'referer', host, referer })) as { ok?: boolean } | undefined;
  if (!antwort?.ok) throw new Error('Hintergrund hat den Referer nicht gesetzt');
}

// Zuerst zuhoeren, dann das Modell laden: ein frisches Dokument soll moeglichst frueh antworten.
horcheErkenner();
starteErkenner({ setzeReferer });
