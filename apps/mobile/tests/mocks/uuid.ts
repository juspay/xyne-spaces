/**
 * Test stand-in for `uuid` (v13 ships ESM-only, which jest cannot parse from
 * node_modules). Mapped in jest.config.js. Only the members the app uses.
 */
export function v4(): string {
  const cryptoApi = globalThis.crypto as { randomUUID?: () => string } | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, char => {
    const r = Math.trunc(Math.random() * 16);
    const value = char === 'x' ? r : (r % 4) + 8;
    return value.toString(16);
  });
}
