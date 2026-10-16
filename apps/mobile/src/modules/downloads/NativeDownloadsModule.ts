import { NativeModules } from 'react-native';

interface LotusDownloadsModule {
  saveFileToDownloads(sourceUri: string, displayName: string, mimeType: string): Promise<string>;
}

const LotusDownloads = NativeModules['LotusDownloads'] as LotusDownloadsModule | undefined;

export const saveFileToDownloadsNative = async (
  localUri: string,
  displayName: string,
  mimeType: string,
): Promise<void> => {
  const module = LotusDownloads;
  if (!module?.saveFileToDownloads) {
    throw new Error('Downloads save is unavailable. Rebuild the Android app and try again.');
  }

  const sourceUri = localUri.startsWith('file://') ? localUri : `file://${localUri}`;
  await module.saveFileToDownloads(sourceUri, displayName, mimeType);
};
