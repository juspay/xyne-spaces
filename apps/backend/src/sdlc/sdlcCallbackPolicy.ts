export function shouldHandleSdlcCallback(input: {
  executionStatus: string;
  expectedSessionId?: string;
  callbackSessionId?: string;
}): boolean {
  return (
    ['RUNNING', 'PENDING'].includes(input.executionStatus) &&
    Boolean(input.expectedSessionId) &&
    input.callbackSessionId === input.expectedSessionId
  );
}
