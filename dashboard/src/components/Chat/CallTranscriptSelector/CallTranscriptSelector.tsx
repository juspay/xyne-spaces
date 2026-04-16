import React, { useState, useMemo, useEffect } from 'react';
import DOMPurify from 'dompurify';
import {
  Phone,
  Calendar,
  ChevronRight,
  FileText,
  Clock,
  PhoneIncoming,
  PhoneOutgoing,
  PhoneMissed,
  MessageSquare,
  Paperclip,
} from 'lucide-react';
import { format } from 'date-fns';
import { useUsers } from '../../../hooks/useUsers';
import { useAuth } from '../../../hooks/useAuth';
import { Virtuoso } from 'react-virtuoso';
import { usePaginatedCalls } from '../../../hooks/usePaginatedCalls';
import { QueryResultType } from '@rocicorp/zero';
import { queries } from '../../../zero/queries';

type Call = QueryResultType<typeof queries.userCallHistory>[number];

// TODO: TranscriptEntry interface for future transcript display
// interface TranscriptEntry {
//   id: number;
//   time?: string;
//   speaker?: string;
//   text: string;
//   seconds: number;
//   isSystem?: boolean;
// }

interface CallTranscriptSelectorProps {
  onSelect: (content: string) => void;
  onAttach?: (file: File) => void;
  onClose: () => void;
}

export const CallTranscriptSelector: React.FC<CallTranscriptSelectorProps> = ({
  onSelect,
  onAttach,
  onClose,
}) => {
  const { calls, hasMoreCalls, loadMoreCalls, onVisibleRangeChanged } = usePaginatedCalls();
  const allUsers = useUsers();
  const { user } = useAuth();
  const currentUserId = user?.id;

  const [selectedCallId, setSelectedCallId] = useState<string | null>(null);

  useEffect(() => {
    if (!selectedCallId && calls && calls.length > 0) {
      const firstCall = calls[0];
      if (firstCall) {
        setSelectedCallId(firstCall.id);
      }
    }
  }, [calls, selectedCallId]);

  const selectedCall = useMemo(
    () => calls?.find(c => c.id === selectedCallId) || null,
    [calls, selectedCallId],
  );

  const getCallContent = (): string => {
    const call = selectedCall;
    if (!call) return '';

    const stripHtml = (html: string): string => {
      const doc = new DOMParser().parseFromString(html, 'text/html');
      return doc.body.textContent || '';
    };

    const summary = call.aiSummary ? stripHtml(call.aiSummary) : '';

    let content = '';
    if (summary) {
      content = `CALL SUMMARY:\n${summary.trim()}`;
    }

    if (!content) {
      content = 'No summary available for this call.';
    }

    return content.trim();
  };

  // TODO: Transcript parsing for future use when transcript fetching from GCS is implemented
  // const parseTranscript = (text: string): TranscriptEntry[] => { ... };
  // const transcriptEntries = useMemo<TranscriptEntry[]>(
  //   () => (selectedCall?.transcript ? parseTranscript(selectedCall.transcript) : []),
  //   [selectedCall],
  // );

  const getCallTitle = (call: Call | null): string => {
    if (!call) return 'Untitled Call';
    if (call.title) return call.title;

    const participantIds = call.participants?.map(p => p.userId) || [];
    const participants = allUsers.filter(u => participantIds.includes(u.id));

    if (participants.length === 0) return 'Untitled Call';

    const names = participants.map(u => u.name);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2} others`;
  };

  const getCallIcon = (call: Call): React.ReactNode => {
    const isOutgoingCall = call.createdByUserId === currentUserId;
    const currentUserParticipant = call.participants?.find(p => p.userId === currentUserId);
    const hasCurrentUserJoined = currentUserParticipant?.joinedAt !== null;
    const isCallEnded = call.endedAt !== null;
    const isMissedCall = isCallEnded && !isOutgoingCall && !hasCurrentUserJoined;
    const isActive = call.endedAt === null;

    if (isActive) return <Phone size={16} className='text-status-success' />;
    if (isMissedCall) return <PhoneMissed size={16} className='text-destructive' />;
    if (isOutgoingCall) return <PhoneOutgoing size={16} className='text-muted-foreground' />;
    return <PhoneIncoming size={16} className='text-muted-foreground' />;
  };

  return (
    <div className='flex h-[600px] w-[900px] bg-card rounded-xl border border-border overflow-hidden'>
      {/* Left Panel: Call List */}
      <div className='w-[320px] border-r border-border flex flex-col bg-muted/50 shrink-0'>
        <div className='p-6 border-b border-border bg-card'>
          <h3 className='font-bold text-foreground flex items-center gap-2 text-base'>
            <FileText size={18} className='text-muted-foreground' />
            Call History
          </h3>
          <p className='text-[11px] text-muted-foreground mt-0.5'>Select a recording to preview</p>
        </div>

        <div className='flex-1 overflow-hidden p-2 custom-scrollbar'>
          {!calls || calls.length === 0 ? (
            <div className='h-full flex flex-col items-center justify-center text-muted-foreground/50 p-8 text-center'>
              <Phone size={24} className='mb-2 opacity-20' />
              <p className='text-xs italic'>No recent calls</p>
            </div>
          ) : (
            <Virtuoso
              data={calls}
              endReached={() => {
                if (hasMoreCalls) loadMoreCalls();
              }}
              rangeChanged={range => onVisibleRangeChanged(range.startIndex)}
              computeItemKey={(_, call) => call.id}
              itemContent={(_, call) => {
                const isActive = selectedCallId === call.id;
                const title = getCallTitle(call);

                return (
                  <button
                    onClick={() => setSelectedCallId(call.id)}
                    className={`w-full text-left px-4 py-3 rounded-lg transition-all border mb-1 ${
                      isActive
                        ? 'bg-card border-border shadow-sm'
                        : 'hover:bg-accent/50 border-transparent hover:border-border'
                    } group relative`}
                    data-track-category='CALLS'
                    data-track-name='SELECT_CALL_TRANSCRIPT'
                    data-track-metadata={JSON.stringify({ callId: call.id })}
                  >
                    <div className='flex justify-between items-start gap-3'>
                      <div className='flex-1 min-w-0'>
                        <div className='flex items-center gap-2 mb-0.5'>
                          {getCallIcon(call)}
                          <span
                            className={`font-semibold block truncate flex-1 text-sm ${isActive ? 'text-primary' : 'text-foreground'}`}
                          >
                            {title}
                          </span>
                        </div>
                        <div className='flex items-center gap-1.5 mt-1 text-[10px] text-muted-foreground'>
                          <Clock size={10} className='opacity-60' />
                          <span>{format(new Date(call.startedAt), 'MMM d, h:mm a')}</span>
                        </div>
                      </div>
                      {!isActive && (
                        <ChevronRight
                          size={12}
                          className='text-muted-foreground/30 group-hover:text-muted-foreground mt-1 shrink-0 transition-colors'
                        />
                      )}
                    </div>
                  </button>
                );
              }}
            />
          )}
        </div>
      </div>

      {/* Right Panel: Preview */}
      <div className='flex-1 flex flex-col bg-card relative min-w-0'>
        {!selectedCall ? (
          <div className='flex-1 flex flex-col items-center justify-center p-12 text-center'>
            <div className='w-20 h-20 bg-muted rounded-full flex items-center justify-center mb-6'>
              <FileText size={40} className='text-muted-foreground/50' />
            </div>
            <h4 className='text-lg font-bold text-foreground mb-2'>No Call Selected</h4>
            <p className='text-muted-foreground max-w-[280px] leading-relaxed text-sm'>
              Select a call from the history to preview its summary and transcription bubbles.
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className='px-8 py-6 border-b border-border flex items-center justify-between bg-card sticky top-0 z-10 w-full'>
              <div className='min-w-0 pr-6'>
                <h4 className='font-bold text-foreground text-lg truncate mb-1'>
                  {getCallTitle(selectedCall)}
                </h4>
                <div className='flex items-center gap-3 text-[11px] text-muted-foreground font-medium'>
                  <span className='flex items-center gap-1 shrink-0'>
                    <Calendar size={11} />
                    {format(new Date(selectedCall.startedAt), 'MMM d, yyyy')}
                  </span>
                  <span className='w-1 h-1 rounded-full bg-muted-foreground/30 shrink-0' />
                  <span className='shrink-0'>
                    {selectedCall.participants?.length || 0} participants
                  </span>
                </div>
              </div>
              <div className='flex items-center gap-2 shrink-0'>
                {/* Message Button */}
                <button
                  onClick={() => {
                    const content = getCallContent();
                    if (content) {
                      onSelect(content);
                      onClose();
                    }
                  }}
                  className='flex items-center gap-2 border border-border bg-card hover:bg-accent text-foreground px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95'
                  data-track-category='CALLS'
                  data-track-name='SEND_CALL_AS_MESSAGE'
                  data-track-metadata={JSON.stringify({ callId: selectedCall?.id })}
                >
                  <MessageSquare size={14} />
                  <span>Message</span>
                </button>
                {/* Attachment Button */}
                <button
                  onClick={() => {
                    if (!onAttach || !selectedCall) return;
                    const content = getCallContent();
                    const callTitle = getCallTitle(selectedCall);
                    const fileName = `call-summary-${callTitle.replace(/[^a-zA-Z0-9]/g, '-').toLowerCase()}-${format(new Date(selectedCall.startedAt), 'yyyy-MM-dd')}.txt`;
                    const blob = new Blob([content], { type: 'text/plain' });
                    const file = new File([blob], fileName, { type: 'text/plain' });
                    onAttach(file);
                    onClose();
                  }}
                  disabled={!onAttach}
                  className={`flex items-center gap-2 bg-primary hover:bg-primary/90 text-primary-foreground px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 ${!onAttach ? 'opacity-50 cursor-not-allowed' : ''}`}
                  data-track-category='CALLS'
                  data-track-name='ATTACH_CALL_SUMMARY'
                  data-track-metadata={JSON.stringify({ callId: selectedCall?.id })}
                >
                  <Paperclip size={14} />
                  <span>Attachment</span>
                </button>
              </div>
            </div>

            <div className='flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar'>
              {selectedCall.aiSummary && (
                <div className='space-y-4'>
                  <h5 className='text-[10px] font-bold uppercase tracking-widest text-muted-foreground px-1'>
                    AI Summary
                  </h5>
                  <div
                    className='bg-muted p-6 rounded-2xl border border-border/60 prose prose-sm max-w-none'
                    dangerouslySetInnerHTML={{
                      __html: DOMPurify.sanitize(selectedCall.aiSummary, {
                        ALLOWED_TAGS: ['div', 'h3', 'h4', 'p', 'ul', 'li', 'span', 'section'],
                        ALLOWED_ATTR: ['class'],
                      }),
                    }}
                  />
                </div>
              )}

              {/* Transcription section - TODO: Implement transcript fetching from GCS
              <div className='space-y-6'>
                <h5 className='text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1'>
                  Transcription
                </h5>
                <div className='flex-1 flex flex-col items-center justify-center py-12 text-center opacity-30'>
                  <FileText size={28} className='mb-2 text-slate-400' />
                  <p className='text-slate-400 text-xs italic font-medium'>
                    Transcription will be available soon
                  </p>
                </div>
              </div> */}
            </div>
          </>
        )}
      </div>
    </div>
  );
};
