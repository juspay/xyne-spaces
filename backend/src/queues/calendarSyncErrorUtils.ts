const PERMANENT_CALENDAR_AUTH_ERROR =
  /invalid_grant|unauthorized_client|invalid_client|invalid_token|InvalidAuthenticationToken|interaction_required|consent_required|insufficient.*scope|insufficient privileges|AADSTS700082|AADSTS70008/i;

export function calendarSyncErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export function isPermanentCalendarAuthError(error: unknown): boolean {
  return PERMANENT_CALENDAR_AUTH_ERROR.test(calendarSyncErrorMessage(error));
}
