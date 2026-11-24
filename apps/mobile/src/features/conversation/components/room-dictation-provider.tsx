import type { ReactElement, ReactNode } from 'react';

import {
  RoomDictationControlsContext,
  RoomDictationStatusContext,
  useRoomDictation,
} from '../hooks/use-room-dictation';

/**
 * Owns the bar's dictation. Transcript updates re-render only this provider;
 * `children` keeps its identity, so only status readers update.
 */
export function RoomDictationProvider({ children }: { children: ReactNode }): ReactElement {
  const { status, controls } = useRoomDictation();
  return (
    <RoomDictationControlsContext.Provider value={controls}>
      <RoomDictationStatusContext.Provider value={status}>
        {children}
      </RoomDictationStatusContext.Provider>
    </RoomDictationControlsContext.Provider>
  );
}
