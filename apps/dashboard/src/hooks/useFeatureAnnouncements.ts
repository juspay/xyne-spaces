import { useCallback, useEffect, useRef, useState } from 'react';
import type { FeatureAnnouncementView } from '@xyne/shared';
import { featureAnnouncementApi } from '../api/featureAnnouncementApi';

/**
 * A refetch is only worth doing when the user has actually been away. Anything shorter is
 * a tab flick, and announcements change a few times a month.
 */
const MIN_REFRESH_INTERVAL_MS = 30 * 60 * 1000;

export interface FeatureAnnouncementsController {
  announcements: FeatureAnnouncementView[];
  markSeen: (id: string, pageIndex: number) => void;
  clickCta: (id: string) => Promise<void>;
  dismissAll: () => Promise<void>;
}

export function useFeatureAnnouncements(enabled: boolean): FeatureAnnouncementsController {
  const [announcements, setAnnouncements] = useState<FeatureAnnouncementView[]>([]);
  const lastFetchedAt = useRef(0);
  const inFlight = useRef(false);
  const seenReported = useRef(new Set<string>());

  const load = useCallback(async () => {
    if (!enabled || inFlight.current) return;
    inFlight.current = true;
    try {
      const pending = await featureAnnouncementApi.getPending();
      lastFetchedAt.current = Date.now();
      setAnnouncements(pending);
    } catch {
      // An announcement is the least urgent thing in the app; a failed poll stays silent
      // and the next visibility change retries.
    } finally {
      inFlight.current = false;
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) return;
    void load();
  }, [enabled, load]);

  /**
   * `visibilitychange` rather than `focus`: returning from another app fires both, which
   * would send two concurrent requests. On macOS the Electron window is hidden rather than
   * closed and the renderer is never reloaded, so without this a boot-only fetch would
   * never run again for a user who does not quit the app.
   */
  useEffect(() => {
    if (!enabled) return;
    const onVisible = (): void => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() - lastFetchedAt.current < MIN_REFRESH_INTERVAL_MS) return;
      void load();
    };
    document.addEventListener('visibilitychange', onVisible);
    return (): void => document.removeEventListener('visibilitychange', onVisible);
  }, [enabled, load]);

  /**
   * Fired when a page actually renders, which is what separates "seen" from the 200 that
   * merely delivered the batch. Deduplicated per page so stepping back and forth does not
   * re-post.
   */
  const markSeen = useCallback((id: string, pageIndex: number) => {
    const token = `${id}:${pageIndex}`;
    if (seenReported.current.has(token)) return;
    seenReported.current.add(token);
    void featureAnnouncementApi.markSeen(id, pageIndex).catch(() => {
      seenReported.current.delete(token);
    });
  }, []);

  /** A CTA burns only its own announcement; anything still queued stays pending. */
  const clickCta = useCallback(async (id: string) => {
    setAnnouncements(current => current.filter(announcement => announcement.id !== id));
    await featureAnnouncementApi.markCtaClicked(id).catch(() => undefined);
  }, []);

  /** The cross means "stop showing me things", so it covers the whole open batch. */
  const dismissAll = useCallback(async () => {
    const ids = announcements.map(announcement => announcement.id);
    setAnnouncements([]);
    if (ids.length === 0) return;
    await featureAnnouncementApi.dismiss(ids).catch(() => undefined);
  }, [announcements]);

  return { announcements, markSeen, clickCta, dismissAll };
}
