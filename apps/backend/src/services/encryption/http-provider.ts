import type {
  ClientEncryptionConfig,
  EncryptBatchItem,
  EncryptionCapabilities,
  EncryptionProvider,
  ProvisionEntityInput,
  ProvisionEntityResult,
  RegisterSessionKeyInput,
  RegisterSessionKeyResult,
} from './types';

type Fetch = typeof globalThis.fetch;

type HttpEncryptionProviderOptions = {
  baseUrl: string;
  s2sKey: string;
  timeoutMs: number;
  fetch?: Fetch;
  requiredCapabilities?: Partial<EncryptionCapabilities>;
};

export class EncryptionProviderRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EncryptionProviderRequestError';
  }
}

function isCapabilities(value: unknown): value is EncryptionCapabilities {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return ['dbEncryption', 'clientEncryption', 'apiTransitEncryption', 'provisioning']
    .every((key) => typeof record[key] === 'boolean');
}

export class HttpEncryptionProvider implements EncryptionProvider {
  private readonly baseUrl: string;
  private readonly s2sKey: string;
  private readonly timeoutMs: number;
  private readonly fetch: Fetch;
  private readonly requiredCapabilities: Partial<EncryptionCapabilities>;

  constructor(options: HttpEncryptionProviderOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.s2sKey = options.s2sKey;
    this.timeoutMs = options.timeoutMs;
    this.fetch = options.fetch ?? globalThis.fetch;
    this.requiredCapabilities = options.requiredCapabilities ?? {};
  }

  async initialize(): Promise<EncryptionCapabilities> {
    const capabilities = await this.request<unknown>('/internal/encryption/capabilities');
    if (!isCapabilities(capabilities)) {
      throw new EncryptionProviderRequestError('Encryption provider returned an invalid capability response');
    }
    const missing = (Object.keys(this.requiredCapabilities) as Array<keyof EncryptionCapabilities>)
      .filter((capability) => this.requiredCapabilities[capability] && !capabilities[capability]);
    if (missing.length > 0) {
      throw new EncryptionProviderRequestError(
        `Encryption provider is missing requested capabilities: ${missing.join(', ')}`,
      );
    }
    return capabilities;
  }

  async getPublicConfig(): Promise<ClientEncryptionConfig> {
    return this.request('/internal/encryption/public-key');
  }

  async registerSessionKey(input: RegisterSessionKeyInput): Promise<RegisterSessionKeyResult> {
    return this.request('/internal/encryption/session/register-client-key', 'POST', input);
  }

  async revokeSessionKey(sessionId: string): Promise<void> {
    await this.request('/internal/encryption/session/revoke-client-key', 'POST', { sessionId });
  }

  async encryptBatch(items: EncryptBatchItem[]): Promise<string[]> {
    if (items.length === 0) return [];
    const response = await this.request<{ items: Array<{ value: string }> }>(
      '/internal/encryption/server/batch-encrypt',
      'POST',
      { items },
    );
    if (!Array.isArray(response.items) || response.items.length !== items.length) {
      throw new EncryptionProviderRequestError('Encryption provider returned an invalid batch encryption response');
    }
    return response.items.map((item) => item.value);
  }

  async decryptBatch(values: string[]): Promise<string[]> {
    if (values.length === 0) return [];
    const response = await this.request<{ values: string[] }>(
      '/internal/encryption/server/batch-decrypt',
      'POST',
      { values },
    );
    if (!Array.isArray(response.values) || response.values.length !== values.length) {
      throw new EncryptionProviderRequestError('Encryption provider returned an invalid batch decryption response');
    }
    return response.values;
  }

  async encryptResponse<T>(body: T, sessionId: string): Promise<T> {
    const response = await this.request<{ body: T }>(
      '/internal/encryption/session/encrypt-body',
      'POST',
      { body, sessionId },
    );
    return response.body;
  }

  async decryptRequest<T>(body: T, sessionId: string): Promise<T> {
    const response = await this.request<{ body: T }>(
      '/internal/encryption/session/decrypt-body',
      'POST',
      { body, sessionId },
    );
    return response.body;
  }

  async initializeOrg(orgId: string): Promise<void> {
    await this.request('/internal/encryption/org/initialize', 'POST', { orgId });
  }

  async provisionEntity(input: ProvisionEntityInput): Promise<void> {
    await this.request('/internal/encryption/entity/provision', 'POST', input);
  }

  async backfillEntities(items: ProvisionEntityInput[]): Promise<ProvisionEntityResult[]> {
    if (items.length === 0) return [];
    const response = await this.request<{ results: ProvisionEntityResult[] }>(
      '/internal/encryption/entity/backfill-provision-batch',
      'POST',
      { entities: items },
    );
    if (!Array.isArray(response.results)) {
      throw new EncryptionProviderRequestError('Encryption provider returned an invalid provisioning response');
    }
    return response.results;
  }

  private async request<T>(path: string, method: 'GET' | 'POST' = 'GET', body?: unknown): Promise<T> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const response = await this.fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          'content-type': 'application/json',
          'x-s2s-key': this.s2sKey,
        },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: controller.signal,
      });
      if (!response.ok) {
        throw new EncryptionProviderRequestError(
          `Encryption provider ${method} ${path} failed with status ${response.status}`,
        );
      }
      return await response.json() as T;
    } catch (error) {
      if (error instanceof EncryptionProviderRequestError) throw error;
      if (controller.signal.aborted) {
        throw new EncryptionProviderRequestError(`Encryption provider ${method} ${path} timed out`);
      }
      throw new EncryptionProviderRequestError(`Encryption provider ${method} ${path} is unavailable`);
    } finally {
      clearTimeout(timeout);
    }
  }
}
