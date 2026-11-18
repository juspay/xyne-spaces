import { useEffect } from 'react';
import { useAuth } from './useAuth';
import { isElectronApp } from '../utils/electronApp';
import { reactNativeBridge } from '../utils/reactNativeBridge';
import { getOrCreateDeviceIdentity } from '../services/deviceIdentityStore';

/**
 * Creates this browser's device key pair after sign-in (reused on later loads). Skipped inside
 * Electron and the mobile WebView — those will use native hardware-backed keys instead.
 */
export function useDeviceIdentity(): void {
  const { user, isAuthenticated } = useAuth();
  const userId = isAuthenticated ? (user?.id ?? null) : null;

  useEffect(() => {
    if (!userId) return;
    if (isElectronApp() || reactNativeBridge.isAvailable()) return;

    let cancelled = false;

    void getOrCreateDeviceIdentity().then(identity => {
      if (!identity || cancelled) return;

      // TODO(api integration): send the public identity to the server here.
      // `identity` is { deviceId, publicKey (SPKI, base64), algorithm: 'P-256', level, platform }
      // and contains no private key material. Suggested shape:
      //   await apiInstance.post('<register endpoint>', identity);
      // To avoid re-sending on every load, record per (identity.deviceId, userId) that it was
      // sent — only after the request succeeds, so failures retry on the next load.
    });

    return (): void => {
      cancelled = true;
    };
  }, [userId]);
}
