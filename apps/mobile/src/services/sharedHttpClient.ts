import type { HttpClient } from '@xyne/shared/hooks';
import { apiGet, apiPost } from './apiClient';

export const httpClient: HttpClient = {
  get: <T>(path: string): Promise<T> => apiGet<T>(path),
  post: <T>(path: string, body?: unknown): Promise<T> =>
    apiPost<T>(path, body as Parameters<typeof apiPost>[1]),
};
