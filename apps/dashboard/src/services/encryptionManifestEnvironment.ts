import { setAllowedManifestEnvironments } from '@xyne/shared';
import { isLocalhost, isSandBox, isSandboxLocal, isTestEnv } from '../config';

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

/** Call once at boot. After a prod <-> pre-prod move, the next write gets a 409 and refetches. */
export function setupEncryptionManifestEnvironment(): void {
  setAllowedManifestEnvironments(acceptedManifestEnvironments());
}
