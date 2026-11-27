import { apiInstance } from '../clients/apiClient';
import type { DependencyStrength } from '@xyne/shared';
import type { DependencyBatch } from './types';

export interface DependencySettings {
  strength: DependencyStrength;
  gatedStageId: string | null;
  satisfiedStageId: string | null;
}
const invalidators = new Set<() => void>();
export function subscribeDependencyInvalidation(fn: () => void): () => void {
  invalidators.add(fn);
  return () => {
    invalidators.delete(fn);
  };
}
export function invalidateDependencies(): void {
  invalidators.forEach(fn => fn());
}
async function changed<T>(write: () => Promise<T>): Promise<T> {
  const result = await write();
  invalidateDependencies();
  return result;
}
export const dependencyApi = {
  async read(ticketIds: string[], signal: AbortSignal): Promise<DependencyBatch> {
    return (
      await apiInstance.post<DependencyBatch>('/dependencies/read', { ticketIds }, { signal })
    ).data;
  },
  create(sourceTicketId: string, targetTicketId: string, settings: DependencySettings) {
    return changed(() =>
      apiInstance.post('/dependencies', { sourceTicketId, targetTicketId, ...settings }),
    );
  },
  update(id: string, settings: DependencySettings, reason?: string) {
    return changed(() =>
      apiInstance.patch(`/dependencies/${encodeURIComponent(id)}`, { ...settings, reason }),
    );
  },
  remove(id: string, reason?: string) {
    return changed(() =>
      apiInstance.delete(`/dependencies/${encodeURIComponent(id)}`, { data: { reason } }),
    );
  },
  satisfy(id: string, reason?: string) {
    return changed(() =>
      apiInstance.post(`/dependencies/${encodeURIComponent(id)}/satisfy`, { reason }),
    );
  },
  updateChild(id: string, settings: DependencySettings, reason?: string) {
    return changed(() =>
      apiInstance.patch(`/sub-ticket-gating/${encodeURIComponent(id)}`, {
        strength: settings.strength,
        gatedStageId: settings.gatedStageId,
        reason,
      }),
    );
  },
};
