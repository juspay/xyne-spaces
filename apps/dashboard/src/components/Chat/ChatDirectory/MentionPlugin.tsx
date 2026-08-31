import { useEffect, useRef, useState, useCallback } from 'react';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  COMMAND_PRIORITY_LOW,
  COMMAND_PRIORITY_HIGH,
  KEY_ARROW_DOWN_COMMAND,
  KEY_ARROW_UP_COMMAND,
  KEY_ENTER_COMMAND,
  KEY_ESCAPE_COMMAND,
  KEY_TAB_COMMAND,
  TextNode,
  type LexicalNode,
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  $getRoot,
} from 'lexical';
import { TicketPriority } from '@xyne/shared';
import { type ChipPrefix } from '../../../search/filterModel';
import { $createFilterChip, $removeExistingPriorityChips } from './FilterChipNode';
import { MentionType, type MentionData } from './ChannelCommandMenu.types';

export type ChannelTriggerType = '#' | 'in:' | 'in:#' | 'in:@';
/**
 * What the user is currently typing to summon a typeahead — deliberately NOT `ChipPrefix`.
 * It carries `@` and `in:@` (trigger spellings) and omits `priority:`, so merging the two
 * would let a trigger stand where a finished chip's prefix is expected.
 */
export type UserTriggerType = '@' | 'from:' | 'to:' | 'with:' | 'assignee:' | 'in:@';
export type PriorityTriggerType = 'priority:';

/**
 * Date triggers. Like `priority:`, a date is a value filter with a fixed candidate list, so
 * it opens a typeahead in the results rather than a picker of its own.
 */
export type DateTriggerType = 'on:' | 'after:' | 'before:';

/** Boards are picked, never typed — the backend matches an id, not a name. */
export type BoardTriggerType = 'board:';

/**
 * `mentions:` — the one typeahead that lists two kinds of thing (people and channels), so
 * the chip's type comes from the picked candidate rather than from the trigger.
 */
export type MentionsTriggerType = 'mentions:';

// Gate the `priority:` dropdown: open only for an empty value or a prefix of a real
// TicketPriority, so natural language ("High Priority: Refund rock") can't hijack it.
function priorityQueryHasMatch(query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return Object.values(TicketPriority).some(value => value.toLowerCase().startsWith(q));
}

// 'in:#' and 'in:@' are trigger modifiers; the chip prefix is just 'in:'.
function normalizePrefix(trigger: string): ChipPrefix | null {
  if (trigger === 'from:') return 'from:';
  if (trigger === 'to:') return 'to:';
  if (trigger === 'with:') return 'with:';
  if (trigger === 'assignee:') return 'assignee:';
  if (trigger === 'priority:') return 'priority:';
  if (trigger === 'board:') return 'board:';
  if (trigger === 'mentions:') return 'mentions:';
  if (trigger === 'on:') return 'on:';
  if (trigger === 'after:') return 'after:';
  if (trigger === 'before:') return 'before:';
  if (trigger.startsWith('in:')) return 'in:';
  // A bare `@`/`#` that got this far isn't a quick-switch — it's the mention filter, the
  // same one `mentions:` produces. One prefix, one representation.
  if (trigger === '@' || trigger === '#') return 'mentions:';
  return null;
}

function buildMentionData(
  item: { id: string; name: string; email?: string },
  type: MentionType,
  trigger: string,
): MentionData {
  const mentionData: MentionData = { id: item.id, name: item.name, type };
  const prefix = normalizePrefix(trigger);
  if (prefix) mentionData.prefix = prefix;
  if (item.email) mentionData.email = item.email;
  return mentionData;
}

interface MentionPluginProps {
  onUserSearch?: (query: string | null, trigger?: UserTriggerType) => void;
  onChannelSearch?: (query: string | null, trigger?: ChannelTriggerType) => void;
  // Priority is a value filter (closed enum), so there is no backend lookup —
  // the parent just tracks the typed query to filter the static value list.
  onPrioritySearch?: (query: string | null, trigger?: PriorityTriggerType) => void;
  // Dates behave like priority: a fixed candidate list, filtered by what's typed.
  onDateSearch?: (query: string | null, trigger?: DateTriggerType) => void;
  onBoardSearch?: (query: string | null, trigger?: BoardTriggerType) => void;
  onMentionsSearch?: (query: string | null, trigger?: MentionsTriggerType) => void;
  availableUsers?: Array<{ id: string; name: string; email?: string }>;
  availableChannels?: Array<{ id: string; name: string }>;
  availablePriorities?: Array<{ id: string; name: string }>;
  availableDates?: Array<{ id: string; name: string }>;
  availableBoards?: Array<{ id: string; name: string }>;
  availableMentionTargets?: Array<{ id: string; name: string; type: MentionType }>;
  onMentionSelect?: (mention: MentionData) => void;
  mentionSearchType?: MentionType | null;
  selectedMentionIndex?: number;
  setSelectedMentionIndex?: (index: number | ((prev: number) => number)) => void;
  // Called when the user moves the highlight via ArrowUp/Down in the typeahead, so the parent
  // can switch the candidate into the active (blue) tier and show its Select/Open ghost.
  onNavigate?: () => void;
  // Whether the user has already engaged a candidate this session. When false, the first
  // ArrowDown activates the resting candidate (index 0) IN PLACE instead of skipping to index 1.
  hasNavigated?: boolean;
  /** Exposes `replaceTriggerWithChips` — a filter needing several chips (a date range). */
  onReplaceTriggerChipsReady?: (replaceChips: (chips: MentionData[]) => void) => void;
  onInsertMentionReady?: (
    insertMention: (item: { id: string; name: string; email?: string }) => void,
  ) => void;
  onMentionInserted?: () => void;
  enableToTrigger?: boolean;
  // Current user's id — a chip of the current user gets the Slack self-mention color.
  currentUserID?: string;
}

type TriggerType = MentionType | null;

export function MentionPlugin({
  onUserSearch,
  onChannelSearch,
  onPrioritySearch,
  onDateSearch,
  onBoardSearch,
  onMentionsSearch,
  availableUsers = [],
  availableChannels = [],
  availablePriorities = [],
  onMentionSelect,
  mentionSearchType,
  selectedMentionIndex = 0,
  setSelectedMentionIndex,
  onNavigate,
  hasNavigated = false,
  onInsertMentionReady,
  onReplaceTriggerChipsReady,
  onMentionInserted,
  enableToTrigger = false,
  currentUserID,
}: MentionPluginProps) {
  const [editor] = useLexicalComposerContext();
  const [searchTerm, setSearchTerm] = useState('');
  const [triggerType, setTriggerType] = useState<TriggerType>(null);
  const mentionStartOffset = useRef<number | null>(null);
  const triggerText = useRef<string>('');
  const isInsertingMention = useRef(false);

  // Trigger search when trigger is detected (even without dropdown)
  useEffect(() => {
    if (!triggerType) return;

    // Debounce search to avoid too many calls
    const timeoutId = setTimeout(() => {
      if (triggerType === MentionType.USER && onUserSearch) {
        // User triggers: '@' navigates to DM; 'from:'/'to:'/'assignee:'/'with:' create filter chips
        const userTrigger: UserTriggerType =
          triggerText.current === '@'
            ? '@'
            : triggerText.current === 'to:'
              ? 'to:'
              : triggerText.current === 'assignee:'
                ? 'assignee:'
                : triggerText.current === 'with:'
                  ? 'with:'
                  : 'from:';
        onUserSearch(searchTerm, userTrigger);
      } else if (triggerType === MentionType.CHANNEL && onChannelSearch) {
        // Channel triggers today: '#' or 'in:'. Anything else falls back to
        // 'in:' (chip semantics) — safer default since '#' navigates away.
        // If a new channel-type trigger is added, register it explicitly.
        const channelTrigger: ChannelTriggerType =
          triggerText.current === '#' ? '#' : triggerText.current === 'in:#' ? 'in:#' : 'in:';
        onChannelSearch(searchTerm, channelTrigger);
      } else if (triggerType === MentionType.PRIORITY && onPrioritySearch) {
        onPrioritySearch(searchTerm, 'priority:');
      } else if (triggerType === MentionType.DATE && onDateSearch) {
        const dateTrigger = (triggerText.current || 'on:') as DateTriggerType;
        onDateSearch(searchTerm, dateTrigger);
      } else if (triggerType === MentionType.BOARD && onBoardSearch) {
        onBoardSearch(searchTerm, 'board:');
      }
    }, 150); // Reduced debounce for better responsiveness

    return () => clearTimeout(timeoutId);
  }, [
    searchTerm,
    triggerType,
    onUserSearch,
    onChannelSearch,
    onPrioritySearch,
    onDateSearch,
    onBoardSearch,
  ]);

  const replaceTriggerWithChips = useCallback(
    (chips: MentionData[]) => {
      isInsertingMention.current = true;
      const mentionStart = mentionStartOffset.current;
      const trigger = triggerText.current;
      if (mentionStart === null || chips.length === 0) {
        isInsertingMention.current = false;
        return;
      }

      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;
        const anchorNode = selection.anchor.getNode();
        if (!(anchorNode instanceof TextNode)) return;

        const textContent = anchorNode.getTextContent();
        const cursorOffset = selection.anchor.offset;
        // Bail if the trigger moved out from under us (same guard insertMention uses).
        if (textContent.substring(mentionStart, mentionStart + trigger.length) !== trigger) return;

        const textBefore = textContent.substring(0, mentionStart);
        const textAfter = textContent.substring(cursorOffset);
        anchorNode.setTextContent(textBefore);

        // Chips in order, each followed by a space, so they read as separate pills.
        let cursor: LexicalNode = anchorNode;
        for (const chip of chips) {
          const chipNode = $createFilterChip(chip, currentUserID);
          cursor.insertAfter(chipNode);
          const spaceNode = $createTextNode(' ');
          chipNode.insertAfter(spaceNode);
          cursor = spaceNode;
        }
        if (textAfter) cursor.insertAfter($createTextNode(textAfter));
        cursor.selectEnd();

        for (const chip of chips) onMentionSelect?.(chip);
      });

      setSearchTerm('');
      setTriggerType(null);
      triggerText.current = '';
      mentionStartOffset.current = null;
      if (setSelectedMentionIndex) setSelectedMentionIndex(0);
      setTimeout(() => {
        isInsertingMention.current = false;
      }, 0);
    },
    [editor, currentUserID, onMentionSelect, setSelectedMentionIndex],
  );

  // Insert mention
  const insertMention = useCallback(
    (item: { id: string; name: string; email?: string; type?: MentionType }) => {
      // Set flag to prevent update listener from interfering
      isInsertingMention.current = true;

      // Capture the mention start offset before editor.update
      const mentionStart = mentionStartOffset.current;
      const trigger = triggerText.current;
      // Use explicit type from item if provided (for in: combined list), otherwise use triggerType
      const type = item.type ?? triggerType;

      if (mentionStart === null || !type) {
        isInsertingMention.current = false;
        return;
      }

      editor.update(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) {
          // If no selection, try to restore it at the end of the root
          const root = $getRoot();
          const lastChild = root.getLastChild();
          if (lastChild) {
            lastChild.selectEnd();
            const newSelection = $getSelection();
            if (!$isRangeSelection(newSelection)) {
              isInsertingMention.current = false;
              return;
            }
            // Continue with the new selection
            const anchor = newSelection.anchor;
            const anchorNode = anchor.getNode();
            if (!(anchorNode instanceof TextNode)) {
              isInsertingMention.current = false;
              return;
            }

            const textContent = anchorNode.getTextContent();
            const cursorOffset = anchor.offset;

            // Verify trigger is still at the expected position
            const triggerAtStart = textContent.substring(
              mentionStart,
              mentionStart + trigger.length,
            );
            if (triggerAtStart !== trigger) {
              isInsertingMention.current = false;
              return;
            }

            // Get text parts
            const textBefore = textContent.substring(0, mentionStart);
            const textAfter = textContent.substring(cursorOffset);

            // Set the node text to only the text before trigger
            anchorNode.setTextContent(textBefore);

            const mentionData = buildMentionData(item, type, trigger);
            // Priority is the exclusive filter — drop any existing priority chip first.
            if (type === MentionType.PRIORITY) {
              $removeExistingPriorityChips();
            }
            // Insert the chip pill (icon + editable label) then a trailing space.
            const chip = $createFilterChip(mentionData, currentUserID);
            const spaceNode = $createTextNode(' ');
            anchorNode.insertAfter(chip);
            chip.insertAfter(spaceNode);

            // If there's text after, add it
            if (textAfter) {
              const afterNode = $createTextNode(textAfter);
              spaceNode.insertAfter(afterNode);
            }

            // Move cursor after the space
            spaceNode.selectEnd();

            onMentionSelect?.(mentionData);
          } else {
            isInsertingMention.current = false;
          }
          return;
        }

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        if (!(anchorNode instanceof TextNode)) return;

        const textContent = anchorNode.getTextContent();
        const cursorOffset = anchor.offset;

        // Verify trigger is still at the expected position
        const triggerAtStart = textContent.substring(mentionStart, mentionStart + trigger.length);
        if (triggerAtStart !== trigger) return;

        // Get text parts
        const textBefore = textContent.substring(0, mentionStart);
        const textAfter = textContent.substring(cursorOffset);

        // Set the node text to only the text before trigger
        anchorNode.setTextContent(textBefore);

        const mentionData = buildMentionData(item, type, trigger);
        // Priority is the exclusive filter — drop any existing priority chip first.
        if (type === MentionType.PRIORITY) {
          $removeExistingPriorityChips();
        }
        // Insert the chip pill (icon + editable label) then a trailing space.
        const chip = $createFilterChip(mentionData, currentUserID);
        const spaceNode = $createTextNode(' ');
        anchorNode.insertAfter(chip);
        chip.insertAfter(spaceNode);

        // If there's text after, add it
        if (textAfter) {
          const afterNode = $createTextNode(textAfter);
          spaceNode.insertAfter(afterNode);
        }

        // Move cursor after the space
        spaceNode.selectEnd();

        onMentionSelect?.(mentionData);
      });

      // Reset state
      setSearchTerm('');
      if (setSelectedMentionIndex) {
        setSelectedMentionIndex(0);
      }
      const wasMentionsTrigger = triggerText.current === 'mentions:';
      mentionStartOffset.current = null;
      triggerText.current = '';
      setTriggerType(null);
      isInsertingMention.current = false;

      // Clear mention search state by calling search handlers with empty query.
      // `mentions:` is keyed off the trigger, not `type` — the picked candidate's type is
      // USER or CHANNEL, so keying off it would re-open the people/channel typeahead.
      if (wasMentionsTrigger && onMentionsSearch) {
        onMentionsSearch('');
      } else if (type === MentionType.USER && onUserSearch) {
        onUserSearch('');
      } else if (type === MentionType.CHANNEL && onChannelSearch) {
        onChannelSearch('');
      } else if (type === MentionType.PRIORITY && onPrioritySearch) {
        onPrioritySearch('');
      } else if (type === MentionType.DATE && onDateSearch) {
        onDateSearch('');
      } else if (type === MentionType.BOARD && onBoardSearch) {
        onBoardSearch('');
      }

      // Notify parent that a mention was inserted (keyboard or click path)
      if (onMentionInserted) {
        onMentionInserted();
      }
    },
    [
      editor,
      triggerType,
      onMentionSelect,
      onUserSearch,
      onChannelSearch,
      onPrioritySearch,
      onDateSearch,
      onMentionsSearch,
      setSelectedMentionIndex,
      onMentionInserted,
    ],
  );

  // Expose insertMention function to parent component
  useEffect(() => {
    if (onReplaceTriggerChipsReady) {
      onReplaceTriggerChipsReady(replaceTriggerWithChips);
    }
    if (onInsertMentionReady) {
      onInsertMentionReady(insertMention);
    }
  }, [insertMention, onInsertMentionReady]);

  // Handle keyboard navigation for mention results in main search area
  // Using the same logic as dropdown but controlled by parent's setSelectedMentionIndex
  useEffect(() => {
    if (!mentionSearchType || !setSelectedMentionIndex) return;

    const currentItems =
      mentionSearchType === MentionType.USER
        ? availableUsers
        : mentionSearchType === MentionType.PRIORITY
          ? availablePriorities
          : availableChannels;
    if (currentItems.length === 0) return;

    const removeKeyDownCommand = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      event => {
        event?.preventDefault();
        if (currentItems.length === 0) {
          return true;
        }
        setSelectedMentionIndex(prev => (prev + 1) % currentItems.length);
        onNavigate?.();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const removeKeyUpCommand = editor.registerCommand(
      KEY_ARROW_UP_COMMAND,
      event => {
        event?.preventDefault();
        if (currentItems.length === 0) {
          return true;
        }
        setSelectedMentionIndex(prev => (prev - 1 + currentItems.length) % currentItems.length);
        onNavigate?.();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const removeKeyEnterCommand = editor.registerCommand(
      KEY_ENTER_COMMAND,
      event => {
        if (
          mentionSearchType &&
          currentItems.length > 0 &&
          selectedMentionIndex >= 0 &&
          selectedMentionIndex < currentItems.length &&
          mentionStartOffset.current !== null
        ) {
          event?.preventDefault();
          event?.stopPropagation();
          const item = currentItems[selectedMentionIndex];
          if (item) {
            const userItem =
              mentionSearchType === MentionType.USER
                ? (item as { id: string; name: string; email?: string })
                : (item as { id: string; name: string });
            insertMention(userItem);
          }
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );

    const removeKeyTabCommand = editor.registerCommand(
      KEY_TAB_COMMAND,
      event => {
        if (
          mentionSearchType &&
          currentItems.length > 0 &&
          selectedMentionIndex >= 0 &&
          selectedMentionIndex < currentItems.length &&
          mentionStartOffset.current !== null
        ) {
          event?.preventDefault();
          const item = currentItems[selectedMentionIndex];
          if (item) {
            const userItem =
              mentionSearchType === MentionType.USER
                ? (item as { id: string; name: string; email?: string })
                : (item as { id: string; name: string });
            insertMention(userItem);
          }
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    const removeKeyEscapeCommand = editor.registerCommand(
      KEY_ESCAPE_COMMAND,
      event => {
        if (mentionSearchType) {
          event?.preventDefault();
          setSelectedMentionIndex(0);
          mentionStartOffset.current = null;
          triggerText.current = '';
          setTriggerType(null);
          // Clear mention search state by calling search handlers with empty query
          if (mentionSearchType === 'user' && onUserSearch) {
            onUserSearch(null);
          } else if (mentionSearchType === 'channel' && onChannelSearch) {
            onChannelSearch(null);
          } else if (mentionSearchType === MentionType.PRIORITY && onPrioritySearch) {
            onPrioritySearch(null);
          } else if (mentionSearchType === MentionType.DATE && onDateSearch) {
            onDateSearch(null);
          } else if (mentionSearchType === MentionType.BOARD && onBoardSearch) {
            onBoardSearch(null);
          }
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_LOW,
    );

    return () => {
      removeKeyDownCommand();
      removeKeyUpCommand();
      removeKeyEnterCommand();
      removeKeyTabCommand();
      removeKeyEscapeCommand();
    };
  }, [
    editor,
    mentionSearchType,
    availableUsers,
    availableChannels,
    availablePriorities,
    selectedMentionIndex,
    setSelectedMentionIndex,
    insertMention,
    onNavigate,
    hasNavigated,
    onUserSearch,
    onChannelSearch,
    onPrioritySearch,
  ]);

  // Listen for trigger patterns: "from:", "@", "in:", "#"
  useEffect(() => {
    return editor.registerUpdateListener(({ editorState }) => {
      editorState.read(() => {
        const selection = $getSelection();
        if (!$isRangeSelection(selection)) return;

        const anchor = selection.anchor;
        const anchorNode = anchor.getNode();

        if (!(anchorNode instanceof TextNode)) return;

        const textContent = anchorNode.getTextContent();
        const cursorOffset = anchor.offset;

        // Look for trigger patterns before cursor
        const textBeforeCursor = textContent.substring(0, cursorOffset);

        // Check for "from:", "to:", "with:", or "@" (user triggers).
        const fromMatch = textBeforeCursor.match(/\bfrom:\s*(.*)$/i);
        const toMatch = enableToTrigger ? textBeforeCursor.match(/\bto:\s*(.*)$/i) : null;
        const withMatch = textBeforeCursor.match(/\bwith:\s*(.*)$/i);
        // `(?:^|\s)@` ignores an embedded `@` (email/URL won't hijack mention mode); the query
        // allows spaces (so a demoted multi-word chip re-arms) but not a leading space, may be empty.
        const atMatch = textBeforeCursor.match(/(?:^|\s)@([^@\s][^@]*)?$/);

        const assigneeMatch = textBeforeCursor.match(/\bassignee:\s*(.*)$/i);

        // Check for "in:" or "#" (channel triggers)
        // Safe alongside the `@`/`#` triggers: both of those need a space or start-of-line
        // before the sigil, and here it follows a colon.
        const mentionsMatch = textBeforeCursor.match(/\bmentions:\s*(.*)$/i);
        const inMatch = textBeforeCursor.match(/\bin:\s*(.*)$/i);
        const hashMatch = textBeforeCursor.match(/(?:^|\s)#(\S*)$/);

        // `priority:` trigger. Prefix is case-sensitive (no /i) so it stays in sync with
        // the lowercase `lastIndexOf('priority:')` insert offset; the value is matched
        // case-insensitively (priorityQueryHasMatch).
        const priorityMatch = textBeforeCursor.match(/\bpriority:\s*(.*)$/);

        // Date triggers. The value is a partial date or a preset name, so anything is a
        // valid in-progress query — no gate like priorityQueryHasMatch.
        const boardMatch = textBeforeCursor.match(/\bboard:\s*(.*)$/i);
        const onMatch = textBeforeCursor.match(/\bon:\s*(.*)$/i);
        const afterMatch = textBeforeCursor.match(/\bafter:\s*(.*)$/i);
        const beforeMatch = textBeforeCursor.match(/\bbefore:\s*(.*)$/i);

        let trigger: { type: TriggerType; text: string; query: string; index: number } | null =
          null;

        if (fromMatch) {
          trigger = {
            type: 'user',
            text: 'from:',
            query: (fromMatch[1] || '').replace(/^@/, '').trim(),
            index: textBeforeCursor.lastIndexOf('from:'),
          };
        } else if (toMatch) {
          trigger = {
            type: 'user',
            text: 'to:',
            query: (toMatch[1] || '').replace(/^@/, '').trim(),
            index: textBeforeCursor.lastIndexOf('to:'),
          };
        } else if (withMatch) {
          trigger = {
            type: 'user',
            text: 'with:',
            query: (withMatch[1] || '').replace(/^@/, '').trim(),
            index: textBeforeCursor.lastIndexOf('with:'),
          };
        } else if (assigneeMatch) {
          trigger = {
            type: 'user',
            text: 'assignee:',
            query: (assigneeMatch[1] || '').replace(/^@/, '').trim(),
            index: textBeforeCursor.lastIndexOf('assignee:'),
          };
        } else if (priorityMatch && priorityQueryHasMatch(priorityMatch[1] || '')) {
          trigger = {
            type: MentionType.PRIORITY,
            text: 'priority:',
            query: (priorityMatch[1] || '').trim(),
            index: textBeforeCursor.lastIndexOf('priority:'),
          };
        } else if (boardMatch) {
          trigger = {
            type: MentionType.BOARD,
            text: 'board:',
            query: (boardMatch[1] || '').trim(),
            index: textBeforeCursor.toLowerCase().lastIndexOf('board:'),
          };
        } else if (onMatch) {
          trigger = {
            type: MentionType.DATE,
            text: 'on:',
            query: (onMatch[1] || '').trim(),
            index: textBeforeCursor.toLowerCase().lastIndexOf('on:'),
          };
        } else if (afterMatch) {
          trigger = {
            type: MentionType.DATE,
            text: 'after:',
            query: (afterMatch[1] || '').trim(),
            index: textBeforeCursor.toLowerCase().lastIndexOf('after:'),
          };
        } else if (beforeMatch) {
          trigger = {
            type: MentionType.DATE,
            text: 'before:',
            query: (beforeMatch[1] || '').trim(),
            index: textBeforeCursor.toLowerCase().lastIndexOf('before:'),
          };
        } else if (mentionsMatch) {
          trigger = {
            type: MentionType.MENTIONS,
            text: 'mentions:',
            query: (mentionsMatch[1] || '').replace(/^[@#]/, '').trim(),
            index: textBeforeCursor.toLowerCase().lastIndexOf('mentions:'),
          };
        } else if (inMatch) {
          const inQuery = (inMatch[1] || '').trim();
          // "in:@" compound trigger — search DMs (not users!) with in: prefix
          if (inQuery.startsWith('@')) {
            trigger = {
              type: 'channel',
              text: 'in:@',
              query: inQuery.substring(1).trim(),
              index: textBeforeCursor.lastIndexOf('in:'),
            };
          } else if (inQuery.startsWith('#')) {
            // "in:#" compound trigger — search only channels
            trigger = {
              type: 'channel',
              text: 'in:#',
              query: inQuery.substring(1).trim(),
              index: textBeforeCursor.lastIndexOf('in:'),
            };
          } else {
            trigger = {
              type: 'channel',
              text: 'in:',
              query: inQuery.trim(),
              index: textBeforeCursor.lastIndexOf('in:'),
            };
          }
        } else if (atMatch) {
          // Strip trailing punctuation from mention query to avoid breaking
          // Fuse.js fuzzy search (e.g., typing "@john." should still match "john.doe")
          const rawQuery = atMatch[1] || '';
          const normalizedQuery = rawQuery.replace(/[.,!?:;)]*$/, '');
          // @channel / @here are reserved broadcast keywords, never users — skip user-mention mode
          // (first token, so "@channel test" counts too) so the message search runs, not a picker.
          if (!/^(channel|here)(\s|$)/i.test(normalizedQuery)) {
            trigger = {
              type: 'user',
              text: '@',
              query: normalizedQuery,
              index: textBeforeCursor.lastIndexOf('@'),
            };
          }
        } else if (hashMatch) {
          trigger = {
            type: 'channel',
            text: '#',
            query: hashMatch[1] || '',
            index: textBeforeCursor.lastIndexOf('#'),
          };
        }

        if (trigger) {
          setSearchTerm(trigger.query);
          setTriggerType(trigger.type);
          mentionStartOffset.current = trigger.index;
          triggerText.current = trigger.text;
          if (setSelectedMentionIndex) {
            setSelectedMentionIndex(0); // Reset selection index
          }

          // Trigger search immediately when trigger is detected
          if (trigger.type === 'user' && onUserSearch) {
            const userTrigger: UserTriggerType =
              trigger.text === '@'
                ? '@'
                : trigger.text === 'to:'
                  ? 'to:'
                  : trigger.text === 'assignee:'
                    ? 'assignee:'
                    : trigger.text === 'with:'
                      ? 'with:'
                      : 'from:';
            onUserSearch(trigger.query.trim(), userTrigger);
          } else if (trigger.type === 'channel' && onChannelSearch) {
            // Channel triggers: '#' or 'in:' variants
            const channelTrigger: ChannelTriggerType =
              trigger.text === '#'
                ? '#'
                : trigger.text === 'in:#'
                  ? 'in:#'
                  : trigger.text === 'in:@'
                    ? 'in:@'
                    : 'in:';
            onChannelSearch(trigger.query.trim(), channelTrigger);
          } else if (trigger.type === MentionType.PRIORITY && onPrioritySearch) {
            onPrioritySearch(trigger.query.trim(), 'priority:');
          } else if (trigger.type === MentionType.MENTIONS && onMentionsSearch) {
            onMentionsSearch(trigger.query.trim(), 'mentions:');
          }

          return;
        }

        // Hide mention search if conditions not met
        if (triggerType && !isInsertingMention.current) {
          setSearchTerm('');
          if (setSelectedMentionIndex) {
            setSelectedMentionIndex(0);
          }
          mentionStartOffset.current = null;
          triggerText.current = '';
          setTriggerType(null);
          // Clear search
          if (triggerType === 'user' && onUserSearch) {
            onUserSearch(null);
          } else if (triggerType === 'channel' && onChannelSearch) {
            onChannelSearch(null);
          } else if (triggerType === MentionType.PRIORITY && onPrioritySearch) {
            onPrioritySearch(null);
          } else if (triggerType === MentionType.DATE && onDateSearch) {
            onDateSearch(null);
          } else if (triggerType === MentionType.BOARD && onBoardSearch) {
            onBoardSearch(null);
          } else if (triggerType === MentionType.MENTIONS && onMentionsSearch) {
            onMentionsSearch(null);
          }
        }
      });
    });
  }, [
    editor,
    triggerType,
    onUserSearch,
    onChannelSearch,
    onPrioritySearch,
    onDateSearch,
    onBoardSearch,
    onMentionsSearch,
    enableToTrigger,
  ]);

  // Don't render popup - results will be shown in main search results area
  return null;
}
