import { useEffect, useMemo, useState, type ReactElement } from 'react';
import {
  AlignLeft,
  ArrowRightFromLine,
  Database,
  FileCheck2,
  Globe2,
  GripVertical,
  Hash,
  LoaderCircle,
  Mail,
  MoreHorizontal,
  Plus,
  Search,
  Share2,
  Sparkles,
  Trash2,
  Users,
  X,
} from 'lucide-react';
import { toast } from 'sonner';
import { DefaultOutlet } from '@xyne/shared';
import { Button } from '../../../components/ui/Button/Button';
import { Dialog } from '../../../components/ui/Dialog';
import { useHasResourceAccess } from '../../../hooks/usePermissions';
import { useUser } from '../../../hooks/useUsers';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '../../../components/ui/dropdown-menu';
import {
  recordingService,
  type SummaryTemplate,
  type SummaryTemplateInput,
  type SummaryTemplateSection,
} from '../../../services/Recording/recordingService';
import { cn } from '../../../utils/classNames';
import { getApiErrorMessage } from '../../../utils/apiError';
import { getUserDisplayName } from '../../../utils/userDisplayName';
import { SummaryTemplateShareModal } from './SummaryTemplateShareModal';

type TemplateGroup = 'PENDING_REVIEW' | 'MY_TEMPLATES' | 'SHARED_WITH_ME' | 'PUBLIC' | 'STARTER';

interface SummaryTemplatesModalProps {
  templates: SummaryTemplate[];
  loading: boolean;
  selectedTemplateId?: string | null;
  currentUserId: string;
  currentUserName: string;
  startWithNewTemplate?: boolean;
  onClose: () => void;
  onApply?: (template: SummaryTemplate) => Promise<void> | void;
}

interface TemplateDraft extends SummaryTemplateInput {
  id: string | null;
  createdBy: string;
  visibility: SummaryTemplate['visibility'];
  canEdit: boolean;
  isSystem: boolean;
}

const getTemplateIcon = (name: string): string => (name === 'Default summary' ? '⚡' : '#');

const EMPTY_SECTION = (): SummaryTemplateSection => ({
  id: crypto.randomUUID(),
  title: 'New section',
  description: 'Describe what this section should capture.',
});

const NEW_TEMPLATE = (currentUserId: string): TemplateDraft => ({
  id: null,
  name: 'Untitled template',
  autoTriggerPrompt: '',
  sections: [EMPTY_SECTION()],
  systemPrompt: '',
  version: 1,
  defaultOutlet: DefaultOutlet.EMAIL,
  createdBy: currentUserId,
  visibility: 'PRIVATE',
  canEdit: true,
  isSystem: false,
});

function toDraft(template: SummaryTemplate): TemplateDraft {
  return {
    id: template.id,
    name: template.name,
    autoTriggerPrompt: template.autoTriggerPrompt,
    sections: Array.isArray(template.sections) ? template.sections : [],
    systemPrompt: template.systemPrompt,
    version: template.version,
    defaultOutlet: template.defaultOutlet,
    createdBy: template.createdBy,
    visibility: template.visibility,
    canEdit: template.canEdit,
    isSystem: template.isSystem,
  };
}

function getTemplateGroup(template: SummaryTemplate, currentUserId: string): TemplateGroup {
  if (template.isSystem) return 'STARTER';
  if (template.visibility === 'WAITING_FOR_APPROVAL') return 'PENDING_REVIEW';
  if (template.visibility === 'PUBLIC') return 'PUBLIC';
  if (template.createdBy === currentUserId) return 'MY_TEMPLATES';
  return 'SHARED_WITH_ME';
}

const GROUP_LABELS: Record<TemplateGroup, string> = {
  PENDING_REVIEW: 'Waiting for approval',
  MY_TEMPLATES: 'My templates',
  SHARED_WITH_ME: 'Shared with me',
  PUBLIC: 'Public templates',
  STARTER: 'Starter',
};

const GROUP_ORDER: TemplateGroup[] = [
  'MY_TEMPLATES',
  'PENDING_REVIEW',
  'SHARED_WITH_ME',
  'PUBLIC',
  'STARTER',
];

export function SummaryTemplatesModal({
  templates,
  loading,
  selectedTemplateId,
  currentUserId,
  currentUserName,
  startWithNewTemplate = false,
  onClose,
  onApply,
}: SummaryTemplatesModalProps): ReactElement {
  const isScribeAdmin = useHasResourceAccess('SCRIBE');
  const [search, setSearch] = useState('');
  const [draft, setDraft] = useState<TemplateDraft | null>(null);
  const [originalDraft, setOriginalDraft] = useState<TemplateDraft | null>(null);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(startWithNewTemplate);
  const [saving, setSaving] = useState(false);
  const [publicationAction, setPublicationAction] = useState<'approve' | 'deny' | null>(null);
  const [aiAction, setAiAction] = useState<'context' | 'sections' | 'systemPrompt' | null>(null);
  const [shareTemplate, setShareTemplate] = useState<SummaryTemplate | null>(null);
  const draftCreator = useUser(draft?.createdBy ?? '');

  useEffect(() => {
    if (draft) return;
    if (startWithNewTemplate) {
      setDraft(NEW_TEMPLATE(currentUserId));
      setOriginalDraft(null);
      setIsCreatingTemplate(true);
      return;
    }
    if (templates.length === 0) return;
    const initial = templates.find(template => template.id === selectedTemplateId) ?? templates[0];
    if (!initial) return;
    const next = toDraft(initial);
    setDraft(next);
    setOriginalDraft(next);
  }, [currentUserId, draft, selectedTemplateId, startWithNewTemplate, templates]);

  const filteredTemplates = useMemo(() => {
    const query = search.trim().toLowerCase();
    return query
      ? templates.filter(template => template.name.toLowerCase().includes(query))
      : templates;
  }, [search, templates]);

  const groupedTemplates = useMemo(
    () =>
      GROUP_ORDER.map(group => ({
        group,
        templates: filteredTemplates.filter(
          template => getTemplateGroup(template, currentUserId) === group,
        ),
      })).filter(entry => entry.templates.length > 0),
    [currentUserId, filteredTemplates],
  );

  const isDirty = useMemo(
    () => JSON.stringify(draft) !== JSON.stringify(originalDraft),
    [draft, originalDraft],
  );
  const draftRequirements = useMemo(() => {
    const hasTitle = Boolean(draft?.name.trim());
    const hasMeetingContext = Boolean(draft?.autoTriggerPrompt?.trim());
    const hasSections = Boolean(
      draft?.sections.length &&
      draft.sections.every(section => section.title.trim() && section.description.trim()),
    );
    const hasSystemPrompt = Boolean(draft?.systemPrompt.trim());
    const missing = [
      !hasTitle && 'template title',
      !hasMeetingContext && 'meeting context',
      !hasSections && 'complete sections',
      !hasSystemPrompt && 'system prompt',
    ].filter((field): field is string => Boolean(field));

    return {
      hasTitle,
      hasMeetingContext,
      hasSections,
      isComplete: missing.length === 0,
      missing,
    };
  }, [draft]);
  const existingDraft = draft?.id
    ? templates.find(template => template.id === draft.id)
    : undefined;
  const willSaveDraft = Boolean(draft?.canEdit && (isDirty || !existingDraft));

  const selectTemplate = (template: SummaryTemplate): void => {
    const next = toDraft(template);
    setDraft(next);
    setOriginalDraft(next);
    setIsCreatingTemplate(false);
  };

  const updateSection = (
    sectionId: string,
    update: Partial<Pick<SummaryTemplateSection, 'title' | 'description'>>,
  ): void => {
    setDraft(current =>
      current
        ? {
            ...current,
            sections: current.sections.map(section =>
              section.id === sectionId ? { ...section, ...update } : section,
            ),
          }
        : current,
    );
  };

  const saveDraft = async (): Promise<SummaryTemplate | null> => {
    if (!draft) return null;
    if (!draftRequirements.isComplete) {
      toast.error('Complete the template before saving', {
        description: `Missing: ${draftRequirements.missing.join(', ')}.`,
      });
      return null;
    }

    const input: SummaryTemplateInput = {
      name: draft.name.trim(),
      autoTriggerPrompt: draft.autoTriggerPrompt?.trim() || null,
      sections: draft.sections.map(section => ({
        ...section,
        title: section.title.trim(),
        description: section.description.trim(),
      })),
      systemPrompt: draft.systemPrompt.trim(),
      version: draft.version,
      defaultOutlet: draft.defaultOutlet,
    };

    const saved = draft.id
      ? await recordingService.updateSummaryTemplate(draft.id, input)
      : await recordingService.createSummaryTemplate(input);
    const nextDraft = toDraft(saved);
    setDraft(nextDraft);
    setOriginalDraft(nextDraft);
    return saved;
  };

  const handleApply = async (): Promise<void> => {
    if (!draft || saving) return;
    setSaving(true);
    try {
      const template = willSaveDraft ? await saveDraft() : existingDraft;
      if (!template) return;
      const applyResult = isCreatingTemplate ? undefined : onApply?.(template);
      if (isCreatingTemplate) toast.success(`${template.name} created`);
      else if (!onApply && isDirty) toast.success(`${template.name} updated`);
      onClose();
      // Creating only adds the template to the library and keeps the recording's
      // previously used template active. Applying an existing template is the
      // explicit selection action owned by the recording screen.
      void Promise.resolve(applyResult).catch(error => {
        toast.error('Unable to apply template', {
          description: getApiErrorMessage(error, 'Please try again.'),
        });
      });
    } catch (error) {
      toast.error('Unable to save template', {
        description: getApiErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleOpenShare = async (): Promise<void> => {
    if (!draft?.id || saving || (draft.canEdit && isDirty && !draftRequirements.isComplete)) return;
    const canReview = isScribeAdmin && draft.visibility === 'WAITING_FOR_APPROVAL';
    if (!draft.canEdit && !canReview) return;
    setSaving(true);
    try {
      const template = draft.canEdit && isDirty ? await saveDraft() : existingDraft;
      if (template) setShareTemplate(template);
    } catch (error) {
      toast.error('Unable to save template before sharing', {
        description: getApiErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handlePublicationChange = (updated: SummaryTemplate): void => {
    const isPrivateForAnotherUser =
      updated.visibility === 'PRIVATE' && updated.createdBy !== currentUserId;
    const nextTemplates = isPrivateForAnotherUser
      ? templates.filter(template => template.id !== updated.id)
      : templates;
    if (isPrivateForAnotherUser && draft?.id === updated.id) {
      const next = nextTemplates[0] ? toDraft(nextTemplates[0]) : NEW_TEMPLATE(currentUserId);
      setDraft(next);
      setOriginalDraft(next.id ? next : null);
      setIsCreatingTemplate(!next.id);
    } else if (draft?.id === updated.id) {
      const next = toDraft(updated);
      setDraft(next);
      setOriginalDraft(next);
    }
    if (updated.createdBy !== currentUserId && updated.visibility !== 'WAITING_FOR_APPROVAL') {
      setShareTemplate(null);
    } else {
      setShareTemplate(updated);
    }
  };

  const handleAdminPublicationReview = async (action: 'approve' | 'deny'): Promise<void> => {
    if (!draft?.id || publicationAction) return;
    setPublicationAction(action);
    try {
      const updated = await recordingService.manageSummaryTemplatePublication(draft.id, action);
      handlePublicationChange(updated);
      toast.success(action === 'approve' ? 'Template published' : 'Publication request declined');
    } catch (error) {
      toast.error('Unable to review publication request', {
        description: getApiErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setPublicationAction(null);
    }
  };

  const handleDelete = async (): Promise<void> => {
    if (!draft?.id || !draft.canEdit || saving) return;
    setSaving(true);
    try {
      await recordingService.deleteSummaryTemplate(draft.id);
      const remaining = templates.filter(template => template.id !== draft.id);
      const next = remaining[0] ? toDraft(remaining[0]) : NEW_TEMPLATE(currentUserId);
      setDraft(next);
      setOriginalDraft(next.id ? next : null);
      setIsCreatingTemplate(!next.id);
      toast.success('Template deleted');
    } catch (error) {
      toast.error('Unable to delete template', {
        description: getApiErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setSaving(false);
    }
  };

  const handleDraftContext = async (): Promise<void> => {
    if (!draft || !isEditable || aiAction) return;
    setAiAction('context');
    try {
      const context = await recordingService.draftSummaryTemplateContext({
        name: draft.name.trim() || 'Untitled template',
        meetingContext: draft.autoTriggerPrompt,
        sections: draft.sections.map(({ title, description }) => ({ title, description })),
      });
      setDraft(current => (current ? { ...current, autoTriggerPrompt: context } : current));
    } catch (error) {
      toast.error('Unable to draft meeting context', {
        description: getApiErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setAiAction(null);
    }
  };

  const handleSuggestSections = async (): Promise<void> => {
    if (!draft || !isEditable || aiAction) return;
    setAiAction('sections');
    try {
      const sections = await recordingService.suggestSummaryTemplateSections({
        name: draft.name.trim() || 'Untitled template',
        meetingContext: draft.autoTriggerPrompt,
        sections: draft.sections.map(({ title, description }) => ({ title, description })),
      });
      setDraft(current => (current ? { ...current, sections } : current));
    } catch (error) {
      toast.error('Unable to suggest sections', {
        description: getApiErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setAiAction(null);
    }
  };

  const handleGenerateSystemPrompt = async (): Promise<void> => {
    if (!draft || !isEditable || aiAction) return;
    setAiAction('systemPrompt');
    try {
      const systemPrompt = await recordingService.generateSummaryTemplateSystemPrompt({
        name: draft.name.trim() || 'Untitled template',
        meetingContext: draft.autoTriggerPrompt,
        sections: draft.sections.map(({ title, description }) => ({ title, description })),
      });
      setDraft(current => (current ? { ...current, systemPrompt } : current));
    } catch (error) {
      toast.error('Unable to generate system prompt', {
        description: getApiErrorMessage(error, 'Please try again.'),
      });
    } finally {
      setAiAction(null);
    }
  };

  const isEditable = draft?.canEdit ?? false;
  const templateIcon = draft ? getTemplateIcon(draft.name) : '#';
  const creatorName = draft?.isSystem
    ? 'Xyne'
    : draft?.createdBy === currentUserId
      ? currentUserName
      : draftCreator
        ? getUserDisplayName(draftCreator)
        : 'Template creator';
  const creatorLabel = draft?.isSystem
    ? 'Xyne'
    : draft?.createdBy === currentUserId
      ? `${currentUserName} (me)`
      : creatorName;
  const isAdminPublicationReview = isScribeAdmin && draft?.visibility === 'WAITING_FOR_APPROVAL';

  return (
    <div className='flex h-full min-h-0 flex-col bg-background text-foreground'>
      <header className='flex h-16 shrink-0 items-center justify-between border-b border-border px-6'>
        <h2 className='text-xl font-semibold'>Templates</h2>
        <button
          type='button'
          onClick={onClose}
          className='rounded-lg p-2 text-muted-foreground hover:bg-muted hover:text-foreground'
          aria-label='Close templates'
          data-track-category='SummaryTemplates'
          data-track-name='Close'
        >
          <X className='size-5' />
        </button>
      </header>

      <div className='flex min-h-0 flex-1'>
        <aside className='flex w-[310px] shrink-0 flex-col border-r border-border bg-muted/20 p-4'>
          <button
            type='button'
            onClick={() => {
              const next = NEW_TEMPLATE(currentUserId);
              setDraft(next);
              setOriginalDraft(null);
              setIsCreatingTemplate(true);
            }}
            className='flex h-11 items-center gap-3 rounded-xl border border-border bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted'
            data-track-category='SummaryTemplates'
            data-track-name='NewTemplate'
          >
            <Plus className='size-4' />
            New template
          </button>

          <label className='mt-3 flex h-11 items-center gap-3 rounded-xl border border-border bg-background px-4 text-sm shadow-sm focus-within:ring-2 focus-within:ring-ring'>
            <Search className='size-4 text-muted-foreground' />
            <input
              value={search}
              onChange={event => setSearch(event.target.value)}
              placeholder='Search templates...'
              className='min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground'
              data-track-category='SummaryTemplates'
              data-track-name='Search'
            />
          </label>

          <div className='thin-scrollbar mt-5 min-h-0 flex-1 space-y-5 overflow-y-auto pr-1'>
            {loading ? (
              <p className='px-2 text-sm text-muted-foreground'>Loading templates…</p>
            ) : (
              groupedTemplates.map(({ group, templates: groupTemplates }) => (
                <section key={group}>
                  <h3 className='mb-2 px-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                    {GROUP_LABELS[group]}
                  </h3>
                  <div className='space-y-1'>
                    {groupTemplates.map(template => {
                      const active = draft?.id === template.id;
                      return (
                        <button
                          key={template.id}
                          type='button'
                          onClick={() => selectTemplate(template)}
                          className={cn(
                            'flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition-colors hover:bg-muted',
                            active && 'bg-muted',
                          )}
                          data-track-category='SummaryTemplates'
                          data-track-name='SelectTemplate'
                        >
                          <span className='flex size-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-base shadow-sm'>
                            {getTemplateIcon(template.name)}
                          </span>
                          <span className='min-w-0'>
                            <span className='block truncate text-sm font-medium'>
                              {template.name}
                            </span>
                            <span className='block text-xs text-muted-foreground'>
                              {template.visibility === 'WAITING_FOR_APPROVAL'
                                ? 'Waiting for approval'
                                : template.isSystem
                                  ? 'Xyne'
                                  : template.createdBy === currentUserId
                                    ? 'Me'
                                    : template.visibility === 'PUBLIC'
                                      ? 'Public template'
                                      : 'Shared with me'}
                            </span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </aside>

        <main className='thin-scrollbar min-w-0 flex-1 overflow-y-auto'>
          {draft ? (
            <div className='mx-auto max-w-[920px] px-8 py-8'>
              {isAdminPublicationReview && (
                <div className='mb-7 flex flex-col gap-4 rounded-2xl border border-amber-300 bg-amber-50/70 p-5 dark:border-amber-700 dark:bg-amber-950/20 sm:flex-row sm:items-center'>
                  <span className='flex size-11 shrink-0 items-center justify-center rounded-xl border border-amber-300 bg-background text-amber-700 dark:border-amber-700 dark:text-amber-300'>
                    <Globe2 className='size-5' />
                  </span>
                  <div className='min-w-0 flex-1'>
                    <p className='text-lg font-semibold'>
                      {creatorName} wants to make this template public
                    </p>
                    <p className='mt-0.5 text-sm text-muted-foreground'>
                      Approving publishes it for everyone in this workspace. Review it first —
                      you&apos;re a Scribe admin.
                    </p>
                  </div>
                  <div className='flex shrink-0 items-center gap-2 self-end sm:self-auto'>
                    <Button
                      type='button'
                      variant='outline'
                      disabled={publicationAction !== null}
                      loading={publicationAction === 'deny'}
                      onClick={() => void handleAdminPublicationReview('deny')}
                      data-track-category='SummaryTemplates'
                      data-track-name='DeclineTemplatePublication'
                    >
                      Decline
                    </Button>
                    <Button
                      type='button'
                      disabled={publicationAction !== null}
                      loading={publicationAction === 'approve'}
                      onClick={() => void handleAdminPublicationReview('approve')}
                      className='bg-foreground text-background hover:bg-foreground/90'
                      data-track-category='SummaryTemplates'
                      data-track-name='MakeTemplatePublic'
                    >
                      Make public
                    </Button>
                  </div>
                </div>
              )}

              <div className='flex items-start justify-between gap-4 border-b border-border pb-7'>
                <div className='flex min-w-0 items-start gap-4'>
                  <span className='flex size-12 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/30 text-xl'>
                    {templateIcon}
                  </span>
                  <div className='min-w-0'>
                    <input
                      value={draft.name}
                      onChange={event =>
                        setDraft(current =>
                          current ? { ...current, name: event.target.value } : current,
                        )
                      }
                      readOnly={!isEditable}
                      maxLength={120}
                      aria-label='Template name'
                      className='w-full bg-transparent text-3xl font-semibold leading-tight outline-none read-only:cursor-default'
                      data-track-category='SummaryTemplates'
                      data-track-name='EditName'
                    />
                    <div className='mt-2 flex flex-wrap items-center gap-3 text-sm text-muted-foreground'>
                      <span className='flex size-7 items-center justify-center rounded-full bg-foreground text-[10px] font-semibold text-background'>
                        {draft.isSystem
                          ? 'XY'
                          : creatorName
                              .split(/\s+/)
                              .map(part => part[0])
                              .join('')
                              .slice(0, 2)
                              .toUpperCase()}
                      </span>
                      <span>{creatorLabel}</span>
                      {draft.visibility !== 'PRIVATE' && (
                        <span className='inline-flex h-8 items-center gap-2 rounded-lg border border-border px-3 text-sm text-foreground'>
                          <Users className='size-3.5' />
                          {draft.visibility === 'PUBLIC' ? 'Public' : 'Pending admin review'}
                        </span>
                      )}
                      {draft.id &&
                        !isAdminPublicationReview &&
                        (draft.canEdit ||
                          (isScribeAdmin && draft.visibility === 'WAITING_FOR_APPROVAL')) && (
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            disabled={
                              saving || (draft.canEdit && isDirty && !draftRequirements.isComplete)
                            }
                            onClick={() => void handleOpenShare()}
                            className='h-8 gap-2'
                            data-track-category='SummaryTemplates'
                            data-track-name='OpenShareTemplate'
                          >
                            <Share2 className='size-3.5' />
                            {draft.canEdit ? 'Share' : 'Review'}
                          </Button>
                        )}
                    </div>
                  </div>
                </div>

                {draft.id && draft.canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type='button'
                        className='rounded-xl border border-border p-2.5 text-muted-foreground hover:bg-muted hover:text-foreground'
                        aria-label='Template actions'
                        data-track-category='SummaryTemplates'
                        data-track-name='OpenActions'
                      >
                        <MoreHorizontal className='size-5' />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem
                        onClick={() => void handleDelete()}
                        className='gap-2 text-destructive focus:text-destructive'
                      >
                        <Trash2 className='size-4' /> Delete template
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              <section className='border-b border-border py-7'>
                <div className='mb-4 flex items-center justify-between gap-4'>
                  <div className='flex items-center gap-3'>
                    <span className='flex size-9 items-center justify-center rounded-lg border border-border bg-muted/30'>
                      <AlignLeft className='size-4 text-muted-foreground' />
                    </span>
                    <div>
                      <h3 className='font-semibold'>Meeting Context</h3>
                      <p className='text-sm text-muted-foreground'>
                        What the meeting is about and what you want out of it.
                      </p>
                    </div>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={!isEditable || aiAction !== null || !draftRequirements.hasTitle}
                    onClick={() => void handleDraftContext()}
                    className='gap-2'
                    data-track-category='SummaryTemplates'
                    data-track-name='DraftContextWithAI'
                  >
                    {aiAction === 'context' ? (
                      <LoaderCircle className='size-3.5 animate-spin' />
                    ) : (
                      <Sparkles className='size-3.5' />
                    )}
                    {aiAction === 'context' ? 'Drafting…' : 'Draft with AI'}
                  </Button>
                </div>
                <textarea
                  value={draft.autoTriggerPrompt ?? ''}
                  onChange={event =>
                    setDraft(current =>
                      current ? { ...current, autoTriggerPrompt: event.target.value } : current,
                    )
                  }
                  readOnly={!isEditable}
                  maxLength={500}
                  rows={4}
                  placeholder='Describe the meeting and the summary you want…'
                  className='w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/20'
                  data-track-category='SummaryTemplates'
                  data-track-name='EditContext'
                />
              </section>

              <section className='border-b border-border py-7'>
                <div className='mb-4 flex items-center justify-between gap-4'>
                  <div className='flex items-center gap-3'>
                    <span className='flex size-9 items-center justify-center rounded-lg border border-border bg-muted/30'>
                      <Database className='size-4 text-muted-foreground' />
                    </span>
                    <div>
                      <h3 className='font-semibold'>Sections</h3>
                      <p className='text-sm text-muted-foreground'>
                        How the summary is structured — one card per section.
                      </p>
                    </div>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={
                      !isEditable ||
                      aiAction !== null ||
                      !draftRequirements.hasTitle ||
                      !draftRequirements.hasMeetingContext
                    }
                    onClick={() => void handleSuggestSections()}
                    className='gap-2'
                    data-track-category='SummaryTemplates'
                    data-track-name='SuggestSectionsWithAI'
                  >
                    {aiAction === 'sections' ? (
                      <LoaderCircle className='size-3.5 animate-spin' />
                    ) : (
                      <Sparkles className='size-3.5' />
                    )}
                    {aiAction === 'sections' ? 'Suggesting…' : 'Suggest sections'}
                  </Button>
                </div>

                <div className='space-y-3'>
                  {draft.sections.map(section => (
                    <div
                      key={section.id}
                      className='group flex items-start gap-3 rounded-xl border border-border px-4 py-4'
                    >
                      <GripVertical className='mt-1 size-4 shrink-0 text-muted-foreground/60' />
                      <div className='min-w-0 flex-1'>
                        <input
                          value={section.title}
                          onChange={event =>
                            updateSection(section.id, { title: event.target.value })
                          }
                          readOnly={!isEditable}
                          maxLength={100}
                          aria-label='Section title'
                          className='w-full bg-transparent text-sm font-semibold outline-none read-only:cursor-default'
                          data-track-category='SummaryTemplates'
                          data-track-name='EditSectionTitle'
                        />
                        <textarea
                          value={section.description}
                          onChange={event =>
                            updateSection(section.id, { description: event.target.value })
                          }
                          readOnly={!isEditable}
                          maxLength={500}
                          rows={2}
                          aria-label='Section description'
                          className='mt-1 w-full resize-none bg-transparent text-sm leading-5 text-muted-foreground outline-none read-only:cursor-default'
                          data-track-category='SummaryTemplates'
                          data-track-name='EditSectionDescription'
                        />
                      </div>
                      {isEditable && draft.sections.length > 1 && (
                        <button
                          type='button'
                          onClick={() =>
                            setDraft(current =>
                              current
                                ? {
                                    ...current,
                                    sections: current.sections.filter(
                                      item => item.id !== section.id,
                                    ),
                                  }
                                : current,
                            )
                          }
                          className='rounded p-1 text-muted-foreground opacity-0 hover:bg-muted hover:text-destructive group-hover:opacity-100'
                          aria-label='Remove section'
                          data-track-category='SummaryTemplates'
                          data-track-name='RemoveSection'
                        >
                          <X className='size-4' />
                        </button>
                      )}
                    </div>
                  ))}
                </div>

                {isEditable && (
                  <button
                    type='button'
                    onClick={() =>
                      setDraft(current =>
                        current
                          ? { ...current, sections: [...current.sections, EMPTY_SECTION()] }
                          : current,
                      )
                    }
                    disabled={draft.sections.length >= 20}
                    className='mt-3 inline-flex items-center gap-2 rounded-lg px-2 py-2 text-sm text-muted-foreground hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50 disabled:hover:bg-transparent'
                    data-track-category='SummaryTemplates'
                    data-track-name='AddSection'
                  >
                    <Plus className='size-4' /> Add section
                  </button>
                )}
              </section>

              <section className='border-b border-border py-7'>
                <div className='mb-4 flex items-center justify-between gap-4'>
                  <div className='flex items-center gap-3'>
                    <span className='flex size-9 items-center justify-center rounded-lg border border-border bg-muted/30'>
                      <Sparkles className='size-4 text-muted-foreground' />
                    </span>
                    <div>
                      <h3 className='font-semibold'>System prompt</h3>
                      <p className='text-sm text-muted-foreground'>
                        Instructions the AI follows when generating this summary.
                      </p>
                    </div>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={
                      !isEditable ||
                      aiAction !== null ||
                      !draftRequirements.hasTitle ||
                      !draftRequirements.hasMeetingContext ||
                      !draftRequirements.hasSections
                    }
                    onClick={() => void handleGenerateSystemPrompt()}
                    className='gap-2'
                    data-track-category='SummaryTemplates'
                    data-track-name='GenerateSystemPromptWithAI'
                  >
                    {aiAction === 'systemPrompt' ? (
                      <LoaderCircle className='size-3.5 animate-spin' />
                    ) : (
                      <Sparkles className='size-3.5' />
                    )}
                    {aiAction === 'systemPrompt' ? 'Generating…' : 'Generate summary prompt'}
                  </Button>
                </div>

                <textarea
                  value={draft.systemPrompt}
                  onChange={event =>
                    setDraft(current =>
                      current ? { ...current, systemPrompt: event.target.value } : current,
                    )
                  }
                  readOnly={!isEditable}
                  maxLength={12_000}
                  rows={8}
                  placeholder='Generate or write the instructions used to create summaries with this template…'
                  className='w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-6 outline-none focus:ring-2 focus:ring-ring read-only:bg-muted/20'
                  data-track-category='SummaryTemplates'
                  data-track-name='EditSystemPrompt'
                />
              </section>

              <section className='py-7'>
                <div className='mb-4 flex items-center gap-3'>
                  <span className='flex size-9 items-center justify-center rounded-lg border border-border bg-muted/30'>
                    <ArrowRightFromLine className='size-4 text-muted-foreground' />
                  </span>
                  <div>
                    <h3 className='font-semibold'>Output</h3>
                    <p className='text-sm text-muted-foreground'>
                      What happens after the meeting — wire this template to an outlet.
                    </p>
                  </div>
                </div>

                <div className='overflow-hidden rounded-xl border border-border'>
                  {[
                    {
                      value: DefaultOutlet.MESSAGE,
                      title: 'Post to channel',
                      description: 'Drop the recap into a Spaces channel',
                      icon: Hash,
                      enabled: true,
                    },
                    {
                      value: DefaultOutlet.EMAIL,
                      title: 'Draft follow-up email',
                      description: 'Compose a follow-up to attendees',
                      icon: Mail,
                      enabled: true,
                    },
                    {
                      value: 'CRM',
                      title: 'Add to CRM',
                      description: 'Log the notes against the deal',
                      icon: Database,
                      enabled: false,
                    },
                    {
                      value: 'SCORECARD',
                      title: 'Draft scorecard',
                      description: 'Turn the interview into a scorecard',
                      icon: FileCheck2,
                      enabled: false,
                    },
                    {
                      value: 'CHATGPT',
                      title: 'Send to ChatGPT',
                      description: 'Open the summary in ChatGPT',
                      icon: Sparkles,
                      enabled: false,
                    },
                    {
                      value: 'CLAUDE',
                      title: 'Send to Claude',
                      description: 'Open the summary in Claude',
                      icon: Sparkles,
                      enabled: false,
                    },
                  ].map(option => {
                    const selected = draft.defaultOutlet === option.value;
                    const Icon = option.icon;
                    return (
                      <button
                        key={option.value}
                        type='button'
                        disabled={!isEditable || !option.enabled}
                        onClick={() =>
                          option.enabled &&
                          setDraft(current =>
                            current
                              ? {
                                  ...current,
                                  defaultOutlet: option.value as SummaryTemplate['defaultOutlet'],
                                }
                              : current,
                          )
                        }
                        className={cn(
                          'flex w-full items-center gap-4 border-b border-border px-4 py-3 text-left last:border-b-0',
                          selected && 'bg-muted',
                          !option.enabled && 'opacity-50',
                          isEditable && option.enabled && 'hover:bg-muted/70',
                        )}
                        data-track-category='SummaryTemplates'
                        data-track-name={`SelectOutput_${option.value}`}
                      >
                        <span
                          className={cn(
                            'size-4 rounded-full border-2 border-muted-foreground/50',
                            selected && 'border-[5px] border-foreground',
                          )}
                        />
                        <span className='flex size-9 items-center justify-center rounded-lg border border-border bg-background'>
                          <Icon className='size-4' />
                        </span>
                        <span>
                          <span className='block text-sm font-medium'>{option.title}</span>
                          <span className='block text-xs text-muted-foreground'>
                            {option.description}
                          </span>
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            </div>
          ) : (
            <div className='flex h-full items-center justify-center text-sm text-muted-foreground'>
              {loading ? 'Loading templates…' : 'Create your first template'}
            </div>
          )}
        </main>
      </div>

      <footer className='flex min-h-20 shrink-0 items-center justify-between gap-4 border-t border-border px-6 py-3'>
        <p className='text-xs text-muted-foreground'>
          {willSaveDraft && !draftRequirements.isComplete
            ? `Complete ${draftRequirements.missing.join(', ')} to save.`
            : ''}
        </p>
        <div className='flex shrink-0 items-center gap-3'>
          <Button type='button' variant='outline' onClick={onClose} disabled={saving}>
            Cancel
          </Button>
          <Button
            type='button'
            onClick={() => void handleApply()}
            disabled={
              !draft ||
              saving ||
              aiAction !== null ||
              (willSaveDraft && !draftRequirements.isComplete)
            }
          >
            {saving
              ? 'Saving…'
              : isCreatingTemplate
                ? 'Save template'
                : onApply
                  ? 'Apply template'
                  : isDirty
                    ? 'Save changes'
                    : 'Done'}
          </Button>
        </div>
      </footer>

      {shareTemplate && (
        <Dialog
          open
          onOpenChange={open => !open && setShareTemplate(null)}
          title='Share template'
          description={`Share ${shareTemplate.name} with people, groups, or channels.`}
          className='overflow-hidden rounded-xl p-0'
          zIndexClassName='z-[60]'
          testId='summary-template-share-dialog'
        >
          <SummaryTemplateShareModal
            template={shareTemplate}
            onTemplateChange={handlePublicationChange}
          />
        </Dialog>
      )}
    </div>
  );
}

export default SummaryTemplatesModal;
