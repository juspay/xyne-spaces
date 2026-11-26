import { getXErrorCode } from '../services/clients/socialMediaDeskApi';
import { getApiErrorMessage } from './apiError';

/** Messages for the backend's X error codes (OAuth redirect `socialMediaError` and 4xx `code`). */
const X_ERROR_MESSAGES: Record<string, string> = {
  x_invalid_api_key:
    'X rejected the API Key and Secret. Copy them again from Keys and tokens in the X Developer Console.',
  x_invalid_client:
    'X rejected the OAuth 2.0 Client ID and Secret. Copy them again from Keys and tokens, and check the app is a confidential client (Web App).',
  x_missing_scopes:
    'The X app did not grant every permission. Set App permissions to "Read and write and Direct message", then connect again.',
  x_no_credits:
    'Your X developer account is out of credits. Buy credits in the X Developer Console, then connect again.',
  x_subscription_failed:
    'X did not allow this app to receive account events. Check the app permissions and try again.',
  x_auth_denied: 'X authorization was cancelled.',
  x_invalid_state: 'The X sign-in link expired. Please start again.',
  x_user_removed: 'Your access to this workspace changed during sign-in. Please start again.',
  x_account_mismatch:
    'You signed in to a different X account than the one being reconnected. Sign in to that account on x.com and try again.',
  x_account_already_connected: 'This X account is already connected to a desk.',
  x_keys_required: 'Enter the X app keys for this account.',
  x_unreachable:
    'The server cannot reach X (api.x.com). Ask your admin to allow outbound access to api.x.com, then try again.',
  x_connection_failed: 'Failed to connect X. Please try again.',
};

/** Message for an error code from the OAuth redirect (`?socialMediaError=…`). */
export function xRedirectErrorMessage(code: string): string {
  return X_ERROR_MESSAGES[code] ?? 'X connection error. Please try again.';
}

/** Message for a failed X API call: the code's message, else the backend's text, else `fallback`. */
export function xErrorMessage(error: unknown, fallback: string): string {
  const code = getXErrorCode(error);
  return (code && X_ERROR_MESSAGES[code]) || getApiErrorMessage(error, fallback);
}
