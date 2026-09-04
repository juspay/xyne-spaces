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
  $isRangeSelection,
  EditorState,
  $isElementNode,
  LexicalNode,
  $createTextNode,
  $createParagraphNode,
  PASTE_COMMAND,
  COMMAND_PRIORITY_LOW,
} from 'lexical';
import {
  FilterChipNode,
  FilterChipContainerNode,
  FilterChipIconNode,
  FilterChipPrefixNode,
  $isFilterChipNode,
  $isFilterChipContainerNode,
  $createFilterChip,
} from './FilterChipNode';
import { FilterChipPlugin } from './FilterChipPlugin';
import {
  MentionPlugin,
  UserTriggerType,
  ChannelTriggerType,
  PriorityTriggerType,
  DateTriggerType,
  BoardTriggerType,
  MentionsTriggerType,
} from './MentionPlugin';
import { PastePlugin } from './PastePlugin';
import { cn } from '../../../utils/classNames';
import { ChipType, type ChipData } from './ChannelCommandMenu.types';
import { Search } from 'lucide-react';
import { usePlatform } from '../../../hooks/usePlatform';

interface LexicalSearchInputProps {
  placeholder?: string;
  value?: string;
  onChange?: (
    text: string,
    mentions: Array<{ id: string; type: ChipType; prefix?: string }>,
  ) => void;
  onUserSearch?: (query: string | null, trigger?: UserTriggerType) => void;
  onChannelSearch?: (query: string | null, trigger?: ChannelTriggerType) => void;
  onPrioritySearch?: (query: string | null, trigger?: PriorityTriggerType) => void;
  onDateSearch?: (query: string | null, trigger?: DateTriggerType) => void;
  onBoardSearch?: (query: string | null, trigger?: BoardTriggerType) => void;
  onMentionsSearch?: (query: string | null, trigger?: MentionsTriggerType) => void;
  availableUsers?: Array<{ id: string; name: string; email?: string }>;
  availableChannels?: Array<{ id: string; name: string }>;
  availablePriorities?: Array<{ id: string; name: string }>;
  availableDates?: Array<{ id: string; name: string }>;
  availableBoards?: Array<{ id: string; name: string }>;
  availableMentionTargets?: Array<{ id: string; name: string; type: ChipType }>;
  className?: string;
  open?: boolean;
  mentionSearchType?: ChipType | null;
  selectedMentionIndex?: number;
  setSelectedMentionIndex?: (index: number | ((prev: number) => number)) => void;
  onNavigate?: () => void;
  hasNavigated?: boolean;
  onReplaceTriggerChipsReady?: (replaceChips: (chips: ChipData[]) => void) => void;
  onInsertMentionReady?: (
    insertMention: (item: { id: string; name: string; email?: string }) => void,
  ) => void;
  onMentionInserted?: () => void;
  enableToTrigger?: boolean;
  onPasteDetected?: () => void;
  onManualKeystroke?: () => void;
  autocompleteSuffix?: string;
  onInsertTextReady?: (insertText: (text: string) => void) => void;
  onSetTextReady?: (setText: (text: string) => void) => void;
  initialMention?: ChipData | null | undefined;
  initialQuery?: InitialQueryData | null | undefined;
  disableAutoFocus?: boolean;
  // Current user's id — threaded to chip creation so a current-user chip gets Slack's color.
  currentUserID?: string;
  // Hide the leading search magnifier. The command menu passes this; other consumers
  // (e.g. call-history search) keep the icon by default.
  hideSearchIcon?: boolean;
}

export interface InitialQueryData {
  mentions: ChipData[];
  text: string;
}

// Reuse the recursive chip-detection pattern from ClearEditorPlugin: a paste can
// nest a chip, so walk the whole tree rather than only the top-level children.
function $rootHasFilterChip(node: LexicalNode): boolean {
  return (
    $isFilterChipNode(node) || ($isElementNode(node) && node.getChildren().some($rootHasFilterChip))
  );
}

// Seeding must be non-destructive: only seed when the editor is genuinely empty
// (no user text, no existing chip). Otherwise typing would wipe the chip/text.
function $isEditorSeedable(): boolean {
  const root = $getRoot();
  if ($rootHasFilterChip(root)) return false;
  return root.getTextContent().trim().length === 0;
}

function InitialMentionPlugin({
  initialMention,
  currentUserID,
}: {
  initialMention?: ChipData | null;
  currentUserID?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialMention) {
      appliedRef.current = null;
      return;
    }

    const mentionKey = `${initialMention.id}-${initialMention.prefix}`;
    if (appliedRef.current === mentionKey) return;

    const timeoutId = setTimeout(() => {
      editor.update(() => {
        // Bail out before clearing if the user already has content/a chip; set
        // the guard so this mention is treated as handled and never retried.
        if (!$isEditorSeedable()) {
          appliedRef.current = mentionKey;
          return;
        }
        appliedRef.current = mentionKey;

        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        root.append(paragraph);

        const spaceNode = $createTextNode(' ');
        paragraph.append($createFilterChip(initialMention, currentUserID), spaceNode);
        spaceNode.selectEnd();
      });
    }, 50);

    return () => clearTimeout(timeoutId);
  }, [initialMention, editor]);

  return null;
}

function InitialQueryPlugin({
  initialQuery,
  currentUserID,
}: {
  initialQuery?: InitialQueryData | null;
  currentUserID?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const appliedRef = useRef<string | null>(null);

  useEffect(() => {
    if (!initialQuery || (initialQuery.mentions.length === 0 && !initialQuery.text)) {
      appliedRef.current = null;
      return;
    }

    const queryKey = `${initialQuery.mentions.map(m => `${m.id}-${m.prefix}`).join('|')}::${initialQuery.text}`;
    if (appliedRef.current === queryKey) return;

    const timeoutId = setTimeout(() => {
      editor.update(() => {
        // Non-destructive: never wipe user input on re-run (e.g. a parent
        // re-render that re-triggers this effect after the user has typed).
        if (!$isEditorSeedable()) {
          appliedRef.current = queryKey;
          return;
        }
        appliedRef.current = queryKey;

        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        root.append(paragraph);

        initialQuery.mentions.forEach(mention => {
          paragraph.append($createFilterChip(mention, currentUserID));
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

function PlaceholderPlugin({
  placeholder,
  offsetClass = 'left-0',
}: {
  placeholder?: string;
  offsetClass?: string;
}) {
  const [editor] = useLexicalComposerContext();
  const [showPlaceholder, setShowPlaceholder] = useState(true);

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
      className={`absolute ${offsetClass} top-1/2 -translate-y-1/2 text-sm text-muted-foreground pointer-events-none`}
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
      // Slash-command text ('/chat ', '/call ') lives in this same editor but reports value=''
      // (the search hook consumes it in command mode). The ⌥↵ Actions → Message path seeds the
      // editor with '/chat ' AND drives searchText to '' in one go; without this bail we'd clear
      // that seed, fire onChange(''), drop out of command mode and reset the palette. Keep it.
      if (root.getTextContent().startsWith('/')) return;
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
          if (selection === null) return;
          // A filter keyword only parses on a word boundary — inserting `with: ` with the
          // caret right after "issue" would produce "issuewith:", which reads as plain
          // text and silently filters nothing. Add the separating space when the character
          // to the left isn't already whitespace (and isn't the start of the input).
          let prefix = '';
          if ($isRangeSelection(selection) && selection.isCollapsed()) {
            const anchor = selection.anchor;
            const node = anchor.getNode();
            const before =
              anchor.type === 'text' ? node.getTextContent().slice(0, anchor.offset) : '';
            // An empty `before` at a text node's start still needs the check: the previous
            // sibling may be a chip, after which a space is wanted too.
            const prevSibling = node.getPreviousSibling();
            const hasContentBefore = before.length > 0 || prevSibling !== null;
            if (hasContentBefore && !/\s$/.test(before)) prefix = ' ';
          }
          selection.insertText(`${prefix}${text}`);
        });
      };
      onInsertTextReady(insertText);
    }
  }, [editor, onInsertTextReady]);

  return null;
}

// Imperative "replace the whole editor with plain text" (caret at end). Used by
// the slash-command mode to seed `/call `/`/chat ` or clear a typed name fragment.
function SetTextPlugin({
  onSetTextReady,
}: {
  onSetTextReady: (setText: (text: string) => void) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    const setText = (text: string) => {
      editor.update(() => {
        const root = $getRoot();
        root.clear();
        const paragraph = $createParagraphNode();
        if (text) paragraph.append($createTextNode(text));
        root.append(paragraph);
        paragraph.selectEnd();
      });
    };
    onSetTextReady(setText);
  }, [editor, onSetTextReady]);

  return null;
}

function CursorPositionPlugin({
  onPositionChange,
}: {
  onPositionChange: (pos: { left: number; top: number }) => void;
}) {
  const [editor] = useLexicalComposerContext();

  useEffect(() => {
    return editor.registerUpdateListener(() => {
      const editorEl = editor.getRootElement();
      if (!editorEl) return;

      // Use requestAnimationFrame to ensure DOM has been updated after Lexical's render
      requestAnimationFrame(() => {
        // Must be the suffix's own containing block, or call-site padding offsets the suffix.
        const containerRect = editorEl.closest('[data-suffix-anchor]')?.getBoundingClientRect();
        if (!containerRect) return;

        // Anchor the suffix to the RIGHT EDGE of the typed text, not the caret \u2014 keying off
        // the caret made the suffix collapse onto the text when the caret moved off the end.
        // Measure the last rendered text node (collapsing a range over the block element
        // lands on a line boundary, not the inline text end).
        const walker = document.createTreeWalker(editorEl, NodeFilter.SHOW_TEXT);
        let lastTextNode: Node | null = null;
        while (walker.nextNode()) lastTextNode = walker.currentNode;

        if (lastTextNode && (lastTextNode.textContent ?? '').length > 0) {
          const range = document.createRange();
          range.selectNodeContents(lastTextNode);
          // getClientRects() yields one rect per visual line; the LAST is the end of the last
          // wrapped line. The node's bounding box would span every line and drop the suffix in
          // the middle of a multi-line (wrapped) query. Center on that line's own vertical mid.
          const rects = range.getClientRects();
          const lastRect = rects.length > 0 ? rects[rects.length - 1] : undefined;
          const rect = lastRect ?? range.getBoundingClientRect();
          onPositionChange({
            left: rect.right - containerRect.left,
            top: rect.top + rect.height / 2 - containerRect.top,
          });
          return;
        }

        // No text yet (e.g. only mention chips) \u2014 fall back to the caret position.
        const selection = window.getSelection();
        if (!selection || selection.rangeCount === 0) return;
        const caret = selection.getRangeAt(0).cloneRange();
        caret.collapse(false);
        const caretRect = caret.getBoundingClientRect();
        onPositionChange({
          left: caretRect.left - containerRect.left,
          top: caretRect.top + caretRect.height / 2 - containerRect.top,
        });
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
    mentions: Array<{ id: string; type: ChipType; prefix?: string }>,
  ) => void;
}) {
  const extractMentions = (
    node: LexicalNode,
  ): Array<{ id: string; type: ChipType; prefix?: string; name: string }> => {
    const mentions: Array<{ id: string; type: ChipType; prefix?: string; name: string }> = [];

    if ($isFilterChipNode(node)) {
      const mentionData = node.getMentionData();
      const mention: { id: string; type: ChipType; prefix?: string; name: string } = {
        id: mentionData.id,
        type: mentionData.type,
        name: mentionData.name,
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
    // Exclude the whole pill from the search text; it's carried as a mention. Skipping at
    // the container covers every part of it — the label AND the `from:`/`in:` prefix node,
    // which reports text of its own and would otherwise leak into the query.
    if ($isFilterChipContainerNode(node)) {
      return '';
    }

    if ($isFilterChipNode(node)) {
      return ''; // Chip label outside a container (shouldn't happen, but stays excluded)
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

// Search is single-line. Lexical's default paste keeps the copied HTML's block structure
// (and any trailing newline in text/plain), so pasting a name copied from a rendered element
// injects a line break. Force plain text with newlines collapsed to spaces instead.
function SingleLinePastePlugin() {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const text = event.clipboardData?.getData('text/plain');
        if (!text) return false;
        event.preventDefault();
        const singleLine = text.replace(/[\r\n]+/g, ' ');
        editor.update(() => {
          const selection = $getSelection();
          if ($isRangeSelection(selection)) {
            selection.insertText(singleLine);
          }
        });
        return true;
      },
      COMMAND_PRIORITY_LOW,
    );
  }, [editor]);
  return null;
}

export function LexicalSearchInput({
  placeholder,
  value,
  onChange,
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
  enableToTrigger = false,
  className,
  open,
  mentionSearchType,
  selectedMentionIndex,
  setSelectedMentionIndex,
  onNavigate,
  hasNavigated,
  onInsertMentionReady,
  onReplaceTriggerChipsReady,
  onMentionInserted,
  onPasteDetected,
  onManualKeystroke,
  autocompleteSuffix,
  onInsertTextReady,
  onSetTextReady,
  initialMention,
  initialQuery,
  disableAutoFocus = false,
  currentUserID,
  hideSearchIcon = false,
}: LexicalSearchInputProps) {
  const { isMobile } = usePlatform();
  const showLeadingIcon = !hideSearchIcon && !isMobile;
  const [suffixPos, setSuffixPos] = useState({ left: 0, top: 0 });
  const handlePositionChange = useCallback((pos: { left: number; top: number }) => {
    setSuffixPos(pos);
  }, []);

  const initialConfig = {
    namespace: 'SearchInput',
    theme: {
      paragraph: 'm-0',
      text: {
        base: 'text-sm',
      },
    },
    onError: (_error: Error) => {
      // Silently handle Lexical errors
    },
    // The four filter-chip nodes (pill + prefix + icon + label); see FilterChipNode.tsx.
    nodes: [FilterChipContainerNode, FilterChipPrefixNode, FilterChipIconNode, FilterChipNode],
    ...(value ? { editorState: value } : {}),
  };

  return (
    <div className={cn('relative flex-1', className)} data-lexical-search-input='true'>
      <LexicalComposer initialConfig={initialConfig}>
        <div className='relative' data-suffix-anchor='true'>
          <RichTextPlugin
            contentEditable={
              <span className='flex items-center gap-2'>
                {showLeadingIcon && <Search size={16} className='ml-3 text-muted-foreground' />}
                <ContentEditable
                  className='min-h-5 py-1 text-sm text-foreground focus:outline-none flex-1'
                  spellCheck={true}
                  autoCorrect='on'
                  autoCapitalize='none'
                />
                {autocompleteSuffix && (
                  <span
                    className='text-muted-foreground pointer-events-none text-sm absolute -translate-y-1/2 whitespace-nowrap'
                    style={{ left: `${suffixPos.left}px`, top: `${suffixPos.top}px` }}
                  >
                    {autocompleteSuffix}
                  </span>
                )}
              </span>
            }
            {...(placeholder
              ? {
                  placeholder: (
                    <PlaceholderPlugin
                      placeholder={placeholder}
                      offsetClass={showLeadingIcon ? 'left-9' : 'left-0'}
                    />
                  ),
                }
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
          {initialMention && (
            <InitialMentionPlugin
              initialMention={initialMention}
              {...(currentUserID ? { currentUserID } : {})}
            />
          )}
          {initialQuery && (
            <InitialQueryPlugin
              initialQuery={initialQuery}
              {...(currentUserID ? { currentUserID } : {})}
            />
          )}
          {onInsertTextReady && <InsertTextPlugin onInsertTextReady={onInsertTextReady} />}
          {onSetTextReady && <SetTextPlugin onSetTextReady={onSetTextReady} />}
          <CursorPositionPlugin onPositionChange={handlePositionChange} />
          <SingleLinePastePlugin />
          <FilterChipPlugin />
          <MentionPlugin
            {...(onUserSearch ? { onUserSearch } : {})}
            {...(onChannelSearch ? { onChannelSearch } : {})}
            {...(onPrioritySearch ? { onPrioritySearch } : {})}
            {...(onDateSearch ? { onDateSearch } : {})}
            {...(onBoardSearch ? { onBoardSearch } : {})}
            {...(onMentionsSearch ? { onMentionsSearch } : {})}
            availableUsers={availableUsers}
            availableChannels={availableChannels}
            availablePriorities={availablePriorities}
            availableDates={availableDates}
            availableBoards={availableBoards}
            availableMentionTargets={availableMentionTargets}
            {...(mentionSearchType !== undefined ? { mentionSearchType } : {})}
            {...(selectedMentionIndex !== undefined ? { selectedMentionIndex } : {})}
            {...(setSelectedMentionIndex ? { setSelectedMentionIndex } : {})}
            {...(onNavigate ? { onNavigate } : {})}
            {...(hasNavigated !== undefined ? { hasNavigated } : {})}
            {...(onInsertMentionReady ? { onInsertMentionReady } : {})}
            {...(onReplaceTriggerChipsReady ? { onReplaceTriggerChipsReady } : {})}
            {...(onMentionInserted ? { onMentionInserted } : {})}
            enableToTrigger={enableToTrigger}
            {...(currentUserID ? { currentUserID } : {})}
          />
        </div>
      </LexicalComposer>
    </div>
  );
}
