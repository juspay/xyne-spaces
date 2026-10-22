import { describe, expect, it } from 'vitest';
import { getFlowJsonPreviewText } from '../flowPreview';

const asMessage = (flow: unknown): string =>
  `<div data-flow-json="${JSON.stringify(flow).replace(/"/g, '&quot;')}">Flow JSON</div>`;

const card = (type: string, props: Record<string, unknown>, extra: Record<string, unknown> = {}) =>
  asMessage({ version: '2.0', screenId: 's', components: [{ id: 'c', type, props }], ...extra });

describe('getFlowJsonPreviewText', () => {
  it('returns null for a message that is not a flow', () => {
    expect(getFlowJsonPreviewText('<p>hello</p>')).toBeNull();
  });

  it('labels a PR card instead of showing its raw fields', () => {
    expect(
      getFlowJsonPreviewText(
        card('pr', {
          status: 'merged',
          provider: 'github',
          title: 'Fix login',
          desc: 'long body',
          url: 'https://github.com/a/b/pull/9',
        }),
      ),
    ).toBe('🔀 PR #9 · merged · Fix login');
  });

  it('labels an agent draft card', () => {
    expect(
      getFlowJsonPreviewText(
        card('agent', {
          variant: 'draft',
          phase: 'pending',
          agent: { name: 'Weather', slug: 'w' },
        }),
      ),
    ).toBe('🤖 Drafted an agent · Weather');
  });

  it('keeps the richer plan preview', () => {
    expect(
      getFlowJsonPreviewText(
        card('plan', { title: 'Rollout', desc: 'Ship it', todos: [{ text: 'Step one' }] }),
      ),
    ).toBe('Ship it — Step one');
  });

  it('keeps text cards as their text', () => {
    expect(getFlowJsonPreviewText(card('text', { content: '*Build* passed' }))).toBe(
      'Build passed',
    );
  });

  it('never falls back to "Flow JSON"', () => {
    expect(getFlowJsonPreviewText(card('divider', {}))).toBe('Shared a card');
    expect(getFlowJsonPreviewText(card('divider', {}, { title: 'Weekly report' }))).toBe(
      'Weekly report',
    );
    expect(getFlowJsonPreviewText('<div data-flow-json="{broken">Flow JSON</div>')).toBe(
      'Shared a card',
    );
  });
});
