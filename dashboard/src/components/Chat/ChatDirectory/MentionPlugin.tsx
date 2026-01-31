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
  KEY_BACKSPACE_COMMAND,
  KEY_DELETE_COMMAND,
  TextNode,
  $getSelection,
  $isRangeSelection,
  $createTextNode,
  $getRoot,
} from 'lexical';
import { $createMentionNode, MentionData, $isMentionNode } from './MentionNode';
import { MentionType } from './ChannelCommandMenu.types';

interface MentionPluginProps {
  onUserSearch?: (query: string | null) => void;
  onChannelSearch?: (query: string | null) => void;
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
        onUserSearch(searchTerm);
      } else if (triggerType === MentionType.CHANNEL && onChannelSearch) {
        onChannelSearch(searchTerm);
      }
    }, 150); // Reduced debounce for better responsiveness

    return () => clearTimeout(timeoutId);
  }, [searchTerm, triggerType, onUserSearch, onChannelSearch]);

  // Insert mention
  const insertMention = useCallback(
    (item: { id: string; name: string; email?: string }) => {
      // Set flag to prevent update listener from interfering
      isInsertingMention.current = true;

      // Capture the mention start offset before editor.update
      const mentionStart = mentionStartOffset.current;
      const trigger = triggerText.current;
      const type = triggerType;

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
            const mentionData: MentionData = {
              id: item.id,
              name: item.name,
              type: type === MentionType.USER ? MentionType.USER : MentionType.CHANNEL,
              ...(item.email && { email: item.email }),
            };
            const mentionNode = $createMentionNode(mentionData);
            const spaceNode = $createTextNode(' ');

            // Insert mention after the current text
            anchorNode.insertAfter(mentionNode);
            mentionNode.insertAfter(spaceNode);

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

        // Create mention node
        const mentionData: MentionData = {
          id: item.id,
          name: item.name,
          type: type === MentionType.USER ? MentionType.USER : MentionType.CHANNEL,
          ...(item.email && { email: item.email }),
        };
        const mentionNode = $createMentionNode(mentionData);
        const spaceNode = $createTextNode(' ');

        // Insert mention after the current text
        anchorNode.insertAfter(mentionNode);
        mentionNode.insertAfter(spaceNode);

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

    // Handle backspace to delete mention nodes
    const removeBackspaceCommand = editor.registerCommand(
      KEY_BACKSPACE_COMMAND,
      () => {
        let handled = false;
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;

          const nodes = selection.getNodes();
          const anchor = selection.anchor;
          const anchorNode = anchor.getNode();

          // If selection contains mention nodes, delete them
          for (const node of nodes) {
            if ($isMentionNode(node)) {
              node.remove();
              handled = true;
              return;
            }
          }

          // Check if cursor is at the start of a text node
          if (anchor.offset === 0) {
            const previousSibling = anchorNode.getPreviousSibling();
            if (previousSibling && $isMentionNode(previousSibling)) {
              previousSibling.remove();
              handled = true;
              return;
            }
          }

          const parent = anchorNode.getParent();
          if (parent && anchor.offset === 0) {
            const parentPrevSibling = parent.getPreviousSibling();
            if (parentPrevSibling && $isMentionNode(parentPrevSibling)) {
              parentPrevSibling.remove();
              handled = true;
              return;
            }
          }
        });
        return handled;
      },
      COMMAND_PRIORITY_HIGH,
    );

    // Handle delete key for mention nodes
    const removeDeleteCommand = editor.registerCommand(
      KEY_DELETE_COMMAND,
      () => {
        let handled = false;
        editor.update(() => {
          const selection = $getSelection();
          if (!$isRangeSelection(selection)) return;

          const nodes = selection.getNodes();
          const anchor = selection.anchor;
          const anchorNode = anchor.getNode();

          for (const node of nodes) {
            if ($isMentionNode(node)) {
              node.remove();
              handled = true;
              return;
            }
          }

          if (anchor.offset === anchorNode.getTextContentSize()) {
            const nextSibling = anchorNode.getNextSibling();
            if (nextSibling && $isMentionNode(nextSibling)) {
              nextSibling.remove();
              handled = true;
              return;
            }
          }

          const parent = anchorNode.getParent();
          if (parent && anchor.offset === anchorNode.getTextContentSize()) {
            const parentNextSibling = parent.getNextSibling();
            if (parentNextSibling && $isMentionNode(parentNextSibling)) {
              parentNextSibling.remove();
              handled = true;
              return;
            }
          }
        });
        return handled;
      },
      COMMAND_PRIORITY_HIGH,
    );

    return () => {
      removeKeyDownCommand();
      removeKeyUpCommand();
      removeKeyEnterCommand();
      removeKeyTabCommand();
      removeKeyEscapeCommand();
      removeBackspaceCommand();
      removeDeleteCommand();
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

        // Check for "from:" or "@" (user triggers)
        const fromMatch = textBeforeCursor.match(/\bfrom:\s*(\S*)$/i);
        const atMatch = textBeforeCursor.match(/@(\S*)$/);

        // Check for "in:" or "#" (channel triggers)
        const inMatch = textBeforeCursor.match(/\bin:\s*(\S*)$/i);
        const hashMatch = textBeforeCursor.match(/#(\S*)$/);

        let trigger: { type: TriggerType; text: string; query: string; index: number } | null =
          null;

        if (fromMatch) {
          trigger = {
            type: 'user',
            text: 'from:',
            query: fromMatch[1] || '',
            index: textBeforeCursor.lastIndexOf('from:'),
          };
        } else if (atMatch) {
          trigger = {
            type: 'user',
            text: '@',
            query: atMatch[1] || '',
            index: textBeforeCursor.lastIndexOf('@'),
          };
        } else if (inMatch) {
          trigger = {
            type: 'channel',
            text: 'in:',
            query: inMatch[1] || '',
            index: textBeforeCursor.lastIndexOf('in:'),
          };
        } else if (hashMatch) {
          trigger = {
            type: 'channel',
            text: '#',
            query: hashMatch[1] || '',
            index: textBeforeCursor.lastIndexOf('#'),
          };
        }

        if (trigger && !trigger.query.includes(' ')) {
          setSearchTerm(trigger.query);
          setTriggerType(trigger.type);
          mentionStartOffset.current = trigger.index;
          triggerText.current = trigger.text;
          if (setSelectedMentionIndex) {
            setSelectedMentionIndex(0); // Reset selection index
          }

          // Trigger search immediately when trigger is detected
          if (trigger.type === 'user' && onUserSearch) {
            onUserSearch(trigger.query);
          } else if (trigger.type === 'channel' && onChannelSearch) {
            onChannelSearch(trigger.query);
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
