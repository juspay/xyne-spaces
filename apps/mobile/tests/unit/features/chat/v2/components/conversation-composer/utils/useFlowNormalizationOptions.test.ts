import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getCachedUserNames,
  getCachedChannelNames,
  getCachedGroupNames,
} from '@/src/features/chat/v2/components/conversation-composer/utils/useFlowNormalizationOptions';

describe('Flow normalization identity caches', () => {
  describe('getCachedUserNames', () => {
    it('builds a userId → displayName map', () => {
      const users = [
        { id: 'u1', displayName: 'Alice', name: null, email: null },
        { id: 'u2', displayName: null, name: 'Bob', email: null },
        { id: 'u3', displayName: null, name: null, email: 'carol@example.com' },
      ];

      const map = getCachedUserNames(users);

      assert.equal(map.get('u1'), 'Alice');
      assert.equal(map.get('u2'), 'Bob');
      assert.equal(map.get('u3'), 'carol@example.com');
    });

    it('falls back to "Unknown" when no identity fields are present', () => {
      const map = getCachedUserNames([{ id: 'u1', displayName: null, name: null, email: null }]);

      assert.equal(map.get('u1'), 'Unknown');
    });

    it('returns the same Map reference for the same input array (WeakMap cache)', () => {
      const users = [{ id: 'u1', displayName: 'Alice', name: null, email: null }];

      const first = getCachedUserNames(users);
      const second = getCachedUserNames(users);

      assert.equal(first, second);
    });

    it('returns a new Map reference when the input array changes', () => {
      const users1 = [{ id: 'u1', displayName: 'Alice', name: null, email: null }];
      const users2 = [{ id: 'u1', displayName: 'Alice', name: null, email: null }];

      const first = getCachedUserNames(users1);
      const second = getCachedUserNames(users2);

      assert.notEqual(first, second);
    });
  });

  describe('getCachedChannelNames', () => {
    it('builds a channelId → name map', () => {
      const channels = [
        { id: 'c1', name: 'general' },
        { id: 'c2', name: 'engineering' },
      ];

      const map = getCachedChannelNames(channels);

      assert.equal(map.get('c1'), 'general');
      assert.equal(map.get('c2'), 'engineering');
    });

    it('returns the same Map reference for the same input array', () => {
      const channels = [{ id: 'c1', name: 'general' }];

      assert.equal(getCachedChannelNames(channels), getCachedChannelNames(channels));
    });
  });

  describe('getCachedGroupNames', () => {
    it('builds a groupId → name map, preferring alias over name', () => {
      const groups = [
        { id: 'g1', name: 'Developers', alias: 'devs' },
        { id: 'g2', name: 'Designers', alias: null },
        { id: 'g3', name: null, alias: null },
      ];

      const map = getCachedGroupNames(groups);

      assert.equal(map.get('g1'), 'devs');
      assert.equal(map.get('g2'), 'Designers');
      assert.equal(map.get('g3'), 'g3');
    });

    it('returns the same Map reference for the same input array', () => {
      const groups = [{ id: 'g1', name: 'Devs', alias: null }];

      assert.equal(getCachedGroupNames(groups), getCachedGroupNames(groups));
    });
  });
});
