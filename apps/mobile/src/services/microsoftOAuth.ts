import 'react-native-get-random-values';
import * as WebBrowser from 'expo-web-browser';
import { sha256 } from '@noble/hashes/sha2';
import { utf8ToBytes } from '@noble/hashes/utils';
import {
  MICROSOFT_CLIENT_ID,
  MICROSOFT_REDIRECT_URI,
  MICROSOFT_SCOPES,
  MICROSOFT_TENANT_ID,
} from '../config';

type CryptoWithRandom = {
  getRandomValues<T extends Uint8Array>(array: T): T;
};

export interface MicrosoftAuthorizationCodeResult {
  code: string;
  codeVerifier: string;
  redirectUri: string;
}

const BASE64_URL_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

WebBrowser.maybeCompleteAuthSession();

function randomBytes(length: number): Uint8Array {
  const cryptoObject = globalThis.crypto as CryptoWithRandom | undefined;
  if (!cryptoObject?.getRandomValues) {
    throw new Error('Secure random generator is not available for Microsoft sign-in.');
  }

  return cryptoObject.getRandomValues(new Uint8Array(length));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let output = '';

  for (let index = 0; index < bytes.length; index += 3) {
    const byte1 = bytes[index] ?? 0;
    const byte2 = bytes[index + 1] ?? 0;
    const byte3 = bytes[index + 2] ?? 0;
    const hasByte2 = index + 1 < bytes.length;
    const hasByte3 = index + 2 < bytes.length;
    const combined = (byte1 << 16) | (byte2 << 8) | byte3;

    output += BASE64_URL_ALPHABET[(combined >> 18) & 0x3f] ?? '';
    output += BASE64_URL_ALPHABET[(combined >> 12) & 0x3f] ?? '';
    if (hasByte2) {
      output += BASE64_URL_ALPHABET[(combined >> 6) & 0x3f] ?? '';
    }
    if (hasByte3) {
      output += BASE64_URL_ALPHABET[combined & 0x3f] ?? '';
    }
  }

  return output;
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64UrlEncode(randomBytes(32));
  const challenge = base64UrlEncode(sha256(utf8ToBytes(verifier)));
  return { verifier, challenge };
}

function readCallbackParam(url: string, name: string): string | null {
  const parsed = new URL(url);
  const queryValue = parsed.searchParams.get(name);
  if (queryValue) {
    return queryValue;
  }

  const hash = parsed.hash.startsWith('#') ? parsed.hash.slice(1) : parsed.hash;
  if (!hash) {
    return null;
  }
  return new URLSearchParams(hash).get(name);
}

function buildAuthorizeUrl(input: { state: string; codeChallenge: string }): string {
  if (!MICROSOFT_CLIENT_ID) {
    throw new Error('Microsoft sign-in is not configured. Missing Microsoft client ID.');
  }

  if (!MICROSOFT_TENANT_ID) {
    throw new Error('Microsoft sign-in is not configured. Missing Microsoft tenant ID.');
  }

  const params = new URLSearchParams();
  params.append('client_id', MICROSOFT_CLIENT_ID);
  params.append('response_type', 'code');
  params.append('redirect_uri', MICROSOFT_REDIRECT_URI);
  params.append('response_mode', 'query');
  params.append('scope', MICROSOFT_SCOPES.join(' '));
  params.append('state', input.state);
  params.append('code_challenge', input.codeChallenge);
  params.append('code_challenge_method', 'S256');
  params.append('prompt', 'select_account');

  return `https://login.microsoftonline.com/${encodeURIComponent(
    MICROSOFT_TENANT_ID,
  )}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function requestMicrosoftAuthorizationCode(): Promise<MicrosoftAuthorizationCodeResult> {
  const state = base64UrlEncode(randomBytes(16));
  const pkce = createPkcePair();
  const authorizeUrl = buildAuthorizeUrl({ state, codeChallenge: pkce.challenge });

  const result = await WebBrowser.openAuthSessionAsync(authorizeUrl, MICROSOFT_REDIRECT_URI, {
    preferEphemeralSession: true,
    showTitle: false,
    enableDefaultShareMenuItem: false,
  });

  if (result.type !== 'success') {
    throw new Error(
      result.type === 'cancel'
        ? 'Microsoft sign-in was cancelled.'
        : 'Microsoft sign-in did not complete.',
    );
  }

  const error = readCallbackParam(result.url, 'error');
  if (error) {
    const description =
      readCallbackParam(result.url, 'error_description') ||
      readCallbackParam(result.url, 'message') ||
      error;
    throw new Error(description);
  }

  const returnedState = readCallbackParam(result.url, 'state');
  if (returnedState !== state) {
    throw new Error('Microsoft sign-in state validation failed. Please try again.');
  }

  const code = readCallbackParam(result.url, 'code');
  if (!code) {
    throw new Error('Microsoft did not return an authorization code.');
  }

  return {
    code,
    codeVerifier: pkce.verifier,
    redirectUri: MICROSOFT_REDIRECT_URI,
  };
}
