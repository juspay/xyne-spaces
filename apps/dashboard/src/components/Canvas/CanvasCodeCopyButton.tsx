import { ReactElement, useCallback, useEffect, useRef, useState } from 'react';
import { Check, Copy } from 'lucide-react';
import { toast } from 'sonner';
import { useClipboard } from '../../hooks/useClipboard';

interface CanvasCodeCopyButtonProps {
  containerRef: React.RefObject<HTMLDivElement | null>;
}

interface CopyButtonPosition {
  top: number;
  left: number;
  show: boolean;
}

const BUTTON_SIZE = 26;

export const CanvasCodeCopyButton = ({
  containerRef,
}: CanvasCodeCopyButtonProps): ReactElement | null => {
  const { copy } = useClipboard();
  const [position, setPosition] = useState<CopyButtonPosition>({ top: 0, left: 0, show: false });
  const [copied, setCopied] = useState(false);
  const hoveredBlockRef = useRef<HTMLElement | null>(null);
  const hideTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const copiedTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const buttonRef = useRef<HTMLButtonElement | null>(null);

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
        left: blockRect.right - BUTTON_SIZE - 6,
        show: true,
      });
    },
    [containerRef],
  );

  const handleMouseOver = useCallback(
    (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (buttonRef.current?.contains(target)) {
        clearHide();
        return;
      }
      const container = containerRef.current;
      const block = target.closest<HTMLElement>('[data-content-type="codeBlock"]');
      if (block && container?.contains(block)) {
        clearHide();
        hoveredBlockRef.current = block;
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
    <div className='fixed z-50' style={{ top: position.top, left: position.left }}>
      <button
        ref={buttonRef}
        type='button'
        onMouseDown={event => event.preventDefault()}
        onClick={handleCopy}
        title={copied ? 'Copied' : 'Copy'}
        aria-label={copied ? 'Copied' : 'Copy'}
        className='flex h-[26px] w-[26px] items-center justify-center rounded-md border border-border bg-card text-muted-foreground shadow-sm transition-colors hover:bg-accent hover:text-foreground'
        data-track-category='CANVAS'
        data-track-name='Copy_Code_Block'
      >
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
    </div>
  );
};
