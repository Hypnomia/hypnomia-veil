// Einheitstests ohne Browser: Zeitgrenze und Groessenobergrenze beim Nachladen (src/erkenner/nachladen.ts).
// Ein lokaler Testserver liefert ein kleines Bild, einen haengenden Abruf, einen zu grossen Rumpf und einen endlosen Strom.
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { after, before, test } from 'node:test';
import { ladeNach } from '../../src/erkenner/nachladen.ts';

let server;
let basis = '';
const offeneAntworten = new Set();

before(async () => {
  server = createServer((anfrage, antwort) => {
    offeneAntworten.add(antwort);
    antwort.on('close', () => offeneAntworten.delete(antwort));
    if (anfrage.url === '/klein') {
      antwort.writeHead(200, { 'content-type': 'image/png' });
      antwort.end(Buffer.from('abcdefgh'));
    } else if (anfrage.url === '/haengt') {
      // Kopf ohne Rumpf, dann Schweigen
      antwort.writeHead(200, { 'content-type': 'image/png' });
      antwort.flushHeaders();
    } else if (anfrage.url === '/schweigt') {
      // gar keine Antwort
    } else if (anfrage.url === '/gross') {
      antwort.writeHead(200, { 'content-type': 'image/png', 'content-length': '5000' });
      antwort.end(Buffer.alloc(5000));
    } else if (anfrage.url === '/endlos') {
      // ohne Laengenangabe, Stueck fuer Stueck
      antwort.writeHead(200, { 'content-type': 'image/png' });
      const takt = setInterval(() => {
        if (antwort.destroyed) clearInterval(takt);
        else antwort.write(Buffer.alloc(400));
      }, 5);
      antwort.on('close', () => clearInterval(takt));
    } else {
      antwort.writeHead(404);
      antwort.end();
    }
  });
  await new Promise((fertig) => server.listen(0, '127.0.0.1', fertig));
  basis = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  for (const a of offeneAntworten) a.destroy();
  server.closeAllConnections?.();
  await new Promise((fertig) => server.close(fertig));
});

const grenzen = { maxMs: 300, maxBytes: 1000 };
const ohneReferer = async () => {};

test('kleines Bild kommt an', async () => {
  const r = await ladeNach(`${basis}/klein`, '', ohneReferer, grenzen);
  assert.equal(r.ok, true);
  assert.equal(r.blob.size, 8);
});

test('Abruf ohne Antwort wird nach der Zeitgrenze abgebrochen, ohne Wiederholung mit Referer', async () => {
  let refererGesetzt = 0;
  const t0 = performance.now();
  const r = await ladeNach(`${basis}/schweigt`, 'http://127.0.0.1/', async () => void refererGesetzt++, grenzen);
  const dauer = performance.now() - t0;
  assert.equal(r.ok, false);
  assert.match(r.fehler, /Zeitgrenze/);
  assert.equal(refererGesetzt, 0);
  assert.ok(dauer < 1500, `dauerte ${dauer} ms`);
});

test('Kopf ohne Rumpf: Lesen bricht nach der Zeitgrenze ab', async () => {
  const r = await ladeNach(`${basis}/haengt`, '', ohneReferer, grenzen);
  assert.equal(r.ok, false);
  assert.match(r.fehler, /Zeitgrenze/);
});

test('angekuendigte Groesse ueber der Obergrenze: abgelehnt', async () => {
  const r = await ladeNach(`${basis}/gross`, '', ohneReferer, grenzen);
  assert.equal(r.ok, false);
  assert.match(r.fehler, /zu gross/);
});

test('endloser Strom ohne Laengenangabe: bricht an der Obergrenze ab', async () => {
  const t0 = performance.now();
  const r = await ladeNach(`${basis}/endlos`, '', ohneReferer, { maxMs: 5000, maxBytes: 2000 });
  assert.equal(r.ok, false);
  assert.match(r.fehler, /zu gross/);
  assert.ok(performance.now() - t0 < 3000);
});

test('404 bleibt ein HTTP-Fehler mit Status', async () => {
  const r = await ladeNach(`${basis}/nichts`, '', ohneReferer, grenzen);
  assert.equal(r.ok, false);
  assert.equal(r.status, 404);
});
