import {
  deleteAgentProviderCredential,
  exchangeAgentOauth,
  listAgentProviderCredentials,
  pollAgentCopilotLogin,
  setAgentProviderCredential,
  startAgentCopilotLogin,
  startAgentOauth,
  type AgentCopilotDeviceCode,
  type AgentOauthFlow,
  type AgentProviderCredentialStatus,
  type SetAgentCredentialPayload,
} from './agentCredentialsService';
import {
  deleteProviderCredential,
  exchangeClaudeOauth,
  exchangeCodexOauth,
  initiateCopilotGitHubLogin,
  listProviderCredentials,
  pollCopilotGitHubLogin,
  startClaudeOauth,
  startCodexOauth,
  upsertProviderCredential,
} from '@/services/claw/clawSettingsService';

export type OauthCredentialProvider = 'codex' | 'claude';

export interface CredentialScope {
  kind: 'agent' | 'user';
  /** Stable per-scope key so react-query caches do not collide. */
  id: string;
  list: () => Promise<AgentProviderCredentialStatus[]>;
  set: (payload: SetAgentCredentialPayload) => Promise<unknown>;
  remove: (provider: string) => Promise<unknown>;
  startOauth: (provider: OauthCredentialProvider) => Promise<AgentOauthFlow>;
  exchangeOauth: (
    provider: OauthCredentialProvider,
    input: { code: string; state: string },
  ) => Promise<unknown>;
  startCopilot: () => Promise<AgentCopilotDeviceCode>;
  pollCopilot: () => Promise<{ status: string }>;
}

export function agentCredentialScope(slug: string): CredentialScope {
  return {
    kind: 'agent',
    id: slug,
    list: () => listAgentProviderCredentials(slug),
    set: payload => setAgentProviderCredential(slug, payload),
    remove: provider => deleteAgentProviderCredential(slug, provider),
    startOauth: provider => startAgentOauth(slug, provider),
    exchangeOauth: (provider, input) => exchangeAgentOauth(slug, provider, input),
    startCopilot: () => startAgentCopilotLogin(slug),
    pollCopilot: () => pollAgentCopilotLogin(slug),
  };
}

/**
 * The same dialog against the signed-in user's own credentials — what
 * /ai/settings manages. Every endpoint already existed in clawSettingsService;
 * this only adapts the shapes so one dialog serves both scopes rather than a
 * second copy drifting from the first.
 */
export function userCredentialScope(userId: string): CredentialScope {
  return {
    kind: 'user',
    id: userId,
    list: async () => {
      const rows = await listProviderCredentials(userId);
      return rows as unknown as AgentProviderCredentialStatus[];
    },
    set: payload => upsertProviderCredential(userId, payload.provider, payload),
    remove: provider => deleteProviderCredential(userId, provider),
    startOauth: async provider => {
      const flow =
        provider === 'codex' ? await startCodexOauth(userId) : await startClaudeOauth(userId);
      return { url: flow.url, state: flow.state, expiresIn: flow.expiresIn ?? 0 };
    },
    exchangeOauth: (provider, input) =>
      provider === 'codex' ? exchangeCodexOauth(userId, input) : exchangeClaudeOauth(userId, input),
    startCopilot: async () => {
      const device = await initiateCopilotGitHubLogin(userId);
      return {
        userCode: device.userCode,
        verificationUri: device.verificationUri,
        expiresIn: device.expiresIn ?? 0,
        interval: device.interval ?? 5,
      };
    },
    pollCopilot: () => pollCopilotGitHubLogin(userId),
  };
}
