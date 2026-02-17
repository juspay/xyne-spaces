import { useEffect, useState } from 'react';
import { LexicalComposer } from '@lexical/react/LexicalComposer';
import { RichTextPlugin } from '@lexical/react/LexicalRichTextPlugin';
import { ContentEditable } from '@lexical/react/LexicalContentEditable';
import { HistoryPlugin } from '@lexical/react/LexicalHistoryPlugin';
import { OnChangePlugin } from '@lexical/react/LexicalOnChangePlugin';
import { useLexicalComposerContext } from '@lexical/react/LexicalComposerContext';
import { $getRoot, EditorState, $isElementNode, LexicalNode } from 'lexical';
import { MentionNode, $isMentionNode } from './MentionNode';
import { MentionPlugin } from './MentionPlugin';
import { PastePlugin } from './PastePlugin';
import { cn } from '../../../utils/classNames';
import { MentionType } from './ChannelCommandMenu.types';
import { Search } from 'lucide-react';

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
}

function PlaceholderPlugin({ placeholder }: { placeholder?: string }) {
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
    <div className='absolute left-9 top-1/2 -translate-y-1/2 text-sm text-[#C9CCCF] pointer-events-none'>
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
}: LexicalSearchInputProps) {
  const initialConfig = {
    namespace: 'SearchInput',
    theme: {
      paragraph: 'm-0 leading-7',
      text: {
        base: 'text-sm',
      },
    },
    onError: (error: Error) => {
      console.error('Lexical error:', error);
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
                <Search size={16} className='ml-3 text-[#788187]' />
                <ContentEditable className='min-h-5 py-1 text-sm focus:outline-none flex-1' />
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
