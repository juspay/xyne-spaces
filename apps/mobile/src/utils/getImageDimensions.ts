import { Image } from 'react-native';

export const hasValidImageDimensions = (width?: number, height?: number): boolean =>
  typeof width === 'number' && width > 0 && typeof height === 'number' && height > 0;

export function getImageDimensionsFromUri(
  uri: string,
): Promise<{ width: number; height: number } | null> {
  return new Promise(resolve => {
    Image.getSize(
      uri,
      (width, height) => {
        if (width > 0 && height > 0) {
          resolve({ width, height });
          return;
        }
        resolve(null);
      },
      () => resolve(null),
    );
  });
}

/** Prefer picker metadata; fall back to reading the local file (display-oriented size). */
export async function resolveAttachmentImageDimensions(
  uri: string,
  width?: number,
  height?: number,
): Promise<{ width?: number; height?: number }> {
  if (hasValidImageDimensions(width, height)) {
    return { width: width!, height: height! };
  }

  const dims = await getImageDimensionsFromUri(uri);
  return dims ?? {};
}
