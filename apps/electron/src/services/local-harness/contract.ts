
export type LocalHarnessProvider = 'claude-code' | 'codex-cli';

export const LOCAL_HARNESS_PROVIDERS: readonly LocalHarnessProvider[] = ['claude-code', 'codex-cli'];

export const LOCAL_HARNESS_PROTOCOL_VERSION = 1;

export const LOCAL_HARNESS_SAFE_NAME = /^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/;

export interface LocalHarnessInstallation {
  provider: LocalHarnessProvider;
  binaryPath: string;
  version: string;
  authenticated: boolean;
}

export interface LocalHarnessDeviceRegistration {
  protocolVersion: number;
  deviceName: string;
  platform: string;
  installations: LocalHarnessInstallation[];
}

export interface LocalHarnessRunEnvelope {
  protocolVersion: number;
  runId: string;
  sessionId: string;
  conversationId: string;
  provider: LocalHarnessProvider;
  model: string | null;
  agentSlug: string;
  agentName: string;
  systemPrompt: string;
  task: string;
  context: string | null;
  timeoutMs: number;
}

export type LocalHarnessPollResult =
  | { status: 'idle' }
  | { status: 'run'; run: LocalHarnessRunEnvelope };

export interface LocalHarnessToolSpec {
  name: string;
  serverType: string;
  toolName: string;
  description: string;
  inputSchema: Record<string, unknown>;
  write: boolean;
}

export interface LocalHarnessToolCallResponse {
  ok: boolean;
  content: string;
}

export type LocalHarnessProgressEvent =
  | { kind: 'text'; delta: string }
  | { kind: 'tool'; toolName: string }
  | { kind: 'status'; label: string };

export type LocalHarnessRunStatus = 'done' | 'failed' | 'cancelled';

export interface LocalHarnessRunResult {
  status: LocalHarnessRunStatus;
  text: string;
  toolsUsed?: string[];
  tokenUsage?: { input?: number; output?: number };
  effectiveModel?: string;
  error?: string;
}

export interface LocalHarnessStatus {
  supported: boolean;
  connected: boolean;
  deviceId: string | null;
  deviceName: string;
  platform: string;
  installations: LocalHarnessInstallation[];
  lastError: string | null;
}
