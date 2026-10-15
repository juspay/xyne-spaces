import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  formatCallSuggestedTicketsMarkdown,
  isCallSuggestedTicketsMessage,
} from '@/src/utils/callSuggestedTicketsMarkdown';

describe('isCallSuggestedTicketsMessage', () => {
  it('returns true for the recognised subtype or flag', () => {
    assert.equal(isCallSuggestedTicketsMessage({ messageSubtype: 'call_suggested_tickets' }), true);
    assert.equal(isCallSuggestedTicketsMessage({ hasSuggestedTickets: true }), true);
  });

  it('returns false for other metadata shapes', () => {
    assert.equal(isCallSuggestedTicketsMessage({ messageSubtype: 'plain' }), false);
    assert.equal(isCallSuggestedTicketsMessage({ hasSuggestedTickets: false }), false);
    assert.equal(isCallSuggestedTicketsMessage({}), false);
  });

  it('returns false for non-object input', () => {
    assert.equal(isCallSuggestedTicketsMessage(null), false);
    assert.equal(isCallSuggestedTicketsMessage(undefined), false);
    assert.equal(isCallSuggestedTicketsMessage('call_suggested_tickets'), false);
  });
});

describe('formatCallSuggestedTicketsMarkdown', () => {
  it('returns null when there is no YAML frontmatter', () => {
    assert.equal(formatCallSuggestedTicketsMarkdown('just some text'), null);
  });

  it('returns null when frontmatter has no suggestions', () => {
    assert.equal(formatCallSuggestedTicketsMarkdown('---\ntitle: hi\n---\n'), null);
  });

  it('renders a suggestion with a capitalised priority label and assignee', () => {
    const input = [
      '---',
      'suggestions:',
      '  - title: Fix login',
      '    priority: high',
      '    assignee: Alice',
      '    description: Login is broken',
      '---',
      '',
    ].join('\n');

    const out = formatCallSuggestedTicketsMarkdown(input);
    assert.ok(out, 'expected non-null markdown');
    assert.ok(out!.startsWith('## Suggested Tickets'));
    assert.ok(out!.includes('**1. Fix login**'));
    assert.ok(out!.includes('*High \u00b7 Alice*'));
    assert.ok(out!.includes('Login is broken'));
  });

  it('separates multiple suggestions with a horizontal rule', () => {
    const input = [
      '---',
      'suggestions:',
      '  - title: First',
      '    priority: low',
      '  - title: Second',
      '    priority: critical',
      '---',
      '',
    ].join('\n');

    const out = formatCallSuggestedTicketsMarkdown(input);
    assert.ok(out, 'expected non-null markdown');
    assert.ok(out!.includes('**1. First**'));
    assert.ok(out!.includes('**2. Second**'));
    assert.ok(out!.includes('*Low*'));
    assert.ok(out!.includes('*Critical*'));
    assert.ok(out!.includes('\n---\n'));
  });
});
