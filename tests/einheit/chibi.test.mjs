// Einheitstests Chibi-Vertrag (src/chibi.ts): Schluessel der Quiz-Reaktionen (Pack 0.9) und Zuordnung von Dateinamen zu Posen.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { chibiSchluessel, liesChibiSchluessel, passtZurPose, QUIZ_GRUNDPOSE, QUIZ_POSEN } from '../../src/chibi.ts';

test('chibiSchluessel: Pose allein, mit Nummer `pose#nummer`', () => {
  assert.equal(chibiSchluessel('jubeln'), 'jubeln');
  assert.equal(chibiSchluessel('quiz-frage'), 'quiz-frage');
  assert.equal(chibiSchluessel('quiz-frage', 7), 'quiz-frage#7');
  assert.equal(chibiSchluessel('quiz-richtig', 3.9), 'quiz-richtig#3');
  assert.equal(chibiSchluessel('quiz-falsch', 0), 'quiz-falsch');
});

test('liesChibiSchluessel: Grundposen, Quiz-Posen mit Grundpose, Unbekanntes null', () => {
  assert.deepEqual(liesChibiSchluessel('jubeln'), { pose: 'jubeln', grund: 'jubeln' });
  assert.deepEqual(liesChibiSchluessel('thron#5'), { pose: 'thron', grund: 'thron' });
  assert.deepEqual(liesChibiSchluessel('quiz-frage#12'), { pose: 'quiz-frage', grund: 'sprechblase' });
  assert.deepEqual(liesChibiSchluessel('quiz-richtig'), { pose: 'quiz-richtig', grund: 'jubeln' });
  assert.deepEqual(liesChibiSchluessel('quiz-falsch#1'), { pose: 'quiz-falsch', grund: 'schmollen' });
  assert.equal(liesChibiSchluessel('quiz'), null);
  assert.equal(liesChibiSchluessel('quiz-frage-01'), null);
  assert.equal(liesChibiSchluessel(''), null);
  assert.equal(liesChibiSchluessel('#jubeln'), null);
  for (const p of QUIZ_POSEN) assert.ok(QUIZ_GRUNDPOSE[p]);
});

test('passtZurPose: Quiz-Dateien nur zur Quiz-Pose, Grundposen bleiben wie bisher', () => {
  assert.equal(passtZurPose('chibi/quiz-frage-03.webp', 'quiz-frage'), true);
  assert.equal(passtZurPose('chibi/quiz-frage-03.webp', 'quiz-richtig'), false);
  assert.equal(passtZurPose('chibi/quiz-frage-03.webp', 'sprechblase'), false);
  assert.equal(passtZurPose('chibi/jubeln-2.webp', 'jubeln'), true);
  assert.equal(passtZurPose('chibi/jubeln.webp', 'quiz-richtig'), false);
});
