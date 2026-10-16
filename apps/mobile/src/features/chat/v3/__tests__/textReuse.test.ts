import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { MessageType } from '@xyne/shared';

import { getConversationKind as v2Kind } from '@/src/features/chat/v2/components/conversation-composer/utils/getConversationKind';
import { getConversationReactionsMd as v2Reactions } from '@/src/features/chat/v2/components/conversation-composer/utils/getConversationReactionsMd';
import {
  getLongMessageCollapseModel as v2Collapse,
  shouldCollapseMessageBody as v2ShouldCollapse,
} from '@/src/features/chat/v2/components/conversation-composer/utils/longMessageCollapse';
import { stripMarkdownForPreview as v2Strip } from '@/src/features/chat/v2/components/conversation-composer/utils/markdownPreview';
import { MENTION_USER_SCHEME as v2Mention } from '@/src/features/chat/v2/components/conversation-composer/utils/mentionSchemes';
import { parseInlineRich as v2Inline } from '@/src/features/chat/v2/components/conversation-composer/utils/parseInlineRich';
import { parseCustomEmojiMarkdownSegments as v2Emoji } from '@/src/features/chat/v2/components/conversation-composer/utils/parseCustomEmojiMarkdownSegments';
import { convertHtmlListsToMarkdown as v2HtmlLists } from '@/src/features/chat/v2/components/conversation-composer/utils/htmlListsToMarkdown';

import { getConversationKind } from '../model/text/getConversationKind';
import { getConversationReactionsMd } from '../model/text/getConversationReactionsMd';
import { convertHtmlListsToMarkdown } from '../model/text/htmlListsToMarkdown';
import { extractEmojiIds, htmlToMD } from '../model/text/htmlToMD';
import {
  getLongMessageCollapseModel,
  shouldCollapseMessageBody,
} from '../model/text/longMessageCollapse';
import { stripMarkdownForPreview } from '../model/text/markdownPreview';
import { MENTION_USER_SCHEME } from '../model/text/mentionSchemes';
import { parseInlineRich } from '../model/text/parseInlineRich';
import { parseCustomEmojiMarkdownSegments } from '../model/text/parseCustomEmojiMarkdownSegments';
import { getUserColorIndex } from '../model/text/getUserColor';

const MD =
  'Hello **world** and [Ada](xyne://user/u1)\n\n1. one\n2. two\n3. three\n4. four\n5. five\n6. six\n7. seven\n8. eight\n9. nine\n10. ten\n11. eleven\n12. twelve\n13. thirteen\n14. fourteen\n15. fifteen\n16. sixteen\n17. seventeen\n18. eighteen';
const EMOJI_MD = 'hi xemoji:e1:wave:emojix there';

describe('§8.1 characterisation against v2', (): void => {
  it('htmlListsToMarkdown matches v2', (): void => {
    const html = '<ul><li>a</li><li>b</li></ul>';
    assert.equal(convertHtmlListsToMarkdown(html), v2HtmlLists(html));
  });

  it('markdownPreview matches v2', (): void => {
    assert.equal(stripMarkdownForPreview(MD), v2Strip(MD));
  });

  it('parseInlineRich matches v2', (): void => {
    assert.deepEqual(parseInlineRich('Hello **Ada**'), v2Inline('Hello **Ada**'));
  });

  it('parseCustomEmojiMarkdownSegments matches v2', (): void => {
    assert.deepEqual(parseCustomEmojiMarkdownSegments(EMOJI_MD), v2Emoji(EMOJI_MD));
  });

  it('longMessageCollapse matches v2', (): void => {
    const args = { markdown: MD, maxWidth: 280, viewportHeight: 760 };
    const v3Model = getLongMessageCollapseModel(args);
    const v2Model = v2Collapse(args);
    assert.deepEqual(v3Model, v2Model);
    for (const kind of ['BOT', 'SYSTEM', 'USER']) {
      assert.equal(shouldCollapseMessageBody(v3Model, kind), v2ShouldCollapse(v2Model, kind));
    }
  });

  it('mentionSchemes match v2', (): void => {
    assert.equal(MENTION_USER_SCHEME, v2Mention);
  });

  it('getConversationKind matches v2', (): void => {
    const summary = { msgType: MessageType.BOT, senderId: 'bot', messageId: 'm' } as Parameters<
      typeof v2Kind
    >[0];
    assert.equal(getConversationKind(summary, 'me'), v2Kind(summary, 'me'));
  });

  it('getConversationReactionsMd matches v2 on the fields it reads', (): void => {
    const conv = { reactionsMd: ':wave:' };
    assert.equal(
      getConversationReactionsMd(conv),
      v2Reactions({ ['reactions_md']: ':wave:' } as never),
    );
  });

  it('getUserColorIndex is stable (v2 hook dropped; index logic adopted)', (): void => {
    assert.equal(getUserColorIndex('user-42'), getUserColorIndex('user-42'));
    assert.notEqual(getUserColorIndex('user-42'), getUserColorIndex('user-1'));
    assert.ok(getUserColorIndex('user-42') < 12);
  });

  it('rewritten htmlToMD strips tags without pulling Expo', (): void => {
    assert.equal(htmlToMD('already markdown'), 'already markdown');
    assert.ok(htmlToMD('<p>Hello</p>').includes('Hello'));
    assert.deepEqual(extractEmojiIds('xemoji:e1:wave:emojix'), ['e1']);
  });
});

describe('hot-path measurement', (): void => {
  it('parseInlineRich, parseCustomEmojiMarkdownSegments, longMessageCollapse stay under 2s for 2000 rows', (): void => {
    const started = performance.now();
    for (let i = 0; i < 2000; i += 1) {
      parseInlineRich('Hello **Ada** and [x](xyne://user/u1)');
      parseCustomEmojiMarkdownSegments(EMOJI_MD);
      getLongMessageCollapseModel({ markdown: MD, maxWidth: 280, viewportHeight: 760 });
    }
    const elapsed = performance.now() - started;
    assert.ok(elapsed < 2000, `hot path took ${elapsed}ms`);
  });
});
