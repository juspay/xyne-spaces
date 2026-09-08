export type ProviderId = 'copilot' | 'claude' | 'codex' | 'openrouter' | 'litellm';

export type AuthType = 'api_key' | 'oauth_token';

export type ReasoningEffort = 'low' | 'medium' | 'high';

export interface ProviderCredential {
  provider: string;
  model?: string | null;
  baseUrl?: string | null;
  authType?: AuthType | null;
  reasoningEffort?: ReasoningEffort | null;
  hasApiKey: boolean;
}

export interface ProviderCredentialPayload {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  authType?: AuthType;
  reasoningEffort?: ReasoningEffort | null;
}

export interface SubagentRouting {
  subagentName: string;
  provider: string;
}

export interface GitHubDeviceCode {
  userCode: string;
  verificationUri: string;
  expiresIn: number;
  interval: number;
}

export interface ClaudeModelInfo {
  id: string;
  displayName: string;
}

export interface ProviderModelOption {
  id: string;
  name: string;
}

export interface CodexOauthStart {
  url: string;
  state: string;
  expiresIn: number;
}
