import { config } from '@/config/env';
import { logger } from '@/utils/logger';

export interface ClawSyncOrgPayload {
  spacesOrgId: string;
  name: string;
  description?: string | null;
  createdBySpacesUserId?: string | null;
  status?: string;
}

export interface ClawSyncWorkspacePayload {
  spacesWorkspaceId: string;
  spacesOrgId: string;
  name?: string | null;
  orgName?: string | null;
  description?: string | null;
  createdBySpacesUserId?: string | null;
  status?: string;
}

export interface ClawSyncUserPayload {
  spacesUserId: string;
  spacesWorkspaceId: string;
  spacesOrgId: string;
  email: string;
  name: string;
  role?: string | null;
  workspaceName?: string | null;
  orgName?: string | null;
  createdBySpacesUserId?: string | null;
  status?: string;
}

export class ClawSpacesSyncError extends Error {
  statusCode?: number;
  retryable: boolean;

  constructor(
    message: string,
    options: { statusCode?: number; retryable: boolean; cause?: unknown },
  ) {
    super(message);
    this.name = 'ClawSpacesSyncError';
    this.statusCode = options.statusCode;
    this.retryable = options.retryable;
    if (options.cause !== undefined) {
      (this as { cause?: unknown }).cause = options.cause;
    }
  }
}

class ClawSpacesSyncClient {
  async syncOrg(payload: ClawSyncOrgPayload): Promise<unknown> {
    return this.post('/org', payload);
  }

  async syncWorkspace(payload: ClawSyncWorkspacePayload): Promise<unknown> {
    return this.post('/workspace', payload);
  }

  async syncUser(payload: ClawSyncUserPayload): Promise<unknown> {
    return this.post('/user', payload);
  }

  private async post(path: string, payload: unknown): Promise<unknown> {
    const baseUrl = config.aiProvisioning.xyneClawAuthInternalUrl.replace(/\/+$/, '');
    if (!baseUrl) {
      throw new ClawSpacesSyncError('XYNE_CLAW_AUTH_INTERNAL_URL is not configured', {
        retryable: false,
      });
    }

    if (!config.aiProvisioning.s2sKey) {
      throw new ClawSpacesSyncError('XYNE_CLAW_S2S_KEY is not configured', {
        retryable: false,
      });
    }

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.aiProvisioning.requestTimeoutMs,
    );

    try {
      const response = await fetch(`${baseUrl}/claw/api/v1/internal/spaces-sync${path}`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-s2s-key': config.aiProvisioning.s2sKey,
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      const responseBody = await this.safeParseBody(response);
      if (!response.ok) {
        throw new ClawSpacesSyncError(
          `Claw spaces sync ${path} failed with ${response.status}: ${this.summarizeBody(responseBody)} request=${this.summarizePayload(payload)}`,
          {
            statusCode: response.status,
            retryable: response.status === 502 || response.status >= 500,
          },
        );
      }

      if (this.isFailureBody(responseBody)) {
        throw new ClawSpacesSyncError(
          `Claw spaces sync ${path} returned success=false: ${this.summarizeBody(responseBody)} request=${this.summarizePayload(payload)}`,
          { statusCode: response.status, retryable: false },
        );
      }

      return responseBody;
    } catch (error) {
      if (error instanceof ClawSpacesSyncError) {
        throw error;
      }

      const url = `${baseUrl}/claw/api/v1/internal/spaces-sync${path}`;
      const isAbortError = error instanceof Error && error.name === 'AbortError';
      const serialized = this.serializeFetchError(error);
      const causeMessage =
        serialized.cause instanceof Error
          ? serialized.cause.message
          : typeof serialized.cause === 'object' &&
              serialized.cause !== null &&
              'message' in serialized.cause
            ? String((serialized.cause as { message: unknown }).message)
            : undefined;
      const errorMessage =
        error instanceof Error ? error.message : String(error);

      logger.error('Claw spaces sync network failure', {
        path,
        url,
        method: 'POST',
        isTimeout: isAbortError,
        timeoutMs: config.aiProvisioning.requestTimeoutMs,
        payload: this.summarizePayload(payload),
        fetchError: serialized,
      });

      throw new ClawSpacesSyncError(
        causeMessage
          ? `Claw spaces sync ${path} request failed: ${causeMessage}`
          : `Claw spaces sync ${path} request failed: ${errorMessage}`,
        { retryable: true, cause: error },
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async safeParseBody(response: Response): Promise<unknown> {
    const text = await response.text();
    if (!text) return null;

    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  private summarizeBody(body: unknown): string {
    const raw = typeof body === 'string' ? body : JSON.stringify(body);
    return raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
  }

  private summarizePayload(payload: unknown): string {
    if (!payload || typeof payload !== 'object') {
      return '{}';
    }

    const value = payload as Record<string, unknown>;
    const safePayload = {
      spacesOrgId: value.spacesOrgId,
      spacesWorkspaceId: value.spacesWorkspaceId,
      spacesUserId: value.spacesUserId,
      role: value.role,
      status: value.status,
    };

    return JSON.stringify(safePayload);
  }

  private isFailureBody(body: unknown): boolean {
    return (
      typeof body === 'object' &&
      body !== null &&
      'success' in body &&
      (body as { success?: unknown }).success === false
    );
  }

  private serializeFetchError(error: unknown): Record<string, unknown> {
    if (!(error instanceof Error)) {
      return {
        value: String(error),
      };
    }

    const result: Record<string, unknown> = {
      name: error.name,
      message: error.message,
      stack: error.stack,
    };

    const cause = (error as { cause?: unknown }).cause;

    if (cause instanceof Error) {
      const systemCause = cause as Error & {
        code?: string;
        errno?: string | number;
        syscall?: string;
        hostname?: string;
        address?: string;
        port?: string | number;
        localAddress?: string;
        localPort?: string | number;
      };

      result.cause = {
        name: systemCause.name,
        message: systemCause.message,
        stack: systemCause.stack,
        code: systemCause.code,
        errno: systemCause.errno,
        syscall: systemCause.syscall,
        hostname: systemCause.hostname,
        address: systemCause.address,
        port: systemCause.port,
        localAddress: systemCause.localAddress,
        localPort: systemCause.localPort,
      };
    } else if (cause !== undefined) {
      result.cause = cause;
    }

    return result;
  }
}

export const clawSpacesSyncClient = new ClawSpacesSyncClient();
