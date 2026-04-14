import { useEffect, useState, useCallback, useRef } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import {
  $getRoot,
  $getSelection,
  EditorState,
  $isElementNode,
  LexicalNode,
  $createTextNode,
  $createParagraphNode,
} from 'lexical';
import { MentionNode, $isMentionNode, $createMentionNode } from './MentionNode';
import type { MentionData } from './MentionNode';
import { MentionPlugin } from './MentionPlugin';
import { PastePlugin } from './PastePlugin';
import { cn } from '../../../utils/classNames';
import { MentionType } from './ChannelCommandMenu.types';
import { Search } from 'lucide-react';
import { usePlatform } from '../../../hooks/usePlatform';

interface LexicalSearchInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (
    text: string,
    mentions: Array<{ id: string; type: MentionType; prefix?: string }>,
  ) => void;
  onUserSearch?: (query: string | null) => void;
  onChannelSearch?: (query: string | null) => void;
  availableUsers?: Array<{ id: string; name: string; email?: string }>;
  availableChannels?: Array<{ id: string; name: string }>;
  className?: string;
  open?: boolean;
  mentionSearchType?: MentionType | null;
  selectedMentionIndex?: number;
  setSelectedMentionIndex?: (index: number | ((prev: number) => number)) => void;
  onInsertMentionReady?: (
    insertMention: (item: { id: string; name: string; email?: string }) => void,
  ) => void;
  onMentionInserted?: () => void;
  onPasteDetected?: () => void;
  onManualKeystroke?: () => void;
  autocompleteSuffix?: string;
  onInsertTextReady?: (insertText: (text: string) => void) => void;
  initialMention?: MentionData | null | undefined;
}

function InitialMentionPlugin({ initialMention }: { initialMention?: MentionData | null }) {
  const [editor] = useLexicalComposerContext();
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialMention) {
      appliedRef.current = null;
      return;
    }

    const mentionKey = `${initialMention.id}-${initialMention.prefix}`;
    if (appliedRef.current === mentionKey) return;
    appliedRef.current = mentionKey;

    const timeoutId = setTimeout(() => {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        root.append(paragraph);

        const mentionNode = $createMentionNode(initialMention);
        const spaceNode = $createTextNode(' ');
        paragraph.append(mentionNode);
        paragraph.append(spaceNode);
        spaceNode.selectEnd();
      });
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [initialMention, editor]);

  return null;
}

function PlaceholderPlugin({ placeholder }: { placeholder?: string }) {
  const [editor] = useLexicalComposerContext();
  const [showPlaceholder, setShowPlaceholder] = useState(true);
  const { isMobile } = usePlatform();

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      editor.getEditorState().read(() => {
        const root = $getRoot();
        const isEmpty = root.getTextContent().trim().length === 0;
        setShowPlaceholder(isEmpty);
      });
    });
  }, [editor]);

  if (!showPlaceholder || !placeholder) return null;

  return (
    <div
      className={`absolute ${isMobile ? 'left-0' : 'left-9'} top-1/2 -translate-y-1/2 text-sm text-[#C9CCCF] pointer-events-none`}
    >
      {placeholder}
    </div>
  );
}

function AutoFocusPlugin({ open }: { open?: boolean }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (open) {
      editor.focus();
    }
  }, [open, editor]);

  return null;
}

function ClearEditorPlugin({ value }: { value: string | undefined }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (value === '') {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
      });
    }
  }, [value, editor]);

  return null;
}

function InsertTextPlugin({
  onInsertTextReady,
}: {
  onInsertTextReady?: (insertText: (text: string) => void) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (onInsertTextReady) {
      const insertText = (text: string) => {
        editor.update(() => {
          const selection = $getSelection();
          if (selection !== null) {
            selection.insertText(text);
          }
        });
      };
      onInsertTextReady(insertText);
    }
  }, [editor, onInsertTextReady]);

  return null;
}

function CursorPositionPlugin({ onPositionChange }: { onPositionChange: (left: number) => void }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      const editorEl = editor.getRootElement();
      if (!editorEl) return;

      // Use requestAnimationFrame to ensure DOM has been updated after Lexical's render
      requestAnimationFrame(() => {
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;

        const range = selection.getRangeAt(0).cloneRange();
        range.collapse(false);

        const cursorRect = range.getBoundingClientRect();

        // If cursorRect has zero width/height, the range might be collapsed at a node boundary.
        // Use a temporary zero-width space to measure position accurately.
        if (cursorRect.left === 0 && cursorRect.right === 0) {
          const span = document.createElement('span');
          span.textContent = '\u200b';
          range.insertNode(span);
          const spanRect = span.getBoundingClientRect();
          const containerRect = editorEl
            .closest('[data-lexical-search-input]')
            ?.getBoundingClientRect();
          if (containerRect) {
            onPositionChange(spanRect.left - containerRect.left);
          }
          span.remove();
          return;
        }

        const containerRect = editorEl
          .closest('[data-lexical-search-input]')
          ?.getBoundingClientRect();
        if (containerRect) {
          onPositionChange(cursorRect.left - containerRect.left);
        }
      });
    });
  }, [editor, onPositionChange]);

  return null;
}

function OnChangePluginWrapper({
  onChange,
}: {
  onChange?: (
    text: string,
    mentions: Array<{ id: string; type: MentionType; prefix?: string }>,
  ) => void;
}) {
  const extractMentions = (
    node: LexicalNode,
  ): Array<{ id: string; type: MentionType; prefix?: string }> => {
    const mentions: Array<{ id: string; type: MentionType; prefix?: string }> = [];

    if ($isMentionNode(node)) {
      const mentionData = node.getMentionData();
      const mention: { id: string; type: MentionType; prefix?: string } = {
        id: mentionData.id,
        type: mentionData.type,
      };
      if (mentionData.prefix) {
        mention.prefix = mentionData.prefix;
      }
      mentions.push(mention);
    }

    if ($isElementNode(node)) {
      const children = node.getChildren();
      for (const child of children) {
        mentions.push(...extractMentions(child));
      }
    }

    return mentions;
  };

  const extractTextWithoutMentions = (node: LexicalNode): string => {
    if ($isMentionNode(node)) {
      return ''; // Exclude mention text from search
    }

    if ($isElementNode(node)) {
      const children = node.getChildren();
      return children.map(child => extractTextWithoutMentions(child)).join('');
    }

    // Text node
    return node.getTextContent();
  };

  const handleChange = (editorState: EditorState) => {
    editorState.read(() => {
      const root = $getRoot();

      // Extract text without mentions for search
      const text = extractTextWithoutMentions(root);

      // Extract mentions recursively
      const mentions = extractMentions(root);

      if (onChange) {
        onChange(text, mentions);
      }
    });
  };

  return <OnChangePlugin onChange={handleChange} />;
}

export function LexicalSearchInput({
  placeholder,
  value,
  onChange,
  onUserSearch,
  onChannelSearch,
  availableUsers = [],
  availableChannels = [],
  className,
  open,
  mentionSearchType,
  selectedMentionIndex,
  setSelectedMentionIndex,
  onInsertMentionReady,
  onMentionInserted,
  onPasteDetected,
  onManualKeystroke,
  autocompleteSuffix,
  onInsertTextReady,
  initialMention,
}: LexicalSearchInputProps) {
  const { isMobile } = usePlatform();
  const [suffixLeft, setSuffixLeft] = useState(0);
  const handlePositionChange = useCallback((left: number) => {
    setSuffixLeft(left);
  }, []);

  const initialConfig = {
    namespace: 'SearchInput',
    theme: {
      paragraph: 'm-0 leading-7',
      text: {
        base: 'text-sm',
      },
    },
    onError: (_error: Error) => {
      // Silently handle Lexical errors
    },
    nodes: [MentionNode],
    ...(value ? { editorState: value } : {}),
  };

  return (
    <div className={cn('relative flex-1', className)} data-lexical-search-input='true'>
      <LexicalComposer initialConfig={initialConfig}>
        <div className='relative'>
          <RichTextPlugin
            contentEditable={
              <span className='flex items-center gap-2'>
                {!isMobile && <Search size={16} className='ml-3 text-[#788187]' />}
                <ContentEditable
                  className='min-h-5 py-1 text-sm focus:outline-none flex-1'
                  spellCheck={true}
                  autoCorrect='on'
                  autoCapitalize='none'
                />
                {autocompleteSuffix && (
                  <span
                    className='text-[#C9CCCF] pointer-events-none text-sm absolute top-1/2 -translate-y-1/2 whitespace-nowrap'
                    style={{ left: `${suffixLeft}px` }}
                  >
                    {autocompleteSuffix}
                  </span>
                )}
              </span>
            }
            {...(placeholder
              ? { placeholder: <PlaceholderPlugin placeholder={placeholder} /> }
              : {})}
            ErrorBoundary={({ children }) => <>{children}</>}
          />
          <HistoryPlugin />
          {onChange && <OnChangePluginWrapper onChange={onChange} />}
          {open !== undefined && <AutoFocusPlugin open={open} />}
          {(onPasteDetected || onManualKeystroke) && (
            <PastePlugin
              {...(onPasteDetected && { onPasteDetected })}
              {...(onManualKeystroke && { onManualKeystroke })}
            />
          )}
          <ClearEditorPlugin value={value} />
          {initialMention && <InitialMentionPlugin initialMention={initialMention} />}
          {onInsertTextReady && <InsertTextPlugin onInsertTextReady={onInsertTextReady} />}
          <CursorPositionPlugin onPositionChange={handlePositionChange} />
          <MentionPlugin
            {...(onUserSearch ? { onUserSearch } : {})}
            {...(onChannelSearch ? { onChannelSearch } : {})}
            availableUsers={availableUsers}
            availableChannels={availableChannels}
            {...(mentionSearchType !== undefined ? { mentionSearchType } : {})}
            {...(selectedMentionIndex !== undefined ? { selectedMentionIndex } : {})}
            {...(setSelectedMentionIndex ? { setSelectedMentionIndex } : {})}
            {...(onInsertMentionReady ? { onInsertMentionReady } : {})}
            {...(onMentionInserted ? { onMentionInserted } : {})}
          />
        </div>
      </LexicalComposer>
    </div>
  );
}
