import { useQuery, type UseQueryResult } from '@tanstack/react-query';
import { clawApiRequest } from '@/services/claw/clawRequest';

/** A selectable sandbox repo setup for the "Sandbox repository" picker. */
export interface SandboxRepoOption {
  readonly key: string;
  readonly name: string;
  readonly description?: string;
}

export function listSandboxRepos(): Promise<SandboxRepoOption[]> {
  return clawApiRequest<SandboxRepoOption[]>('/sandbox/repos');
}

export function useSandboxRepos(): UseQueryResult<SandboxRepoOption[], Error> {
  return useQuery({
    queryKey: ['claw-sandbox-repos'],
    queryFn: listSandboxRepos,
    staleTime: 5 * 60 * 1000,
  });
}

export interface SandboxDraft {
  sandboxRepo: string;
  forceReadOnlySandbox: boolean;
  researchProductId: string;
  researchRepositoryId: string;
}

interface SandboxShape {
  sandboxRepo?: unknown;
  forceReadOnlySandbox?: unknown;
  product_id?: unknown;
  repository_id?: unknown;
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');

export function readSandboxDraft(config: Record<string, unknown> | undefined): SandboxDraft {
  const c = (config ?? {}) as SandboxShape;
  return {
    sandboxRepo: str(c.sandboxRepo),
    forceReadOnlySandbox: c.forceReadOnlySandbox === true,
    researchProductId: str(c.product_id),
    researchRepositoryId: str(c.repository_id),
  };
}

export function applySandbox(
  config: Record<string, unknown> | undefined,
  draft: SandboxDraft,
): Record<string, unknown> {
  const next: Record<string, unknown> = { ...(config ?? {}) };

  if (draft.sandboxRepo) next['sandboxRepo'] = draft.sandboxRepo;
  else delete next['sandboxRepo'];

  if (draft.forceReadOnlySandbox) next['forceReadOnlySandbox'] = true;
  else delete next['forceReadOnlySandbox'];

  if (draft.researchProductId) next['product_id'] = draft.researchProductId;
  else delete next['product_id'];

  if (draft.researchRepositoryId) next['repository_id'] = draft.researchRepositoryId;
  else delete next['repository_id'];

  return next;
}
