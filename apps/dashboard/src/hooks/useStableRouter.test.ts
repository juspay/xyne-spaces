import { describe, expect, it, vi } from 'vitest';
import type { Location } from 'react-router-dom';
import { createStableRouter } from './useStableRouter';

const loc = (pathname: string): Location => ({
  pathname,
  search: '',
  hash: '',
  state: null,
  key: pathname,
});

const fakeRouter = () => {
  const listeners = new Set<() => void>();
  const router = {
    state: {
      location: loc('/ws/chat/dir/a'),
      matches: [
        { params: { workspaceId: 'ws' } },
        { params: { workspaceId: 'ws', channelId: 'a' } },
      ],
    },
    navigate: vi.fn(() => Promise.resolve()),
    subscribe: (listener: () => void) => {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    emit: (): void => listeners.forEach(listener => listener()),
  };
  return router;
};

describe('createStableRouter', () => {
  it('reads params from the deepest match', () => {
    const stable = createStableRouter(fakeRouter());
    expect(stable.getSnapshot().params).toEqual({ workspaceId: 'ws', channelId: 'a' });
  });

  it('returns the same snapshot until the location changes', () => {
    const router = fakeRouter();
    const stable = createStableRouter(router);
    const first = stable.getSnapshot();
    expect(stable.getSnapshot()).toBe(first);
    router.state = { ...router.state, location: loc('/ws/chat/dir/b') };
    expect(stable.getSnapshot()).not.toBe(first);
    expect(stable.getSnapshot().location.pathname).toBe('/ws/chat/dir/b');
  });

  it('forwards paths with options and history deltas', () => {
    const router = fakeRouter();
    const stable = createStableRouter(router);
    void stable.navigate('/ws/chat/dir/b', { replace: true });
    void stable.navigate(-1);
    expect(router.navigate).toHaveBeenNthCalledWith(1, '/ws/chat/dir/b', { replace: true });
    expect(router.navigate).toHaveBeenNthCalledWith(2, -1);
  });

  it('prefixes absolute paths with the workspace, like the app useNavigate', () => {
    const router = fakeRouter();
    const stable = createStableRouter(router);
    void stable.navigate('/chat/dir/b', { replace: true });
    void stable.navigate('/auth/login');
    void stable.navigate('drafts-sent');
    expect(router.navigate).toHaveBeenNthCalledWith(1, '/ws/chat/dir/b', { replace: true });
    expect(router.navigate).toHaveBeenNthCalledWith(2, '/auth/login', undefined);
    expect(router.navigate).toHaveBeenNthCalledWith(3, 'drafts-sent', undefined);
  });

  it('notifies subscribers and unsubscribes', () => {
    const router = fakeRouter();
    const stable = createStableRouter(router);
    const listener = vi.fn();
    const unsubscribe = stable.subscribe(listener);
    router.emit();
    unsubscribe();
    router.emit();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
