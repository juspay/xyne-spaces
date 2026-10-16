/**
 * Results open on top of the search screen rather than replacing it, so going back
 * returns to the same query and scroll position.
 */

import { useCallback } from 'react';
import { Alert, Keyboard } from 'react-native';
import { useRouter } from 'expo-router';
import { useSelector } from '@xstate/react';

import { useAuth } from '@/src/contexts/AuthContext';
import { stateMachineActor } from '@/src/machines/appStateMachine';
import { ChannelService } from '@/src/services/ChannelService';
import type { DisplaySearchResult } from '@/src/types/search';
import { findOneToOneDmChannel } from '@/src/utils/channel-utils';
import { navigateToGlobalSearchResult } from '@/src/utils/globalSearchNavigation';
import { openBaseChatRoute } from '@/src/utils/openChatRoute';
import type { SearchChannelItem, SearchGroupDmItem, SearchPersonItem } from '../types';

const channelService = new ChannelService();

function selectVisibleChannels(state: { context: { visibleChannels: unknown[] } }): unknown[] {
  return state.context.visibleChannels;
}

export type SearchNavigation = {
  openResult: (result: DisplaySearchResult) => void;
  openPerson: (item: SearchPersonItem) => void;
  openGroupDm: (item: SearchGroupDmItem) => void;
  openChannel: (item: SearchChannelItem) => void;
};

/** `onLeave` blurs the search field before anything is pushed on top of it. */
export function useSearchNavigation(onLeave: () => void): SearchNavigation {
  const { user } = useAuth();
  const currentUserId = user?.user_id ?? '';
  const router = useRouter();
  const visibleChannels = useSelector(stateMachineActor, selectVisibleChannels);

  const leaveSearch = useCallback(
    (navigate: () => void) => {
      onLeave();
      Keyboard.dismiss();
      navigate();
    },
    [onLeave],
  );

  const openResult = useCallback(
    (result: DisplaySearchResult) => {
      if (result.type === 'attachment') {
        Alert.alert('Downloading will be implemented soon.');
        return;
      }

      leaveSearch(() => {
        void navigateToGlobalSearchResult(result).then(success => {
          if (!success) {
            Alert.alert('Unable to open result', 'Some context is missing for this item.');
          }
        });
      });
    },
    [leaveSearch],
  );

  const openPerson = useCallback(
    (item: SearchPersonItem) => {
      if (!currentUserId) return;

      const existing = findOneToOneDmChannel(visibleChannels as never, currentUserId, item.id);
      if (existing?.id) {
        leaveSearch(() => openBaseChatRoute(router, existing.id, { surface: 'dms' }));
        return;
      }

      // Creating a DM is a network round trip, and a second tap during it would create
      // a second DM. `openBaseChatRoute` guards duplicates only once it has an id.
      if (pendingDmFor === item.id) return;
      pendingDmFor = item.id;

      void channelService
        .createDm({ participantIds: [item.id] })
        .then(dm => {
          leaveSearch(() => openBaseChatRoute(router, dm.id, { surface: 'dms' }));
        })
        .catch(() => {
          Alert.alert('Unable to start chat', 'Could not create a direct message right now.');
        })
        .finally(() => {
          if (pendingDmFor === item.id) pendingDmFor = null;
        });
    },
    [currentUserId, leaveSearch, router, visibleChannels],
  );

  const openGroupDm = useCallback(
    (item: SearchGroupDmItem) => {
      leaveSearch(() => openBaseChatRoute(router, item.id, { surface: 'dms' }));
    },
    [leaveSearch, router],
  );

  const openChannel = useCallback(
    (item: SearchChannelItem) => {
      leaveSearch(() => openBaseChatRoute(router, item.id, { surface: 'channels' }));
    },
    [leaveSearch, router],
  );

  return { openResult, openPerson, openGroupDm, openChannel };
}

/** Module scope: a remount must not clear an in-flight DM creation. */
let pendingDmFor: string | null = null;
