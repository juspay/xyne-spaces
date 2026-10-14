/**
 * LotusNativeBridge adapter for direct native calls.
 */
import { lotusNativeBridge, type BridgeEnvelope } from '../services/LotusNativeBridge';
export type {
  LiveKitConnectPayload,
  LiveKitTogglePayload,
  LiveKitParticipantPayload,
  LiveKitConnectionStatePayload,
  LiveKitCallEndedPayload,
} from '../services/LotusNativeBridge';

// Re-export BridgeEnvelope type
export type { BridgeEnvelope };

/**
 * Detect if running in React Native WebView
 * In Lotus standalone app, this is false (we're not in a WebView)
 */
export const detectReactNativeWebView = (): boolean => {
  return false;
};

/**
 * Check if native calls are supported
 * In Lotus, we always use native LiveKit directly
 */
export const isNativeCallSupported = (): boolean => {
  return true;
};

// Export the adapter as reactNativeBridge for drop-in compatibility
export const reactNativeBridge = {
  isAvailable: () => lotusNativeBridge.isAvailable(),
  send: (type: string, payload?: Record<string, unknown>) => lotusNativeBridge.send(type, payload),
  on: (type: string, handler: (message: BridgeEnvelope<string, unknown>) => void) =>
    lotusNativeBridge.on(type, handler),
  livekitConnect: (payload: Parameters<typeof lotusNativeBridge.livekitConnect>[0]) =>
    lotusNativeBridge.livekitConnect(payload),
  livekitDisconnect: () => lotusNativeBridge.livekitDisconnect(),
  livekitToggleMic: (enabled: boolean) => lotusNativeBridge.livekitToggleMic(enabled),
  livekitToggleCamera: (enabled: boolean) => lotusNativeBridge.livekitToggleCamera(enabled),
  livekitToggleScreenShare: (enabled: boolean) =>
    lotusNativeBridge.livekitToggleScreenShare(enabled),
  getClientSessionId: () => lotusNativeBridge.getClientSessionId(),
};
