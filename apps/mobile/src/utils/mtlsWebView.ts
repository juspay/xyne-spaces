import { NativeModules, Platform } from 'react-native';

interface MtlsWebViewModuleInterface {
  enableMtls(): Promise<boolean>;
  disableMtls(): Promise<boolean>;
  isMtlsEnabled(): Promise<boolean>;
}

const LINKING_ERROR =
  `The package 'MtlsWebViewModule' doesn't seem to be linked. Make sure: \n\n` +
  Platform.select({ ios: "- You have run 'pod install'\n", default: '' }) +
  '- You rebuilt the app after installing the package\n' +
  '- You are not using Expo Go\n';

const MtlsWebViewModule: MtlsWebViewModuleInterface = NativeModules['MtlsWebViewModule']
  ? (NativeModules['MtlsWebViewModule'] as MtlsWebViewModuleInterface)
  : (new Proxy(
      {},
      {
        get() {
          throw new Error(LINKING_ERROR);
        },
      },
    ) as MtlsWebViewModuleInterface);

/**
 * Enable mTLS for all WebView requests.
 * This should be called after certificate enrollment is complete.
 *
 * Once enabled, ALL HTTPS requests from the WebView will automatically
 * use the enrolled client certificate, including:
 * - fetch() API calls
 * - XMLHttpRequest
 * - WebSocket connections (wss://)
 * - Image loads, CSS imports, etc.
 */
export async function enableMtlsForWebView(): Promise<boolean> {
  try {
    console.log('[mTLS WebView] Enabling mTLS for all WebView requests...');
    const result = await MtlsWebViewModule.enableMtls();
    console.log('[mTLS WebView] mTLS enabled successfully');
    return result;
  } catch (error) {
    console.error('[mTLS WebView] Failed to enable mTLS:', error);
    throw error;
  }
}

/**
 * Disable mTLS for WebView requests.
 * This clears the cached certificate from memory.
 */
export async function disableMtlsForWebView(): Promise<boolean> {
  try {
    console.log('[mTLS WebView] Disabling mTLS for WebView...');
    const result = await MtlsWebViewModule.disableMtls();
    console.log('[mTLS WebView] mTLS disabled successfully');
    return result;
  } catch (error) {
    console.error('[mTLS WebView] Failed to disable mTLS:', error);
    throw error;
  }
}

/**
 * Check if mTLS is currently enabled for WebView.
 */
export async function isMtlsEnabled(): Promise<boolean> {
  try {
    return await MtlsWebViewModule.isMtlsEnabled();
  } catch (error) {
    console.error('[mTLS WebView] Failed to check mTLS status:', error);
    return false;
  }
}

/** In-flight or completed enable; avoids duplicate native work when multiple WebViews mount. */
let ensureMtlsPromise: Promise<void> | null = null;
/**
 * Ensures mTLS is enabled once for the process. Safe to call from every WebView host.
 * Concurrent callers share the same promise.
 */
export async function ensureMtlsForWebView(): Promise<void> {
  if (ensureMtlsPromise !== null) {
    return ensureMtlsPromise;
  }
  ensureMtlsPromise = (async (): Promise<void> => {
    try {
      if (await isMtlsEnabled()) {
        return;
      }
      await enableMtlsForWebView();
    } catch (error) {
      ensureMtlsPromise = null;
      throw error;
    }
  })();
  return ensureMtlsPromise;
}
