import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const read = (relative: string): string =>
  readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8');

describe('v3 remaining chrome vs v2', (): void => {
  it('keeps the join-channel card inside the composer dock and skips long-press', (): void => {
    const dock = read('../composer/ChatComposerDock.tsx');
    const host =
      read('../screens/ChatConversation.tsx') + read('../screens/ChatConversationView.tsx');
    assert.equal(/JoinChannelCard/.test(dock), true);
    assert.equal(/joinChannel/.test(dock), true);
    assert.equal(/ConversationInput/.test(dock), true);
    assert.equal(/key=\{conversationId\}/.test(dock), true);
    assert.equal(/joinChannel/.test(host), true);
    assert.equal(/if \(shouldShowJoinChannel\)/.test(host), true);
    assert.equal(/JoinChannelCard/.test(host), false);
    assert.equal(/features\/chat\/v2/.test(dock), false);
    assert.equal(/features\/chat\/v2/.test(host), false);
  });

  it('files header uses the same glass pill + channel subtitle as links/pinned', (): void => {
    const files = readFileSync(
      fileURLToPath(
        new URL('../../../../../app/(protected)/chat/[channelId]/files.tsx', import.meta.url),
      ),
      'utf8',
    );
    const header = readFileSync(
      fileURLToPath(
        new URL('../../../../components/chat/files-header-v3/files-header-v3.tsx', import.meta.url),
      ),
      'utf8',
    );
    assert.equal(/FilesHeaderV3/.test(files), true);
    assert.equal(/HeaderPill/.test(header), true);
    assert.equal(/HeaderBackButton/.test(header), true);
    assert.equal(/LinearGradient/.test(header), true);
    assert.equal(/\bFiles\b/.test(header), true);
    assert.equal(/displayName/.test(header), true);
    assert.equal(/File as FileIcon/.test(header), true);
    assert.equal(/features\/chat\/v2/.test(header), false);
  });

  it('message-actions sheet is a floating transparent sheet with 42px accent circles', (): void => {
    const host = read('../overlays/MessageActionsHost.tsx');
    const rail = read('../overlays/QuickReactionsRail.tsx');
    const chrome = read('../overlays/messageActionsChrome.ts');
    assert.equal(/backgroundStyle=\{TRANSPARENT_SHEET\}/.test(host), true);
    assert.equal(/sheetBg/.test(rail), true);
    assert.equal(/height: 42/.test(chrome), true);
    assert.equal(/width: 42/.test(chrome), true);
    assert.equal(/borderRadius: 21/.test(chrome), true);
    assert.equal(/borderRadius: 28/.test(chrome), true);
    assert.equal(/backgroundColor: 'transparent'/.test(chrome), true);
    assert.equal(/features\/chat\/v2/.test(host + rail + chrome), false);
  });

  it('closes the action sheet when delete confirmation is cancelled', (): void => {
    const v2 = readFileSync(
      fileURLToPath(
        new URL(
          '../../v2/components/message-actions-sheet/use-message-actions.tsx',
          import.meta.url,
        ),
      ),
      'utf8',
    );
    const v3 = read('../overlays/MessageActionsHost.tsx');
    assert.match(v2, /text: 'Cancel',[\s\S]*?onPress: \(\): void => closeActionSheet\(\)/);
    assert.match(v3, /text: 'Cancel',[\s\S]*?onPress: \(\): void => onOpenChange\(false\)/);
  });

  it('SmilePlus opens the shared emoji picker, not the who-reacted sheet', (): void => {
    const overlays = read('../screens/ChatOverlays.tsx');
    const picker = read('../overlays/EmojiPickerHost.tsx');
    assert.equal(/EmojiPickerHost/.test(overlays), true);
    assert.equal(/emojiPicker/.test(overlays), true);
    assert.equal(/onMoreReactions[\s\S]*emojiPicker/.test(overlays), true);
    assert.equal(/EmojiPickerBottomSheet/.test(picker), true);
    assert.equal(/toggleReaction/.test(picker), true);
    assert.equal(/custom:\$\{selection\.emojiId\}/.test(picker), true);
    assert.equal(/features\/chat\/v2/.test(picker), false);
  });

  it('who-reacted sheet uses a count title, filter chips, 32px avatars, and emoji display', (): void => {
    const host = read('../overlays/ReactionsHost.tsx');
    assert.equal(/reaction/.test(host), true);
    assert.equal(/All \$\{total\}/.test(host), true);
    assert.equal(/groupReactionsForPill/.test(host), true);
    assert.equal(/ReactionEmojiDisplay/.test(host), true);
    assert.equal(/size=\{32\}/.test(host), true);
    assert.equal(/mode='snap'/.test(host), true);
    assert.equal(/50%/.test(host), true);
    assert.equal(/80%/.test(host), true);
    assert.equal(/onOpenChange\(false\)/.test(host), true);
    assert.equal(/onUserPress/.test(host), false);
    assert.equal(/disabled=\{!row\.isSelf\}/.test(host), true);
    assert.equal(/active:bg-accent/.test(host), true);
    assert.equal(/features\/chat\/v2/.test(host), false);
    assert.equal(/createContext/.test(host), false);
  });
  it('message reaction pills render custom emoji keys via ReactionEmojiDisplay', (): void => {
    const source = read('../rows/MessageRowReactions.tsx');
    const row = read('../rows/MessageRow.tsx');
    assert.equal(/ReactionEmojiDisplay/.test(source), true);
    assert.equal(/group.emojiName/.test(source), true);
    assert.equal(source.includes('{group.emojiName}</Text>'), false);
    assert.equal(/visibleReactionGroupCount/.test(source), true);
    assert.equal(/availableBubbleWidth/.test(source), true);
    assert.equal(/onLayout={handleBubbleLayout}/.test(row), true);
  });

  it('link previews keep V2 metadata, deep-link, and thumbnail behavior in V3', (): void => {
    const card = read('../rows/parts/LinkPreviewCard.tsx');
    const metadata = read('../data/linkPreviewMetadata.ts');
    const seed = read('../model/linkPreview.ts');
    assert.equal(/useResolvedLinkPreview/.test(card), true);
    assert.equal(/navigateToCallDeepLinkIfApplicable/.test(card), true);
    assert.equal(/navigateToMessageDeepLinkIfApplicable/.test(card), true);
    assert.equal(/ExternalLink/.test(card), true);
    assert.equal(/getYoutubeVideoId/.test(card), true);
    assert.equal(/recyclingKey={thumbnailUri}/.test(card), true);
    assert.equal(/apiPost<LinkPreviewMetadataResponse>\('\/link-preview'/.test(metadata), true);
    assert.equal(/useState/.test(metadata), false);
    assert.equal(/parseStoredLinkPreviewBlock/.test(seed), true);
    assert.equal(/from '@xyne\/shared'/.test(seed), false);
    assert.equal(/needsMetadataFetch/.test(seed), true);
    assert.equal(/features\/chat\/v2/.test(card + metadata + seed), false);
  });

  it('uses MIME-plus-filename media classification for V3 row attachments', (): void => {
    const model = read('../model/attachmentKind.ts');
    const grid = read('../../../../components/chat/all-threads-list/message-attachments-grid.tsx');
    const row = read('../rows/MessageRowMedia.tsx');
    assert.equal(/getAttachmentMediaKind/.test(model), true);
    assert.equal(/getAttachmentMediaKind/.test(grid), true);
    assert.equal(/originalFilename/.test(grid), true);
    assert.equal(/previewUri/.test(grid + row), true);
    assert.equal(/onPress=\{onPress\}/.test(grid), true);
    assert.equal(/disabled=\{hasFailed\}/.test(grid), false);
  });

  it('parent reply preview renders parsed segments instead of raw html text', (): void => {
    const card = read('../rows/parts/ParentPreviewCard.tsx');
    const builder = read('../model/buildPreviews.ts');
    assert.equal(builder.includes('htmlToMD(input.parentMarkdown)'), true);
    assert.equal(card.includes('preview.segments'), true);
    assert.equal(/CustomEmoji/.test(card), true);
  });

  it('ticket card is content-sized and uses v2 badge + priority indicator chrome', (): void => {
    const card = read('../rows/parts/TicketCard.tsx');
    assert.equal(/Avatar/.test(card), true);
    assert.equal(card.includes('ticket.assigneeId'), true);
    assert.equal(/ticket-overview-divider/.test(card), true);
    assert.equal(/MESSAGE_TICKET_HEIGHT/.test(card), false);
    assert.equal(/height: MESSAGE_TICKET_HEIGHT/.test(card), false);
    assert.equal(/max-w-\[50%\]/.test(card), true);
    assert.equal(/border-ticket-priority-medium/.test(card), true);
    assert.equal(/text-ticket-priority-medium/.test(card), true);
    assert.equal(/PriorityIndicator/.test(card), true);
    assert.equal(/tracking-\[-0\.16px\]/.test(card), false);
    assert.equal(/text-\[10px\]/.test(card), false);
  });

  it('preserves v2 ticket status fallbacks and critical-priority chrome', (): void => {
    const input = read('../data/toConversationInput.ts');
    const card = read('../rows/parts/TicketCard.tsx');
    const tokens = read('../../../../theme/useChatRenderTokens.ts');
    assert.match(input, /TicketStatusV2\.STARTED/);
    assert.match(input, /return 'In progress'/);
    assert.match(card, /TriangleAlert/);
    assert.match(card, /ticketPriorityCriticalColor/);
    assert.match(card, /priority === 'CRITICAL'/);
    assert.match(tokens, /--color-ticket-priority-critical/);
  });

  it('Flow submit buttons use v2 transparent bordered chrome', (): void => {
    const source = read('../rows/parts/FlowJsonSubmitButton.tsx');
    assert.equal(/const buttonChrome/.test(source), true);
    assert.equal(/borderRadius: 6/.test(source), true);
    assert.equal(/backgroundColor: 'transparent'/.test(source), true);
    assert.equal(/borderStyle: live \? 'solid' : 'dashed'/.test(source), true);
    assert.equal(/paddingHorizontal: 10/.test(source), true);
    assert.equal(/fontSize: 14/.test(source), true);
    assert.equal(/hitSlop=\{4\}/.test(source), true);
  });

  it('keeps the implemented V2 bot Flow cards explicit in V3', (): void => {
    const v2 = readFileSync(
      fileURLToPath(
        new URL('../../v2/components/conversation-composer/flow-json-message.tsx', import.meta.url),
      ),
      'utf8',
    );
    const v3 = read('../rows/parts/FlowSpecializedComponent.tsx');
    const cardTypes = [
      'diff',
      'code',
      'pr',
      'plan',
      'agent',
      'user_question',
      'call_schedule',
      'mcp_suggest',
      'chart',
    ];

    for (const type of cardTypes) {
      assert.match(v2, new RegExp(`type === '${type}'`));
      assert.match(v3, new RegExp(`componentType === '${type}'`));
    }
    assert.match(v3, /FlowPrCard/);
    assert.match(v3, /FlowPlanCard/);
    assert.match(v3, /FlowAgentCard/);
    assert.match(v3, /FlowUserQuestionCard/);
    assert.match(v3, /FlowCallScheduleCard/);
    assert.match(v3, /FlowMcpSuggestCard/);
    assert.match(v3, /FlowChartCard/);
  });

  it('shares Flow identity maps through the app context instead of per-row subscriptions', (): void => {
    const hook = read('../rows/parts/useFlowNormalizationOptions.ts');
    const provider = read('../../../../providers/FlowNormalizationOptionsProvider.tsx');
    const context = read('../../../../contexts/FlowNormalizationOptionsContext.ts');
    const cache = read('../../../../utils/flowNormalizationOptions.ts');
    const v2Context = read(
      '../../v2/components/conversation-composer/utils/flowNormalizationOptionsContext.ts',
    );

    assert.match(hook, /useContext\(FlowNormalizationOptionsContext\)/);
    assert.equal(/useUsers|useAllChannels|useUserGroups|new WeakMap/.test(hook), false);
    assert.equal(/features\/chat\/v2/.test(provider), false);
    assert.match(provider, /useMemo/);
    assert.match(provider, /getCachedUserNames\(users\)/);
    assert.match(provider, /getCachedChannelNames\(channels\)/);
    assert.match(provider, /getCachedGroupNames\(groups\)/);
    assert.match(context, /createContext/);
    assert.match(cache, /new WeakMap/);
    assert.match(v2Context, /@\/src\/contexts\/FlowNormalizationOptionsContext/);
  });

  it('keeps shared Flow card status types out of V2 and V3 feature boundaries', (): void => {
    const utility = read('../../../../utils/flowAgentUtils.ts');
    const sharedTypes = read('../../../../utils/flowCardTypes.ts');
    const v2Types = read('../../v2/components/conversation-composer/flow-card/flow-card.types.ts');
    const v3Card = read('../rows/parts/FlowCard.tsx');

    assert.equal(/features\/chat\/v2/.test(utility), false);
    assert.match(utility, /@\/src\/utils\/flowCardTypes/);
    assert.match(sharedTypes, /export type FlowCardStatusTone/);
    assert.match(
      v2Types,
      /export type \{ FlowCardStatusTone \} from '@\/src\/utils\/flowCardTypes'/,
    );
    assert.match(
      v3Card,
      /import type \{ FlowCardStatusTone \} from '@\/src\/utils\/flowCardTypes'/,
    );
    assert.match(
      v3Card,
      /export type \{ FlowCardStatusTone \} from '@\/src\/utils\/flowCardTypes'/,
    );
  });

  it('resolves Flow custom emoji before native markdown paints bot cards', (): void => {
    const renderer = read('../rows/parts/FlowJsonRenderer.tsx');
    const markdown = read('../rows/parts/FlowMarkdown.tsx');
    const resolverHook = read('../rows/useResolvedCustomEmojiMarkdown.ts');
    const resolver = read('../model/text/htmlToMD.ts');
    assert.match(renderer, /<FlowMarkdown/);
    assert.match(markdown, /useResolvedCustomEmojiMarkdown/);
    assert.match(resolverHook, /useMtlsEmojiUris/);
    assert.match(resolverHook, /replaceEmojiPlaceholders/);
    assert.match(resolverHook, /parseCustomEmojiMarkdownSegments/);
    assert.match(resolver, /export const replaceEmojiPlaceholders/);
    assert.match(resolver, /INLINE_IMAGE_GUARD/);
  });

  it('resolves custom emoji in the non-participant system card', (): void => {
    const card = read('../rows/parts/NonParticipantMessageCard.tsx');
    assert.match(card, /useResolvedCustomEmojiMarkdown/);
    assert.match(card, /markdown=\{resolvedMarkdown\}/);
    assert.match(card, /variant='system'/);
  });

  it('keeps the V2 Flow title contract, including the default title text', (): void => {
    const v2 = readFileSync(
      fileURLToPath(
        new URL('../../v2/components/conversation-composer/flow-json-message.tsx', import.meta.url),
      ),
      'utf8',
    );
    const v3 = read('../rows/parts/FlowJsonMessageBody.tsx');
    assert.match(v2, /const titleElement = title\s*\n\s*\? renderMarkdown/);
    assert.match(v3, /const titleElement = title\s*\n\s*\? renderMarkdown/);
    assert.equal(/title\.toLowerCase\(\) !== 'flow json'/.test(v3), false);
  });

  it('keeps call-schedule selection and completion colors on the V2 palette', (): void => {
    const source = read('../rows/parts/FlowCallScheduleParts.tsx');
    assert.match(source, /foreground=\{tokens\.foreground\}/);
    assert.match(source, /className='bg-flow-card-status-completed-bg'/);
    assert.match(source, /<Check size=\{10\} color='#009d2a'/);
    assert.equal(/foreground=\{tokens\.ambientAccentColor\}/.test(source), false);
  });

  it('keeps Flow PR badge colors distinct and theme-resolved in V3', (): void => {
    const tokens = read('../../../../theme/chatRenderTokens.ts');
    const resolver = read('../../../../theme/useChatRenderTokens.ts');
    const card = read('../rows/parts/FlowPrCard.tsx');
    assert.match(tokens, /prBadgePalette/);
    assert.match(tokens, /--color-pr-badge-created-bg/);
    assert.match(tokens, /--color-pr-badge-merged-bg/);
    assert.match(tokens, /--color-pr-badge-danger-bg/);
    assert.match(resolver, /PR_BADGE_COLOR_VAR_NAMES/);
    assert.match(card, /tokens\.prBadgePalette/);
    assert.match(card, /backgroundColor: badge\.background/);
    assert.match(card, /color=\{badge\.foreground\}/);
    assert.equal(card.includes("color='#6b7280'"), false);
    assert.equal(/bg-flow-card-status-completed-bg/.test(card), false);
    assert.equal(/bg-flow-card-status-failed-bg/.test(card), false);
  });

  it('keeps Flow plan and question control palettes on dedicated V2 tokens', (): void => {
    const tokens = read('../../../../theme/chatRenderTokens.ts');
    const resolver = read('../../../../theme/useChatRenderTokens.ts');
    const card = read('../rows/parts/FlowCard.tsx');
    assert.match(tokens, /FLOW_CARD_COLOR_VAR_NAMES/);
    assert.match(tokens, /--color-flow-card-step-checked-fill/);
    assert.match(tokens, /--color-flow-card-step-failed-fill/);
    assert.match(tokens, /--color-chat-card-muted/);
    assert.match(tokens, /--color-background/);
    assert.match(resolver, /flowCardStepColors/);
    assert.match(resolver, /flowCardQuestionColors/);
    assert.match(card, /return tokens\.flowCardStepColors/);
    assert.match(card, /return tokens\.flowCardQuestionColors/);
    assert.equal(/checkedFill: tokens\.brand/.test(card), false);
    assert.equal(/inputBackground: tokens\.cardBg/.test(card), false);
  });

  it('keeps Flow surface colors on border, chat-card, popover, and foreground tokens', (): void => {
    const tokens = read('../../../../theme/chatRenderTokens.ts');
    const resolver = read('../../../../theme/useChatRenderTokens.ts');
    const chart = read('../rows/parts/FlowChartCard.tsx');
    const mcp = read('../rows/parts/FlowMcpSuggestCard.tsx');
    const schedule = read('../rows/parts/FlowCallScheduleParts.tsx');
    const pr = read('../rows/parts/FlowPrCard.tsx');
    assert.match(tokens, /CHAT_SURFACE_COLOR_VAR_NAMES/);
    assert.match(tokens, /--color-border/);
    assert.match(tokens, /--color-chat-card/);
    assert.match(tokens, /--color-popover/);
    assert.match(resolver, /chatSurfaceColorsRaw/);
    assert.match(chart, /borderColor=\{tokens\.borderColor\}/);
    assert.match(chart, /cardColor=\{tokens\.chatCardColor\}/);
    assert.match(chart, /mutedColor=\{tokens\.foreground\}/);
    assert.match(mcp, /borderColor=\{tokens\.borderColor\}/);
    assert.match(mcp, /mutedColor=\{tokens\.foreground\}/);
    assert.match(schedule, /menuBackground=\{tokens\.popoverColor\}/);
    assert.match(schedule, /emptyBorder=\{tokens\.borderColor\}/);
    assert.match(pr, /borderTopColor: tokens\.borderColor/);
  });

  it('keeps system markdown on the dedicated V2 system-text token', (): void => {
    const tokens = read('../../../../theme/chatRenderTokens.ts');
    const resolver = read('../../../../theme/useChatRenderTokens.ts');
    const block = read('../rows/BlockMarkdown.tsx');
    const flowSystem = read('../rows/parts/FlowSystemMessageCard.tsx');
    assert.match(tokens, /SYSTEM_MESSAGE_COLOR_VAR_NAMES/);
    assert.match(tokens, /--color-conversation-composer-system-text/);
    assert.match(resolver, /systemMessageColorsRaw/);
    assert.match(block, /variant === 'system'\s*\?\s*tokens\.systemText/);
    assert.match(flowSystem, /foreground: tokens\.systemText/);
    assert.match(flowSystem, /link: tokens\.systemText/);
    assert.doesNotMatch(block, /variant === 'system'\s*\?\s*tokens\.foregroundMuted/);
  });

  it('does not subscribe to user data for grouped avatar spacers', (): void => {
    const source = read('../rows/MessageRowAvatar.tsx');
    assert.match(source, /const MessageAvatar = memo\(function MessageAvatar/);
    assert.match(source, /\{model\.showAvatar \? \([\s\S]*<MessageAvatar model=\{model\}/);
    assert.equal(/export function MessageRowAvatar[\s\S]*?useUser\(/.test(source), false);
  });

  it('keeps Flow-JSON SYSTEM messages in the V2 centered system surface', (): void => {
    const rowType = read('../model/rowType.ts');
    const system = read('../rows/SystemMessageRow.tsx');
    const card = read('../rows/parts/FlowSystemMessageCard.tsx');
    assert.match(rowType, /paintsAsSystemFlow/);
    assert.match(rowType, /system-flow/);
    assert.match(system, /FlowSystemMessageCard/);
    assert.match(card, /bg-conversation-composer-system-bg/);
    assert.match(card, /markdownVariant='system'/);
  });

  it('does not wrap Flow body in extra padded rounded view', (): void => {
    const source = read('../rows/MessageRow.tsx');
    assert.equal(/className='w-full rounded-lg px-2 py-1'/.test(source), false);
    assert.equal(/showMessageBody\(model\)/.test(source), true);
    assert.equal(
      /showBody \? \([\s\S]*<View className='mb-2\.5'>[\s\S]*<MessageRowBody model=\{model\} onToggleExpand=\{onToggleExpand\} \/>/.test(
        source,
      ),
      true,
    );
  });

  it('matches v2 bubble width rules for expanded message bodies', (): void => {
    const source = read('../rows/MessageRow.tsx');
    assert.match(
      source,
      /isTicketRow \|\|\s*model\.mediaPreview \|\|\s*\(model\.isExpanded && hasBlockMarkdown\(model\.body\.markdown\)\)/,
    );
    assert.doesNotMatch(source, /model\.isExpanded \|\| model\.isFlowJson/);
  });

  it('keeps link previews before media in mixed-content bubbles like v2', (): void => {
    const source = read('../rows/MessageRow.tsx');
    const content = source.slice(
      source.indexOf('{model.ticketPreview'),
      source.indexOf('<MessageRowMeta'),
    );
    assert.ok(content.indexOf('{model.linkPreview') < content.indexOf('{model.mediaPreview'));
  });

  it('skips body chrome for attachment-only bubbles', (): void => {
    const source = read('../model/bodyPaint.ts');
    assert.equal(/showMessageBody/.test(source), true);
    assert.equal(
      /model\.body\.plainText\.trim\(\)\.length > 0 \|\| !model\.mediaPreview/.test(source),
      true,
    );
  });

  it('keeps deleted-message chrome as a V2 tombstone with timestamp-only meta', (): void => {
    const row = read('../rows/MessageRow.tsx');
    const body = read('../rows/parts/DeletedMessageBody.tsx');
    const status = read('../model/statusChrome.ts');
    assert.equal(/DeletedMessageBody/.test(row), true);
    assert.equal(/mb-2\.5/.test(body), true);
    assert.equal(/text-base italic leading-5 text-secondary-foreground/.test(body), true);
    assert.equal(status.includes("next.push('deleted')"), false);
  });

  it('renders V2 footer indicators instead of string status placeholders', (): void => {
    const meta = read('../rows/MessageRowMeta.tsx');
    const status = read('../model/statusChrome.ts');
    assert.match(meta, /AlarmClock/);
    assert.match(meta, /Bookmark/);
    assert.match(meta, /Pin/);
    assert.match(meta, /\(edited\)/);
    assert.match(meta, /text-conversation-composer-timestamp-other/);
    assert.match(status, /statusChromeFor/);
    assert.match(status, /hasStatusChrome/);
    assert.equal(/next\.push\(/.test(status), false);
    assert.equal(/also in channel|\bcall\b/.test(meta), false);
    assert.equal(/features\/chat\/v2/.test(meta + status), false);
  });

  it('keeps the call card icon on the dedicated V2 call token', (): void => {
    const v2 = read(
      '../../v2/components/conversation-composer/conversation-composer-system-message.tsx',
    );
    const v3 = read('../rows/parts/CallMessageCard.tsx');
    const tokens = read('../../../../theme/chatRenderTokens.ts');
    const resolver = read('../../../../theme/useChatRenderTokens.ts');
    assert.match(v2, /--color-conversation-composer-call-icon/);
    assert.match(v3, /tokens\.callIconColor/);
    assert.match(tokens, /CALL_MESSAGE_COLOR_VAR_NAMES/);
    assert.match(resolver, /CALL_MESSAGE_COLOR_VAR_NAMES/);
    assert.equal(/tokens\.ambientAccentColor/.test(v3), false);
  });

  it('keeps markdown plan status pills on the V2 palette', (): void => {
    const v2 = read(
      '../../v2/components/conversation-composer/conversation-composer-markdown-body.tsx',
    );
    const v3 = read('../rows/BlockMarkdown.tsx');
    const palette = [
      ['#00A63E', '#ffffff'],
      ['#FF6900', '#ffffff'],
      ['#0561E2', '#ffffff'],
      ['#E7000B', '#ffffff'],
    ] as const;

    for (const [backgroundColor, foregroundColor] of palette) {
      const paletteEntry = new RegExp(
        `backgroundColor: '${backgroundColor}', color: '${foregroundColor}'`,
      );
      assert.match(v2, paletteEntry);
      assert.match(v3, paletteEntry);
    }
    assert.doesNotMatch(v3, /#dcfce7|#fef3c7|#e5f1fe|#fee2e2/);
    assert.match(v3, /const planHeaderPalette = planHeader/);
  });

  it('keys stateful Flow cards by row and component for recycling', (): void => {
    const specialized = read('../rows/parts/FlowSpecializedComponent.tsx');
    const componentRecyclingKey =
      /recyclingKey=\{`\$\{model\.conversationId\}:\$\{componentKey\}`\}/g;

    assert.equal(specialized.match(componentRecyclingKey)?.length, 5);
    assert.equal(/recyclingKey=\{model\.conversationId\}/.test(specialized), false);
  });

  it('Read more uses v2 self-start 15/600 chrome and is collapsed-only', (): void => {
    const body = read('../rows/MessageRowBody.tsx');
    assert.equal(/accessibilityLabel='Read more'/.test(body), true);
    assert.equal(/className='self-start'/.test(body), true);
    assert.equal(/fontSize: 15/.test(body), true);
    assert.equal(/fontWeight: '600'/.test(body), true);
    assert.equal(/Show less/.test(body), false);
    assert.equal(/text-xs font-medium text-brand/.test(body), false);
    assert.equal(/mine \? tokens\.actionPrimaryColor : tokens\.linkColor/.test(body), true);
  });

  it('mention chips inherit v2 palette colors instead of brand class names', (): void => {
    const inline = read('../rows/InlineRichText.tsx');
    const body = read('../rows/MessageRowBody.tsx');
    assert.equal(/font-medium text-brand/.test(inline), false);
    assert.equal(/font-semibold text-brand/.test(body), false);
    assert.equal(/font-medium text-brand/.test(body), false);
    assert.equal(/backgroundColor: mentionColors.backgroundColor/.test(inline), true);
    assert.equal(/resolveMentionColors/.test(body), true);
  });

  it('unread divider uses ambient green New messages, not brand count', (): void => {
    const divider = read('../rows/UnreadDividerRow.tsx');
    assert.equal(/New messages/.test(divider), true);
    assert.equal(/uppercase/.test(divider), true);
    assert.equal(/ambientAccentColor/.test(divider), true);
    assert.equal(/tokens\.brand/.test(divider), false);
    assert.equal(/count\} unread/.test(divider), false);
  });

  it('ticket threads inject the parent ticket and dismiss the keyboard on open', (): void => {
    const pane = read('../screens/TicketThreadPane.tsx');
    const host =
      read('../screens/ChatConversation.tsx') + read('../screens/ChatConversationView.tsx');
    const rows = read('../screens/useChatRows.ts');
    assert.equal(/parentTicketMd/.test(pane), true);
    assert.equal(/onParentTicketPress/.test(pane), true);
    assert.equal(/injectParentTicket/.test(rows), true);
    assert.equal(/KeyboardController\.dismiss/.test(host), true);
    assert.equal(/features\/chat\/v2/.test(pane + host + rows), false);
  });

  it('channel rows match v2 sender, reply-tray, and system-message chrome', (): void => {
    const sender = read('../rows/SenderNameLabel.tsx');
    const meta = read('../rows/MessageRowMeta.tsx');
    const tray = read('../rows/MessageReplyTray.tsx');
    const system = read('../rows/SystemMessageRow.tsx');
    const nonParticipant = read('../rows/parts/NonParticipantMessageCard.tsx');
    const nonParticipantModel = read('../model/nonParticipant.ts');
    const inlineRich = read('../rows/InlineRichText.tsx');
    assert.equal(/mb-2 flex-row items-center gap-1\.5/.test(sender), true);
    assert.equal(/text-sm font-semibold/.test(sender), true);
    assert.equal(/MessageReplyTray/.test(meta), true);
    assert.equal(/latestReplierIds/.test(meta), true);
    assert.equal(/border-t border-border pt-2/.test(meta), true);
    assert.equal(/AVATAR_SIZE = 18/.test(tray), true);
    assert.equal(/size=\{AVATAR_SIZE\}/.test(tray), true);
    assert.equal(/ChevronRight/.test(tray), true);
    assert.equal(/bg-conversation-composer-system-bg/.test(system), true);
    assert.equal(/messageSubtype/.test(nonParticipantModel), true);
    assert.equal(/handleNonParticipantAction/.test(nonParticipant), true);
    assert.equal(/Add Them/.test(nonParticipant), true);
    assert.equal(/Do Nothing/.test(nonParticipant), true);
    assert.equal(/variant='system'/.test(nonParticipant), true);
    assert.equal(/NonParticipantMessageCard/.test(system), true);
    assert.equal(/BlockMarkdownVariant/.test(read('../rows/BlockMarkdown.tsx')), true);
    assert.equal(/inlineCodeSurfaceFor/.test(inlineRich), true);
    assert.equal(/features\/chat\/v2/.test(sender + meta + tray + system + inlineRich), false);
    assert.equal(/onLongPress/.test(system), false);
    assert.equal(/onLongPress/.test(nonParticipant), false);
  });

  it('keeps avatar and sender taps from invoking the enclosing row press', (): void => {
    const row = read('../rows/MessageRow.tsx');
    const avatar = read('../rows/MessageRowAvatar.tsx');
    const sender = read('../rows/SenderNameLabel.tsx');
    assert.equal(/accessibilityRole='button'/.test(row), true);
    assert.match(row, /handleIdentityPress/);
    assert.match(row, /event\.stopPropagation\(\);[\s\S]*onAvatarPress\(row\)/);
    assert.match(avatar, /onPress: \(event: GestureResponderEvent\) => void/);
    assert.match(sender, /onPress: \(event: GestureResponderEvent\) => void/);
  });

  it('threads paint a list-level replies divider after the parent and do not clip the list shell', (): void => {
    const list =
      read('../list/ConversationList.tsx') + read('../list/useConversationListRenderItem.tsx');
    const row = read('../rows/ChatListRow.tsx');
    const divider = read('../rows/ThreadReplyDivider.tsx');
    assert.equal(/threadReplyChrome/.test(list), true);
    assert.equal(/overflow-hidden rounded-t-\[10px\]/.test(list), false);
    assert.equal(/ThreadReplyDivider/.test(row), true);
    assert.equal(/className='px-4 py-1'/.test(row), true);
    assert.equal(/paddingTop: DIVIDER_PAD/.test(divider), true);
    assert.equal(/paddingBottom: DIVIDER_PAD/.test(divider), true);
    assert.equal(/marginTop/.test(divider), false);
    assert.equal(/features\/chat\/v2/.test(list + row + divider), false);
  });

  it('thread markdown keeps the native list-end guard and thread composer stays unfocused on open', (): void => {
    const markdown = read('../rows/BlockMarkdown.tsx');
    const dock = read('../composer/ChatComposerDock.tsx');
    const types = read('../model/rowType.ts');
    assert.equal(/NATIVE_LIST_END_GUARD/.test(markdown), true);
    assert.equal(/md4cFlags/.test(markdown), true);
    assert.equal(/Reply to thread/.test(dock), true);
    assert.equal(/isFlowJson/.test(types), true);
    assert.equal(/extractFlowPlanMarkdownHeader/.test(markdown), true);
    assert.equal(/features\/chat\/v2/.test(markdown + dock + types), false);
  });
});
