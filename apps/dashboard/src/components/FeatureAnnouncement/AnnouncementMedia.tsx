import { ReactElement, useEffect, useState } from 'react';
import axios from 'axios';
import { isAnnouncementVideo } from '@xyne/shared';
import { apiInstance } from '../../services/clients/apiClient';

export interface LoadedMedia {
  objectUrl: string;
  isVideo: boolean;
}

export interface AnnouncementMediaProps {
  /** Path relative to the API root, as returned by the server. */
  path: string | null;
  /**
   * An already-resolved object URL, used by the admin editor to show a file the moment it
   * is chosen. The row still holds the previous key until the draft is saved, so fetching
   * by path would show stale media.
   */
  local?: LoadedMedia | null;
  alt: string;
  className?: string;
}

/**
 * Announcement media is served by an authenticated backend route on the API origin, which
 * an `<img>`/`<video>` src cannot reach with credentials. Fetched as a blob through the
 * API client instead, mirroring how profile pictures are loaded.
 *
 * Whether to render a video is decided from the blob's own content type rather than a
 * column or a filename, so it always matches the bytes actually stored. The whole clip
 * downloads before playback starts, which is why the upload cap for video is well below
 * the one for images.
 */
export function AnnouncementMedia({
  path,
  local = null,
  alt,
  className,
}: AnnouncementMediaProps): ReactElement | null {
  const [fetched, setFetched] = useState<LoadedMedia | null>(null);
  const media = local ?? fetched;

  useEffect(() => {
    if (local) return;
    if (!path) {
      setFetched(null);
      return;
    }

    let cancelled = false;
    let created: string | null = null;

    // An object URL is already local bytes: read its type directly and, crucially, do not
    // revoke it on cleanup — this component did not create it and its owner still needs it.
    const load = path.startsWith('blob:')
      ? // Raw axios, not apiInstance: an object URL is absolute and must not have the API
        // base prepended, and it needs no credentials.
        axios.get(path, { responseType: 'blob' }).then(response => ({
          objectUrl: path,
          blob: response.data as Blob,
          owned: false,
        }))
      : apiInstance.get(path, { responseType: 'blob' }).then(response => {
          const blob = response.data as Blob;
          return { objectUrl: URL.createObjectURL(blob), blob, owned: true };
        });

    void load
      .then(({ objectUrl, blob, owned }) => {
        if (cancelled) {
          if (owned) URL.revokeObjectURL(objectUrl);
          return;
        }
        if (owned) created = objectUrl;
        setFetched({ objectUrl, isVideo: isAnnouncementVideo(blob.type) });
      })
      .catch(() => {
        if (!cancelled) setFetched(null);
      });

    return (): void => {
      cancelled = true;
      if (created) URL.revokeObjectURL(created);
    };
  }, [local, path]);

  if (!media) return null;

  if (media.isVideo) {
    return (
      <video
        src={media.objectUrl}
        className={className}
        aria-label={alt}
        autoPlay
        muted
        loop
        playsInline
        // The clip is already fully downloaded, so there is nothing for the browser
        // chrome to control.
        controls={false}
      />
    );
  }

  return <img src={media.objectUrl} alt={alt} className={className} />;
}
