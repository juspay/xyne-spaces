// User-scoped Hindsight memory-bank calls for the Digital Twin
// (`/api/v1/memory/banks/digital-twin/...`). Unlike the control family these use
// cookie auth + a `?userTag=user:<id>` query param. The backend also verifies
// that the `x-user-id` header matches that tag, so every request sends both.
// Their list endpoint returns `{ success, data: [...], total }` where the array
// is `data` and `total` is a sibling — so they route through the raw
// `clawRequest` (which does not unwrap `.data`).

import { clawRequest } from './clawRequest';
import * as demo from './digitalTwinDemo';
import type {
  DigitalTwinSubsystemEdge,
  DigitalTwinSubsystemNode,
  MemoryBankMemory,
  MemoryBankStats,
  MemoryRange,
  RecallResult,
} from './digitalTwinTypes';

const BANK = '/api/v1/memory/banks/digital-twin';
const USER_ID_HEADER = 'x-user-id';
const userTag = (userId: string): string => `user:${userId}`;
const userHeaders = (userId: string): Record<string, string> => ({ [USER_ID_HEADER]: userId });

export async function listDigitalTwinMemories(
  userId: string,
  opts: {
    limit?: number;
    offset?: number;
    subsystem?: string;
    subsystems?: string[];
    search?: string;
  } = {},
): Promise<{ memories: MemoryBankMemory[]; total: number }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoListMemories(opts);
  const params = new URLSearchParams({ userTag: userTag(userId) });
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  const subsystems = opts.subsystems?.length
    ? opts.subsystems
    : opts.subsystem
      ? [opts.subsystem]
      : [];
  if (subsystems.length === 1) params.set('subsystem', subsystems[0]!);
  else if (subsystems.length > 1) params.set('subsystems', subsystems.join(','));
  if (opts.search?.trim()) params.set('search', opts.search.trim());
  const body = await clawRequest<{ success: boolean; data: MemoryBankMemory[]; total?: number }>(
    `${BANK}/memories?${params.toString()}`,
    { headers: userHeaders(userId) },
  );
  if (!body.success) throw new Error('Failed to list memories');
  return { memories: body.data ?? [], total: body.total ?? body.data?.length ?? 0 };
}

export async function deleteDigitalTwinMemory(
  userId: string,
  hindsightMemoryId: string,
): Promise<void> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoDeleteMemory(hindsightMemoryId);
  const qs = `?userTag=${encodeURIComponent(userTag(userId))}`;
  await clawRequest<unknown>(`${BANK}/memories/${encodeURIComponent(hindsightMemoryId)}${qs}`, {
    method: 'DELETE',
    headers: userHeaders(userId),
  });
}

export async function getDigitalTwinStats(
  userId: string,
  range: MemoryRange = '7d',
): Promise<MemoryBankStats> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoGetStats(range);
  const qs = `?userTag=${encodeURIComponent(userTag(userId))}&range=${range}`;
  const body = await clawRequest<{ success: boolean; data: MemoryBankStats }>(
    `${BANK}/stats${qs}`,
    {
      headers: userHeaders(userId),
    },
  );
  if (!body.success) throw new Error('Failed to get stats');
  return body.data;
}

export async function recallDigitalTwinMemory(
  userId: string,
  query: string,
  budget?: 'low' | 'mid' | 'high',
): Promise<RecallResult[]> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoRecall(query);
  const qs = `?userTag=${encodeURIComponent(userTag(userId))}`;
  const body = await clawRequest<{
    success: boolean;
    data: { provider: string; memories: RecallResult[] };
  }>(`${BANK}/recall${qs}`, {
    method: 'POST',
    headers: userHeaders(userId),
    body: JSON.stringify({ query, ...(budget ? { budget } : {}) }),
  });
  if (!body.success) throw new Error('Recall failed');
  return body.data.memories ?? [];
}

export async function getDigitalTwinSubsystemGraph(
  userId: string,
): Promise<{ subsystems: DigitalTwinSubsystemNode[]; edges: DigitalTwinSubsystemEdge[] }> {
  if (demo.isDigitalTwinDemoMode()) return demo.demoGetGraph();
  const qs = `?userTag=${encodeURIComponent(userTag(userId))}`;
  const body = await clawRequest<{
    success: boolean;
    data: { subsystems?: DigitalTwinSubsystemNode[]; edges?: DigitalTwinSubsystemEdge[] };
  }>(`${BANK}/subsystem-graph${qs}`, {
    headers: userHeaders(userId),
  });
  if (!body.success) throw new Error('Failed to get graph');
  return { subsystems: body.data.subsystems ?? [], edges: body.data.edges ?? [] };
}
