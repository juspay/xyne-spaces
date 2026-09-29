import { describe, expect, it } from 'vitest';
import { faceIndexFor } from './AgentFace';
import { AGENT_FACES } from './agentFaces.data';

describe('faceIndexFor', () => {
  it('keeps the same face for the same agent', () => {
    expect(faceIndexFor('inbox')).toBe(faceIndexFor('inbox'));
  });

  it('only returns indexes of the ten faces', () => {
    const keys = ['', 'a', 'chief', 'night-shift', 'talent scout', 'a'.repeat(200)];
    for (const key of keys) {
      const index = faceIndexFor(key);
      expect(Number.isInteger(index)).toBe(true);
      expect(index).toBeGreaterThanOrEqual(0);
      expect(index).toBeLessThan(AGENT_FACES.length);
    }
  });
});
