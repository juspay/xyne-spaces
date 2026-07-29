import axios, { AxiosInstance } from 'axios';

import { config } from '@/config';

import { apiLogger } from '@/lib/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ApiResponse<T = any> {
  data: T;
  status: number;
  headers: Record<string, string>;
}

/**
 * Create an axios instance with base configuration
 */
export function createApiClient(baseURL?: string): AxiosInstance {
  const client = axios.create({
    baseURL: baseURL || config.backend.baseUrl,
    timeout: config.timeout / 2,
    headers: {
      'Content-Type': 'application/json',
    },
  });

  // Request interceptor for logging
  client.interceptors.request.use(
    (config) => {
      const url = config.url || '';
      const sanitizedUrl = url.replace(/([?&])(token|key|password|secret)=[^&]*/gi, '*****');
      apiLogger.info(`${config.method?.toUpperCase()} ${sanitizedUrl}`);
      return config;
    },
    (error) => {
      apiLogger.error(`Request error: ${error.code || error.message} ${error.config?.url || ''}`);
      return Promise.reject(error);
    }
  );

  // Response interceptor for logging
  client.interceptors.response.use(
    (response) => {
      apiLogger.info(`Response: ${response.status} ${response.statusText}`);
      return response;
    },
    (error) => {
      apiLogger.error(
        `Response error: ${error.response?.status} ${error.message} ${error.code || ''}`
      );
      return Promise.reject(error);
    }
  );

  return client;
}

/**
 * Create an authenticated API client
 */
export function createAuthenticatedClient(token: string, baseURL?: string): AxiosInstance {
  const client = createApiClient(baseURL);
  client.defaults.headers.common['Authorization'] = `Bearer ${token}`;
  return client;
}

/**
 * Default API client instance
 */
export const apiClient = createApiClient();
