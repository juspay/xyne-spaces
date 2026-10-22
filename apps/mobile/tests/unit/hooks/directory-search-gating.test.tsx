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

const mockEmpty: never[] = [];
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
  createPeopleSearch: jest.fn(() => () => []),
}));
it('does not build search indexes while disabled and can activate without changing hook order', () => {
  const { result, rerender } = renderHook(
    ({ query }: { query: string | null }) => ({
      channels: useChannelsSearch(query),
      people: usePeopleSearch(query, false),
    }),
    { initialProps: { query: null as string | null } },
  );
  expect(result.current).toEqual({ channels: [], people: [] });
  expect(createNameSearch).not.toHaveBeenCalled();
  expect(createPeopleSearch).not.toHaveBeenCalled();
  rerender({ query: 'test' });
  expect(createNameSearch).toHaveBeenCalledTimes(1);
  expect(createPeopleSearch).toHaveBeenCalledTimes(1);
  rerender({ query: null });
  expect(result.current).toEqual({ channels: [], people: [] });
  expect(createNameSearch).toHaveBeenCalledTimes(1);
  expect(createPeopleSearch).toHaveBeenCalledTimes(1);
});
