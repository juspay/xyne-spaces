import type { LogEntry, NormalizedLogFields } from '../types';

// Sensitive identity fields are kept outside LogEntry so local transports and
// diagnostics can only see the redacted fields. The remote serializer is the
// sole reader of this per-entry data.
const remoteOnlyFieldsByEntry = new WeakMap<LogEntry, NormalizedLogFields>();

export function attachRemoteOnlyLogFields(entry: LogEntry, fields: NormalizedLogFields): void {
  remoteOnlyFieldsByEntry.set(entry, { ...fields });
}

export function getRemoteOnlyLogFields(entry: LogEntry): NormalizedLogFields | undefined {
  return remoteOnlyFieldsByEntry.get(entry);
}
