import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { createPreviewUrl } from '../../services/clients/fileFetchService';
import {
  fileEncryptionActive,
  fileStreamWorkerReady,
} from '../../services/fileEncryptionInterceptors';
import type { PreviewFile } from './types';

export interface DecryptedAttachment {
  /** Whether the file is read whole and decrypted here rather than streamed from its address. */
  decrypting: boolean;
  /** The decrypted file; undefined while it downloads or after it failed. */
  blob: Blob | undefined;
  failed: boolean;
}

/**
 * A streaming player's file while file encryption is on and no service worker can stream it:
 * the service worker (public/sw.js) decrypts range reads of the stream route, but where there
 * is none (the desktop app's custom protocol, a first load before it takes control) the whole
 * file is downloaded from the attachment's download route (decrypted by the file encryption
 * interceptor) instead. A file with its own address, or any file while encryption is off,
 * streams as before.
 */
export function useDecryptedAttachment(
  file: { id?: string | undefined } & Pick<PreviewFile, 'streamUrl'>,
): DecryptedAttachment {
  const id = file.id ?? '';
  const decrypting =
    id !== '' && !file.streamUrl && fileEncryptionActive() && !fileStreamWorkerReady();
  const query = useQuery({
    queryKey: ['decrypted-attachment', id],
    queryFn: () => createPreviewUrl(id),
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
