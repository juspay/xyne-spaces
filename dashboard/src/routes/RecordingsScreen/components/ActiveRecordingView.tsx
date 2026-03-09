/**
 * ActiveRecordingView - Live recording panel with streaming transcripts
 * Shown inside RecordingsScreen when a recording is in progress.
 * Mirrors the native recording view: header with time + status, scrollable transcript area.
 */

import { ReactElement, useEffect, useRef, useMemo } from 'react';
import { Mic, User } from 'lucide-react';
import { TranscriptEntry } from '../../../stores/recordingStore';
import {
  formatTime12Hour,
  formatTimestamp,
  getSpeakerColor,
  getInitials,
} from '../../../utils/recordingUtils';

interface ActiveRecordingViewProps {
  transcripts: TranscriptEntry[];
  startTime: number | null;
  isPaused: boolean;
}

// Re-export utility functions for local use
const formatTime = formatTime12Hour;

interface GroupedTranscript {
  speaker: string;
  entries: TranscriptEntry[];
}

export function ActiveRecordingView({
  transcripts,
  startTime,
  isPaused,
}: ActiveRecordingViewProps): ReactElement {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom when new transcripts arrive
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [transcripts]);

  // Group consecutive messages from the same speaker
  const groupedTranscripts = useMemo<GroupedTranscript[]>(() => {
    const groups: GroupedTranscript[] = [];
    let currentGroup: GroupedTranscript | null = null;

    for (const entry of transcripts) {
      if (!currentGroup || currentGroup.speaker !== entry.speaker) {
        currentGroup = { speaker: entry.speaker, entries: [entry] };
        groups.push(currentGroup);
      } else {
        currentGroup.entries.push(entry);
      }
    }

    return groups;
  }, [transcripts]);

  return (
    <div className='flex flex-col h-full'>
      {/* Recording Header */}
      <div className='px-6 py-4 border-b border-input dark:border-gray-700'>
        <div className='flex items-center gap-3'>
          <div className='w-10 h-10 rounded-full bg-red-50 dark:bg-red-900/20 flex items-center justify-center'>
            <Mic className='w-5 h-5 text-red-500' />
          </div>
          <div>
            <h2 className='text-lg font-semibold text-foreground dark:text-gray-100'>
              Note Taker Recording
            </h2>
            <div className='flex items-center gap-2 text-sm text-muted-foreground dark:text-muted-foreground'>
              {startTime && <span>{formatTime(startTime)}</span>}
              <span className='w-1 h-1 rounded-full bg-gray-400' />
              <span className='flex items-center gap-1.5'>
                {isPaused ? (
                  <>
                    <span className='w-2 h-2 rounded-full bg-yellow-500' />
                    Paused
                  </>
                ) : (
                  <>
                    <span className='w-2 h-2 rounded-full bg-red-500 animate-pulse' />
                    Recording...
                  </>
                )}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Transcript Area */}
      <div ref={scrollRef} className='flex-1 overflow-auto px-6 py-6'>
        {transcripts.length > 0 ? (
          <div className='space-y-6'>
            {groupedTranscripts.map((group, groupIndex) => {
              const colorClass = getSpeakerColor(group.speaker);
              return (
                <div key={groupIndex} className='flex gap-3'>
                  {/* Avatar */}
                  <div className='flex-shrink-0'>
                    <div
                      className={`w-9 h-9 rounded-full flex items-center justify-center text-xs font-semibold border ${colorClass}`}
                    >
                      {group.speaker !== 'Unknown' ? (
                        getInitials(group.speaker)
                      ) : (
                        <User className='w-4 h-4' />
                      )}
                    </div>
                  </div>

                  {/* Message Bubble */}
                  <div className='flex-1 min-w-0'>
                    {/* Speaker Name & Time */}
                    <div className='flex items-center gap-2 mb-1.5'>
                      <span className='text-sm font-semibold text-foreground dark:text-gray-100'>
                        {group.speaker}
                      </span>
                      <span className='text-xs text-muted-foreground dark:text-muted-foreground'>
                        {group.entries[0] && formatTimestamp(group.entries[0].timestamp)}
                      </span>
                    </div>

                    {/* Messages */}
                    <div className='space-y-2'>
                      {group.entries.map(entry => (
                        <div
                          key={entry.id}
                          className='text-[15px] text-foreground dark:text-gray-200 leading-relaxed'
                        >
                          {entry.text}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <div className='flex items-center justify-center h-full'>
            <div className='text-center'>
              <div className='flex items-center justify-center gap-1 mb-3'>
                {[0, 1, 2, 3, 4].map(i => (
                  <div
                    key={i}
                    className='w-1 rounded-full bg-muted-foreground/50 dark:bg-gray-600'
                    style={{
                      animation: `listeningPulse 1s ease-in-out ${i * 0.15}s infinite alternate`,
                      height: '16px',
                    }}
                  />
                ))}
              </div>
              <p className='text-sm text-muted-foreground dark:text-muted-foreground'>
                Listening... Start speaking and your words will appear here.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Listening pulse keyframes */}
      <style>{`
        @keyframes listeningPulse {
          from { height: 8px; opacity: 0.4; }
          to { height: 24px; opacity: 1; }
        }
      `}</style>
    </div>
  );
}
