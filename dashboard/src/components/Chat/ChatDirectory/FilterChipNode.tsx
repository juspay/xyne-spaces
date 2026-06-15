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
import { Hash, Lock, SignalHigh, User } from 'lucide-react';
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

/** The chip's display text (`prefix name`, e.g. `from: alice` / `in: general`).
 *  Demotion leaves exactly this string, so it parses like a hand-typed filter. */
export function buildChipText(mentionData: MentionData): string {
  // Chip always reads lowercase (`priority: high`), independent of the dropdown label.
  if (mentionData.type === MentionType.PRIORITY) {
    return `priority: ${mentionData.id.toLowerCase()}`;
  }
  if (mentionData.prefix) {
    return `${mentionData.prefix} ${mentionData.name}`;
  }
  const prefix = mentionData.type === MentionType.USER ? 'from: ' : 'in: ';
  return `${prefix}${mentionData.name}`;
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
    return <Hash className={ICON_CLASS} />;
  }
  if (
    channel.scopeType === ChannelScopeType.DM ||
    channel.scopeType === ChannelScopeType.GROUP_DM
  ) {
    return <User className={ICON_CLASS} />;
  }
  return channel.visibility === ChannelVisibility.PUBLIC ? (
    <Hash className={ICON_CLASS} />
  ) : (
    <Lock className={ICON_CLASS} />
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
    return <User className={ICON_CLASS} />;
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

export function $isFilterChipIconNode(
  node: LexicalNode | null | undefined,
): node is FilterChipIconNode {
  return node instanceof FilterChipIconNode;
}

// ---- Pill wrapper (FilterChipContainerNode) ----

/**
 * The inline pill — parent of the icon + label. Its `.filter-chip` style
 * (inline-flex, items-center) aligns them with no per-glyph tuning, and the
 * background lives only here, so demoting the label drops the whole pill at once.
 */
export class FilterChipContainerNode extends ElementNode {
  static override getType(): string {
    return 'filter-chip-container';
  }

  static override clone(node: FilterChipContainerNode): FilterChipContainerNode {
    return new FilterChipContainerNode(node.__key);
  }

  static override importJSON(): FilterChipContainerNode {
    return new FilterChipContainerNode();
  }

  override createDOM(): HTMLElement {
    const dom = document.createElement('span');
    dom.classList.add('filter-chip');
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

  override exportJSON(): SerializedElementNode {
    return { ...super.exportJSON(), type: 'filter-chip-container' };
  }
}

export function $isFilterChipContainerNode(
  node: LexicalNode | null | undefined,
): node is FilterChipContainerNode {
  return node instanceof FilterChipContainerNode;
}

/** Build a complete chip: an inline pill containing the icon + editable label. */
export function $createFilterChip(mentionData: MentionData): FilterChipContainerNode {
  const container = new FilterChipContainerNode();
  container.append($createFilterChipIconNode(mentionData), $createFilterChipNode(mentionData));
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
