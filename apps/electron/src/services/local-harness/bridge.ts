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

class StaleDevicePairingError extends Error {}

const POLL_ERROR_BACKOFF_MS = 5000;

const ADAPTERS: Record<LocalHarnessProvider, HarnessAdapter> = {
  'claude-code': new ClaudeCodeAdapter(),
  'codex-cli': new CodexCliAdapter(),
};

interface PersistedState {
  deviceId?: string;
  deviceTokenEnc?: string;
  deviceTokenPlain?: string;
  enabledProviders?: LocalHarnessProvider[];
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

  // Which harnesses the user connected on this device. No stored set but an
  // existing pairing means the device was paired before per-harness connect
  // shipped, when pairing meant "every signed-in CLI" — keep those whole. With
  // no pairing nothing is connected, otherwise a machine that merely HAS the
  // CLIs installed would render as already connected.
  private enabledProviders(): Set<LocalHarnessProvider> {
    const stored = this.store.get('enabledProviders');
    if (stored) return new Set(stored);
    if (!this.deviceToken()) return new Set();
    return new Set(this.installations.filter((i) => i.authenticated).map((i) => i.provider));
  }

  private setEnabledProviders(providers: Set<LocalHarnessProvider>): void {
    this.store.set('enabledProviders', [...providers]);
    this.installations = this.installations.map((i) => ({ ...i, enabled: providers.has(i.provider) }));
  }

  async refreshInstallations(): Promise<LocalHarnessInstallation[]> {
    const found = await detectInstallations().catch((err) => {
      log.warn('[LocalHarness] detection failed:', err);
      return [] as LocalHarnessInstallation[];
    });
    // Seed before reading enabledProviders(): its legacy fallback derives the
    // set from the freshly detected installations.
    this.installations = found;
    const enabled = this.enabledProviders();
    this.installations = found.map((i) => ({ ...i, enabled: enabled.has(i.provider) }));
    return this.installations;
  }

  // Rescan: re-probe the CLIs and, if this device is paired, tell the server
  // what changed (a CLI installed or signed in after pairing would otherwise
  // stay invisible to run routing until the next connect).
  async rescan(): Promise<LocalHarnessInstallation[]> {
    const installations = await this.refreshInstallations();
    if (this.deviceToken()) {
      await this.syncInstallations().catch((err) => {
        log.warn('[LocalHarness] installation sync after rescan failed:', err);
      });
    }
    return installations;
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

  private async registerDevice(cookieHeader: string): Promise<void> {
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
    log.info(`[LocalHarness] paired device ${body.data.deviceId}`);
  }

  // Pushes the current installation list (including which harnesses the user
  // has connected) to an ALREADY paired device. Re-registering instead would
  // rotate the device token and 401 the long-poll this app has in flight.
  private async syncInstallations(): Promise<void> {
    const token = this.deviceToken();
    if (!token) return;
    const res = await fetch(`${this.baseUrl()}/local-harness-bridge/installations`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        protocolVersion: LOCAL_HARNESS_PROTOCOL_VERSION,
        installations: this.installations,
      }),
    });
    if (res.status === 401) throw new StaleDevicePairingError('Device pairing is no longer valid');
    if (!res.ok) {
      const body = (await res.json().catch(() => ({}))) as { error?: string };
      throw new Error(body.error ?? `Failed to update this device (HTTP ${res.status})`);
    }
  }

  private clearPairing(): void {
    this.store.delete('deviceId');
    this.store.delete('deviceTokenEnc');
    this.store.delete('deviceTokenPlain');
  }

  // Connect/disconnect ONE harness. The pairing exists only while at least one
  // harness is connected — the last disconnect revokes the device rather than
  // leaving an idle poller against the server.
  async setProviderEnabled(
    provider: LocalHarnessProvider,
    enabled: boolean,
    cookieHeader: string,
  ): Promise<LocalHarnessStatus> {
    await this.refreshInstallations();

    if (enabled) {
      const install = this.installations.find((i) => i.provider === provider);
      if (!install) throw new Error(`No ${provider} installation was found on this device`);
      if (!install.authenticated) throw new Error(`Sign in to ${provider} in your terminal first`);
    }

    const previous = this.enabledProviders();
    const next = new Set(previous);
    if (enabled) next.add(provider);
    else next.delete(provider);
    this.setEnabledProviders(next);

    if (next.size === 0) return this.disconnect(cookieHeader);

    try {
      if (this.deviceToken()) {
        try {
          await this.syncInstallations();
        } catch (err) {
          if (!(err instanceof StaleDevicePairingError)) throw err;
          log.warn('[LocalHarness] stored device token is unknown to the server — re-pairing');
          this.clearPairing();
          await this.registerDevice(cookieHeader);
        }
      } else {
        await this.registerDevice(cookieHeader);
      }
    } catch (err) {
      // Never leave the card showing "connected" for something the server
      // never heard about.
      this.setEnabledProviders(previous);
      throw err;
    }

    this.lastError = null;
    log.info(`[LocalHarness] ${provider} ${enabled ? 'connected' : 'disconnected'} on this device`);
    this.start();
    return this.status();
  }

  async connect(cookieHeader: string): Promise<LocalHarnessStatus> {
    await this.refreshInstallations();

    const usable = this.installations.filter((i) => i.authenticated).map((i) => i.provider);
    if (usable.length === 0) throw new Error('No signed-in local harness was found on this device');

    const previous = this.enabledProviders();
    this.setEnabledProviders(new Set(usable));
    try {
      await this.registerDevice(cookieHeader);
    } catch (err) {
      this.setEnabledProviders(previous);
      throw err;
    }

    this.lastError = null;
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
    this.clearPairing();
    this.store.set('enabledProviders', []);
    this.installations = this.installations.map((i) => ({ ...i, enabled: false }));
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
      `[LocalHarness] poll loop started with ${this.installations.length} installation(s), connected: ` +
        `[${this.installations.filter(i => i.enabled).map(i => i.provider).join(',')}]`,
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
