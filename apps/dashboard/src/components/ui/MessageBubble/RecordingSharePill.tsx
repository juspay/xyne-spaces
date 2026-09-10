import React from 'react';
import { AudioLines } from 'lucide-react';
import { EntitySharePill } from './EntitySharePill';

interface RecordingSharePillProps {
  title: string;
  durationMs: number | null;
  onOpen?: (() => void) | undefined;
}

/** Recordings binding for {@link EntitySharePill}. */
export const RecordingSharePill: React.FC<RecordingSharePillProps> = ({
  title,
  durationMs,
  onOpen,
}) => (
  <EntitySharePill
    title={title}
    durationMs={durationMs}
    icon={<AudioLines size={14} strokeWidth={2.5} />}
    ariaLabel={`Open recording ${title}`}
    onOpen={onOpen}
    trackName='OPEN_SHARED_RECORDING'
  />
);
