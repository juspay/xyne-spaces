import * as FileSystem from 'expo-file-system/legacy';
import * as IntentLauncher from 'expo-intent-launcher';

// FLAG_GRANT_READ_URI_PERMISSION — lets the launched app read our content:// uri.
const FLAG_GRANT_READ_URI_PERMISSION = 1;

/**
 * Android only: open a locally-cached file in the device's native viewer via an
 * `ACTION_VIEW` intent. For PDFs this hands off to the system PDF viewer
 * (Drive/Files), which gives true native-smooth scroll/zoom — the same approach
 * chat apps use rather than an in-app JS renderer.
 *
 * The `file://` uri is converted to a `content://` FileProvider uri first, because
 * Android forbids passing raw `file://` uris across apps (FileUriExposedException).
 * Throws `ActivityNotFoundException` if no app can handle the type — callers should
 * catch and offer "Save" as a fallback.
 */
export const openInDeviceViewer = async (localUri: string, mimetype: string): Promise<void> => {
  const contentUri = await FileSystem.getContentUriAsync(localUri);
  await IntentLauncher.startActivityAsync('android.intent.action.VIEW', {
    data: contentUri,
    flags: FLAG_GRANT_READ_URI_PERMISSION,
    type: mimetype || 'application/pdf',
  });
};
