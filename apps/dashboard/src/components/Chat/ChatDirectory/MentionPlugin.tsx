import { useEffect, useRef, useState, useCallback } from 'react';
import { detectMentionTrigger } from '../../../search/mentionCandidates';
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
  $getSelection,
  $isRangeSelection,
  $getRoot,
} from 'lexical';
import { isChipPrefix, type ChipPrefix } from '../../../search/filterModel';
import { $removeExistingPriorityChips, $spliceFilterChip } from './FilterChipNode';
import { ChipType, type ChipData } from './ChannelCommandMenu.types';

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

/**
 * A typeahead trigger → the prefix its finished chip carries. Only the triggers that
 * *differ* from their prefix need a branch; everything else is already a chip prefix
 * verbatim, so it's checked against CHIP_PREFIXES rather than listed again here. Adding a
 * prefix to the model therefore needs no change in this function.
 */
function normalizePrefix(trigger: string): ChipPrefix | null {
  // `in:#` and `in:@` are trigger modifiers; the chip prefix is just `in:`.
  if (trigger.startsWith('in:')) return 'in:';
  // A bare `@`/`#` that got this far isn't a quick-switch — it's the mention filter, the
  // same one `mentions:` produces. One prefix, one representation.
  if (trigger === '@' || trigger === '#') return 'mentions:';
  return isChipPrefix(trigger) ? trigger : null;
}

function buildMentionData(
  item: { id: string; name: string; email?: string; alias?: string | null },
  type: ChipType,
  trigger: string,
): ChipData {
  // A user-group's chip reads its `@`-handle (alias) like the compose box; other kinds have
  // no alias and fall back to their name.
  const mentionData: ChipData = { id: item.id, name: item.alias ?? item.name, type };
  const prefix = normalizePrefix(trigger);
  if (prefix) mentionData.prefix = prefix;
  if (item.email) mentionData.email = item.email;
  return mentionData;
}

/**
 * The chip kinds this plugin can insert on its own: one candidate in, one chip out. Date,
 * board and mentions candidates need the palette's own handler (see the note by
 * `insertableItems`), so they're deliberately absent.
 */
const INSERTABLE_TYPES: ReadonlySet<ChipType> = new Set([
  ChipType.USER,
  ChipType.CHANNEL,
  ChipType.PRIORITY,
]);

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
  availableMentionTargets?: Array<{ id: string; name: string; type: ChipType }>;
  // The bare `@` typeahead's flat list — people interleaved with user-groups, pre-ordered by
  // the palette. Each item's optional `type` tells `insertMention` which chip to land (a
  // user vs a `groupMentions` group chip). When absent, USER mode uses `availableUsers`.
  availableUserMentionItems?: Array<{
    id: string;
    name: string;
    email?: string;
    type?: ChipType;
    alias?: string | null;
  }>;
  onMentionSelect?: (mention: ChipData) => void;
  mentionSearchType?: ChipType | null;
  selectedMentionIndex?: number;
  setSelectedMentionIndex?: (index: number | ((prev: number) => number)) => void;
  // Called when the user moves the highlight via ArrowUp/Down in the typeahead, so the parent
  // can switch the candidate into the active (blue) tier and show its Select/Open ghost.
  onNavigate?: () => void;
  // Whether the user has already engaged a candidate this session. When false, the first
  // ArrowDown activates the resting candidate (index 0) IN PLACE instead of skipping to index 1.
  hasNavigated?: boolean;
  /** Exposes `replaceTriggerWithChips` — a filter needing several chips (a date range). */
  onReplaceTriggerChipsReady?: (replaceChips: (chips: ChipData[]) => void) => void;
  onInsertMentionReady?: (
    insertMention: (item: { id: string; name: string; email?: string }) => void,
  ) => void;
  onMentionInserted?: () => void;
  enableToTrigger?: boolean;
  // Current user's id — a chip of the current user gets the Slack self-mention color.
  currentUserID?: string;
}

type TriggerType = ChipType | null;

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
  availableDates = [],
  availableBoards = [],
  availableMentionTargets = [],
  availableUserMentionItems = [],
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
      if (triggerType === ChipType.USER && onUserSearch) {
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
      } else if (triggerType === ChipType.CHANNEL && onChannelSearch) {
        // Channel triggers today: '#' or 'in:'. Anything else falls back to
        // 'in:' (chip semantics) — safer default since '#' navigates away.
        // If a new channel-type trigger is added, register it explicitly.
        const channelTrigger: ChannelTriggerType =
          triggerText.current === '#' ? '#' : triggerText.current === 'in:#' ? 'in:#' : 'in:';
        onChannelSearch(searchTerm, channelTrigger);
      } else if (triggerType === ChipType.PRIORITY && onPrioritySearch) {
        onPrioritySearch(searchTerm, 'priority:');
      } else if (triggerType === ChipType.DATE && onDateSearch) {
        const dateTrigger = (triggerText.current || 'on:') as DateTriggerType;
        onDateSearch(searchTerm, dateTrigger);
      } else if (triggerType === ChipType.BOARD && onBoardSearch) {
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
    (chips: ChipData[]) => {
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
        // Prefixes match in any letter case (`From:`), so this check does too.
        if (
          textContent.substring(mentionStart, mentionStart + trigger.length).toLowerCase() !==
          trigger.toLowerCase()
        ) {
          return;
        }

        // Chips in order, each followed by a space, so they read as separate pills.
        $spliceFilterChip(anchorNode, mentionStart, cursorOffset, chips, {
          currentUserId: currentUserID,
        });

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
    (item: {
      id: string;
      name: string;
      email?: string;
      type?: ChipType;
      alias?: string | null;
    }) => {
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
            if (triggerAtStart.toLowerCase() !== trigger.toLowerCase()) {
              isInsertingMention.current = false;
              return;
            }

            const mentionData = buildMentionData(item, type, trigger);
            // Priority is the exclusive filter — drop any existing priority chip first.
            if (type === ChipType.PRIORITY) {
              $removeExistingPriorityChips();
            }
            // Swap the typed trigger for the chip pill; the caret lands after its trailing space.
            $spliceFilterChip(anchorNode, mentionStart, cursorOffset, [mentionData], {
              currentUserId: currentUserID,
            });

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
        if (triggerAtStart.toLowerCase() !== trigger.toLowerCase()) return;

        const mentionData = buildMentionData(item, type, trigger);
        // Priority is the exclusive filter — drop any existing priority chip first.
        if (type === ChipType.PRIORITY) {
          $removeExistingPriorityChips();
        }
        // Swap the typed trigger for the chip pill; the caret lands after its trailing space.
        $spliceFilterChip(anchorNode, mentionStart, cursorOffset, [mentionData], {
          currentUserId: currentUserID,
        });

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
      } else if ((type === ChipType.USER || type === ChipType.USER_GROUP) && onUserSearch) {
        // A user-group is picked from the `@` (user) typeahead, so clearing it closes that list.
        onUserSearch('');
      } else if (type === ChipType.CHANNEL && onChannelSearch) {
        onChannelSearch('');
      } else if (type === ChipType.PRIORITY && onPrioritySearch) {
        onPrioritySearch('');
      } else if (type === ChipType.DATE && onDateSearch) {
        onDateSearch('');
      } else if (type === ChipType.BOARD && onBoardSearch) {
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

    // Keyed by type rather than chained: a ternary chain ends in a default, and every
    // type it forgets silently inherits it. `before:` used to land on `availableChannels`
    // — empty during a date search — so the effect bailed on the length check below and
    // Up/Down/Tab were never registered at all. Enter still worked, because the palette
    // handles that one itself (acceptHighlightedMention), which is what made this look
    // like a navigation-only bug.
    // The bare `@` typeahead is one flat list of people + user-groups, pre-interleaved by the
    // palette. Each item may carry its own `type` so `insertMention` lands the right chip
    // (a user vs a `groupMentions` chip); items without a type default to the trigger's type.
    const itemsByType: Partial<
      Record<
        ChipType,
        ReadonlyArray<{
          id: string;
          name: string;
          email?: string;
          type?: ChipType;
          alias?: string | null;
        }>
      >
    > = {
      [ChipType.USER]: availableUserMentionItems.length
        ? availableUserMentionItems
        : availableUsers,
      [ChipType.CHANNEL]: availableChannels,
      [ChipType.PRIORITY]: availablePriorities,
      [ChipType.DATE]: availableDates,
      [ChipType.BOARD]: availableBoards,
      [ChipType.MENTIONS]: availableMentionTargets,
    };
    const currentItems = itemsByType[mentionSearchType] ?? [];
    if (currentItems.length === 0) return;

    // Moving the highlight is the plugin's job for every type. *Accepting* it isn't:
    // `insertMention` lands exactly one chip, and a date preset like "Last 7 days" needs
    // two (`after:` + `before:`), while a mentions candidate has to be routed by whether
    // it turned out to be a person or a channel. The palette's `acceptHighlightedMention`
    // knows both; these handlers stand down for those types by reporting no candidates,
    // which lets the key fall through to it.
    const insertableItems = INSERTABLE_TYPES.has(mentionSearchType) ? currentItems : [];

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
          insertableItems.length > 0 &&
          selectedMentionIndex >= 0 &&
          selectedMentionIndex < insertableItems.length &&
          mentionStartOffset.current !== null
        ) {
          event?.preventDefault();
          event?.stopPropagation();
          const item = insertableItems[selectedMentionIndex];
          if (item) {
            // The item carries its own `type` (user vs user-group in the `@` list); insertMention
            // routes on it, falling back to the trigger's type when absent.
            insertMention(item);
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
          insertableItems.length > 0 &&
          selectedMentionIndex >= 0 &&
          selectedMentionIndex < insertableItems.length &&
          mentionStartOffset.current !== null
        ) {
          event?.preventDefault();
          const item = insertableItems[selectedMentionIndex];
          if (item) {
            // The item carries its own `type` (user vs user-group in the `@` list); insertMention
            // routes on it, falling back to the trigger's type when absent.
            insertMention(item);
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
          } else if (mentionSearchType === ChipType.PRIORITY && onPrioritySearch) {
            onPrioritySearch(null);
          } else if (mentionSearchType === ChipType.DATE && onDateSearch) {
            onDateSearch(null);
          } else if (mentionSearchType === ChipType.BOARD && onBoardSearch) {
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
    availableUserMentionItems,
    availableChannels,
    availablePriorities,
    availableDates,
    availableBoards,
    availableMentionTargets,
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

        // Look for trigger patterns before cursor.
        const textBeforeCursor = textContent.substring(0, cursorOffset);

        // An odd number of quotes before the caret means it sits inside a quoted run, and
        // everything in there is searched literally — a `from:` typed between the quotes is
        // text the user wants matched, not a filter half-picked. So no trigger is detected,
        // and a picker already open falls through to the "hide mention search" branch below,
        // tearing down by the same path as any other dismissal. Outside the quotes the
        // count is even and every trigger works normally, which is what keeps filters
        // usable while exact mode is on.
        const insideQuotes = (textBeforeCursor.match(/"/g) ?? []).length % 2 === 1;
        if (insideQuotes) {
          if (triggerType && !isInsertingMention.current) {
            setSearchTerm('');
            setSelectedMentionIndex?.(0);
            mentionStartOffset.current = null;
            triggerText.current = '';
            setTriggerType(null);
            onUserSearch?.(null);
            onChannelSearch?.(null);
            onPrioritySearch?.(null);
            onDateSearch?.(null);
            onBoardSearch?.(null);
            onMentionsSearch?.(null);
          }
          return;
        }

        // The prefix being typed (`from:`, `@`, `in:#`, `priority:`…) — shared with the full-page
        // search box, so both recognise the same prefixes the same way.
        const trigger = detectMentionTrigger(textBeforeCursor, {
          enableToTrigger: !!enableToTrigger,
        });

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
          } else if (trigger.type === ChipType.PRIORITY && onPrioritySearch) {
            onPrioritySearch(trigger.query.trim(), 'priority:');
          } else if (trigger.type === ChipType.MENTIONS && onMentionsSearch) {
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
          } else if (triggerType === ChipType.PRIORITY && onPrioritySearch) {
            onPrioritySearch(null);
          } else if (triggerType === ChipType.DATE && onDateSearch) {
            onDateSearch(null);
          } else if (triggerType === ChipType.BOARD && onBoardSearch) {
            onBoardSearch(null);
          } else if (triggerType === ChipType.MENTIONS && onMentionsSearch) {
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
