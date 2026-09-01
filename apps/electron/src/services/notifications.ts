import { Notification, BrowserWindow, app } from 'electron';
import log from 'electron-log/main';
import { Logger } from './logger/Logger';

export interface NotificationData {
  title: string;
  body: string;
  actionUrl?: string;
  workspaceId?: string;
}

export interface CallNotificationData {
  callId: string;
  callerName: string;
  callerEmail: string;
  callType: 'AUDIO' | 'VIDEO';
  callerPicture?: string;
  /**
   * Set when the renderer has decided this call rings silently — the user is
   * already on a call, recording, or in an external meeting. Muting the in-app
   * ringtone alone is not enough: this notification is a second, independent
   * sound source.
   */
  silent?: boolean;
}

// Keep references to prevent garbage collection
const activeNotifications = new Set<Notification>();
const activeCallNotifications = new Map<string, Notification>();

export function showNotification(data: NotificationData, mainWindow: BrowserWindow | null): void {
  if (!Notification.isSupported()) {
    log.warn('[NotificationService] Notifications are not supported on this platform');
    return;
  }

  try {
    const notification = new Notification({
      title: data.title,
      body: data.body,
      silent: true,
      urgency: 'critical',
    });

    // Add to active set
    activeNotifications.add(notification);

    // Cleanup on close
    notification.on('close', () => {
      activeNotifications.delete(notification);
    });

    notification.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        if (data.actionUrl) {
          mainWindow.webContents.send('navigate-to', data.actionUrl, data.workspaceId);
        }
      }
    });

    notification.on('failed', (_event, error) => {
      log.error('[NotificationService] Notification failed to show:', error);
      activeNotifications.delete(notification);
    });

    notification.show();

    // Bounce the dock if on macOS and not focused
    if (process.platform === 'darwin' && !mainWindow?.isFocused()) {
      app.dock?.bounce();
    }
  } catch (error) {
    Logger.logError('notification.show.failed', error);
  }
}

export function showCallNotification(
  data: CallNotificationData,
  mainWindow: BrowserWindow | null,
): void {
  if (!Notification.isSupported()) {
    log.warn('[NotificationService] Notifications are not supported on this platform');
    return;
  }

  const existingNotification = activeCallNotifications.get(data.callId);
  if (existingNotification) {
    existingNotification.close();
    activeCallNotifications.delete(data.callId);
  }

  try {
    // There is one kind of call, so the OS notification says so too. `callType`
    // stays on the payload — LiveKit room setup and CallKit still key off it.
    const notification = new Notification({
      title: 'Incoming call',
      body: `${data.callerName} is calling you`,
      silent: data.silent ?? false,
      urgency: 'critical',
      hasReply: false,
      timeoutType: 'never', 
      actions: [
        { type: 'button', text: 'Answer' },
        { type: 'button', text: 'Decline' },
      ],
    });

    activeCallNotifications.set(data.callId, notification);

    notification.on('close', () => {
      activeCallNotifications.delete(data.callId);
    });

    notification.on('click', () => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        mainWindow.webContents.send('call-notification-clicked', { callId: data.callId });
      }
    });

    notification.on('action', (_event, index) => {
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.focus();
        
        if (index === 0) {
          mainWindow.webContents.send('call-action', { callId: data.callId, action: 'accept' });
        } else if (index === 1) {
          mainWindow.webContents.send('call-action', { callId: data.callId, action: 'reject' });
        }
      }
      activeCallNotifications.delete(data.callId);
    });

    notification.on('failed', (_event, error) => {
      Logger.logError('call-notification.failed', error, { call_id: data.callId });
      activeCallNotifications.delete(data.callId);
    });

    notification.show();

    // Deliberately not gated on `data.silent`: a silenced call still earns the
    // peripheral visual cue, it just must not make a sound.
    if (process.platform === 'darwin' && !mainWindow?.isFocused()) {
      app.dock?.bounce('critical');
    }
  } catch (error) {
    Logger.logError('call-notification.show.failed', error, { call_id: data.callId });
  }
}

export function closeCallNotification(callId: string): void {
  const notification = activeCallNotifications.get(callId);
  if (notification) {
    notification.close();
    activeCallNotifications.delete(callId);
  }
}
