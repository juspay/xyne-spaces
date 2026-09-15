import type { AgentProviderCredentialStatus } from './agentCredentialsService';

export const CREDENTIAL_PROVIDERS = [
  'codex',
  'claude',
  'copilot',
  'openrouter',
  'litellm',
] as const;

export type CredentialProvider = (typeof CREDENTIAL_PROVIDERS)[number];

export const CREDENTIAL_PROVIDER_LABELS: Record<string, string> = {
  codex: 'OpenAI Codex',
  claude: 'Anthropic Claude',
  copilot: 'GitHub Copilot',
  openrouter: 'OpenRouter',
  litellm: 'LiteLLM (own key)',
  spaces: 'Spaces',
};

export const AUTH_TYPE_OPTIONS = [
  { value: 'api_key', label: 'API key' },
  { value: 'oauth_token', label: 'OAuth token' },
] as const;

export const REASONING_OPTIONS = [
  { value: '', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
] as const;

export interface CredentialForm {
  provider: CredentialProvider;
  apiKey: string;
  model: string;
  baseUrl: string;
  authType: 'api_key' | 'oauth_token';
  reasoningEffort: '' | 'low' | 'medium' | 'high';
}

export const EMPTY_CREDENTIAL_FORM: CredentialForm = {
  provider: 'codex',
  apiKey: '',
  model: '',
  baseUrl: '',
  authType: 'api_key',
  reasoningEffort: '',
};

export function formFromCredential(entry: AgentProviderCredentialStatus): CredentialForm {
  return {
    provider: (CREDENTIAL_PROVIDERS as readonly string[]).includes(entry.provider)
      ? (entry.provider as CredentialProvider)
      : 'codex',
    apiKey: '',
    model: entry.model ?? '',
    baseUrl: entry.baseUrl ?? '',
    authType: entry.authType === 'oauth_token' ? 'oauth_token' : 'api_key',
    reasoningEffort: entry.reasoningEffort ?? '',
  };
}

/** Only these two have agent-scoped OAuth routes in claw-auth. Offering the
 *  choice anywhere else is a dead end — there is no flow behind it. */
export const supportsOauth = (provider: string): provider is 'codex' | 'claude' | 'copilot' =>
  provider === 'codex' || provider === 'claude' || provider === 'copilot';

export const supportsAuthType = (provider: string): boolean => supportsOauth(provider);
export const supportsReasoning = (provider: string): boolean => provider !== 'litellm';

export const baseUrlPlaceholder = (provider: string): string =>
  provider === 'litellm' ? 'blank = platform LiteLLM proxy' : 'https://openrouter.ai/api/v1';
