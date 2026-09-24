import type { LocalHarnessProgressEvent, LocalHarnessRunEnvelope, LocalHarnessRunResult } from '../contract';

export interface HarnessRunContext {
  envelope: LocalHarnessRunEnvelope;
  binaryPath: string;
  mcpConfig: Record<string, unknown>;
  mcpServerName: string;
  toolCount: number;
  workspaceDir: string;
  attachmentPaths?: Array<{ path: string; fileName: string; mimeType: string }>;
  resumeSessionId?: string | undefined;
  onProgress: (event: LocalHarnessProgressEvent) => void;
  signal: AbortSignal;
}

export interface HarnessRunOutcome extends LocalHarnessRunResult {
  harnessSessionId?: string;
  partialText?: string;
}

export interface HarnessAdapter {
  run(ctx: HarnessRunContext): Promise<HarnessRunOutcome>;
}
