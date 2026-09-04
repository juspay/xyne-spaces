import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ListChecks, Loader2, Plus, Tag } from 'lucide-react';
import { toast } from 'sonner';
import { Dialog } from '../../ui/Dialog/Dialog';
import { Button } from '../../ui/Button/Button';
import { Checkbox } from '../../ui/Checkbox/Checkbox';
import { cn } from '../../../utils/classNames';
import { useAuthContextValues } from '../../../hooks/useAuth';
import { useCachedQuery } from '../../../hooks/useCachedQuery';
import { useUsersById } from '../../../hooks/useUsers';
import { queries } from '../../../zero/queries';
import {
  createDeskLabelRules,
  fetchDeskLabelRules,
  fetchTriggerSchema,
  type Automation,
} from '../../../api/automationsApi';
import { EmailReceivedFilterForm } from '../../Automation/AutomationBuilder/TriggerCard/EmailReceivedFilterForm';
import type { JsonSchema } from '../../Automation/Automation.types';
import { deskLabelRulesQueryKey, MyAutoLabelRules } from './AutoLabelRules';

const LABEL_COLORS = [
  '#ef4444',
  '#f97316',
  '#eab308',
  '#22c55e',
  '#14b8a6',
  '#3b82f6',
  '#8b5cf6',
  '#ec4899',
];

const colorForName = (name: string): string => {
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
  return LABEL_COLORS[Math.abs(hash) % LABEL_COLORS.length] ?? '#6b7280';
};

function omitSchemaProperty(schema: JsonSchema, key: string): JsonSchema {
  if (schema.properties && key in schema.properties) {
    const { [key]: _omit, ...rest } = schema.properties;
    return { ...schema, properties: rest };
  }
  if (schema.definitions) {
    const newDefs: Record<string, JsonSchema> = {};
    for (const [defKey, def] of Object.entries(schema.definitions)) {
      newDefs[defKey] = omitSchemaProperty(def, key);
    }
    return { ...schema, definitions: newDefs };
  }
  return schema;
}

type WizardStep = 'filters' | 'label';
type WizardView = 'create' | 'rules';

export interface AutoLabelWizardProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  channelId: string;
  isMember: boolean;
  /** Hidden on desks with no mailbox folders — there is no Inbox to keep mail in. */
  showKeepInInbox?: boolean;
  onCreated?: (automations: Automation[]) => void;
}

export function AutoLabelWizard({
  open,
  onOpenChange,
  channelId,
  isMember,
  showKeepInInbox = true,
  onCreated,
}: AutoLabelWizardProps): React.ReactElement {
  const queryClient = useQueryClient();
  const { userID } = useAuthContextValues();
  const usersById = useUsersById();
  const [view, setView] = useState<WizardView>('create');
  const [step, setStep] = useState<WizardStep>('filters');
  const [emailFilters, setEmailFilters] = useState<Record<string, unknown>>({});
  const [labelName, setLabelName] = useState('');
  const [labelId, setLabelId] = useState<string | undefined>();
  const [labelColor, setLabelColor] = useState<string | undefined>();
  const [labelSearch, setLabelSearch] = useState('');
  const [keepInInbox, setKeepInInbox] = useState(true);
  const [applyToExisting, setApplyToExisting] = useState(false);

  const triggerSchemaQuery = useQuery({
    queryKey: ['automations', 'schema', 'triggers', 'EMAIL_RECEIVED'],
    queryFn: () => fetchTriggerSchema('EMAIL_RECEIVED'),
    staleTime: 5 * 60 * 1000,
    enabled: open,
  });

  const rulesQuery = useInfiniteQuery({
    queryKey: deskLabelRulesQueryKey(channelId),
    queryFn: ({ pageParam }) => fetchDeskLabelRules({ channelId, cursor: pageParam, limit: 50 }),
    initialPageParam: null as string | null,
    getNextPageParam: lastPage =>
      lastPage.pagination.hasMore ? lastPage.pagination.nextCursor : undefined,
    enabled: open && !!channelId,
  });

  const [catalog] = useCachedQuery(
    queries.conversationLabelsByChannelIdV2({ channelId, isMember }),
    { enabled: !!channelId && open },
  );

  useEffect(() => {
    if (!open) return;
    setView('create');
    setStep('filters');
    setEmailFilters({});
    setLabelName('');
    setLabelId(undefined);
    setLabelColor(undefined);
    setLabelSearch('');
    setKeepInInbox(true);
    setApplyToExisting(false);
  }, [open, channelId]);

  const emailSchema = useMemo(() => {
    const raw = triggerSchemaQuery.data?.configSchema;
    if (!raw) return null;
    return omitSchemaProperty(raw, 'channelIds');
  }, [triggerSchemaQuery.data]);

  const filteredLabels = useMemo(() => {
    const list = catalog ?? [];
    const q = labelSearch.trim().toLowerCase();
    return q ? list.filter(l => l.name.toLowerCase().includes(q)) : list;
  }, [catalog, labelSearch]);

  const conflictingLabel = useMemo(() => {
    const trimmed = labelSearch.trim();
    if (!trimmed) return undefined;
    return (catalog ?? []).find(l => l.name.toLowerCase() === trimmed.toLowerCase());
  }, [catalog, labelSearch]);

  const canCreateLabel = !!labelSearch.trim() && !conflictingLabel;

  const hasConfiguredEmailFilter = Object.values(emailFilters).some(value => {
    if (Array.isArray(value)) {
      return value.some(item => String(item).trim().length > 0);
    }
    if (typeof value === 'boolean') return value;
    if (typeof value === 'string') return value.trim().length > 0;
    return value !== undefined && value !== null;
  });
  const canProceedFilters =
    !!emailSchema && !triggerSchemaQuery.isLoading && hasConfiguredEmailFilter;
  const canSave = labelName.trim().length > 0;
  const existingRules = rulesQuery.data?.pages.flatMap(page => page.automations) ?? [];
  const ruleCounts = rulesQuery.data?.pages[0]?.counts ?? {
    total: existingRules.length,
    active: existingRules.filter(item => item.status === 'ACTIVE').length,
  };

  const saveMutation = useMutation({
    mutationFn: () =>
      createDeskLabelRules({
        channelId,
        labelName: labelName.trim(),
        ...(labelColor ? { color: labelColor } : {}),
        ...(labelId ? { labelId } : {}),
        keepInInbox: showKeepInInbox ? keepInInbox : true,
        applyToExisting,
        emailFilters,
      }),
    onSuccess: data => {
      const count = data.automations.length;
      if (!data.created) {
        toast.info('A matching auto-label rule already exists');
      } else {
        toast.success(
          count === 1
            ? 'Auto-label rule created and active'
            : `${count} auto-label rules created and active`,
        );
      }
      if (applyToExisting) {
        if (data.backfill) {
          toast.info('Applying the label to older emails — this runs in the background.');
        } else {
          toast.error('Rule saved, but older emails could not be queued. Try again from Rules.');
        }
      }
      void queryClient.invalidateQueries({
        queryKey: deskLabelRulesQueryKey(channelId),
      });
      onCreated?.(data.automations);
      onOpenChange(false);
    },
    onError: (err: unknown) => {
      const response = (err as { response?: { status?: number; data?: { error?: string } } })
        ?.response;
      if (response?.status === 409) {
        toast.error(`A label named “${labelName.trim()}” already exists in this channel.`);
        return;
      }
      const message =
        response?.data?.error ||
        (err instanceof Error ? err.message : 'Failed to create auto-label rules');
      toast.error(message);
    },
  });

  const selectExistingLabel = (
    id: string,
    name: string,
    color: string | null | undefined,
    createdBy: string,
  ): void => {
    if (createdBy !== userID) return;
    setLabelId(id);
    setLabelName(name);
    setLabelColor(color ?? colorForName(name));
    setLabelSearch(name);
  };

  const selectNewLabel = (name: string): void => {
    setLabelId(undefined);
    setLabelName(name);
    setLabelColor(colorForName(name));
    setLabelSearch(name);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title='Auto-label emails'
      description='Configure a personal email auto-label rule for this desk.'
      className='max-w-xl overflow-hidden'
    >
      <header className='border-b border-border px-5 pb-4 pt-5'>
        <div className='flex items-start gap-3'>
          {view === 'rules' && (
            <Button
              type='button'
              variant='ghost'
              size='iconSm'
              className='mt-0.5'
              onClick={() => setView('create')}
              data-track-category='xyne-desk'
              data-track-name='auto-label-back-to-create'
              aria-label='Back to create rule'
              title='Back to create rule'
            >
              <ArrowLeft className='size-4' />
            </Button>
          )}
          <div className='min-w-0 flex-1'>
            <h2 className='text-base font-semibold text-foreground'>
              {view === 'rules' ? 'Your auto-label rules' : 'Auto-label emails'}
            </h2>
            <p className='mt-0.5 text-xs text-muted-foreground'>
              {view === 'rules'
                ? 'Manage the personal rules for this desk.'
                : step === 'filters'
                  ? 'Choose which incoming emails should receive the label.'
                  : 'Choose the label and Inbox behavior for matching emails.'}
            </p>
          </div>
          {view === 'create' && (
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={() => setView('rules')}
              data-track-category='xyne-desk'
              data-track-name='auto-label-manage-rules'
            >
              <ListChecks className='size-4' />
              Rules
              {!rulesQuery.isLoading && ruleCounts.total > 0 && (
                <span className='min-w-5 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground'>
                  {ruleCounts.total}
                </span>
              )}
            </Button>
          )}
        </div>

        {view === 'create' && (
          <div className='mt-4 flex items-center gap-2 text-[11px] text-muted-foreground'>
            <span
              className={cn(
                'rounded-full px-2 py-0.5',
                step === 'filters' ? 'bg-foreground text-background' : 'bg-muted',
              )}
            >
              1. Filters
            </span>
            <span aria-hidden='true'>→</span>
            <span
              className={cn(
                'rounded-full px-2 py-0.5',
                step === 'label' ? 'bg-foreground text-background' : 'bg-muted',
              )}
            >
              2. Label
            </span>
          </div>
        )}
      </header>

      <div className='max-h-[min(68vh,680px)] overflow-y-auto px-5 py-4'>
        {view === 'rules' && (
          <MyAutoLabelRules
            channelId={channelId}
            automations={existingRules}
            totalCount={ruleCounts.total}
            activeCount={ruleCounts.active}
            isLoading={rulesQuery.isLoading}
            isError={rulesQuery.isError}
            onRetry={() => void rulesQuery.refetch()}
            hasMore={rulesQuery.hasNextPage}
            isFetchingMore={rulesQuery.isFetchingNextPage}
            onLoadMore={() => void rulesQuery.fetchNextPage()}
          />
        )}

        {view === 'create' && step === 'filters' && (
          <div className='flex flex-col gap-5'>
            <section className='flex flex-col gap-3'>
              <div>
                <h3 className='text-sm font-medium text-foreground'>Match incoming emails</h3>
                <p className='text-[11px] text-muted-foreground'>
                  Add at least one filter to create an incoming email rule.
                </p>
              </div>
              {triggerSchemaQuery.isLoading || !emailSchema ? (
                <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                  <Loader2 className='size-4 animate-spin' />
                  Loading email filters…
                </div>
              ) : (
                <EmailReceivedFilterForm
                  schema={emailSchema}
                  value={emailFilters}
                  onChange={setEmailFilters}
                  issues={null}
                  pathPrefix='emailFilters.'
                />
              )}
            </section>
          </div>
        )}

        {view === 'create' && step === 'label' && (
          <div className='flex flex-col gap-3'>
            <div>
              <h3 className='text-sm font-medium text-foreground'>Choose a label</h3>
              <p className='text-[11px] text-muted-foreground'>
                Applied to matching email threads in your private label catalog.
              </p>
            </div>
            <input
              type='text'
              value={labelSearch}
              onChange={e => {
                setLabelSearch(e.target.value);
                setLabelName(e.target.value);
                setLabelId(undefined);
                setLabelColor(colorForName(e.target.value));
              }}
              placeholder='Search or create a label…'
              className='h-9 rounded-md border border-border bg-background px-3 text-sm text-foreground placeholder:text-muted-foreground'
              data-track-category='xyne-desk'
              data-track-name='auto-label-label-search'
            />
            {conflictingLabel && (
              <p
                className={cn(
                  'text-[11px]',
                  conflictingLabel.createdBy === userID
                    ? 'text-muted-foreground'
                    : 'text-amber-600',
                )}
              >
                {conflictingLabel.createdBy === userID
                  ? `“${labelSearch.trim()}” already exists — select it from the list.`
                  : `A label named “${labelSearch.trim()}” already exists in this channel.`}
              </p>
            )}
            <div className='flex flex-col gap-1 max-h-48 overflow-y-auto rounded-md border border-border p-1'>
              {filteredLabels.map(label => {
                const isOwn = label.createdBy === userID;
                const selected = isOwn && (labelId === label.id || labelName === label.name);
                const ownerName = isOwn
                  ? undefined
                  : usersById.get(label.createdBy)?.name?.trim() || undefined;
                return (
                  <button
                    key={label.id}
                    type='button'
                    onClick={() =>
                      selectExistingLabel(label.id, label.name, label.color, label.createdBy)
                    }
                    aria-disabled={!isOwn}
                    title={
                      isOwn
                        ? undefined
                        : `Created by ${ownerName ?? 'a teammate'} — you can't use it in your rules`
                    }
                    className={cn(
                      'flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm',
                      selected ? 'bg-accent' : isOwn && 'hover:bg-accent/50',
                      !isOwn && 'cursor-not-allowed text-muted-foreground opacity-70',
                    )}
                    data-track-category='xyne-desk'
                    data-track-name='auto-label-pick-existing'
                  >
                    <span
                      className='size-2.5 rounded-full shrink-0'
                      style={{ backgroundColor: label.color ?? colorForName(label.name) }}
                    />
                    <span className='flex-1 truncate'>{label.name}</span>
                    <span
                      className={cn(
                        'shrink-0 rounded-full bg-muted px-1.5 py-0.5 text-[10px] leading-none text-muted-foreground',
                        !isOwn && 'max-w-[120px] truncate',
                      )}
                    >
                      {isOwn ? 'You' : (ownerName ?? 'Teammate')}
                    </span>
                    {selected && <Tag className='size-3.5 text-muted-foreground' />}
                  </button>
                );
              })}
              {canCreateLabel && (
                <button
                  type='button'
                  onClick={() => selectNewLabel(labelSearch.trim())}
                  className='flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm text-foreground hover:bg-accent/50'
                  data-track-category='xyne-desk'
                  data-track-name='auto-label-create-new'
                >
                  <span
                    className='size-2.5 rounded-full shrink-0'
                    style={{ backgroundColor: colorForName(labelSearch.trim()) }}
                  />
                  Create “{labelSearch.trim()}”
                </button>
              )}
              {filteredLabels.length === 0 && !canCreateLabel && (
                <div className='px-2 py-3 text-xs text-muted-foreground'>
                  Type a name to create a new label.
                </div>
              )}
            </div>
            {labelName.trim() && (
              <div className='flex items-center gap-2 text-xs text-muted-foreground'>
                Will apply
                <span
                  className='inline-flex items-center gap-1.5 rounded-full border border-border px-2 py-0.5 text-foreground'
                  style={{ borderColor: labelColor ?? colorForName(labelName) }}
                >
                  <span
                    className='size-2 rounded-full'
                    style={{ backgroundColor: labelColor ?? colorForName(labelName) }}
                  />
                  {labelName.trim()}
                </span>
              </div>
            )}
            {showKeepInInbox && (
              <div className='rounded-md border border-border bg-muted/30 px-3 py-2.5'>
                <Checkbox
                  checked={keepInInbox}
                  onChange={setKeepInInbox}
                  label='Keep matching emails in Inbox'
                  size='sm'
                />
                <p className='mt-1 pl-5 text-[11px] text-muted-foreground'>
                  When disabled, inbox label will be removed from matching emails.
                </p>
              </div>
            )}
            <div className='rounded-md border border-border bg-muted/30 px-3 py-2.5'>
              <Checkbox
                checked={applyToExisting}
                onChange={setApplyToExisting}
                label='Also apply to existing emails that match'
                size='sm'
              />
              <p className='mt-1 pl-5 text-[11px] text-muted-foreground'>
                Labels matching threads already in this desk. Runs in the background.
              </p>
              {applyToExisting && showKeepInInbox && !keepInInbox && (
                <p className='mt-1.5 pl-5 text-[11px] text-amber-600'>
                  This will also archive every older thread that matches, removing them from your
                  Inbox.
                </p>
              )}
            </div>
          </div>
        )}
      </div>

      <div className='flex items-center justify-between gap-2 border-t border-border px-5 py-4'>
        {view === 'rules' ? (
          <>
            <Button
              type='button'
              variant='ghost'
              size='sm'
              onClick={() => onOpenChange(false)}
              data-track-category='xyne-desk'
              data-track-name='auto-label-rules-close'
            >
              Close
            </Button>
            <Button
              type='button'
              size='sm'
              onClick={() => setView('create')}
              data-track-category='xyne-desk'
              data-track-name='auto-label-new-rule'
            >
              <Plus className='size-4' />
              New rule
            </Button>
          </>
        ) : (
          <Button
            type='button'
            variant='ghost'
            size='sm'
            onClick={() => (step === 'label' ? setStep('filters') : onOpenChange(false))}
            data-track-category='xyne-desk'
            data-track-name='auto-label-wizard-back'
          >
            {step === 'label' ? 'Back' : 'Cancel'}
          </Button>
        )}
        {view === 'create' && step === 'filters' ? (
          <Button
            type='button'
            size='sm'
            disabled={!canProceedFilters}
            onClick={() => setStep('label')}
            data-track-category='xyne-desk'
            data-track-name='auto-label-wizard-next'
          >
            Next
          </Button>
        ) : view === 'create' ? (
          <Button
            type='button'
            size='sm'
            disabled={!canSave || saveMutation.isPending}
            onClick={() => saveMutation.mutate()}
            trackId='create_auto_label_rule'
            data-track-category='xyne-desk'
            data-track-name='auto-label-wizard-save'
          >
            {saveMutation.isPending ? (
              <>
                <Loader2 className='size-3.5 animate-spin' />
                Creating…
              </>
            ) : (
              'Create rule'
            )}
          </Button>
        ) : null}
      </div>
    </Dialog>
  );
}
