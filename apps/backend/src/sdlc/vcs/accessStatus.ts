import type {
  CapabilityEvidence,
  RepositoryAccessStatus,
  RepositoryVisibility,
  VcsCapability,
} from './types';
import { VcsProviderError } from './types';

const CAPABILITIES: VcsCapability[] = [
  'READ_REPOSITORY',
  'PUSH_BRANCH',
  'CREATE_PULL_REQUEST',
];

export function blockedCapabilities(error: VcsProviderError): CapabilityEvidence[] {
  return CAPABILITIES.map((capability) => ({
    capability,
    state: 'UNAVAILABLE' as const,
    source: error.code,
    detail: error.message,
  }));
}

export function readCapabilities(value: unknown): CapabilityEvidence[] {
  if (!Array.isArray(value)) return [];
  const result: CapabilityEvidence[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object' || Array.isArray(item)) continue;
    const record = item as Record<string, unknown>;
    if (typeof record.capability === 'string' && typeof record.state === 'string') {
      result.push(record as unknown as CapabilityEvidence);
    }
  }
  return result;
}

export function deriveAccessStatus(value: unknown): {
  status: RepositoryAccessStatus;
  errorMessage: string | null;
  visibility: RepositoryVisibility | null;
  capabilities: CapabilityEvidence[];
} {
  const capabilities = readCapabilities(value);
  const read = capabilities.find((item) => item.capability === 'READ_REPOSITORY');
  if (!read) {
    return { status: 'NOT_CHECKED', errorMessage: null, visibility: null, capabilities };
  }
  if (read.state === 'PROVEN') {
    return {
      status: 'READY',
      errorMessage: null,
      visibility: read.visibility ?? null,
      capabilities,
    };
  }
  return {
    status: 'BLOCKED',
    errorMessage: read.detail || 'Repository access check failed',
    visibility: read.visibility ?? null,
    capabilities,
  };
}
