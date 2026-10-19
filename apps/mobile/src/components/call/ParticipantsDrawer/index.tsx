import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { View, Text, TouchableOpacity, useWindowDimensions } from 'react-native';
import BottomSheet, {
  BottomSheetScrollView,
  type BottomSheetBackdropProps,
} from '@gorhom/bottom-sheet';
import { useRawSafeAreaInsets } from '@/src/hooks/useRawSafeAreaInsets';
import { Check, ChevronDown, ChevronUp, Mic, MicOff, UserPlus, X } from 'lucide-react-native';
import { useCachedQuery } from '@/src/hooks/useCachedQuery';
import { useAllChannels } from '@/src/hooks/useChannels';
import { useUsers } from '@/src/hooks/useUsers';
import { useZero } from '@/src/hooks/useZero';
import { queries } from '@/src/zero/queries';
import { mutators } from '@/src/zero/mutators';
import { callService } from '@/src/services/Call/callService';
import { InvitationResponse } from '@xyne/shared';
import { getInvitedRowLabel, isBroadcastChannelCall, toRingStatus } from '../callRoster.utils';
import { getAvatarColors } from '../callStage.utils';
import { CallSheetBackdrop } from '../CallSheetBackdrop';
import { callColors } from '../callTheme';
import { s } from './styles';
import Avatar from '../../ui/avatar';
import { getInitials } from '../../ui/avatar/avatar.utils';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SimpleParticipant {
  identity: string;
  name?: string;
  isMicrophoneEnabled: boolean;
  isCameraEnabled: boolean;
  metadata?: string;
}

interface ZeroParticipant {
  id: string;
  callId: string;
  userId: string;
  invitedBy: string;
  invitedAt: number;
  response: string | null;
  respondedAt: number | null;
  joinedAt: number | null;
  leftAt: number | null;
  metadata: unknown;
  displayName?: string | null;
  isExternal?: boolean;
  /** CALLING | RINGING | BUSY — only present on newer @xyne/shared pins. */
  ringStatus?: string | null;
}

interface ParticipantsDrawerProps {
  isVisible: boolean;
  onClose: () => void;
  /** The call's externalId — used to look up the call in Zero */
  externalCallId: string;
  isHost: boolean;
  /** LiveKit participants (source of truth for mic/camera state) */
  livekitParticipants: SimpleParticipant[];
  localParticipantIdentity?: string | undefined;
  /** Opens the InviteUserDrawer */
  onAddPeople: () => void;
}

// ─── Section header ───────────────────────────────────────────────────────────

const SectionHeader = ({
  title,
  count,
  isExpanded,
  onToggle,
}: {
  title: string;
  count: number;
  isExpanded: boolean;
  onToggle: () => void;
}) => (
  <TouchableOpacity onPress={onToggle} style={s.sectionHeader} activeOpacity={0.7}>
    <Text style={s.sectionTitle}>{title}</Text>
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
      <Text style={s.sectionCount}>{count}</Text>
      {isExpanded ? (
        <ChevronUp size={14} color='rgba(255,255,255,0.45)' />
      ) : (
        <ChevronDown size={14} color='rgba(255,255,255,0.45)' />
      )}
    </View>
  </TouchableOpacity>
);

// ─── Main component ───────────────────────────────────────────────────────────

export function ParticipantsDrawer({
  isVisible,
  onClose,
  externalCallId,
  isHost,
  livekitParticipants,
  localParticipantIdentity,
  onAddPeople,
}: ParticipantsDrawerProps): React.ReactElement {
  const insets = useRawSafeAreaInsets();
  const sheetRef = useRef<BottomSheet>(null);
  const { height: screenHeight } = useWindowDimensions();
  const maxSheetHeight = screenHeight * 0.85;

  const zero = useZero();
  const allUsers = useUsers();

  const [isMutingAll, setIsMutingAll] = useState(false);
  const [mutingId, setMutingId] = useState<string | null>(null);
  const [approvingId, setApprovingId] = useState<string | null>(null);
  const [rejectingId, setRejectingId] = useState<string | null>(null);
  const [isAttendeesExpanded, setIsAttendeesExpanded] = useState(true);
  const [isAlsoInvitedExpanded, setIsAlsoInvitedExpanded] = useState(true);
  const [isRequestedExpanded, setIsRequestedExpanded] = useState(true);

  // ── Zero data ──────────────────────────────────────────────────────────────
  const [activeCalls] = useCachedQuery(queries.userActiveCalls());

  const currentCall = useMemo(
    () => activeCalls?.find(c => c.externalId === externalCallId),
    [activeCalls, externalCallId],
  );

  // Channel broadcast calls never ring anyone, so their invitees read "Invited" (dashboard rule).
  const allChannels = useAllChannels();
  const isBroadcastCall = useMemo(() => {
    const call = currentCall as
      { channelId?: string | null; callOrigin?: string | null } | undefined;
    const channel = call?.channelId ? allChannels.find(c => c.id === call.channelId) : undefined;
    return isBroadcastChannelCall(channel?.scopeType, call?.callOrigin);
  }, [allChannels, currentCall]);

  const internalCallId = (currentCall as unknown as { id?: string } | undefined)?.id;
  const callParticipants = useMemo(
    () => (currentCall?.participants as unknown as ZeroParticipant[] | undefined) ?? [],
    [currentCall],
  );

  // ── LiveKit lookup map (mic / camera state) ────────────────────────────────
  const livekitMap = useMemo(() => {
    const m = new Map<string, SimpleParticipant>();
    for (const p of livekitParticipants) m.set(p.identity, p);
    return m;
  }, [livekitParticipants]);

  // ── User lookup map ────────────────────────────────────────────────────────
  const usersMap = useMemo(() => {
    const m = new Map<string, (typeof allUsers)[number]>();
    for (const u of allUsers) m.set(u.id, u);
    return m;
  }, [allUsers]);

  // ── Partition into sections ────────────────────────────────────────────────
  const { attendees, alsoInvited, requested } = useMemo(() => {
    const attendees: ZeroParticipant[] = [];
    const alsoInvited: ZeroParticipant[] = [];
    const requested: ZeroParticipant[] = [];

    for (const p of callParticipants) {
      if (p.response === InvitationResponse.REQUESTED || p.response === 'REQUESTED') {
        requested.push(p);
      } else if (p.response === InvitationResponse.ACCEPTED || p.response === 'ACCEPTED') {
        attendees.push(p);
      } else {
        alsoInvited.push(p);
      }
    }
    return { attendees, alsoInvited, requested };
  }, [callParticipants]);

  // ── Sheet open/close ───────────────────────────────────────────────────────
  useEffect(() => {
    if (isVisible) {
      sheetRef.current?.expand();
    } else {
      sheetRef.current?.close();
    }
  }, [isVisible]);

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <CallSheetBackdrop {...props} isOpen={isVisible} onPress={onClose} />
    ),
    [isVisible, onClose],
  );

  const handleSheetChange = useCallback(
    (index: number) => {
      if (index === -1) onClose();
    },
    [onClose],
  );

  // ── Host actions ───────────────────────────────────────────────────────────
  const handleMuteAll = useCallback(async () => {
    if (!externalCallId || isMutingAll) return;
    setIsMutingAll(true);
    try {
      await callService.muteAllParticipants(externalCallId);
    } catch {
      // silently fail
    } finally {
      setIsMutingAll(false);
    }
  }, [externalCallId, isMutingAll]);

  const handleMuteParticipant = useCallback(
    async (userId: string) => {
      if (!externalCallId || mutingId) return;
      setMutingId(userId);
      try {
        await callService.muteParticipant(externalCallId, userId);
      } catch {
        // silently fail
      } finally {
        setMutingId(null);
      }
    },
    [externalCallId, mutingId],
  );

  const handleApprove = useCallback(
    async (participantId: string) => {
      if (!internalCallId || approvingId) return;
      setApprovingId(participantId);
      try {
        await zero.mutate(
          mutators.calls.approveLobbyRequest({ callId: internalCallId, participantId }),
        );
      } catch {
        // silently fail
      } finally {
        setApprovingId(null);
      }
    },
    [zero, internalCallId, approvingId],
  );

  const handleReject = useCallback(
    async (participantId: string) => {
      if (!internalCallId || rejectingId) return;
      setRejectingId(participantId);
      try {
        await zero.mutate(
          mutators.calls.rejectLobbyRequest({ callId: internalCallId, participantId }),
        );
      } catch {
        // silently fail
      } finally {
        setRejectingId(null);
      }
    },
    [zero, internalCallId, rejectingId],
  );

  // ── Participant row renderer ───────────────────────────────────────────────
  const renderParticipant = (participant: ZeroParticipant, showMuteButton: boolean) => {
    const { userId, response, displayName, isExternal } = participant;
    const isLocal = localParticipantIdentity !== undefined && userId === localParticipantIdentity;
    const lkParticipant = livekitMap.get(userId);
    const isMicEnabled = lkParticipant?.isMicrophoneEnabled ?? true;
    const isInCall = response === InvitationResponse.ACCEPTED || response === 'ACCEPTED';
    const isMutingThis = mutingId === userId;
    const canMute =
      isHost && showMuteButton && isInCall && !isLocal && !userId.startsWith('agent-');

    const user = usersMap.get(userId);
    const resolvedName: string =
      displayName || (isExternal ? 'Guest' : user?.name || user?.email || 'Unknown');

    return (
      <View key={participant.id} style={s.row}>
        {/* Avatar */}
        <View style={s.avatarWrap}>
          <Avatar userIds={[userId]} size={s.avatarImg.width} />
          {isInCall && (
            <View
              style={{
                position: 'absolute',
                bottom: 0,
                right: 0,
                width: 12,
                height: 12,
                borderRadius: 6,
                backgroundColor: '#22C55E',
                borderWidth: 1.5,
                borderColor: callColors.surface,
              }}
            />
          )}
          {isInCall && !isMicEnabled && (
            <View style={s.mutedBadge}>
              <MicOff size={9} color={callColors.onColor} strokeWidth={2.5} />
            </View>
          )}
        </View>

        {/* Name + status */}
        <View style={{ flex: 1, minWidth: 0 }}>
          <View style={s.nameRow}>
            <Text style={s.name} numberOfLines={1}>
              {resolvedName}
            </Text>
            {isExternal && (
              <View style={s.externalBadge}>
                <Text style={s.externalBadgeText}>External</Text>
              </View>
            )}
            {isLocal && (
              <View style={s.youPill}>
                <Text style={s.youPillText}>You</Text>
              </View>
            )}
          </View>
          {response === InvitationResponse.LEFT && <Text style={s.statusLeft}>Left the call</Text>}
          {(response === InvitationResponse.INVITED || response === 'INVITED') && (
            // Same wording as the dashboard's People panel: Invited / Calling… / Ringing… / On another call.
            <Text
              style={
                toRingStatus(participant.ringStatus) === 'busy' && !isExternal && !isBroadcastCall
                  ? s.statusInvited
                  : s.statusMuted
              }
            >
              {getInvitedRowLabel({
                isExternal: !!isExternal,
                isBroadcastChannelCall: isBroadcastCall,
                ringStatus: participant.ringStatus,
              })}
            </Text>
          )}
          {(response === InvitationResponse.MISSED || response === 'MISSED') && (
            <Text style={s.statusMuted}>No answer</Text>
          )}
          {(response === InvitationResponse.DECLINED || response === 'DECLINED') && (
            <Text style={s.statusDeclined}>Declined</Text>
          )}
        </View>

        {/* Mute button (host only, non-self attendees) */}
        {canMute && (
          <TouchableOpacity
            onPress={() => void handleMuteParticipant(userId)}
            disabled={isMutingThis || !isMicEnabled}
            style={[s.muteBtn, !isMicEnabled && s.muteBtnMuted]}
            activeOpacity={0.7}
          >
            {isMutingThis ? (
              <MicOff size={15} color='rgba(255,255,255,0.4)' />
            ) : !isMicEnabled ? (
              <MicOff size={15} color='#FF453A' />
            ) : (
              <Mic size={15} color='rgba(255,255,255,0.7)' />
            )}
          </TouchableOpacity>
        )}

        {/* Muted indicator (non-host, non-self) */}
        {isInCall && !isMicEnabled && !canMute && !isLocal && <MicOff size={15} color='#FF453A' />}
      </View>
    );
  };

  // ── Total count for subtitle ───────────────────────────────────────────────
  const totalCount = callParticipants.length || livekitParticipants.length;

  return (
    <BottomSheet
      ref={sheetRef}
      index={-1}
      enableDynamicSizing
      maxDynamicContentSize={maxSheetHeight}
      enablePanDownToClose
      onChange={handleSheetChange}
      backdropComponent={renderBackdrop}
      backgroundStyle={s.sheetBackground}
      handleIndicatorStyle={s.handleIndicator}
      topInset={insets.top}
    >
      {/* Scroll view must be the sheet's direct child: wrapping it in BottomSheetView sizes the
          sheet to the full list height, leaving the list unbounded and unable to scroll. */}
      <BottomSheetScrollView
        style={s.list}
        contentContainerStyle={[s.listContent, { paddingBottom: Math.max(insets.bottom + 8, 24) }]}
        showsVerticalScrollIndicator={false}
        stickyHeaderIndices={[0]}
      >
        {/* ── Sticky Header ── */}
        <View style={s.stickyHeader}>
          <View style={s.sheetContent}>
            <View style={s.header}>
              <View style={s.headerLeft}>
                <View>
                  <Text style={s.title}>Participants</Text>
                  <Text style={s.subtitle}>
                    {totalCount} {totalCount === 1 ? 'person' : 'people'}
                  </Text>
                </View>
              </View>
              <View style={s.headerActions}>
                {/* Mute All (host, 2+ attendees) */}
                {isHost && attendees.length > 1 && (
                  <TouchableOpacity
                    onPress={() => void handleMuteAll()}
                    disabled={isMutingAll}
                    style={[s.muteAllBtn, { opacity: isMutingAll ? 0.5 : 1 }]}
                    activeOpacity={0.7}
                  >
                    <MicOff size={13} color='rgba(255,255,255,0.85)' />
                    <Text style={s.muteAllBtnText}>{isMutingAll ? 'Muting…' : 'Mute All'}</Text>
                  </TouchableOpacity>
                )}
                {/* Add People */}
                <TouchableOpacity
                  onPress={() => {
                    onClose();
                    onAddPeople();
                  }}
                  style={s.addPeopleBtn}
                  activeOpacity={0.7}
                >
                  <UserPlus size={13} color='rgba(255,255,255,0.85)' />
                  <Text style={s.addPeopleBtnText}>Add</Text>
                </TouchableOpacity>
                {/* Close */}
                <TouchableOpacity onPress={onClose} style={s.closeBtn} activeOpacity={0.65}>
                  <Text style={s.closeBtnX}>✕</Text>
                </TouchableOpacity>
              </View>
            </View>
            <View style={s.divider} />
          </View>
        </View>

        {/* ── Requested Section (host only) ── */}
        {isHost && requested.length > 0 && (
          <View style={[s.sectionContainer, s.sectionContainerRequested]}>
            <SectionHeader
              title='Requested'
              count={requested.length}
              isExpanded={isRequestedExpanded}
              onToggle={() => setIsRequestedExpanded(v => !v)}
            />
            {isRequestedExpanded && (
              <>
                <View style={[s.sectionDivider, s.sectionDividerRequested]} />
                {requested.map(participant => (
                  <View key={participant.id} style={s.requestedRow}>
                    <View style={s.requestedAvatar}>
                      <Text style={s.requestedAvatarText}>
                        {(participant.displayName || 'G').charAt(0).toUpperCase()}
                      </Text>
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={s.nameRow}>
                        <Text style={s.name} numberOfLines={1}>
                          {participant.displayName || 'Guest'}
                        </Text>
                        {participant.isExternal && (
                          <View style={s.externalBadge}>
                            <Text style={s.externalBadgeText}>External</Text>
                          </View>
                        )}
                      </View>
                      <Text style={s.statusRequesting}>Requesting to join</Text>
                    </View>
                    <View style={s.lobbyActions}>
                      <TouchableOpacity
                        onPress={() => void handleApprove(participant.id)}
                        disabled={approvingId === participant.id}
                        style={[
                          s.approveBtn,
                          { opacity: approvingId === participant.id ? 0.5 : 1 },
                        ]}
                        activeOpacity={0.7}
                      >
                        <Check size={14} color={callColors.onColor} strokeWidth={2.5} />
                      </TouchableOpacity>
                      <TouchableOpacity
                        onPress={() => void handleReject(participant.id)}
                        disabled={rejectingId === participant.id}
                        style={[s.rejectBtn, { opacity: rejectingId === participant.id ? 0.5 : 1 }]}
                        activeOpacity={0.7}
                      >
                        <X size={14} color='rgba(255,255,255,0.7)' strokeWidth={2.5} />
                      </TouchableOpacity>
                    </View>
                  </View>
                ))}
              </>
            )}
          </View>
        )}

        {/* ── Attendees Section ── */}
        {attendees.length > 0 && (
          <View style={s.sectionContainer}>
            <SectionHeader
              title='Attendees'
              count={attendees.length}
              isExpanded={isAttendeesExpanded}
              onToggle={() => setIsAttendeesExpanded(v => !v)}
            />
            {isAttendeesExpanded && (
              <>
                <View style={s.sectionDivider} />
                {attendees.map(p => renderParticipant(p, true))}
              </>
            )}
          </View>
        )}

        {/* ── Also Invited Section ── */}
        {alsoInvited.length > 0 && (
          <View style={s.sectionContainer}>
            <SectionHeader
              title='Also Invited'
              count={alsoInvited.length}
              isExpanded={isAlsoInvitedExpanded}
              onToggle={() => setIsAlsoInvitedExpanded(v => !v)}
            />
            {isAlsoInvitedExpanded && (
              <>
                <View style={s.sectionDivider} />
                {alsoInvited.map(p => renderParticipant(p, false))}
              </>
            )}
          </View>
        )}

        {/* ── Fallback: LiveKit-only view (Zero data not yet loaded) ── */}
        {callParticipants.length === 0 && livekitParticipants.length > 0 && (
          <View style={s.sectionContainer}>
            <View style={s.sectionHeader}>
              <Text style={s.sectionTitle}>In Call</Text>
              <Text style={s.sectionCount}>{livekitParticipants.length}</Text>
            </View>
            <View style={s.sectionDivider} />
            {[...livekitParticipants]
              .sort((a, b) => {
                const aIsLocal = a.identity === localParticipantIdentity;
                const bIsLocal = b.identity === localParticipantIdentity;
                if (aIsLocal && !bIsLocal) return -1;
                if (!aIsLocal && bIsLocal) return 1;
                return (a.name || a.identity).localeCompare(b.name || b.identity);
              })
              .map(p => {
                const displayName = p.name || p.identity || 'Unknown';
                const isLocal = p.identity === localParticipantIdentity;
                const isMuted = !p.isMicrophoneEnabled;
                return (
                  <View key={p.identity} style={s.row}>
                    <View style={s.avatarWrap}>
                      <View
                        style={[
                          s.avatarFallback,
                          { backgroundColor: getAvatarColors(p.identity).avatar },
                        ]}
                      >
                        <Text style={s.avatarInitials}>{getInitials(displayName)}</Text>
                      </View>
                      {isMuted && (
                        <View style={s.mutedBadge}>
                          <MicOff size={9} color={callColors.onColor} strokeWidth={2.5} />
                        </View>
                      )}
                    </View>
                    <View style={{ flex: 1, minWidth: 0 }}>
                      <View style={s.nameRow}>
                        <Text style={s.name} numberOfLines={1}>
                          {displayName}
                        </Text>
                        {isLocal && (
                          <View style={s.youPill}>
                            <Text style={s.youPillText}>You</Text>
                          </View>
                        )}
                      </View>
                    </View>
                  </View>
                );
              })}
          </View>
        )}

        {/* ── Empty state ── */}
        {callParticipants.length === 0 && livekitParticipants.length === 0 && (
          <View style={{ alignItems: 'center', justifyContent: 'center', paddingVertical: 48 }}>
            <Text style={s.subtitle}>No participants yet</Text>
          </View>
        )}
      </BottomSheetScrollView>
    </BottomSheet>
  );
}
