import { describe, expect, it } from 'vitest';
import { sanitizeAgentCanvasName } from './canvasFromIdentity';

describe('sanitizeAgentCanvasName', () => {
  it('keeps the space being typed between words', () => {
    expect(sanitizeAgentCanvasName('Morning ')).toBe('Morning ');
    expect(sanitizeAgentCanvasName('Morning Ticket')).toBe('Morning Ticket');
  });

  it('still strips what a model wraps a name in', () => {
    expect(sanitizeAgentCanvasName('**Name:** Ticket Sorter')).toBe('Ticket Sorter');
    expect(sanitizeAgentCanvasName('- Ticket Sorter.')).toBe('Ticket Sorter');
    expect(sanitizeAgentCanvasName('   ')).toBe('');
  });
});
