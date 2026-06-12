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
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  $getRoot,
} from 'lexical';
import { $createFilterChip } from './FilterChipNode';
import { MentionType, type MentionData } from './ChannelCommandMenu.types';

export type ChannelTriggerType = '#' | 'in:' | 'in:#' | 'in:@';
export type UserTriggerType = '@' | 'from:' | 'with:' | 'assignee:' | 'in:@';

interface MentionPluginProps {
  onUserSearch?: (query: string | null, trigger?: UserTriggerType) => void;
  onChannelSearch?: (query: string | null, trigger?: ChannelTriggerType) => void;
  availableUsers?: Array<{ id: string; name: string; email?: string }>;
  availableChannels?: Array<{ id: string; name: string }>;
  onMentionSelect?: (mention: MentionData) => void;
  mentionSearchType?: MentionType | null;
  selectedMentionIndex?: number;
  setSelectedMentionIndex?: (index: number | ((prev: number) => number)) => void;
  onInsertMentionReady?: (
    insertMention: (item: { id: string; name: string; email?: string }) => void,
  ) => void;
  onMentionInserted?: () => void;
}

type TriggerType = MentionType | null;

export function MentionPlugin({
  onUserSearch,
  onChannelSearch,
  availableUsers = [],
  availableChannels = [],
  onMentionSelect,
  mentionSearchType,
  selectedMentionIndex = 0,
  setSelectedMentionIndex,
  onInsertMentionReady,
  onMentionInserted,
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
        // User triggers: '@' navigates to DM; 'from:'/'assignee:'/'with:' create filter chips
        const userTrigger: UserTriggerType =
          triggerText.current === '@'
            ? '@'
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
      }
    }, 150); // Reduced debounce for better responsiveness

    return () => clearTimeout(timeoutId);
  }, [searchTerm, triggerType, onUserSearch, onChannelSearch]);

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

            // Create mention node
            const normalizedPrefix: 'from:' | 'with:' | 'in:' | 'assignee:' | null =
              trigger === 'from:'
                ? 'from:'
                : trigger === 'with:'
                  ? 'with:'
                  : trigger === 'assignee:'
                    ? 'assignee:'
                    : trigger?.startsWith('in:')
                      ? 'in:'
                      : null;
            const mentionData: MentionData = {
              id: item.id,
              name: item.name,
              type: type === MentionType.USER ? MentionType.USER : MentionType.CHANNEL,
              ...(normalizedPrefix && { prefix: normalizedPrefix }),
              ...(item.email && { email: item.email }),
            };
            // Insert the chip pill (icon + editable label) then a trailing space.
            const chip = $createFilterChip(mentionData);
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

        // Normalize trigger to the correct prefix
        // 'in:#' and 'in:@' are trigger modifiers, but the actual prefix should be 'in:'
        const normalizedPrefix: 'from:' | 'with:' | 'in:' | 'assignee:' | null =
          trigger === 'from:'
            ? 'from:'
            : trigger === 'with:'
              ? 'with:'
              : trigger === 'assignee:'
                ? 'assignee:'
                : trigger?.startsWith('in:')
                  ? 'in:'
                  : null;

        // Create mention node
        const mentionData: MentionData = {
          id: item.id,
          name: item.name,
          type: type === MentionType.USER ? MentionType.USER : MentionType.CHANNEL,
          ...(normalizedPrefix && { prefix: normalizedPrefix }),
          ...(item.email && { email: item.email }),
        };
        // Insert the chip pill (icon + editable label) then a trailing space.
        const chip = $createFilterChip(mentionData);
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
      mentionStartOffset.current = null;
      triggerText.current = '';
      setTriggerType(null);
      isInsertingMention.current = false;

      // Clear mention search state by calling search handlers with empty query
      if (type === MentionType.USER && onUserSearch) {
        onUserSearch('');
      } else if (type === MentionType.CHANNEL && onChannelSearch) {
        onChannelSearch('');
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
      setSelectedMentionIndex,
      onMentionInserted,
    ],
  );

  // Expose insertMention function to parent component
  useEffect(() => {
    if (onInsertMentionReady) {
      onInsertMentionReady(insertMention);
    }
  }, [insertMention, onInsertMentionReady]);

  // Handle keyboard navigation for mention results in main search area
  // Using the same logic as dropdown but controlled by parent's setSelectedMentionIndex
  useEffect(() => {
    if (!mentionSearchType || !setSelectedMentionIndex) return;

    const currentItems =
      mentionSearchType === MentionType.USER ? availableUsers : availableChannels;
    if (currentItems.length === 0) return;

    const removeKeyDownCommand = editor.registerCommand(
      KEY_ARROW_DOWN_COMMAND,
      event => {
        event?.preventDefault();
        if (currentItems.length === 0) {
          return true;
        }
        setSelectedMentionIndex(prev => (prev + 1) % currentItems.length);
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
    selectedMentionIndex,
    setSelectedMentionIndex,
    insertMention,
    onUserSearch,
    onChannelSearch,
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

        // Check for "from:", "with:", or "@" (user triggers)
        const fromMatch = textBeforeCursor.match(/\bfrom:\s*(.*)$/i);
        const withMatch = textBeforeCursor.match(/\bwith:\s*(.*)$/i);
        const atMatch = textBeforeCursor.match(/@(\S*)$/);

        const assigneeMatch = textBeforeCursor.match(/\bassignee:\s*(.*)$/i);

        // Check for "in:" or "#" (channel triggers)
        const inMatch = textBeforeCursor.match(/\bin:\s*(.*)$/i);
        const hashMatch = textBeforeCursor.match(/#(\S*)$/);

        let trigger: { type: TriggerType; text: string; query: string; index: number } | null =
          null;

        if (fromMatch) {
          trigger = {
            type: 'user',
            text: 'from:',
            query: (fromMatch[1] || '').replace(/^@/, '').trim(),
            index: textBeforeCursor.lastIndexOf('from:'),
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
          trigger = {
            type: 'user',
            text: '@',
            query: normalizedQuery,
            index: textBeforeCursor.lastIndexOf('@'),
          };
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
              trigger.text === '@' ? '@' : trigger.text === 'assignee:' ? 'assignee:' : 'from:';
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
          }
        }
      });
    });
  }, [editor, triggerType, onUserSearch, onChannelSearch]);

  // Don't render popup - results will be shown in main search results area
  return null;
}
