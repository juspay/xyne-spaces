import { useEffect, useMemo, useRef, useState, type ReactElement } from 'react';
import {
  ChevronDown,
  ClockDefault,
  DeleteDustbin01,
  DragableSixDots,
  EnvelopeDefault,
  Globe,
  Hashtag,
  LockClose,
  MultipleCrossCancelDefault,
  PlusDefault,
  SearchDefault,
  Spinner,
  ThreeDotsMenuHorizontal,
  UserTwo,
} from '@xyne/icons';
import { toast } from 'sonner';
import { DefaultOutlet } from '@xyne/shared';
import { XyneAIStar } from '../../../components/icons/xyne-ai';
import Avatar from '../../../components/ui/Avatar/Avatar';
import { Button } from '../../../components/ui/Button/Button';
import { Popover } from '../../../components/ui/Popover';
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

/**
 * Templates carry no icon of their own, so the badge derives one from the name's
 * first character. Split by code point rather than `name[0]` so a leading emoji
 * survives instead of rendering as half a surrogate pair. Falls back to `#` only
 * while the name is empty (the input allows clearing it before save re-titles it).
 */
export const getTemplateIcon = (name: string): string => {
  if (name === 'Default summary') return '⚡';
  const [firstChar] = Array.from(name.trim());
  return firstChar ? firstChar.toUpperCase() : '#';
};

/**
 * Shared chrome for the three AI assist actions (draft context, suggest sections,
 * generate summary prompt) so they read as one family rather than drifting apart.
 */
const AI_ACTION_BUTTON_CLASS =
  'h-7 shrink-0 gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground';

const EMPTY_SECTION = (): SummaryTemplateSection => ({
  id: crypto.randomUUID(),
  title: '',
  description: '',
});

const NEW_TEMPLATE = (currentUserId: string): TemplateDraft => ({
  id: null,
  name: '',
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
  const [shareCount, setShareCount] = useState<number | null>(null);
  const draftCreator = useUser(draft?.createdBy ?? '');

  const nameInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const templateId = draft?.id;
    setShareCount(null);
    if (!templateId || !draft.canEdit) return;

    let cancelled = false;
    void recordingService
      .getSummaryTemplateShares(templateId)
      .then(shares => {
        if (!cancelled) setShareCount(shares.length);
      })
      .catch(() => undefined);

    return (): void => {
      cancelled = true;
    };
  }, [draft?.id, draft?.canEdit]);

  // A brand-new template opens with every field blank, so put the caret in the title
  // rather than making the user hunt for the first thing to fill in.
  useEffect(() => {
    if (isCreatingTemplate && draft && !draft.id) nameInputRef.current?.focus();
  }, [isCreatingTemplate, draft?.id]);

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
  const canOpenShare = Boolean(
    draft?.id &&
    !isAdminPublicationReview &&
    (draft.canEdit || (isScribeAdmin && draft.visibility === 'WAITING_FOR_APPROVAL')),
  );

  const shareTrigger =
    draft?.visibility === 'PUBLIC'
      ? { icon: <Globe className='size-3.5' />, label: 'Public' }
      : draft?.visibility === 'WAITING_FOR_APPROVAL'
        ? { icon: <ClockDefault className='size-3.5' />, label: 'Pending review' }
        : shareCount
          ? { icon: <UserTwo className='size-3.5' />, label: `Shared · ${shareCount}` }
          : { icon: <LockClose className='size-3.5' />, label: 'Private' };

  return (
    <div className='flex h-full min-h-0 flex-col bg-background text-foreground'>
      <header className='flex h-14 shrink-0 items-center justify-between border-b border-border px-4 sticky top-0 z-10 bg-background'>
        <h2 className='text-sm font-semibold'>Summary Templates</h2>
        <Button
          type='button'
          variant='ghost'
          size='iconSm'
          onClick={onClose}
          className='rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground'
          aria-label='Close templates'
          data-track-category='SummaryTemplates'
          data-track-name='Close'
        >
          <MultipleCrossCancelDefault className='size-4' />
        </Button>
      </header>

      <div className='flex min-h-0 flex-1'>
        <aside className='flex w-72 shrink-0 flex-col border-r border-border bg-muted/20'>
          <div className='flex shrink-0 flex-col gap-2.5 px-3.5 py-3.5'>
            <Button
              type='button'
              variant='outline'
              onClick={() => {
                const next = NEW_TEMPLATE(currentUserId);
                setDraft(next);
                setOriginalDraft(null);
                setIsCreatingTemplate(true);
              }}
              className='h-9 w-full gap-2.5 rounded-lg border-border px-3 shadow-none hover:bg-muted'
              data-track-category='SummaryTemplates'
              data-track-name='NewTemplate'
            >
              <PlusDefault className='size-4' />
              New template
            </Button>

            <label className='flex h-9 items-center gap-2 rounded-lg border border-border bg-background px-2.5 text-sm focus-within:ring-2 focus-within:ring-ring'>
              <SearchDefault className='size-4 shrink-0 text-muted-foreground' />
              <input
                value={search}
                onChange={event => setSearch(event.target.value)}
                placeholder='Search templates...'
                className='min-w-0 flex-1 bg-transparent outline-none placeholder:text-muted-foreground'
                data-track-category='SummaryTemplates'
                data-track-name='Search'
              />
            </label>
          </div>

          <div className='thin-scrollbar min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-3.5 pt-0.5'>
            {loading ? (
              <p className='px-2 py-2 text-sm text-muted-foreground'>Loading templates…</p>
            ) : (
              groupedTemplates.map(({ group, templates: groupTemplates }) => (
                <section key={group}>
                  <h3 className='px-2 pb-1 pt-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground'>
                    {GROUP_LABELS[group]}
                  </h3>
                  <div>
                    {groupTemplates.map(template => {
                      const active = draft?.id === template.id;
                      return (
                        <Button
                          key={template.id}
                          type='button'
                          variant='ghost'
                          onClick={() => selectTemplate(template)}
                          className={cn(
                            'h-auto w-full justify-start gap-2.5 whitespace-normal rounded-lg px-2 py-1.5 text-left font-normal hover:bg-muted',
                            active && 'bg-muted',
                          )}
                          data-track-category='SummaryTemplates'
                          data-track-name='SelectTemplate'
                        >
                          <span className='flex size-7 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-sm font-semibold shadow-sm'>
                            {getTemplateIcon(template.name)}
                          </span>
                          <span className='min-w-0 flex-1'>
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
                        </Button>
                      );
                    })}
                  </div>
                </section>
              ))
            )}
          </div>
        </aside>

        <main className='thin-scrollbar min-w-0 flex-1 overflow-y-auto overscroll-contain'>
          {draft ? (
            <div className='px-7 pb-7 pt-6'>
              {isAdminPublicationReview && (
                <div className='mb-5 flex flex-col gap-3 rounded-xl border border-border bg-muted/40 p-4 sm:flex-row sm:items-center'>
                  <span className='flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-status-pending'>
                    <Globe className='size-4' />
                  </span>
                  <div className='min-w-0 flex-1'>
                    <p className='text-sm font-semibold'>
                      {creatorName} wants to make this template public
                    </p>
                    <p className='mt-0.5 text-xs text-muted-foreground'>
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
                      className='h-8 rounded-lg px-3 text-xs font-medium text-muted-foreground'
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
                      className='h-8 rounded-lg bg-foreground px-3 text-xs font-semibold text-background hover:bg-foreground/90'
                      data-track-category='SummaryTemplates'
                      data-track-name='MakeTemplatePublic'
                    >
                      Make public
                    </Button>
                  </div>
                </div>
              )}

              <div className='flex items-start gap-3 border-b border-border pb-5'>
                <span className='flex size-11 shrink-0 items-center justify-center rounded-xl border border-border bg-muted/30 text-xl font-semibold'>
                  {templateIcon}
                </span>
                <div className='min-w-0 flex-1 pt-px'>
                  <input
                    ref={nameInputRef}
                    placeholder='Untitled template'
                    value={draft.name}
                    onChange={event =>
                      setDraft(current =>
                        current ? { ...current, name: event.target.value } : current,
                      )
                    }
                    readOnly={!isEditable}
                    maxLength={120}
                    aria-label='Template name'
                    className='w-full bg-transparent py-0.5 text-2xl font-bold tracking-tight outline-none read-only:cursor-default placeholder:text-muted-foreground/40 placeholder:text-medium'
                    data-track-category='SummaryTemplates'
                    data-track-name='EditName'
                  />
                  <div className='mt-1.5 flex flex-wrap items-center gap-2.5 text-xs text-muted-foreground'>
                    <span className='inline-flex items-center gap-1.5'>
                      {draft.isSystem ? (
                        <span className='inline-flex size-5 shrink-0 items-center justify-center rounded-full bg-foreground text-xs font-semibold text-background'>
                          XY
                        </span>
                      ) : (
                        <Avatar
                          userId={draft.createdBy}
                          size='sm'
                          rounded
                          showActiveStatus={false}
                          className='size-5 shrink-0'
                        />
                      )}
                      <p className='text-sm text-muted-foreground cursor-default'>{creatorLabel}</p>
                    </span>
                    {!canOpenShare && draft.visibility !== 'PRIVATE' && (
                      <span className='inline-flex items-center gap-1.5 rounded-lg border border-border px-2.5 py-1 text-xs font-medium text-foreground'>
                        {shareTrigger.icon}
                        {shareTrigger.label}
                      </span>
                    )}
                    {canOpenShare && (
                      <Popover
                        open={shareTemplate !== null}
                        onOpenChange={open => {
                          if (open) void handleOpenShare();
                          else setShareTemplate(null);
                        }}
                        modal
                        side='bottom'
                        align='start'
                        sideOffset={8}
                        onInteractOutside={event => {
                          const target = event.target as Element | null;
                          if (
                            target?.closest?.('[data-radix-popper-content-wrapper]') ||
                            target?.closest?.('[data-sonner-toast], [data-sonner-toaster]')
                          ) {
                            event.preventDefault();
                          }
                        }}
                        // Bounded flex column, not a scroller: the recipient list
                        // inside owns the overflow so the search field and actions
                        // stay put.
                        className='flex max-h-96 w-80 flex-col rounded-xl border-border p-3 shadow-xl'
                        trigger={
                          <Button
                            type='button'
                            variant='outline'
                            size='sm'
                            disabled={
                              saving || (draft.canEdit && isDirty && !draftRequirements.isComplete)
                            }
                            className='h-7 gap-1.5 rounded-lg border-border bg-muted/40 px-2.5 text-xs font-medium shadow-none'
                            aria-label={`Sharing: ${shareTrigger.label}`}
                            data-track-category='SummaryTemplates'
                            data-track-name='OpenShareTemplate'
                          >
                            {shareTrigger.icon}
                            {shareTrigger.label}
                            <ChevronDown className={cn('size-4 text-muted-foreground')} />
                          </Button>
                        }
                      >
                        {shareTemplate && (
                          <SummaryTemplateShareModal
                            template={shareTemplate}
                            onTemplateChange={handlePublicationChange}
                            onSharesChange={setShareCount}
                          />
                        )}
                      </Popover>
                    )}
                  </div>
                </div>

                {draft.id && draft.canEdit && (
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        type='button'
                        variant='outline'
                        size='iconSm'
                        className='rounded-lg border-border text-muted-foreground shadow-none hover:bg-muted hover:text-foreground'
                        aria-label='Template actions'
                        data-track-category='SummaryTemplates'
                        data-track-name='OpenActions'
                      >
                        <ThreeDotsMenuHorizontal className='size-4' />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align='end'>
                      <DropdownMenuItem
                        onClick={() => void handleDelete()}
                        className='gap-2 text-destructive focus:text-destructive'
                      >
                        <DeleteDustbin01 className='size-4' /> Delete template
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                )}
              </div>

              <section className='py-3'>
                <div className='mb-2.5 flex items-center gap-2.5'>
                  <div className='min-w-0 flex-1'>
                    <h3 className='font-semibold'>Meeting Context</h3>
                    <p className='text-sm text-muted-foreground'>
                      What the meeting is about and what you want out of it.
                    </p>
                  </div>
                  <Button
                    type='button'
                    variant='outline'
                    size='sm'
                    disabled={!isEditable || aiAction !== null || !draftRequirements.hasTitle}
                    onClick={() => void handleDraftContext()}
                    className={AI_ACTION_BUTTON_CLASS}
                    data-track-category='SummaryTemplates'
                    data-track-name='DraftContextWithAI'
                  >
                    {aiAction === 'context' ? (
                      <Spinner className='size-3.5 animate-spin' />
                    ) : (
                      <XyneAIStar size={13} />
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
                  rows={3}
                  placeholder='Describe the meeting and the summary you want…'
                  className='min-h-24 w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-relaxed outline-none focus-visible:border-foreground placeholder:text-muted-foreground/60'
                  data-track-category='SummaryTemplates'
                  data-track-name='EditContext'
                />
              </section>

              <section className='pb-3 flex flex-col gap-2.5 justify-start items-start w-full'>
                <div className='mb-2.5 flex items-center gap-2.5 w-full'>
                  <div className='min-w-0 flex-1'>
                    <h3 className='font-semibold'>Sections</h3>
                    <p className='text-sm text-muted-foreground'>
                      How the summary is structured — one card per section.
                    </p>
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
                    className={AI_ACTION_BUTTON_CLASS}
                    data-track-category='SummaryTemplates'
                    data-track-name='SuggestSectionsWithAI'
                  >
                    {aiAction === 'sections' ? (
                      <Spinner className='size-3.5 animate-spin' />
                    ) : (
                      <XyneAIStar size={13} />
                    )}
                    {aiAction === 'sections' ? 'Suggesting…' : 'Suggest sections'}
                  </Button>
                </div>

                <div className='flex flex-col gap-2.5 w-full'>
                  {draft.sections.map(section => (
                    <div
                      key={section.id}
                      className='relative group flex flex-col items-start gap-1.5 rounded-xl border border-border bg-background p-3'
                    >
                      <div className='flex gap-1.5 items-center'>
                        <span
                          title='Drag to reorder'
                          className='shrink-0 cursor-grab text-muted-foreground/60'
                        >
                          <DragableSixDots className='size-3.5' />
                        </span>
                        <input
                          value={section.title}
                          onChange={event =>
                            updateSection(section.id, { title: event.target.value })
                          }
                          readOnly={!isEditable}
                          maxLength={100}
                          placeholder='Section title'
                          aria-label='Section title'
                          className='w-full bg-transparent text-sm font-semibold outline-none placeholder:text-muted-foreground/60'
                          data-track-category='SummaryTemplates'
                          data-track-name='EditSectionTitle'
                        />
                      </div>
                      <div className='pl-5 w-full'>
                        <textarea
                          value={section.description}
                          onChange={event =>
                            updateSection(section.id, { description: event.target.value })
                          }
                          readOnly={!isEditable}
                          maxLength={500}
                          rows={1}
                          placeholder='Instructions for this section…'
                          aria-label='Section description'
                          className='w-full resize-none bg-transparent text-sm leading-normal text-muted-foreground outline-none placeholder:text-muted-foreground/60'
                          data-track-category='SummaryTemplates'
                          data-track-name='EditSectionDescription'
                        />
                      </div>
                      {isEditable && draft.sections.length > 1 && (
                        <Button
                          variant='ghost'
                          size='iconSm'
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
                          className='absolute right-2 top-2 size-6 rounded-lg text-muted-foreground opacity-0 transition-opacity hover:bg-muted hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100'
                          title='Remove section'
                          aria-label='Remove section'
                          data-track-category='SummaryTemplates'
                          data-track-name='RemoveSection'
                        >
                          <MultipleCrossCancelDefault className='size-3.5' strokeWidth={2.5} />
                        </Button>
                      )}
                    </div>
                  ))}
                </div>

                {isEditable && (
                  <Button
                    variant='link'
                    onClick={() =>
                      setDraft(current =>
                        current
                          ? { ...current, sections: [...current.sections, EMPTY_SECTION()] }
                          : current,
                      )
                    }
                    className='hover:no-underline gap-1 !px-0 !py-0 text-sm font-medium text-muted-foreground hover:text-primary'
                    disabled={draft.sections.length >= 20}
                    data-track-category='SummaryTemplates'
                    data-track-name='AddSection'
                  >
                    <PlusDefault className='size-4' /> Add section
                  </Button>
                )}
              </section>

              <section className='pb-3'>
                <div className='mb-2.5 flex items-center gap-2.5'>
                  <div className='min-w-0 flex-1'>
                    <h3 className='font-semibold'>System prompt</h3>
                    <p className='text-sm text-muted-foreground'>
                      Instructions the AI follows when generating this summary.
                    </p>
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
                    className={AI_ACTION_BUTTON_CLASS}
                    data-track-category='SummaryTemplates'
                    data-track-name='GenerateSystemPromptWithAI'
                  >
                    {aiAction === 'systemPrompt' ? (
                      <Spinner className='size-3.5 animate-spin' />
                    ) : (
                      <XyneAIStar size={13} />
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
                  rows={4}
                  placeholder='Generate or write the instructions used to create summaries with this template…'
                  className='min-h-24 w-full resize-y rounded-xl border border-border bg-background px-4 py-3 text-sm leading-relaxed outline-none focus-visible:border-foreground placeholder:text-muted-foreground/60'
                  data-track-category='SummaryTemplates'
                  data-track-name='EditSystemPrompt'
                />
              </section>

              <section className='pb-3'>
                <div className='mb-4 flex items-center gap-2.5'>
                  <div className='min-w-0 flex-1'>
                    <h3 className='font-semibold'>Output</h3>
                    <p className='text-sm text-muted-foreground'>
                      What happens after the meeting — wire this template to an outlet.
                    </p>
                  </div>
                </div>

                <div className='overflow-hidden rounded-xl border border-border bg-background'>
                  {[
                    {
                      value: DefaultOutlet.MESSAGE,
                      title: 'Post to channel',
                      description: 'Drop the recap into a Spaces channel',
                      icon: Hashtag,
                      enabled: true,
                    },
                    {
                      value: DefaultOutlet.EMAIL,
                      title: 'Draft follow-up email',
                      description: 'Compose a follow-up to attendees',
                      icon: EnvelopeDefault,
                      enabled: true,
                    },
                  ].map(option => {
                    const selected = draft.defaultOutlet === option.value;
                    const Icon = option.icon;
                    return (
                      <Button
                        key={option.value}
                        type='button'
                        variant='ghost'
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
                          'h-auto w-full justify-start gap-3 whitespace-normal rounded-none border-b border-border px-3 py-2.5 text-left font-normal last:border-b-0',
                          selected && 'bg-muted',
                          !option.enabled && 'opacity-50',
                          isEditable && option.enabled && 'hover:bg-muted/70',
                        )}
                        data-track-category='SummaryTemplates'
                        data-track-name={`SelectOutput_${option.value}`}
                      >
                        <span
                          className={cn(
                            'inline-flex size-4 shrink-0 items-center justify-center rounded-full border-2 bg-background',
                            selected ? 'border-foreground' : 'border-muted-foreground/50',
                          )}
                        >
                          {selected && <span className='size-1.5 rounded-full bg-foreground' />}
                        </span>
                        <span className='flex size-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-muted-foreground'>
                          <Icon className='size-4' />
                        </span>
                        <span className='min-w-0 flex-1'>
                          <span className='block text-sm font-medium'>{option.title}</span>
                          <span className='block text-xs text-muted-foreground'>
                            {option.description}
                          </span>
                        </span>
                      </Button>
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

      <footer className='flex shrink-0 items-center justify-between gap-2.5 border-t border-border px-5 py-3'>
        <p className='min-w-0 text-xs text-muted-foreground'>
          {willSaveDraft && !draftRequirements.isComplete
            ? `Complete ${draftRequirements.missing.join(', ')} to save.`
            : ''}
        </p>
        <div className='flex shrink-0 items-center gap-2.5'>
          <Button
            type='button'
            variant='outline'
            onClick={onClose}
            disabled={saving}
            className='h-9 rounded-lg px-4 text-sm font-medium text-muted-foreground'
          >
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
            className='h-9 rounded-lg px-4 text-sm font-semibold'
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
    </div>
  );
}

export default SummaryTemplatesModal;
