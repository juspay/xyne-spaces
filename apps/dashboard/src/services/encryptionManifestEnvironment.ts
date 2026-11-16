import {
  noteClientManifestLaneChanged,
  setAllowedManifestEnvironments,
  setEncSigningKeysUrl,
} from '@xyne/shared';
import { isLocalhost, isSandBox, isSandboxLocal, isTestEnv, VITE_ZERO_SERVER } from '../config';
import { DYNAMIC_HEADERS_CHANGED_EVENT } from './clients/dynamicHeaders';

/**
 * Which client-manifest environments this build accepts. The server picks the exact one
 * per request (pre-prod is a lane of the production deployment, chosen by x-route-env), so
 * a production build accepts both 'production' and 'playground'; a sandbox or local build
 * only its own. This stops a manifest of another deployment being accepted here.
 */
function acceptedManifestEnvironments(): string[] {
  const protocol = window.location.protocol;
  // Electron bundles: xyne-spaces:, xyne-spaces-dev:, xyne-spaces-sandbox:
  if (protocol.startsWith('xyne-spaces-sandbox')) return ['sandbox'];
  if (protocol.startsWith('xyne-spaces-dev')) return ['development'];
  if (protocol.startsWith('xyne-spaces')) return ['production', 'playground'];
  if (isLocalhost || isSandboxLocal || isTestEnv) return ['development'];
  if (isSandBox) return ['sandbox'];
  return ['production', 'playground'];
}

/**
 * Call once at boot. When central-service moves this user between prod and pre-prod, the
 * dashboard applies the new x-route-env and fires DYNAMIC_HEADERS_CHANGED_EVENT; the
 * manifest of the new lane is then fetched within a few seconds (immediately if a write
 * comes first).
 */
export function setupEncryptionManifestEnvironment(): void {
  // Signing keys are served by the encryption service on the Zero origin.
  setEncSigningKeysUrl(`${VITE_ZERO_SERVER}/.well-known/enc-signing-keys.json`);
  setAllowedManifestEnvironments(acceptedManifestEnvironments());
  window.addEventListener(DYNAMIC_HEADERS_CHANGED_EVENT, () => noteClientManifestLaneChanged());
}
