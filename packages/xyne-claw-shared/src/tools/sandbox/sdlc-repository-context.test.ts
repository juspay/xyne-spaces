import { describe, expect, it } from 'vitest';
import type { ToolExecutionContext } from '../types.js';
import {
  resolveDynamicSdlcRepositoryConfig,
  sandboxRepoSetup,
} from './tools.js';

function context(meta: Record<string, string>): ToolExecutionContext {
  return { config: {}, meta };
}

describe('SDLC sandbox repository context', () => {
  it('builds a dynamic repository that overrides any model-selected static repo', () => {
    const resolved = resolveDynamicSdlcRepositoryConfig(context({
      sdlcRepositoryId: 'repo-pets',
      sdlcRepositoryName: 'Pets',
      sdlcRepositoryUrl: 'https://github.com/github-samples/pets-workshop.git',
      sdlcRepositoryBaseBranch: 'main',
    }));

    expect(resolved?.name).toBe('Pets');
    expect(resolved?.config.repoUrl).toBe('https://github.com/github-samples/pets-workshop.git');
    expect(resolved?.config.defaultBranch).toBe('main');
    expect(resolved?.config.template).toBe('kata-workspace-template');
  });

  it('rejects a scheme-less SDLC URL instead of falling back to lamf', async () => {
    const result = await sandboxRepoSetup.execute(
      { repoName: 'lamf' },
      context({
        sdlcRepositoryId: 'repo-pets',
        sdlcRepositoryName: 'Pets',
        sdlcRepositoryUrl: 'github.com/github-samples/pets-workshop',
        sdlcRepositoryBaseBranch: 'main',
      }),
    );

    expect(result).toBe(
      'Error: Valid SDLC repository context is required; refusing to fall back to a static repository.',
    );
  });

  it('tells the agent to pick a repository when none is attached or selected', async () => {
    const result = await sandboxRepoSetup.execute(
      { repoName: 'lamf' },
      context({ requireSdlcRepository: 'true' }),
    );

    expect(result).toContain('No SDLC repository selected');
    expect(result).toContain('spaces-sdlc-list-repositories');
  });

  it('still refuses a static fallback when a selected repository cannot resolve', async () => {
    const result = await sandboxRepoSetup.execute(
      { repoName: 'lamf', repoId: 'repo-unreachable' },
      context({ requireSdlcRepository: 'true', userId: 'user-1', conversationId: 'conv-1' }),
    );

    expect(result).toContain('Error:');
    expect(result).not.toContain('No SDLC repository selected');
  });

  it('rejects runtime credential bootstrap for every other agent slug before sandbox access', async () => {
    const result = await sandboxRepoSetup.execute(
      { repoName: 'ignored', write: true, branchName: 'feature/test' },
      context({
        agentSlug: 'another-agent',
        sdlcRepositoryId: 'repo-pets',
        sdlcRepositoryName: 'Pets',
        sdlcRepositoryUrl: 'https://github.com/github-samples/pets-workshop.git',
        sdlcRepositoryBaseBranch: 'main',
        sdlcRepositoryWrite: 'true',
        sdlcRuntimeCredentialOperation: 'PUSH',
        sdlcExecutionId: 'execution-1',
        sdlcSessionId: 'session-1',
      }),
    );

    expect(result).toBe(
      'Error: SDLC runtime credentials are restricted to the sdlc-agent profile.',
    );
  });
});
