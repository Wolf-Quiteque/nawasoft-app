import test from 'node:test';
import assert from 'node:assert/strict';
import { groupByOriginProvince, NO_TRIP_GROUP, originProvinceForRun } from '../lib/origin-groups.js';

test('Kikolo and Gamek runs use their route province, not the terminal city', () => {
  assert.equal(originProvinceForRun({ legs: [
    { origin_city: 'Kikolo', origin_province: 'Luanda' },
    { origin_city: 'Gamek', origin_province: 'Luanda' },
  ] }), 'Luanda');
});

test('runs are grouped as Luanda then Benguela and idle buses stay last', () => {
  const items = [
    { id: 'idle', run: null },
    { id: 'ben', run: { origins: [{ origin_city: 'Benguela', origin_province: 'Benguela' }] } },
    { id: 'lua', run: { origins: [{ origin_city: 'Gamek', origin_province: 'Luanda' }] } },
  ];
  const groups = groupByOriginProvince(items, (item) => item.run);
  assert.deepEqual(groups.map((group) => group.province), ['Luanda', 'Benguela', NO_TRIP_GROUP]);
  assert.deepEqual(groups.map((group) => group.entries.map((item) => item.id)), [['lua'], ['ben'], ['idle']]);
});
