import { describe, expect, it } from 'vitest';
import { botAvatarTypes } from 'bot-avatars';
import { botSeedForKey, botTypeForKey } from './agentBotShape';

describe('botTypeForKey', () => {
  it('keeps the same shape for the same agent', () => {
    expect(botTypeForKey('inbox')).toBe(botTypeForKey('inbox'));
  });

  it('only returns library body types', () => {
    const keys = ['', 'a', 'chief', 'night-shift', 'talent scout'];
    for (const key of keys) {
      expect(botAvatarTypes).toContain(botTypeForKey(key));
    }
  });
});

describe('botSeedForKey', () => {
  it('stays inside 0–1 and differs across agents', () => {
    const chief = botSeedForKey('chief');
    const scout = botSeedForKey('talent-scout');
    expect(chief).toBeGreaterThanOrEqual(0);
    expect(chief).toBeLessThan(1);
    expect(chief).not.toBe(scout);
  });
});
