/** Dev-only console trace of a navigation command; bypasses the logger, which ships to remote logging, because it carries what the user typed. */
export const traceNavigation = (step: string, details: Record<string, unknown>): void => {
  // eslint-disable-next-line no-console -- Metro terminal only, never the remote logger
  if (__DEV__) console.log(`[xyne-ai nav] ${step}`, JSON.stringify(details));
};
