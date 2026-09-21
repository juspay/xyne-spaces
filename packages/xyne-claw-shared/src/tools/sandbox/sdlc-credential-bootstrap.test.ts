import type { Session } from '@xyne/kata-sdk';
import { spawnSync, execFileSync } from 'node:child_process';
import {
  createCipheriv,
  diffieHellman,
  generateKeyPairSync,
  hkdfSync,
  randomBytes,
  type KeyObject,
} from 'node:crypto';
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  buildSdlcGitCleanupScript,
  buildSdlcRepositoryAccessScript,
  installSdlcRepositoryAccess,
} from './sdlc-credential-bootstrap.js';

const binding = { repoId: 'repo-1', workspaceId: 'ws-1', actorUserId: 'user-1' };
const transport = {
  authUrl: 'https://claw-auth.example/',
  s2sKey: 's2s-key',
  runSessionId: 'wf-run-1',
  sessionToken: 'session-token',
};
const repository = {
  name: 'torana',
  cloneUrl: 'https://bb.example.net/scm/lp/torana.git',
  baseBranch: 'master',
};

function mockSession(id: string, preflightExitCode = 0): Session {
  const run = vi.fn()
    .mockResolvedValueOnce({ exitCode: preflightExitCode, stdout: '', stderr: '' })
    .mockResolvedValueOnce({ exitCode: 0, stdout: 'sandbox-public-key', stderr: '' })
    .mockResolvedValue({ exitCode: 0, stdout: '', stderr: '' });
  return {
    id,
    commands: { run },
    files: { write: vi.fn().mockResolvedValue(undefined) },
  } as unknown as Session;
}

/** Mirrors the backend's encryptSandboxCredentialEnvelope. */
function envelopeFor(
  sandboxPublicKey: KeyObject,
  aad: Record<string, unknown>,
  credential: Record<string, unknown>,
) {
  const ephemeral = generateKeyPairSync('x25519');
  const salt = randomBytes(32);
  const iv = randomBytes(12);
  const aadText = JSON.stringify({ version: 1, ...aad });
  const secret = diffieHellman({ privateKey: ephemeral.privateKey, publicKey: sandboxPublicKey });
  const key = Buffer.from(hkdfSync('sha256', secret, salt, Buffer.from(aadText), 32));
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(Buffer.from(aadText));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(credential)), cipher.final()]);
  return {
    version: 1,
    algorithm: 'X25519-HKDF-SHA256-AES-256-GCM',
    ephemeralPublicKey: ephemeral.publicKey.export({ format: 'der', type: 'spki' }).toString('base64'),
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    aad: aadText,
    expiresAt: String(aad['expiresAt']),
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('installSdlcRepositoryAccess', () => {
  it('fails closed before asking for credentials when Node crypto is unavailable', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(installSdlcRepositoryAccess(mockSession('sandbox-1', 1), binding, transport))
      .rejects.toThrow('Node.js 20+');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('asks for the Actor and repository, never a grant, and returns anonymous access as such', async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ success: true, anonymous: true, repository }),
    });
    vi.stubGlobal('fetch', fetchMock);

    const result = await installSdlcRepositoryAccess(mockSession('sandbox-1'), binding, transport);

    expect(result).toEqual({ mode: 'anonymous', repository });
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(url).toBe('https://claw-auth.example/claw/api/v1/sessions/wf-run-1/sdlc/runtime-credentials/bootstrap');
    expect((init as RequestInit).headers).toMatchObject({
      'x-s2s-key': 's2s-key',
      Authorization: 'Bearer session-token',
    });
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({
      ...binding,
      sandboxId: 'sandbox-1',
      sandboxPublicKey: 'sandbox-public-key',
    });
  });

  it('surfaces the backend refusal reason', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 403,
      json: async () => ({ error: 'You are not a member of this repository' }),
    }));
    await expect(installSdlcRepositoryAccess(mockSession('sandbox-1'), binding, transport))
      .rejects.toThrow('HTTP 403): You are not a member of this repository');
  });

  it('fails before calling claw-auth when the run session token is missing', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const session = mockSession('sandbox-1');
    await expect(installSdlcRepositoryAccess(session, binding, { ...transport, sessionToken: '' }))
      .rejects.toThrow('Claw auth URL, S2S key or session token is unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
    expect(session.commands.run).toHaveBeenLastCalledWith('rm -f /tmp/.sdlc-private-key', 5_000);
  });
});

describe('sandbox git access scripts', () => {
  const roots: string[] = [];
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  function sandbox() {
    const root = mkdtempSync(join(tmpdir(), 'sdlc-access-'));
    roots.push(root);
    const env = { ...process.env, GIT_CONFIG_GLOBAL: join(root, 'gitconfig'), GIT_CONFIG_NOSYSTEM: '1', HOME: root };
    writeFileSync(env.GIT_CONFIG_GLOBAL, '');
    const git = (...args: string[]) => execFileSync('git', args, { env, encoding: 'utf8' }).trim();
    const node = (script: string) => {
      const path = join(root, '.sdlc-run.cjs');
      writeFileSync(path, script);
      return spawnSync('node', [path], { env, encoding: 'utf8' });
    };
    const install = (repoId: string, cloneUrl: string, token: string, account: string, aadRepoId = repoId) => {
      const keys = generateKeyPairSync('x25519');
      writeFileSync(join(root, '.sdlc-private-key'), keys.privateKey.export({ format: 'der', type: 'pkcs8' }));
      const envelope = envelopeFor(
        keys.publicKey,
        { repoId: aadRepoId, sandboxId: 'sandbox-1', expiresAt: new Date(Date.now() + 60_000).toISOString() },
        {
          provider: 'BITBUCKET_SERVER',
          host: 'bb.example.net',
          cloneUrl,
          username: `${account}.login`,
          password: token,
          accountName: `Account ${account}`,
          accountEmail: `${account}@example.com`,
        },
      );
      writeFileSync(join(root, '.sdlc-envelope.json'), JSON.stringify(envelope));
      return node(buildSdlcRepositoryAccessScript({ sandboxId: 'sandbox-1', repoId, root }));
    };
    const fill = (path: string) =>
      execFileSync('git', ['credential', 'fill'], {
        env,
        encoding: 'utf8',
        input: `protocol=https\nhost=bb.example.net\npath=${path}\n\n`,
      });
    const identityOf = (cloneUrl: string) => {
      const repo = mkdtempSync(join(root, 'repo-'));
      git('init', '-q', repo);
      git('-C', repo, 'remote', 'add', 'origin', cloneUrl);
      return `${git('-C', repo, 'config', 'user.name')} <${git('-C', repo, 'config', 'user.email')}>`;
    };
    return { root, git, node, install, fill, identityOf };
  }

  it('gives each repository its own token and commit identity, then cleanup removes both', () => {
    const box = sandbox();
    const torana = 'https://bb.example.net/scm/lp/torana.git';
    const pluto = 'https://bb.example.net/scm/lp/pluto.git';
    expect(box.install('repo-1', torana, 'tokenAAAAAAAAAAAAAAAAAAAA', 'alice').status).toBe(0);
    expect(box.install('repo-2', pluto, 'tokenBBBBBBBBBBBBBBBBBBBB', 'bob').status).toBe(0);

    expect(box.fill('scm/lp/torana.git')).toContain('password=tokenAAAAAAAAAAAAAAAAAAAA');
    expect(box.fill('scm/lp/pluto.git')).toContain('password=tokenBBBBBBBBBBBBBBBBBBBB');
    expect(box.identityOf(torana)).toBe('Account alice <alice@example.com>');
    expect(box.identityOf(pluto)).toBe('Account bob <bob@example.com>');
    expect(readdirSync(box.root)).not.toContain('.sdlc-private-key');
    expect(readdirSync(box.root)).not.toContain('.sdlc-envelope.json');

    expect(box.node(buildSdlcGitCleanupScript(box.root)).status).toBe(0);
    expect(box.git('config', '--global', '--list')).toBe('credential.https://bb.example.net.usehttppath=true');
    expect(readdirSync(box.root).filter((name) => name.startsWith('.sdlc-'))).toEqual([]);
  });

  it('refuses an envelope bound to another repository', () => {
    const box = sandbox();
    const result = box.install('repo-1', 'https://bb.example.net/scm/lp/torana.git', 'tokenAAAAAAAAAAAAAAAAAAAA', 'alice', 'repo-9');
    expect(result.status).toBe(1);
    expect(box.git('config', '--global', '--list')).toBe('');
    expect(existsSync(join(box.root, '.sdlc-private-key'))).toBe(false);
  });
});
