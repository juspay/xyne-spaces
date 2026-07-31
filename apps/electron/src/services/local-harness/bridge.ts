import { hostname } from 'os';
import { app, safeStorage } from 'electron';
import Store from 'electron-store';
import log from 'electron-log/main';
import { config } from '../../app/config';
import {
  LOCAL_HARNESS_PROTOCOL_VERSION,
  type LocalHarnessInstallation,
  type LocalHarnessPollResult,
  type LocalHarnessProgressEvent,
  type LocalHarnessProvider,
  type LocalHarnessRunEnvelope,
  type LocalHarnessRunResult,
  type LocalHarnessStatus,
  type LocalHarnessToolSpec,
} from './contract';
import { detectInstallations } from './detect';
import { ToolFacadeServer } from './toolFacade';
import { ClaudeCodeAdapter } from './adapters/claudeCode';
import { CodexCliAdapter } from './adapters/codexCli';
import type { HarnessAdapter } from './adapters/types';

const MCP_SERVER_NAME = 'xyne';

const POLL_ERROR_BACKOFF_MS = 5000;

const ADAPTERS: Record<LocalHarnessProvider, HarnessAdapter> = {
  'claude-code': new ClaudeCodeAdapter(),
  'codex-cli': new CodexCliAdapter(),
};

interface PersistedState {
  deviceId?: string;
  deviceTokenEnc?: string;
  deviceTokenPlain?: string;
}

export class LocalHarnessBridge {
  private readonly store = new Store<PersistedState>({ name: 'local-harness' });
  private installations: LocalHarnessInstallation[] = [];
  private polling = false;
  private stopped = true;
  private lastError: string | null = null;
  private activeRun: { runId: string; controller: AbortController } | null = null;
  private readonly harnessSessions = new Map<string, string>();

  private baseUrl(): string {
    return new URL('/claw/api/v1', config.CLAW_AUTH_URL).toString().replace(/\/+$/, '');
  }

  private deviceToken(): string | null {
    const enc = this.store.get('deviceTokenEnc');
    if (enc) {
      try {
        return safeStorage.decryptString(Buffer.from(enc, 'base64'));
      } catch (err) {
        log.warn('[LocalHarness] failed to decrypt device token — re-pair required:', err);
        return null;
      }
    }
    return this.store.get('deviceTokenPlain') ?? null;
  }

  private setDeviceToken(token: string): void {
    if (safeStorage.isEncryptionAvailable()) {
      this.store.set('deviceTokenEnc', safeStorage.encryptString(token).toString('base64'));
      this.store.delete('deviceTokenPlain');
      return;
    }
    log.warn('[LocalHarness] OS keychain unavailable — storing device token unencrypted');
    this.store.set('deviceTokenPlain', token);
    this.store.delete('deviceTokenEnc');
  }

  private deviceName(): string {
    return `${hostname()} (${app.getName()})`;
  }

  async refreshInstallations(): Promise<LocalHarnessInstallation[]> {
    this.installations = await detectInstallations().catch((err) => {
      log.warn('[LocalHarness] detection failed:', err);
      return [];
    });
    return this.installations;
  }

  async status(): Promise<LocalHarnessStatus> {
    if (this.installations.length === 0) await this.refreshInstallations();
    return {
      supported: true,
      connected: !this.stopped && !!this.deviceToken(),
      deviceId: this.store.get('deviceId') ?? null,
      deviceName: this.deviceName(),
      platform: process.platform,
      installations: this.installations,
      lastError: this.lastError,
    };
  }

  async connect(cookieHeader: string): Promise<LocalHarnessStatus> {
    await this.refreshInstallations();

    const res = await fetch(`${this.baseUrl()}/local-harness/devices`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: cookieHeader },
      body: JSON.stringify({
        protocolVersion: LOCAL_HARNESS_PROTOCOL_VERSION,
        deviceName: this.deviceName(),
        platform: process.platform,
        installations: this.installations,
      }),
    });

    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Device registration failed (HTTP ${res.status})`);
    }

    const body = (await res.json()) as { data?: { deviceId?: string; deviceToken?: string } };
    if (!body.data?.deviceId || !body.data?.deviceToken) throw new Error('Device registration returned no token');

    this.store.set('deviceId', body.data.deviceId);
    this.setDeviceToken(body.data.deviceToken);
    this.lastError = null;
    log.info(`[LocalHarness] paired device ${body.data.deviceId}`);

    this.start();
    return this.status();
  }

  async disconnect(cookieHeader: string): Promise<LocalHarnessStatus> {
    const deviceId = this.store.get('deviceId');
    this.stop();
    if (deviceId) {
      await fetch(`${this.baseUrl()}/local-harness/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader },
      }).catch((err) => log.warn('[LocalHarness] revoke failed (clearing locally anyway):', err));
    }
    this.store.delete('deviceId');
    this.store.delete('deviceTokenEnc');
    this.store.delete('deviceTokenPlain');
    this.harnessSessions.clear();
    return this.status();
  }

  start(): void {
    if (!this.stopped) return;
    if (!this.deviceToken()) return;
    this.stopped = false;
    void this.pollLoop();
  }

  stop(): void {
    this.stopped = true;
    this.activeRun?.controller.abort();
    this.activeRun = null;
  }

  private async pollLoop(): Promise<void> {
    if (this.polling) return;
    this.polling = true;

    await this.refreshInstallations();
    log.info(
      `[LocalHarness] poll loop started with ${this.installations.length} installation(s): ` +
        `[${this.installations.map(i => i.provider).join(',')}]`,
    );

    try {
      while (!this.stopped) {
        const token = this.deviceToken();
        if (!token) break;

        try {
          const res = await fetch(`${this.baseUrl()}/local-harness-bridge/runs/next`, {
            headers: { Authorization: `Bearer ${token}` },
          });

          if (res.status === 401) {
            this.lastError = 'This device is no longer paired. Reconnect from Settings.';
            log.warn('[LocalHarness] device token rejected — stopping poll loop');
            this.stop();
            break;
          }
          if (!res.ok) throw new Error(`Poll failed (HTTP ${res.status})`);

          const body = (await res.json()) as { data?: LocalHarnessPollResult };
          this.lastError = null;
          if (body.data?.status === 'run') {
            await this.executeRun(body.data.run, token);
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          this.lastError = message;
          log.warn(`[LocalHarness] poll error: ${message}`);
          await delay(POLL_ERROR_BACKOFF_MS);
        }
      }
    } finally {
      this.polling = false;
      log.info('[LocalHarness] poll loop stopped');
    }
  }

  private async executeRun(envelope: LocalHarnessRunEnvelope, token: string): Promise<void> {
    const adapter = ADAPTERS[envelope.provider];
    let installation = this.installations.find((i) => i.provider === envelope.provider);

    if (!installation) {
      log.warn(`[LocalHarness] ${envelope.provider} not in cached installations — re-probing`);
      await this.refreshInstallations();
      installation = this.installations.find((i) => i.provider === envelope.provider);
    }

    if (!adapter || !installation) {
      await this.reportResult(envelope.runId, token, {
        status: 'failed',
        text: '',
        error: `No local ${envelope.provider} installation is available on this device`,
      });
      return;
    }

    const controller = new AbortController();
    this.activeRun = { runId: envelope.runId, controller };

    const facade = new ToolFacadeServer({
      listTools: () => this.fetchTools(envelope.runId, token),
      callTool: (spec, args) => this.callTool(envelope.runId, token, spec, args),
      onToolStarted: (toolName) => {
        void this.reportProgress(envelope.runId, token, { kind: 'tool', toolName });
      },
    });

    try {
      await facade.start();

      log.info(
        `[LocalHarness] run=${envelope.runId} agent=${envelope.agentSlug} provider=${envelope.provider} ` +
          `requestedModel=${envelope.model ?? '(cli default)'} binary=${installation.binaryPath}`,
      );

      const outcome = await adapter.run({
        envelope,
        binaryPath: installation.binaryPath,
        mcpConfig: facade.mcpConfig(MCP_SERVER_NAME),
        mcpServerName: MCP_SERVER_NAME,
        resumeSessionId: this.harnessSessions.get(envelope.conversationId),
        onProgress: (event) => {
          void this.reportProgress(envelope.runId, token, event);
        },
        signal: controller.signal,
      });

      if (outcome.harnessSessionId) {
        this.harnessSessions.set(envelope.conversationId, outcome.harnessSessionId);
      }

      log.info(
        `[LocalHarness] run=${envelope.runId} status=${outcome.status} ` +
          `effectiveModel=${outcome.effectiveModel ?? '(not reported)'} ` +
          `tools=[${(outcome.toolsUsed ?? []).join(',')}] chars=${outcome.text.length}` +
          `${outcome.error ? ` error=${outcome.error}` : ''}`,
      );

      const { harnessSessionId: _ignored, ...result } = outcome;
      await this.reportResult(envelope.runId, token, result);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[LocalHarness] run ${envelope.runId} failed: ${message}`);
      await this.reportResult(envelope.runId, token, { status: 'failed', text: '', error: message });
    } finally {
      await facade.stop().catch(() => {});
      this.activeRun = null;
    }
  }

  private async fetchTools(runId: string, token: string): Promise<LocalHarnessToolSpec[]> {
    const res = await fetch(`${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(runId)}/tools`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) throw new Error(`Tool listing failed (HTTP ${res.status})`);
    const body = (await res.json()) as { data?: { tools?: LocalHarnessToolSpec[] } };
    return body.data?.tools ?? [];
  }

  private async callTool(
    runId: string,
    token: string,
    spec: LocalHarnessToolSpec,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; content: string }> {
    const res = await fetch(`${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(runId)}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ serverType: spec.serverType, toolName: spec.toolName, params: args }),
    });
    const body = (await res.json().catch(() => ({}))) as { data?: { ok?: boolean; content?: string }; error?: string };
    if (!res.ok) return { ok: false, content: body.error ?? `Tool call failed (HTTP ${res.status})` };
    return { ok: body.data?.ok !== false, content: body.data?.content ?? '' };
  }

  private async reportProgress(runId: string, token: string, event: LocalHarnessProgressEvent): Promise<void> {
    await fetch(`${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(runId)}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(event),
    }).catch(() => {});
  }

  private async reportResult(runId: string, token: string, result: LocalHarnessRunResult): Promise<void> {
    await fetch(`${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(runId)}/result`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(result),
    }).catch((err) => {
      log.error(`[LocalHarness] failed to report result for run ${runId}:`, err);
    });
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export const localHarnessBridge = new LocalHarnessBridge();
