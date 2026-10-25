import { describe, expect, it } from 'vitest';

import { STARTER_SYSTEMS } from './index';
import { orderedPalette, parseDesignTokens } from '../designTokens';

describe('starter design systems', () => {
  it('ships the four advertised starters', () => {
    expect(STARTER_SYSTEMS.map(s => s.id)).toEqual(['modern', 'mono', 'vibrant', 'editorial']);
  });

  it.each(STARTER_SYSTEMS)('$name carries both files', starter => {
    expect(starter.designMd.trim().length).toBeGreaterThan(200);
    expect(starter.tokensCss.trim().length).toBeGreaterThan(200);
  });

  it.each(STARTER_SYSTEMS)('$name stays inside the runtime 32,000 character cap', starter => {
    expect(starter.designMd.length).toBeLessThanOrEqual(32_000);
  });

  it.each(STARTER_SYSTEMS)('$name parses into a usable specimen', starter => {
    const tokens = parseDesignTokens(starter.tokensCss);
    expect(tokens.isEmpty).toBe(false);
    expect(tokens.colors.length).toBeGreaterThanOrEqual(5);
    expect(tokens.fonts.length).toBeGreaterThanOrEqual(1);
    expect(tokens.colors.every(c => c.hex !== null || c.value.length > 0)).toBe(true);
  });

  it.each(STARTER_SYSTEMS)('$name resolves the roles the specimen renders from', starter => {
    const { colors } = parseDesignTokens(starter.tokensCss);
    const roles = new Set(colors.map(c => c.role).filter(Boolean));
    for (const role of ['background', 'text', 'accent', 'border']) {
      expect(roles).toContain(role);
    }
  });

  it.each(STARTER_SYSTEMS)('$name names a real font family', starter => {
    const { fonts } = parseDesignTokens(starter.tokensCss);
    expect(fonts.every(f => f.family.length > 0 && !f.family.includes(','))).toBe(true);
  });

  it('orders every starter palette without throwing', () => {
    for (const starter of STARTER_SYSTEMS) {
      const { colors } = parseDesignTokens(starter.tokensCss);
      expect(() => orderedPalette(colors)).not.toThrow();
    }
  });
});
