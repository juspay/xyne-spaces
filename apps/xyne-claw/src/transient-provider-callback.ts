const USER_VISIBLE_TRANSIENT_RESULT =
  "⚠️ The model provider was temporarily unavailable and your request couldn't be completed. Please try again in a moment.";

export function transientProviderCallback(requiresStructuredDelivery: boolean):
  | { status: 'failed'; error: string }
  | { status: 'completed'; result: string } {
  if (requiresStructuredDelivery) {
    return {
      status: 'failed',
      error: 'Model provider stalled or was temporarily unavailable. Retry the run.',
    };
  }
  return { status: 'completed', result: USER_VISIBLE_TRANSIENT_RESULT };
}
