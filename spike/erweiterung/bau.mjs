// Wegwerf-Spike: baut die Spike-Erweiterung nach .output/spike-<browser>-<name>/ (Firefox zusaetzlich als Zip).
// Parameter: --browser chromium|firefox, --modell 640m|320n|beide, --backend wasm|webgpu, --threads N (Chrome: COOP/COEP),
//   --strategie a|b|c, --freigabe pruefung|nie, --vorladen, --modellQuelle paket|<URL-Praefix>, --kanal rgb|bgr, --name <Kennung>
// Kein Produktcode, kein WXT; der Produkt-Build bleibt unberuehrt.
import { cpSync, mkdirSync, rmSync, writeFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const hier = path.dirname(fileURLToPath(import.meta.url));
const wurzel = path.resolve(hier, '../..');
const arg = (name, standard) => { const i = process.argv.indexOf(`--${name}`); return i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--') ? process.argv[i + 1] : standard; };

export function baue(o = {}) {
  const browser = o.browser === 'firefox' ? 'firefox' : 'chromium';
  const modell = ['640m', '320n', 'beide'].includes(o.modell) ? o.modell : '320n';
  const backend = o.backend === 'webgpu' ? 'webgpu' : 'wasm';
  const threads = Math.max(1, Number(o.threads ?? 1) || 1);
  const strategie = ['a', 'b', 'c', 'keine'].includes(o.strategie) ? o.strategie : 'a';
  if (browser === 'firefox' && strategie === 'b') throw new Error('Strategie b (registerContentScripts) ist nur fuer Chromium gebaut');
  // live: Build fuer den Lauf im Browser des Inhabers, ohne Bruecke, ohne DOM-Attribute, ohne Schleier-CSS.
  const live = !!o.live;
  const freigabe = o.freigabe === 'nie' ? 'nie' : 'pruefung';
  const name = o.name ?? `${modell}-${backend}${threads > 1 ? `-t${threads}` : ''}-${strategie}`;
  const ziel = path.join(wurzel, '.output', `spike-${browser}-${name}`);
  rmSync(ziel, { recursive: true, force: true });
  mkdirSync(path.join(ziel, 'ort'), { recursive: true });
  mkdirSync(path.join(ziel, 'modelle'), { recursive: true });
  for (const f of ['erkenner.js', 'ort-lader.js', 'inhalt.js', 'schleier.css', 'vollschleier.css', 'steuer.html', 'steuer.js', 'popup.html', 'popup.js', 'bruecke.js']) cpSync(path.join(hier, f), path.join(ziel, f));
  if (browser === 'chromium') { cpSync(path.join(hier, 'sw.js'), path.join(ziel, 'sw.js')); cpSync(path.join(hier, 'offscreen.html'), path.join(ziel, 'offscreen.html')); }
  else cpSync(path.join(hier, 'hintergrund.html'), path.join(ziel, 'hintergrund.html'));
  const dist = path.join(wurzel, 'node_modules/onnxruntime-web/dist');
  for (const f of ['ort.wasm.min.js', 'ort.webgpu.min.js', 'ort-wasm-simd-threaded.wasm', 'ort-wasm-simd-threaded.mjs', 'ort-wasm-simd-threaded.asyncify.wasm', 'ort-wasm-simd-threaded.asyncify.mjs', 'ort-wasm-simd-threaded.jsep.wasm', 'ort-wasm-simd-threaded.jsep.mjs']) cpSync(path.join(dist, f), path.join(ziel, 'ort', f));
  const modellQuelle = o.modellQuelle ?? 'paket';
  if (modellQuelle === 'paket') {
    for (const m of modell === 'beide' ? ['640m', '320n'] : [modell]) cpSync(path.resolve(wurzel, '../04 Alt-Code Referenz/modelle', `${m}.onnx`), path.join(ziel, 'modelle', `${m}.onnx`));
  }
  const konfig = { kontext: browser === 'chromium' ? 'offscreen' : 'hintergrundseite', modell: modell === 'beide' ? '320n' : modell, backend, threads, strategie, freigabe, vorladen: !!o.vorladen, modellQuelle, kanal: o.kanal === 'bgr' ? 'bgr' : 'rgb', schwelle: Number(o.schwelle ?? 0.2) || 0.2, name, steuerTab: false };
  writeFileSync(path.join(ziel, 'konfig.json'), JSON.stringify(konfig, null, 2));
  writeFileSync(path.join(ziel, 'inhalt-konfig.js'), `// vom Bau erzeugt\nconst S_KONFIG = ${JSON.stringify({ strategie, freigabe: live ? 'nie' : freigabe, parallel: Number(o.parallel ?? 3) || 3, debug: !!process.env.VEIL_DEBUG, ohneDom: live })};\n`);
  const css = live ? [] : strategie === 'a' ? ['schleier.css'] : strategie === 'c' ? ['vollschleier.css'] : [];
  const manifest = {
    manifest_version: 3,
    name: 'VEIL spike',
    version: '0.0.1',
    description: 'Throwaway measurement extension for the VEIL spike. Not a product.',
    permissions: browser === 'chromium' ? ['offscreen', 'scripting', 'tabs', 'storage', 'declarativeNetRequest'] : ['scripting', 'tabs', 'storage', 'webRequest', 'webRequestBlocking'],
    host_permissions: ['<all_urls>'],
    background: browser === 'chromium' ? { service_worker: 'sw.js' } : { scripts: [backend === 'webgpu' ? 'ort/ort.webgpu.min.js' : 'ort/ort.wasm.min.js', 'erkenner.js', 'steuer.js'] },
    content_scripts: [
      { matches: ['<all_urls>'], js: ['inhalt-konfig.js', 'inhalt.js'], css, run_at: 'document_start', all_frames: true, match_about_blank: true, match_origin_as_fallback: true },
      ...(live ? [] : [{ matches: ['http://127.0.0.1/*'], js: ['steuer.js', 'bruecke.js'], run_at: 'document_end' }]),
    ],
    content_security_policy: { extension_pages: "script-src 'self' 'wasm-unsafe-eval'; object-src 'self';" },
    action: { default_popup: 'popup.html' },
  };
  if (browser === 'chromium' && threads > 1) {
    manifest.cross_origin_embedder_policy = { value: o.coep ?? 'require-corp' };
    manifest.cross_origin_opener_policy = { value: 'same-origin' };
  }
  if (browser === 'firefox') manifest.browser_specific_settings = { gecko: { id: 'veil-spike@hypnomia', strict_min_version: '128.0' }, gecko_android: { strict_min_version: '128.0' } };
  writeFileSync(path.join(ziel, 'manifest.json'), JSON.stringify(manifest, null, 2));
  let zip = null;
  if (browser === 'firefox') {
    zip = `${ziel}.zip`;
    if (existsSync(zip)) rmSync(zip);
    execFileSync('zip', ['-q', '-r', zip, '.'], { cwd: ziel });
  }
  return { ziel, zip, konfig };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const r = baue({ live: process.argv.includes('--live'), browser: arg('browser'), modell: arg('modell'), backend: arg('backend'), threads: arg('threads'), strategie: arg('strategie'), freigabe: arg('freigabe'), vorladen: process.argv.includes('--vorladen'), modellQuelle: arg('modellQuelle'), kanal: arg('kanal'), name: arg('name'), coep: arg('coep'), parallel: arg('parallel') });
  console.log(`gebaut: ${path.relative(wurzel, r.ziel)}${r.zip ? ` und ${path.relative(wurzel, r.zip)}` : ''}`);
}
