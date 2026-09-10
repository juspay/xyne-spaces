import { ReactElement, useEffect, useState } from 'react';
import axios from 'axios';
import { isAnnouncementVideo } from '@xyne/shared';
import { apiInstance } from '../../services/clients/apiClient';

export interface LoadedMedia {
  objectUrl: string;
  isVideo: boolean;
}

/**
 * Paths already warmed this session, so a re-render cannot re-issue a request.
 *
 * Published media is served `public, max-age=31536000, immutable` (see `streamMediaFor` in
 * featureAnnouncementController.ts), so warming the browser's HTTP cache is enough: the
 * component's own fetch for the same path is then served from disk instead of the network,
 * which is the whole of the latency worth hiding.
 *
 * Deliberately warms that cache rather than holding blobs in a module-level map. Nothing
 * ends up owning an object URL that may never be claimed, so there is no revocation
 * bookkeeping, and dismissing the card mid-queue cannot strand a downloaded 8MB clip in
 * memory. The cost is one extra decode when the page is actually opened.
 */
const warmedMediaPaths = new Set<string>();

/**
 * Warms one media path ahead of the page that needs it. Call it for the NEXT slide only —
 * an announcement's video may be up to 8MB and downloads in full before its first frame,
 * so warming a whole batch would cost far more than it saves.
 */
export function prefetchAnnouncementMedia(path: string | null | undefined): void {
  // A blob: URL is already local bytes; admin drafts are served `no-store` and cannot be
  // warmed at all, so there is nothing to gain from either.
  if (!path || path.startsWith('blob:') || warmedMediaPaths.has(path)) return;
  warmedMediaPaths.add(path);
  void apiInstance.get(path, { responseType: 'blob' }).catch(() => {
    // A failed warm is not an error — the component's own fetch will surface it. Drop the
    // marker so a later attempt is not suppressed by this one.
    warmedMediaPaths.delete(path);
  });
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
