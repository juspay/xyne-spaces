import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, it } from 'node:test';

import {
  canBeginBoot,
  decideForegroundRecovery,
  describeRegistrationError,
  isForegroundTransition,
  isPermissionGranted,
  needsForegroundRecovery,
  shouldReportRecovery,
  type ForegroundRecoveryInput,
} from '@/src/notifications/bootRecoveryPolicy';

const base: ForegroundRecoveryInput = {
  phase: 'blocked',
  hasAuthToken: true,
  registrationConfirmed: false,
  recoveryInFlight: false,
  permissionGranted: true,
};

describe('notification boot recovery policy', (): void => {
  it('lets a stopped-early boot run again, but never overlaps a running or finished one', (): void => {
    assert.equal(canBeginBoot('idle'), true);
    assert.equal(canBeginBoot('blocked'), true);
    assert.equal(canBeginBoot('booting'), false);
    assert.equal(canBeginBoot('listening'), false);
  });

  it('re-runs a blocked boot on foreground only once permission is granted', (): void => {
    assert.equal(decideForegroundRecovery(base), 'reboot');
    assert.equal(decideForegroundRecovery({ ...base, permissionGranted: false }), 'none');
    // Unknown permission: do nothing rather than risk a prompt.
    assert.equal(decideForegroundRecovery({ ...base, permissionGranted: null }), 'none');
  });

  it('retries only the registration when listening but the backend never accepted the token', (): void => {
    assert.equal(
      decideForegroundRecovery({ ...base, phase: 'listening', registrationConfirmed: false }),
      'retry_registration',
    );
    assert.equal(
      decideForegroundRecovery({ ...base, phase: 'listening', registrationConfirmed: true }),
      'none',
    );
    // Registration does not need display permission.
    assert.equal(
      decideForegroundRecovery({
        ...base,
        phase: 'listening',
        registrationConfirmed: false,
        permissionGranted: false,
      }),
      'retry_registration',
    );
  });

  it('does nothing while signed out, mid-boot, idle, or while a recovery is already running', (): void => {
    assert.equal(decideForegroundRecovery({ ...base, hasAuthToken: false }), 'none');
    assert.equal(decideForegroundRecovery({ ...base, recoveryInFlight: true }), 'none');
    assert.equal(decideForegroundRecovery({ ...base, phase: 'booting' }), 'none');
    assert.equal(decideForegroundRecovery({ ...base, phase: 'idle' }), 'none');
  });

  it('looks at a foreground only while blocked or unconfirmed, never mid-boot', (): void => {
    assert.equal(needsForegroundRecovery('blocked', false), true);
    assert.equal(needsForegroundRecovery('blocked', true), true);
    assert.equal(needsForegroundRecovery('listening', false), true);
    assert.equal(needsForegroundRecovery('listening', true), false);
    // The iOS permission dialog moves the app inactive -> active while booting.
    assert.equal(needsForegroundRecovery('booting', false), false);
    assert.equal(needsForegroundRecovery('idle', false), false);
  });

  it('logs every check that acts, but a check that found nothing only once', (): void => {
    assert.equal(shouldReportRecovery('none', false), true);
    assert.equal(shouldReportRecovery('none', true), false);
    assert.equal(shouldReportRecovery('reboot', true), true);
    assert.equal(shouldReportRecovery('retry_registration', true), true);
  });

  it('treats only background/inactive -> active as a foreground transition', (): void => {
    assert.equal(isForegroundTransition('background', 'active'), true);
    assert.equal(isForegroundTransition('inactive', 'active'), true);
    assert.equal(isForegroundTransition('active', 'active'), false);
    assert.equal(isForegroundTransition('active', 'background'), false);
  });

  it('maps permission labels conservatively', (): void => {
    assert.equal(isPermissionGranted('authorized'), true);
    assert.equal(isPermissionGranted('provisional'), true);
    assert.equal(isPermissionGranted('denied'), false);
    assert.equal(isPermissionGranted('not_determined'), false);
    assert.equal(isPermissionGranted('unknown'), null);
  });

  it('keeps registration errors short and token-free', (): void => {
    const fakeToken = 'dGhpcyBpcyBhIGZha2UgZmNtIHRva2VuIHRoYXQgaXMgbG9uZyBlbm91Z2g6QVBBOTFi';
    const described = describeRegistrationError(new Error(`401 for ${fakeToken}`));
    assert.doesNotMatch(described, new RegExp(fakeToken));
    assert.match(described, /\[redacted\]/);
    assert.ok(describeRegistrationError(new Error('x'.repeat(500))).length <= 120);
    assert.equal(describeRegistrationError(undefined), 'unknown');
  });
});

const SERVICE_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/notifications/NotificationService.ts'),
  'utf8',
);

describe('NotificationService boot wiring', (): void => {
  it('gates a new boot on bootPhase, not on the sticky `started` flag', (): void => {
    assert.match(SERVICE_SOURCE, /if \(!canBeginBoot\(this\.bootPhase\)\) \{\s*return;/);
    assert.doesNotMatch(
      SERVICE_SOURCE,
      /async start\(authToken: string\): Promise<void> \{\s*if \(this\.started\)/,
    );
  });

  it('marks permission and token early-stops as blocked so they can be retried', (): void => {
    assert.match(
      SERVICE_SOURCE,
      /if \(!granted\) \{\s*this\.blockBoot\('permission_denied', trigger\);/,
    );
    assert.match(
      SERVICE_SOURCE,
      /if \(!fcmToken\) \{\s*this\.blockBoot\('token_unavailable', trigger\);/,
    );
  });

  it('records a boot step that throws as blocked, so it can be retried', (): void => {
    assert.match(
      SERVICE_SOURCE,
      /if \(isCurrentLifecycle\(\) && this\.bootPhase === 'booting'\) \{\s*this\.blockBoot\('boot_failed', trigger/,
    );
  });

  it('waits for a late FCM token while blocked on one, and stops waiting on stop()', (): void => {
    assert.match(SERVICE_SOURCE, /if \(reason === 'token_unavailable'\) this\.waitForToken\(\);/);
    const stop = SERVICE_SOURCE.slice(SERVICE_SOURCE.indexOf('  stop(): void {'));
    assert.match(stop.slice(0, stop.indexOf('\n  }\n')), /this\.detachTokenWait\(\);/);
  });

  it('never prompts when a late token re-runs the boot', (): void => {
    const reboot = SERVICE_SOURCE.slice(SERVICE_SOURCE.indexOf('private async rebootIfPermitted'));
    const body = reboot.slice(0, reboot.indexOf('\n  }\n'));
    assert.match(body, /readNotificationPermissionStatus\(\)/);
    assert.match(body, /isPermissionGranted\(permissionStatus\) !== true\) return;/);
    assert.doesNotMatch(body, /requestNotificationPermission\(\)/);
  });

  it('never prompts for permission during foreground recovery', (): void => {
    const recovery = SERVICE_SOURCE.slice(
      SERVICE_SOURCE.indexOf('private async recoverOnForeground'),
    );
    const body = recovery.slice(0, recovery.indexOf('\n  }\n') + 4);
    assert.match(body, /readNotificationPermissionStatus\(\)/);
    assert.doesNotMatch(body, /requestNotificationPermission\(\)/);
  });

  it('removes the foreground subscription and resets boot state on stop()', (): void => {
    const stop = SERVICE_SOURCE.slice(SERVICE_SOURCE.indexOf('  stop(): void {'));
    const body = stop.slice(0, stop.indexOf('\n  }\n'));
    assert.match(body, /this\.detachForegroundRecovery\(\);/);
    assert.match(body, /this\.bootPhase = 'idle';/);
    assert.match(body, /this\.registrationConfirmed = false;/);
  });

  it('attaches payload listeners only after the boot reaches listening', (): void => {
    assert.match(
      SERVICE_SOURCE,
      /this\.bootPhase = 'listening';\s*this\.startListening\(lifecycleGeneration\);/,
    );
    assert.equal(SERVICE_SOURCE.match(/this\.startListening\(/g)?.length, 1);
  });

  it('reports registration outcomes without logging tokens', (): void => {
    assert.match(SERVICE_SOURCE, /structuredLogger\.info\('push_registration_outcome'/);
    const report = SERVICE_SOURCE.slice(SERVICE_SOURCE.indexOf('private reportRegistration'));
    const body = report.slice(0, report.indexOf('\n  }\n'));
    assert.doesNotMatch(body, /fcmToken|authToken/);
  });

  it('logs `registered` only when the backend answered, and `already_registered` for a deduped call', (): void => {
    assert.match(SERVICE_SOURCE, /if \(result === 'skipped' \|\| !isCurrent\(\)\) return;/);
    assert.match(
      SERVICE_SOURCE,
      /outcome: result === 'sent' \? 'registered' : 'already_registered'/,
    );
  });

  it('reports each foreground recovery decision with permission status and device id', (): void => {
    assert.match(SERVICE_SOURCE, /structuredLogger\.info\('push_registration_recovery'/);
    const recovery = SERVICE_SOURCE.slice(
      SERVICE_SOURCE.indexOf('private async recoverOnForeground'),
    );
    assert.match(recovery, /this\.reportRecovery\(\{/);
    assert.match(SERVICE_SOURCE, /deviceId: getRegisteredDeviceId\(\)/);
  });
});

const REGISTRY_SOURCE = readFileSync(
  resolve(process.cwd(), 'src/notifications/backend/deviceRegistry.ts'),
  'utf8',
);

describe('deviceRegistry registration result', (): void => {
  it('distinguishes a sent registration from a deduped or skipped one', (): void => {
    assert.match(
      REGISTRY_SOURCE,
      /if \(fcmToken === lastRegisteredToken\) \{\s*return 'already_registered';/,
    );
    assert.match(REGISTRY_SOURCE, /lastRegisteredToken = fcmToken;\s*return 'sent';/);
  });

  it('exposes the install id without creating one', (): void => {
    const getter = REGISTRY_SOURCE.slice(
      REGISTRY_SOURCE.indexOf('export function getRegisteredDeviceId'),
    );
    const body = getter.slice(0, getter.indexOf('\n}\n'));
    assert.match(body, /getExistingDeviceId\(\)/);
    assert.doesNotMatch(body, /getOrCreateDeviceId/);
  });
});
