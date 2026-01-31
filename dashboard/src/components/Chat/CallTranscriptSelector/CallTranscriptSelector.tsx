import React, { useState, useMemo, useEffect } from 'react';
import DOMPurify from 'dompurify';
import { queries } from '../../../zero/queries';
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
import { useCachedQuery } from '../../../hooks/useCachedQuery';

interface CallParticipant {
  userId: string;
  joinedAt: number | null;
}

interface Call {
  id: string;
  title: string | null;
  aiSummary: string | null;
  transcript: string | null;
  participants: CallParticipant[];
  createdByUserId: string;
  startedAt: number;
  endedAt: number | null;
}

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
  const [calls] = useCachedQuery(queries.userCallHistory()) as unknown as [
    Call[] | undefined,
    unknown,
  ];
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

    const participantIds = call.participants?.map((p: CallParticipant) => p.userId) || [];
    const participants = allUsers.filter(u => participantIds.includes(u.id));

    if (participants.length === 0) return 'Untitled Call';

    const names = participants.map(u => u.name);
    if (names.length <= 2) return names.join(', ');
    return `${names.slice(0, 2).join(', ')} +${names.length - 2} others`;
  };

  const getCallIcon = (call: Call): React.ReactNode => {
    const isOutgoingCall = call.createdByUserId === currentUserId;
    const currentUserParticipant = call.participants?.find(
      (p: CallParticipant) => p.userId === currentUserId,
    );
    const hasCurrentUserJoined = currentUserParticipant?.joinedAt !== null;
    const isCallEnded = call.endedAt !== null;
    const isMissedCall = isCallEnded && !isOutgoingCall && !hasCurrentUserJoined;
    const isActive = call.endedAt === null;

    if (isActive) return <Phone size={16} className='text-green-600' />;
    if (isMissedCall) return <PhoneMissed size={16} className='text-red-500' />;
    if (isOutgoingCall) return <PhoneOutgoing size={16} className='text-slate-400' />;
    return <PhoneIncoming size={16} className='text-slate-400' />;
  };

  return (
    <div className='flex h-[600px] w-[900px] bg-white rounded-xl border border-slate-200 overflow-hidden'>
      {/* Left Panel: Call List */}
      <div className='w-[320px] border-r border-slate-100 flex flex-col bg-slate-50/50 shrink-0'>
        <div className='p-6 border-b border-slate-100 bg-white'>
          <h3 className='font-bold text-slate-900 flex items-center gap-2 text-base'>
            <FileText size={18} className='text-slate-400' />
            Call History
          </h3>
          <p className='text-[11px] text-slate-400 mt-0.5'>Select a recording to preview</p>
        </div>

        <div className='flex-1 overflow-y-auto p-2 space-y-1 custom-scrollbar'>
          {!calls || calls.length === 0 ? (
            <div className='h-full flex flex-col items-center justify-center text-slate-300 p-8 text-center'>
              <Phone size={24} className='mb-2 opacity-20' />
              <p className='text-xs italic'>No recent calls</p>
            </div>
          ) : (
            calls.map(call => {
              const isActive = selectedCallId === call.id;
              const title = getCallTitle(call);

              return (
                <button
                  key={call.id}
                  onClick={() => setSelectedCallId(call.id)}
                  className={`w-full text-left px-4 py-3 rounded-lg transition-all border ${
                    isActive
                      ? 'bg-white border-slate-200 shadow-sm'
                      : 'hover:bg-white/50 border-transparent hover:border-slate-100'
                  } group relative`}
                >
                  <div className='flex justify-between items-start gap-3'>
                    <div className='flex-1 min-w-0'>
                      <div className='flex items-center gap-2 mb-0.5'>
                        {getCallIcon(call)}
                        <span
                          className={`font-semibold block truncate flex-1 text-sm ${isActive ? 'text-blue-600' : 'text-slate-700'}`}
                        >
                          {title}
                        </span>
                      </div>
                      <div className='flex items-center gap-1.5 mt-1 text-[10px] text-slate-400'>
                        <Clock size={10} className='opacity-60' />
                        <span>{format(new Date(call.startedAt), 'MMM d, h:mm a')}</span>
                      </div>
                    </div>
                    {!isActive && (
                      <ChevronRight
                        size={12}
                        className='text-slate-200 group-hover:text-slate-400 mt-1 shrink-0 transition-colors'
                      />
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </div>

      {/* Right Panel: Preview */}
      <div className='flex-1 flex flex-col bg-white relative min-w-0'>
        {!selectedCall ? (
          <div className='flex-1 flex flex-col items-center justify-center p-12 text-center'>
            <div className='w-20 h-20 bg-slate-50 rounded-full flex items-center justify-center mb-6'>
              <FileText size={40} className='text-slate-300' />
            </div>
            <h4 className='text-lg font-bold text-slate-800 mb-2'>No Call Selected</h4>
            <p className='text-slate-500 max-w-[280px] leading-relaxed text-sm'>
              Select a call from the history to preview its summary and transcription bubbles.
            </p>
          </div>
        ) : (
          <>
            {/* Header */}
            <div className='px-8 py-6 border-b border-slate-100 flex items-center justify-between bg-white sticky top-0 z-10 w-full'>
              <div className='min-w-0 pr-6'>
                <h4 className='font-bold text-slate-900 text-lg truncate mb-1'>
                  {getCallTitle(selectedCall)}
                </h4>
                <div className='flex items-center gap-3 text-[11px] text-slate-400 font-medium'>
                  <span className='flex items-center gap-1 shrink-0'>
                    <Calendar size={11} />
                    {format(new Date(selectedCall.startedAt), 'MMM d, yyyy')}
                  </span>
                  <span className='w-1 h-1 rounded-full bg-slate-200 shrink-0' />
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
                  className='flex items-center gap-2 border border-slate-200 bg-white hover:bg-slate-50 text-slate-700 px-4 py-2 rounded-lg text-sm font-medium transition-all active:scale-95'
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
                  className={`flex items-center gap-2 bg-slate-900 hover:bg-slate-800 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-all active:scale-95 ${!onAttach ? 'opacity-50 cursor-not-allowed' : ''}`}
                >
                  <Paperclip size={14} />
                  <span>Attachment</span>
                </button>
              </div>
            </div>

            <div className='flex-1 overflow-y-auto p-8 space-y-10 custom-scrollbar'>
              {selectedCall.aiSummary && (
                <div className='space-y-4'>
                  <h5 className='text-[10px] font-bold uppercase tracking-widest text-slate-400 px-1'>
                    AI Summary
                  </h5>
                  <div
                    className='bg-gradient-to-br from-slate-50 to-blue-50/30 p-6 rounded-2xl border border-slate-200/60 prose prose-sm prose-slate max-w-none'
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
