import { promises as fsp } from 'fs';
import { basename, dirname, join, resolve, sep } from 'path';
import { hostname } from 'os';
import { app, net, safeStorage } from 'electron';
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
  type LocalHarnessWorkspaceSpec,
} from './contract';
import { detectInstallations } from './detect';
import { ToolFacadeServer } from './toolFacade';
import { ClaudeCodeAdapter } from './adapters/claudeCode';
import { CodexCliAdapter } from './adapters/codexCli';
import type { HarnessAdapter } from './adapters/types';
import { localHarnessRunDir, localHarnessWorkspaceDir, sanitizeRunDirName } from './paths';
import { containerSandbox } from './containerSandbox';
import { isWorkspacePageTool, workspaceBrowserBridge } from './workspaceBrowser';
import { isAppControlTool } from './appControl';
import { SurfaceCallWatcher } from './surfaceCalls';
import { callLocalSessionTool, isLocalSessionTool } from './sessionTools';
import { localFileServer } from './localFileServer';
import {
  DELIVER_MAX_BYTES,
  DELIVER_MAX_FILES,
  SANDBOX_TOOL_DELIVER,
  buildConnectedToolsSection,
  CONTAINER_TOOLS,
  isJobsPath,
  SANDBOX_TOOL_OPEN_FILE,
  SERVER_OPEN_URL_TOOL,
  buildSandboxPrompt,
  deliverMimeType,
  resolveInRunDir,
  sandboxFileUrl,
} from './sandbox';
import {
  WORKSPACE_LIST_LIMIT,
  buildWorkspacePromptSection,
  collectWorkspaceDiff,
  isExistingDirectory,
  isPathInside,
  isRejectedWorkspacePath,
  readGitMetadata,
  realPathOrNull,
  type LocalWorkspaceEntry,
} from './workspace';
import {
  MAX_SESSION_BYTES,
  claudeSessionWritePath,
  codexSessionWritePath,
  isValidSessionId,
  locateClaudeSession,
  locateCodexSession,
} from './sessionFiles';

const MCP_SERVER_NAME = 'xyne';

class StaleDevicePairingError extends Error {}

const POLL_ERROR_BACKOFF_MS = 5000;
const RUN_HEARTBEAT_MS = 10000;
const TOOL_PREFETCH_ATTEMPTS = 3;
const TOOL_PREFETCH_RETRY_MS = 2000;
const ATTACHMENT_MAX_BYTES = 25 * 1024 * 1024;
const MAX_CONCURRENT_RUNS = 3;
const POLL_CAPACITY_WAIT_MS = 2000;
const INTERRUPT_GRACE_MS = 15000;
const INTERRUPT_TOOL_MESSAGE =
  'The user sent a new message. Stop now. If you already wrote a finished or draft file the user should see, ' +
  'call deliver-files once with it; otherwise call no more tools. Then reply with one or two sentences ' +
  'summarising what you did and what is still left.';

const ADAPTERS: Record<LocalHarnessProvider, HarnessAdapter> = {
  'claude-code': new ClaudeCodeAdapter(),
  'codex-cli': new CodexCliAdapter(),
};

interface ActiveRunState {
  conversationId: string;
  controller: AbortController;
  sandbox?: {
    runDir: string;
    runDirName: string;
    tools: LocalHarnessToolSpec[];
    sandboxed: boolean;
  };
  interrupt: { requested: boolean; timer?: NodeJS.Timeout; injected: boolean };
}

interface PersistedState {
  deviceId?: string;
  deviceTokenEnc?: string;
  deviceTokenPlain?: string;
  enabledProviders?: LocalHarnessProvider[];
  localWorkspaces?: LocalWorkspaceEntry[];
}

export class LocalHarnessBridge {
  private readonly store = new Store<PersistedState>({ name: 'local-harness' });
  private installations: LocalHarnessInstallation[] = [];
  private polling = false;
  private readonly surfaceWatcher = new SurfaceCallWatcher(
    () => this.baseUrl(),
    () => this.deviceToken(),
  );
  private stopped = true;
  private lastError: string | null = null;
  private readonly active = new Map<string, ActiveRunState>();

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

  listWorkspaces(): Array<{ path: string; name: string }> {
    return (this.store.get('localWorkspaces') ?? []).map((entry) => ({ path: entry.path, name: entry.name }));
  }

  async addWorkspace(
    candidate: string,
  ): Promise<{ path: string; name: string; branch?: string; remote?: string } | null> {
    const realPath = await realPathOrNull(candidate);
    if (!realPath || !(await isExistingDirectory(realPath))) {
      log.warn('[LocalHarness] rejected folder attach: path is not an existing directory');
      return null;
    }

    const rejection = isRejectedWorkspacePath(realPath, app.getPath('userData'));
    if (rejection) {
      log.warn(`[LocalHarness] rejected folder attach: ${rejection} is not allowed`);
      return null;
    }

    const name = basename(realPath) || realPath;
    const existing = this.store.get('localWorkspaces') ?? [];
    const next: LocalWorkspaceEntry[] = [
      { path: realPath, name, addedAt: new Date().toISOString() },
      ...existing.filter((entry) => entry.path !== realPath),
    ].slice(0, WORKSPACE_LIST_LIMIT);
    this.store.set('localWorkspaces', next);
    log.info(`[LocalHarness] attached local folder (${name})`);

    const meta = await readGitMetadata(realPath);
    return { path: realPath, name, ...meta };
  }

  private async resolveAllowedWorkspace(workspace: LocalHarnessWorkspaceSpec): Promise<string | null> {
    const realPath = await realPathOrNull(workspace.path);
    if (!realPath || !(await isExistingDirectory(realPath))) return null;
    const allowed = this.store.get('localWorkspaces') ?? [];
    for (const entry of allowed) {
      const root = (await realPathOrNull(entry.path)) ?? entry.path;
      if (isPathInside(root, realPath)) return realPath;
    }
    return null;
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
      activeRuns: this.active.size,
      containerRuntime: await containerSandbox.probe(),
    };
  }

  private async registerDevice(cookieHeader: string): Promise<void> {
    const res = await net.fetch(`${this.baseUrl()}/local-harness/devices`, {
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
    const res = await net.fetch(`${this.baseUrl()}/local-harness-bridge/installations`, {
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
      await net.fetch(`${this.baseUrl()}/local-harness/devices/${encodeURIComponent(deviceId)}`, {
        method: 'DELETE',
        headers: { Cookie: cookieHeader },
      }).catch((err) => log.warn('[LocalHarness] revoke failed (clearing locally anyway):', err));
    }
    this.clearPairing();
    this.store.set('enabledProviders', []);
    this.installations = this.installations.map((i) => ({ ...i, enabled: false }));
    return this.status();
  }

  start(): void {
    if (!this.stopped) return;
    if (!this.deviceToken()) return;
    this.stopped = false;
    void this.pollLoop();
    this.surfaceWatcher.start();
  }

  stop(): void {
    this.stopped = true;
    this.surfaceWatcher.stop();
    for (const run of this.active.values()) {
      if (run.interrupt.timer) clearTimeout(run.interrupt.timer);
      run.controller.abort();
    }
    this.active.clear();
    localFileServer.stop();
    void containerSandbox.shutdown();
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

        if (this.active.size >= MAX_CONCURRENT_RUNS) {
          await delay(POLL_CAPACITY_WAIT_MS);
          continue;
        }

        try {
          const res = await net.fetch(`${this.baseUrl()}/local-harness-bridge/runs/next`, {
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
            const envelope = body.data.run;
            void this.executeRun(envelope, token).catch((err) => {
              log.error(`[LocalHarness] run ${envelope.runId} crashed:`, err);
            });
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
    const runState: ActiveRunState = {
      conversationId: envelope.conversationId,
      controller,
      interrupt: { requested: false, injected: false },
    };
    this.active.set(envelope.runId, runState);

    const facade = new ToolFacadeServer({
      listTools: () => this.fetchTools(envelope.runId, token),
      callTool: (spec, args) => this.callTool(envelope.runId, token, spec, args),
      onToolStarted: (toolName) => {
        void this.reportProgress(envelope.runId, token, { kind: 'tool', toolName });
      },
    });

    const heartbeat = setInterval(() => {
      void net.fetch(`${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(envelope.runId)}/status`, {
        headers: { Authorization: `Bearer ${token}` },
      })
        .then(async (res) => {
          const body = (await res.json().catch(() => ({}))) as {
            data?: { cancelled?: boolean; interruptRequested?: boolean };
          };
          if (body.data?.cancelled) this.cancelActiveRun(envelope.runId, 'status');
          else if (body.data?.interruptRequested) this.markInterruptRequested(envelope.runId, 'status');
        })
        .catch(() => {});
    }, RUN_HEARTBEAT_MS);

    try {
      await facade.start();

      const prefetched = await this.prefetchTools(envelope.runId, token);
      facade.primeTools(prefetched);

      log.info(
        `[LocalHarness] run=${envelope.runId} agent=${envelope.agentSlug} provider=${envelope.provider} ` +
          `requestedModel=${envelope.model ?? '(cli default)'} binary=${installation.binaryPath} ` +
          `tools=${prefetched.length}`,
      );

      const sandbox = envelope.localSandbox ?? null;
      const workspace = envelope.workspace ?? null;
      const attachedPath = workspace ? await this.resolveAllowedWorkspace(workspace) : null;
      if (workspace && !attachedPath) {
        await this.reportResult(envelope.runId, token, {
          status: 'failed',
          text: '',
          error: `Folder is not attached on this device: ${workspace.path}`,
        });
        return;
      }

      const workspaceDir = attachedPath
        ? attachedPath
        : sandbox
          ? localHarnessRunDir(envelope.conversationId)
          : localHarnessWorkspaceDir();

      if (sandbox?.container) {
        const ready = await containerSandbox.ensureReady();
        const image = ready.ok ? await containerSandbox.ensureImage() : ready;
        const started = image.ok
          ? await containerSandbox.ensureContainer(sanitizeRunDirName(envelope.conversationId), workspaceDir)
          : image;
        if (!started.ok) {
          log.warn(`[LocalHarness] container sandbox unavailable: ${started.reason}`);
          await this.reportResult(envelope.runId, token, {
            status: 'failed',
            text: '',
            error: `Container sandbox unavailable — ${started.reason}`,
          });
          return;
        }
      }

      if (sandbox || attachedPath) {
        runState.sandbox = {
          runDir: workspaceDir,
          runDirName: sanitizeRunDirName(envelope.conversationId),
          tools: prefetched,
          sandboxed: !!sandbox,
        };
        await localFileServer.start(localHarnessWorkspaceDir()).catch((err) => {
          log.warn('[LocalHarness] local file server failed to start:', err);
        });
      }

      const attachmentPaths = await this.downloadAttachments(envelope, token, workspaceDir);

      const requestedResume = envelope.resumeSessionId ?? undefined;
      const resumeSessionId = requestedResume
        ? await this.ensureSessionFile(envelope, token, requestedResume, workspaceDir)
        : undefined;

      const localTools = prefetched.filter((tool) => tool.local);
      let systemPrompt = envelope.systemPrompt;
      systemPrompt = `${systemPrompt}\n\n${buildConnectedToolsSection(prefetched)}`;
      if (localTools.length) {
        systemPrompt +=
          `\n\nWorkspace tools: the user is on the Xyne desktop app and can see a workspace panel beside this chat. ` +
          `These tools act on that panel, so call them instead of saying you cannot: ` +
          localTools.map((tool) => `${tool.name} (${tool.description.split('. ')[0]})`).join('; ') +
          '.';
      }
      if (attachedPath) {
        systemPrompt = `${systemPrompt}\n\n${buildWorkspacePromptSection({
          ...workspace!,
          path: attachedPath,
        })}`;
      }
      if (sandbox) systemPrompt = buildSandboxPrompt(systemPrompt, sandbox, workspaceDir);
      const runEnvelope = systemPrompt === envelope.systemPrompt ? envelope : { ...envelope, systemPrompt };

      const outcome = await adapter.run({
        envelope: runEnvelope,
        ...(attachmentPaths.length ? { attachmentPaths } : {}),
        binaryPath: installation.binaryPath,
        toolCount: prefetched.length,
        workspaceDir,
        mcpConfig: facade.mcpConfig(MCP_SERVER_NAME),
        mcpServerName: MCP_SERVER_NAME,
        ...(resumeSessionId ? { resumeSessionId } : {}),
        onProgress: (event) => {
          void this.reportProgress(envelope.runId, token, event);
        },
        signal: controller.signal,
      });

      if (outcome.harnessSessionId && outcome.status !== 'failed') {
        await this.archiveSessionFile(envelope, token, outcome.harnessSessionId, workspaceDir);
      }

      log.info(
        `[LocalHarness] run=${envelope.runId} status=${outcome.status} ` +
          `effectiveModel=${outcome.effectiveModel ?? '(not reported)'} ` +
          `tools=[${(outcome.toolsUsed ?? []).join(',')}] chars=${outcome.text.length}` +
          `${outcome.error ? ` error=${outcome.error}` : ''}`,
      );

      const finalOutcome = attachedPath ? await this.withWorkspaceDiff(outcome, attachedPath) : outcome;

      await this.reportResult(envelope.runId, token, this.applyInterrupt(runState, finalOutcome));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.error(`[LocalHarness] run ${envelope.runId} failed: ${message}`);
      await this.reportResult(envelope.runId, token, { status: 'failed', text: '', error: message });
    } finally {
      clearInterval(heartbeat);
      if (runState.interrupt.timer) clearTimeout(runState.interrupt.timer);
      await facade.stop().catch(() => {});
      this.active.delete(envelope.runId);
    }
  }

  private async withWorkspaceDiff<T extends LocalHarnessRunResult>(outcome: T, workspacePath: string): Promise<T> {
    try {
      const diff = await collectWorkspaceDiff(workspacePath);
      if (!diff || diff.changedFiles === 0) return outcome;
      return { ...outcome, workspaceDiff: diff };
    } catch (err) {
      log.warn('[LocalHarness] workspace diff unavailable:', err);
      return outcome;
    }
  }

  private async locateSessionFile(
    provider: LocalHarnessProvider,
    sessionId: string,
    workspaceDir: string,
  ): Promise<string | null> {
    return provider === 'codex-cli'
      ? locateCodexSession(sessionId)
      : locateClaudeSession(sessionId, workspaceDir);
  }

  private sessionWritePath(
    provider: LocalHarnessProvider,
    sessionId: string,
    workspaceDir: string,
  ): string | null {
    return provider === 'codex-cli'
      ? codexSessionWritePath(sessionId)
      : claudeSessionWritePath(sessionId, workspaceDir);
  }

  /**
   * Files the user attached to the message land beside the run so the CLI can
   * read them; without this the harness only ever sees the text of the turn.
   */
  private async downloadAttachments(
    envelope: LocalHarnessRunEnvelope,
    token: string,
    workspaceDir: string,
  ): Promise<Array<{ path: string; fileName: string; mimeType: string }>> {
    const attachments = envelope.attachments ?? [];
    if (attachments.length === 0) return [];

    const dir = join(workspaceDir, '.xyne-attachments');
    await fsp.mkdir(dir, { recursive: true }).catch(() => undefined);

    const saved: Array<{ path: string; fileName: string; mimeType: string }> = [];
    for (const attachment of attachments) {
      try {
        const res = await net.fetch(
          `${this.baseUrl()}/local-harness-bridge/runs/${envelope.runId}/attachments/${attachment.id}`,
          { headers: { Authorization: `Bearer ${token}` } },
        );
        if (!res.ok) {
          log.warn(`[LocalHarness] attachment ${attachment.id} download failed: ${res.status}`);
          continue;
        }
        const bytes = Buffer.from(await res.arrayBuffer());
        if (bytes.byteLength > ATTACHMENT_MAX_BYTES) {
          log.warn(
            `[LocalHarness] attachment ${attachment.id} is ${bytes.byteLength} bytes; skipped`,
          );
          continue;
        }
        // Both halves of the name come off the wire, so they are reduced to a
        // safe charset and the result is then proved to resolve inside `dir`
        // before anything is written.
        const safeName = basename(attachment.fileName).replace(/[^a-zA-Z0-9._-]/g, '_') || 'file';
        const safeId = basename(attachment.id).replace(/[^a-zA-Z0-9._-]/g, '_') || 'id';
        const target = resolve(dir, `${safeId}-${safeName}`);
        if (target !== join(dir, `${safeId}-${safeName}`) || !target.startsWith(`${dir}${sep}`)) {
          log.warn(`[LocalHarness] attachment ${attachment.id} resolved outside the run dir`);
          continue;
        }
        await fsp.writeFile(target, bytes);
        saved.push({ path: target, fileName: attachment.fileName, mimeType: attachment.mimeType });
      } catch (err) {
        log.warn(`[LocalHarness] attachment ${attachment.id} download errored:`, err);
      }
    }
    return saved;
  }

  private async ensureSessionFile(
    envelope: LocalHarnessRunEnvelope,
    token: string,
    sessionId: string,
    workspaceDir: string,
  ): Promise<string | undefined> {
    if (!isValidSessionId(sessionId)) {
      log.warn(`[LocalHarness] run=${envelope.runId} ignoring malformed resume session id`);
      return undefined;
    }

    const existing = await this.locateSessionFile(envelope.provider, sessionId, workspaceDir);
    if (existing) return sessionId;

    try {
      const res = await net.fetch(
        `${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(envelope.runId)}/session`,
        { headers: { Authorization: `Bearer ${token}` } },
      );

      if (res.status === 404) {
        log.info(
          `[LocalHarness] run=${envelope.runId} no archived ${envelope.provider} session for ${sessionId} — starting fresh`,
        );
        return undefined;
      }
      if (!res.ok) {
        log.warn(`[LocalHarness] run=${envelope.runId} session restore failed (HTTP ${res.status})`);
        return undefined;
      }

      const buffer = Buffer.from(await res.arrayBuffer());
      if (buffer.byteLength > MAX_SESSION_BYTES) {
        log.warn(`[LocalHarness] run=${envelope.runId} archived session exceeds size limit — starting fresh`);
        return undefined;
      }

      const headerId = res.headers.get('x-harness-session-id');
      const targetId = headerId && isValidSessionId(headerId) ? headerId : sessionId;
      const target = this.sessionWritePath(envelope.provider, targetId, workspaceDir);
      if (!target) {
        log.warn(`[LocalHarness] run=${envelope.runId} could not resolve a session write path`);
        return undefined;
      }

      await fsp.mkdir(dirname(target), { recursive: true });
      await fsp.writeFile(target, buffer, { mode: 0o600 });
      log.info(
        `[LocalHarness] run=${envelope.runId} restored ${envelope.provider} session ${targetId} (${buffer.byteLength} bytes)`,
      );
      return targetId;
    } catch (err) {
      log.warn(`[LocalHarness] run=${envelope.runId} session restore error:`, err);
      return undefined;
    }
  }

  private async archiveSessionFile(
    envelope: LocalHarnessRunEnvelope,
    token: string,
    sessionId: string,
    workspaceDir: string,
  ): Promise<void> {
    try {
      if (!isValidSessionId(sessionId)) return;
      const path = await this.locateSessionFile(envelope.provider, sessionId, workspaceDir);
      if (!path) {
        log.warn(`[LocalHarness] run=${envelope.runId} no local ${envelope.provider} session file to archive`);
        return;
      }

      const body = await fsp.readFile(path);
      if (body.byteLength > MAX_SESSION_BYTES) {
        log.warn(`[LocalHarness] run=${envelope.runId} session file ${body.byteLength} bytes exceeds archive limit`);
        return;
      }
      const url =
        `${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(envelope.runId)}/session` +
        `?sessionId=${encodeURIComponent(sessionId)}`;
      const res = await net.fetch(url, {
        method: 'PUT',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/octet-stream' },
        body: new Uint8Array(body),
      });

      if (!res.ok) {
        log.warn(`[LocalHarness] run=${envelope.runId} session archive failed (HTTP ${res.status})`);
        return;
      }
      log.info(
        `[LocalHarness] run=${envelope.runId} archived ${envelope.provider} session ${sessionId} (${body.byteLength} bytes)`,
      );
    } catch (err) {
      log.warn(`[LocalHarness] run=${envelope.runId} session archive error:`, err);
    }
  }

  private async prefetchTools(runId: string, token: string): Promise<LocalHarnessToolSpec[]> {
    for (let attempt = 1; attempt <= TOOL_PREFETCH_ATTEMPTS; attempt += 1) {
      try {
        const tools = await this.fetchTools(runId, token);
        log.info(`[LocalHarness] run=${runId} tools prefetched=${tools.length}`);
        return tools;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.warn(`[LocalHarness] run=${runId} tool prefetch attempt ${attempt} failed: ${message}`);
        if (attempt < TOOL_PREFETCH_ATTEMPTS) await delay(TOOL_PREFETCH_RETRY_MS);
      }
    }
    log.error(`[LocalHarness] run=${runId} tool prefetch gave up — continuing with no tools`);
    return [];
  }

  private async fetchTools(runId: string, token: string): Promise<LocalHarnessToolSpec[]> {
    const res = await net.fetch(`${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(runId)}/tools`, {
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
  ): Promise<{ ok: boolean; content: string; image?: { data: string; mimeType: string } }> {
    const run = this.active.get(runId);
    if (run && run.interrupt.requested && !run.interrupt.injected && spec.toolName !== SANDBOX_TOOL_DELIVER) {
      run.interrupt.injected = true;
      log.info(`[LocalHarness] run=${runId} interrupt injected instead of ${spec.toolName}`);
      return { ok: true, content: INTERRUPT_TOOL_MESSAGE };
    }

    if (spec.local === true && (spec.toolName === SANDBOX_TOOL_OPEN_FILE || spec.toolName === SANDBOX_TOOL_DELIVER)) {
      const sandbox = run?.sandbox;
      if (!sandbox) {
        return { ok: false, content: 'No local sandbox workspace is active for this run' };
      }
      if (spec.toolName === SANDBOX_TOOL_OPEN_FILE && !sandbox.sandboxed) {
        return { ok: false, content: 'page-open-file only works with the local sandbox' };
      }
      return spec.toolName === SANDBOX_TOOL_OPEN_FILE
        ? this.openSandboxFile(runId, token, sandbox, args)
        : this.deliverSandboxFiles(runId, token, sandbox, args);
    }
    if (spec.local === true && CONTAINER_TOOLS.has(spec.toolName)) {
      const sandbox = run?.sandbox;
      if (!sandbox) return { ok: false, content: 'No container sandbox is active for this run' };
      return this.callContainerTool(sandbox, spec.toolName, args);
    }
    if (spec.local === true && (isWorkspacePageTool(spec.toolName) || isAppControlTool(spec.toolName))) {
      return workspaceBrowserBridge.call(spec.toolName, args);
    }
    if (spec.local === true && isLocalSessionTool(spec.toolName)) {
      return callLocalSessionTool(spec.toolName, args);
    }
    const res = await net.fetch(`${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(runId)}/tools/call`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ serverType: spec.serverType, toolName: spec.toolName, params: args }),
    });
    const body = (await res.json().catch(() => ({}))) as {
      data?: {
        ok?: boolean;
        content?: string;
        image?: { data: string; mimeType: string };
        interruptRequested?: boolean;
      };
      error?: string;
    };
    if (body.data?.interruptRequested) this.markInterruptRequested(runId, 'tools/call');
    if (!res.ok) return { ok: false, content: body.error ?? `Tool call failed (HTTP ${res.status})` };
    return {
      ok: body.data?.ok !== false,
      content: body.data?.content ?? '',
      ...(body.data?.image ? { image: body.data.image } : {}),
    };
  }

  private async openSandboxFile(
    runId: string,
    token: string,
    sandbox: { runDir: string; runDirName: string; tools: LocalHarnessToolSpec[] },
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; content: string; image?: { data: string; mimeType: string } }> {
    const raw = typeof args['path'] === 'string' ? args['path'] : '';
    const resolved = resolveInRunDir(sandbox.runDir, raw);
    if (!resolved) return { ok: false, content: `Path is outside the run workspace: ${raw}` };

    try {
      const stat = await fsp.stat(resolved.path);
      if (!stat.isFile()) throw new Error('not a file');
    } catch {
      return { ok: false, content: `File not found: ${raw}` };
    }

    const base = localFileServer.baseUrl() ?? (await localFileServer.start(localHarnessWorkspaceDir()).then(
      () => localFileServer.baseUrl(),
      () => null,
    ));
    if (!base) return { ok: false, content: 'The local preview server is not running' };

    const openUrlSpec = sandbox.tools.find(
      (tool) => tool.toolName === SERVER_OPEN_URL_TOOL && tool.local !== true,
    ) ?? sandbox.tools.find((tool) => tool.toolName === SERVER_OPEN_URL_TOOL);
    if (!openUrlSpec) return { ok: false, content: 'The open-url tool is not available for this run' };

    const url = sandboxFileUrl(base, sandbox.runDirName, resolved.relative);
    const title = resolved.relative.split('/').pop() ?? resolved.relative;
    return this.callTool(runId, token, openUrlSpec, { url, title });
  }

  private async deliverSandboxFiles(
    runId: string,
    token: string,
    sandbox: { runDir: string },
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; content: string; image?: { data: string; mimeType: string } }> {
    const raw = args['paths'];
    const paths = Array.isArray(raw) ? raw : typeof raw === 'string' ? [raw] : [];
    if (paths.length === 0) return { ok: false, content: 'No file paths were provided' };
    if (paths.length > DELIVER_MAX_FILES) {
      return { ok: false, content: `Too many files: deliver at most ${DELIVER_MAX_FILES} at a time` };
    }

    const files: Array<{ fileName: string; mimeType: string; data: string }> = [];
    let total = 0;

    for (const entry of paths) {
      const resolved = resolveInRunDir(sandbox.runDir, entry);
      if (!resolved) return { ok: false, content: `Path is outside the run workspace: ${String(entry)}` };

      let buffer: Buffer;
      try {
        const stat = await fsp.stat(resolved.path);
        if (!stat.isFile()) throw new Error('not a file');
        buffer = await fsp.readFile(resolved.path);
      } catch {
        return { ok: false, content: `File not found: ${String(entry)}` };
      }

      total += buffer.byteLength;
      if (total > DELIVER_MAX_BYTES) {
        return { ok: false, content: 'Delivery exceeds the 25 MB total size limit' };
      }

      files.push({
        fileName: resolved.relative.split('/').pop() ?? resolved.relative,
        mimeType: deliverMimeType(resolved.path),
        data: buffer.toString('base64'),
      });
    }

    try {
      const res = await net.fetch(
        `${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(runId)}/deliver`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          body: JSON.stringify({ files }),
        },
      );
      const body = (await res.json().catch(() => ({}))) as { data?: { count?: number }; error?: string };
      if (!res.ok) return { ok: false, content: body.error ?? `Delivery failed (HTTP ${res.status})` };
      const count = body.data?.count ?? files.length;
      return { ok: true, content: `Delivered ${count} file(s): ${files.map((f) => f.fileName).join(', ')}` };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      log.warn(`[LocalHarness] run=${runId} deliver failed: ${message}`);
      return { ok: false, content: `Delivery failed: ${message}` };
    }
  }

  private async callContainerTool(
    sandbox: { runDir: string; runDirName: string },
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<{ ok: boolean; content: string }> {
    const str = (key: string): string => (typeof args[key] === 'string' ? (args[key] as string) : '');
    if (toolName === 'container-run' || toolName === 'container-run-detached') {
      const command = str('command').trim();
      if (!command) return { ok: false, content: 'command is required' };
      if (toolName === 'container-run-detached') {
        const job = await containerSandbox.runDetached(sandbox.runDirName, command);
        return job.ok
          ? { ok: true, content: `Started job ${job.jobId}. Poll with container-poll-job.` }
          : { ok: false, content: job.reason };
      }
      const timeoutMs = typeof args['timeoutMs'] === 'number' && args['timeoutMs'] > 0 ? Math.min(args['timeoutMs'], 600_000) : 120_000;
      const res = await containerSandbox.exec(sandbox.runDirName, command, timeoutMs);
      const parts = [`Exit code: ${res.exitCode}`, `Wall time: ${(res.wallMs / 1000).toFixed(1)} s`];
      if (res.stdout.trim()) parts.push(`Output:\n${res.stdout.trimEnd()}`);
      if (res.stderr.trim()) parts.push(`Stderr:\n${res.stderr.trimEnd()}`);
      return { ok: res.exitCode === 0, content: parts.join('\n') };
    }
    if (toolName === 'container-poll-job') {
      const job = await containerSandbox.pollJob(sandbox.runDir, str('jobId').trim());
      if (!job) return { ok: false, content: 'Unknown job id' };
      const head = job.running ? 'Status: running' : `Status: finished with exit code ${job.exitCode}`;
      return { ok: true, content: job.output.trim() ? `${head}\n${job.output.trimEnd()}` : head };
    }
    const target = resolveInRunDir(sandbox.runDir, str('path'));
    if (!target || isJobsPath(target.relative)) return { ok: false, content: `Invalid path: ${str('path')}` };
    if (toolName === 'container-write-file') {
      await fsp.mkdir(dirname(target.path), { recursive: true });
      await fsp.writeFile(target.path, str('content'), 'utf8');
      containerSandbox.touch(sandbox.runDirName);
      return { ok: true, content: `Wrote ${target.relative} (${Buffer.byteLength(str('content'), 'utf8')} bytes)` };
    }
    if (toolName === 'container-read-file') {
      try {
        const data = await fsp.readFile(target.path, 'utf8');
        const cap = 200 * 1024;
        return { ok: true, content: data.length > cap ? `${data.slice(0, cap)}\n[truncated at 200 KB]` : data };
      } catch {
        return { ok: false, content: `File not found: ${target.relative}` };
      }
    }
    if (toolName === 'container-edit-file') {
      let data: string;
      try {
        data = await fsp.readFile(target.path, 'utf8');
      } catch {
        return { ok: false, content: `File not found: ${target.relative}` };
      }
      const oldText = str('oldText');
      if (!oldText) return { ok: false, content: 'oldText is required' };
      const count = data.split(oldText).length - 1;
      if (count !== 1) return { ok: false, content: count === 0 ? 'oldText was not found in the file' : `oldText matches ${count} places; make it unique` };
      await fsp.writeFile(target.path, data.replace(oldText, str('newText')), 'utf8');
      containerSandbox.touch(sandbox.runDirName);
      return { ok: true, content: `Edited ${target.relative}` };
    }
    return { ok: false, content: `Unknown container tool: ${toolName}` };
  }

  private cancelActiveRun(runId: string, source: string): void {
    const active = this.active.get(runId);
    if (!active || active.controller.signal.aborted) return;
    log.info(`[LocalHarness] run=${runId} cancelled by the server (${source}) — stopping the CLI`);
    active.controller.abort();
  }

  private markInterruptRequested(runId: string, source: string): void {
    const run = this.active.get(runId);
    if (!run || run.interrupt.requested) return;
    run.interrupt.requested = true;
    log.info(`[LocalHarness] run=${runId} interrupt requested (${source}) — asking the CLI to wrap up`);
    run.interrupt.timer = setTimeout(() => {
      if (run.controller.signal.aborted) return;
      log.info(`[LocalHarness] run=${runId} interrupt grace elapsed — stopping the CLI`);
      run.controller.abort();
    }, INTERRUPT_GRACE_MS);
  }

  private applyInterrupt(run: ActiveRunState, outcome: LocalHarnessRunResult & { partialText?: string }): LocalHarnessRunResult {
    const { partialText, ...rest } = outcome;
    if (!run.interrupt.requested || rest.status === 'failed') return rest;
    return { ...rest, status: 'done', interrupted: true, text: rest.text || partialText || '' };
  }

  private async reportProgress(runId: string, token: string, event: LocalHarnessProgressEvent): Promise<void> {
    await net.fetch(`${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(runId)}/progress`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify(event),
    })
      .then(async (res) => {
        const body = (await res.json().catch(() => ({}))) as {
          data?: { cancelled?: boolean; interruptRequested?: boolean };
        };
        if (body.data?.cancelled) this.cancelActiveRun(runId, 'progress');
        else if (body.data?.interruptRequested) this.markInterruptRequested(runId, 'progress');
      })
      .catch(() => {});
  }

  private async reportResult(runId: string, token: string, result: LocalHarnessRunResult): Promise<void> {
    await net.fetch(`${this.baseUrl()}/local-harness-bridge/runs/${encodeURIComponent(runId)}/result`, {
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
