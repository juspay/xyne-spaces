// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';
import axios from 'axios';

vi.mock('../../config', () => ({
  API_BASE_URL: 'http://localhost/api',
  VITE_ZERO_SERVER: 'http://localhost',
}));
vi.mock('./socketClient', () => ({ websocketService: { forceReconnect: vi.fn() } }));
vi.mock('../../machines/stateMachine', () => ({ stateMachineActor: { send: vi.fn() } }));

describe('dynamicHeaders', () => {
  beforeEach(() => {
    vi.resetModules();
    localStorage.clear();
    delete axios.defaults.headers.common['x-route-env'];
    delete axios.defaults.headers.common['x-workspace-id'];
  });

  it('applies only x-route-env with a safe value', async () => {
    const mod = await import('./dynamicHeaders');
    await mod.applyDynamicHeaders({
      'x-route-env': 'playground',
      'x-workspace-id': 'attacker-ws',
      authorization: 'Bearer x',
      'x-client-session-id': 's',
    });
    expect(mod.getDynamicHeaders()).toEqual({ 'x-route-env': 'playground' });
    expect(axios.defaults.headers.common['x-workspace-id']).toBeUndefined();
    expect(axios.defaults.headers.common['x-route-env']).toBe('playground');
  });

  it('rejects unsafe values', async () => {
    const mod = await import('./dynamicHeaders');
    await mod.applyDynamicHeaders({ 'x-route-env': 'a; Domain=evil.com' });
    expect(mod.getDynamicHeaders()).toEqual({});
  });

  it('drops legacy stored names on load and clears everything on logout', async () => {
    localStorage.setItem(
      'xyne_dynamic_headers',
      JSON.stringify({ 'x-route-env': 'playground', 'x-session-id': 'old' }),
    );
    const mod = await import('./dynamicHeaders');
    expect(mod.getDynamicHeaders()).toEqual({ 'x-route-env': 'playground' });
    mod.clearDynamicHeaders();
    expect(localStorage.getItem('xyne_dynamic_headers')).toBeNull();
    expect(axios.defaults.headers.common['x-route-env']).toBeUndefined();
  });
});
