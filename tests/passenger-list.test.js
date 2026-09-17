// The pasted-list parser behind batch ticket issue. The fixtures here are real
// shapes agents have been sent over WhatsApp, not invented ones.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parsePassengerLine, parsePassengerList } from '../lib/passenger-list.js';

test('name with a numbered marker and a labelled BI', () => {
  assert.deepEqual(
    parsePassengerLine('1- Eduardo Nguenda Miranda Cussecala - BI: 006050336LA048'),
    { name: 'Eduardo Nguenda Miranda Cussecala', national_id: '006050336LA048' }
  );
});

test('dot marker and a bare comma-separated BI', () => {
  assert.deepEqual(
    parsePassengerLine('2. Julio Tavares Domingos, 006340368LA049'),
    { name: 'Julio Tavares Domingos', national_id: '006340368LA049' }
  );
});

test('name on its own keeps a null BI', () => {
  assert.deepEqual(
    parsePassengerLine('Maria Fineza Nenganga'),
    { name: 'Maria Fineza Nenganga', national_id: null }
  );
});

test('accented names survive intact', () => {
  assert.deepEqual(
    parsePassengerLine('6- Antónia Nzinga Novais Domingos do Nascimento - BI: 000097039LA018'),
    { name: 'Antónia Nzinga Novais Domingos do Nascimento', national_id: '000097039LA018' }
  );
});

test('"B.I." with punctuation variants is still stripped from the name', () => {
  for (const line of [
    'Ayber Rosário Kiyende Cugita B.I. 000827397LA030',
    'Ayber Rosário Kiyende Cugita — BI 000827397LA030',
    'Ayber Rosário Kiyende Cugita: BI: 000827397LA030',
  ]) {
    assert.deepEqual(parsePassengerLine(line), {
      name: 'Ayber Rosário Kiyende Cugita',
      national_id: '000827397LA030',
    });
  }
});

test('BI is upper-cased and extra whitespace collapsed', () => {
  assert.deepEqual(
    parsePassengerLine('  10-   Dilsa   Rachela  Domingos - bi: 007128254la047 '),
    { name: 'Dilsa Rachela Domingos', national_id: '007128254LA047' }
  );
});

test('a two-digit marker is a marker, not part of the name', () => {
  assert.equal(parsePassengerLine('12- Dorcas Mavunda Quingui Cugita').name, 'Dorcas Mavunda Quingui Cugita');
});

test('a number that is part of the name is left alone', () => {
  assert.equal(parsePassengerLine('Joao Paulo II').name, 'Joao Paulo II');
});

test('blank and marker-only lines are dropped, not turned into empty passengers', () => {
  assert.equal(parsePassengerLine(''), null);
  assert.equal(parsePassengerLine('   '), null);
  assert.equal(parsePassengerLine('3-'), null);
  assert.equal(parsePassengerLine('  -  '), null);
});

test('parses a full pasted block, skipping the blank lines between entries', () => {
  const pasted = `
1- Eduardo Nguenda Miranda Cussecala - BI: 006050336LA048

2 - Julio Tavares Domingos - BI: 006340368LA049
3- Ericson Fernando Domingos Zambi - BI: 003973730OE039

Isabel Maria Roque Fernandes
`;
  const rows = parsePassengerList(pasted);
  assert.equal(rows.length, 4);
  assert.deepEqual(rows.map((r) => r.name), [
    'Eduardo Nguenda Miranda Cussecala',
    'Julio Tavares Domingos',
    'Ericson Fernando Domingos Zambi',
    'Isabel Maria Roque Fernandes',
  ]);
  assert.equal(rows[2].national_id, '003973730OE039');
  assert.equal(rows[3].national_id, null);
});

test('an OE-series BI is recognised like the LA/BO ones', () => {
  assert.equal(parsePassengerLine('X - BI: 003973730OE039').national_id, '003973730OE039');
  assert.equal(parsePassengerLine('Y - BI: 001546622BA035').national_id, '001546622BA035');
});
