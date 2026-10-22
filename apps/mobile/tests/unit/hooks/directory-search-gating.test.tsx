import { expect, it, jest } from '@jest/globals';
import { renderHook } from '@testing-library/react-native';
import {
  useChannelsSearch,
  usePeopleSearch,
} from '@/src/features/global-search/hooks/use-directory-search';
import {
  createNameSearch,
  createPeopleSearch,
} from '@/src/features/global-search/utils/directory-search';

import { useHydrateWorkspaceChannels } from '@/src/hooks/useHydrateWorkspaceChannels';

const mockEmpty: never[] = [];
jest.mock('@/src/hooks/useHydrateWorkspaceChannels', () => ({
  useHydrateWorkspaceChannels: jest.fn(),
}));
jest.mock('@xstate/react', () => ({
  useSelector: (_actor: unknown, selector: (state: unknown) => unknown) =>
    selector({ context: { visibleChannels: mockEmpty, userChannelStatuses: mockEmpty } }),
}));
jest.mock('@xyne/shared', () => ({ ChannelType: {}, ChannelScopeType: {}, ChannelVisibility: {} }));
jest.mock('@/src/contexts/AuthContext', () => ({ useAuth: () => ({ user: { user_id: 'self' } }) }));
jest.mock('@/src/hooks/useChannels', () => ({ useAllChannels: () => mockEmpty }));
jest.mock('@/src/hooks/useUsers', () => ({ useUsers: () => mockEmpty }));
jest.mock('@/src/machines/appStateMachine', () => ({ stateMachineActor: {} }));
jest.mock('@/src/utils/statusUtils', () => ({
  getActiveUserStatusEmoji: () => null,
  isUserDeactivated: () => false,
}));
jest.mock('@/src/features/global-search/utils/directory-search', () => ({
  createNameSearch: jest.fn(() => () => []),
  createPeopleSearch: jest.fn(() => jest.fn(() => [])),
}));
it('does not build search indexes while disabled and can activate without changing hook order', () => {
  const { result, rerender } = renderHook(
    ({ query }: { query: string | null }) => ({
      channels: useChannelsSearch(query),
      people: usePeopleSearch(query),
    }),
    { initialProps: { query: null as string | null } },
  );
  expect(useHydrateWorkspaceChannels).toHaveBeenLastCalledWith(false);
  expect(result.current).toEqual({ channels: [], people: [] });
  expect(createNameSearch).not.toHaveBeenCalled();
  expect(createPeopleSearch).not.toHaveBeenCalled();
  rerender({ query: 'test' });
  expect(useHydrateWorkspaceChannels).toHaveBeenLastCalledWith(true);
  expect(createNameSearch).toHaveBeenCalledTimes(1);
  expect(createPeopleSearch).toHaveBeenCalledTimes(1);
  renderHook(() => usePeopleSearch('test', 9));
  expect(jest.mocked(createPeopleSearch).mock.results[0]?.value).toHaveBeenCalledWith('test', 9);
  rerender({ query: null });
  expect(useHydrateWorkspaceChannels).toHaveBeenLastCalledWith(false);
  expect(result.current).toEqual({ channels: [], people: [] });
  expect(createNameSearch).toHaveBeenCalledTimes(1);
  expect(createPeopleSearch).toHaveBeenCalledTimes(1);
});

it('preserves numeric result limits for search consumers', () => {
  const searchChannels = jest.fn(() => []);
  jest.mocked(createNameSearch).mockReturnValueOnce(searchChannels);
  renderHook(() => useChannelsSearch('test', 7));
  expect(searchChannels).toHaveBeenCalledWith('test', 7);
});
