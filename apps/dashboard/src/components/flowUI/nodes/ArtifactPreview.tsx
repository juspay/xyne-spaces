import React, { useMemo, createContext } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { PreviewSplitDialog, PreviewThreadPanel } from '../../ui/PreviewSplitDialog';
import { useParams } from 'react-router-dom';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import { MarkdownMessageRenderer } from '../../ui/MessageBubble/MarkdownMessageRenderer';
import { createMarkdownComponents } from '../../../utils/markdownComponents';
import { usePlatform } from '../../../hooks/usePlatform';

/** Prevent nested artifact cards in the thread panel from opening another preview. */
export const InsideArtifactPreviewContext = createContext(false);

export interface ArtifactPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  label: string;
  messageId: string;
  title: string;
  desc?: string | undefined;
  document?: string | undefined;
  conversationId?: string | undefined;
  footer?: React.ReactNode;
  body?: React.ReactNode;
  trackCategory?: string;
  idPrefix?: string;
}

const PanelHeader: React.FC<{
  label: string;
  trackCategory: string;
  onClose?: (() => void) | undefined;
}> = ({ label, trackCategory, onClose }) => (
  <div className='flex h-14 flex-shrink-0 items-center justify-between border-b border-border px-5'>
    <span className='font-mono text-sm leading-[18px] tracking-[0.2px] text-muted-foreground'>
      {label}
    </span>
    {onClose && (
      <button
        type='button'
        onClick={onClose}
        aria-label='Close'
        className='rounded-md p-1 text-muted-foreground transition-colors hover:bg-accent hover:text-foreground'
        data-track-category={trackCategory}
        data-track-name='CLOSE_ARTIFACT_PREVIEW'
      >
        <MultipleCrossCancelDefault size={18} />
      </button>
    )}
  </div>
);

type AdmonitionKind = 'NOTE' | 'TIP' | 'IMPORTANT' | 'WARNING' | 'CAUTION';

const ADMONITION_STYLES: Record<AdmonitionKind, { icon: string; box: string; label: string }> = {
  NOTE: { icon: 'ℹ️', box: 'border-blue-500/40 bg-blue-500/10', label: 'text-blue-600 dark:text-blue-400' },
  TIP: { icon: '💡', box: 'border-emerald-500/40 bg-emerald-500/10', label: 'text-emerald-600 dark:text-emerald-400' },
  IMPORTANT: { icon: '❗', box: 'border-violet-500/40 bg-violet-500/10', label: 'text-violet-600 dark:text-violet-400' },
  WARNING: { icon: '⚠️', box: 'border-amber-500/40 bg-amber-500/10', label: 'text-amber-600 dark:text-amber-400' },
  CAUTION: { icon: '🛑', box: 'border-red-500/40 bg-red-500/10', label: 'text-red-600 dark:text-red-400' },
};

const ADMONITION_RE = /^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*/;

function extractAdmonition(children: React.ReactNode): { kind: AdmonitionKind; children: React.ReactNode } | null {
  const items = React.Children.toArray(children);
  const firstEl = items.find((c): c is React.ReactElement<{ children?: React.ReactNode }> => React.isValidElement(c));
  if (!firstEl) return null;
  const inner = React.Children.toArray((firstEl.props as { children?: React.ReactNode }).children);
  const firstText = inner[0];
  if (typeof firstText !== 'string') return null;
  const match = ADMONITION_RE.exec(firstText);
  if (!match) return null;
  const kind = match[1] as AdmonitionKind;
  const strippedFirst = firstText.slice(match[0].length);
  const rebuiltFirst = React.cloneElement(firstEl, undefined, ...(strippedFirst ? [strippedFirst] : []), ...inner.slice(1));
  const rest = items.filter(c => c !== firstEl);
  return { kind, children: [rebuiltFirst, ...rest] };
}

const ArtifactBlockquote: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  const admonition = extractAdmonition(children);
  if (!admonition) {
    return (
      <blockquote className='my-2 border-l-2 border-border pl-3 text-foreground/70'>{children}</blockquote>
    );
  }
  const style = ADMONITION_STYLES[admonition.kind];
  return (
    <div className={cnJoin('my-3 rounded-lg border p-3', style.box)}>
      <p className={cnJoin('mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.4px]', style.label)}>
        <span aria-hidden>{style.icon}</span>
        {admonition.kind.charAt(0) + admonition.kind.slice(1).toLowerCase()}
      </p>
      <div className='text-sm leading-[1.6] text-foreground/85 [&>p]:m-0'>{admonition.children}</div>
    </div>
  );
};

function cnJoin(...parts: string[]): string {
  return parts.join(' ');
}

const DocumentPanel: React.FC<{
  messageId: string;
  label: string;
  trackCategory: string;
  title: string;
  desc?: string | undefined;
  document?: string | undefined;
  body?: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
}> = ({ messageId, label, trackCategory, title, desc, document, body, footer, onClose }) => {
  const markdownComponents = useMemo(
    () => ({
      ...createMarkdownComponents(messageId || 'artifact-document', undefined, { richArtifactContent: true }),
      blockquote: ArtifactBlockquote,
    }),
    [messageId],
  );
  return (
    <div className='flex h-full flex-col bg-background'>
      <PanelHeader label={label} trackCategory={trackCategory} onClose={onClose} />
      <div className='flex-1 overflow-y-auto px-6 py-5'>
        <div className='mx-auto flex max-w-3xl flex-col gap-5'>
          <div className='flex flex-col gap-1'>
            <h1 className='text-2xl font-semibold leading-[1.2] text-foreground'>{title}</h1>
            {desc && (
              <p className='text-sm leading-[1.5] tracking-[-0.15px] text-foreground/70'>{desc}</p>
            )}
          </div>
          {body}
          {document && (
            <>
              <div className='h-px w-full bg-border' />
              <MarkdownMessageRenderer content={document} markdownComponents={markdownComponents} />
            </>
          )}
        </div>
      </div>
      {footer && (
        <div className='flex-shrink-0 border-t border-border bg-foreground/[0.03] px-6 py-3'>
          {footer}
        </div>
      )}
    </div>
  );
};

export const ArtifactPreview: React.FC<ArtifactPreviewProps> = ({
  open,
  onOpenChange,
  label,
  messageId,
  title,
  desc,
  document,
  conversationId,
  footer,
  body,
  trackCategory = 'ARTIFACT_PREVIEW',
  idPrefix = 'artifact-preview',
}) => {
  const { channelId } = useParams<{ channelId?: string }>();
  const { isMobile } = usePlatform();
  const close = (): void => onOpenChange(false);

  const documentPanel = (
    <>
      <Dialog.Title className='sr-only'>{title}</Dialog.Title>
      <Dialog.Description className='sr-only'>{desc ?? `${label} details`}</Dialog.Description>
      <DocumentPanel
        messageId={messageId}
        label={label}
        trackCategory={trackCategory}
        title={title}
        desc={desc}
        document={document}
        body={body}
        footer={footer}
        {...(isMobile || !conversationId ? { onClose: close } : {})}
      />
    </>
  );

  const threadPanel =
    isMobile || !conversationId ? undefined : (
      <InsideArtifactPreviewContext.Provider value={true}>
        <PreviewThreadPanel
          {...(channelId ? { channelId } : {})}
          conversationId={conversationId}
          onClose={close}
        />
      </InsideArtifactPreviewContext.Provider>
    );

  return (
    <PreviewSplitDialog
      open={open}
      onClose={close}
      idPrefix={idPrefix}
      isMobile={isMobile}
      left={documentPanel}
      right={threadPanel}
      overlayClassName='bg-black/80'
      contentClassName='bg-black data-[state=closed]:fade-out transition-all ease-in-out duration-300 data-[state=open]:fade-in'
      bodyClassName='bg-background'
    />
  );
};
