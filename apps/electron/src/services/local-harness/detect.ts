import { execFile } from 'child_process';
import { existsSync } from 'fs';
import { homedir } from 'os';
import { join } from 'path';
import log from 'electron-log/main';
import { LOCAL_HARNESS_PROVIDERS, type LocalHarnessInstallation, type LocalHarnessProvider } from './contract';

const PROBE_TIMEOUT_MS = 8000;

const HARNESS_BINARIES: Record<LocalHarnessProvider, string> = {
  'claude-code': 'claude',
  'codex-cli': 'codex',
};

function candidateDirectories(): string[] {
  const home = homedir();
  return [
    '/opt/homebrew/bin',
    '/usr/local/bin',
    '/usr/bin',
    join(home, '.local', 'bin'),
    join(home, '.bun', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    join(home, 'AppData', 'Roaming', 'npm'),
    ...(process.env['PATH'] ?? '').split(process.platform === 'win32' ? ';' : ':').filter(Boolean),
  ];
}

function resolveBinary(name: string): string | null {
  const suffixes = process.platform === 'win32' ? ['.cmd', '.exe', ''] : [''];
  for (const dir of candidateDirectories()) {
    for (const suffix of suffixes) {
      const candidate = join(dir, `${name}${suffix}`);
      if (existsSync(candidate)) return candidate;
    }
  }
  return null;
}

function run(binary: string, args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(binary, args, { timeout: PROBE_TIMEOUT_MS, windowsHide: true }, (error, stdout, stderr) => {
      const code = error && typeof (error as { code?: unknown }).code === 'number' ? (error as { code: number }).code : error ? 1 : 0;
      resolve({ code, stdout: String(stdout ?? ''), stderr: String(stderr ?? '') });
    });
  });
}

function hasStoredLogin(provider: LocalHarnessProvider): boolean {
  const home = homedir();
  if (provider === 'claude-code') {
    return (
      existsSync(join(home, '.claude', '.credentials.json')) ||
      existsSync(join(home, '.claude.json')) ||
      !!process.env['ANTHROPIC_API_KEY']
    );
  }
  return existsSync(join(home, '.codex', 'auth.json')) || !!process.env['OPENAI_API_KEY'];
}

export async function detectInstallations(): Promise<LocalHarnessInstallation[]> {
  const found: LocalHarnessInstallation[] = [];

  for (const provider of LOCAL_HARNESS_PROVIDERS) {
    const binaryPath = resolveBinary(HARNESS_BINARIES[provider]);
    if (!binaryPath) continue;

    const { code, stdout, stderr } = await run(binaryPath, ['--version']).catch(() => ({
      code: 1,
      stdout: '',
      stderr: '',
    }));
    const version = (stdout || stderr).trim().split('\n')[0] ?? '';
    const authenticated = hasStoredLogin(provider);

    found.push({ provider, binaryPath, version, authenticated });
    log.info(
      `[LocalHarness] detected ${provider} at ${binaryPath} version="${version}" authenticated=${authenticated} probeExit=${code}`,
    );
  }

  return found;
}
