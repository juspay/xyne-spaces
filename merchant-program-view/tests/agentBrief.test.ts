import { describe, expect, it } from 'vitest';
import { merchantBrief, type MerchantLine } from '../lib/agentBrief';

describe('merchantBrief', () => {
  const line = (key: string, over: Partial<MerchantLine> = {}): MerchantLine => ({
    key, title: `Title ${key}`, kind: 'Board', stage: 'IN DEV', open: true, age: 10, idle: 2, flag: null, who: 'Lisa Roy', ...over,
  });
  const b = merchantBrief('savana', [
    line('C-1', { open: false, stage: 'Done', age: 40 }),
    line('A-1', { age: 5, flag: 'Stage ETA breached' }),
    line('B-1', { age: 90, who: null }),
  ]);

  it('asks for a short formatted TL;DR, read-only', () => {
    expect(b.task).toContain('savana');
    expect(b.task).toMatch(/200.300 characters/);
    expect(b.task).toMatch(/bullet/i);
    expect(b.task).toMatch(/read-only/i);
  });

  it('lists open tickets oldest first, then closed, one line each', () => {
    expect(b.context).toContain('savana: 3 tickets, 2 open');
    const at = (k: string) => b.context.indexOf(k);
    expect(at('B-1')).toBeLessThan(at('A-1'));
    expect(at('A-1')).toBeLessThan(at('C-1'));
    expect(b.context).toContain('A-1 · Title A-1 · Board · IN DEV · open 5d · no update 2d · Lisa Roy · Stage ETA breached');
    expect(b.context).toContain('B-1 · Title B-1 · Board · IN DEV · open 90d · no update 2d · unassigned');
    expect(b.context).toContain('C-1 · Title C-1 · Board · Done · closed');
  });

  it('caps very long ticket lists', () => {
    const many = merchantBrief('m', Array.from({ length: 150 }, (_, i) => line(`K-${i}`)));
    expect(many.context).toContain('90 more tickets left out');
  });
});
