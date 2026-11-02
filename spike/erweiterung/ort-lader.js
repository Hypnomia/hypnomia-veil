// Wegwerf-Spike: laedt das ORT-Bundle je Konfiguration (wasm oder webgpu), danach den Erkenner.
// Dynamisches Nachladen per script-Element ist in Erweiterungsseiten erlaubt (script-src 'self').
(async () => {
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const k = await (await fetch(api.runtime.getURL('konfig.json'))).json();
  const bundle = k.backend === 'webgpu' ? 'ort/ort.webgpu.min.js' : 'ort/ort.wasm.min.js';
  const lade = (src) => new Promise((ok, fehl) => {
    const e = document.createElement('script');
    e.src = api.runtime.getURL(src);
    e.onload = ok;
    e.onerror = () => fehl(new Error(`Laden fehlgeschlagen: ${src}`));
    document.body.appendChild(e);
  });
  await lade(bundle);
  await lade('erkenner.js');
})();
