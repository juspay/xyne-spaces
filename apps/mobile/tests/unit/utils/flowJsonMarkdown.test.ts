import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  flowComponentsToMarkdown,
  flowDefinitionToMarkdown,
  isFlowJsonHtml,
  normalizeFlowTextToMarkdown,
  parseFlowJsonDefinitions,
  parseFlowJsonParts,
  replaceEmojiShortcodesWithMarkdown,
  sanitizeFlowUrl,
  type FlowDefinitionLike,
} from '@/src/utils/flowJsonMarkdown';

const toFlowHtml = (flow: Record<string, unknown>): string =>
  `<div data-flow-json="${JSON.stringify(flow).replaceAll('"', '&quot;')}">Flow JSON</div>`;

describe('FlowJSON mobile normalization', () => {
  it('keeps ordered items at one level when Flow text contains incidental indentation', () => {
    const markdown = flowComponentsToMarkdown([
      {
        type: 'text',
        props: { content: ['1. First', '  2. Second', '  3. Third'].join('\n') },
      },
    ]);

    assert.equal(markdown, ['1. First', '2. Second', '3. Third'].join('\n'));
  });

  it('keeps ordered items aligned across separate Flow text components', () => {
    const markdown = flowComponentsToMarkdown([
      { type: 'text', props: { content: '1. First' } },
      { type: 'text', props: { content: '   2. Second' } },
      { type: 'text', props: { content: '  3. Third' } },
    ]);

    assert.equal(markdown, ['1. First', '2. Second', '3. Third'].join('\n\n'));
  });

  it('preserves message formatting, mentions, emoji, code, controls and blocks', () => {
    const flow = {
      version: '2.0',
      screenId: 'screen-1',
      components: [
        {
          type: 'text',
          props: {
            content:
              '*bold* ~strike~ <userid:user-1> <channelid:channel-1> :alert: <https://example.com|link>',
          },
        },
        { type: 'text', props: { content: '<userid:user-1>', codeBlock: true } },
        {
          type: 'table',
          props: {
            rows: [
              ['Name', 'Value'],
              ['A', 'B'],
            ],
            hasHeader: true,
          },
        },
        { type: 'button', props: { label: 'Acknowledge' } },
        { type: 'divider' },
      ],
    };

    const [definition] = parseFlowJsonDefinitions(toFlowHtml(flow));
    const markdown = flowComponentsToMarkdown(definition?.components, {
      userNames: new Map([['user-1', 'Raghunandhan V']]),
      channelNames: new Map([['channel-1', 'server-side-dotp']]),
    });

    assert.match(markdown, /\*\*bold\*\*/);
    assert.match(markdown, /~~strike~~/);
    assert.match(markdown, /\[@Raghunandhan V\]\(xyne:\/\/user\/user-1\)/);
    assert.match(markdown, /\[#server-side-dotp\]\(xyne:\/\/channel\/channel-1\)/);
    assert.match(markdown, /⚠️/);
    assert.match(markdown, /\[link\]\(https:\/\/example\.com\)/);
    assert.match(markdown, /```\n@Raghunandhan V\n```/);
    assert.match(markdown, /\| Name \| Value \|/);
    assert.match(markdown, /Acknowledge/);
    assert.doesNotMatch(markdown, /Button:/);
    assert.match(markdown, /---/);
  });

  it('recognizes every embedded FlowJSON wrapper', () => {
    const first = { version: '2.0', screenId: 'one', components: [] };
    const second = { version: '2.0', screenId: 'two', components: [] };
    const html = `before ${toFlowHtml(first).replace('Flow JSON', 'rendered')} middle ${toFlowHtml(second)} after`;

    assert.equal(isFlowJsonHtml(html), true);
    assert.deepEqual(
      parseFlowJsonDefinitions(html).map(definition => definition.screenId),
      ['one', 'two'],
    );
    assert.deepEqual(
      parseFlowJsonParts(html).map(part => part.type),
      ['html', 'flow', 'html', 'flow', 'html'],
    );
  });

  it('rejects malformed component trees instead of handing them to the renderer', () => {
    const malformed = toFlowHtml({
      version: '2.0',
      screenId: 'malformed',
      components: [null],
    });

    assert.equal(isFlowJsonHtml(malformed), false);
    assert.deepEqual(parseFlowJsonDefinitions(malformed), []);
  });

  it('normalizes raw Flow mention tokens before native Markdown sees them', () => {
    const markdown = normalizeFlowTextToMarkdown('<userid:user-1> :alert: *important*', {
      userNames: new Map([['user-1', 'Deepanshu Kumar']]),
    });

    assert.equal(markdown, '[@Deepanshu Kumar](xyne://user/user-1) ⚠️ **important**');
  });

  it('prefers live identity data over an embedded mention label', () => {
    assert.equal(
      normalizeFlowTextToMarkdown('<userid:user-1:Stale Name>', {
        userNames: new Map([['user-1', 'Live Name']]),
      }),
      '[@Live Name](xyne://user/user-1)',
    );
  });
});

describe('flowDefinitionToMarkdown mention resolution', () => {
  const definition: FlowDefinitionLike = {
    version: '2.0',
    screenId: 'mention-test',
    components: [
      {
        type: 'text',
        props: {
          content:
            'Hello <userid:user-1>, please check <channelid:channel-1> and ask <userid:user-2:Bob>.',
        },
      },
    ],
  };

  it('falls back to raw user ID when no identity options are provided', () => {
    const markdown = flowDefinitionToMarkdown(definition);

    assert.match(markdown, /\[@user-1\]\(xyne:\/\/user\/user-1\)/);
    assert.match(markdown, /\[#channel-1\]\(xyne:\/\/channel\/channel-1\)/);
    assert.match(markdown, /\[@Bob\]\(xyne:\/\/user\/user-2\)/);
  });

  it('resolves mention IDs to display names when identity options are provided', () => {
    const markdown = flowDefinitionToMarkdown(definition, {
      userNames: new Map([
        ['user-1', 'Alice Sharma'],
        ['user-2', 'Bob Verma'],
      ]),
      channelNames: new Map([['channel-1', 'engineering']]),
    });

    assert.match(markdown, /\[@Alice Sharma\]\(xyne:\/\/user\/user-1\)/);
    assert.match(markdown, /\[#engineering\]\(xyne:\/\/channel\/channel-1\)/);
    assert.match(markdown, /\[@Bob Verma\]\(xyne:\/\/user\/user-2\)/);
    assert.doesNotMatch(markdown, /@user-1/);
    assert.doesNotMatch(markdown, /@user-2/);
  });

  it('prefers live identity data over embedded mention labels', () => {
    const markdown = flowDefinitionToMarkdown(definition, {
      userNames: new Map([['user-2', 'Robert Verma']]),
    });

    assert.match(markdown, /\[@Robert Verma\]\(xyne:\/\/user\/user-2\)/);
    assert.doesNotMatch(markdown, /@Bob\b/);
  });

  it('projects a write-approval card without a Button: prefix', () => {
    const markdown = flowComponentsToMarkdown([
      { type: 'text', props: { content: 'The agent wants to execute:' } },
      {
        type: 'card',
        style: { maxHeight: '280px', overflowY: 'auto' },
        children: [
          {
            type: 'text',
            props: {
              content: [
                '*create-agent*',
                '',
                '*name:* Spaces Teammate',
                '*systemPrompt:* Be useful when useful and i',
              ].join('\n'),
            },
          },
        ],
      },
      {
        type: 'row',
        children: [
          { type: 'button', props: { label: '✓  Approve' } },
          { type: 'button', props: { label: '✓  Approve & Continue' } },
          { type: 'button', props: { label: '✕  Decline' } },
        ],
      },
    ]);

    assert.match(markdown, /The agent wants to execute:/);
    assert.match(markdown, /create-agent/);
    assert.match(markdown, /\*\*✓ {2}Approve\*\*/);
    assert.match(markdown, /Approve & Continue/);
    assert.match(markdown, /Decline/);
    assert.doesNotMatch(markdown, /Button:/);
  });

  it('can omit buttons so a collapsed preview does not duplicate the live action row', () => {
    const markdown = flowComponentsToMarkdown(
      [
        { type: 'text', props: { content: 'The agent wants to execute:' } },
        {
          type: 'row',
          children: [
            { type: 'button', props: { label: '✓  Approve' } },
            { type: 'button', props: { label: '✕  Decline' } },
          ],
        },
      ],
      { omitButtons: true },
    );

    assert.match(markdown, /The agent wants to execute:/);
    assert.doesNotMatch(markdown, /Approve/);
    assert.doesNotMatch(markdown, /Decline/);
  });

  it('projects diff components for collapsed previews', () => {
    const markdown = flowComponentsToMarkdown([
      {
        type: 'diff',
        props: {
          path: 'src/example.ts',
          patch: ['@@ -1 +1 @@', '-old', '+new'].join('\n'),
        },
      },
    ]);

    assert.match(markdown, /\*\*src\/example\.ts\*\* \(\+1 −1\)/);
    assert.match(markdown, /```diff/);
    assert.match(markdown, /\+new/);
    assert.match(markdown, /-old/);
  });

  it('projects write-approval flows through the dedicated flow markdown path', () => {
    const markdown = flowDefinitionToMarkdown({
      version: '2.0',
      screenId: 'write-approval-1',
      title: 'Action Approval',
      components: [
        { type: 'text', props: { content: 'The agent wants to execute:' } },
        {
          type: 'card',
          children: [
            {
              type: 'text',
              props: { content: '*create-agent*\n\n*name:* Spaces Teammate' },
            },
          ],
        },
        {
          type: 'row',
          children: [
            {
              type: 'button',
              props: {
                label: '✓  Approve',
                action: { type: 'submit', actionId: 'approve-write' },
              },
            },
            {
              type: 'button',
              props: {
                label: '✕  Decline',
                action: { type: 'submit', actionId: 'decline-write' },
              },
            },
          ],
        },
      ],
      data: { actionType: 'write', tool: 'update-agent' },
    });

    assert.match(markdown, /# Action Approval/);
    assert.match(markdown, /create-agent/);
    assert.match(markdown, /\*\*✓ {2}Approve\*\*/);
    assert.doesNotMatch(markdown, /Button:/);
  });

  it('produces identical output for the same definition and options (cache safety)', () => {
    const options = {
      userNames: new Map([['user-1', 'Alice']]),
      channelNames: new Map([['channel-1', 'eng']]),
    };

    const first = flowDefinitionToMarkdown(definition, options);
    const second = flowDefinitionToMarkdown(definition, options);

    assert.equal(first, second);
  });
});

describe('replaceEmojiShortcodesWithMarkdown', () => {
  it('turns catalog shortcodes into xemoji placeholders', () => {
    const markdown = replaceEmojiShortcodesWithMarkdown('ship :logo: please', {
      customEmojis: new Map([['logo', { id: 'e1', name: 'logo' }]]),
    });
    assert.equal(markdown, 'ship xemoji:e1:logo:emojix please');
  });

  it('leaves unknown shortcodes and existing xemoji markers alone', () => {
    const markdown = replaceEmojiShortcodesWithMarkdown('xemoji:e1:logo:emojix and :missing:', {
      customEmojis: new Map([['logo', { id: 'e1', name: 'logo' }]]),
    });
    assert.equal(markdown, 'xemoji:e1:logo:emojix and :missing:');
  });
});

describe('sanitizeFlowUrl', () => {
  it('removes trailing backslash and %5C escape artifacts', () => {
    assert.equal(
      sanitizeFlowUrl('https://github.com/org/repo/pull/329\\'),
      'https://github.com/org/repo/pull/329',
    );
    assert.equal(
      sanitizeFlowUrl('https://github.com/org/repo/pull/329%5C'),
      'https://github.com/org/repo/pull/329',
    );
    assert.equal(
      sanitizeFlowUrl('  https://github.com/org/repo/compare/a...b \\ '),
      'https://github.com/org/repo/compare/a...b',
    );
  });

  it('leaves clean urls unchanged', () => {
    assert.equal(
      sanitizeFlowUrl('https://github.com/org/repo/pull/329'),
      'https://github.com/org/repo/pull/329',
    );
    assert.equal(
      sanitizeFlowUrl('https://github.com/org/repo/issues?q=is%3Aopen'),
      'https://github.com/org/repo/issues?q=is%3Aopen',
    );
  });

  it('renders flow link components with a cleaned href', () => {
    const markdown = flowComponentsToMarkdown([
      {
        type: 'link',
        props: { label: 'Open in GitHub', href: 'https://github.com/org/repo/pull/329\\' },
      },
    ]);
    assert.equal(markdown, '[Open in GitHub](https://github.com/org/repo/pull/329)');
  });
});
