// User-scoped Hindsight memory-bank calls for the Digital Twin
// (`/api/v1/memory/banks/digital-twin/...`). Unlike the control family these use
// cookie auth + a `?userTag=user:<id>` query param (NOT the x-user-id header),
// and their list endpoint returns `{ success, data: [...], total }` where the
// array is `data` and `total` is a sibling — so they route through the raw
// `clawRequest` (which does not unwrap `.data`), mirroring `clawMemoryService.ts`.

import { clawRequest } from './clawRequest';
import type {
  DigitalTwinSubsystemEdge,
  DigitalTwinSubsystemNode,
  MemoryBankMemory,
  MemoryBankStats,
  MemoryRange,
  RecallResult,
} from './digitalTwinTypes';

const BANK = '/api/v1/memory/banks/digital-twin';
const userTag = (userId: string): string => `user:${userId}`;

export async function listDigitalTwinMemories(
  userId: string,
  opts: { limit?: number; offset?: number; subsystem?: string } = {},
): Promise<{ memories: MemoryBankMemory[]; total: number }> {
  const params = new URLSearchParams({ userTag: userTag(userId) });
  if (opts.limit !== undefined) params.set('limit', String(opts.limit));
  if (opts.offset !== undefined) params.set('offset', String(opts.offset));
  if (opts.subsystem) params.set('subsystem', opts.subsystem);
  const body = await clawRequest<{ success: boolean; data: MemoryBankMemory[]; total?: number }>(
    `${BANK}/memories?${params.toString()}`,
  );
  if (!body.success) throw new Error('Failed to list memories');
  return { memories: body.data ?? [], total: body.total ?? body.data?.length ?? 0 };
}

export async function deleteDigitalTwinMemory(
  userId: string,
  hindsightMemoryId: string,
): Promise<void> {
  const qs = `?userTag=${encodeURIComponent(userTag(userId))}`;
  await clawRequest<unknown>(`${BANK}/memories/${encodeURIComponent(hindsightMemoryId)}${qs}`, {
    method: 'DELETE',
  });
}

export async function getDigitalTwinStats(
  userId: string,
  range: MemoryRange = '7d',
): Promise<MemoryBankStats> {
  const qs = `?userTag=${encodeURIComponent(userTag(userId))}&range=${range}`;
  const body = await clawRequest<{ success: boolean; data: MemoryBankStats }>(`${BANK}/stats${qs}`);
  if (!body.success) throw new Error('Failed to get stats');
  return body.data;
}

export async function recallDigitalTwinMemory(
  userId: string,
  query: string,
  budget?: 'low' | 'mid' | 'high',
): Promise<RecallResult[]> {
  const qs = `?userTag=${encodeURIComponent(userTag(userId))}`;
  const body = await clawRequest<{
    success: boolean;
    data: { provider: string; memories: RecallResult[] };
  }>(`${BANK}/recall${qs}`, {
    method: 'POST',
    body: JSON.stringify({ query, ...(budget ? { budget } : {}) }),
  });
  if (!body.success) throw new Error('Recall failed');
  return body.data.memories ?? [];
}

export async function getDigitalTwinSubsystemGraph(
  userId: string,
): Promise<{ subsystems: DigitalTwinSubsystemNode[]; edges: DigitalTwinSubsystemEdge[] }> {
  const qs = `?userTag=${encodeURIComponent(userTag(userId))}`;
  const body = await clawRequest<{
    success: boolean;
    data: { subsystems?: DigitalTwinSubsystemNode[]; edges?: DigitalTwinSubsystemEdge[] };
  }>(`${BANK}/subsystem-graph${qs}`);
  if (!body.success) throw new Error('Failed to get graph');
  return { subsystems: body.data.subsystems ?? [], edges: body.data.edges ?? [] };
}
