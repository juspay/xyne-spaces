import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SEARCH_TERMS,
  SEARCH_APP_SETS,
  buildSearchPath,
  selectSearchTerms,
} from '../k6/search-queries.mjs';

test('ships neutral default terms so a run needs no extra fixture fields', () => {
  assert.ok(DEFAULT_SEARCH_TERMS.length >= 3);
  for (const term of DEFAULT_SEARCH_TERMS) {
    assert.equal(typeof term, 'string');
    assert.ok(term.length > 0 && term.length <= 500);
  }
});

test('prefers fixture-supplied terms when the identity provides them', () => {
  assert.deepEqual(
    selectSearchTerms({ searchTerms: ['invoice', 'deployment'] }),
    ['invoice', 'deployment'],
  );
  assert.deepEqual(selectSearchTerms({}), DEFAULT_SEARCH_TERMS);
  assert.deepEqual(selectSearchTerms({ searchTerms: [] }), DEFAULT_SEARCH_TERMS);
});

test('exercises more than one app filter, since ACL cost varies by corpus', () => {
  assert.ok(SEARCH_APP_SETS.length >= 2);
  const allowed = new Set(['chat', 'ticket', 'user', 'file', 'collection', 'mail', 'xyneapp', 'call']);
  for (const set of SEARCH_APP_SETS) {
    for (const app of set.split(',')) assert.ok(allowed.has(app), app);
  }
});

test('builds a query string the Joi schema accepts', () => {
  // apps/backend/src/validators/vespaSearchValidator.ts: q required, limit 1-400, offset 0-1000
  assert.equal(
    buildSearchPath({ term: 'release notes', apps: 'chat,ticket', limit: 20, offset: 0 }),
    '/api/vespaSearch/?q=release%20notes&apps=chat%2Cticket&limit=20&offset=0',
  );
});

test('rejects a limit or offset the endpoint would refuse', () => {
  assert.throws(() => buildSearchPath({ term: 'x', apps: 'chat', limit: 401, offset: 0 }), /limit/i);
  assert.throws(() => buildSearchPath({ term: 'x', apps: 'chat', limit: 0, offset: 0 }), /limit/i);
  assert.throws(() => buildSearchPath({ term: 'x', apps: 'chat', limit: 20, offset: 1001 }), /offset/i);
});

test('rejects a term longer than the endpoint allows', () => {
  assert.throws(
    () => buildSearchPath({ term: 'x'.repeat(501), apps: 'chat', limit: 20, offset: 0 }),
    /500/,
  );
});
