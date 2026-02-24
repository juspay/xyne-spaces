/**
 * macOS System Preferences deep-link URLs for each media permission type.
 * Used by Electron's "Open Settings" action when a permission is denied.
 */
export const MACOS_PRIVACY_URLS: Record<string, string> = {
  microphone: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Microphone',
  camera: 'x-apple.systempreferences:com.apple.preference.security?Privacy_Camera',
  screen: 'x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture',
};
