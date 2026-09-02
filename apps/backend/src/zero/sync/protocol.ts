import { encodeSecProtocols } from '#zero-internal/connect';
import { hashOfNameAndArgs } from '#zero-internal/query-hash';

export { encodeSecProtocols, hashOfNameAndArgs };

// Must match the pinned @rocicorp/zero (1.9.0). Its compiled protocol-version
// module tree-shakes the constant away, so it can't be imported; a mismatch fails
// loudly at connect with a VersionNotSupported error.
export const PROTOCOL_VERSION = 51;
