import { config } from '@/config/env';
import { decrypt } from '@/services/encryptionService';
import { mockDeskMailService, type CaptureDeskMailInput } from '@/services/mockDeskMailService';

export function buildMockDeskCredentials(payload: Record<string, unknown>): Record<string, unknown> {
  return {
    mock: true,
    accessToken: 'mock-access-token',
    refreshToken: 'mock-refresh-token',
    ...payload,
  };
}

/**
 * Mock Desk outbound short-circuit, shared by the reply and compose paths in
 * emailController. When the resolved source carries mock credentials AND
 * DESK_MOCK_ENABLED is on, the mail is captured into the in-memory mock mailbox
 * instead of being dispatched to a provider whose credentials are fabricated.
 *
 * Returns undefined when the caller should fall through to the real provider, so
 * both call sites stay a single branch instead of two drifting copies.
 */
export function captureMockDeskSentMail(
  encryptedCredentials: string | null | undefined,
  input: CaptureDeskMailInput
): { threadId: string; messageId?: string } | undefined {
  if (!config.isDeskMockEnabled) return undefined;
  if (!parseMockDeskCredentials(encryptedCredentials).isMock) return undefined;

  const captured = mockDeskMailService.captureSentMail(input);
  return { threadId: captured.threadId, messageId: captured.messageId };
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
