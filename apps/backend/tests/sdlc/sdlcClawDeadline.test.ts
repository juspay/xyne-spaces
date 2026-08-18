jest.mock('../../src/config/env', () => ({
  config: {
    sdlcCapacityWaitTimeoutMs: 24 * 60 * 60 * 1000,
    sdlcClawRunTimeoutMs: 3 * 60 * 60 * 1000,
  },
}));

import {
  newSdlcClawDeadline,
  sdlcCapacityWaitExpired,
  sdlcClawDeadlineExpired,
  sdlcClawTimeoutMessage,
} from '../../src/sdlc/sdlcClawDeadline';

describe('SDLC Claw deadlines', () => {
  const startedAt = Date.parse('2026-08-17T00:00:00.000Z');

  it('creates a persisted three-hour deadline for each dispatch', () => {
    expect(newSdlcClawDeadline(startedAt)).toEqual({
      clawRunStartedAt: '2026-08-17T00:00:00.000Z',
      clawRunDeadlineAt: '2026-08-17T03:00:00.000Z',
    });
  });

  it('expires at the persisted deadline without extending it', () => {
    const context = newSdlcClawDeadline(startedAt);

    expect(
      sdlcClawDeadlineExpired(context, new Date(startedAt), startedAt + 3 * 60 * 60 * 1000 - 1)
    ).toBe(false);
    expect(
      sdlcClawDeadlineExpired(context, new Date(startedAt), startedAt + 3 * 60 * 60 * 1000)
    ).toBe(true);
  });

  it('bounds legacy runs from their last durable update', () => {
    expect(sdlcClawDeadlineExpired({}, new Date(startedAt), startedAt + 3 * 60 * 60 * 1000)).toBe(
      true
    );
  });

  it('uses the configured capacity wait timeout for pending executions', () => {
    expect(sdlcCapacityWaitExpired(new Date(startedAt), startedAt + 24 * 60 * 60 * 1000 - 1)).toBe(
      false
    );
    expect(sdlcCapacityWaitExpired(new Date(startedAt), startedAt + 24 * 60 * 60 * 1000)).toBe(
      true
    );
  });

  it('describes timeout failures without claiming the default duration', () => {
    expect(sdlcClawTimeoutMessage()).toBe(
      'Claw run exceeded the configured execution limit. Retry the run.'
    );
    expect(sdlcClawTimeoutMessage('Wiki Claw run')).toBe(
      'Wiki Claw run exceeded the configured execution limit. Retry the run.'
    );
  });
});
