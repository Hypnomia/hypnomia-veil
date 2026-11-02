// Einheitstests ohne Browser: private Adressbereiche beim Nachladen (src/erkenner/nachladen.ts, PHASE-2-BAUPLAN 9.6).
// Regel: oeffentlich nach privat gesperrt, privat nach privat erlaubt (wie Chromes Private Network Access).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { entscheideNachladen, herkunftFuerEntscheidung, istPrivaterHost } from '../../src/erkenner/nachladen.ts';

const privat = (host) => assert.equal(istPrivaterHost(host), true, `${host} muesste privat sein`);
const oeffentlich = (host) => assert.equal(istPrivaterHost(host), false, `${host} muesste oeffentlich sein`);

test('Namen: localhost, *.localhost, *.local, *.internal, *.home.arpa', () => {
  for (const h of ['localhost', 'app.localhost', 'a.b.localhost', 'drucker.local', 'nas.fritz.local', 'dienst.internal', 'x.y.internal', 'router.home.arpa', 'home.arpa']) privat(h);
  for (const h of ['example.com', 'localhost.example.com', 'local.example.com', 'internal.example.org', 'home.arpa.example.com', 'fakehome.arpa', 'example.local.com']) oeffentlich(h);
});

test('IPv4: jeder private Bereich, Anfang und Ende', () => {
  for (const h of [
    '0.0.0.0', '0.255.255.255', // 0/8
    '10.0.0.0', '10.255.255.255', '10.1.2.3', // 10/8
    '100.64.0.0', '100.100.100.100', '100.127.255.255', // 100.64/10
    '127.0.0.1', '127.255.255.254', // 127/8
    '169.254.0.1', '169.254.169.254', // 169.254/16
    '172.16.0.0', '172.20.1.1', '172.31.255.255', // 172.16/12
    '192.168.0.1', '192.168.255.255', // 192.168/16
  ]) privat(h);
});

test('IPv4: Grenzfaelle knapp ausserhalb', () => {
  for (const h of [
    '172.15.255.255', '172.15.0.1', '172.32.0.0', '172.32.0.1', // 172.16/12
    '100.63.255.255', '100.128.0.0', '100.128.0.1', // 100.64/10
    '11.0.0.1', '9.255.255.255', // 10/8
    '126.255.255.255', '128.0.0.1', // 127/8
    '169.253.255.255', '169.255.0.1', // 169.254/16
    '192.167.255.255', '192.169.0.1', '192.0.2.1', // 192.168/16
    '1.0.0.1', '8.8.8.8', '1.1.1.1', '93.184.216.34',
  ]) oeffentlich(h);
});

test('IPv4: andere Schreibweisen derselben Adresse', () => {
  // Der URL-Parser rechnet Zahlen-, Hex- und Oktalformen auf die Punktform um.
  for (const h of ['2130706433', '0x7f.0.0.1', '0177.0.0.1', '127.1', '0xc0a80001', '3232235521']) privat(h);
  for (const h of ['16909060', '0x08080808']) oeffentlich(h);
});

test('IPv6: ::1, fc00::/7, fe80::/10', () => {
  for (const h of ['::1', '0:0:0:0:0:0:0:1', 'fc00::1', 'fd12:3456:789a::1', 'fdff:ffff:ffff:ffff:ffff:ffff:ffff:ffff', 'fe80::1', 'fe80::abcd:1234', 'febf::1']) privat(h);
  for (const h of ['fbff::1', 'fe00::1', 'fec0::1', 'ff02::1', '2001:db8::1', '2606:4700:4700::1111', '::2', '1::']) oeffentlich(h);
});

test('IPv6 in eckigen Klammern', () => {
  privat('[::1]');
  privat('[fe80::1]');
  privat('[fd00::5]');
  privat('[::ffff:10.0.0.1]');
  oeffentlich('[2001:db8::1]');
  oeffentlich('[::ffff:8.8.8.8]');
});

test('IPv6: ::ffff: mit privatem und mit oeffentlichem IPv4', () => {
  for (const h of ['::ffff:10.0.0.1', '::ffff:127.0.0.1', '::ffff:192.168.1.1', '::ffff:172.16.0.1', '::ffff:7f00:1', '::ffff:a00:1', '::ffff:c0a8:101', '::FFFF:100.64.0.1', '0:0:0:0:0:ffff:a9fe:a9fe']) privat(h);
  for (const h of ['::ffff:8.8.8.8', '::ffff:808:808', '::ffff:172.32.0.1', '::ffff:100.128.0.1', '::ffff:ac20:1']) oeffentlich(h);
  // ::ffff: nur in den richtigen Gruppen: eine andere Vorsilbe ist keine abgebildete IPv4-Adresse.
  oeffentlich('1::ffff:10.0.0.1');
});

test('Grossschreibung und Punkt am Namensende', () => {
  for (const h of ['LOCALHOST', 'LocalHost', 'Drucker.LOCAL', 'DIENST.Internal', 'Router.HOME.ARPA', 'FE80::1', 'FD00::A', '[FE80::1]', '::FFFF:10.0.0.1']) privat(h);
  for (const h of ['localhost.', 'localhost..', 'drucker.local.', '127.0.0.1.', '10.0.0.1.', 'App.Localhost.', 'router.home.arpa.']) privat(h);
  for (const h of ['EXAMPLE.COM', 'example.com.', '8.8.8.8.', 'LocalHost.Example.Com.']) oeffentlich(h);
});

test('Muell und leere Eingaben sind nie privat', () => {
  for (const h of ['', ' ', '.', '..', 'x y', ':::', '[]', '999.1.1.1', '1.2.3']) oeffentlich(h);
});

test('Namen ohne Punkt sind privat (ausser IP-Literalen)', () => {
  for (const h of ['drucker', 'router', 'nas', 'fritz', 'localhost6', 'ip6-localhost', 'ip6-loopback', 'DRUCKER', 'drucker.', 'intranet', 'wpad', '12345678901234']) privat(h);
  // IP-Literale sind keine "Namen ohne Punkt": ihr Bereich entscheidet.
  for (const h of ['8.8.8.8', '[2001:db8::1]', '2001:db8::1', '93.184.216.34']) oeffentlich(h);
});

test('weitere Heimnetz- und Firmennetz-Namen: fritz.box, *.lan, *.home, *.localdomain, *.intranet, *.corp', () => {
  for (const h of ['fritz.box', 'FRITZ.BOX', 'fritz.box.', 'nas.fritz.box', 'drucker.lan', 'a.b.lan', 'tv.home', 'host.localdomain', 'wiki.intranet', 'git.corp', 'ip6-localhost.localdomain', 'lan', 'home', 'corp']) privat(h);
  for (const h of ['fritz.box.example.com', 'example.box', 'my.fritz.com', 'lan.example.com', 'home.example.com', 'example.lan.com', 'corp.example.org', 'intranet.example.net', 'mycorp.com', 'homelan.de']) oeffentlich(h);
});

test('IPv4 192.0.0.0/24 und 198.18.0.0/15 sind privat, die Nachbarn nicht', () => {
  for (const h of ['192.0.0.0', '192.0.0.8', '192.0.0.255', '198.18.0.0', '198.18.5.5', '198.19.255.255']) privat(h);
  for (const h of ['192.0.1.1', '192.0.2.1', '191.255.255.255', '198.17.255.255', '198.20.0.0', '198.51.100.1']) oeffentlich(h);
});

test('IPv6 64:ff9b::/96 (NAT64) ist privat, die Nachbarn nicht', () => {
  for (const h of ['64:ff9b::', '64:ff9b::1', '64:ff9b::808:808', '[64:ff9b::c0a8:1]', '64:ff9b:0:0:0:0:a00:1']) privat(h);
  for (const h of ['64:ff9b:1::1', '64:ff9a::1', '65:ff9b::1', '64:ff9b::1:0:0:1']) oeffentlich(h);
});

test('entscheideNachladen: oeffentliche Seite nach privatem Ziel gesperrt', () => {
  for (const ziel of [
    'http://127.0.0.1/bild.png',
    'http://localhost:8080/a.jpg',
    'http://192.168.0.1/snapshot.jpg',
    'http://10.0.0.5/kamera',
    'http://172.16.1.1/x.png',
    'http://169.254.169.254/latest/meta-data/',
    'http://100.64.0.1/x',
    'http://[::1]/x.png',
    'http://[fe80::1]/x.png',
    'http://[fd00::1]/x.png',
    'http://[::ffff:192.168.0.1]/x.png',
    'http://drucker.local/vorschau.png',
    'http://nas.internal/foto.jpg',
    'http://router.home.arpa/logo.png',
    'http://LOCALHOST./x.png',
  ]) {
    assert.equal(entscheideNachladen(ziel, 'https://example.com/'), 'privat', ziel);
    assert.equal(entscheideNachladen(ziel, 'http://93.184.216.34/'), 'privat', ziel);
  }
});

test('entscheideNachladen: private Seite nach privatem Ziel erlaubt', () => {
  const seiten = ['http://127.0.0.1:3000/', 'http://localhost/', 'http://192.168.178.20/', 'http://fritz.box.local/', 'http://[::1]:8080/', 'http://nas.home.arpa/', 'http://10.1.1.1/seite'];
  for (const seite of seiten) {
    assert.equal(entscheideNachladen('http://192.168.0.1/snapshot.jpg', seite), 'erlaubt', seite);
    assert.equal(entscheideNachladen('http://localhost:8080/a.jpg', seite), 'erlaubt', seite);
    assert.equal(entscheideNachladen('http://[::1]/x.png', seite), 'erlaubt', seite);
  }
});

test('entscheideNachladen: oeffentliches Ziel ist immer erlaubt', () => {
  for (const seite of ['https://example.com/', 'http://127.0.0.1/', '', 'null']) {
    assert.equal(entscheideNachladen('https://cdn.example.com/a.jpg', seite), 'erlaubt', seite);
    assert.equal(entscheideNachladen('http://172.32.0.1/a.jpg', seite), 'erlaubt', seite);
    assert.equal(entscheideNachladen('http://100.128.0.1/a.jpg', seite), 'erlaubt', seite);
    assert.equal(entscheideNachladen('http://172.15.0.1/a.jpg', seite), 'erlaubt', seite);
  }
});

test('entscheideNachladen: unbekannter oder ungueltiger Referer gilt als oeffentlich', () => {
  const ziel = 'http://192.168.0.1/x.png';
  // "null" schickt das Content-Script bei unbekanntem Ursprung (data:, sandbox)
  for (const referer of ['null', 'abc', 'javascript:1', 'file:///C:/x.html', 'ftp://127.0.0.1/', 'https://', 'http://exa mple.com/']) {
    assert.equal(entscheideNachladen(ziel, referer), 'privat', referer);
  }
  // Leer heisst "kein Seitenbezug" (interne Aufrufe der Erweiterung): die Regel greift nicht.
  assert.equal(entscheideNachladen(ziel, ''), 'erlaubt');
});

test('entscheideNachladen: Namen, die wie private aussehen, aber oeffentlich sind', () => {
  for (const ziel of ['http://localhost.example.com/x.png', 'http://local.example.org/x.png', 'http://internal.example.com/x.png', 'http://172.32.1.1/x.png', 'http://100.63.1.1/x.png']) {
    assert.equal(entscheideNachladen(ziel, 'https://example.com/'), 'erlaubt', ziel);
  }
});

test('entscheideNachladen: Zielobjekt (URL) statt Text', () => {
  assert.equal(entscheideNachladen(new URL('http://10.0.0.1/x'), 'https://example.com/'), 'privat');
  assert.equal(entscheideNachladen(new URL('http://10.0.0.1/x'), 'http://192.168.1.1/'), 'erlaubt');
  assert.equal(entscheideNachladen('keine adresse', 'https://example.com/'), 'privat');
});

// ---------- Herkunft aus dem Absender (Netzgrenze, Fund 1 der ersten Pruefung) ----------

test('herkunftFuerEntscheidung: Absender ohne Tab behaelt den Referer, auch leer', () => {
  assert.equal(herkunftFuerEntscheidung('', undefined), '');
  assert.equal(herkunftFuerEntscheidung('', {}), '');
  assert.equal(herkunftFuerEntscheidung('http://127.0.0.1/', { origin: 'chrome-extension://abc' }), 'http://127.0.0.1/');
});

test('herkunftFuerEntscheidung: Nachricht aus einem Tab ohne Referer gilt als "null" (oeffentlich)', () => {
  assert.equal(herkunftFuerEntscheidung('', { tab: { id: 3 } }), 'null');
  assert.equal(entscheideNachladen('http://192.168.0.1/x.png', herkunftFuerEntscheidung('', { tab: { id: 3 } })), 'privat');
});

test('herkunftFuerEntscheidung: sender.origin zaehlt vor dem behaupteten Referer', () => {
  const tab = { id: 1 };
  // undurchsichtiger Ursprung (sandbox): oeffentlich, auch wenn der Referer Privates behauptet
  assert.equal(herkunftFuerEntscheidung('http://192.168.1.1/', { tab, origin: 'null' }), 'null');
  assert.equal(entscheideNachladen('http://192.168.0.5/x.png', herkunftFuerEntscheidung('http://192.168.1.1/', { tab, origin: 'null' })), 'privat');
  // oeffentliche Seite, behauptet privat: bleibt oeffentlich
  assert.equal(entscheideNachladen('http://10.0.0.1/x', herkunftFuerEntscheidung('http://192.168.1.1/', { tab, origin: 'https://example.com' })), 'privat');
  // private Seite, Referer fehlt oder falsch: sender.origin entscheidet
  assert.equal(herkunftFuerEntscheidung('null', { tab, origin: 'http://192.168.1.1:8080' }), 'http://192.168.1.1:8080/');
  assert.equal(entscheideNachladen('http://10.0.0.1/x', herkunftFuerEntscheidung('', { tab, origin: 'http://192.168.1.1:8080' })), 'erlaubt');
  // keine http(s)-Herkunft: undurchsichtig
  assert.equal(herkunftFuerEntscheidung('http://192.168.1.1/', { tab, origin: 'chrome-extension://abc' }), 'null');
  assert.equal(herkunftFuerEntscheidung('http://192.168.1.1/', { tab, origin: 'ssd' }), 'null');
});

test('herkunftFuerEntscheidung: ohne sender.origin zaehlt der Referer, leer wird "null"', () => {
  const tab = { id: 1 };
  assert.equal(herkunftFuerEntscheidung('http://192.168.1.1/', { tab }), 'http://192.168.1.1/');
  assert.equal(herkunftFuerEntscheidung('', { tab }), 'null');
});
