import test from 'node:test';
import assert from 'node:assert/strict';

import {
  formEntityValueItemId,
  normalizeTextForHash,
  toTypedFormEntityValue,
} from '../dist/utils/formEntityValueColumns.js';
import { applyTypedDynamicFieldFilter } from '../dist/zero/dynamicFieldFilterConditions.js';

const EMPTY = { textValue: null, numberValue: null, dateValue: null, boolValue: null, plainValue: null };

test('STRING stores the trimmed text and hashes its lowercased, trimmed form', () => {
  const typed = toTypedFormEntityValue('STRING', 'Kalyan ');
  assert.deepEqual(typed.columns, { ...EMPTY, textValue: 'Kalyan' });
  assert.equal(typed.textHashInput, 'kalyan');
  assert.deepEqual(typed.items, []);
});

test('blank STRING stores nothing', () => {
  assert.equal(toTypedFormEntityValue('STRING', '   ').textHashInput, null);
  assert.equal(toTypedFormEntityValue('STRING', '   ').columns.textValue, null);
});

test('NUMBER accepts numbers and numeric strings (Zero sends strings)', () => {
  assert.equal(toTypedFormEntityValue('NUMBER', 42).columns.numberValue, 42);
  assert.equal(toTypedFormEntityValue('NUMBER', '5.75').columns.numberValue, 5.75);
  assert.equal(toTypedFormEntityValue('NUMBER', 'abc').columns.numberValue, null);
});

test('BOOLEAN accepts booleans and "true"/"false"', () => {
  assert.equal(toTypedFormEntityValue('BOOLEAN', true).columns.boolValue, true);
  assert.equal(toTypedFormEntityValue('BOOLEAN', 'FALSE').columns.boolValue, false);
  assert.equal(toTypedFormEntityValue('BOOLEAN', 'yes').columns.boolValue, null);
});

test('DATE stores epoch milliseconds from ISO strings and epoch values', () => {
  const iso = '2026-11-18T00:00:00.000Z';
  const ms = Date.parse(iso);
  assert.equal(toTypedFormEntityValue('DATE', iso).columns.dateValue, ms);
  assert.equal(toTypedFormEntityValue('DATE', ms).columns.dateValue, ms);
  assert.equal(toTypedFormEntityValue('DATE', String(ms)).columns.dateValue, ms);
  assert.equal(toTypedFormEntityValue('DATE', 'not a date').columns.dateValue, null);
});

test('SINGLE_SELECT, TICKET and DOC go to plainValue', () => {
  assert.equal(toTypedFormEntityValue('SINGLE_SELECT', 'High').columns.plainValue, 'High');
  assert.equal(toTypedFormEntityValue('TICKET', ['ticket_1']).columns.plainValue, 'ticket_1');
  assert.equal(toTypedFormEntityValue('DOC', 'att_1').columns.plainValue, 'att_1');
});

test('MULTI_SELECT and USER become trimmed, de-duplicated items', () => {
  const typed = toTypedFormEntityValue('MULTI_SELECT', ['UPI', ' Cards', 'UPI', '']);
  assert.deepEqual(typed.items, ['UPI', 'Cards']);
  assert.deepEqual(typed.columns, EMPTY);
  assert.deepEqual(toTypedFormEntityValue('USER', 'user_1').items, ['user_1']);
});

test('null value or unknown type leaves everything empty', () => {
  assert.deepEqual(toTypedFormEntityValue('STRING', null).columns, EMPTY);
  assert.deepEqual(toTypedFormEntityValue('SOMETHING_ELSE', 'x').columns, EMPTY);
});

test('item ids are stable per value and item', () => {
  assert.equal(formEntityValueItemId('v1', 'UPI'), formEntityValueItemId('v1', 'UPI'));
  assert.notEqual(formEntityValueItemId('v1', 'UPI'), formEntityValueItemId('v2', 'UPI'));
  assert.equal(normalizeTextForHash('  MiXeD '), 'mixed');
});

// Records the calls a filter makes on a Zero query builder.
const recorder = (calls = []) => ({
  calls,
  where(...args) {
    if (typeof args[0] === 'function') {
      calls.push(['where', args[0]({ or: (...c) => ['or', ...c], cmp: (...c) => ['cmp', ...c] })]);
    } else {
      calls.push(['where', ...args]);
    }
    return this;
  },
  whereExists(relation, build) {
    const inner = recorder();
    build(inner);
    calls.push(['whereExists', relation, inner.calls]);
    return this;
  },
});

test('STRING filters on textHash only when a hash function is given', () => {
  const server = recorder();
  applyTypedDynamicFieldFilter(server, { fieldType: 'STRING', values: ['Kalyan', 'kalyan'] }, text => `h(${text.toLowerCase()})`);
  assert.deepEqual(server.calls, [['where', 'textHash', 'IN', ['h(kalyan)']]]);

  const client = recorder();
  applyTypedDynamicFieldFilter(client, { fieldType: 'STRING', values: ['Kalyan'] }, null);
  assert.deepEqual(client.calls, []);
});

test('typed filters pick the column for the field type', () => {
  const number = recorder();
  applyTypedDynamicFieldFilter(number, { fieldType: 'NUMBER', values: ['1500', 'abc'] }, null);
  assert.deepEqual(number.calls, [['where', 'numberValue', 'IN', [1500]]]);

  const select = recorder();
  applyTypedDynamicFieldFilter(select, { fieldType: 'SINGLE_SELECT', values: ['High'] }, null);
  assert.deepEqual(select.calls, [['where', 'plainValue', 'IN', ['High']]]);

  const multi = recorder();
  applyTypedDynamicFieldFilter(multi, { fieldType: 'MULTI_SELECT', values: ['UPI', 'Cards'] }, null);
  assert.deepEqual(multi.calls, [['whereExists', 'items', [['where', 'item', 'IN', ['UPI', 'Cards']]]]]);

  const date = recorder();
  applyTypedDynamicFieldFilter(date, { fieldType: 'DATE', dateRange: { start: 10, end: 20 } }, null);
  assert.deepEqual(date.calls, [['where', 'dateValue', '>=', 10], ['where', 'dateValue', '<=', 20]]);

  const bool = recorder();
  applyTypedDynamicFieldFilter(bool, { fieldType: 'BOOLEAN', values: ['true'] }, null);
  assert.deepEqual(bool.calls, [['where', ['or', ['cmp', 'boolValue', true]]]]);
});
