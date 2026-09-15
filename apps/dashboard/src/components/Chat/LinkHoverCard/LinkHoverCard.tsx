import React, { useEffect, useState } from 'react';
import { toast } from 'sonner';
import { CopyCopied, CopyDefault, ExternalLink, LinkSlant } from '@xyne/icons';
import { HoverCard } from '../../ui/HoverCard/HoverCard';
import { Tooltip } from '../../ui/Tooltip';
import { Button } from '../../ui/Button';
import { usePlatform } from '../../../hooks/usePlatform';
import { useTypingState } from '../../../contexts/TypingStateContext';
import { copyTextToClipboard } from '../../../utils/clipboardUtils';
import { openLink } from '../../../utils/openLink';
import type { LinkHoverCardProps } from './LinkHoverCard.types';

export const LinkHoverCard: React.FC<LinkHoverCardProps> = ({ href, children }) => {
  const { isMobile } = usePlatform();
  const { hasTyped } = useTypingState();
  const [isOpen, setIsOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!isOpen) return;
    const handleScroll = (): void => setIsOpen(false);
    window.addEventListener('scroll', handleScroll, true);
    return (): void => window.removeEventListener('scroll', handleScroll, true);
  }, [isOpen]);

  if (isMobile) return children;

  const handleOpen = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    openLink(href, event, { force: 'external' });
  };

  const handleCopy = (event: React.MouseEvent): void => {
    event.preventDefault();
    event.stopPropagation();
    copyTextToClipboard(href)
      .then(() => {
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1200);
        toast.success('Link copied to clipboard');
      })
      .catch(() => toast.error('Failed to copy link'));
  };

  return (
    <HoverCard
      trigger={children}
      side='top'
      align='start'
      avoidCollisions
      collisionPadding={12}
      openDelay={400}
      closeDelay={200}
      open={hasTyped ? false : isOpen}
      onOpenChange={open => setIsOpen(hasTyped ? false : open)}
      className='w-[min(400px,calc(100vw-24px))] bg-transparent p-0 border-0 shadow-none'
    >
      <div className='w-full rounded-lg border border-border bg-popover p-3 shadow-lg'>
        <div className='flex items-center justify-between gap-3'>
          <div className='flex items-center gap-2 text-sm font-semibold text-foreground'>
            <LinkSlant className='h-4 w-4 text-muted-foreground' />
            Link
          </div>
          <div className='flex items-center gap-1'>
            <Tooltip content='Open link' side='top'>
              <Button
                variant='ghost'
                size='iconSm'
                className='size-7 text-muted-foreground'
                aria-label='Open link'
                onClick={handleOpen}
                data-track-category='MESSAGE'
                data-track-name='OPEN_LINK_HOVER_CARD'
                data-track-metadata={JSON.stringify({ url: href })}
              >
                <ExternalLink className='h-4 w-4' />
              </Button>
            </Tooltip>
            <Tooltip content={copied ? 'Copied' : 'Copy link'} side='top'>
              <Button
                variant='ghost'
                size='iconSm'
                className='size-7 text-muted-foreground'
                aria-label='Copy link'
                onClick={handleCopy}
                data-track-category='MESSAGE'
                data-track-name='COPY_LINK_HOVER_CARD'
                data-track-metadata={JSON.stringify({ url: href })}
              >
                {copied ? (
                  <CopyCopied className='h-4 w-4 text-status-success' />
                ) : (
                  <CopyDefault className='h-4 w-4' />
                )}
              </Button>
            </Tooltip>
          </div>
        </div>
        <div className='mt-2 break-all text-sm text-muted-foreground'>{href}</div>
      </div>
    </HoverCard>
  );
};
