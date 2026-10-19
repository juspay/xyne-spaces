import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

vi.mock('react-router-dom', () => ({ useNavigate: () => () => {} }));
vi.mock('../../Chat/RenderMessageWithHTML/RenderMessageWithHTML', () => ({
  MentionRenderer: () => null,
  ChannelMentionRenderer: () => null,
  GroupMentionRenderer: () => null,
}));
vi.mock('../../ui/GenericMentionPopover/GenericMentionPopover', () => ({
  GenericMentionHoverPopover: () => null,
}));
vi.mock('../../../hooks/useChannels', () => ({ useChannel: () => undefined }));
vi.mock('../../../hooks/useCustomEmojis', () => ({ useCustomEmojis: () => ({ data: [] }) }));
vi.mock('../../../hooks/useUserGroup', () => ({ useUserGroupById: () => undefined }));
vi.mock('../../../utils/emojiLookup', () => ({
  findUnicodeEmoji: () => undefined,
  preloadEmojiData: () => {},
}));
vi.mock('../../../utils/emojiSearch', () => ({ unifiedToNative: () => '' }));

import { TableNode } from './TableNode';
import { TextNode } from './TextNode';

describe('TableNode cell numbering', () => {
  it('renders numbered cell text literally instead of as a one-item list', () => {
    const html = renderToStaticMarkup(
      <TableNode
        node={{
          id: 't',
          type: 'table',
          props: {
            rows: [
              ['1. rapido', 'Jul 30'],
              ['8. Amazon', 'Jul 30'],
              ['27. Coco Koramangala', 'Jul 29'],
            ],
          },
        }}
      />,
    );
    expect(html).not.toContain('<ol');
    expect(html).toContain('8. Amazon');
    expect(html).toContain('27. Coco Koramangala');
  });
});

describe('TextNode ordered lists', () => {
  it('keeps the starting number of an ordered list', () => {
    const html = renderToStaticMarkup(
      <TextNode
        node={{ id: 'x', type: 'text', props: { content: 'Intro\n8. Amazon\n9. Instamart' } }}
      />,
    );
    expect(html).toContain('<ol start="8"');
  });

  it('omits start for lists beginning at 1', () => {
    const html = renderToStaticMarkup(
      <TextNode node={{ id: 'x', type: 'text', props: { content: 'Intro\n1. a\n2. b' } }} />,
    );
    expect(html).toContain('<ol class=');
    expect(html).not.toContain('start=');
  });
});
