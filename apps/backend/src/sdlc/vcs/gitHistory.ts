import { execFile } from 'child_process';
import { mkdtemp, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { promisify } from 'util';
import type { FirstParentHistory } from './types';
import { VcsProviderError } from './types';

const execFileAsync = promisify(execFile);
const GIT_HISTORY_TIMEOUT_MS = 5 * 60_000;
const GIT_HISTORY_MAX_BUFFER = 64 * 1024 * 1024;

export interface GitRunner {
  runGit(
    args: string[],
    options: { env: NodeJS.ProcessEnv; timeout: number; maxBuffer: number }
  ): Promise<{ stdout: string }>;
  makeTempDirectory(prefix: string): Promise<string>;
  removeTempDirectory(path: string): Promise<void>;
}

export const defaultGitRunner: GitRunner = {
  async runGit(args, options) {
    const result = await execFileAsync('git', args, options);
    return { stdout: String(result.stdout) };
  },
  makeTempDirectory: mkdtemp,
  async removeTempDirectory(path) {
    await rm(path, { recursive: true, force: true });
  },
};

// Read with git: neither GitHub nor Bitbucket Data Center can filter commits to first parents.
export async function listFirstParentHistoryWithGit(
  runner: GitRunner,
  input: {
    cloneUrl: string;
    branch: string;
    authorization?: { url: string; header: string };
    errorPrefix: string;
  }
): Promise<FirstParentHistory> {
  const directory = await runner.makeTempDirectory(join(tmpdir(), 'xyne-sdlc-wiki-history-'));
  const env: NodeJS.ProcessEnv = { ...process.env, GIT_TERMINAL_PROMPT: '0' };
  if (input.authorization) {
    env.GIT_CONFIG_COUNT = '1';
    env.GIT_CONFIG_KEY_0 = `http.${input.authorization.url}.extraheader`;
    env.GIT_CONFIG_VALUE_0 = input.authorization.header;
  }
  const options = { env, timeout: GIT_HISTORY_TIMEOUT_MS, maxBuffer: GIT_HISTORY_MAX_BUFFER };
  try {
    await runner.runGit(['init', '--bare', directory], options);
    await runner.runGit(
      [
        '--git-dir',
        directory,
        'fetch',
        '--force',
        '--no-tags',
        // Planning needs commit ancestry only. Omitting historical trees and
        // blobs keeps 7k+ commit monorepos bounded; the agent sandbox fetches
        // code separately for the selected commits.
        '--filter=tree:0',
        input.cloneUrl,
        `+refs/heads/${input.branch}:refs/remotes/origin/wiki-base`,
      ],
      options
    );
    const { stdout } = await runner.runGit(
      ['--git-dir', directory, 'rev-list', '--first-parent', '--reverse', 'refs/remotes/origin/wiki-base'],
      options
    );
    const shas = stdout
      .split(/\r?\n/)
      .map((value) => value.trim().toLowerCase())
      .filter(Boolean);
    if (shas.length === 0 || shas.some((sha) => !/^[0-9a-f]{40}$/.test(sha))) {
      throw new VcsProviderError(
        `${input.errorPrefix}_HISTORY_INVALID`,
        'Git returned an invalid base-branch history',
        502
      );
    }
    return {
      targetHeadSha: shas[shas.length - 1]!,
      commits: shas.map((sha, index) => ({
        sha,
        parentSha: index === 0 ? null : shas[index - 1]!,
      })),
    };
  } catch (error) {
    if (error instanceof VcsProviderError) throw error;
    throw new VcsProviderError(
      `${input.errorPrefix}_GIT_HISTORY_FAILED`,
      `Git could not read first-parent history for branch ${input.branch}`,
      503,
      true
    );
  } finally {
    await runner.removeTempDirectory(directory).catch(() => undefined);
  }
}
