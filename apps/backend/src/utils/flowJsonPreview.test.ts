jest.mock('@xyne/shared', () =>
  jest.requireActual('../../../../packages/shared/src/utils/flowCardLabel')
);

import { flowMessagePreviewText, flowMessageSearchText } from './flowJson';

const asMessage = (flow: unknown): string =>
  `<div data-flow-json="${JSON.stringify(flow).replace(/"/g, '&quot;')}">Flow JSON</div>`;

const agentDraft = asMessage({
  version: '2.0',
  screenId: 'agent-draft',
  components: [
    {
      id: 'agent',
      type: 'agent',
      props: {
        variant: 'draft',
        phase: 'pending',
        agent: { name: 'Weather Buddy', slug: 'weather-buddy' },
      },
    },
  ],
});

const textCard = asMessage({
  version: '2.0',
  screenId: 'note',
  components: [{ id: 't', type: 'text', props: { content: '*Deploy* finished' } }],
});

const emptyCard = asMessage({
  version: '2.0',
  screenId: 'x',
  components: [{ id: 'd', type: 'divider' }],
});

describe('flowMessagePreviewText (notifications)', () => {
  it('labels an agent card instead of returning the "Flow JSON" placeholder', () => {
    expect(flowMessagePreviewText(agentDraft)).toBe('🤖 Drafted an agent · Weather Buddy');
  });

  it('keeps text cards as their text', () => {
    expect(flowMessagePreviewText(textCard)).toBe('*Deploy* finished');
  });

  it('never returns "Flow JSON" for a card with nothing to say', () => {
    expect(flowMessagePreviewText(emptyCard)).toBe('Shared a card');
  });

  it('returns null for plain messages', () => {
    expect(flowMessagePreviewText('<p>hello</p>')).toBeNull();
  });
});

describe('flowMessageSearchText (search index, keyword alerts)', () => {
  it('indexes the card label for structured cards', () => {
    expect(flowMessageSearchText(agentDraft)).toBe('🤖 Drafted an agent · Weather Buddy');
  });

  it('indexes text cards by their text', () => {
    expect(flowMessageSearchText(textCard)).toBe('*Deploy* finished');
  });

  it('never indexes "Flow JSON"', () => {
    expect(flowMessageSearchText(emptyCard)).not.toContain('Flow JSON');
  });
});
