import { useCallback, useEffect, useState, type MutableRefObject } from 'react';

interface ChannelMemberOption {
  value: string;
}

interface UseChannelMemberExclusionsParams {
  channelMembersOptions: readonly ChannelMemberOption[] | null;
  editEntireSeries: boolean;
  isEditMode: boolean;
  selectedChannelId: string | null;
  selectiveEditParticipantIdsRef: MutableRefObject<Set<string> | null>;
  selectiveExclusionsInitializedRef: MutableRefObject<boolean>;
}

export function useChannelMemberExclusions({
  channelMembersOptions,
  editEntireSeries,
  isEditMode,
  selectedChannelId,
  selectiveEditParticipantIdsRef,
  selectiveExclusionsInitializedRef,
}: UseChannelMemberExclusionsParams) {
  const [excludedChannelMembers, setExcludedChannelMembers] = useState<Set<string>>(new Set());
  const [selectedChannelMembers, setSelectedChannelMembers] = useState<Array<{
    userId: string;
  }> | null>(null);

  const toggleExcludedChannelMember = useCallback(
    (userId: string, isSelectAll?: boolean, allUserIds?: string[]) => {
      setExcludedChannelMembers(prev => {
        if (allUserIds !== undefined) {
          return isSelectAll ? new Set() : new Set(allUserIds);
        }
        const next = new Set(prev);
        if (next.has(userId)) next.delete(userId);
        else next.add(userId);
        return next;
      });
    },
    [],
  );

  const allChannelMembersExcluded =
    !!channelMembersOptions &&
    channelMembersOptions.length > 0 &&
    channelMembersOptions.every(opt => excludedChannelMembers.has(opt.value.replace('user:', '')));

  useEffect(() => {
    if (channelMembersOptions) {
      setSelectedChannelMembers(
        channelMembersOptions.map(opt => ({ userId: opt.value.replace('user:', '') })),
      );
    } else {
      setSelectedChannelMembers(null);
    }
  }, [channelMembersOptions]);

  useEffect(() => {
    setExcludedChannelMembers(new Set());
  }, [selectedChannelId]);

  useEffect(() => {
    if (
      !isEditMode ||
      selectiveExclusionsInitializedRef.current ||
      !channelMembersOptions ||
      !selectiveEditParticipantIdsRef.current
    ) {
      return;
    }

    const originalIds = selectiveEditParticipantIdsRef.current;
    const excluded = new Set(
      channelMembersOptions
        .map(opt => opt.value.replace('user:', ''))
        .filter(id => !originalIds.has(id)),
    );
    setExcludedChannelMembers(excluded);
    selectiveExclusionsInitializedRef.current = true;
  }, [
    channelMembersOptions,
    editEntireSeries,
    isEditMode,
    selectiveEditParticipantIdsRef,
    selectiveExclusionsInitializedRef,
  ]);

  return {
    allChannelMembersExcluded,
    excludedChannelMembers,
    selectedChannelMembers,
    toggleExcludedChannelMember,
  };
}
