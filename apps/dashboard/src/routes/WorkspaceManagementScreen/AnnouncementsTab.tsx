import { ReactElement, ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, MultipleCrossCancelDefault, PlusDefault, UploadUp } from '@xyne/icons';
import {
  FEATURE_ANNOUNCEMENT_LIMITS,
  FeatureAnnouncementCtaType,
  FeatureAnnouncementStatus,
  isAnnouncementVideo,
  type FeatureAnnouncementView,
} from '@xyne/shared';
import Button, { buttonVariants } from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Textarea from '../../components/ui/Textarea';
import { Badge } from '../../components/ui/Badge/Badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '../../components/ui/Select';
import { cn } from '../../utils/classNames';
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

/** Stands in for "no CTA" in the Select, which cannot carry an empty-string value. */
const CTA_NONE = 'none';

/** Draft reads as neutral, published as live, archived as retired. */
const STATUS_VARIANT: Record<string, 'success' | 'secondary' | 'outline'> = {
  [FeatureAnnouncementStatus.PUBLISHED]: 'success',
  [FeatureAnnouncementStatus.DRAFT]: 'secondary',
  [FeatureAnnouncementStatus.ARCHIVED]: 'outline',
};

/**
 * Admin surface for feature announcements: draft/publish/archive transitions, page editing
 * within the server-enforced cap, media upload, CTA configuration, and a preview that
 * renders the real card.
 *
 * Controls come from `components/ui` rather than bare elements. Bare `input`/`textarea`/
 * `select` inherit the user agent's own control styling, which follows the OS appearance
 * rather than the app theme — that is why this form rendered dark boxes on a light page.
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
      // Read both out before writing: under noUncheckedIndexedAccess a destructuring swap
      // is typed as possibly-undefined on each side, and the guards above already prove
      // both indices are in range.
      const from = pages[index];
      const to = pages[target];
      if (!from || !to) return current;
      pages[index] = to;
      pages[target] = from;
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
      <div className='flex items-start justify-between gap-4'>
        <div className='flex flex-col gap-1'>
          <h2 className='text-lg font-semibold text-foreground'>Feature announcements</h2>
          <p className='text-sm text-muted-foreground'>
            Shown once to workspace members who joined before an announcement went live.
          </p>
        </div>
        <Button
          variant='outline'
          size='sm'
          data-track-category='WorkspaceAnnouncements'
          data-track-name='announcement-new'
          onClick={() => setDraft({ ...EMPTY_DRAFT, pages: [{ ...EMPTY_PAGE }] })}
        >
          <PlusDefault />
          New announcement
        </Button>
      </div>

      {status && (
        <p
          role='alert'
          className='rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive'
        >
          {status}
        </p>
      )}

      <div className='overflow-hidden rounded-lg border border-border'>
        <table className='w-full text-left text-sm'>
          <thead>
            <tr className='border-b border-border bg-muted/50 text-xs tracking-wide text-muted-foreground uppercase'>
              <th className='px-3 py-2 font-medium'>Key</th>
              <th className='px-3 py-2 font-medium'>Title</th>
              <th className='px-3 py-2 font-medium'>Status</th>
              <th className='px-3 py-2 font-medium'>Published</th>
              <th className='px-3 py-2 font-medium'>Pages</th>
              <th className='px-3 py-2' />
            </tr>
          </thead>
          <tbody>
            {announcements.map(announcement => (
              <tr
                key={announcement.id}
                className='border-b border-border transition-colors last:border-b-0 hover:bg-accent/50'
              >
                <td className='px-3 py-2 font-mono text-xs text-muted-foreground'>
                  {announcement.key}
                </td>
                <td className='px-3 py-2 text-foreground'>{announcement.title}</td>
                <td className='px-3 py-2'>
                  <Badge variant={STATUS_VARIANT[announcement.status] ?? 'outline'}>
                    {announcement.status}
                  </Badge>
                </td>
                <td className='px-3 py-2 text-muted-foreground'>
                  {announcement.publishedAt?.slice(0, 10) ?? '—'}
                </td>
                <td className='px-3 py-2 text-muted-foreground'>{announcement.pageCount}</td>
                <td className='px-3 py-2'>
                  <div className='flex justify-end gap-1.5'>
                    <Button
                      variant='outline'
                      size='sm'
                      disabled={!announcement.editable}
                      data-track-category='WorkspaceAnnouncements'
                      data-track-name='announcement-edit'
                      onClick={() => setDraft(toDraft(announcement))}
                    >
                      Edit
                    </Button>
                    {announcement.status === FeatureAnnouncementStatus.DRAFT && (
                      <Button
                        variant='outline'
                        size='sm'
                        disabled={!announcement.editable}
                        data-track-category='WorkspaceAnnouncements'
                        data-track-name='announcement-publish'
                        onClick={() => void runTransition('publish', announcement.id)}
                      >
                        Publish
                      </Button>
                    )}
                    {announcement.status !== FeatureAnnouncementStatus.ARCHIVED && (
                      <Button
                        variant='ghost'
                        size='sm'
                        disabled={!announcement.editable}
                        data-track-category='WorkspaceAnnouncements'
                        data-track-name='announcement-archive'
                        onClick={() => void runTransition('archive', announcement.id)}
                      >
                        Archive
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {announcements.length === 0 && !loading && (
              <tr>
                <td colSpan={6} className='px-3 py-6 text-center text-muted-foreground'>
                  No announcements yet.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {draft && (
        <div className='flex flex-wrap gap-6 rounded-lg border border-border bg-card p-4'>
          <div className='flex w-full max-w-xl flex-col gap-4'>
            <Field label='Key'>
              <Input
                value={draft.key}
                disabled={!isNew}
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-key'
                onChange={event => patch({ key: event.target.value })}
                placeholder='daily_brief_v2'
                className='font-mono'
              />
            </Field>

            <Field label='Title'>
              <Input
                value={draft.title}
                maxLength={FEATURE_ANNOUNCEMENT_LIMITS.MAX_TITLE_LENGTH}
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-title'
                onChange={event => patch({ title: event.target.value })}
              />
            </Field>

            <Field label='Description'>
              <Textarea
                value={draft.description}
                maxLength={FEATURE_ANNOUNCEMENT_LIMITS.MAX_DESCRIPTION_LENGTH}
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-description'
                onChange={event => patch({ description: event.target.value })}
              />
            </Field>

            <div className='flex flex-col gap-2'>
              <span className='text-sm font-medium text-foreground'>Fallback media</span>
              <div className='flex items-start gap-3'>
                {draft.mediaKey && (draft.id || localMedia[draft.mediaKey]) && (
                  <AnnouncementMedia
                    // An unsaved draft has no id to build an admin path from; the local
                    // bytes below are what render until it is saved.
                    path={
                      draft.id ? featureAnnouncementApi.admin.mediaPath(draft.id, 'cover') : null
                    }
                    local={localMedia[draft.mediaKey] ?? null}
                    alt='Fallback media'
                    className='h-16 w-28 shrink-0 rounded-md border border-border object-cover'
                  />
                )}
                <div className='flex flex-col gap-1.5'>
                  <div className='flex items-center gap-2'>
                    <Button
                      variant='outline'
                      size='sm'
                      data-track-category='WorkspaceAnnouncements'
                      data-track-name='announcement-cover-pick'
                      onClick={() => coverInput.current?.click()}
                    >
                      <UploadUp />
                      Upload fallback media
                    </Button>
                    {draft.mediaKey && (
                      <Button
                        variant='ghost'
                        size='sm'
                        data-track-category='WorkspaceAnnouncements'
                        data-track-name='announcement-cover-clear'
                        onClick={() => patch({ mediaKey: null })}
                      >
                        Remove
                      </Button>
                    )}
                  </div>
                  <p className='text-xs text-muted-foreground'>
                    Shown only on pages that have no media of their own. Give every page its own
                    media and this is never displayed.
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
            </div>

            <fieldset className='flex flex-col gap-3 rounded-lg border border-border p-3'>
              <legend className='px-1 text-sm font-medium text-foreground'>Pages</legend>
              {draft.pages.map((page, index) => (
                <div
                  key={index}
                  className='flex flex-col gap-2 rounded-md border border-border bg-background p-3'
                >
                  <div className='flex items-center gap-1.5'>
                    <Input
                      value={page.title}
                      placeholder={`Page ${index + 1} title`}
                      data-track-category='WorkspaceAnnouncements'
                      data-track-name='announcement-page-title'
                      onChange={event => patchPage(index, { title: event.target.value })}
                      className='h-8 flex-1'
                    />
                    <Button
                      variant='ghost'
                      size='iconSm'
                      aria-label={`Move page ${index + 1} up`}
                      disabled={index === 0}
                      data-track-category='WorkspaceAnnouncements'
                      data-track-name='announcement-page-move-up'
                      onClick={() => movePage(index, -1)}
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant='ghost'
                      size='iconSm'
                      aria-label={`Move page ${index + 1} down`}
                      disabled={index === draft.pages.length - 1}
                      data-track-category='WorkspaceAnnouncements'
                      data-track-name='announcement-page-move-down'
                      onClick={() => movePage(index, 1)}
                    >
                      <ArrowDown />
                    </Button>
                    <Button
                      variant='ghost'
                      size='iconSm'
                      aria-label={`Remove page ${index + 1}`}
                      disabled={draft.pages.length <= 1}
                      data-track-category='WorkspaceAnnouncements'
                      data-track-name='announcement-page-remove'
                      onClick={() => patch({ pages: draft.pages.filter((_, i) => i !== index) })}
                    >
                      <MultipleCrossCancelDefault />
                    </Button>
                  </div>
                  <Textarea
                    value={page.description}
                    placeholder='Page description'
                    data-track-category='WorkspaceAnnouncements'
                    data-track-name='announcement-page-description'
                    onChange={event => patchPage(index, { description: event.target.value })}
                    className='min-h-[64px]'
                  />
                  <div className='flex items-center gap-2'>
                    {page.mediaKey && (draft.id || localMedia[page.mediaKey]) && (
                      <AnnouncementMedia
                        path={
                          draft.id ? featureAnnouncementApi.admin.mediaPath(draft.id, index) : null
                        }
                        local={localMedia[page.mediaKey] ?? null}
                        alt={`Page ${index + 1} media`}
                        className='h-12 w-20 shrink-0 rounded-md border border-border object-cover'
                      />
                    )}
                    {/* A label styled as a button, rather than a Button plus a ref per page:
                        the native file input stays the thing that is actually clicked, so no
                        per-index ref array is needed to forward the click. */}
                    <label
                      htmlFor={`announcement-page-media-${index}`}
                      className={cn(
                        buttonVariants({ variant: 'outline', size: 'sm' }),
                        'cursor-pointer',
                      )}
                    >
                      <UploadUp />
                      {page.mediaKey ? 'Replace media' : 'Add media'}
                    </label>
                    <input
                      id={`announcement-page-media-${index}`}
                      type='file'
                      hidden
                      accept={MEDIA_ACCEPT_ATTRIBUTE}
                      onChange={event => {
                        const file = event.target.files?.[0];
                        if (file) {
                          void uploadMedia(file, mediaKey => patchPage(index, { mediaKey }));
                        }
                        event.target.value = '';
                      }}
                    />
                    {page.mediaKey ? (
                      <Button
                        variant='ghost'
                        size='sm'
                        data-track-category='WorkspaceAnnouncements'
                        data-track-name='announcement-page-media-clear'
                        onClick={() => patchPage(index, { mediaKey: null })}
                      >
                        Remove
                      </Button>
                    ) : (
                      <span className='text-xs text-muted-foreground'>
                        No media — falls back to the cover
                      </span>
                    )}
                  </div>
                </div>
              ))}
              <Button
                variant='outline'
                size='sm'
                className='self-start'
                disabled={draft.pages.length >= FEATURE_ANNOUNCEMENT_LIMITS.MAX_PAGES}
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-page-add'
                onClick={() => patch({ pages: [...draft.pages, { ...EMPTY_PAGE }] })}
              >
                <PlusDefault />
                Add page
              </Button>
            </fieldset>

            <fieldset className='flex flex-col gap-3 rounded-lg border border-border p-3'>
              <legend className='px-1 text-sm font-medium text-foreground'>Call to action</legend>
              {/* Radix rejects an empty-string item value, so the "no CTA" choice carries a
                  sentinel and is mapped back to '' — which is what toPayload reads. */}
              <Select
                value={draft.ctaType || CTA_NONE}
                onValueChange={value =>
                  patch({ ctaType: value === CTA_NONE ? '' : value, ctaLabel: '', ctaTarget: '' })
                }
              >
                <SelectTrigger
                  className='w-full'
                  data-track-category='WorkspaceAnnouncements'
                  data-track-name='announcement-cta-type'
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={CTA_NONE}>None</SelectItem>
                  <SelectItem value={FeatureAnnouncementCtaType.ROUTE}>Route</SelectItem>
                  <SelectItem value={FeatureAnnouncementCtaType.EXTERNAL}>External link</SelectItem>
                </SelectContent>
              </Select>
              {draft.ctaType && (
                <>
                  <Input
                    value={draft.ctaLabel}
                    placeholder='Button label'
                    data-track-category='WorkspaceAnnouncements'
                    data-track-name='announcement-cta-label'
                    onChange={event => patch({ ctaLabel: event.target.value })}
                  />
                  <Input
                    value={draft.ctaTarget}
                    placeholder={
                      draft.ctaType === FeatureAnnouncementCtaType.ROUTE
                        ? '/<workspaceId>/ai/daily-brief'
                        : 'https://xyne.io/docs'
                    }
                    data-track-category='WorkspaceAnnouncements'
                    data-track-name='announcement-cta-target'
                    onChange={event => patch({ ctaTarget: event.target.value })}
                    className='font-mono'
                  />
                </>
              )}
            </fieldset>

            <div className='flex gap-3'>
              <Field label='Feature flag key' className='flex-1'>
                <Input
                  value={draft.cacKey}
                  data-track-category='WorkspaceAnnouncements'
                  data-track-name='announcement-cac-key'
                  onChange={event => patch({ cacKey: event.target.value })}
                  className='font-mono'
                />
              </Field>
              <Field label='Expires at' className='flex-1'>
                <Input
                  type='date'
                  value={draft.expiresAt}
                  data-track-category='WorkspaceAnnouncements'
                  data-track-name='announcement-expires-at'
                  onChange={event => patch({ expiresAt: event.target.value })}
                />
              </Field>
            </div>

            <div className='flex gap-2 border-t border-border pt-4'>
              <Button
                size='sm'
                loading={loading}
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-save'
                onClick={() => void save()}
              >
                Save draft
              </Button>
              <Button
                variant='ghost'
                size='sm'
                data-track-category='WorkspaceAnnouncements'
                data-track-name='announcement-cancel'
                onClick={() => setDraft(null)}
              >
                Cancel
              </Button>
            </div>
          </div>

          <div className='flex flex-col gap-2'>
            <span className='text-sm font-medium text-foreground'>Preview</span>
            {preview && (
              <FeatureAnnouncementCard
                announcements={[preview]}
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

/** Label + control, so every field in the form lines up without repeating the markup. */
function Field({
  label,
  className,
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}): ReactElement {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <span className='text-sm font-medium text-foreground'>{label}</span>
      {children}
    </label>
  );
}
