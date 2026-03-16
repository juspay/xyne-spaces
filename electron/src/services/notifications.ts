import { Notification, BrowserWindow, app } from 'electron';
import log from 'electron-log/main';

export interface NotificationData {
  title: string;
  body: string;
  actionUrl?: string;
}

export interface CallNotificationData {
  callId: string;
  callerName: string;
  callerEmail: string;
  callType: 'AUDIO' | 'VIDEO';
  callerPicture?: string;
}

// Keep references to prevent garbage collection
const activeNotifications = new Set<Notification>();
const activeCallNotifications = new Map<string, Notification>();

export function showNotification(data: NotificationData, mainWindow: BrowserWindow | null): void {
  if (!Notification.isSupported()) {
    console.warn('[NotificationService] Notifications are not supported on this platform');
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
          mainWindow.webContents.send('navigate-to', data.actionUrl);
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
      app.dock.bounce();
    }
  } catch (error) {
    console.error('[NotificationService] Failed to show notification:', error);
  }
}

export function showCallNotification(
  data: CallNotificationData,
  mainWindow: BrowserWindow | null,
): void {
  if (!Notification.isSupported()) {
    console.warn('[NotificationService] Notifications are not supported on this platform');
    return;
  }

  const existingNotification = activeCallNotifications.get(data.callId);
  if (existingNotification) {
    existingNotification.close();
    activeCallNotifications.delete(data.callId);
  }

  try {
    const callTypeLabel = data.callType === 'VIDEO' ? 'Video' : 'Audio';
    
    const notification = new Notification({
      title: `Incoming ${callTypeLabel} Call`,
      body: `${data.callerName} is calling you`,
      silent: false,
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
      console.error('[NotificationService] Call notification failed:', error);
      activeCallNotifications.delete(data.callId);
    });

    notification.show();

    if (process.platform === 'darwin' && !mainWindow?.isFocused()) {
      app.dock.bounce('critical');
    }
  } catch (error) {
    console.error('[NotificationService] Failed to show call notification:', error);
  }
}

export function closeCallNotification(callId: string): void {
  const notification = activeCallNotifications.get(callId);
  if (notification) {
    notification.close();
    activeCallNotifications.delete(callId);
  }
}
