import React from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';
import { ResizableGroup, Panel, Separator } from './Resizable/Resizable';
import ThreadMessages from '../Chat/ThreadPannel';
import { cn } from '../../utils/classNames';

/**
 * PreviewSplitDialog — the shared full-screen "preview" shell.
 *
 * This is the extracted skeleton of the attachment viewer (FileViewerModal): a
 * Radix dialog holding a resizable split view (a main/left artifact panel + a
 * right thread panel). It owns ONLY the chrome that must stay consistent and was
 * historically fragile:
 *   - the dialog (overlay + sizing + animations),
 *   - the react-resizable-panels v4 group (with the stable ids + separator styling
 *     that make the resize actually work — see FileViewerModal history),
 *   - the resize-aware dismiss guard (a resize drag captures the pointer, which
 *     Radix would otherwise read as an "outside" interaction and close the dialog).
 *
 * Callers supply their own content and open/close:
 *   - the attachment viewer passes the attachment as `left` (+ its thread as `right`),
 *   - WidgetPreview passes FlowJSON widget details as `left` (+ its thread as `right`).
 *
 * When `right` is omitted the split collapses to a full-bleed `left` (mobile /
 * no-thread), mirroring the viewer's full-view branch.
 */
export interface PreviewSplitDialogProps {
  open: boolean;
  /** Called when the dialog should close (Escape / outside click / etc.). */
  onClose: () => void;
  /** Main panel — the artifact (attachment) or plan document. */
  left: React.ReactNode;
  /** Thread panel. When omitted, `left` renders full-bleed with no resize handle. */
  right?: React.ReactNode | undefined;
  /**
   * Unique id namespace for this dialog's resize group + panels. v4 keys its
   * registry by id; a stable, unique value per usage is what makes the resize work
   * and persist (do NOT reuse across two simultaneously-mounted dialogs).
   */
  idPrefix: string;
  isMobile?: boolean;

  // Split sizing (defaults tuned for the attachment viewer: 70 / 30).
  leftDefaultSize?: string;
  leftMinSize?: string;
  rightDefaultSize?: string;
  rightMinSize?: string;
  rightMaxSize?: string;

  // Dialog chrome hooks — let each caller keep its exact look/behaviour.
  overlayClassName?: string;
  contentClassName?: string;
  contentStyle?: React.CSSProperties;
  /** Class on the inner absolute-inset body wrapper (e.g. background colour). */
  bodyClassName?: string;
  /** Opt out of the swipe-to-open-thread drawer gesture (attachment viewer does). */
  preventDrawer?: boolean;

  onEscapeKeyDown?: (event: KeyboardEvent) => void;
  onMouseEnter?: () => void;
  onMouseLeave?: () => void;
  onTouchStart?: (event: React.TouchEvent) => void;
}

/** Keep the dialog open when the interaction is a resize-handle drag. */
const isResizeInteraction = (target: HTMLElement | null): boolean =>
  !!target?.closest?.('[data-group],[data-separator],[role="separator"]');

export const PreviewSplitDialog: React.FC<PreviewSplitDialogProps> = ({
  open,
  onClose,
  left,
  right,
  idPrefix,
  isMobile = false,
  leftDefaultSize = '70%',
  leftMinSize = '30%',
  rightDefaultSize = '30%',
  rightMinSize = '20%',
  rightMaxSize = '40%',
  overlayClassName,
  contentClassName,
  contentStyle,
  bodyClassName,
  preventDrawer = false,
  onEscapeKeyDown,
  onMouseEnter,
  onMouseLeave,
  onTouchStart,
}) => {
  const hasThread = right !== null && right !== undefined;

  return (
    <Dialog.Root
      open={open}
      onOpenChange={next => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay
          className={cn(
            'fixed inset-0 z-[50] data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0',
            overlayClassName,
          )}
        />
        <Dialog.Content
          {...(preventDrawer ? { 'data-prevent-drawer': 'true' } : {})}
          className={cn(
            'fixed z-[50] overflow-hidden focus:outline-none',
            isMobile ? 'inset-0 w-screen h-screen' : 'inset-0 m-auto w-[95vw] h-[95vh] rounded-2xl',
            contentClassName,
          )}
          style={contentStyle}
          onOpenAutoFocus={event => event.preventDefault()}
          onInteractOutside={event => {
            // A resize drag captures the pointer on the separator (v4 setPointerCapture);
            // Radix reads the captured pointer/focus as "outside" and would dismiss the
            // dialog mid-drag (→ v4 "Could not find data for Group" + setPointerCapture
            // crashes). Keep the dialog open for resize-handle interactions.
            const target = event.detail.originalEvent.target as HTMLElement | null;
            const active = globalThis.document.activeElement as HTMLElement | null;
            if (isResizeInteraction(target) || isResizeInteraction(active)) {
              event.preventDefault();
              return;
            }
            onClose();
          }}
          {...(onEscapeKeyDown ? { onEscapeKeyDown } : {})}
          {...(onMouseEnter ? { onMouseEnter } : {})}
          {...(onMouseLeave ? { onMouseLeave } : {})}
          {...(onTouchStart ? { onTouchStart } : {})}
        >
          <div className={cn('absolute inset-0', bodyClassName)}>
            {hasThread ? (
              <ResizableGroup
                orientation='horizontal'
                className='h-full w-full'
                // Stable group + panel ids: v4 keys its registry by id and throws
                // "Could not find data for Group" when the useId fallback churns across
                // this modal's mount/unmount, which kills the resize.
                id={`${idPrefix}-group`}
                autoSaveId={`${idPrefix}-split`}
                panelIds={[`${idPrefix}-left`, `${idPrefix}-right`]}
              >
                <Panel id={`${idPrefix}-left`} defaultSize={leftDefaultSize} minSize={leftMinSize}>
                  {left}
                </Panel>
                <Separator className='w-[2px] transition-colors cursor-col-resize flex items-center justify-center group'>
                  <div
                    id='panel-resize-divider'
                    className='w-[2px] h-full bg-border group-hover:bg-primary group-active:bg-primary'
                  ></div>
                </Separator>
                <Panel
                  id={`${idPrefix}-right`}
                  defaultSize={rightDefaultSize}
                  minSize={rightMinSize}
                  maxSize={rightMaxSize}
                >
                  {right}
                </Panel>
              </ResizableGroup>
            ) : (
              left
            )}
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
};

PreviewSplitDialog.displayName = 'PreviewSplitDialog';

type ThreadMessagesProps = NonNullable<React.ComponentProps<typeof ThreadMessages>>;

/**
 * PreviewThreadPanel — the right-hand "Thread" panel that lives inside a
 * PreviewSplitDialog. Shared by the attachment viewer (FileViewerModal) and the
 * widget preview (WidgetPreview): same header, size, and message list in both places;
 * only the left/main preview content differs. Kept in this file since the two are
 * always used together.
 */
export const PreviewThreadPanel: React.FC<{
  onClose: () => void;
  channelId?: string | undefined;
  conversationId?: string | undefined;
  threadMessages?: ThreadMessagesProps['threadMessages'];
  /**
   * Rendered in place of the message list while thread data loads. The attachment
   * viewer passes a synthetic parent-message bubble or a spinner here; the plan
   * preview never sets it (its thread is always ready).
   */
  loading?: React.ReactNode;
}> = ({ onClose, channelId, conversationId, threadMessages, loading }) => (
  <div className='flex flex-col h-full w-full border-l border-border bg-background z-10 min-w-0'>
    {/* Thread header with close button */}
    <div className='flex items-center justify-between p-4 border-b border-border h-14 flex-shrink-0'>
      <h3 className='font-semibold text-foreground'>Threads</h3>
      <button
        onClick={onClose}
        data-track-category='FileViewer'
        data-track-name='CloseThreadPanel'
        className='p-2 rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors'
        aria-label='Close'
      >
        <X className='h-5 w-5' />
      </button>
    </div>
    {loading !== null && loading !== undefined ? (
      loading
    ) : (
      <div className='flex-1 overflow-hidden min-w-0'>
        <ThreadMessages
          {...(channelId ? { channelId } : {})}
          {...(conversationId ? { conversationId } : {})}
          {...(threadMessages && threadMessages.length > 0 ? { threadMessages } : {})}
          hideHeader
          disableAskAI
          skipInputAutoFocus
        />
      </div>
    )}
  </div>
);

PreviewThreadPanel.displayName = 'PreviewThreadPanel';
