import { systemPreferences, BrowserWindow } from 'electron';

type MediaType = 'microphone' | 'camera';

interface PermissionStatus {
  microphone: boolean;
  camera: boolean;
}

function isMacOS(): boolean {
  return process.platform === 'darwin';
}

export function getMediaAccessStatus(mediaType: MediaType): string {
  if (!isMacOS()) {
    return 'granted';
  }
  return systemPreferences.getMediaAccessStatus(mediaType);
}

export async function requestMediaAccess(mediaType: MediaType): Promise<boolean> {
  if (!isMacOS()) {
    return true;
  }

  const currentStatus = getMediaAccessStatus(mediaType);
  
  if (currentStatus === 'granted') {
    return true;
  }

  if (currentStatus === 'denied') {
    return false;
  }

  const granted = await systemPreferences.askForMediaAccess(mediaType);
  return granted;
}

export async function requestAllMediaPermissions(): Promise<PermissionStatus> {
  const [microphoneGranted, cameraGranted] = await Promise.all([
    requestMediaAccess('microphone'),
    requestMediaAccess('camera'),
  ]);

  return {
    microphone: microphoneGranted,
    camera: cameraGranted,
  };
}

export function setupPermissionRequestOnFocus(mainWindow: BrowserWindow): void {
  if (!isMacOS()) {
    return;
  }

  let permissionsRequested = false;

  const handleFocus = async (): Promise<void> => {
    if (permissionsRequested) {
      return;
    }

    permissionsRequested = true;
    
    setTimeout(async () => {
      await requestAllMediaPermissions();
    }, 500);
  };

  mainWindow.once('focus', () => {
    void handleFocus();
  });

  if (mainWindow.isFocused()) {
    void handleFocus();
  }
}