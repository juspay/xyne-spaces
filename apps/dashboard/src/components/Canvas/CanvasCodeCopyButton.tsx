import type {
  BlockNoteEditor,
  BlockSchema,
  InlineContentSchema,
  StyleSchema,
} from '@blocknote/core';
import { ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useClipboard } from '../../hooks/useClipboard';
import { CANVAS_CODE_LANGUAGES } from './CanvasCodeBlockSpec';

interface CanvasCodeCopyButtonProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
  editor: BlockNoteEditor<BlockSchema, InlineContentSchema, StyleSchema>;
}

interface CopyButtonPosition {
  top: number;
  left: number;
  show: boolean;
}

export const CanvasCodeCopyButton = ({
  containerRef,
  editor,
}: CanvasCodeCopyButtonProps): ReactElement | null => {
  const { copy } = useClipboard();
  const [position, setPosition] = useState<CopyButtonPosition>({ top: 0, left: 0, show: false });
  const [copied, setCopied] = useState(false);
  const [language, setLanguage] = useState('');
  const hoveredBlockRef = useRef<HTMLElement | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const toolbarRef = useRef<HTMLDivElement | null>(null);

  const clearHide = useCallback(() => {
    if (hideTimeoutRef.current) {
      clearTimeout(hideTimeoutRef.current);
      hideTimeoutRef.current = null;
    }
  }, []);

  const scheduleHide = useCallback(() => {
    clearHide();
    hideTimeoutRef.current = setTimeout(() => {
      hoveredBlockRef.current = null;
      setPosition(prev => ({ ...prev, show: false }));
    }, 200);
  }, [clearHide]);

  const positionForBlock = useCallback(
    (block: HTMLElement) => {
      const container = containerRef.current;
      if (!container) return;
      const containerRect = container.getBoundingClientRect();
      const blockRect = block.getBoundingClientRect();
      if (blockRect.bottom < containerRect.top || blockRect.top > containerRect.bottom) {
        setPosition(prev => ({ ...prev, show: false }));
        return;
      }
      setPosition({
        top: Math.max(blockRect.top + 6, containerRect.top + 6),
        left: blockRect.right - 6,
        show: true,
      });
    },
    [containerRef],
  );

  const handleMouseOver = useCallback(
    (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (toolbarRef.current?.contains(target)) {
        clearHide();
        return;
      }
      const container = containerRef.current;
      const block = target.closest<HTMLElement>('[data-content-type="codeBlock"]');
      if (block && container?.contains(block)) {
        // Mermaid owns its Diagram/Code toolbar, including its copy action.
        // Do not place the generic Canvas copy button over that toolbar.
        if (block.querySelector('[data-wiki-mermaid="true"]')) {
          scheduleHide();
          return;
        }
        clearHide();
        hoveredBlockRef.current = block;
        setLanguage(
          block.querySelector<HTMLElement>('.canvas-highlighted-code')?.dataset['language'] ?? '',
        );
        positionForBlock(block);
      } else {
        scheduleHide();
      }
    },
    [clearHide, containerRef, positionForBlock, scheduleHide],
  );

  const handleCopy = useCallback(() => {
    const block = hoveredBlockRef.current;
    if (!block) return;
    const code = block.querySelector('pre')?.textContent ?? block.textContent ?? '';
    void copy(code).then(success => {
      if (success) {
        setCopied(true);
        if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
        copiedTimeoutRef.current = setTimeout(() => setCopied(false), 1500);
        return;
      }

      toast.error('Failed to copy code', {
        description: 'Clipboard access is unavailable. Please copy the code manually.',
      });
    });
  }, [copy]);

  const handleLanguageChange = useCallback(
    (nextLanguage: string) => {
      const blockElement = hoveredBlockRef.current?.closest<HTMLElement>('[data-id]');
      const blockId = blockElement?.dataset['id'];
      if (!blockId) return;
      setLanguage(nextLanguage);
      const codeEditor = editor as unknown as {
        updateBlock: (id: string, update: { props: { language: string } }) => unknown;
      };
      codeEditor.updateBlock(blockId, { props: { language: nextLanguage } });
    },
    [editor],
  );

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const onScroll = (): void => {
      if (hoveredBlockRef.current) positionForBlock(hoveredBlockRef.current);
    };

    container.addEventListener('mouseover', handleMouseOver);
    window.addEventListener('scroll', onScroll, true);

    return () => {
      container.removeEventListener('mouseover', handleMouseOver);
      window.removeEventListener('scroll', onScroll, true);
      clearHide();
      if (copiedTimeoutRef.current) clearTimeout(copiedTimeoutRef.current);
    };
  }, [clearHide, containerRef, handleMouseOver, positionForBlock]);

  if (!position.show) return null;

  return (
    <div
      ref={toolbarRef}
      className='fixed z-50 flex -translate-x-full items-center gap-1 rounded-md border border-border bg-card p-1 shadow-sm'
      style={{ top: position.top, left: position.left }}
    >
      <select
        value={language}
        onChange={event => handleLanguageChange(event.target.value)}
        onMouseDown={event => event.stopPropagation()}
        aria-label='Code language'
        title='Code language'
        data-track-category='CANVAS'
        data-track-name='Change_Code_Block_Language'
        className='h-[26px] max-w-32 rounded px-2 text-xs text-muted-foreground outline-none transition-colors hover:bg-accent hover:text-foreground focus:bg-accent focus:text-foreground'
      >
        {CANVAS_CODE_LANGUAGES.map(option => (
          <option key={option.value || 'auto'} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <button
        type='button'
        onMouseDown={event => event.preventDefault()}
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy'}
        aria-label={copied ? 'Copied' : 'Copy'}
        className='flex h-[26px] w-[26px] items-center justify-center rounded text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        data-track-category='CANVAS'
        data-track-name='Copy_Code_Block'
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
};
