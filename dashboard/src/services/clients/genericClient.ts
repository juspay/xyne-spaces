import axios, { AxiosInstance } from 'axios';

/**
 * Bare axios instance for fetching arbitrary resources (external URLs,
 * CDN assets, pre-signed download links, etc.) that must NOT carry our
 * auth cookies, request interceptors, or custom headers.
 *
 * Use `apiInstance` from apiClient.ts for authenticated backend API calls.
 */
export const genericInstance: AxiosInstance = axios.create();
