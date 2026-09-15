import { config } from '@/config/env';

export interface SdlcClawDeadlineContext {
  clawRunStartedAt?: string | null;
  clawRunDeadlineAt?: string | null;
}

export const SDLC_CLAW_TIMEOUT_ERROR_CODE = 'CLAW_RUN_TIMED_OUT';

export function sdlcCapacityWaitExpired(updatedAt: Date, now = Date.now()): boolean {
  return now - updatedAt.getTime() >= config.sdlcCapacityWaitTimeoutMs;
}

export function sdlcClawTimeoutMessage(subject = 'Claw run'): string {
  return `${subject} exceeded the configured execution limit. Retry the run.`;
}

export function newSdlcClawDeadline(now = Date.now()): Required<SdlcClawDeadlineContext> {
  return {
    clawRunStartedAt: new Date(now).toISOString(),
    clawRunDeadlineAt: new Date(now + config.sdlcClawRunTimeoutMs).toISOString(),
  };
}

export function sdlcClawDeadlineExpired(
  context: SdlcClawDeadlineContext,
  legacyStartedAt: Date,
  now = Date.now()
): boolean {
  const persistedDeadline = context.clawRunDeadlineAt
    ? Date.parse(context.clawRunDeadlineAt)
    : Number.NaN;
  const deadline = Number.isFinite(persistedDeadline)
    ? persistedDeadline
    : legacyStartedAt.getTime() + config.sdlcClawRunTimeoutMs;
  return now >= deadline;
}
