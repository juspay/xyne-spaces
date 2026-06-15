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
import {
  FilterChipNode,
  FilterChipContainerNode,
  FilterChipIconNode,
  $isFilterChipNode,
  $createFilterChip,
} from './FilterChipNode';
import { FilterChipPlugin } from './FilterChipPlugin';
import {
  MentionPlugin,
  UserTriggerType,
  ChannelTriggerType,
  PriorityTriggerType,
} from './MentionPlugin';
import { PastePlugin } from './PastePlugin';
import { cn } from '../../../utils/classNames';
import { MentionType, type MentionData } from './ChannelCommandMenu.types';
import { Search } from 'lucide-react';
import { usePlatform } from '../../../hooks/usePlatform';

interface LexicalSearchInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (
    text: string,
    mentions: Array<{ id: string; type: MentionType; prefix?: string }>,
  ) => void;
  onUserSearch?: (query: string | null, trigger?: UserTriggerType) => void;
  onChannelSearch?: (query: string | null, trigger?: ChannelTriggerType) => void;
  onPrioritySearch?: (query: string | null, trigger?: PriorityTriggerType) => void;
  availableUsers?: Array<{ id: string; name: string; email?: string }>;
  availableChannels?: Array<{ id: string; name: string }>;
  availablePriorities?: Array<{ id: string; name: string }>;
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
  initialQuery?: InitialQueryData | null | undefined;
  disableAutoFocus?: boolean;
}

export interface InitialQueryData {
  mentions: MentionData[];
  text: string;
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

        const spaceNode = $createTextNode(' ');
        paragraph.append($createFilterChip(initialMention), spaceNode);
        spaceNode.selectEnd();
      });
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [initialMention, editor]);

  return null;
}

function InitialQueryPlugin({ initialQuery }: { initialQuery?: InitialQueryData | null }) {
  const [editor] = useLexicalComposerContext();
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialQuery || (initialQuery.mentions.length === 0 && !initialQuery.text)) {
      appliedRef.current = null;
      return;
    }

    const queryKey = `${initialQuery.mentions.map(m => `${m.id}-${m.prefix}`).join('|')}::${initialQuery.text}`;
    if (appliedRef.current === queryKey) return;
    appliedRef.current = queryKey;

    const timeoutId = setTimeout(() => {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        root.append(paragraph);

        initialQuery.mentions.forEach(mention => {
          paragraph.append($createFilterChip(mention));
          paragraph.append($createTextNode(' '));
        });

        const trailingText = initialQuery.text ? $createTextNode(initialQuery.text) : null;
        if (trailingText) paragraph.append(trailingText);

        const lastChild = paragraph.getLastChild();
        lastChild?.selectEnd();
      });
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [initialQuery, editor]);

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
      className={`absolute ${isMobile ? 'left-0' : 'left-9'} top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none`}
    >
      {placeholder}
    </div>
  );
}

function AutoFocusPlugin({
  open,
  disableAutoFocus,
}: {
  open?: boolean;
  disableAutoFocus?: boolean;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (open && !disableAutoFocus) {
      editor.focus();
    }
  }, [open, disableAutoFocus, editor]);

  return null;
}

function ClearEditorPlugin({ value }: { value: string | undefined }) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    if (value !== '') return;
    editor.update(() => {
      const root = $getRoot();
      // value='' excludes chip text (see `extractTextWithoutMentions`), so a
      // lone chip reports empty — clearing would wipe it. Recurse the full tree
      // (a paste can nest a chip) and bail if any chip remains.
      const hasChip = (node: LexicalNode): boolean =>
        $isFilterChipNode(node) || ($isElementNode(node) && node.getChildren().some(hasChip));
      if (hasChip(root)) return;
      root.clear();
    });
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

    if ($isFilterChipNode(node)) {
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
    if ($isFilterChipNode(node)) {
      return ''; // Exclude chip text from search; it's carried as a mention
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
  onPrioritySearch,
  availableUsers = [],
  availableChannels = [],
  availablePriorities = [],
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
  initialQuery,
  disableAutoFocus = false,
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
    // The three filter-chip nodes (pill + icon + label); see FilterChipNode.tsx.
    nodes: [FilterChipContainerNode, FilterChipIconNode, FilterChipNode],
    ...(value ? { editorState: value } : {}),
  };

  return (
    <div className={cn('relative flex-1', className)} data-lexical-search-input='true'>
      <LexicalComposer initialConfig={initialConfig}>
        <div className='relative'>
          <RichTextPlugin
            contentEditable={
              <span className='flex items-center gap-2'>
                {!isMobile && <Search size={16} className='ml-3 text-muted-foreground' />}
                <ContentEditable
                  className='min-h-5 py-1 text-sm text-foreground focus:outline-none flex-1'
                  spellCheck={true}
                  autoCorrect='on'
                  autoCapitalize='none'
                />
                {autocompleteSuffix && (
                  <span
                    className='text-muted-foreground pointer-events-none text-sm absolute top-1/2 -translate-y-1/2 whitespace-nowrap'
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
          {open !== undefined && (
            <AutoFocusPlugin open={open} disableAutoFocus={disableAutoFocus} />
          )}
          {(onPasteDetected || onManualKeystroke) && (
            <PastePlugin
              {...(onPasteDetected && { onPasteDetected })}
              {...(onManualKeystroke && { onManualKeystroke })}
            />
          )}
          <ClearEditorPlugin value={value} />
          {initialMention && <InitialMentionPlugin initialMention={initialMention} />}
          {initialQuery && <InitialQueryPlugin initialQuery={initialQuery} />}
          {onInsertTextReady && <InsertTextPlugin onInsertTextReady={onInsertTextReady} />}
          <CursorPositionPlugin onPositionChange={handlePositionChange} />
          <FilterChipPlugin />
          <MentionPlugin
            {...(onUserSearch ? { onUserSearch } : {})}
            {...(onChannelSearch ? { onChannelSearch } : {})}
            {...(onPrioritySearch ? { onPrioritySearch } : {})}
            availableUsers={availableUsers}
            availableChannels={availableChannels}
            availablePriorities={availablePriorities}
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
