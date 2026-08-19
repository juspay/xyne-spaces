import type { Session } from '@xyne/kata-sdk';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSdlcPostCommitHook,
  installSdlcGitCredentialBootstrap,
} from './sdlc-credential-bootstrap.js';

const binding = {
  agentSlug: 'sdlc-agent' as const,
  operation: 'PUSH' as const,
  executionId: 'execution-1',
  sessionId: 'session-1',
  repoId: 'repo-1',
};

function mockSession(id: string, preflightExitCode = 0, publicKey = 'sandbox-public-key'): Session {
  const run = vi.fn()
    .mockResolvedValueOnce({ exitCode: preflightExitCode, stdout: '', stderr: '' })
    .mockResolvedValueOnce({ exitCode: 0, stdout: publicKey, stderr: '' })
    .mockResolvedValueOnce({ exitCode: 0, stdout: '', stderr: '' });
  return {
    id,
    commands: { run },
    files: { write: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Session;
}

function envelope() {
  return {
    version: 1,
    algorithm: 'X25519-HKDF-SHA256-AES-256-GCM',
    ephemeralPublicKey: 'ephemeral',
    salt: 'salt',
    iv: 'iv',
    authTag: 'tag',
    ciphertext: 'ciphertext',
    aad: '{}',
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SPACES_BACKEND_URL;
  delete process.env.XYNE_CLAW_S2S_KEY;
});

describe('SDLC sandbox credential bootstrap', () => {
  it('fails closed before network redemption when Node crypto is unavailable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(installSdlcGitCredentialBootstrap(mockSession('sandbox-1', 1), binding))
      .rejects.toThrow('Node.js 20+');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('requests a fresh public-key-bound envelope when a cached sandbox is reused', async () => {
    process.env.SPACES_BACKEND_URL = 'https://spaces.example';
    process.env.XYNE_CLAW_S2S_KEY = 's2s-key';
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ envelope: envelope() }),
    });
    vi.stubGlobal('fetch', fetchMock);

    await installSdlcGitCredentialBootstrap(mockSession('sandbox-1', 0, 'public-key-1'), binding);
    await installSdlcGitCredentialBootstrap(mockSession('sandbox-1', 0, 'public-key-2'), binding);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const calls = fetchMock.mock.calls.map(([url, init]) => ({
      url,
      body: JSON.parse(String((init as RequestInit).body)),
    }));
    expect(calls.map(({ url }) => url)).toEqual([
      'https://spaces.example/api/internal/sdlc/vcs/runtime-credentials/bootstrap',
      'https://spaces.example/api/internal/sdlc/vcs/runtime-credentials/bootstrap',
    ]);
    expect(calls.map(({ body }) => body.sandboxId)).toEqual(['sandbox-1', 'sandbox-1']);
    expect(calls.map(({ body }) => body.sandboxPublicKey)).toEqual(['public-key-1', 'public-key-2']);
    expect(calls.every(({ body }) => body.agentSlug === 'sdlc-agent')).toBe(true);
    expect(calls.every(({ body }) => body.grantId === undefined)).toBe(true);
  });

  it('keeps PAT identity discovery and commit attribution inside the sandbox script', async () => {
    process.env.SPACES_BACKEND_URL = 'https://spaces.example';
    process.env.XYNE_CLAW_S2S_KEY = 's2s-key';
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ envelope: envelope() }),
    }));
    const session = mockSession('sandbox-identity');

    await installSdlcGitCredentialBootstrap(session, binding);

    const writes = vi.mocked(session.files.write).mock.calls;
    const script = Buffer.from(writes[2]?.[1] as Uint8Array).toString('utf8');
    expect(() => new Function(script)).not.toThrow();
    const hookBase64 = script.match(/post-commit",Buffer\.from\("([A-Za-z0-9+/=]+)","base64"\)/)?.[1];
    expect(hookBase64).toBeTruthy();
    const hook = Buffer.from(hookBase64!, 'base64').toString('utf8');
    expect(() => new Function(hook.replace(/^#![^\n]*\n/, ''))).not.toThrow();
    expect(hook).toContain('GIT_AUTHOR_NAME = identity.name');
    expect(hook).toContain('GIT_COMMITTER_NAME = identity.name');
    expect(script).toContain('https://api.github.com/user');
    expect(script).toContain('@users.noreply.github.com');
    expect(script).toContain('core.hooksPath');
    expect(script).not.toContain('userEmail');
    expect(script).not.toContain('userName');
  });

  it('rewrites both commit author and committer to the sandbox-fetched PAT identity', () => {
    const root = mkdtempSync(join(tmpdir(), 'sdlc-pat-identity-'));
    try {
      const repo = join(root, 'repo');
      const hooks = join(root, 'hooks');
      const identity = join(root, 'identity.json');
      execFileSync('git', ['init', repo], { stdio: 'ignore' });
      mkdirSync(hooks);
      writeFileSync(identity, JSON.stringify({
        name: 'PAT Account',
        email: '123+pat-account@users.noreply.github.com',
      }), { mode: 0o600 });
      writeFileSync(join(hooks, 'post-commit'), buildSdlcPostCommitHook(identity), { mode: 0o700 });
      execFileSync('git', ['-C', repo, 'config', 'user.name', 'Wrong User']);
      execFileSync('git', ['-C', repo, 'config', 'user.email', 'wrong@example.com']);
      execFileSync('git', ['-C', repo, 'config', 'core.hooksPath', hooks]);
      writeFileSync(join(repo, 'file.txt'), 'test\n');
      execFileSync('git', ['-C', repo, 'add', 'file.txt']);
      execFileSync('git', ['-C', repo, 'commit', '-m', 'test'], { stdio: 'ignore' });
      const identityLine = execFileSync(
        'git',
        ['-C', repo, 'show', '-s', '--format=%an|%ae|%cn|%ce'],
        { encoding: 'utf8' },
      ).trim();
      expect(identityLine).toBe(
        'PAT Account|123+pat-account@users.noreply.github.com|PAT Account|123+pat-account@users.noreply.github.com',
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
