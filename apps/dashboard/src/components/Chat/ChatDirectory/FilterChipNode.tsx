/**
 * The cmd+K filter chip — the inline blue pill rendered for a picked
 * from:/with:/assignee:/in: filter. It is four Lexical nodes:
 *
 *   FilterChipContainerNode   inline pill (.filter-chip), parent of:
 *     FilterChipPrefixNode    the `from:`/`in:` prefix (DecoratorNode)
 *     FilterChipIconNode      avatar (users) or glyph (channels/priority) (DecoratorNode)
 *     FilterChipNode          editable value label (TextNode)
 *
 * The prefix is its own node so the avatar/glyph can sit BETWEEN it and the value
 * (`from: [avatar] Alice`), per the design. It still reports its text through
 * `getTextContent()`, so the pill's combined text is unchanged (`from: Alice`).
 *
 * `$createFilterChip(mentionData)` builds the whole pill; `FilterChipPlugin`
 * demotes it to plain text on the first edit so the filter stays parseable
 * downstream.
 */

import React from 'react';
import {
  $getRoot,
  $isElementNode,
  DecoratorNode,
  ElementNode,
  TextNode,
  type EditorConfig,
  type LexicalNode,
  type NodeKey,
  type SerializedElementNode,
  type SerializedLexicalNode,
  type SerializedTextNode,
  type Spread,
} from 'lexical';
import { CalendarDays, LayoutGrid, SignalHigh } from 'lucide-react';
import { Hashtag, UserTwo, Lock02Close } from '@xyne/icons';
import { ChannelScopeType, ChannelVisibility, TicketPriority } from '@xyne/shared';
import { useChannel } from '../../../hooks/useChannels';
import Avatar from '../../ui/Avatar/Avatar';
import { MentionType, type MentionData } from './ChannelCommandMenu.types';

// ---- Editable label (FilterChipNode) ----

export type SerializedFilterChipNode = Spread<
  {
    type: 'filter-chip';
    mentionData: MentionData;
    expectedText: string;
  },
  SerializedTextNode
>;

/** The pill's leading prefix (`from:`, `in:`, `priority:`), or null for a prefix-less
 *  mention chip. Rendered as its own node so the avatar/glyph can sit after it. */
export function chipPrefixText(mentionData: MentionData): string | null {
  // Priority is a value filter; its chip always reads `priority:` regardless of MentionData.
  if (mentionData.type === MentionType.PRIORITY) {
    return 'priority:';
  }
  return mentionData.prefix ?? null;
}

/** The pill's value label — the only editable part of the chip. A prefix-less mention reads
 *  with its sigil (`@alice`/`#general`), not `from:`/`in:` (which would mislabel it as an
 *  author/scope filter). */
export function chipLabelText(mentionData: MentionData): string {
  // Chip always reads lowercase (`priority: high`), independent of the dropdown label.
  if (mentionData.type === MentionType.PRIORITY) {
    return mentionData.id.toLowerCase();
  }
  // Date chips read as the bare date; the prefix already says which edge it is.
  if (mentionData.type === MentionType.DATE) {
    return mentionData.id;
  }
  // A mention filter reads the way a mention is written — `mentions: @alice` — because the
  // `@` is the thing being searched for, not a type marker. The avatar beside it doesn't
  // duplicate it the way the hash glyph would duplicate a `#`.
  if (mentionData.prefix === 'mentions:' && mentionData.type === MentionType.USER) {
    return `@${mentionData.name}`;
  }
  if (mentionData.prefix) {
    return mentionData.name;
  }
  const sigil = mentionData.type === MentionType.USER ? '@' : '#';
  return `${sigil}${mentionData.name}`;
}

/** The pill's full text (`from: alice`) — what demotion leaves behind verbatim to re-arm the
 *  dropdown. Split across the prefix + label nodes, but always reads as one string. */
export function buildChipText(mentionData: MentionData): string {
  const prefix = chipPrefixText(mentionData);
  const label = chipLabelText(mentionData);
  return prefix ? `${prefix} ${label}` : label;
}

export class FilterChipNode extends TextNode {
  /** The picked entity + filter metadata this chip represents. */
  __mentionData: MentionData;
  /** Label text at creation time (value only — the prefix lives in its own node);
   *  `FilterChipPlugin` demotes the chip once it diverges. */
  __expectedText: string;

  static override getType(): string {
    return 'filter-chip';
  }

  static override clone(node: FilterChipNode): FilterChipNode {
    return new FilterChipNode(node.__mentionData, node.__text, node.__expectedText, node.__key);
  }

  constructor(mentionData: MentionData, text?: string, expectedText?: string, key?: NodeKey) {
    const resolved = text ?? chipLabelText(mentionData);
    super(resolved, key);
    this.__mentionData = mentionData;
    this.__expectedText = expectedText ?? chipLabelText(mentionData);
  }

  // No-op: `FilterChipPlugin` swaps an edited chip for a fresh TextNode rather
  // than mutating `__text`, so this span is never reused with changed text.
  override updateDOM(): boolean {
    return false;
  }

  static override importJSON(serializedNode: SerializedFilterChipNode): FilterChipNode {
    return new FilterChipNode(
      serializedNode.mentionData,
      serializedNode.text,
      serializedNode.expectedText,
    );
  }

  override exportJSON(): SerializedFilterChipNode {
    return {
      ...super.exportJSON(),
      type: 'filter-chip',
      mentionData: this.__mentionData,
      expectedText: this.__expectedText,
    };
  }

  // Typing at a chip boundary spawns an adjacent TextNode instead of extending
  // the chip, so chip text only changes when the caret is *inside* it.
  override canInsertTextBefore(): boolean {
    return false;
  }

  override canInsertTextAfter(): boolean {
    return false;
  }

  getMentionData(): MentionData {
    return this.__mentionData;
  }

  getExpectedText(): string {
    return this.__expectedText;
  }
}

export function $createFilterChipNode(mentionData: MentionData): FilterChipNode {
  return new FilterChipNode(mentionData);
}

export function $isFilterChipNode(node: LexicalNode | null | undefined): node is FilterChipNode {
  return node instanceof FilterChipNode;
}

// ---- Leading icon (FilterChipIconNode) ----

export type SerializedFilterChipIconNode = Spread<
  {
    type: 'filter-chip-icon';
    mentionData: MentionData;
  },
  SerializedLexicalNode
>;

// 16px icon/avatar slot, matching the design (and every other row in the palette).
const ICON_SIZE = 16;
// Size only, no color: the glyph inherits `currentColor` (`--chip-fg`) from the
// pill, so it tracks the chip text in every theme. Used for the lucide priority
// glyph, which takes a className rather than Pika's `size`.
const ICON_CLASS = 'h-4 w-4';

// Severity tint for the priority glyph only (pill stays blue). Tracks the severity
// colors of the app-wide getPriorityIcon, but uses a single compact SignalHigh glyph
// rather than its per-level bars/triangle. text-* sets currentColor, overriding the
// inherited --chip-fg.
export const PRIORITY_ICON_COLOR: Record<string, string> = {
  [TicketPriority.LOW]: 'text-xyne-green-400',
  [TicketPriority.MEDIUM]: 'text-xyne-yellow-400',
  [TicketPriority.HIGH]: 'text-xyne-orange-400',
  [TicketPriority.CRITICAL]: 'text-xyne-red-500',
};

/**
 * Resolves a channel chip's glyph by id (keeping MentionData lean): DM → person,
 * public channel → hash, private → lock; hash while the channel isn't cached yet.
 * Mirrors ChannelIcon's privacy logic but uses a generic person for DMs, not an avatar.
 */
export function ChannelChipIcon({
  id,
  size = ICON_SIZE,
}: {
  id: string;
  size?: number;
}): React.JSX.Element {
  const channel = useChannel(id);
  if (!channel) {
    return <Hashtag size={size} />;
  }
  if (
    channel.scopeType === ChannelScopeType.DM ||
    channel.scopeType === ChannelScopeType.GROUP_DM
  ) {
    return <UserTwo size={size} />;
  }
  return channel.visibility === ChannelVisibility.PUBLIC ? (
    <Hashtag size={size} />
  ) : (
    <Lock02Close size={size} />
  );
}

function ChipIcon({ mentionData }: { mentionData: MentionData }): React.JSX.Element {
  // Priority — checked first so it never falls through to the channel branch (which
  // calls `useChannel`). Glyph tinted by severity; pill stays blue.
  if (mentionData.type === MentionType.PRIORITY) {
    return <SignalHigh className={`${ICON_CLASS} ${PRIORITY_ICON_COLOR[mentionData.id] ?? ''}`} />;
  }
  // Date — like priority, a value filter with a glyph rather than an entity avatar.
  if (mentionData.type === MentionType.DATE) {
    return <CalendarDays className={ICON_CLASS} />;
  }
  // Board — checked before the channel branch below, which would otherwise claim it and
  // call useChannel with a board id.
  if (mentionData.type === MentionType.BOARD) {
    return <LayoutGrid className={ICON_CLASS} />;
  }
  // User filters show the picked person's photo (the design's 16px avatar, rounded-sm = 4px);
  // `Avatar` resolves the user from the id and falls back to initials, so MentionData stays
  // lean. No presence dot — it reads as noise inside a 16px chip.
  if (mentionData.type === MentionType.USER) {
    return <Avatar userId={mentionData.id} size='xs' showActiveStatus={false} />;
  }
  // The channel lookup lives in its own component so `useChannel` is never called
  // conditionally (rules of hooks).
  return <ChannelChipIcon id={mentionData.id} />;
}

/**
 * The chip's avatar/glyph, sitting between the prefix and the value label. A DecoratorNode
 * (not part of the label TextNode) so it can render a real React component; it carries the
 * label's MentionData. Contributes no text, so the pill's text stays `from: alice`.
 */
export class FilterChipIconNode extends DecoratorNode<React.JSX.Element> {
  __mentionData: MentionData;

  static override getType(): string {
    return 'filter-chip-icon';
  }

  static override clone(node: FilterChipIconNode): FilterChipIconNode {
    return new FilterChipIconNode(node.__mentionData, node.__key);
  }

  constructor(mentionData: MentionData, key?: NodeKey) {
    super(key);
    this.__mentionData = mentionData;
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement('span');
    dom.classList.add('filter-chip__icon');
    dom.setAttribute('data-mention-type', `mention-${this.__mentionData.type}`);
    return dom;
  }

  override updateDOM(): boolean {
    return false;
  }

  // Inline so it flows with the label; not keyboard-selectable so the caret never
  // parks on the icon — the pill reads as one unit and the backspace boundary stays simple.
  override isInline(): boolean {
    return true;
  }

  override isKeyboardSelectable(): boolean {
    return false;
  }

  static override importJSON(serializedNode: SerializedFilterChipIconNode): FilterChipIconNode {
    return new FilterChipIconNode(serializedNode.mentionData);
  }

  override exportJSON(): SerializedFilterChipIconNode {
    return {
      ...super.exportJSON(),
      type: 'filter-chip-icon',
      mentionData: this.__mentionData,
    };
  }

  override decorate(): React.JSX.Element {
    return <ChipIcon mentionData={this.__mentionData} />;
  }

  getMentionData(): MentionData {
    return this.__mentionData;
  }
}

export function $createFilterChipIconNode(mentionData: MentionData): FilterChipIconNode {
  return new FilterChipIconNode(mentionData);
}

// ---- Leading prefix (FilterChipPrefixNode) ----

export type SerializedFilterChipPrefixNode = Spread<
  {
    type: 'filter-chip-prefix';
    prefix: string;
  },
  SerializedLexicalNode
>;

/**
 * The pill's `from:`/`in:`/`priority:` prefix. It is its own (non-editable) node purely so
 * the avatar/glyph can render BETWEEN the prefix and the value, per the design; it is styled
 * exactly like the value (same size/weight/color — the prefix is not dimmed).
 *
 * It reports `"<prefix> "` from `getTextContent()` even though it renders just `<prefix>`
 * (the trailing separator is the pill's 4px flex gap). That keeps the container's combined
 * text identical to the pre-split chip (`from: alice`), which is what demotion writes back
 * as plain text to re-arm the mention dropdown.
 */
export class FilterChipPrefixNode extends DecoratorNode<React.JSX.Element> {
  __prefix: string;

  static override getType(): string {
    return 'filter-chip-prefix';
  }

  static override clone(node: FilterChipPrefixNode): FilterChipPrefixNode {
    return new FilterChipPrefixNode(node.__prefix, node.__key);
  }

  constructor(prefix: string, key?: NodeKey) {
    super(key);
    this.__prefix = prefix;
  }

  override createDOM(_config: EditorConfig): HTMLElement {
    const dom = document.createElement('span');
    dom.classList.add('filter-chip__prefix');
    // Unlike the icon, this decorator renders real text — without contenteditable=false a
    // click on `from:` would drop the caret inside a node that isn't keyboard-selectable.
    dom.setAttribute('contenteditable', 'false');
    return dom;
  }

  override updateDOM(): boolean {
    return false;
  }

  override isInline(): boolean {
    return true;
  }

  // Never keyboard-selectable: the caret only ever parks in the value label, so the pill
  // still reads as one unit and the backspace boundary stays simple.
  override isKeyboardSelectable(): boolean {
    return false;
  }

  // Trailing space intentional — see the class doc.
  override getTextContent(): string {
    return `${this.__prefix} `;
  }

  static override importJSON(serializedNode: SerializedFilterChipPrefixNode): FilterChipPrefixNode {
    return new FilterChipPrefixNode(serializedNode.prefix);
  }

  override exportJSON(): SerializedFilterChipPrefixNode {
    return {
      ...super.exportJSON(),
      type: 'filter-chip-prefix',
      prefix: this.__prefix,
    };
  }

  override decorate(): React.JSX.Element {
    return <>{this.__prefix}</>;
  }
}

export function $createFilterChipPrefixNode(prefix: string): FilterChipPrefixNode {
  return new FilterChipPrefixNode(prefix);
}

// ---- Pill wrapper (FilterChipContainerNode) ----

export type SerializedFilterChipContainerNode = Spread<
  {
    type: 'filter-chip-container';
    isSelfMention: boolean;
  },
  SerializedElementNode
>;

/**
 * The inline pill (parent of icon + label); the background lives here so demoting the label
 * drops the whole pill. A chip of the current user (`isSelfMention`) gets Slack's self color.
 */
export class FilterChipContainerNode extends ElementNode {
  /** True when the chip references the current user (Slack self-mention color). */
  __isSelfMention: boolean;

  static override getType(): string {
    return 'filter-chip-container';
  }

  static override clone(node: FilterChipContainerNode): FilterChipContainerNode {
    return new FilterChipContainerNode(node.__isSelfMention, node.__key);
  }

  static override importJSON(
    serializedNode: SerializedFilterChipContainerNode,
  ): FilterChipContainerNode {
    return new FilterChipContainerNode(serializedNode.isSelfMention ?? false);
  }

  constructor(isSelfMention = false, key?: NodeKey) {
    super(key);
    this.__isSelfMention = isSelfMention;
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement('span');
    dom.classList.add('filter-chip');
    if (this.__isSelfMention) {
      dom.classList.add('filter-chip--self-mention');
    }
    return dom;
  }

  override updateDOM(): boolean {
    return false;
  }

  override isInline(): boolean {
    return true;
  }

  // Typing at the pill's edge spawns adjacent text rather than entering the pill.
  override canInsertTextBefore(): boolean {
    return false;
  }

  override canInsertTextAfter(): boolean {
    return false;
  }

  override exportJSON(): SerializedFilterChipContainerNode {
    return {
      ...super.exportJSON(),
      type: 'filter-chip-container',
      isSelfMention: this.__isSelfMention,
    };
  }
}

export function $isFilterChipContainerNode(
  node: LexicalNode | null | undefined,
): node is FilterChipContainerNode {
  return node instanceof FilterChipContainerNode;
}

/** Build the pill in the design's order — `from:` → avatar/glyph → value. Prefix-less mention
 *  chips are the value alone (no prefix, no icon); a chip of the current user also gets
 *  Slack's self color. */
export function $createFilterChip(
  mentionData: MentionData,
  currentUserId?: string,
): FilterChipContainerNode {
  const prefix = chipPrefixText(mentionData);
  // Any chip referencing the current user — bare @me or from:/with:/assignee: me — gets the
  // Slack self-mention color.
  const isSelfMention =
    mentionData.type === MentionType.USER && !!currentUserId && mentionData.id === currentUserId;
  const container = new FilterChipContainerNode(isSelfMention);
  if (prefix === null) {
    container.append($createFilterChipNode(mentionData));
  } else {
    container.append(
      $createFilterChipPrefixNode(prefix),
      $createFilterChipIconNode(mentionData),
      $createFilterChipNode(mentionData),
    );
  }
  return container;
}

// ---- Priority chip helpers ----

/**
 * Removes every existing priority chip from the editor so a freshly inserted one
 * stays the *exclusive* priority filter. Call inside an `editor.update` before
 * appending the new chip. Collect-then-remove avoids mutating the tree mid-walk.
 */
export function $removeExistingPriorityChips(): void {
  const containers: FilterChipContainerNode[] = [];
  const visit = (node: LexicalNode): void => {
    if ($isFilterChipContainerNode(node)) {
      const label = node.getChildren().find($isFilterChipNode);
      if (label && label.getMentionData().type === MentionType.PRIORITY) {
        containers.push(node);
        return;
      }
    }
    if ($isElementNode(node)) {
      node.getChildren().forEach(visit);
    }
  };
  $getRoot().getChildren().forEach(visit);
  containers.forEach(container => container.remove());
}
