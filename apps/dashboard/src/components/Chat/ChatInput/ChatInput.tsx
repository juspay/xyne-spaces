import React from 'react';
import type { FocusPosition } from '@tiptap/react';
import type { Conversation } from '@xyne/shared';
import { withProfiler } from '../../../utils/withProfiler';
import type { InputBoxHandle } from '../../../hooks/useDragAndDropAreaRef';
import type { TwinEditSession } from '../TwinReplyDraft/twinReplyDraftApi';
import { ChatComposer } from './ChatComposer';

/** Everything around the box: banners above it, the dialogs it opens. */
function ComposerFrame({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <>
      <ChatComposer.Writable>
        <ChatComposer.ConnectionBanner />
        <ChatComposer.ScheduledBanner />
        {children}
      </ChatComposer.Writable>
      <ChatComposer.CreateTicketDialog />
      <ChatComposer.RelatedDialog />
      <ChatComposer.ScheduleCallDialog />
      <ChatComposer.AddPeopleDialog />
    </>
  );
}

const newMessageHeader = (
  <>
    <ChatComposer.DiscussionTitle />
    <ChatComposer.RelatedStrip />
  </>
);

interface ChannelComposerProps {
  channelId: string;
  autoFocus?: FocusPosition;
  ref?: React.Ref<InputBoxHandle>;
}

/** A new top-level message in a channel or DM — or a new discussion, where it starts one. */
function ChannelComposerInner({
  channelId,
  autoFocus,
  ref,
}: ChannelComposerProps): React.JSX.Element {
  return (
    <ChatComposer.Provider
      mode={{ kind: 'compose' }}
      channelId={channelId}
      ref={ref}
      {...(autoFocus !== undefined && { autoFocus })}
    >
      <ComposerFrame>
        <ChatComposer.Box header={newMessageHeader} tools={<ChatComposer.ShortcutsButton />} />
      </ComposerFrame>
    </ChatComposer.Provider>
  );
}

interface ThreadComposerProps {
  channelId: string;
  /** Undefined while the thread loads; the composer then writes to the channel. */
  conversation: Conversation | undefined;
  autoFocus?: FocusPosition;
  ref?: React.Ref<InputBoxHandle>;
  placeholder?: string;
  /** The thread already has a ticket, so the box doesn't offer another. */
  hasTicket?: boolean;
  threadParticipantIds?: ReadonlySet<string>;
  /** Docked above the box: the digital twin's suggested reply. */
  dock?: React.ReactNode;
  /** The twin's draft, while the user edits it in this box. */
  twinEdit?: TwinEditSession | undefined;
}

/** A reply in a thread. */
function ThreadComposerInner({
  channelId,
  conversation,
  autoFocus,
  ref,
  placeholder = 'Reply to this thread...',
  hasTicket,
  threadParticipantIds,
  dock,
  twinEdit,
}: ThreadComposerProps): React.JSX.Element {
  return (
    <ChatComposer.Provider
      mode={{ kind: 'compose', twinEdit }}
      channelId={channelId}
      conversation={conversation}
      ref={ref}
      placeholder={placeholder}
      threadParticipantIds={threadParticipantIds}
      {...(autoFocus !== undefined && { autoFocus })}
      {...(hasTicket !== undefined && { hasTicket })}
    >
      <ComposerFrame>
        <ChatComposer.Box
          header={newMessageHeader}
          tools={<ChatComposer.ShortcutsButton />}
          dock={dock}
        />
      </ComposerFrame>
    </ChatComposer.Provider>
  );
}

interface EditMessageComposerProps {
  channelId: string;
  conversation?: Conversation | undefined;
  messageId: string;
  /** The message's html, or a forwarded message's optional text. */
  initialContent: string;
  isForwardedContent?: boolean;
  autoFocus?: FocusPosition;
  placeholder?: string;
  className?: string;
  /** The edit was saved. */
  onEditComplete?: () => void;
  /** The user left without saving: Escape, the cancel button or its shortcut. */
  onCancel?: () => void;
}

/** Rewriting a message already sent. No attachments, drafts or typing indicator. */
function EditMessageComposerInner({
  channelId,
  conversation,
  messageId,
  initialContent,
  isForwardedContent = false,
  autoFocus,
  placeholder = 'Edit message…',
  className,
  onEditComplete,
  onCancel,
}: EditMessageComposerProps): React.JSX.Element {
  return (
    <ChatComposer.Provider
      mode={{
        kind: 'edit',
        messageId,
        initialContent,
        isForwardedContent,
        onEditComplete,
        onCancel,
      }}
      channelId={channelId}
      conversation={conversation}
      placeholder={placeholder}
      className={className}
      showTypingIndicator={false}
      {...(autoFocus !== undefined && { autoFocus })}
    >
      <ComposerFrame>
        {/* The header parts render nothing while editing; passed so the box is built as for a new message. */}
        <ChatComposer.Box header={newMessageHeader} tools={<ChatComposer.ShortcutsButton />} />
      </ComposerFrame>
    </ChatComposer.Provider>
  );
}

// Profiled under one id, as the single composer was, so render metrics stay comparable.
export const ChannelComposer = withProfiler(ChannelComposerInner, 'ChatInput');
export const ThreadComposer = withProfiler(ThreadComposerInner, 'ChatInput');
export const EditMessageComposer = withProfiler(EditMessageComposerInner, 'ChatInput');
