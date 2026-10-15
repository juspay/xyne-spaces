import assert from 'node:assert/strict';
import test from 'node:test';

import {
  DEFAULT_SEARCH_TERMS,
  SEARCH_APP_SETS,
  buildSearchPath,
  selectSearchTerms,
  isGroupedSearch,
  searchResults,
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

test('reads rows from a flat single-app response', () => {
  const body = { success: true, data: { results: [{ id: 'a' }], totalCount: 1 } };
  assert.equal(isGroupedSearch(body), false);
  assert.deepEqual(searchResults(body), [{ id: 'a' }]);
});

test('flattens rows from a grouped multi-app response', () => {
  // apps/backend/src/services/vespaSearch/index.ts, grouped branch of searchHandler.
  const body = {
    success: true,
    data: {
      grouped: true,
      groups: [
        { groupBy: 'docType', groupValue: 'chat', count: 2, results: [{ id: 'c1' }, { id: 'c2' }] },
        { groupBy: 'docType', groupValue: 'ticket', count: 1, results: [{ id: 't1' }] },
      ],
      totalCount: 3,
    },
  };
  assert.equal(isGroupedSearch(body), true);
  assert.deepEqual(searchResults(body), [{ id: 'c1' }, { id: 'c2' }, { id: 't1' }]);
});

test('reports no rows for a response of neither shape', () => {
  assert.equal(searchResults({ success: true, data: {} }), undefined);
  assert.equal(searchResults({ success: true, data: { grouped: true } }), undefined);
  assert.equal(searchResults(null), undefined);
});
