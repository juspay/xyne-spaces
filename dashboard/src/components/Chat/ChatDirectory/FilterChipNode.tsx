/**
 * The cmd+K filter chip — the inline blue pill rendered for a picked
 * from:/with:/assignee:/in: filter. It is three Lexical nodes:
 *
 *   FilterChipContainerNode   inline pill (.filter-chip), parent of:
 *     FilterChipIconNode      leading lucide glyph (DecoratorNode)
 *     FilterChipNode          editable label (TextNode)
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
import { SignalHigh } from 'lucide-react';
import { Hashtag, UserTwo, Lock02Close } from '@xyne/icons';
import { ChannelScopeType, ChannelVisibility, TicketPriority } from '@xyne/shared';
import { useChannel } from '../../../hooks/useChannels';
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

/** Chip display text: prefixed filters read `prefix name`; a prefix-less mention reads with its
 *  sigil (`@alice`/`#general`). Demotion leaves this string verbatim to re-arm the dropdown. */
export function buildChipText(mentionData: MentionData): string {
  // Chip always reads lowercase (`priority: high`), independent of the dropdown label.
  if (mentionData.type === MentionType.PRIORITY) {
    return `priority: ${mentionData.id.toLowerCase()}`;
  }
  if (mentionData.prefix) {
    return `${mentionData.prefix} ${mentionData.name}`;
  }
  // Prefix-less chip = a bare @user/#channel mention search: render with its sigil, not
  // `from:`/`in:` (which would mislabel it as an author/scope filter).
  const sigil = mentionData.type === MentionType.USER ? '@' : '#';
  return `${sigil}${mentionData.name}`;
}

export class FilterChipNode extends TextNode {
  /** The picked entity + filter metadata this chip represents. */
  __mentionData: MentionData;
  /** Text at creation time; `FilterChipPlugin` demotes the chip once it diverges. */
  __expectedText: string;

  static override getType(): string {
    return 'filter-chip';
  }

  static override clone(node: FilterChipNode): FilterChipNode {
    return new FilterChipNode(node.__mentionData, node.__text, node.__expectedText, node.__key);
  }

  constructor(mentionData: MentionData, text?: string, expectedText?: string, key?: NodeKey) {
    const resolved = text ?? buildChipText(mentionData);
    super(resolved, key);
    this.__mentionData = mentionData;
    this.__expectedText = expectedText ?? buildChipText(mentionData);
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

// Size only, no color: the glyph inherits `currentColor` (`--chip-fg`) from the
// pill, so it tracks the chip text in every theme.
const ICON_CLASS = 'h-3.5 w-3.5';

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
function ChannelChipIcon({ id }: { id: string }): React.JSX.Element {
  const channel = useChannel(id);
  if (!channel) {
    return <Hashtag className={ICON_CLASS} />;
  }
  if (
    channel.scopeType === ChannelScopeType.DM ||
    channel.scopeType === ChannelScopeType.GROUP_DM
  ) {
    return <UserTwo className={ICON_CLASS} />;
  }
  return channel.visibility === ChannelVisibility.PUBLIC ? (
    <Hashtag className={ICON_CLASS} />
  ) : (
    <Lock02Close className={ICON_CLASS} />
  );
}

function ChipIcon({ mentionData }: { mentionData: MentionData }): React.JSX.Element {
  // Priority — checked first so it never falls through to the channel branch (which
  // calls `useChannel`). Glyph tinted by severity; pill stays blue.
  if (mentionData.type === MentionType.PRIORITY) {
    return <SignalHigh className={`${ICON_CLASS} ${PRIORITY_ICON_COLOR[mentionData.id] ?? ''}`} />;
  }
  // User filters always get the person glyph. The channel lookup lives in its own
  // component so `useChannel` is never called conditionally (rules of hooks).
  if (mentionData.type === MentionType.USER) {
    return <UserTwo className={ICON_CLASS} />;
  }
  return <ChannelChipIcon id={mentionData.id} />;
}

/**
 * The chip's leading icon. A DecoratorNode (not part of the label TextNode) so it
 * can render a real lucide-react component; it carries the label's MentionData.
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

/** Build the pill: editable label + a leading icon for prefixed filters (prefix-less mention
 *  chips drop the icon; a chip of the current user also gets Slack's self color). */
export function $createFilterChip(
  mentionData: MentionData,
  currentUserId?: string,
): FilterChipContainerNode {
  const isMention = !mentionData.prefix;
  // Any chip referencing the current user — bare @me or from:/with:/assignee: me — gets the
  // Slack self-mention color.
  const isSelfMention =
    mentionData.type === MentionType.USER && !!currentUserId && mentionData.id === currentUserId;
  const container = new FilterChipContainerNode(isSelfMention);
  if (isMention) {
    container.append($createFilterChipNode(mentionData));
  } else {
    container.append($createFilterChipIconNode(mentionData), $createFilterChipNode(mentionData));
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
