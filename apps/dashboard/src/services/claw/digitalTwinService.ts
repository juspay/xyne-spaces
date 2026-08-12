// Digital Twin control endpoints (`/api/v1/digital-twin/...`). These use the
// standard `{ success, data }` envelope and `x-user-id` auth, so they route
// through `clawApiRequest` (which prepends `/api/v1`, adds the header, and
// unwraps `.data`). The user-scoped Hindsight memory-bank calls live in
// `digitalTwinMemoryService.ts`.

import { clawApiRequest } from './clawRequest';
import * as demo from './digitalTwinDemo';
import type {
  DigitalTwinCandidate,
  DigitalTwinClusterPreview,
  DigitalTwinEstimate,
  DigitalTwinMetrics,
  DigitalTwinMemoryFile,
  DigitalTwinMemoryFilesResponse,
  DigitalTwinStatus,
  PipelineEventDetail,
  PipelineEventFilters,
  PipelineEventsPage,
} from './digitalTwinTypes';

export function getDigitalTwinStatus(userId: string): Promise<DigitalTwinStatus> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoGetStatus();
  return clawApiRequest<DigitalTwinStatus>('/digital-twin/status', { userId });
}

export function getDigitalTwinEstimate(
  userId: string,
  from: string,
  to: string,
): Promise<DigitalTwinEstimate> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoGetEstimate();
  const qs = `?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`;
  return clawApiRequest<DigitalTwinEstimate>(`/digital-twin/estimate${qs}`, { userId });
}

export function enableDigitalTwin(
  userId: string,
  backfill: { from: string; to: string } | null,
): Promise<{ enabled: boolean; enabledAt: string; backfillJobIds: string[] }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoEnable();
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
  if (demo.isDigitalTwinDemoMode()) return demo.demoDisable(deleteMemories);
  return clawApiRequest('/digital-twin/disable', {
    userId,
    method: 'POST',
    body: JSON.stringify({ deleteMemories }),
  });
}

export function pauseDigitalTwinBackfill(
  userId: string,
): Promise<{ paused: boolean; pausedSources: number; cancelledJobs: number }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoPause();
  return clawApiRequest('/digital-twin/backfill/pause', {
    userId,
    method: 'POST',
  });
}

export function resumeDigitalTwinBackfill(
  userId: string,
): Promise<{ resumed: number; jobIds: string[] }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoResume();
  return clawApiRequest('/digital-twin/backfill/resume', {
    userId,
    method: 'POST',
  });
}

export function deleteDigitalTwinMemories(
  userId: string,
  opts: { mode: 'all' | 'range'; from?: string; to?: string },
): Promise<{ deleting: boolean; mode?: string }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoDeleteMemories(opts);
  return clawApiRequest('/digital-twin/memories/delete', {
    userId,
    method: 'POST',
    body: JSON.stringify(opts),
  });
}

export function listDigitalTwinClusters(
  userId: string,
): Promise<{ clusters: DigitalTwinClusterPreview[] }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoListClusters();
  return clawApiRequest('/digital-twin/clusters', { userId });
}

export function getDigitalTwinCluster(
  userId: string,
  subsystem: string,
): Promise<{ subsystem: string; candidates: DigitalTwinCandidate[] }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoGetCluster(subsystem);
  return clawApiRequest(`/digital-twin/clusters/${encodeURIComponent(subsystem)}`, { userId });
}

export function approveDigitalTwinCluster(
  userId: string,
  subsystem: string,
  candidateIds?: string[],
): Promise<{ processing?: boolean; count?: number }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoApproveCluster(subsystem, candidateIds);
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
  if (demo.isDigitalTwinDemoMode()) return demo.demoPatchCandidate(id, patch);
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
    respondPolicy?: 'always' | 'learned';
  },
): Promise<{
  responseSuffix: string;
  memoryApprovalMode: string;
  memoryAutoApproveMinScore: number;
  respondPolicy?: string;
}> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoUpdateSettings(patch);
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
  if (demo.isDigitalTwinDemoMode()) return demo.demoUpload(filename, content);
  return clawApiRequest('/digital-twin/upload-md', {
    userId,
    method: 'POST',
    body: JSON.stringify({ filename, content }),
  });
}

export function getDigitalTwinMetrics(userId: string, days?: number): Promise<DigitalTwinMetrics> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoGetMetrics();
  const qs = days ? `?days=${days}` : '';
  return clawApiRequest<DigitalTwinMetrics>(`/digital-twin/metrics${qs}`, { userId });
}

export function listDigitalTwinMemoryFiles(
  userId: string,
): Promise<DigitalTwinMemoryFilesResponse> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoListFiles();
  return clawApiRequest('/digital-twin/memory-files', { userId });
}

export function saveDigitalTwinMemoryFile(
  userId: string,
  name: string,
  content: string,
): Promise<{ file: DigitalTwinMemoryFile; truncated: boolean; maxChars: number }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoSaveFile(name, content);
  return clawApiRequest(`/digital-twin/memory-files/${encodeURIComponent(name)}`, {
    userId,
    method: 'PUT',
    body: JSON.stringify({ content }),
  });
}

export function setDigitalTwinMemoryFileLoad(
  userId: string,
  name: string,
  load: boolean,
): Promise<{ file: DigitalTwinMemoryFile }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoSetFileLoad(name, load);
  return clawApiRequest(`/digital-twin/memory-files/${encodeURIComponent(name)}/load`, {
    userId,
    method: 'POST',
    body: JSON.stringify({ load }),
  });
}

export function deleteDigitalTwinMemoryFile(
  userId: string,
  name: string,
): Promise<{ deleted: boolean }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoDeleteFile(name);
  return clawApiRequest(`/digital-twin/memory-files/${encodeURIComponent(name)}`, {
    userId,
    method: 'DELETE',
  });
}

export function synthesizeDigitalTwin(userId: string): Promise<{ status: string }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoSynthesize();
  return clawApiRequest('/digital-twin/synthesize', {
    userId,
    method: 'POST',
  });
}

export function listDigitalTwinPipelineEvents(
  userId: string,
  filters: PipelineEventFilters = {},
): Promise<PipelineEventsPage> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoListEvents(filters);
  const params = new URLSearchParams();
  if (filters.limit) params.set('limit', String(filters.limit));
  if (filters.before) params.set('before', filters.before);
  if (filters.runType) params.set('runType', filters.runType);
  if (filters.status) params.set('status', filters.status);
  if (filters.sourceKind) params.set('sourceKind', filters.sourceKind);
  const qs = params.toString();
  return clawApiRequest(`/digital-twin/pipeline/events${qs ? `?${qs}` : ''}`, { userId });
}

export function getDigitalTwinPipelineEvent(
  userId: string,
  id: string,
): Promise<PipelineEventDetail> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoGetEvent(id);
  return clawApiRequest(`/digital-twin/pipeline/events/${encodeURIComponent(id)}`, { userId });
}
