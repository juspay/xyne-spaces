import React from 'react';
import { format } from 'date-fns';
import { Clock, WifiOff, Wifi, Zap } from 'lucide-react';
import { InputBox } from '../../ui/InputBox';
import { BLOCKED_EXTENSIONS } from '../../ui/utils/files';
import { Tooltip } from '../../ui/Tooltip/Tooltip';
import { ScheduleCallModal } from '../../Call/ScheduleCallModal/ScheduleCallModal';
import { CreateTicketModal } from '../../Tickets/CreateTicketModal/CreateTicketModal';
import { ShortcutPickerModal } from '../../Apps/ShortcutPickerModal/ShortcutPickerModal';
import { AddPeopleForm } from '../AddPeopleForm/AddPeopleForm';
import Dialog from '../../ui/Dialog';
import { AgentProgressIndicator } from './AgentProgressIndicator';
import { RelatedContextStrip } from './RelatedContextStrip';
import { RelatedContextDialog } from './RelatedContextDialog';
import { ChatComposerProvider } from './ChatComposerProvider';
import { useChatComposer } from './ChatComposerContext';

/**
 * Renders its children while the channel takes messages; an archived channel gets
 * a notice in the composer's place.
 */
function Writable({ children }: { children: React.ReactNode }): React.JSX.Element {
  const {
    state: { channel },
    meta: { conversationId },
  } = useChatComposer();
  if (channel?.isArchived) {
    return (
      <div className='px-4 py-3 bg-muted border-t border-border'>
        <p className='text-sm text-status-pending text-center'>
          {conversationId
            ? 'You are viewing a thread from an archived channel'
            : `You are viewing #${channel.name}, an archived channel`}
        </p>
      </div>
    );
  }
  return <>{children}</>;
}

/** Offline, with a reconnect button, and the brief "Connected" once it's back. */
function ConnectionBanner(): React.JSX.Element {
  const {
    state: { connection },
    actions,
    meta: { mode },
  } = useChatComposer();
  return (
    <>
      {connection.showOfflineBanner && (
        <div className='px-3 py-1.5 bg-amber-50 dark:bg-amber-950/50 border border-amber-200 dark:border-amber-800 rounded text-xs text-amber-700 dark:text-amber-300 flex items-center justify-between mx-3 mb-1'>
          <div className='flex items-center gap-1.5'>
            <WifiOff className='w-3 h-3 shrink-0' />
            <span>
              {mode.kind === 'edit' && mode.messageId
                ? "You're offline. Edits can't be saved until you reconnect."
                : "You're offline. Messages will be saved as drafts until you reconnect."}
            </span>
          </div>
          <button
            type='button'
            onClick={actions.refreshConnection}
            disabled={connection.isReconnecting}
            className={`ml-2 shrink-0 px-2 py-0.5 text-xs font-medium rounded transition-colors ${
              connection.isReconnecting
                ? 'text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-950 cursor-wait'
                : 'text-amber-800 dark:text-amber-200 bg-amber-100 dark:bg-amber-900 hover:bg-amber-200 dark:hover:bg-amber-800'
            }`}
            data-ph-capture-attribute-track-id='reconnect_zero'
            data-track-category='CHAT_INPUT'
            data-track-name='RECONNECT_ZERO'
          >
            {connection.isReconnecting ? 'Reconnecting...' : 'Reconnect'}
          </button>
        </div>
      )}
      {connection.isReconnected && (
        <div className='px-3 py-1.5 bg-green-50 dark:bg-green-950/50 border border-green-200 dark:border-green-800 rounded text-xs text-green-700 dark:text-green-300 flex items-center gap-1.5 mx-3 mb-1'>
          <Wifi className='w-3 h-3 shrink-0' />
          <span>Connected</span>
        </div>
      )}
    </>
  );
}

/** When the next scheduled message from here goes out, with a link to all of them. */
function ScheduledBanner(): React.JSX.Element | null {
  const {
    state: { bannerScheduledFor },
    actions,
  } = useChatComposer();
  if (bannerScheduledFor === null) return null;
  return (
    <div className='mx-3 mb-2 mt-2 flex items-center gap-2 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm text-foreground animate-in slide-in-from-bottom-2 duration-200'>
      <Clock size={14} className='flex-shrink-0 text-muted-foreground' />
      <span className='min-w-0'>
        Your message will be sent at {format(new Date(bannerScheduledFor), 'h:mm a')} on{' '}
        {format(new Date(bannerScheduledFor), 'MMM d')}.{' '}
        <button
          type='button'
          onClick={actions.openScheduledMessages}
          className='font-semibold text-primary hover:underline'
          data-track-category='CHAT_INPUT'
          data-track-name='open-delayed-messages-from-banner'
        >
          See all scheduled messages
        </button>
      </span>
    </div>
  );
}

/** The title field a new discussion opens with. Only where it starts one. */
function DiscussionTitle(): React.JSX.Element | null {
  const {
    state: { discussionTitle },
    actions,
    meta: { capabilities, discussionTitleRef, inputBoxRef },
  } = useChatComposer();
  if (!capabilities.startsDiscussion) return null;
  return (
    <input
      ref={discussionTitleRef}
      value={discussionTitle}
      onChange={event => actions.setDiscussionTitle(event.target.value)}
      onKeyDown={event => {
        // Enter moves on to the opening message rather than sending.
        if (event.key !== 'Enter' || event.nativeEvent.isComposing) return;
        event.preventDefault();
        inputBoxRef.current?.focus();
      }}
      maxLength={200}
      placeholder='Discussion title'
      aria-label='Discussion title'
      data-track-category='CHAT_INPUT'
      data-track-name='DISCUSSION_TITLE'
      className='w-full bg-transparent px-3 pb-0.5 pt-2.5 text-[14px] font-semibold text-foreground outline-none placeholder:font-medium placeholder:text-muted-foreground/70'
    />
  );
}

/** Chips for the threads, tickets, canvases and calls the draft relates to. */
function RelatedStrip(): React.JSX.Element {
  const {
    state: { related },
    actions,
  } = useChatComposer();
  return (
    <RelatedContextStrip
      items={related.items}
      suppressPreviews={related.popup.open}
      onOpen={actions.related.open}
      onDismiss={actions.related.dismiss}
    />
  );
}

/** The ⚡ button for the channel's global shortcuts, and the picker it opens. */
function ShortcutsButton(): React.JSX.Element | null {
  const {
    state: { dialogs },
    actions,
    meta: { channelId, conversationId, globalShortcuts },
  } = useChatComposer();
  if (globalShortcuts.length === 0) return null;
  return (
    <>
      <Tooltip content='Shortcuts' side='top'>
        <button
          type='button'
          onClick={() => actions.dialogs.setShortcutsOpen(true)}
          className='p-1.5 rounded hover:bg-accent transition duration-200 ease-in-out'
          aria-label='Open shortcuts'
          data-track-category='CHAT_INPUT'
          data-track-name='open-global-shortcuts'
        >
          <Zap className='h-4 w-4 text-muted-foreground' />
        </button>
      </Tooltip>
      {dialogs.shortcuts && (
        <ShortcutPickerModal
          open={dialogs.shortcuts}
          onClose={() => actions.dialogs.setShortcutsOpen(false)}
          channelId={channelId}
          conversationId={conversationId ?? null}
          shortcuts={globalShortcuts}
        />
      )}
    </>
  );
}

interface BoxProps {
  /** Above the editor, inside the box (desktop only). */
  header?: React.ReactNode;
  /** Left of the toolbar's send controls. */
  tools?: React.ReactNode;
  /** Docked above the box, e.g. a digital twin's draft. */
  dock?: React.ReactNode;
}

/** The editor itself: text, menus, attachments, toolbar and send. */
function Box({ header, tools, dock }: BoxProps): React.JSX.Element {
  const { state, actions, meta } = useChatComposer();
  const { mode, capabilities, conversationId, channelId } = meta;
  const twinEdit = mode.kind === 'compose' ? mode.twinEdit : undefined;
  return (
    <InputBox
      id={meta.sessionId}
      channelId={channelId}
      autoFocus={meta.isMobile || meta.isXyneAIOpen ? false : meta.autoFocus} // eslint-disable-line jsx-a11y/no-autofocus
      ref={meta.inputBoxRef}
      key={`inputBox-${channelId}-${conversationId}`}
      mentionItems={meta.mentionItems}
      voiceMentionItems={meta.voiceMentionItems}
      onMentionSearch={actions.searchMentions}
      channelItems={meta.channelItems}
      onChannelSearch={actions.searchChannels}
      onSendMessage={actions.send}
      onContentChange={actions.contentChange}
      onTyping={actions.typing}
      placeholder={meta.placeholder}
      typingUsers={state.typingUsers}
      showTypingIndicator={meta.showTypingIndicator}
      hasAgentActivity={state.agentActive}
      agentSlot={
        <AgentProgressIndicator
          sessionId={meta.agentProgressConversationId ?? meta.sessionId}
          conversationId={meta.agentProgressConversationId}
          onActiveChange={actions.setAgentActive}
        />
      }
      commandItems={meta.commandItems}
      onCommandSelect={actions.selectCommand}
      {...(state.activeArtifactCommand && {
        slashCommandArtifactCommand: state.activeArtifactCommand,
      })}
      {...(meta.artifactChannelLabel && {
        slashCommandArtifactChannelLabel: meta.artifactChannelLabel,
      })}
      onCancelSlashCommandArtifact={actions.cancelArtifact}
      {...(!twinEdit && state.editorValue !== undefined && { value: state.editorValue })}
      {...(capabilities.cancelEdit && { onCancel: actions.cancelEdit })}
      {...(conversationId && { conversationId })}
      className={meta.className}
      dockSlot={dock}
      {...(capabilities.relatedContext && { borderActivity: state.related.loading })}
      headerSlot={header}
      features={{
        richText: true,
        commands: true,
        mentions: true,
        fileAttachments: capabilities.fileAttachments,
        emojiPicker: true,
      }}
      blockedExtensions={[...BLOCKED_EXTENSIONS]}
      preserveThreadRoute={!!conversationId}
      {...(capabilities.alsoSendToChannel && {
        onAlsoSendToChannelChange: actions.setAlsoSendToChannel,
        alsoSendToChannelChecked: state.alsoSendToChannel,
        isDMThread: meta.isDM,
      })}
      {...(capabilities.createTicket && {
        onCreateTicket: actions.createTicketFromComposer,
      })}
      onTranscriptSelect={actions.insertTranscript}
      onCreateCanvas={actions.createCanvas}
      hasTicket={meta.hasTicket}
      sendDisabled={state.connection.isOffline || state.isAttachmentUploading}
      {...(state.isAttachmentUploading && {
        sendDisabledReason: 'Attachment is still uploading',
      })}
      onScheduleSend={actions.scheduleSend}
      showSchedulePresets={capabilities.schedulePresets}
      {...(meta.globalShortcuts.length > 0 && { bottomLeftSlot: tools })}
    />
  );
}

/** The create-ticket form, opened by the composer's ticket button or an intent suggestion. */
function CreateTicketDialog(): React.JSX.Element | null {
  const {
    state: { channel, dialogs },
    actions,
    meta: { channelId, conversation },
  } = useChatComposer();
  if (!channel || !dialogs.createTicket.open) return null;
  return (
    <CreateTicketModal
      isOpen={dialogs.createTicket.open}
      onClose={actions.dialogs.closeCreateTicket}
      channelId={channelId}
      projectId={(channel.projectId as string | null) || ''}
      trackSource={dialogs.createTicket.source}
      initialDescription={dialogs.createTicket.description}
      sourceConversation={conversation ?? undefined}
      onTicketCreated={actions.dialogs.ticketCreated}
    />
  );
}

/** The popup a related-context chip opens. */
function RelatedDialog(): React.JSX.Element | null {
  const {
    state: { related },
    actions,
    meta: { capabilities, channelId },
  } = useChatComposer();
  if (!capabilities.relatedContext) return null;
  return (
    <RelatedContextDialog
      open={related.popup.open}
      channelId={channelId}
      items={related.popup.items}
      draft={related.popup.draft}
      selectedId={related.popup.selectedId}
      onSelect={actions.related.select}
      onClose={actions.related.close}
      onJump={(item, event) => {
        actions.related.close();
        actions.related.jump(item, event);
      }}
    />
  );
}

/** Opened by the intent-suggestion toast. */
function ScheduleCallDialog(): React.JSX.Element {
  const {
    state: { dialogs },
    actions,
    meta: { channelId, conversation },
  } = useChatComposer();
  return (
    <ScheduleCallModal
      isOpen={dialogs.scheduleCall}
      onClose={actions.dialogs.closeScheduleCall}
      channelId={channelId}
      {...(conversation?.conversationId ? { conversationId: conversation.conversationId } : {})}
    />
  );
}

/** Opened by the intent-suggestion toast. */
function AddPeopleDialog(): React.JSX.Element | null {
  const {
    state: { channel, dialogs },
    actions,
    meta: { channelId },
  } = useChatComposer();
  if (!channel || !dialogs.addPeople) return null;
  return (
    <Dialog
      open={dialogs.addPeople}
      onOpenChange={actions.dialogs.setAddPeopleOpen}
      title='Add Members'
    >
      <AddPeopleForm
        channelId={channelId}
        onSuccess={() => actions.dialogs.setAddPeopleOpen(false)}
        onCancel={() => actions.dialogs.setAddPeopleOpen(false)}
      />
    </Dialog>
  );
}

/**
 * The chat composer's building blocks. A variant (`ChannelComposer`,
 * `ThreadComposer`, `EditMessageComposer`) wraps the parts it needs in a
 * `ChatComposer.Provider`; every part reads the composer from context.
 */
export const ChatComposer = {
  Provider: ChatComposerProvider,
  Writable,
  ConnectionBanner,
  ScheduledBanner,
  Box,
  DiscussionTitle,
  RelatedStrip,
  ShortcutsButton,
  CreateTicketDialog,
  RelatedDialog,
  ScheduleCallDialog,
  AddPeopleDialog,
};
