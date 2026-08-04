/**
 * Escapes a value for safe interpolation inside a double-quoted YQL string
 * literal (backslash first, then double-quote). For the hand-built YQL paths
 * (memory search, duplicate detection) where values are not bound as
 * @-parameters. Prefer VespaQueryParams.bind() (YqlBuilder) for new code.
 */
export function escapeYqlString(value: unknown): string {
  return String(value ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"');
}
