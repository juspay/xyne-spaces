import { decrypt } from '@/services/encryptionService';

export function buildMockDeskCredentials(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    mock: true,
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    ...payload,
  };
}

export function parseMockDeskCredentials(
  encryptedCredentials: string | null | undefined
): { isMock: boolean; error?: Error } {
  if (!encryptedCredentials) return { isMock: false };

  try {
    const credentials = JSON.parse(decrypt(encryptedCredentials)) as { mock?: unknown };
    return { isMock: credentials.mock === true };
  } catch (error) {
    return { isMock: false, error: error instanceof Error ? error : new Error(String(error)) };
  }
}
