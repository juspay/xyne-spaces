import { beforeEach, describe, expect, it, vi } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import type { ProviderCredential } from '../services/claw/clawSettingsTypes';

const state = vi.hoisted(() => ({
  data: undefined as ProviderCredential[] | undefined,
  isLoading: false,
  isError: false,
  error: null as Error | null,
}));
vi.mock('./useUserProviderCredentials', () => ({
  useUserProviderCredentials: (): typeof state => state,
  invalidateUserProviderCredentials: vi.fn(async () => {}),
}));

import { invalidateClawSettings, useClawSettings } from './useClawSettings';
import { invalidateUserProviderCredentials } from './useUserProviderCredentials';

beforeEach(() => {
  state.data = undefined;
  state.isLoading = false;
  state.isError = false;
  state.error = null;
  vi.clearAllMocks();
});

describe('Settings provider data', () => {
  it('is ready with provider credentials alone, without routing or tool discovery', () => {
    state.data = [{ provider: 'codex', hasApiKey: true }];
    expect(useClawSettings()).toEqual({
      data: { credentials: state.data },
      isLoading: false,
      isError: false,
      error: null,
    });
  });

  it('preserves provider loading and error states', () => {
    state.isLoading = true;
    expect(useClawSettings().isLoading).toBe(true);
    expect(useClawSettings().data).toBeUndefined();
    state.isLoading = false;
    state.isError = true;
    state.error = new Error('Provider request failed');
    expect(useClawSettings().error).toBe(state.error);
    expect(useClawSettings().isError).toBe(true);
  });

  it('invalidates the shared provider credential cache', async () => {
    const queryClient = new QueryClient();
    await invalidateClawSettings(queryClient, 'u1');
    expect(invalidateUserProviderCredentials).toHaveBeenCalledWith(queryClient, 'u1');
  });
});
