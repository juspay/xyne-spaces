import React, { createContext } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { useParams } from 'react-router-dom';
import { MultipleCrossCancelDefault } from '@xyne/icons';
import type { AgentIdentity } from '@xyne/shared';
import { PreviewSplitDialog, PreviewThreadPanel } from '../../../ui/PreviewSplitDialog';
import { usePlatform } from '../../../../hooks/usePlatform';
import { AgentConnectLinks } from './AgentIdentityBlock';
import { AgentCreateCanvas } from './create/AgentCreateCanvas';
import { AgentCreateSessionContext } from './create/AgentCreateSessionContext';
import type { useAgentCreateForm } from './create/useAgentCreateForm';
import type { AgentCreatePhase } from './create/types';
import type { DraftAgentEditor } from './useDraftAgentEditor';
import { AgentPreviewTabs } from './preview/AgentPreviewTabs';

/**
 * True inside AgentPreview's thread panel. The thread re-renders the SAME agent
 * message as a live card, which would otherwise show its own expand button and
 * let the user stack a second full-screen preview on top.
 */
export const InsideAgentPreviewContext = createContext(false);

interface AgentPreviewProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId?: string | undefined;
  agent: AgentIdentity;
  /** Present ⇒ the tools/model/provider sections are editable. */
  editor?: DraftAgentEditor | undefined;
  note?: string | undefined;
  statePill?: React.ReactNode;
  conversationId?: string | undefined;
  footer?: React.ReactNode;
  /** Create split: chat left / canvas right. Profile keeps identity left. */
  mode?: 'create' | 'profile';
  createForm?: ReturnType<typeof useAgentCreateForm>;
  createPhase?: AgentCreatePhase;
  handleError?: string | null | undefined;
  checkingHandle?: boolean | undefined;
  builtBy?: string | undefined;
}

const PanelHeader: React.FC<{ label: string; onClose?: (() => void) | undefined }> = ({
  label,
  onClose,
}) => (
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
        data-track-category='AGENT_ARTIFACT'
        data-track-name='CLOSE_AGENT_PREVIEW'
      >
        <MultipleCrossCancelDefault size={18} />
      </button>
    )}
  </div>
);

const DetailPanel: React.FC<{
  agent: AgentIdentity;
  editor?: DraftAgentEditor | undefined;
  note?: string | undefined;
  statePill?: React.ReactNode;
  footer?: React.ReactNode;
  onClose?: () => void;
}> = ({ agent, editor, note, statePill, footer, onClose }) => {
  const details = agent.details ?? [];

  return (
    <div className='flex h-full flex-col bg-background'>
      <PanelHeader label='Agent' onClose={onClose} />
      <div className='flex-1 overflow-y-auto px-6 py-5'>
        <div className='mx-auto flex max-w-3xl flex-col gap-5'>
          <div className='flex min-w-0 flex-col gap-1'>
            <div className='flex items-center gap-2'>
              <h1 className='text-2xl font-medium leading-[1.2] text-foreground'>{agent.name}</h1>
              {statePill}
            </div>
            <p className='flex min-w-0 items-center gap-2 text-sm leading-[22px]'>
              <span className='truncate font-medium text-foreground'>@{agent.slug}</span>
              {agent.modelId && (
                <>
                  <span aria-hidden className='shrink-0 text-foreground/30'>
                    ·
                  </span>
                  <span className='truncate text-foreground/70'>{agent.modelId}</span>
                </>
              )}
            </p>
          </div>

          {details.length > 0 && (
            <div className='flex flex-col gap-1.5 rounded-lg border border-border bg-muted/30 p-3'>
              {details.map(detail => (
                <div key={detail.label} className='flex items-baseline gap-3 text-sm leading-[1.4]'>
                  <span className='w-32 shrink-0 text-muted-foreground'>{detail.label}</span>
                  <span className='text-foreground/80'>{detail.value || '—'}</span>
                </div>
              ))}
            </div>
          )}

          <AgentConnectLinks agent={agent} />
          {note && <p className='text-xs leading-[1.4] text-muted-foreground'>{note}</p>}

          <AgentPreviewTabs agent={agent} editor={editor} />
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

export const AgentPreview: React.FC<AgentPreviewProps> = ({
  open,
  onOpenChange,
  agent,
  editor,
  note,
  statePill,
  conversationId,
  footer,
  mode = 'profile',
  createForm,
  createPhase = 'draft',
  handleError,
  checkingHandle,
  builtBy,
}) => {
  const { channelId } = useParams<{ channelId?: string }>();
  const { isMobile } = usePlatform();
  const close = (): void => onOpenChange(false);
  const isCreate = mode === 'create' && createForm !== undefined;

  const profilePanel = (
    <>
      <Dialog.Title className='sr-only'>{agent.name}</Dialog.Title>
      <Dialog.Description className='sr-only'>
        {agent.description ?? 'Agent details'}
      </Dialog.Description>
      <DetailPanel
        agent={agent}
        editor={editor}
        note={note}
        statePill={statePill}
        footer={footer}
        {...(isMobile || !conversationId ? { onClose: close } : {})}
      />
    </>
  );

  const canvasPanel = isCreate ? (
    <>
      <Dialog.Title className='sr-only'>{formTitle(createForm.form.name)}</Dialog.Title>
      <Dialog.Description className='sr-only'>
        Set up this agent, then create it.
      </Dialog.Description>
      <AgentCreateCanvas
        form={createForm.form}
        onFormChange={createForm.patchForm}
        onFieldFocus={createForm.onFieldFocus}
        writingField={createForm.writingField}
        highlights={createForm.highlights}
        conflicts={createForm.conflicts}
        onResolveConflict={createForm.resolveConflict}
        phase={createPhase}
        builtBy={builtBy}
        handleError={handleError}
        checkingHandle={checkingHandle}
        note={note}
        footer={footer}
        readOnly={createPhase === 'created' || createPhase === 'rejected'}
        {...(isMobile || !conversationId ? { onClose: close } : {})}
      />
    </>
  ) : (
    profilePanel
  );

  const threadPanel =
    isMobile || !conversationId ? undefined : (
      <InsideAgentPreviewContext.Provider value={true}>
        {isCreate ? (
          <AgentCreateSessionContext.Provider value={{ applyChatDraft: createForm.applyChatPatch }}>
            <PreviewThreadPanel
              {...(channelId ? { channelId } : {})}
              conversationId={conversationId}
              onClose={close}
            />
          </AgentCreateSessionContext.Provider>
        ) : (
          <PreviewThreadPanel
            {...(channelId ? { channelId } : {})}
            conversationId={conversationId}
            onClose={close}
          />
        )}
      </InsideAgentPreviewContext.Provider>
    );

  if (isCreate) {
    const desktopChat = Boolean(threadPanel);
    return (
      <PreviewSplitDialog
        open={open}
        onClose={close}
        idPrefix='agent-create-preview'
        isMobile={isMobile}
        left={desktopChat ? threadPanel : canvasPanel}
        {...(desktopChat ? { right: canvasPanel } : {})}
        leftDefaultSize='50%'
        leftMinSize='30%'
        rightDefaultSize='50%'
        rightMinSize='30%'
        rightMaxSize='70%'
        overlayClassName='bg-black/80'
        contentClassName='bg-black data-[state=closed]:fade-out transition-all ease-in-out duration-300 data-[state=open]:fade-in'
        bodyClassName='bg-background'
      />
    );
  }

  return (
    <PreviewSplitDialog
      open={open}
      onClose={close}
      idPrefix='agent-preview'
      isMobile={isMobile}
      left={profilePanel}
      right={threadPanel}
      overlayClassName='bg-black/80'
      contentClassName='bg-black data-[state=closed]:fade-out transition-all ease-in-out duration-300 data-[state=open]:fade-in'
      bodyClassName='bg-background'
    />
  );
};

function formTitle(name: string): string {
  const trimmed = name.trim();
  return trimmed.length > 0 ? trimmed : 'Create agent';
}
