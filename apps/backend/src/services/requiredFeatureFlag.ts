/** OpenFeature returns fallback values on evaluation errors; those are not an explicit disable. */
export function requireBooleanFlag(details: { value: boolean; reason?: string; errorCode?: unknown }): boolean {
  if (typeof details.value !== 'boolean' || details.errorCode || details.reason === 'ERROR' || details.reason === 'DEFAULT') {
    throw new Error('Required feature flag could not be evaluated');
  }
  return details.value;
}
