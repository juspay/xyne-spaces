import { config } from '@/config/env';

const TEAM_MODELS = ['external-kimi', 'external-glm'];
const USER_MODELS = ['no-default-models'];
const KEY_MODELS = ['all-team-models'];
const KEY_TYPE = 'llm_api';
const USER_ROLE = 'internal_user';
const TEAM_USER_ROLE = 'user';
const TEAM_MAX_BUDGET = 1000;
const BUDGET = 50;
const DURATION = '30d';
const TEAM_RPM_LIMIT = 1000;
const TEAM_TPM_LIMIT = 1000000;
const KEY_RPM_LIMIT = 30;
const MAX_PARALLEL_REQUESTS = 5;

type JsonRecord = Record<string, unknown>;

export class LiteLLMProvisioningError extends Error {
  statusCode?: number;
  retryable: boolean;

  constructor(message: string, options: { statusCode?: number; retryable: boolean }) {
    super(message);
    this.name = 'LiteLLMProvisioningError';
    this.statusCode = options.statusCode;
    this.retryable = options.retryable;
  }
}

export interface CreateTeamParams {
  orgId: string;
  teamAlias: string;
}

export interface CreateTeamResult {
  teamId: string;
  teamAlias?: string;
}

export interface CreateUserParams {
  orgId: string;
  userId: string;
  email: string;
  name: string;
  teamId: string;
  budget?: number;
  litellmUserId?: string;
  metadata?: Record<string, unknown>;
}

export interface CreateUserResult {
  litellmUserId: string;
}

export interface GenerateKeyParams {
  orgId: string;
  userId: string;
  email: string;
  litellmUserId: string;
  teamId: string;
  budget?: number;
  keyAlias?: string;
  metadata?: Record<string, unknown>;
}

export interface GenerateKeyResult {
  key: string;
  tokenId?: string;
  keyName?: string;
  keyAlias?: string;
  expires?: string;
}

export interface StoreTeamParams {
  orgId: string;
  teamId: string;
  teamAlias?: string;
  status?: string;
}

export interface StoreUserKeyParams {
  userId: string;
  orgId: string;
  spacesOrgId: string;
  litellmUserId: string;
  teamId: string;
  key: string;
  tokenId?: string;
  keyName?: string;
  keyAlias?: string;
  expires?: string;
}

class LiteLLMProvisioningClient {
  async createTeam(params: CreateTeamParams): Promise<CreateTeamResult> {
    const body = {
      team_alias: truncate(params.teamAlias, 180),
      models: TEAM_MODELS,
      max_budget: TEAM_MAX_BUDGET,
      budget_duration: DURATION,
      rpm_limit: TEAM_RPM_LIMIT,
      tpm_limit: TEAM_TPM_LIMIT,
      team_member_budget: BUDGET,
      team_member_budget_duration: DURATION,
      metadata: {
        external_org_id: params.orgId,
      },
    };

    const response = await this.postLiteLLM('/team/new', body);
    const teamId = stringField(response, 'team_id');
    if (!teamId) {
      throw new LiteLLMProvisioningError(
        `LiteLLM /team/new response missing team_id: ${summarizeBody(response)}`,
        { retryable: true },
      );
    }

    return {
      teamId,
      teamAlias: stringField(response, 'team_alias'),
    };
  }

  async createUser(params: CreateUserParams): Promise<CreateUserResult> {
    const deterministicUserId = params.litellmUserId ?? `claw-user-${params.userId}`;
    const body: JsonRecord = {
      user_id: deterministicUserId,
      user_email: params.email,
      user_alias: truncate(params.name || params.email, 180),
      user_role: USER_ROLE,
      models: USER_MODELS,
      teams: [
        {
          team_id: params.teamId,
          user_role: TEAM_USER_ROLE,
          ...(params.budget !== undefined ? { max_budget_in_team: params.budget } : {}),
        },
      ],
      ...(params.budget !== undefined ? { max_budget: params.budget, budget_duration: DURATION } : {}),
      auto_create_key: false,
      metadata: {
        external_org_id: params.orgId,
        external_user_id: params.userId,
        ...params.metadata,
      },
    };

    const response = await this.postLiteLLM('/user/new', body);
    const litellmUserId = stringField(response, 'user_id');
    if (!litellmUserId) {
      throw new LiteLLMProvisioningError(
        `LiteLLM /user/new response missing user_id: ${summarizeBody(response)}`,
        { retryable: true },
      );
    }

    return { litellmUserId };
  }

  async generateKey(params: GenerateKeyParams): Promise<GenerateKeyResult> {
    const keyAlias = truncate(params.keyAlias ?? `xyne-spaces ${params.email}`, 180);
    const body: JsonRecord = {
      user_id: params.litellmUserId,
      team_id: params.teamId,
      key_alias: keyAlias,
      key_type: KEY_TYPE,
      models: KEY_MODELS,
      ...(params.budget !== undefined ? { max_budget: params.budget, budget_duration: DURATION } : {}),
      duration: DURATION,
      rpm_limit: KEY_RPM_LIMIT,
      max_parallel_requests: MAX_PARALLEL_REQUESTS,
      metadata: {
        external_org_id: params.orgId,
        external_user_id: params.userId,
        ...params.metadata,
      },
    };

    const response = await this.postLiteLLM('/key/generate', body);
    const key = stringField(response, 'key') || stringField(response, 'token');
    if (!key) {
      throw new LiteLLMProvisioningError(
        `LiteLLM /key/generate response missing key/token: ${summarizeBody(redactKeyResponse(response))}`,
        { retryable: true },
      );
    }

    return {
      key,
      tokenId: stringField(response, 'token_id'),
      keyName: stringField(response, 'key_name'),
      keyAlias: stringField(response, 'key_alias') || keyAlias,
      expires: stringField(response, 'expires'),
    };
  }

  async storeTeam(params: StoreTeamParams): Promise<void> {
    await this.postClawStore('/team', {
      orgId: params.orgId,
      teamId: params.teamId,
      teamAlias: params.teamAlias,
      status: params.status ?? 'ACTIVE',
    });
  }

  async storeUserKey(params: StoreUserKeyParams): Promise<void> {
    await this.postClawStore('/user-key', {
      userId: params.userId,
      orgId: params.orgId,
      spacesOrgId: params.spacesOrgId,
      litellmUserId: params.litellmUserId,
      teamId: params.teamId,
      key: params.key,
      tokenId: params.tokenId,
      keyName: params.keyName,
      keyAlias: params.keyAlias,
      expires: params.expires,
    });
  }

  private async postLiteLLM(path: string, payload: JsonRecord): Promise<unknown> {
    const baseUrl = config.aiProvisioning.litellmManagementBaseUrl.replace(/\/+$/, '');
    if (!baseUrl) {
      throw new LiteLLMProvisioningError('LITELLM_MANAGEMENT_BASE_URL is not configured', {
        retryable: false,
      });
    }

    if (!config.aiProvisioning.litellmManagementAdminKey) {
      throw new LiteLLMProvisioningError('LITELLM_MANAGEMENT_ADMIN_KEY is not configured', {
        retryable: false,
      });
    }

    return this.post({
      url: `${baseUrl}${path}`,
      headers: {
        authorization: `Bearer ${config.aiProvisioning.litellmManagementAdminKey}`,
        'content-type': 'application/json',
        'litellm-changed-by': config.aiProvisioning.litellmChangedBy,
      },
      payload,
      path,
      service: 'LiteLLM management',
      retryableStatus: status => status >= 500 || status === 408 || status === 429,
      summarizePayload: summarizeLiteLLMPayload,
    });
  }

  private async postClawStore(path: string, payload: JsonRecord): Promise<unknown> {
    const baseUrl = config.aiProvisioning.xyneClawAuthInternalUrl.replace(/\/+$/, '');
    if (!baseUrl) {
      throw new LiteLLMProvisioningError('XYNE_CLAW_AUTH_INTERNAL_URL is not configured', {
        retryable: false,
      });
    }

    if (!config.aiProvisioning.s2sKey) {
      throw new LiteLLMProvisioningError('XYNE_CLAW_S2S_KEY is not configured', {
        retryable: false,
      });
    }

    return this.post({
      url: `${baseUrl}/claw/api/v1/internal/litellm-sync${path}`,
      headers: {
        'content-type': 'application/json',
        'x-s2s-key': config.aiProvisioning.s2sKey,
      },
      payload,
      path,
      service: 'Claw LiteLLM sync',
      retryableStatus: status => status >= 500 || status === 502,
      summarizePayload: summarizeClawStorePayload,
    });
  }

  private async post(params: {
    url: string;
    headers: Record<string, string>;
    payload: JsonRecord;
    path: string;
    service: string;
    retryableStatus: (status: number) => boolean;
    summarizePayload: (payload: JsonRecord) => string;
  }): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      config.aiProvisioning.requestTimeoutMs,
    );

    try {
      const response = await fetch(params.url, {
        method: 'POST',
        headers: params.headers,
        body: JSON.stringify(params.payload),
        signal: controller.signal,
      });
      const responseBody = await safeParseBody(response);

      if (!response.ok) {
        throw new LiteLLMProvisioningError(
          `${params.service} ${params.path} failed with ${response.status}: ${summarizeBody(redactKeyResponse(responseBody))} request=${params.summarizePayload(params.payload)}`,
          {
            statusCode: response.status,
            retryable: params.retryableStatus(response.status),
          },
        );
      }

      if (isFailureBody(responseBody)) {
        throw new LiteLLMProvisioningError(
          `${params.service} ${params.path} returned success=false: ${summarizeBody(responseBody)} request=${params.summarizePayload(params.payload)}`,
          { statusCode: response.status, retryable: false },
        );
      }

      return responseBody;
    } catch (error) {
      if (error instanceof LiteLLMProvisioningError) {
        throw error;
      }

      const message = error instanceof Error ? error.message : String(error);
      throw new LiteLLMProvisioningError(`${params.service} ${params.path} request failed: ${message}`, {
        retryable: true,
      });
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function safeParseBody(response: Response): Promise<unknown> {
  const text = await response.text();
  if (!text) return null;

  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function stringField(value: unknown, field: string): string | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const fieldValue = (value as Record<string, unknown>)[field];
  return typeof fieldValue === 'string' && fieldValue.trim() ? fieldValue : undefined;
}

function isFailureBody(body: unknown): boolean {
  return (
    typeof body === 'object' &&
    body !== null &&
    'success' in body &&
    (body as { success?: unknown }).success === false
  );
}

function summarizeBody(body: unknown): string {
  const raw = typeof body === 'string' ? body : JSON.stringify(body);
  if (!raw) return '';
  return raw.length > 500 ? `${raw.slice(0, 500)}...` : raw;
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? value.slice(0, maxLength) : value;
}

function summarizeLiteLLMPayload(payload: JsonRecord): string {
  return JSON.stringify({
    team_alias: payload.team_alias,
    user_id: payload.user_id,
    user_email: payload.user_email,
    team_id: payload.team_id,
    key_alias: payload.key_alias,
    metadata: payload.metadata,
  });
}

function summarizeClawStorePayload(payload: JsonRecord): string {
  return JSON.stringify({
    orgId: payload.orgId,
    userId: payload.userId,
    spacesOrgId: payload.spacesOrgId,
    teamId: payload.teamId,
    litellmUserId: payload.litellmUserId,
    tokenId: payload.tokenId,
    keyName: payload.keyName,
    keyAlias: payload.keyAlias,
    expires: payload.expires,
  });
}

function redactKeyResponse(value: unknown): unknown {
  if (!value || typeof value !== 'object') {
    return value;
  }

  return {
    ...(value as Record<string, unknown>),
    key: undefined,
    token: undefined,
  };
}

export const litellmProvisioningClient = new LiteLLMProvisioningClient();
