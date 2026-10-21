import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  createNameSearch,
  createPeopleSearch,
} from '@/src/features/global-search/utils/directory-search';

function person(name: string, email = `${name.toLowerCase().replaceAll(' ', '.')}@example.com`) {
  return { name, email };
}

function names(items: readonly { name: string }[]): string[] {
  return items.map(item => item.name);
}

describe('global search directory search', () => {
  describe('people', () => {
    const people = [
      person('Maria Anders'),
      person('Anand Rao'),
      person('Joanna Smith'),
      person('Bob Stone', 'ana.stone@example.com'),
      person('Zed Quill'),
    ];

    it('returns the first rows in order when nothing is typed', () => {
      const search = createPeopleSearch(people);

      assert.deepEqual(names(search('', 2)), ['Maria Anders', 'Anand Rao']);
      assert.deepEqual(names(search('   ', 2)), ['Maria Anders', 'Anand Rao']);
    });

    it('ranks a name prefix first, then a word boundary, then an email prefix', () => {
      const search = createPeopleSearch(people);

      assert.deepEqual(names(search('an', 10)).slice(0, 3), [
        'Anand Rao',
        'Maria Anders',
        'Bob Stone',
      ]);
    });

    it('ignores case', () => {
      const search = createPeopleSearch(people);

      assert.equal(names(search('ANAND', 10))[0], 'Anand Rao');
    });

    it('leaves out people who do not match', () => {
      const search = createPeopleSearch(people);

      assert.ok(!names(search('anand', 10)).includes('Zed Quill'));
    });

    it('honours the limit', () => {
      const search = createPeopleSearch(people);

      assert.equal(search('an', 1).length, 1);
    });

    it('breaks ties by name', () => {
      const search = createPeopleSearch([person('Sam Bravo'), person('Sam Alpha')]);

      assert.deepEqual(names(search('sam', 10)), ['Sam Alpha', 'Sam Bravo']);
    });

    it('gives the same answer every time it is asked', () => {
      const search = createPeopleSearch(people);

      assert.deepEqual(search('an', 10), search('an', 10));
    });
  });

  describe('names', () => {
    const channels = [
      { id: 'c1', name: 'backend-eng' },
      { id: 'c2', name: 'engineering' },
      { id: 'c3', name: 'team eng' },
      { id: 'c4', name: 'random' },
    ];

    it('ranks a prefix first, then a word boundary, then a match anywhere', () => {
      const search = createNameSearch(channels);

      assert.deepEqual(names(search('eng', 10)), ['engineering', 'team eng', 'backend-eng']);
    });

    it('keeps the fields it was given', () => {
      const search = createNameSearch(channels);

      assert.equal(search('random', 10)[0]?.id, 'c4');
    });

    it('returns nothing when nothing matches', () => {
      const search = createNameSearch(channels);

      assert.deepEqual(search('zzzz', 10), []);
    });
  });
});
