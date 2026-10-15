import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  buildSosTrayData,
  extractSosAlert,
  extractSosAlertFromTrayData,
  isSosAlertData,
} from '@/src/notifications/sos/parser';

describe('isSosAlertData', () => {
  it('detects the SOS notification type from a top-level field', () => {
    assert.equal(isSosAlertData({ notificationType: 'sos_alert' }), true);
  });

  it('detects the SOS notification type nested inside metadata JSON', () => {
    assert.equal(
      isSosAlertData({ metadata: JSON.stringify({ notificationType: 'sos_alert' }) }),
      true,
    );
  });

  it('returns false for other notification types', () => {
    assert.equal(isSosAlertData({ notificationType: 'MENTION' }), false);
    assert.equal(isSosAlertData({}), false);
  });
});

describe('extractSosAlert', () => {
  it('returns null when the payload is not an SOS alert', () => {
    assert.equal(extractSosAlert({ notificationType: 'MENTION', notificationId: 'n1' }), null);
  });

  it('returns null when an SOS alert has no notification id', () => {
    assert.equal(extractSosAlert({ notificationType: 'sos_alert' }), null);
  });

  it('extracts id, title and body from a well-formed alert', () => {
    const data = {
      notificationType: 'sos_alert',
      notificationId: 'n1',
      msg_title: 'Server down',
      msg_body: 'Prod is on fire',
    };
    const alert = extractSosAlert(data);
    assert.ok(alert);
    assert.equal(alert.id, 'n1');
    assert.equal(alert.title, 'Server down');
    assert.equal(alert.body, 'Prod is on fire');
    assert.equal(typeof alert.receivedAt, 'number');
    assert.equal(alert.rawData, data);
    assert.equal('actionUrl' in alert, false);
    assert.equal('workspaceId' in alert, false);
  });

  it('falls back to a default title and empty body when missing', () => {
    const alert = extractSosAlert({ notificationType: 'sos_alert', notificationId: 'n2' });
    assert.ok(alert);
    assert.equal(alert.title, 'SOS alert');
    assert.equal(alert.body, '');
  });

  it('derives the workspace id from the action url when not explicit', () => {
    const alert = extractSosAlert({
      notificationType: 'sos_alert',
      notificationId: 'n3',
      actionUrl: '/wsABC/chat/thread-1',
    });
    assert.ok(alert);
    assert.equal(alert.actionUrl, '/wsABC/chat/thread-1');
    assert.equal(alert.workspaceId, 'wsABC');
  });

  it('does not treat reserved leading segments as a workspace id', () => {
    const alert = extractSosAlert({
      notificationType: 'sos_alert',
      notificationId: 'n4',
      actionUrl: '/chat/thread-1',
    });
    assert.ok(alert);
    assert.equal(alert.workspaceId, undefined);
  });
});

describe('buildSosTrayData', () => {
  it('round-trips an alert back into tray-shaped string data', () => {
    const alert = extractSosAlert({
      notificationType: 'sos_alert',
      notificationId: 'n5',
      msg_title: 'T',
      msg_body: 'B',
      actionUrl: '/wsX/chat/1',
    });
    assert.ok(alert);

    const tray = buildSosTrayData(alert);
    assert.equal(tray['_sos'], 'true');
    assert.equal(tray['notificationType'], 'sos_alert');
    assert.equal(tray['notificationId'], 'n5');
    assert.equal(tray['msg_title'], 'T');
    assert.equal(tray['msg_body'], 'B');
    assert.equal(tray['type'], 'MENTION');
    assert.equal(tray['actionUrl'], '/wsX/chat/1');
    assert.equal(tray['deeplink'], '/wsX/chat/1');
    assert.equal(tray['workspaceId'], 'wsX');

    const reparsed = extractSosAlert(tray);
    assert.ok(reparsed);
    assert.equal(reparsed.id, alert.id);
    assert.equal(reparsed.title, alert.title);
    assert.equal(reparsed.body, alert.body);
  });
});

describe('extractSosAlertFromTrayData', () => {
  it('normalizes tray data before extraction', () => {
    const alert = extractSosAlertFromTrayData({
      notificationType: 'sos_alert',
      notificationId: 'n6',
      msg_title: 'Hi',
      msg_body: 'There',
    });
    assert.ok(alert);
    assert.equal(alert.id, 'n6');
  });

  it('flattens a nested data payload', () => {
    const alert = extractSosAlertFromTrayData({
      data: { notificationType: 'sos_alert', notificationId: 'n7' },
    });
    assert.ok(alert);
    assert.equal(alert.id, 'n7');
  });

  it('returns null for undefined tray data', () => {
    assert.equal(extractSosAlertFromTrayData(undefined), null);
  });
});
