/** Asks a webview something, which throws until its guest has attached. */
export function ask<T>(read: () => T, fallback: T): T {
  try {
    return read();
  } catch {
    return fallback;
  }
}
