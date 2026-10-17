import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { parseInlineRich as parseLegacyInlineRich } from '@/src/components/conversation-composer/utils/parseInlineRich';
import { parseInlineRich } from '@/src/features/chat/v2/components/conversation-composer/utils/parseInlineRich';

const expectedBoldItalicTree = [
  {
    type: 'strong',
    children: [
      {
        type: 'em',
        children: [{ type: 'text', text: 'Test' }],
      },
    ],
  },
];

const expectedCombinedLinkedTree = [
  {
    type: 'link',
    href: 'https://example.com',
    children: [
      {
        type: 'strong',
        children: [
          {
            type: 'em',
            children: [
              {
                type: 'underline',
                children: [
                  {
                    type: 'strike',
                    children: [{ type: 'text', text: 'Test' }],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  },
];

describe('parseInlineRich', () => {
  it('computes triple-star markdown as nested bold and italic', () => {
    assert.deepEqual(parseInlineRich('***Test***'), expectedBoldItalicTree);
  });

  it('keeps the legacy inline parser aligned for triple-star markdown', () => {
    assert.deepEqual(parseLegacyInlineRich('***Test***'), expectedBoldItalicTree);
  });

  it('preserves identifier underscores in both chat parsers', () => {
    const input = 'legal_entities TO ardra_read,ardra_app_ro;';
    const expected = [{ type: 'text', text: input }];

    assert.deepEqual(parseInlineRich(input), expected);
    assert.deepEqual(parseLegacyInlineRich(input), expected);
  });

  it('still supports explicit nested bold and italic delimiters', () => {
    assert.deepEqual(parseInlineRich('**_Test_**'), expectedBoldItalicTree);
  });

  it('keeps explicit underscore emphasis in both chat parsers', () => {
    const expected = [{ type: 'em', children: [{ type: 'text', text: 'Test' }] }];

    assert.deepEqual(parseInlineRich('_Test_'), expected);
    assert.deepEqual(parseLegacyInlineRich('_Test_'), expected);
  });

  it('computes combined bold italic underline strike inside links', () => {
    assert.deepEqual(
      parseInlineRich('[***__~~Test~~__***](https://example.com)'),
      expectedCombinedLinkedTree,
    );
  });
});
