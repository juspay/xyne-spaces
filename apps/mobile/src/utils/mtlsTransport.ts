import { isMtlsFeatureEnabled } from '../config';
import { installProtectedFetchGuard } from '../services/MtlsApiService';
import { patchEngineIoWebSocketTransport } from './mtlsEngineIoPatch';
import { installMtlsWebSocketInterceptor } from './mtlsWebSocket';

let transportInitialized = false;

export function initializeMtlsTransport(): void {
  if (transportInitialized) {
    return;
  }
  if (!isMtlsFeatureEnabled()) {
    transportInitialized = true;
    return;
  }

  installProtectedFetchGuard();
  installMtlsWebSocketInterceptor();
  patchEngineIoWebSocketTransport();
  transportInitialized = true;
}
