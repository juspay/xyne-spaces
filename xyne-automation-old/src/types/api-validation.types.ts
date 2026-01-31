export interface ApiRequestConfig {
  url?: string;
  endpoint?: string;
  host?: string;
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  headers?: Record<string, string>;
  payload?: any;
  timeout?: number;
  proxy?: string;
  responseContentType?: string;
  checkStatusCode?: boolean;
  isResponseReturnedInRows?: boolean;
}

export interface ApiResponse<T = any> {
  data: T;
  status: number;
  statusText: string;
  headers: Record<string, string>;
  url: string;
  method: string;
  timestamp: string;
}

export interface ApiValidationOptions {
  expectedStatusCode?: number;
  expectedContentType?: string;
  requiredKeys?: string[];
  forbiddenKeys?: string[];
  customValidations?: Array<(response: ApiResponse) => boolean | string>;
}

export interface LoginCredentials {
  username: string;
  password: string;
  token?: string;
  host?: string;
}

export interface AuthTokenResponse {
  token: string;
  statusCode: number;
  response: any;
}

export interface NestedJsonConfig {
  response: any;
  key1: string;
  key2: string;
  isAssertExpectedValue?: boolean;
  expectedKey2Value?: any;
}

export interface ApiValidationResult {
  success: boolean;
  message: string;
  details?: any;
  actualValue?: any;
  expectedValue?: any;
}

export interface ApiCallSummary {
  url: string;
  method: string;
  statusCode: number;
  contentType: string;
  timestamp: string;
  responseTime?: number;
  success: boolean;
  errorMessage?: string;
}

export interface ProxyConfig {
  http?: string;
  https?: string;
}

export interface RequestOptions {
  timeout?: number;
  retries?: number;
  retryDelay?: number;
  followRedirects?: boolean;
  validateSSL?: boolean;
}
