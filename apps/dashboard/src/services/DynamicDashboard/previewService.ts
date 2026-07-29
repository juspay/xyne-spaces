import type { AxiosError } from 'axios';
import type { QueryVisualizationType } from '@xyne/shared';
import { apiInstance } from '../clients/apiClient';
import { ComponentDataError } from './componentDataService';
import type { ShapeMismatchDetails } from './componentDataService';

export interface PreviewResponse {
  visualType?: QueryVisualizationType;
  data: unknown;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  debug?: { sql: string; params: unknown[] };
  executedAt: string;
}

export async function previewQueryPlan(
  args: {
    plan: unknown;
    visualType?: QueryVisualizationType;
    bypassCache?: boolean;
  },
  signal?: AbortSignal,
): Promise<PreviewResponse> {
  try {
    const response = await apiInstance.post<PreviewResponse>(
      '/dashboard/query/preview',
      args,
      signal ? { signal } : undefined,
    );
    return response.data;
  } catch (e) {
    throw normalizeError(e as AxiosError);
  }
}

function normalizeError(e: AxiosError): ComponentDataError {
  const errWithStatus = e as AxiosError & {
    status?: number;
    responseData?: unknown;
  };
  const body = (errWithStatus.responseData ?? e.response?.data ?? {}) as {
    error?: string;
    message?: string;
    details?: ShapeMismatchDetails;
  };
  const status = errWithStatus.status ?? e.response?.status ?? 0;
  return new ComponentDataError({
    status,
    code: body.error ?? 'UnknownError',
    message: body.message ?? e.message ?? 'Preview failed',
    ...(body.details ? { details: body.details } : {}),
  });
}
