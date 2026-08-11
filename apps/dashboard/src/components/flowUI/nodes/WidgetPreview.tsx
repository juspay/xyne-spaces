import React, { createContext } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useParams } from 'react-router-dom';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import { PreviewSplitDialog, PreviewThreadPanel } from '../../ui/PreviewSplitDialog';
import { usePlatform } from '../../../hooks/usePlatform';

/**
 * Marks a flow widget rendered in its own preview's thread panel. Widgets use
 * this to avoid opening another preview for the same message from that panel.
 */
export const InsideWidgetPreviewContext = createContext(false);

interface WidgetPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Stable namespace for the dialog's resizable-panel state. */
  idPrefix: string;
  /** Short artifact type displayed in the left-panel header. */
  label: string;
  /** Dialog title for assistive technology. */
  title: string;
  /** Dialog description for assistive technology. */
  description?: string | undefined;
  /** Conversation shown beside the widget, when available. */
  conversationId?: string | undefined;
  /** Artifact-specific content rendered in the left-panel scroll area. */
  children: React.ReactNode;
  /** Optional artifact-specific controls below the scroll area. */
  footer?: React.ReactNode;
  tracking?: {
    category: string;
    closeName: string;
  };
}

/**
 * Common full-screen preview for FlowJSON widgets.
 *
 * It centralizes the dialog, responsive thread behavior, preview recursion
 * guard, and left-panel chrome. Widgets only provide their detail content and
 * footer, so new widget types do not need to duplicate preview infrastructure.
 */
export const WidgetPreview: React.FC<WidgetPreviewProps> = ({
  open,
  onOpenChange,
  idPrefix,
  label,
  title,
  description,
  conversationId,
  children,
  footer,
  tracking = { category: 'WIDGET_ARTIFACT', closeName: 'CLOSE_WIDGET_PREVIEW' },
}) => {
  const { channelId } = useParams<{ channelId?: string }>();
  const { isMobile } = usePlatform();
  const hasThread = !isMobile && Boolean(conversationId);
  const close = (): void => onOpenChange(false);

  const artifactPanel = (
    <>
      <Dialog.Title className='sr-only'>{title}</Dialog.Title>
      <Dialog.Description className='sr-only'>
        {description ?? `${label} details`}
      </Dialog.Description>
      <div className='flex h-full flex-col bg-background'>
        <div className='flex h-14 flex-shrink-0 items-center justify-between border-b border-border px-5'>
          <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
            {label}
          </span>
          {!hasThread && (
            <button
              type='button'
              onClick={close}
              aria-label='Close'
              className='rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
              data-track-category={tracking.category}
              data-track-name={tracking.closeName}
            >
              <MultipleCrossCancelDefault size={18} />
            </button>
          )}
        </div>
        <div className='flex-1 overflow-y-auto px-6 py-5'>
          <div className='mx-auto flex max-w-3xl flex-col gap-5'>{children}</div>
        </div>
        {footer && (
          <div className='flex-shrink-0 border-t border-border bg-foreground/[0.03] px-6 py-3'>
            {footer}
          </div>
        )}
      </div>
    </>
  );

  const threadPanel = hasThread ? (
    <InsideWidgetPreviewContext.Provider value={true}>
      <PreviewThreadPanel
        {...(channelId ? { channelId } : {})}
        conversationId={conversationId}
        onClose={close}
      />
    </InsideWidgetPreviewContext.Provider>
  ) : undefined;

  return (
    <PreviewSplitDialog
      open={open}
      onClose={close}
      idPrefix={idPrefix}
      isMobile={isMobile}
      left={artifactPanel}
      right={threadPanel}
      overlayClassName='bg-black/80'
      contentClassName='bg-black data-[state=closed]:fade-out transition-all ease-in-out duration-300 data-[state=open]:fade-in'
      bodyClassName='bg-background'
    />
  );
};
