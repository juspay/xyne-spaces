export type RemoteLogoutReason =
  'confirmed' | 'rejected' | 'failed' | 'timed_out' | 'not_attempted';

export type RemoteLogoutOutcome = {
  attempted: boolean;
  confirmed: boolean;
  reason: RemoteLogoutReason;
};

export function remoteLogoutNotAttempted(): RemoteLogoutOutcome {
  return { attempted: false, confirmed: false, reason: 'not_attempted' };
}

export function classifyRemoteLogoutResponse(response: unknown): RemoteLogoutOutcome {
  const confirmed =
    typeof response === 'object' &&
    response !== null &&
    (response as { success?: unknown }).success === true;
  return {
    attempted: true,
    confirmed,
    reason: confirmed ? 'confirmed' : 'rejected',
  };
}

export function remoteLogoutFailed(reason: 'failed' | 'timed_out'): RemoteLogoutOutcome {
  return { attempted: true, confirmed: false, reason };
}
