import type { TransitKeyring } from '@xyne/shared';

/**
 * The session's keyring for the API client (code outside React): set only under API client
 * encryption, so with it off no request body is encrypted and no response is decrypted.
 */
let activeKeyring: TransitKeyring | null = null;

export function setActiveKeyring(keyring: TransitKeyring | null): void {
  activeKeyring = keyring;
}

export function getActiveKeyring(): TransitKeyring | null {
  return activeKeyring;
}
