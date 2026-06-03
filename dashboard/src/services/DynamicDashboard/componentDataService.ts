import type { AxiosError } from 'axios';
import type { QueryVisualizationType } from '@xyne/shared';
import { apiInstance } from '../clients/apiClient';

export interface ComponentDataResponse {
  componentId: string;
  visualType?: QueryVisualizationType;
  data: unknown;
  rows: Array<Record<string, unknown>>;
  rowCount: number;
  executedAt: string;
}

export interface ShapeMismatchDetails {
  componentType?: QueryVisualizationType;
  issues?: Array<{ path: Array<string | number>; message: string; code?: string }>;
  rowCount?: number;
  sample?: Array<Record<string, unknown>>;
}

export class ComponentDataError extends Error {
  status: number;
  code: string;
  details?: ShapeMismatchDetails;

  constructor(args: {
    status: number;
    code: string;
    message: string;
    details?: ShapeMismatchDetails;
  }) {
    super(args.message);
    this.name = 'ComponentDataError';
    this.status = args.status;
    this.code = args.code;
    if (args.details) this.details = args.details;
  }
}

export async function fetchComponentData(
  componentId: string,
  bypassCache: boolean = false,
  signal?: AbortSignal,
): Promise<ComponentDataResponse> {
  try {
    const response = await apiInstance.get<ComponentDataResponse>(
      `/dashboard/query/component/${componentId}${bypassCache ? '?bypassCache=1' : ''}`,
      signal ? { signal } : undefined,
    );
    return response.data;
  } catch (e) {
    throw normalizeError(e as AxiosError);
  }
}

function normalizeError(e: AxiosError): ComponentDataError {
  const status = e.response?.status ?? 0;
  const body = (e.response?.data ?? {}) as {
    error?: string;
    message?: string;
    details?: ShapeMismatchDetails;
  };
  return new ComponentDataError({
    status,
    code: body.error ?? 'UnknownError',
    message: body.message ?? e.message ?? 'Failed to load component data',
    ...(body.details ? { details: body.details } : {}),
  });
}
