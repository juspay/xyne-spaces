import type { TransitKeyring } from '@xyne/shared';

/** The session's keyring once the encryption bootstrap has one, for code outside React (apiClient). */
let activeKeyring: TransitKeyring | null = null;

export function setActiveKeyring(keyring: TransitKeyring | null): void {
  activeKeyring = keyring;
}

export function getActiveKeyring(): TransitKeyring | null {
  return activeKeyring;
}
