import { BrowserContext, Page } from '@playwright/test';

/**
 * Response format types
 */
export type ResponseFormat = 'string' | 'json' | 'array';

/**
 * Authentication state types
 */
export type AuthState = 'logged in' | 'not logged in';

/**
 * Captured API response from browser interactions
 */
export interface CapturedApiResponse {
  status: number;
  statusText: string;
  headers: Record<string, string>;
  body: CapturedResponseBody | null;
  url: string;
}

/**
 * Response body from test auth endpoints
 */
export interface CapturedResponseBody {
  success: boolean;
  message: string;
  user?: TestUserData;
  sessionId?: string;
  error?: string;
}

/**
 * Test user data from auth response
 */
export interface TestUserData {
  id: string;
  email: string;
  name: string;
  isNewUser: boolean;
}

/**
 * Stored user context with browser references
 */
export interface StoredUserContext {
  id: string;
  email: string;
  name: string;
  isNewUser: boolean;
  sessionId: string;
  browserSession: string;
  context: BrowserContext;
  page: Page;
}
