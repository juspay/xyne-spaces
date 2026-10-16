import assert from 'node:assert/strict';
import { afterEach, describe, it, mock } from 'node:test';

import type {
  AppLifecycle,
  AppLifecycleListener,
  AppLifecycleState,
  AppLifecycleSubscription,
} from '@/src/observability/logging/lifecycle/AppLifecycle';
import {
  abortColdStart,
  applyLaunchSignals,
  beginColdStart,
  COLD_START_BACKGROUND_ABORT_MS,
  configureColdStartClock,
  markColdStartLaunchIntentSettled,
  markColdStartSplashHidden,
  noteStartupDestinationReady,
  resetColdStart,
  resolveLaunchBaseline,
  resolveLaunchCause,
  resolveStartupDestination,
  setColdStartDestination,
  type LaunchSignalSnapshot,
  type LaunchTimes,
  type StartupClock,
  type StartupDestinationInput,
} from '@/src/observability/logging/startup/coldStart';

class FakeStartupClock implements StartupClock {
  now = 1_000;

  constructor(public launchTimes: LaunchTimes | null) {}

  async getLaunchTimes(): Promise<LaunchTimes | null> {
    return this.launchTimes;
  }

  async nowUptimeMs(): Promise<number | null> {
    return this.now;
  }
}

class ManualAppLifecycle implements AppLifecycle {
  private readonly listeners = new Set<AppLifecycleListener>();

  currentState: AppLifecycleState;

  constructor(initialState: AppLifecycleState) {
    this.currentState = initialState;
  }

  subscribe(listener: AppLifecycleListener): AppLifecycleSubscription {
    this.listeners.add(listener);

    return {
      remove: (): void => {
        this.listeners.delete(listener);
      },
    };
  }

  moveTo(nextState: AppLifecycleState): void {
    this.currentState = nextState;

    for (const listener of this.listeners) {
      listener(nextState);
    }
  }
}

const androidLaunch: LaunchTimes = {
  platform: 'android',
  isBackgrounded: false,
  appUptimeMs: 100,
  activityUptimeMs: 200,
  launchCause: 'direct',
};

const emptySignals: LaunchSignalSnapshot = {
  initialUrl: null,
  hasInitialNotification: false,
  hasNotificationIntentExtras: false,
  hasInitialShare: false,
  hasColdStartCall: false,
  urlLooksLikeCall: false,
  urlLooksLikeShare: false,
  urlLooksLikeDeepLink: false,
};

const androidTimes = (overrides: Partial<LaunchTimes> = {}): LaunchTimes => ({
  platform: 'android',
  isBackgrounded: false,
  appUptimeMs: 10,
  activityUptimeMs: 40,
  ...overrides,
});

const signedIn: StartupDestinationInput = {
  isEnrollmentResolved: true,
  isAuthResolved: true,
  isEnrolled: true,
  isSignedIn: true,
};

async function startIconLaunch(
  clock: FakeStartupClock = new FakeStartupClock(androidLaunch),
): Promise<FakeStartupClock> {
  configureColdStartClock(clock);
  await beginColdStart();
  applyLaunchSignals(emptySignals);
  setColdStartDestination('dms');
  markColdStartSplashHidden();
  return clock;
}

describe('resolveLaunchBaseline', () => {
  it('uses app uptime on iOS even when activity uptime exists', () => {
    const baseline = resolveLaunchBaseline({
      platform: 'ios',
      isBackgrounded: false,
      appUptimeMs: 5,
      activityUptimeMs: 80,
    });

    assert.deepEqual(baseline, { uptimeMs: 5, nativeAnchor: 'app' });
  });

  it('uses activity uptime on Android when the activity was created', () => {
    assert.deepEqual(resolveLaunchBaseline(androidTimes()), {
      uptimeMs: 40,
      nativeAnchor: 'activity',
    });
  });

  it('falls back to app uptime on Android when activity uptime is missing', () => {
    assert.deepEqual(
      resolveLaunchBaseline({
        platform: 'android',
        isBackgrounded: false,
        appUptimeMs: 10,
      }),
      { uptimeMs: 10, nativeAnchor: 'app' },
    );
  });

  it('returns null on iOS when app uptime is missing', () => {
    assert.equal(resolveLaunchBaseline({ platform: 'ios', isBackgrounded: false }), null);
  });
});

describe('resolveLaunchCause', () => {
  it('prefers a call over a notification', () => {
    assert.equal(
      resolveLaunchCause({
        ...emptySignals,
        nativeCause: 'notification',
        hasInitialNotification: true,
        hasColdStartCall: true,
      }),
      'call',
    );
  });

  it('does not treat a sticky FCM initial notification as a native direct launch', () => {
    assert.equal(
      resolveLaunchCause({
        ...emptySignals,
        nativeCause: 'direct',
        hasInitialNotification: true,
      }),
      'direct',
    );
  });

  it('upgrades a native direct launch when THIS activity intent has notification extras', () => {
    assert.equal(
      resolveLaunchCause({
        ...emptySignals,
        nativeCause: 'direct',
        hasNotificationIntentExtras: true,
      }),
      'notification',
    );
  });

  it('keeps a native share when a leftover notification signal is still present', () => {
    assert.equal(
      resolveLaunchCause({
        ...emptySignals,
        nativeCause: 'share',
        hasInitialNotification: true,
      }),
      'share',
    );
  });

  it('does not downgrade a native notification when JS sees no payload', () => {
    assert.equal(
      resolveLaunchCause({
        ...emptySignals,
        nativeCause: 'notification',
      }),
      'notification',
    );
  });

  it('classifies a share URL above a generic deeplink', () => {
    assert.equal(
      resolveLaunchCause({
        ...emptySignals,
        urlLooksLikeShare: true,
        urlLooksLikeDeepLink: true,
      }),
      'share',
    );
  });

  it('defaults to direct when nothing else is present', () => {
    assert.equal(resolveLaunchCause(emptySignals), 'direct');
  });
});

describe('resolveStartupDestination', () => {
  it('waits while enrollment is unresolved', () => {
    assert.equal(
      resolveStartupDestination({ ...signedIn, isEnrollmentResolved: false, isEnrolled: false }),
      null,
    );
  });

  it('sends an unenrolled launch to enrollment', () => {
    assert.equal(
      resolveStartupDestination({ ...signedIn, isEnrolled: false, isSignedIn: false }),
      'enrollment',
    );
  });

  it('sends an enrolled logged-out launch to login', () => {
    assert.equal(resolveStartupDestination({ ...signedIn, isSignedIn: false }), 'login');
  });

  it('sends a signed-in launch to dms', () => {
    assert.equal(resolveStartupDestination(signedIn), 'dms');
  });
});

describe('coldStart', () => {
  afterEach(() => {
    resetColdStart();
  });

  it('measures activity uptime to first ready DMs, including splash', async () => {
    const clock = new FakeStartupClock(androidLaunch);
    configureColdStartClock(clock);

    assert.equal(await beginColdStart(), null);

    applyLaunchSignals(emptySignals);
    setColdStartDestination('dms');

    clock.now = 350;
    assert.equal(await noteStartupDestinationReady('dms'), null);
    assert.equal(markColdStartSplashHidden(), null);

    assert.deepEqual(markColdStartLaunchIntentSettled(), {
      durationMs: 150,
      launchCause: 'direct',
      destination: 'dms',
      nativeAnchor: 'activity',
    });
  });

  it('completes a notification launch when DMs is ready, not when chat is ready', async () => {
    const clock = new FakeStartupClock({
      ...androidLaunch,
      launchCause: 'notification',
    });
    configureColdStartClock(clock);
    await beginColdStart();
    applyLaunchSignals({
      ...emptySignals,
      nativeCause: 'notification',
      hasInitialNotification: true,
    });
    setColdStartDestination('dms');
    markColdStartSplashHidden();

    clock.now = 400;
    assert.deepEqual(await noteStartupDestinationReady('dms'), {
      durationMs: 200,
      launchCause: 'notification',
      destination: 'dms',
      nativeAnchor: 'activity',
    });
  });

  it('does not treat a sticky native background flag as a cancelled launch', async () => {
    const clock = new FakeStartupClock({
      ...androidLaunch,
      isBackgrounded: true,
    });
    await startIconLaunch(clock);
    clock.now = 350;
    await noteStartupDestinationReady('dms');

    assert.deepEqual(markColdStartLaunchIntentSettled(), {
      durationMs: 150,
      launchCause: 'direct',
      destination: 'dms',
      nativeAnchor: 'activity',
    });
  });

  it('does not complete a direct DMs launch until notification recovery has settled', async () => {
    const clock = await startIconLaunch();
    clock.now = 350;
    assert.equal(await noteStartupDestinationReady('dms'), null);
    assert.equal(markColdStartSplashHidden(), null);

    assert.deepEqual(markColdStartLaunchIntentSettled(), {
      durationMs: 150,
      launchCause: 'direct',
      destination: 'dms',
      nativeAnchor: 'activity',
    });
  });

  it('emits nothing when the native module is missing', async () => {
    configureColdStartClock(new FakeStartupClock(null));
    assert.equal(await beginColdStart(), null);
    applyLaunchSignals(emptySignals);
    markColdStartSplashHidden();
    setColdStartDestination('login');
    assert.equal(await noteStartupDestinationReady('login'), null);
  });

  it('emits nothing after backgrounding', async () => {
    configureColdStartClock(new FakeStartupClock(androidLaunch));
    await beginColdStart();
    abortColdStart();
    applyLaunchSignals(emptySignals);
    markColdStartSplashHidden();
    setColdStartDestination('login');
    assert.equal(await noteStartupDestinationReady('login'), null);
  });

  it('does not complete until launch signals have been applied', async () => {
    const clock = new FakeStartupClock(androidLaunch);
    configureColdStartClock(clock);
    await beginColdStart();
    setColdStartDestination('dms');
    markColdStartSplashHidden();
    clock.now = 350;
    assert.equal(await noteStartupDestinationReady('dms'), null);
    assert.equal(applyLaunchSignals(emptySignals), null);

    assert.deepEqual(markColdStartLaunchIntentSettled(), {
      durationMs: 150,
      launchCause: 'direct',
      destination: 'dms',
      nativeAnchor: 'activity',
    });
  });

  it('completes a direct launch if intent settled before tracking started', async () => {
    markColdStartLaunchIntentSettled();
    const clock = new FakeStartupClock(androidLaunch);
    configureColdStartClock(clock);
    await beginColdStart();
    applyLaunchSignals(emptySignals);
    setColdStartDestination('dms');
    markColdStartSplashHidden();
    clock.now = 350;

    assert.deepEqual(await noteStartupDestinationReady('dms'), {
      durationMs: 150,
      launchCause: 'direct',
      destination: 'dms',
      nativeAnchor: 'activity',
    });
  });

  it('retries after an aborted attempt so a remount can still complete', async () => {
    const clock = new FakeStartupClock(androidLaunch);
    configureColdStartClock(clock);
    await beginColdStart();
    abortColdStart();
    assert.equal(await noteStartupDestinationReady('dms'), null);

    assert.equal(await beginColdStart(), null);
    applyLaunchSignals(emptySignals);
    setColdStartDestination('dms');
    markColdStartSplashHidden();
    clock.now = 350;
    assert.equal(await noteStartupDestinationReady('dms'), null);

    assert.deepEqual(markColdStartLaunchIntentSettled(), {
      durationMs: 150,
      launchCause: 'direct',
      destination: 'dms',
      nativeAnchor: 'activity',
    });
  });

  it('does not start a second attempt after a completed launch of the same activity', async () => {
    const clock = await startIconLaunch();
    clock.now = 350;
    await noteStartupDestinationReady('dms');
    assert.deepEqual(markColdStartLaunchIntentSettled(), {
      durationMs: 150,
      launchCause: 'direct',
      destination: 'dms',
      nativeAnchor: 'activity',
    });

    clock.now = 9_000;
    assert.equal(await beginColdStart(), null);
    assert.equal(await noteStartupDestinationReady('dms'), null);
    assert.equal(markColdStartLaunchIntentSettled(), null);
  });

  it('starts a new attempt when Android activity uptime changes after a completed launch', async () => {
    const clock = await startIconLaunch();
    clock.now = 350;
    await noteStartupDestinationReady('dms');
    assert.deepEqual(markColdStartLaunchIntentSettled(), {
      durationMs: 150,
      launchCause: 'direct',
      destination: 'dms',
      nativeAnchor: 'activity',
    });

    clock.launchTimes = androidTimes({
      activityUptimeMs: 8_000,
      launchCause: 'share',
    });
    clock.now = 8_180;

    assert.equal(await beginColdStart(), null);
    applyLaunchSignals({
      ...emptySignals,
      nativeCause: 'share',
      hasInitialShare: true,
      hasInitialNotification: true,
    });
    setColdStartDestination('dms');
    markColdStartSplashHidden();

    assert.deepEqual(await noteStartupDestinationReady('dms'), {
      durationMs: 180,
      launchCause: 'share',
      destination: 'dms',
      nativeAnchor: 'activity',
    });
  });

  it('does not reclassify a native direct launch from a leftover notification intent', async () => {
    const clock = new FakeStartupClock(androidLaunch);
    configureColdStartClock(clock);
    await beginColdStart();
    applyLaunchSignals({
      ...emptySignals,
      nativeCause: 'direct',
      hasInitialNotification: true,
    });
    setColdStartDestination('dms');
    markColdStartSplashHidden();
    clock.now = 350;
    assert.equal(await noteStartupDestinationReady('dms'), null);

    assert.deepEqual(markColdStartLaunchIntentSettled(), {
      durationMs: 150,
      launchCause: 'direct',
      destination: 'dms',
      nativeAnchor: 'activity',
    });
  });

  it('completes a MAIN/LAUNCHER notification tap from activity extras without direct settle', async () => {
    const clock = new FakeStartupClock(androidLaunch);
    configureColdStartClock(clock);
    await beginColdStart();
    applyLaunchSignals({
      ...emptySignals,
      nativeCause: 'direct',
      hasNotificationIntentExtras: true,
    });
    setColdStartDestination('dms');
    markColdStartSplashHidden();
    clock.now = 350;

    assert.deepEqual(await noteStartupDestinationReady('dms'), {
      durationMs: 150,
      launchCause: 'notification',
      destination: 'dms',
      nativeAnchor: 'activity',
    });
  });

  it('keeps a notification extras cause when a later recovered tap overwrites other signals', async () => {
    const clock = new FakeStartupClock(androidLaunch);
    configureColdStartClock(clock);
    await beginColdStart();
    applyLaunchSignals({
      ...emptySignals,
      nativeCause: 'direct',
      hasNotificationIntentExtras: true,
    });
    applyLaunchSignals({
      ...emptySignals,
      nativeCause: 'direct',
      hasInitialNotification: true,
      hasNotificationIntentExtras: false,
    });
    setColdStartDestination('dms');
    markColdStartSplashHidden();
    clock.now = 350;

    assert.deepEqual(await noteStartupDestinationReady('dms'), {
      durationMs: 150,
      launchCause: 'notification',
      destination: 'dms',
      nativeAnchor: 'activity',
    });
  });

  it('does not abort a call launch that backgrounds before DMs is ready', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });

    try {
      const lifecycle = new ManualAppLifecycle('foreground');
      const clock = new FakeStartupClock({
        ...androidLaunch,
        launchCause: 'call',
      });
      configureColdStartClock(clock);
      await beginColdStart(lifecycle);
      applyLaunchSignals({
        ...emptySignals,
        nativeCause: 'call',
        hasColdStartCall: true,
      });
      lifecycle.moveTo('background');
      mock.timers.tick(COLD_START_BACKGROUND_ABORT_MS);

      setColdStartDestination('dms');
      markColdStartSplashHidden();
      clock.now = 400;
      assert.deepEqual(await noteStartupDestinationReady('dms'), {
        durationMs: 200,
        launchCause: 'call',
        destination: 'dms',
        nativeAnchor: 'activity',
      });
    } finally {
      mock.timers.reset();
    }
  });

  it('upgrades a native direct launch to call after backgrounding without aborting', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });

    try {
      const lifecycle = new ManualAppLifecycle('foreground');
      const clock = new FakeStartupClock(androidLaunch);
      configureColdStartClock(clock);
      await beginColdStart(lifecycle);
      lifecycle.moveTo('background');
      mock.timers.tick(COLD_START_BACKGROUND_ABORT_MS);

      applyLaunchSignals({
        ...emptySignals,
        hasColdStartCall: true,
      });
      mock.timers.tick(COLD_START_BACKGROUND_ABORT_MS);

      setColdStartDestination('dms');
      markColdStartSplashHidden();
      clock.now = 400;
      assert.deepEqual(await noteStartupDestinationReady('dms'), {
        durationMs: 200,
        launchCause: 'call',
        destination: 'dms',
        nativeAnchor: 'activity',
      });
    } finally {
      mock.timers.reset();
    }
  });

  it('aborts a direct launch that stays backgrounded after signals are applied', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });

    try {
      const lifecycle = new ManualAppLifecycle('foreground');
      const clock = new FakeStartupClock(androidLaunch);
      configureColdStartClock(clock);
      await beginColdStart(lifecycle);
      applyLaunchSignals(emptySignals);
      lifecycle.moveTo('background');
      mock.timers.tick(COLD_START_BACKGROUND_ABORT_MS - 1);
      setColdStartDestination('dms');
      markColdStartSplashHidden();
      clock.now = 350;
      assert.equal(await noteStartupDestinationReady('dms'), null);

      mock.timers.tick(1);
      assert.equal(markColdStartLaunchIntentSettled(), null);
      assert.equal(await noteStartupDestinationReady('dms'), null);
    } finally {
      mock.timers.reset();
    }
  });

  it('aborts a notification cold start that stays backgrounded after signals are applied', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });

    try {
      const lifecycle = new ManualAppLifecycle('foreground');
      const clock = new FakeStartupClock({
        ...androidLaunch,
        launchCause: 'notification',
      });
      configureColdStartClock(clock);
      await beginColdStart(lifecycle);
      applyLaunchSignals({
        ...emptySignals,
        nativeCause: 'notification',
        hasInitialNotification: true,
      });
      lifecycle.moveTo('background');
      mock.timers.tick(COLD_START_BACKGROUND_ABORT_MS);

      setColdStartDestination('dms');
      markColdStartSplashHidden();
      clock.now = 152_000;
      assert.equal(await noteStartupDestinationReady('dms'), null);
      assert.equal(markColdStartLaunchIntentSettled(), null);
    } finally {
      mock.timers.reset();
    }
  });

  it('aborts a share cold start that stays backgrounded after signals are applied', async () => {
    mock.timers.enable({ apis: ['setTimeout'] });

    try {
      const lifecycle = new ManualAppLifecycle('foreground');
      const clock = new FakeStartupClock({
        ...androidLaunch,
        launchCause: 'share',
      });
      configureColdStartClock(clock);
      await beginColdStart(lifecycle);
      applyLaunchSignals({
        ...emptySignals,
        nativeCause: 'share',
        hasInitialShare: true,
      });
      lifecycle.moveTo('background');
      mock.timers.tick(COLD_START_BACKGROUND_ABORT_MS);

      setColdStartDestination('dms');
      markColdStartSplashHidden();
      clock.now = 210_000;
      assert.equal(await noteStartupDestinationReady('dms'), null);
    } finally {
      mock.timers.reset();
    }
  });
});
