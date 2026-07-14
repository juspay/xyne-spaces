// Digital Twin control endpoints (`/api/v1/digital-twin/...`). These use the
// standard `{ success, data }` envelope and `x-user-id` auth, so they route
// through `clawApiRequest` (which prepends `/api/v1`, adds the header, and
// unwraps `.data`). The user-scoped Hindsight memory-bank calls live in
// `digitalTwinMemoryService.ts`.

import { clawApiRequest } from './clawRequest';
import type {
  DigitalTwinCandidate,
  DigitalTwinClusterPreview,
  DigitalTwinEstimate,
  DigitalTwinMetrics,
  DigitalTwinStatus,
} from './digitalTwinTypes';

export function getDigitalTwinStatus(userId: string): Promise<DigitalTwinStatus> {
  return clawApiRequest<DigitalTwinStatus>('/digital-twin/status', { userId });
}

export function getDigitalTwinEstimate(
  userId: string,
  from: string,
  to: string,
): Promise<DigitalTwinEstimate> {
  const qs = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return clawApiRequest<DigitalTwinEstimate>(`/digital-twin/estimate${qs}`, { userId });
}

export function enableDigitalTwin(
  userId: string,
  backfill: { from: string; to: string } | null,
): Promise<{ enabled: boolean; enabledAt: string; backfillJobIds: string[] }> {
  return clawApiRequest('/digital-twin/enable', {
    userId,
    method: 'POST',
    body: JSON.stringify({ backfill }),
  });
}

export function disableDigitalTwin(
  userId: string,
  deleteMemories: boolean,
): Promise<{
  disabled: boolean;
  deleting: boolean;
  cancelledJobs: number;
  deletedCandidates?: number;
  deletedHindsight?: number;
}> {
  return clawApiRequest('/digital-twin/disable', {
    userId,
    method: 'POST',
    body: JSON.stringify({ deleteMemories }),
  });
}

export function listDigitalTwinClusters(
  userId: string,
): Promise<{ clusters: DigitalTwinClusterPreview[] }> {
  return clawApiRequest('/digital-twin/clusters', { userId });
}

export function getDigitalTwinCluster(
  userId: string,
  subsystem: string,
): Promise<{ subsystem: string; candidates: DigitalTwinCandidate[] }> {
  return clawApiRequest(`/digital-twin/clusters/${encodeURIComponent(subsystem)}`, { userId });
}

export function approveDigitalTwinCluster(
  userId: string,
  subsystem: string,
  candidateIds?: string[],
): Promise<{ processing?: boolean; count?: number }> {
  return clawApiRequest(`/digital-twin/clusters/${encodeURIComponent(subsystem)}/approve`, {
    userId,
    method: 'POST',
    body: JSON.stringify(candidateIds ? { candidateIds } : {}),
  });
}

export function patchDigitalTwinCandidate(
  userId: string,
  id: string,
  patch: { editedText?: string; status?: 'approved' | 'rejected' },
): Promise<{ id: string; status: string }> {
  return clawApiRequest(`/digital-twin/candidates/${encodeURIComponent(id)}`, {
    userId,
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function updateDigitalTwinSettings(
  userId: string,
  patch: {
    responseSuffix?: string | null;
    memoryApprovalMode?: 'manual' | 'auto';
    memoryAutoApproveMinScore?: number;
  },
): Promise<{
  responseSuffix: string;
  memoryApprovalMode: string;
  memoryAutoApproveMinScore: number;
}> {
  return clawApiRequest('/digital-twin/settings', {
    userId,
    method: 'PATCH',
    body: JSON.stringify(patch),
  });
}

export function uploadDigitalTwinMd(
  userId: string,
  filename: string,
  content: string,
): Promise<{ filename: string; candidatesCreated: number }> {
  return clawApiRequest('/digital-twin/upload-md', {
    userId,
    method: 'POST',
    body: JSON.stringify({ filename, content }),
  });
}

export function getDigitalTwinMetrics(userId: string, days?: number): Promise<DigitalTwinMetrics> {
  const qs = days ? `?days=${days}` : '';
  return clawApiRequest<DigitalTwinMetrics>(`/digital-twin/metrics${qs}`, { userId });
}
