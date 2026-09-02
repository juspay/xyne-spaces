import { ReactElement, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FEATURE_ANNOUNCEMENT_LIMITS,
  FeatureAnnouncementCtaType,
  FeatureAnnouncementStatus,
  isAnnouncementVideo,
  type FeatureAnnouncementView,
} from '@xyne/shared';
import {
  featureAnnouncementApi,
  type AdminAnnouncement,
  type AnnouncementWritePayload,
} from '../../api/featureAnnouncementApi';
import { FeatureAnnouncementCard } from '../../components/FeatureAnnouncement/FeatureAnnouncementCard';
import {
  AnnouncementMedia,
  type LoadedMedia,
} from '../../components/FeatureAnnouncement/AnnouncementMedia';
import { MEDIA_ACCEPT_ATTRIBUTE, MEDIA_HINT, validateAnnouncementMedia } from './mediaConstraints';

interface PageDraft {
  title: string;
  description: string;
  mediaKey: string | null;
  mediaAlt: string | null;
}

interface Draft {
  id: string | null;
  key: string;
  title: string;
  description: string;
  mediaKey: string | null;
  mediaAlt: string | null;
  ctaLabel: string;
  ctaType: string;
  ctaTarget: string;
  cacKey: string;
  expiresAt: string;
  pages: PageDraft[];
}

const EMPTY_PAGE: PageDraft = { title: '', description: '', mediaKey: null, mediaAlt: null };

const EMPTY_DRAFT: Draft = {
  id: null,
  key: '',
  title: '',
  description: '',
  mediaKey: null,
  mediaAlt: null,
  ctaLabel: '',
  ctaType: '',
  ctaTarget: '',
  cacKey: '',
  expiresAt: '',
  pages: [{ ...EMPTY_PAGE }],
};

function toDraft(announcement: AdminAnnouncement): Draft {
  return {
    id: announcement.id,
    key: announcement.key,
    title: announcement.title,
    description: announcement.description,
    mediaKey: announcement.mediaKey,
    mediaAlt: announcement.mediaAlt,
    ctaLabel: announcement.ctaLabel ?? '',
    ctaType: announcement.ctaType ?? '',
    ctaTarget: announcement.ctaTarget ?? '',
    cacKey: announcement.cacKey ?? '',
    expiresAt: announcement.expiresAt ? announcement.expiresAt.slice(0, 10) : '',
    pages: (announcement.pages ?? []).map(page => ({
      title: page.title,
      description: page.description,
      mediaKey: page.mediaKey ?? null,
      mediaAlt: page.mediaAlt ?? null,
    })),
  };
}

function toPayload(draft: Draft, includeKey: boolean): AnnouncementWritePayload {
  const hasCta = Boolean(draft.ctaType);
  return {
    ...(includeKey ? { key: draft.key.trim() } : {}),
    title: draft.title.trim(),
    description: draft.description.trim(),
    pages: draft.pages.map(page => ({
      title: page.title.trim(),
      description: page.description.trim(),
      mediaKey: page.mediaKey,
      mediaAlt: page.mediaAlt,
    })),
    mediaKey: draft.mediaKey,
    mediaAlt: draft.mediaAlt,
    ctaLabel: hasCta ? draft.ctaLabel.trim() : null,
    ctaType: hasCta ? draft.ctaType : null,
    ctaTarget: hasCta ? draft.ctaTarget.trim() : null,
    cacKey: draft.cacKey.trim() || null,
    expiresAt: draft.expiresAt ? new Date(draft.expiresAt).toISOString() : null,
  };
}

/**
 * Mirrors the server response shape so the preview renders the real card component.
 * Media resolves through the admin route, which serves drafts too — an announcement has
 * to be reviewable before it is published.
 */
function toPreview(draft: Draft, localMedia: Record<string, LoadedMedia>): FeatureAnnouncementView {
  const mediaUrl = (index: number | 'cover', mediaKey: string | null): string | null => {
    if (!mediaKey) return null;
    // A freshly chosen file is already in the browser; the row still points at the old key
    // until the draft is saved, so prefer the local bytes.
    const pending = localMedia[mediaKey];
    if (pending) return pending.objectUrl;
    return draft.id ? featureAnnouncementApi.admin.mediaPath(draft.id, index) : null;
  };

  return {
    id: draft.id ?? 'preview',
    key: draft.key,
    title: draft.title,
    description: draft.description,
    mediaUrl: mediaUrl('cover', draft.mediaKey),
    mediaAlt: draft.mediaAlt,
    ctaLabel: draft.ctaLabel || null,
    ctaType: (draft.ctaType || null) as FeatureAnnouncementView['ctaType'],
    ctaTarget: draft.ctaTarget || null,
    pages: draft.pages.map((page, index) => ({
      title: page.title || 'Untitled page',
      description: page.description,
      mediaUrl: mediaUrl(index, page.mediaKey),
      mediaAlt: page.mediaAlt,
    })),
    progress: null,
  };
}

function errorMessage(error: unknown): string {
  const response = (error as { response?: { data?: { error?: string } } })?.response;
  return response?.data?.error ?? 'Something went wrong';
}

/**
 * Placeholder presentation for the design team to replace. The behaviour is complete:
 * draft/publish/archive transitions, page editing within the server-enforced cap, media
 * upload, CTA configuration, and a preview that renders the real card.
 */
export function AnnouncementsTab({ isActive }: { isActive: boolean }): ReactElement {
  const [announcements, setAnnouncements] = useState<AdminAnnouncement[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  // Kept apart from `status`: the upload controls sit far below the top of the tab, so a
  // rejection shown up there reads as nothing having happened at all.
  const [mediaError, setMediaError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  /**
   * Media uploads to storage immediately, but the row keeps its previous key until the
   * draft is saved. Without this the editor would show stale media between the two.
   */
  const [localMedia, setLocalMedia] = useState<Record<string, LoadedMedia>>({});

  // Revoke on unmount only. Keying the cleanup on `localMedia` would revoke the URLs of
  // every earlier upload each time a new one is added, blanking media still on screen.
  const localMediaRef = useRef(localMedia);
  localMediaRef.current = localMedia;
  useEffect(
    () => (): void => {
      Object.values(localMediaRef.current).forEach(entry => URL.revokeObjectURL(entry.objectUrl));
    },
    [],
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setAnnouncements(await featureAnnouncementApi.admin.list());
      setStatus(null);
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (isActive) void refresh();
  }, [isActive, refresh]);

  const isNew = draft?.id === null;
  const preview = useMemo(() => (draft ? toPreview(draft, localMedia) : null), [draft, localMedia]);

  const patch = useCallback((changes: Partial<Draft>) => {
    setDraft(current => (current ? { ...current, ...changes } : current));
  }, []);

  const patchPage = useCallback((index: number, changes: Partial<PageDraft>) => {
    setDraft(current => {
      if (!current) return current;
      const pages = current.pages.map((page, i) => (i === index ? { ...page, ...changes } : page));
      return { ...current, pages };
    });
  }, []);

  const movePage = useCallback((index: number, delta: number) => {
    setDraft(current => {
      if (!current) return current;
      const target = index + delta;
      if (target < 0 || target >= current.pages.length) return current;
      const pages = [...current.pages];
      [pages[index], pages[target]] = [pages[target], pages[index]];
      return { ...current, pages };
    });
  }, []);

  const uploadMedia = useCallback(async (file: File, apply: (mediaKey: string) => void) => {
    setMediaError(null);
    const rejection = await validateAnnouncementMedia(file);
    if (rejection) {
      setMediaError(rejection);
      return;
    }
    try {
      const mediaKey = await featureAnnouncementApi.admin.uploadMedia(file);
      setLocalMedia(current => ({
        ...current,
        [mediaKey]: {
          objectUrl: URL.createObjectURL(file),
          isVideo: isAnnouncementVideo(file.type),
        },
      }));
      apply(mediaKey);
    } catch (error) {
      setMediaError(errorMessage(error));
    }
  }, []);

  const save = useCallback(async () => {
    if (!draft) return;
    setLoading(true);
    try {
      if (draft.id) {
        await featureAnnouncementApi.admin.update(draft.id, toPayload(draft, false));
      } else {
        await featureAnnouncementApi.admin.create(toPayload(draft, true));
      }
      setDraft(null);
      await refresh();
    } catch (error) {
      setStatus(errorMessage(error));
    } finally {
      setLoading(false);
    }
  }, [draft, refresh]);

  const runTransition = useCallback(
    async (action: 'publish' | 'archive', id: string) => {
      setLoading(true);
      try {
        await featureAnnouncementApi.admin[action](id);
        await refresh();
      } catch (error) {
        setStatus(errorMessage(error));
      } finally {
        setLoading(false);
      }
    },
    [refresh],
  );

  return (
    <div className='flex flex-col gap-4'>
      <div className='flex items-center justify-between'>
        <h2 className='text-lg font-semibold'>Feature announcements</h2>
        <button
          type='button'
          data-track-category='WorkspaceAnnouncements'
          data-track-name='announcement-new'
          onClick={() => setDraft({ ...EMPTY_DRAFT, pages: [{ ...EMPTY_PAGE }] })}
          className='rounded-md border border-border px-3 py-1 text-sm'
        >
          New announcement
        </button>
      </div>

      {status && <p className='text-sm text-destructive'>{status}</p>}

      <table className='w-full text-left text-sm'>
        <thead>
          <tr className='border-b border-border text-muted-foreground'>
            <th className='py-2'>Key</th>
            <th>Title</th>
            <th>Status</th>
            <th>Published</th>
            <th>Pages</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {announcements.map(announcement => (
            <tr key={announcement.id} className='border-b border-border'>
              <td className='py-2 font-mono text-xs'>{announcement.key}</td>
              <td>{announcement.title}</td>
              <td>{announcement.status}</td>
              <td>{announcement.publishedAt?.slice(0, 10) ?? '—'}</td>
              <td>{announcement.pageCount}</td>
              <td className='flex gap-2 py-2'>
                <button
                  type='button'
                  disabled={!announcement.editable}
                  data-track-category='WorkspaceAnnouncements'
                  data-track-name='announcement-edit'
                  onClick={() => setDraft(toDraft(announcement))}
                  className='rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40'
                >
                  Edit
                </button>
                {announcement.status === FeatureAnnouncementStatus.DRAFT && (
                  <button
                    type='button'
                    disabled={!announcement.editable}
                    data-track-category='WorkspaceAnnouncements'
                    data-track-name='announcement-publish'
                    onClick={() => void runTransition('publish', announcement.id)}
                    className='rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40'
                  >
                    Publish
                  </button>
                )}
                {announcement.status !== FeatureAnnouncementStatus.ARCHIVED && (
                  <button
                    type='button'
                    disabled={!announcement.editable}
                    data-track-category='WorkspaceAnnouncements'
                    data-track-name='announcement-archive'
                    onClick={() => void runTransition('archive', announcement.id)}
                    className='rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40'
                  >
                    Archive
                  </button>
                )}
              </td>
            </tr>
          ))}
          {announcements.length === 0 && !loading && (
            <tr>
              <td colSpan={6} className='py-4 text-muted-foreground'>
                No announcements yet.
              </td>
            </tr>
          )}
        </tbody>
      </table>

      {draft && (
        <div className='flex gap-6 rounded-md border border-border p-4'>
          <div className='flex w-full max-w-xl flex-col gap-3'>
            <label className='flex flex-col gap-1 text-sm'>
              Key
              <input
                value={draft.key}
                disabled={!isNew}
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-key'
                onChange={event => patch({ key: event.target.value })}
                placeholder='daily_brief_v2'
                className='rounded-md border border-border px-2 py-1 disabled:opacity-50'
              />
            </label>

            <label className='flex flex-col gap-1 text-sm'>
              Title
              <input
                value={draft.title}
                maxLength={FEATURE_ANNOUNCEMENT_LIMITS.MAX_TITLE_LENGTH}
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-title'
                onChange={event => patch({ title: event.target.value })}
                className='rounded-md border border-border px-2 py-1'
              />
            </label>

            <label className='flex flex-col gap-1 text-sm'>
              Description
              <textarea
                value={draft.description}
                maxLength={FEATURE_ANNOUNCEMENT_LIMITS.MAX_DESCRIPTION_LENGTH}
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-description'
                onChange={event => patch({ description: event.target.value })}
                className='rounded-md border border-border px-2 py-1'
              />
            </label>

            <div className='flex items-start gap-3 text-sm'>
              {draft.mediaKey && (draft.id || localMedia[draft.mediaKey]) && (
                <AnnouncementMedia
                  path={featureAnnouncementApi.admin.mediaPath(draft.id, 'cover')}
                  local={draft.mediaKey ? localMedia[draft.mediaKey] : null}
                  alt='Fallback media'
                  className='h-16 w-28 shrink-0 rounded-md border border-border object-cover'
                />
              )}
              <div className='flex flex-col gap-1'>
                <div className='flex items-center gap-2'>
                  <button
                    type='button'
                    data-track-category='WorkspaceAnnouncements'
                    data-track-name='announcement-cover-pick'
                    onClick={() => coverInput.current?.click()}
                    className='rounded-md border border-border px-2 py-1'
                  >
                    Upload fallback media
                  </button>
                  {draft.mediaKey && (
                    <button
                      type='button'
                      data-track-category='WorkspaceAnnouncements'
                      data-track-name='announcement-cover-clear'
                      onClick={() => patch({ mediaKey: null })}
                      className='rounded-md border border-border px-2 py-1 text-xs'
                    >
                      Remove
                    </button>
                  )}
                </div>
                <p className='text-xs text-muted-foreground'>
                  Shown only on pages that have no media of their own. Give every page its own media
                  and this is never displayed.
                </p>
              </div>
              <input
                ref={coverInput}
                type='file'
                hidden
                accept={MEDIA_ACCEPT_ATTRIBUTE}
                onChange={event => {
                  const file = event.target.files?.[0];
                  if (file) void uploadMedia(file, mediaKey => patch({ mediaKey }));
                  event.target.value = '';
                }}
              />
            </div>
            <p className='text-xs text-muted-foreground'>{MEDIA_HINT}</p>
            {mediaError && (
              <p role='alert' className='text-xs font-medium text-destructive'>
                {mediaError}
              </p>
            )}

            <fieldset className='flex flex-col gap-2 rounded-md border border-border p-2'>
              <legend className='px-1 text-sm'>Pages</legend>
              {draft.pages.map((page, index) => (
                <div key={index} className='flex flex-col gap-1 border-b border-border pb-2'>
                  <div className='flex items-center gap-2'>
                    <input
                      value={page.title}
                      placeholder={`Page ${index + 1} title`}
                      data-track-category='WorkspaceAnnouncements'
                      data-track-name='announcement-page-title'
                      onChange={event => patchPage(index, { title: event.target.value })}
                      className='flex-1 rounded-md border border-border px-2 py-1 text-sm'
                    />
                    <button
                      type='button'
                      data-track-category='WorkspaceAnnouncements'
                      data-track-name='announcement-page-move-up'
                      onClick={() => movePage(index, -1)}
                      className='px-1 text-xs'
                    >
                      ↑
                    </button>
                    <button
                      type='button'
                      data-track-category='WorkspaceAnnouncements'
                      data-track-name='announcement-page-move-down'
                      onClick={() => movePage(index, 1)}
                      className='px-1 text-xs'
                    >
                      ↓
                    </button>
                    <button
                      type='button'
                      data-track-category='WorkspaceAnnouncements'
                      data-track-name='announcement-page-remove'
                      disabled={draft.pages.length <= 1}
                      onClick={() => patch({ pages: draft.pages.filter((_, i) => i !== index) })}
                      className='px-1 text-xs disabled:opacity-40'
                    >
                      ✕
                    </button>
                  </div>
                  <textarea
                    value={page.description}
                    placeholder='Page description'
                    data-track-category='WorkspaceAnnouncements'
                    data-track-name='announcement-page-description'
                    onChange={event => patchPage(index, { description: event.target.value })}
                    className='rounded-md border border-border px-2 py-1 text-sm'
                  />
                  <div className='flex items-center gap-2 text-xs'>
                    {page.mediaKey && (draft.id || localMedia[page.mediaKey]) && (
                      <AnnouncementMedia
                        path={featureAnnouncementApi.admin.mediaPath(draft.id, index)}
                        local={page.mediaKey ? localMedia[page.mediaKey] : null}
                        alt={`Page ${index + 1} media`}
                        className='h-12 w-20 shrink-0 rounded-md border border-border object-cover'
                      />
                    )}
                    <label className='flex items-center gap-2'>
                      <span className='text-muted-foreground'>
                        {page.mediaKey ? 'replace media' : 'no media — falls back to the cover'}
                      </span>
                      <input
                        type='file'
                        accept={MEDIA_ACCEPT_ATTRIBUTE}
                        onChange={event => {
                          const file = event.target.files?.[0];
                          if (file) {
                            void uploadMedia(file, mediaKey => patchPage(index, { mediaKey }));
                          }
                          event.target.value = '';
                        }}
                      />
                    </label>
                    {page.mediaKey && (
                      <button
                        type='button'
                        data-track-category='WorkspaceAnnouncements'
                        data-track-name='announcement-page-media-clear'
                        onClick={() => patchPage(index, { mediaKey: null })}
                        className='rounded-md border border-border px-2 py-1'
                      >
                        Remove
                      </button>
                    )}
                  </div>
                </div>
              ))}
              <button
                type='button'
                disabled={draft.pages.length >= FEATURE_ANNOUNCEMENT_LIMITS.MAX_PAGES}
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-page-add'
                onClick={() => patch({ pages: [...draft.pages, { ...EMPTY_PAGE }] })}
                className='self-start rounded-md border border-border px-2 py-1 text-xs disabled:opacity-40'
              >
                Add page
              </button>
            </fieldset>

            <fieldset className='flex flex-col gap-2 rounded-md border border-border p-2'>
              <legend className='px-1 text-sm'>Call to action</legend>
              <select
                value={draft.ctaType}
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-cta-type'
                onChange={event => patch({ ctaType: event.target.value })}
                className='rounded-md border border-border px-2 py-1 text-sm'
              >
                <option value=''>None</option>
                <option value={FeatureAnnouncementCtaType.ROUTE}>Route</option>
                <option value={FeatureAnnouncementCtaType.EXTERNAL}>External link</option>
              </select>
              {draft.ctaType && (
                <>
                  <input
                    value={draft.ctaLabel}
                    placeholder='Button label'
                    data-track-category='WorkspaceAnnouncements'
                    data-track-name='announcement-cta-label'
                    onChange={event => patch({ ctaLabel: event.target.value })}
                    className='rounded-md border border-border px-2 py-1 text-sm'
                  />
                  <input
                    value={draft.ctaTarget}
                    placeholder={
                      draft.ctaType === FeatureAnnouncementCtaType.ROUTE
                        ? '/daily-brief'
                        : 'https://xyne.io/docs'
                    }
                    data-track-category='WorkspaceAnnouncements'
                    data-track-name='announcement-cta-target'
                    onChange={event => patch({ ctaTarget: event.target.value })}
                    className='rounded-md border border-border px-2 py-1 text-sm'
                  />
                </>
              )}
            </fieldset>

            <div className='flex gap-2'>
              <label className='flex flex-1 flex-col gap-1 text-sm'>
                Feature flag key
                <input
                  value={draft.cacKey}
                  data-track-category='WorkspaceAnnouncements'
                  data-track-name='announcement-cac-key'
                  onChange={event => patch({ cacKey: event.target.value })}
                  className='rounded-md border border-border px-2 py-1'
                />
              </label>
              <label className='flex flex-1 flex-col gap-1 text-sm'>
                Expires at
                <input
                  type='date'
                  value={draft.expiresAt}
                  data-track-category='WorkspaceAnnouncements'
                  data-track-name='announcement-expires-at'
                  onChange={event => patch({ expiresAt: event.target.value })}
                  className='rounded-md border border-border px-2 py-1'
                />
              </label>
            </div>

            <div className='flex gap-2'>
              <button
                type='button'
                disabled={loading}
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-save'
                onClick={() => void save()}
                className='rounded-md bg-foreground px-3 py-1 text-sm text-background disabled:opacity-50'
              >
                Save draft
              </button>
              <button
                type='button'
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-cancel'
                onClick={() => setDraft(null)}
                className='rounded-md border border-border px-3 py-1 text-sm'
              >
                Cancel
              </button>
            </div>
          </div>

          <div className='flex flex-col gap-2'>
            <span className='text-sm text-muted-foreground'>Preview</span>
            {preview && (
              <FeatureAnnouncementCard
                announcement={preview}
                onSeen={() => undefined}
                onCta={() => undefined}
                onDismiss={() => undefined}
                previewOnly
              />
            )}
          </div>
        </div>
      )}
    </div>
  );
}
