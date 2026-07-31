/**
 * Platform-agnostic auth adapter interface.
 * Abstracts cookie auth (web) vs token auth (native).
 */
export interface AuthAdapter {
  getAuth(): string | undefined | (() => Promise<string | undefined>);
  refreshAuth(): Promise<boolean>;
  clearAuth(): Promise<void>;
}

export interface AuthContextValues {
  userID: string;
}
