import { AffinityService, type HttpClient } from '@xyne/shared/hooks';
import { apiInstance } from './clients/apiClient';

export const axiosHttpClient: HttpClient = {
  async get<T>(path: string, options?: { signal?: AbortSignal; timeout?: number }): Promise<T> {
    const config: {
      signal?: AbortSignal;
      timeout?: number;
    } = {};
    if (options?.signal) config.signal = options.signal;
    if (options?.timeout !== undefined) config.timeout = options.timeout;
    const response = await apiInstance.get<T>(path, config);
    return response.data;
  },
  async post<T>(
    path: string,
    body?: unknown,
    options?: { signal?: AbortSignal; timeout?: number },
  ): Promise<T> {
    const config: {
      signal?: AbortSignal;
      timeout?: number;
    } = {};
    if (options?.signal) config.signal = options.signal;
    if (options?.timeout !== undefined) config.timeout = options.timeout;
    const response = await apiInstance.post<T>(path, body, config);
    return response.data;
  },
};

export const affinityService = new AffinityService(axiosHttpClient);
