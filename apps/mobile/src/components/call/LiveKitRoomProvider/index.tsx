/**
 * LiveKitRoomProvider
 *
 * A wrapper component that provides LiveKit room context using an existing Room object.
 * This allows components to use LiveKit hooks (useTracks, useIsSpeaking, etc.)
 * without creating a new connection.
 *
 * IMPORTANT: We use RoomContext.Provider directly instead of LiveKitRoom component
 * because LiveKitRoom's internal useLiveKitRoom hook has a cleanup effect that
 * automatically disconnects the room on unmount or when the room reference changes.
 * This caused immediate disconnection of pre-connected rooms.
 *
 * By using RoomContext.Provider directly, we provide the room context without
 * any lifecycle management - the room connection is managed externally by
 * CallRuntimeNativeService.
 */
import React from 'react';
import type { Room } from 'livekit-client';
import { RoomContext } from '@livekit/react-native';

// Re-export LiveKit's hooks for convenience
export {
  useTracks,
  useLocalParticipant,
  useRoomContext,
  useIsSpeaking,
  useIsMuted,
  useParticipantInfo,
  useVisualStableUpdate,
  useTrackMutedIndicator,
  VideoTrack,
  isTrackReference,
  type TrackReferenceOrPlaceholder,
} from '@livekit/react-native';

interface LiveKitRoomProviderProps {
  /**
   * An already connected Room object from CallRuntimeNativeService
   */
  room: Room | null;
  /**
   * Children components that will have access to the room context
   */
  children: React.ReactNode;
}

/**
 * Provides LiveKit room context to children components.
 * Use this when you have an existing Room connection (from CallRuntimeNativeService)
 * and want to use LiveKit's hooks (useTracks, useIsSpeaking, etc.)
 *
 * This uses RoomContext.Provider directly instead of LiveKitRoom component
 * to avoid the automatic disconnect behavior in useLiveKitRoom hook.
 * The room lifecycle is managed externally by CallRuntimeNativeService.
 */
export function LiveKitRoomProvider({
  room,
  children,
}: LiveKitRoomProviderProps): React.ReactElement | null {
  if (!room) {
    // Return children without context - hooks won't work but won't crash
    return <>{children}</>;
  }

  // Use RoomContext.Provider directly to avoid LiveKitRoom's
  // automatic disconnect on unmount/room change
  return <RoomContext.Provider value={room}>{children}</RoomContext.Provider>;
}
