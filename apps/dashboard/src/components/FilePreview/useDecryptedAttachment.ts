import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPreviewUrl } from '../../services/clients/fileFetchService';
import { fileEncryptionActive } from '../../services/fileEncryptionInterceptors';
import type { PreviewFile } from './types';

export interface DecryptedAttachment {
  /** Whether the file is read whole and decrypted here rather than streamed from its address. */
  decrypting: boolean;
  /** The decrypted file; undefined while it downloads or after it failed. */
  blob: Blob | undefined;
  failed: boolean;
}

/**
 * A streaming previewer's file while file encryption is on: the stream route serves a stored
 * file a range at a time, which an encrypted file cannot be, so the whole file is downloaded
 * from the attachment's download route (decrypted by the file encryption interceptor) instead.
 * A file with its own address, or any file while encryption is off, streams as before.
 */
export function useDecryptedAttachment(
  file: Pick<PreviewFile, 'id' | 'streamUrl'>,
): DecryptedAttachment {
  const decrypting = !file.streamUrl && fileEncryptionActive();
  const query = useQuery({
    queryKey: ['decrypted-attachment', file.id],
    queryFn: () => createPreviewUrl(file.id),
    enabled: decrypting,
    staleTime: 10 * 60 * 1000,
  });
  return { decrypting, blob: query.data, failed: query.isError };
}

/** An object URL for `blob`, revoked when it changes or the component unmounts. */
export function useObjectUrl(blob: Blob | undefined): string | undefined {
  const [url, setUrl] = useState<string>();
  useEffect(() => {
    if (!blob) {
      setUrl(undefined);
      return;
    }
    const next = URL.createObjectURL(blob);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [blob]);
  return url;
}
