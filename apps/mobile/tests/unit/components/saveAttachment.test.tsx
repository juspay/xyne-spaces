import { afterEach, describe, expect, it, jest } from '@jest/globals';

type PlatformOs = 'ios' | 'android';

type LoadedModule = {
  shareOrSaveAttachment: (localUri: string, filename: string, mimetype: string) => Promise<void>;
  native: {
    alert: jest.Mock;
    share: jest.Mock;
    toast: jest.Mock;
    getInfoAsync: jest.Mock<(uri: string) => Promise<{ exists: boolean; size: number }>>;
    copyAsync: jest.Mock<(options: { from: string; to: string }) => Promise<void>>;
    requestPermissionsAsync: jest.Mock;
    createAsset: jest.Mock;
    saveAndroid: jest.Mock;
    hapticSuccess: jest.Mock;
  };
};

const loadSaveAttachment = (
  os: PlatformOs,
  options: {
    permissionStatus?: 'granted' | 'denied';
    createAssetError?: Error;
  } = {},
): LoadedModule => {
  jest.resetModules();

  const existingUris = new Set<string>();
  const alert = jest.fn();
  const share = jest.fn(async () => ({ action: 'sharedAction' }));
  const toast = jest.fn();
  const getInfoAsync = jest.fn(async (uri: string) => ({
    exists: existingUris.has(uri),
    size: existingUris.has(uri) ? 1024 : 0,
  }));
  const copyAsync = jest.fn(async ({ to }: { from: string; to: string }) => {
    existingUris.add(to);
  });
  const requestPermissionsAsync = jest.fn(async () => ({
    status: options.permissionStatus ?? 'granted',
  }));
  const createAsset = jest.fn(async () => {
    if (options.createAssetError) throw options.createAssetError;
    return {};
  });
  const saveAndroid = jest.fn(async () => undefined);
  const hapticSuccess = jest.fn(async () => undefined);

  jest.doMock('react-native', () => ({
    Alert: { alert },
    Platform: { OS: os },
    Share: { share },
    ToastAndroid: { SHORT: 0, show: toast },
  }));
  jest.doMock('expo-file-system/legacy', () => ({
    getInfoAsync,
    copyAsync,
  }));
  jest.doMock('expo-media-library', () => ({
    requestPermissionsAsync,
    Asset: { create: createAsset },
  }));
  jest.doMock('@/src/utils/haptics', () => ({
    haptics: { success: hapticSuccess },
  }));
  jest.doMock('@/src/modules/downloads/NativeDownloadsModule', () => ({
    saveFileToDownloadsNative: saveAndroid,
  }));

  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const module = require('@/src/components/attachments-viewer/utils/saveAttachment') as {
    shareOrSaveAttachment: LoadedModule['shareOrSaveAttachment'];
  };

  return {
    shareOrSaveAttachment: async (localUri, filename, mimetype) => {
      existingUris.add(localUri);
      await module.shareOrSaveAttachment(localUri, filename, mimetype);
    },
    native: {
      alert,
      share,
      toast,
      getInfoAsync,
      copyAsync,
      requestPermissionsAsync,
      createAsset,
      saveAndroid,
      hapticSuccess,
    },
  };
};

afterEach(() => {
  jest.restoreAllMocks();
  jest.resetModules();
});

describe('shareOrSaveAttachment', () => {
  it('uses add-only permission and the Expo 57 Asset API for iOS media', async () => {
    const { shareOrSaveAttachment, native } = loadSaveAttachment('ios');

    await shareOrSaveAttachment('file:///cache/photo.jpg', 'photo.jpg', 'image/jpeg');

    expect(native.requestPermissionsAsync).toHaveBeenCalledWith(true);
    expect(native.createAsset).toHaveBeenCalledWith('file:///cache/photo.jpg');
    expect(native.hapticSuccess).toHaveBeenCalledTimes(1);
    expect(native.alert).toHaveBeenCalledWith('Saved', 'Saved to your photo library.');
    expect(native.share).not.toHaveBeenCalled();
  });

  it('copies a cached preview to a MIME-compatible extension before saving', async () => {
    const { shareOrSaveAttachment, native } = loadSaveAttachment('ios');

    await shareOrSaveAttachment('file:///cache/attachment-1.jpg', 'photo.png', 'image/png');

    expect(native.copyAsync).toHaveBeenCalledWith({
      from: 'file:///cache/attachment-1.jpg',
      to: 'file:///cache/attachment-1.png',
    });
    expect(native.createAsset).toHaveBeenCalledWith('file:///cache/attachment-1.png');
  });

  it('does not attempt to create an asset when add permission is denied', async () => {
    const { shareOrSaveAttachment, native } = loadSaveAttachment('ios', {
      permissionStatus: 'denied',
    });

    await expect(
      shareOrSaveAttachment('file:///cache/photo.jpg', 'photo.jpg', 'image/jpeg'),
    ).rejects.toThrow('Please allow access to your photo library to save media.');
    expect(native.createAsset).not.toHaveBeenCalled();
    expect(native.hapticSuccess).not.toHaveBeenCalled();
  });

  it('turns a native asset failure into a stable user-facing error', async () => {
    const consoleError = jest.spyOn(console, 'error').mockImplementation(() => undefined);
    const { shareOrSaveAttachment, native } = loadSaveAttachment('ios', {
      createAssetError: new Error('PHPhotosErrorDomain path=/private/cache/photo.jpg'),
    });

    await expect(
      shareOrSaveAttachment('file:///cache/photo.jpg', 'photo.jpg', 'image/jpeg'),
    ).rejects.toThrow('Could not save media to your photo library. Please try again.');
    expect(native.hapticSuccess).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalledWith('[saveAttachment] iOS media save failed', 'Error');
  });

  it('keeps Android media on the native Downloads route', async () => {
    const { shareOrSaveAttachment, native } = loadSaveAttachment('android');

    await shareOrSaveAttachment('file:///cache/photo.jpg', 'photo.jpg', 'image/jpeg');

    expect(native.saveAndroid).toHaveBeenCalledWith(
      'file:///cache/photo.jpg',
      'photo.jpg',
      'image/jpeg',
    );
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(native.createAsset).not.toHaveBeenCalled();
    expect(native.toast).toHaveBeenCalledWith('Saved to Downloads.', 0);
  });

  it.each([
    ['PDF', 'report.pdf', 'application/pdf'],
    ['Word', 'report.doc', 'application/msword'],
    [
      'Word OOXML',
      'report.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    ],
    ['Excel', 'report.xls', 'application/vnd.ms-excel'],
    [
      'Excel OOXML',
      'report.xlsx',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    ],
  ])('keeps iOS %s files on the share sheet route', async (_label, filename, mimetype) => {
    const { shareOrSaveAttachment, native } = loadSaveAttachment('ios');
    const localUri = `file:///cache/${filename}`;

    await shareOrSaveAttachment(localUri, filename, mimetype);

    expect(native.share).toHaveBeenCalledWith({ url: localUri });
    expect(native.requestPermissionsAsync).not.toHaveBeenCalled();
    expect(native.createAsset).not.toHaveBeenCalled();
  });
});
