import { ReactElement, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronLeft, FolderOpen, Globe, Lock, Trash2, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { cn } from '@/utils/classNames';
import { Button } from '@/components/ui/Button';
import { Switch } from '@/components/ui/Switch';
import { Skeleton } from '@/components/ui/Skeleton';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { useAuth } from '@/hooks/useAuth';
import { useClawSkills, useClawSkillFiles, useClawAdminStatus } from '@/hooks/useClawSkills';
import {
  updateSkill,
  deleteSkill,
  replaceSkillFiles,
  submitSkillRequest,
} from '@/services/claw/clawSkillsService';
import { readSkillFilesFromFileList } from '@/services/claw/clawSkillFileUtils';
import { ClawApiError } from '@/services/claw/clawAuthAgentsService';
import type { Skill } from '@/services/claw/clawSkillsTypes';

const sourceLabel = (source: string): string => {
  switch (source) {
    case 'seeded':
      return 'built-in';
    case 'user-created':
      return 'custom';
    case 'uploaded':
      return 'uploaded';
    default:
      return source;
  }
};

const scopeLabel = (scope: string): string => (scope === 'global' ? 'global' : 'personal');

/** e.g. "9 Jul 2026" — mirrors claw-auth's en-GB formatting. */
const formatDate = (iso: string): string => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' });
};

const formatNumber = (n: number): string => n.toLocaleString('en-US');

const formatFileSize = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const ownerLabel = (skill: Skill): string =>
  skill.owner?.name ?? skill.owner?.email ?? (skill.ownerUserId ? 'Unknown user' : 'Xyne (system)');

const isForbidden = (err: unknown): boolean => err instanceof ClawApiError && err.status === 403;

// A field that reads as plain text until hovered/focused — editable in place so
// there's no jarring swap between a read view and an edit view.
const seamlessField =
  'w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm text-foreground transition-colors placeholder:text-muted-foreground hover:bg-muted/40 focus:border-border focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring';

// The content editor is styled identically to its read-only <pre> so switching
// between viewers and editors produces no layout shift.
const codeField =
  'w-full resize-none overflow-auto rounded-xl border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed text-foreground transition-colors focus:border-ring focus:bg-background focus:outline-none focus:ring-1 focus:ring-ring';

const SectionLabel = ({ children }: { children: string }): ReactElement => (
  <span className='text-xs font-medium uppercase tracking-wide text-muted-foreground'>
    {children}
  </span>
);

const FieldLabel = ({ children }: { children: string }): ReactElement => (
  <span className='px-2 text-[11px] font-medium uppercase tracking-wide text-muted-foreground'>
    {children}
  </span>
);

const DetailRow = ({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}): ReactElement => (
  <div className='flex items-center justify-between gap-4 py-2 text-sm'>
    <span className='shrink-0 text-muted-foreground'>{label}</span>
    <span className='min-w-0 truncate text-right text-foreground'>{children}</span>
  </div>
);

/** Textarea that grows to fit its content (capped at `maxHeight`, then scrolls). */
const AutoTextarea = ({
  value,
  maxHeight,
  className,
  ...props
}: {
  value: string;
  maxHeight?: number;
} & Omit<React.ComponentProps<'textarea'>, 'value'>): ReactElement => {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${maxHeight ? Math.min(el.scrollHeight, maxHeight) : el.scrollHeight}px`;
  }, [value, maxHeight]);
  return (
    <textarea
      ref={ref}
      value={value}
      className={className}
      data-track-category='Claw Agents'
      data-track-name='Edit skill text field'
      {...props}
    />
  );
};

/** Save / Cancel row that only appears once a field is actually changed. */
const DirtyActions = ({
  saving,
  onSave,
  onCancel,
}: {
  saving: boolean;
  onSave: () => void;
  onCancel: () => void;
}): ReactElement => (
  <div className='flex gap-2'>
    <Button
      size='sm'
      loading={saving}
      onClick={onSave}
      data-track-category='Claw Agents'
      data-track-name='SAVE_SKILL'
    >
      Save
    </Button>
    <Button
      variant='ghost'
      size='sm'
      disabled={saving}
      onClick={onCancel}
      data-track-category='Claw Agents'
      data-track-name='CANCEL_SKILL_EDIT'
    >
      Cancel
    </Button>
  </div>
);

// Content tabs (top group). `manage` is appended after a divider for owners /
// admins only — mirroring the agent detail's config-tabs + Activity split.
const BASE_TABS = [
  { id: 'overview', label: 'Overview' },
  { id: 'system-prompt', label: 'System prompt' },
  { id: 'files', label: 'Files' },
] as const;
const MANAGE_TAB = { id: 'manage', label: 'Manage' } as const;

const TabButton = ({
  label,
  active,
  onClick,
  className,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
  className?: string;
}): ReactElement => (
  <button
    type='button'
    onClick={onClick}
    data-track-category='Claw Agents'
    data-track-name={`Open skill detail tab: ${label}`}
    className={cn(
      'rounded-md px-2 py-1.5 text-sm transition-colors',
      active
        ? 'bg-muted font-medium text-foreground'
        : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      className,
    )}
  >
    {label}
  </button>
);

const FilesSection = ({
  slug,
  canEdit,
  uploading,
  onPick,
}: {
  slug: string;
  canEdit: boolean;
  uploading: boolean;
  onPick: (files: FileList | null, inputEl: HTMLInputElement | null) => void;
}): ReactElement => {
  const { data: files, isLoading } = useClawSkillFiles(slug);
  const dirInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  return (
    <section className='flex flex-col gap-2'>
      <SectionLabel>Files</SectionLabel>
      <div className='rounded-xl border border-border bg-muted/30 px-4 py-1'>
        {isLoading ? (
          <div className='flex flex-col gap-2 py-2'>
            <Skeleton className='h-4 w-full' />
            <Skeleton className='h-4 w-2/3' />
          </div>
        ) : !files || files.length === 0 ? (
          <p className='py-2 text-sm italic text-muted-foreground'>No files uploaded</p>
        ) : (
          <ul className='divide-y divide-border'>
            {files.map(file => (
              <li key={file.id} className='flex items-center justify-between gap-4 py-2'>
                <span className='min-w-0 truncate font-mono text-xs text-foreground'>
                  {file.relativePath}
                </span>
                <span className='shrink-0 text-xs tabular-nums text-muted-foreground'>
                  {formatFileSize(file.sizeBytes)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      {canEdit && (
        <div className='flex flex-wrap items-center gap-2'>
          <input
            ref={dirInputRef}
            type='file'
            multiple
            className='hidden'
            {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
            onChange={e => onPick(e.target.files, dirInputRef.current)}
          />
          <input
            ref={fileInputRef}
            type='file'
            multiple
            className='hidden'
            onChange={e => onPick(e.target.files, fileInputRef.current)}
          />
          <Button
            variant='outline'
            size='sm'
            disabled={uploading}
            onClick={() => dirInputRef.current?.click()}
            data-track-category='Claw Agents'
            data-track-name='PICK_SKILL_DIRECTORY'
          >
            <FolderOpen className='size-3.5' />
            Upload folder
          </Button>
          <Button
            variant='outline'
            size='sm'
            disabled={uploading}
            onClick={() => fileInputRef.current?.click()}
            data-track-category='Claw Agents'
            data-track-name='PICK_SKILL_FILES'
          >
            <Upload className='size-3.5' />
            Upload files
          </Button>
          <p className='w-full text-xs text-muted-foreground'>
            All existing files will be replaced on upload
          </p>
        </div>
      )}
    </section>
  );
};

const ClawSkillDetailScreen = (): ReactElement => {
  const { skillSlug } = useParams<{ skillSlug: string }>();
  const { data: skills, isLoading } = useClawSkills();
  const skill = skills?.find(s => s.slug === skillSlug);

  const { user } = useAuth();
  const userId = user?.id;
  const { data: isAdmin = false } = useClawAdminStatus();
  const queryClient = useQueryClient();
  const navigate = useNavigate();

  const canEdit =
    !!skill &&
    !!userId &&
    (skill.ownerUserId === userId || (isAdmin && skill.scope === 'global')) &&
    skill.source !== 'seeded';
  const isSeeded = skill?.source === 'seeded';
  const canPublish = canEdit && skill.scope !== 'global';
  const canManage = canEdit || canPublish;

  // Active section lives in the URL (?tab=) so the view is shareable and
  // survives navigation, mirroring the agent detail screen. Manage is only a
  // valid target for owners/admins; fall back to Overview otherwise.
  const availableTabs = canManage ? [...BASE_TABS, MANAGE_TAB] : BASE_TABS;
  const [searchParams, setSearchParams] = useSearchParams();
  const rawTab = searchParams.get('tab');
  const activeTab = availableTabs.some(t => t.id === rawTab) ? rawTab! : BASE_TABS[0].id;
  const setActiveTab = (id: string): void => {
    const next = new URLSearchParams(searchParams);
    next.set('tab', id);
    setSearchParams(next, { replace: true });
  };

  // Draft edits use a null sentinel — null means "not edited, mirror the skill".
  // This keeps fields in sync with the live skill (no clobber on refetch) and
  // avoids a first-render flash of the dirty Save bar. Reset when the slug
  // changes (navigating to a different skill).
  const [draftName, setDraftName] = useState<string | null>(null);
  const [draftDescription, setDraftDescription] = useState<string | null>(null);
  const [draftContent, setDraftContent] = useState<string | null>(null);

  const [savingMeta, setSavingMeta] = useState(false);
  const [savingContent, setSavingContent] = useState(false);
  const [toggling, setToggling] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showDeleteDialog, setShowDeleteDialog] = useState(false);

  const mdInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftName(null);
    setDraftDescription(null);
    setDraftContent(null);
  }, [skill?.slug]);

  const nameValue = draftName ?? skill?.name ?? '';
  const descriptionValue = draftDescription ?? skill?.description ?? '';
  const contentValue = draftContent ?? skill?.content ?? '';

  const metaDirty =
    !!skill &&
    ((draftName !== null && draftName !== skill.name) ||
      (draftDescription !== null && draftDescription !== (skill.description ?? '')));
  const contentDirty = !!skill && draftContent !== null && draftContent !== (skill.content ?? '');

  const refreshSkills = (): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['claw-skills'] });
  const refreshFiles = (slug: string): Promise<void> =>
    queryClient.invalidateQueries({ queryKey: ['claw-skill-files', slug] });

  const handleToggleEnabled = async (value: boolean): Promise<void> => {
    if (!skill || !userId || toggling) return;
    setToggling(true);
    try {
      await updateSkill(skill.slug, { enabled: value }, userId);
      toast.success(value ? 'Skill enabled' : 'Skill disabled');
      await refreshSkills();
    } catch (err) {
      toast.error(
        isForbidden(err) ? 'Only the owner can modify this skill' : 'Failed to update skill',
      );
    } finally {
      setToggling(false);
    }
  };

  const handleSaveMeta = async (): Promise<void> => {
    if (!skill || !userId || savingMeta) return;
    setSavingMeta(true);
    try {
      await updateSkill(skill.slug, { name: nameValue, description: descriptionValue }, userId);
      setDraftName(null);
      setDraftDescription(null);
      toast.success('Skill updated');
      await refreshSkills();
    } catch (err) {
      toast.error(
        isForbidden(err) ? 'Only the owner can modify this skill' : 'Failed to update skill',
      );
    } finally {
      setSavingMeta(false);
    }
  };

  const handleSaveContent = async (): Promise<void> => {
    if (!skill || !userId || savingContent) return;
    setSavingContent(true);
    try {
      await updateSkill(skill.slug, { content: contentValue }, userId);
      setDraftContent(null);
      toast.success('Content saved');
      await refreshSkills();
    } catch (err) {
      toast.error(
        isForbidden(err) ? 'Only the owner can modify this skill' : 'Failed to update skill',
      );
    } finally {
      setSavingContent(false);
    }
  };

  // Load a .md file straight into the content draft (leaves it dirty to save).
  const handleMdUpload = async (
    fileList: FileList | null,
    inputEl: HTMLInputElement | null,
  ): Promise<void> => {
    try {
      const file = fileList?.[0];
      if (!file) return;
      const text = await file.text();
      setDraftContent(text);
      toast.success(`Loaded ${file.name} — review and Save`);
    } catch {
      toast.error('Failed to read markdown file');
    } finally {
      if (inputEl) inputEl.value = '';
    }
  };

  const handleFilePick = async (
    fileList: FileList | null,
    inputEl: HTMLInputElement | null,
  ): Promise<void> => {
    if (!skill || !userId || !fileList || fileList.length === 0) return;
    setUploading(true);
    try {
      const pending = await readSkillFilesFromFileList(fileList);
      await replaceSkillFiles(
        skill.slug,
        pending.map(({ relativePath, content, contentType }) => ({
          relativePath,
          content,
          ...(contentType ? { contentType } : {}),
        })),
        userId,
      );
      toast.success('Files uploaded');
      await refreshFiles(skill.slug);
    } catch (err) {
      toast.error(
        isForbidden(err) ? 'Only the owner can modify this skill' : 'Failed to upload files',
      );
    } finally {
      setUploading(false);
      if (inputEl) inputEl.value = '';
    }
  };

  const handlePublish = async (): Promise<void> => {
    if (!skill || !userId || publishing) return;
    setPublishing(true);
    try {
      await submitSkillRequest(skill.slug, userId);
      toast.success('Publish request submitted', {
        description: 'An admin will review and approve before this skill becomes global.',
      });
    } catch (err) {
      toast.error(
        isForbidden(err)
          ? "You don't have permission to publish this skill"
          : 'Failed to submit publish request',
      );
    } finally {
      setPublishing(false);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!skill || !userId || deleting) return;
    setDeleting(true);
    try {
      await deleteSkill(skill.slug, userId);
      toast.success('Skill deleted');
      setShowDeleteDialog(false);
      await refreshSkills();
      void navigate('/claw-agents/skills');
    } catch (err) {
      toast.error(
        isForbidden(err) ? 'Only the owner can modify this skill' : 'Failed to delete skill',
      );
      setDeleting(false);
    }
  };

  const title =
    isLoading && !skill ? 'Loading…' : skill ? skill.name || skill.slug : 'Skill not found';

  return (
    <div className='mx-auto w-full max-w-7xl px-6 pt-4 pb-16'>
      <div className='flex gap-8'>
        {/* Left: back button + section tabs — the filter slot from the list screen. */}
        <div className='sticky top-0 hidden w-44 shrink-0 flex-col self-start md:flex'>
          <div className='flex items-center pt-4 pb-4'>
            <Link
              to='/claw-agents/skills'
              className='inline-flex items-center gap-1 text-sm leading-7 text-muted-foreground transition-colors hover:text-foreground'
            >
              <ChevronLeft className='size-4' />
              Back
            </Link>
          </div>
          {skill && (
            <nav className='flex flex-col gap-1 pt-6'>
              {BASE_TABS.map(tab => (
                <TabButton
                  key={tab.id}
                  label={tab.label}
                  active={activeTab === tab.id}
                  onClick={() => setActiveTab(tab.id)}
                  className='w-full text-left'
                />
              ))}
              {canManage && (
                <>
                  <div className='my-2 border-t border-border' />
                  <TabButton
                    label={MANAGE_TAB.label}
                    active={activeTab === MANAGE_TAB.id}
                    onClick={() => setActiveTab(MANAGE_TAB.id)}
                    className='w-full text-left'
                  />
                </>
              )}
            </nav>
          )}
        </div>

        {/* Right: skill header + active section. */}
        <div className='flex min-w-0 flex-1 flex-col'>
          <header className='sticky top-0 z-10 flex items-center gap-3 border-b border-border bg-background pt-4 pb-4'>
            <Link
              to='/claw-agents/skills'
              aria-label='Back to skills'
              className='text-muted-foreground transition-colors hover:text-foreground md:hidden'
            >
              <ChevronLeft className='size-5' />
            </Link>
            <div className='flex min-w-0 flex-1 flex-col'>
              <h1 className='truncate text-lg font-semibold leading-7 text-foreground'>{title}</h1>
              {skill && (
                <span className='truncate text-xs text-muted-foreground'>
                  <span className='font-mono'>{skill.slug}</span> · {sourceLabel(skill.source)} ·{' '}
                  {scopeLabel(skill.scope)}
                </span>
              )}
            </div>
            {skill &&
              (canEdit ? (
                <div className='flex shrink-0 items-center gap-2'>
                  <span className='text-xs font-medium text-muted-foreground'>
                    {skill.enabled ? 'Enabled' : 'Disabled'}
                  </span>
                  <Switch
                    checked={skill.enabled}
                    onCheckedChange={value => void handleToggleEnabled(value)}
                    disabled={toggling}
                    aria-label={skill.enabled ? 'Disable skill' : 'Enable skill'}
                  />
                </div>
              ) : isSeeded ? (
                <span className='inline-flex shrink-0 items-center gap-1 rounded-full border border-border bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground'>
                  <Lock className='size-3' />
                  Read-only
                </span>
              ) : null)}
          </header>

          {skill ? (
            <div className='flex flex-col pt-6'>
              {/* Mobile section tabs — the sidebar nav is hidden on small screens. */}
              <div className='no-scrollbar mb-4 flex gap-1 overflow-x-auto border-b border-border pb-2 md:hidden'>
                {availableTabs.map(tab => (
                  <TabButton
                    key={tab.id}
                    label={tab.label}
                    active={activeTab === tab.id}
                    onClick={() => setActiveTab(tab.id)}
                    className='shrink-0 whitespace-nowrap'
                  />
                ))}
              </div>

              {activeTab === 'overview' && (
                <div className='flex flex-col gap-6'>
                  {/* Status */}
                  <div className='flex items-center gap-3 rounded-xl border border-border bg-muted/30 px-4 py-3'>
                    <span
                      className={cn(
                        'size-2 shrink-0 rounded-full',
                        skill.enabled ? 'bg-emerald-500' : 'bg-amber-500',
                      )}
                    />
                    <div className='flex flex-col'>
                      <span className='text-sm font-semibold text-foreground'>
                        {skill.enabled ? 'Enabled' : 'Disabled'}
                      </span>
                      <span className='text-xs text-muted-foreground'>
                        {skill.enabled
                          ? 'Active and available to agents'
                          : "Agents can't use this skill until re-enabled"}
                      </span>
                    </div>
                  </div>

                  {/* Description (+ name) — edited in place. */}
                  <section className='flex flex-col gap-2'>
                    <SectionLabel>Description</SectionLabel>
                    {canEdit ? (
                      <div className='flex flex-col gap-2 rounded-xl border border-border bg-muted/30 p-2'>
                        <div className='flex flex-col gap-0.5'>
                          <FieldLabel>Name</FieldLabel>
                          <input
                            value={nameValue}
                            onChange={e => setDraftName(e.target.value)}
                            data-track-category='Claw Agents'
                            data-track-name='Edit skill name'
                            placeholder='Skill name'
                            aria-label='Skill name'
                            className={cn(seamlessField, 'font-medium')}
                          />
                        </div>
                        <div className='flex flex-col gap-0.5'>
                          <FieldLabel>Description</FieldLabel>
                          <AutoTextarea
                            value={descriptionValue}
                            onChange={e => setDraftDescription(e.target.value)}
                            placeholder='What this skill does and when agents should use it…'
                            aria-label='Skill description'
                            className={cn(seamlessField, 'resize-none leading-relaxed')}
                          />
                        </div>
                        {metaDirty && (
                          <div className='px-2 pb-1'>
                            <DirtyActions
                              saving={savingMeta}
                              onSave={() => void handleSaveMeta()}
                              onCancel={() => {
                                setDraftName(null);
                                setDraftDescription(null);
                              }}
                            />
                          </div>
                        )}
                      </div>
                    ) : skill.description ? (
                      <p className='text-sm leading-relaxed text-muted-foreground'>
                        {skill.description}
                      </p>
                    ) : (
                      <p className='text-sm italic text-muted-foreground'>No description added</p>
                    )}
                  </section>

                  {/* Details */}
                  <section className='flex flex-col gap-2'>
                    <SectionLabel>Details</SectionLabel>
                    <div className='divide-y divide-border rounded-xl border border-border bg-muted/30 px-4'>
                      <DetailRow label='Owner'>{ownerLabel(skill)}</DetailRow>
                      {skill.owner?.email && skill.owner?.name && (
                        <DetailRow label='Contact'>
                          <a
                            href={`mailto:${skill.owner.email}`}
                            className='text-[color:var(--mention-color)] hover:underline'
                          >
                            {skill.owner.email}
                          </a>
                        </DetailRow>
                      )}
                      <DetailRow label='Created'>{formatDate(skill.createdAt)}</DetailRow>
                      <DetailRow label='Size'>
                        {formatNumber(contentValue.length)} characters
                      </DetailRow>
                    </div>
                  </section>
                </div>
              )}

              {activeTab === 'system-prompt' && (
                <section className='flex flex-col gap-2'>
                  <div className='flex items-center justify-between'>
                    <SectionLabel>System prompt</SectionLabel>
                    <div className='flex items-center gap-3'>
                      <span className='text-xs tabular-nums text-muted-foreground'>
                        {formatNumber(contentValue.length)} chars
                      </span>
                      {canEdit && (
                        <Button
                          variant='ghost'
                          size='sm'
                          onClick={() => mdInputRef.current?.click()}
                          data-track-category='Claw Agents'
                          data-track-name='PICK_SKILL_MARKDOWN'
                        >
                          <Upload className='size-3.5' />
                          Upload .md
                        </Button>
                      )}
                    </div>
                  </div>
                  <input
                    ref={mdInputRef}
                    type='file'
                    accept='.md,.markdown,.txt,text/markdown,text/plain'
                    className='hidden'
                    onChange={e => void handleMdUpload(e.target.files, mdInputRef.current)}
                  />
                  {canEdit ? (
                    <>
                      <AutoTextarea
                        value={contentValue}
                        maxHeight={520}
                        onChange={e => setDraftContent(e.target.value)}
                        placeholder='Markdown playbook the agent consults while working…'
                        className={cn(codeField, 'min-h-[200px]')}
                      />
                      {contentDirty && (
                        <DirtyActions
                          saving={savingContent}
                          onSave={() => void handleSaveContent()}
                          onCancel={() => setDraftContent(null)}
                        />
                      )}
                    </>
                  ) : skill.content ? (
                    <pre className='max-h-[520px] overflow-auto rounded-xl border border-border bg-muted/30 p-4 font-mono text-xs leading-relaxed whitespace-pre-wrap text-foreground'>
                      {skill.content}
                    </pre>
                  ) : (
                    <p className='text-sm italic text-muted-foreground'>
                      No content — this skill has no system prompt yet
                    </p>
                  )}
                </section>
              )}

              {activeTab === 'files' && (
                <FilesSection
                  slug={skill.slug}
                  canEdit={canEdit}
                  uploading={uploading}
                  onPick={(files, inputEl) => void handleFilePick(files, inputEl)}
                />
              )}

              {activeTab === 'manage' && canManage && (
                <div className='flex flex-col gap-6'>
                  {canPublish && (
                    <section className='flex flex-col gap-2'>
                      <SectionLabel>Publish</SectionLabel>
                      <div className='flex items-center justify-between gap-4 rounded-xl border border-border bg-muted/30 px-4 py-3'>
                        <p className='text-sm text-muted-foreground'>
                          Request that this skill be promoted to a global skill available across the
                          workspace.
                        </p>
                        <Button
                          variant='outline'
                          size='sm'
                          loading={publishing}
                          onClick={() => void handlePublish()}
                          data-track-category='Claw Agents'
                          data-track-name='PUBLISH_SKILL'
                        >
                          <Globe className='size-3.5' />
                          Publish
                        </Button>
                      </div>
                    </section>
                  )}
                  {canEdit && (
                    <section className='flex flex-col gap-2'>
                      <SectionLabel>Danger zone</SectionLabel>
                      <div className='flex items-center justify-between gap-4 rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3'>
                        <p className='text-sm text-muted-foreground'>
                          Delete this skill permanently. Agents using it will lose access.
                        </p>
                        <Button
                          variant='destructive'
                          size='sm'
                          onClick={() => setShowDeleteDialog(true)}
                          data-track-category='Claw Agents'
                          data-track-name='OPEN_DELETE_SKILL_CONFIRM'
                        >
                          <Trash2 className='size-3.5' />
                          Delete
                        </Button>
                      </div>
                    </section>
                  )}
                </div>
              )}
            </div>
          ) : (
            !isLoading && (
              <div className='pt-16 text-center'>
                <p className='text-sm text-muted-foreground'>
                  This skill doesn&apos;t exist or you no longer have access to it.
                </p>
                <Link
                  to='/claw-agents/skills'
                  className='mt-3 inline-block text-sm font-medium text-[color:var(--mention-color)] underline underline-offset-2'
                >
                  Back to skills
                </Link>
              </div>
            )
          )}
        </div>
      </div>

      <ConfirmDialog
        open={showDeleteDialog}
        onOpenChange={setShowDeleteDialog}
        title='Delete skill'
        description={
          skill
            ? `Delete "${skill.name || skill.slug}"? This cannot be undone. Agents using this skill will lose access to it.`
            : undefined
        }
        danger
        confirmLabel='Delete'
        loading={deleting}
        onConfirm={() => void handleDelete()}
      />
    </div>
  );
};

export default ClawSkillDetailScreen;
