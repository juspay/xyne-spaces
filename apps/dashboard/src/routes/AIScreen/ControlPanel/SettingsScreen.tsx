import { useMemo, useState, type FormEvent, type ReactElement } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { ArrowLeft, DeleteDustbin01, PencilEdit, PlusDefault } from '@xyne/icons';
import { toast } from 'sonner';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Dialog } from '@/components/ui/Dialog';
import { Input } from '@/components/ui/Input';
import { Field } from '@/components/ui/Field/Field';
import { Table, type ColumnDef } from '@/components/ui/Table';
import { MetricsCard } from '@/components/ClawAgents/metrics/MetricsCard';
import { ConfirmDialog } from '@/components/ClawAgents/ConfirmDialog';
import { clawErrorText } from '@/services/claw/clawRequest';
import { useDeleteUsagePrice, useSaveUsagePrice, useUsagePrices } from '@/hooks/useClawUsage';
import {
  BILLING_LABELS,
  labelFor,
  type ModelPrice,
  type PriceChange,
  type PriceRates,
  type PriceSlab,
  type UnpricedModel,
} from '@/services/claw/clawUsageService';
import {
  Banner,
  EmptyState,
  ErrorState,
  NUM_COL,
  Num,
  PageHeader,
  Pill,
  RelativeTime,
  TRACK,
  toDay,
  type Tone,
} from './controlPanelShared';

const RATES = [
  { key: 'inputPerMTok', label: 'Input' },
  { key: 'outputPerMTok', label: 'Output' },
  { key: 'cacheReadPerMTok', label: 'Cache read' },
  { key: 'cacheWritePerMTok', label: 'Cache write' },
] as const;
type RateKey = (typeof RATES)[number]['key'];

const rateFmt = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  minimumFractionDigits: 2,
  maximumFractionDigits: 6,
});

const isEpoch = (iso: string): boolean => new Date(iso).getTime() === 0;

const effectiveText = (iso: string): string =>
  isEpoch(iso)
    ? 'From the start'
    : new Date(iso).toLocaleDateString('en-US', {
        month: 'short',
        day: 'numeric',
        year: 'numeric',
      });

const CHANGE_KIND: Record<PriceChange['eventType'], { label: string; tone: Tone }> = {
  LLM_PRICE_CREATED: { label: 'Added', tone: 'good' },
  LLM_PRICE_UPDATED: { label: 'Changed', tone: 'warn' },
  LLM_PRICE_DELETED: { label: 'Deleted', tone: 'bad' },
};

type Rates = Pick<PriceRates, RateKey>;

const sameRates = (a: Rates, b: Rates): boolean =>
  RATES.every(r => Number(a[r.key]) === Number(b[r.key]));

/** Only the rates that moved; every rate for something added or removed. */
const RateLines = ({
  before,
  after,
}: {
  before: Rates | null;
  after: Rates | null;
}): ReactElement[] => {
  const fmt = (r: Rates | null, k: RateKey): string => (r ? rateFmt.format(Number(r[k])) : '');
  return RATES.filter(r => !before || !after || Number(before[r.key]) !== Number(after[r.key])).map(
    r => (
      <span key={r.key} className='whitespace-nowrap'>
        <span className='text-muted-foreground'>{r.label} </span>
        {before && after ? (
          <>
            <span className='text-muted-foreground line-through'>{fmt(before, r.key)}</span>
            {' → '}
            <span className='font-medium text-foreground'>{fmt(after, r.key)}</span>
          </>
        ) : after ? (
          <span className='font-medium text-foreground'>{fmt(after, r.key)}</span>
        ) : (
          <span className='text-muted-foreground line-through'>{fmt(before, r.key)}</span>
        )}
      </span>
    ),
  );
};

const RateChanges = ({ c }: { c: PriceChange }): ReactElement => {
  const slabsOf = (p: PriceRates | null): PriceSlab[] => p?.slabs ?? [];
  const overs = [
    ...new Set([...slabsOf(c.before), ...slabsOf(c.after)].map(x => x.overPromptTokens)),
  ].sort((a, b) => a - b);
  const slabs = overs
    .map(over => ({
      over,
      before: slabsOf(c.before).find(x => x.overPromptTokens === over) ?? null,
      after: slabsOf(c.after).find(x => x.overPromptTokens === over) ?? null,
    }))
    .filter(d => !(d.before && d.after && sameRates(d.before, d.after)));
  const baseMoved = !c.before || !c.after || !sameRates(c.before, c.after);
  if (!baseMoved && slabs.length === 0) {
    return <span className='text-muted-foreground'>No rate changed</span>;
  }
  return (
    <div className='flex flex-col gap-0.5 text-xs tabular-nums'>
      {baseMoved && <RateLines before={c.before} after={c.after} />}
      {slabs.map(d => (
        <div key={d.over} className='mt-1 flex flex-col gap-0.5'>
          <span className='text-[11px] font-medium text-foreground'>
            Prompts over {d.over.toLocaleString('en-US')} tokens
            {!d.before ? ' (added)' : !d.after ? ' (removed)' : ''}
          </span>
          <RateLines before={d.before} after={d.after} />
        </div>
      ))}
    </div>
  );
};

type ChangeRow = Record<string, unknown> & PriceChange;

const HISTORY_COLUMNS: Array<ColumnDef<ChangeRow>> = [
  {
    field: 'createdAt',
    header: 'When',
    className: 'whitespace-nowrap',
    renderCell: v => <RelativeTime iso={v as string} />,
  },
  {
    field: 'actor',
    header: 'By',
    renderCell: (_, r) =>
      r.actor ? (
        <span className='text-foreground' title={r.actor.email}>
          {r.actor.name}
        </span>
      ) : (
        <span className='text-muted-foreground'>Unknown</span>
      ),
  },
  {
    field: 'model',
    header: 'Price',
    minWidth: '14rem',
    renderCell: (_, r) => (
      <div className='min-w-0'>
        <div className='flex items-center gap-2'>
          <span className='truncate font-medium text-foreground'>{r.model}</span>
          <Pill tone={CHANGE_KIND[r.eventType].tone}>{CHANGE_KIND[r.eventType].label}</Pill>
        </div>
        <div className='truncate text-[11px] text-muted-foreground'>
          {r.provider}
          {r.serviceTier !== 'standard' && ` · ${r.serviceTier}`} · {effectiveText(r.effectiveFrom)}
        </div>
      </div>
    ),
  },
  { field: 'eventType', header: 'Rates ($ / 1M)', renderCell: (_, r) => <RateChanges c={r} /> },
  {
    field: 'repricedCalls',
    header: 'Calls repriced',
    ...NUM_COL,
    renderCell: v => <Num v={v as number} tone='muted' />,
  },
];

interface SlabForm {
  /** React key only. */
  key: number;
  over: string;
  rates: Record<RateKey, string>;
}

interface FormState {
  provider: string;
  model: string;
  serviceTier: string;
  rates: Record<RateKey, string>;
  slabs: SlabForm[];
  /** YYYY-MM-DD, empty = from the start. */
  effectiveDay: string;
  /** An edited row's exact effectiveFrom, so an unchanged date updates that row. */
  /** effectiveFrom of the row being edited, which keys it. */
  original?: string;
  locked: boolean;
}

const emptyRates = (): Record<RateKey, string> => ({
  inputPerMTok: '',
  outputPerMTok: '',
  cacheReadPerMTok: '',
  cacheWritePerMTok: '',
});

const ratesText = (r: Rates): Record<RateKey, string> => ({
  inputPerMTok: String(Number(r.inputPerMTok)),
  outputPerMTok: String(Number(r.outputPerMTok)),
  cacheReadPerMTok: String(Number(r.cacheReadPerMTok)),
  cacheWritePerMTok: String(Number(r.cacheWritePerMTok)),
});

/** Parses the four rate fields; `where` prefixes the error ("Slab over 100,000: "). */
const parseRates = (
  text: Record<RateKey, string>,
  where = '',
): Record<RateKey, number> | string => {
  const out = {} as Record<RateKey, number>;
  for (const r of RATES) {
    const v = Number(text[r.key]);
    if (text[r.key].trim() === '' || !Number.isFinite(v) || v < 0) {
      return `${where}${r.label} must be a number of dollars, 0 or more.`;
    }
    out[r.key] = v;
  }
  return out;
};

type PriceRow = Record<string, unknown> &
  ModelPrice & {
    status: 'current' | 'scheduled' | 'earlier';
    /** Set on the indented rows that show a price's slabs. */
    slabOver?: number;
  };
type UnpricedRow = Record<string, unknown> & UnpricedModel & { id: string };

const PriceDialog = ({
  form,
  onChange,
  onClose,
}: {
  form: FormState | null;
  onChange: (f: FormState) => void;
  onClose: () => void;
}): ReactElement => {
  const save = useSaveUsagePrice();
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent): Promise<void> => {
    e.preventDefault();
    if (!form) return;
    const provider = form.provider.trim();
    const model = form.model.trim();
    if (!provider || !model) {
      setError('Provider and model are required.');
      return;
    }
    const rates = parseRates(form.rates);
    if (typeof rates === 'string') {
      setError(rates);
      return;
    }
    const slabs: Array<Record<RateKey, number> & { overPromptTokens: number }> = [];
    for (const sl of form.slabs) {
      const over = Number(sl.over);
      if (!Number.isInteger(over) || over < 1) {
        setError('Each slab needs a prompt size: a whole number of tokens, 1 or more.');
        return;
      }
      if (slabs.some(x => x.overPromptTokens === over)) {
        setError(`Two slabs start over ${over.toLocaleString('en-US')} tokens.`);
        return;
      }
      const slabRates = parseRates(sl.rates, `Slab over ${over.toLocaleString('en-US')}: `);
      if (typeof slabRates === 'string') {
        setError(slabRates);
        return;
      }
      slabs.push({ overPromptTokens: over, ...slabRates });
    }
    const effectiveFrom =
      form.original ??
      (form.effectiveDay ? new Date(`${form.effectiveDay}T00:00:00`).toISOString() : undefined);
    setError(null);
    try {
      const res = await save.mutateAsync({
        provider,
        model,
        serviceTier: form.serviceTier.trim() || 'standard',
        ...rates,
        ...(effectiveFrom ? { effectiveFrom } : {}),
        slabs,
      });
      toast.success(`Price saved. ${res.repriced} call${res.repriced === 1 ? '' : 's'} repriced.`);
      onClose();
    } catch (err) {
      setError(clawErrorText(err, 'Could not save the price.'));
    }
  };

  const close = (): void => {
    setError(null);
    onClose();
  };
  const set = (patch: Partial<FormState>): void => {
    if (form) onChange({ ...form, ...patch });
  };
  const setSlab = (key: number, patch: Partial<SlabForm>): void =>
    set({ slabs: (form?.slabs ?? []).map(x => (x.key === key ? { ...x, ...patch } : x)) });

  return (
    <Dialog
      open={form !== null}
      onOpenChange={open => {
        if (!open) close();
      }}
      title={form?.locked ? `Price for ${form.model}` : 'Add a price'}
      className='max-w-lg'
    >
      {form && (
        <form
          onSubmit={e => void submit(e)}
          className='flex max-h-[85vh] flex-col gap-4 overflow-y-auto p-6'
        >
          <div>
            <h2 className='text-base font-semibold text-foreground'>
              {form.locked ? `Price for ${form.model}` : 'Add a price'}
            </h2>
            <p className='mt-1 text-sm text-muted-foreground'>
              US dollars per million tokens. Saving reprices every matching call from the effective
              date on.
            </p>
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <Field label='Provider' required htmlFor='price-provider'>
              <Input
                id='price-provider'
                value={form.provider}
                disabled={form.locked}
                onChange={e => set({ provider: e.target.value })}
                placeholder='anthropic'
                data-track-category={TRACK}
                data-track-name='price-provider'
              />
            </Field>
            <Field label='Model' required htmlFor='price-model'>
              <Input
                id='price-model'
                value={form.model}
                disabled={form.locked}
                onChange={e => set({ model: e.target.value })}
                placeholder='claude-sonnet-4-5'
                data-track-category={TRACK}
                data-track-name='price-model'
              />
            </Field>
            {RATES.map(r => (
              <Field key={r.key} label={`${r.label} ($ / 1M)`} required htmlFor={`price-${r.key}`}>
                <Input
                  id={`price-${r.key}`}
                  type='number'
                  inputMode='decimal'
                  min={0}
                  step='any'
                  value={form.rates[r.key]}
                  onChange={e => set({ rates: { ...form.rates, [r.key]: e.target.value } })}
                  placeholder='0.00'
                  data-track-category={TRACK}
                  data-track-name={`price-${r.key}`}
                />
              </Field>
            ))}
            <Field label='Service tier' htmlFor='price-tier'>
              <Input
                id='price-tier'
                value={form.serviceTier}
                disabled={form.locked}
                onChange={e => set({ serviceTier: e.target.value })}
                placeholder='standard'
                data-track-category={TRACK}
                data-track-name='price-tier'
              />
            </Field>
            <Field label='Effective from' optional htmlFor='price-effective'>
              <Input
                id='price-effective'
                type='date'
                value={form.effectiveDay}
                disabled={!!form.original}
                onChange={e => set({ effectiveDay: e.target.value })}
                data-track-category={TRACK}
                data-track-name='price-effective-from'
              />
            </Field>
          </div>
          <p className='text-xs text-muted-foreground'>
            {form.original
              ? 'To start a new price period on another date, add a price for this model.'
              : 'Leave the date empty to price every call, past and future. A date starts a new price period and keeps earlier calls on the earlier price.'}
          </p>
          <div role='group' aria-label='Prompt-size slabs' className='flex flex-col gap-2'>
            <div className='flex items-center justify-between gap-2'>
              <span className='text-sm font-medium text-foreground'>Prompt-size slabs</span>
              <Button
                type='button'
                variant='outline'
                size='sm'
                onClick={() =>
                  set({
                    slabs: [...form.slabs, { key: Date.now(), over: '', rates: { ...form.rates } }],
                  })
                }
                data-track-category={TRACK}
                data-track-name='price-slab-add'
              >
                <PlusDefault className='size-3.5' aria-hidden />
                Add slab
              </Button>
            </div>
            <p className='text-xs text-muted-foreground'>
              Optional. A request whose prompt (input + cache reads + cache writes) is over a slab’s
              size pays that slab’s rates for all of its tokens, output included. The highest
              matching slab wins.
            </p>
            {form.slabs.map(sl => (
              <div key={sl.key} className='rounded-lg border border-border p-3'>
                <div className='flex items-end gap-2'>
                  <div className='flex-1'>
                    <Field label='Prompts over (tokens)' required htmlFor={`slab-${sl.key}-over`}>
                      <Input
                        id={`slab-${sl.key}-over`}
                        type='number'
                        inputMode='numeric'
                        min={1}
                        step={1}
                        value={sl.over}
                        onChange={e => setSlab(sl.key, { over: e.target.value })}
                        placeholder='100000'
                        data-track-category={TRACK}
                        data-track-name='price-slab-over'
                      />
                    </Field>
                  </div>
                  <Button
                    type='button'
                    variant='ghost'
                    size='iconSm'
                    aria-label='Remove slab'
                    title='Remove slab'
                    onClick={() => set({ slabs: form.slabs.filter(x => x.key !== sl.key) })}
                    data-track-category={TRACK}
                    data-track-name='price-slab-remove'
                  >
                    <DeleteDustbin01 className='size-4' aria-hidden />
                  </Button>
                </div>
                <div className='mt-2 grid grid-cols-2 gap-3'>
                  {RATES.map(r => (
                    <Field
                      key={r.key}
                      label={`${r.label} ($ / 1M)`}
                      required
                      htmlFor={`slab-${sl.key}-${r.key}`}
                    >
                      <Input
                        id={`slab-${sl.key}-${r.key}`}
                        type='number'
                        inputMode='decimal'
                        min={0}
                        step='any'
                        value={sl.rates[r.key]}
                        onChange={e =>
                          setSlab(sl.key, { rates: { ...sl.rates, [r.key]: e.target.value } })
                        }
                        placeholder='0.00'
                        data-track-category={TRACK}
                        data-track-name={`price-slab-${r.key}`}
                      />
                    </Field>
                  ))}
                </div>
              </div>
            ))}
          </div>
          {error && (
            <p role='alert' className='text-sm text-destructive'>
              {error}
            </p>
          )}
          <div className='flex justify-end gap-2'>
            <Button
              type='button'
              variant='outline'
              size='sm'
              onClick={close}
              disabled={save.isPending}
              data-track-category={TRACK}
              data-track-name='price-cancel'
            >
              Cancel
            </Button>
            <Button
              type='submit'
              size='sm'
              loading={save.isPending}
              data-track-category={TRACK}
              data-track-name='price-save'
            >
              Save price
            </Button>
          </div>
        </form>
      )}
    </Dialog>
  );
};

const ControlPanelSettingsScreen = (): ReactElement => {
  const navigate = useNavigate();
  const location = useLocation();
  const prices = useUsagePrices();
  const remove = useDeleteUsagePrice();
  const [form, setForm] = useState<FormState | null>(null);
  const [toDelete, setToDelete] = useState<ModelPrice | null>(null);
  const canEdit = prices.data?.canEdit ?? false;

  const priceRows = useMemo<PriceRow[]>(() => {
    const now = Date.now();
    const seen = new Set<string>();
    return (prices.data?.prices ?? []).flatMap(p => {
      const group = `${p.provider}\u0000${p.model}\u0000${p.serviceTier}`;
      const at = new Date(p.effectiveFrom).getTime();
      let status: PriceRow['status'] = 'earlier';
      if (at > now) status = 'scheduled';
      else if (!seen.has(group)) {
        seen.add(group);
        status = 'current';
      }
      return [
        { ...p, status },
        ...p.slabs.map(sl => ({
          ...p,
          ...ratesText(sl),
          id: `${p.id}:${sl.overPromptTokens}`,
          status,
          slabOver: sl.overPromptTokens,
        })),
      ];
    });
  }, [prices.data]);

  const unpricedRows = useMemo<UnpricedRow[]>(
    () =>
      (prices.data?.unpriced ?? []).map(u => ({
        ...u,
        id: `${u.provider}\u0000${u.model}\u0000${u.serviceTier}\u0000${u.billing}`,
      })),
    [prices.data],
  );

  const openFor = (
    p: Pick<ModelPrice, 'provider' | 'model' | 'serviceTier'>,
    existing?: ModelPrice,
  ): void =>
    setForm({
      provider: p.provider,
      model: p.model,
      serviceTier: p.serviceTier,
      rates: existing ? ratesText(existing) : emptyRates(),
      slabs: (existing?.slabs ?? []).map((sl, i) => ({
        key: i,
        over: String(sl.overPromptTokens),
        rates: ratesText(sl),
      })),
      effectiveDay:
        existing && !isEpoch(existing.effectiveFrom) ? toDay(new Date(existing.effectiveFrom)) : '',
      ...(existing ? { original: existing.effectiveFrom } : {}),
      locked: true,
    });

  const rate = (field: RateKey, header: string): ColumnDef<PriceRow> => ({
    field,
    header,
    sortable: false,
    ...NUM_COL,
    renderCell: v => <Num v={Number(v)} fmt={x => rateFmt.format(x)} />,
  });

  const priceColumns: Array<ColumnDef<PriceRow>> = [
    {
      field: 'model',
      header: 'Model',
      minWidth: '14rem',
      renderCell: (_, r) =>
        r.slabOver !== undefined ? (
          <span className='pl-4 text-xs text-muted-foreground'>
            ↳ Prompts over {r.slabOver.toLocaleString('en-US')} tokens
          </span>
        ) : (
          <div className='min-w-0'>
            <div className='truncate font-medium text-foreground'>{r.model}</div>
            <div className='truncate text-[11px] text-muted-foreground'>
              {r.provider}
              {r.serviceTier !== 'standard' && ` · ${r.serviceTier}`}
            </div>
          </div>
        ),
    },
    ...RATES.map(r => rate(r.key, r.label)),
    {
      field: 'effectiveFrom',
      header: 'Effective from',
      className: 'whitespace-nowrap',
      renderCell: (v, r) =>
        r.slabOver !== undefined ? null : (
          <div className='flex items-center gap-2'>
            <span className={r.status === 'earlier' ? 'text-muted-foreground' : 'text-foreground'}>
              {effectiveText(v as string)}
            </span>
            {r.status !== 'current' && (
              <Badge variant='outline' className='text-muted-foreground'>
                {r.status === 'scheduled' ? 'Scheduled' : 'Earlier'}
              </Badge>
            )}
          </div>
        ),
    },
    ...(canEdit
      ? [
          {
            field: 'id',
            header: '',
            width: '5.5rem',
            renderCell: (_: unknown, r: PriceRow) =>
              r.slabOver !== undefined ? null : (
                <div className='flex justify-end gap-1'>
                  <Button
                    variant='ghost'
                    size='iconSm'
                    aria-label={`Edit price for ${r.model}`}
                    onClick={() => openFor(r, r)}
                    data-track-category={TRACK}
                    data-track-name='price-edit'
                  >
                    <PencilEdit className='size-4' aria-hidden />
                  </Button>
                  <Button
                    variant='ghost'
                    size='iconSm'
                    aria-label={`Delete price for ${r.model}`}
                    onClick={() => setToDelete(r)}
                    data-track-category={TRACK}
                    data-track-name='price-delete'
                  >
                    <DeleteDustbin01 className='size-4' aria-hidden />
                  </Button>
                </div>
              ),
          } satisfies ColumnDef<PriceRow>,
        ]
      : []),
  ];

  const unpricedColumns: Array<ColumnDef<UnpricedRow>> = [
    {
      field: 'model',
      header: 'Model',
      minWidth: '14rem',
      renderCell: (_, r) => (
        <div className='min-w-0'>
          <div className='truncate font-medium text-foreground'>{r.model}</div>
          <div className='truncate text-[11px] text-muted-foreground'>
            {r.provider}
            {r.serviceTier !== 'standard' && ` · ${r.serviceTier}`}
          </div>
        </div>
      ),
    },
    {
      field: 'billing',
      header: 'Billing',
      className: 'whitespace-nowrap',
      renderCell: v => labelFor(BILLING_LABELS, v as string),
    },
    {
      field: 'calls',
      header: 'Calls',
      sortable: true,
      ...NUM_COL,
      renderCell: v => <Num v={v as number} tone='muted' />,
    },
    {
      field: 'totalTokens',
      header: 'Tokens',
      sortable: true,
      ...NUM_COL,
      renderCell: v => <Num v={v as number} tone='lead' />,
    },
    {
      field: 'id',
      header: 'Cost until priced',
      className: 'whitespace-nowrap text-muted-foreground',
      renderCell: (_, r) => (r.billing === 'platform' ? '$0' : 'Not counted'),
    },
    ...(canEdit
      ? [
          {
            field: 'provider',
            header: '',
            width: '7rem',
            renderCell: (_: unknown, r: UnpricedRow) => (
              <div className='flex justify-end'>
                <Button
                  variant='outline'
                  size='sm'
                  onClick={() => openFor(r)}
                  data-track-category={TRACK}
                  data-track-name='price-set-unpriced'
                >
                  Set price
                </Button>
              </div>
            ),
          } satisfies ColumnDef<UnpricedRow>,
        ]
      : []),
  ];

  const back = (): void => {
    if ((location.state as { fromPanel?: boolean } | null)?.fromPanel) void navigate(-1);
    else void navigate('/ai/control-panel');
  };
  const history = prices.data?.history;

  return (
    <div className='mx-auto w-full max-w-7xl px-6 py-8'>
      <PageHeader
        leading={
          <Button
            variant='outline'
            size='icon'
            aria-label='Back to the control panel'
            title='Back to the control panel'
            onClick={back}
            data-track-category={TRACK}
            data-track-name='settings-back'
          >
            <ArrowLeft className='size-4' aria-hidden />
          </Button>
        }
        title='Settings'
        subtitle='Model prices behind the control panel’s cost'
      />
      {prices.isError && !prices.data ? (
        <section className='rounded-xl border border-border bg-card p-5 shadow-xs'>
          <ErrorState what='prices' error={prices.error} onRetry={() => void prices.refetch()} />
        </section>
      ) : (
        <div className='flex flex-col gap-5'>
          {prices.data && !canEdit && (
            <Banner tone='info'>
              Prices apply to every organization, so only claw admins can change them.
            </Banner>
          )}
          {(prices.data === undefined || unpricedRows.length > 0) && (
            <MetricsCard
              title='Models without a price'
              description='API key calls on these models count no cost until they have a price. Platform models count as $0.'
            >
              <Table<UnpricedRow>
                data={unpricedRows}
                columns={unpricedColumns}
                idField='id'
                size='sm'
                sortable
                defaultSort={{ field: 'calls', direction: 'desc' }}
                isLoading={prices.data === undefined}
                skeletonRowCount={3}
              />
            </MetricsCard>
          )}
          <MetricsCard
            title='Prices'
            description='US dollars per million tokens. Changing a price reprices the calls it covers.'
            action={
              canEdit ? (
                <Button
                  size='sm'
                  onClick={() =>
                    setForm({
                      provider: '',
                      model: '',
                      serviceTier: 'standard',
                      rates: emptyRates(),
                      slabs: [],
                      effectiveDay: '',
                      locked: false,
                    })
                  }
                  data-track-category={TRACK}
                  data-track-name='price-add'
                >
                  <PlusDefault className='size-3.5' aria-hidden />
                  Add price
                </Button>
              ) : undefined
            }
          >
            <Table<PriceRow>
              data={priceRows}
              columns={priceColumns}
              idField='id'
              size='sm'
              isLoading={prices.data === undefined}
              emptyState={
                <EmptyState
                  title='No prices yet'
                  detail={
                    canEdit
                      ? 'Add a price so API key calls show a cost.'
                      : 'Until a claw admin adds prices, API key calls show tokens only.'
                  }
                />
              }
            />
          </MetricsCard>

          {history && (
            <MetricsCard
              title='Change history'
              description='Every price added, changed or deleted, and who did it.'
            >
              <Table<ChangeRow>
                data={history as ChangeRow[]}
                columns={HISTORY_COLUMNS}
                idField='id'
                size='sm'
                emptyState={<EmptyState title='No price changes yet' />}
              />
            </MetricsCard>
          )}
        </div>
      )}

      <PriceDialog form={form} onChange={setForm} onClose={() => setForm(null)} />
      <ConfirmDialog
        open={toDelete !== null}
        onOpenChange={open => !open && setToDelete(null)}
        title='Delete this price?'
        description={
          toDelete
            ? `Calls priced by ${toDelete.model} (${toDelete.provider}) are repriced with the remaining price, or count as unpriced if none is left.`
            : undefined
        }
        confirmLabel='Delete price'
        danger
        loading={remove.isPending}
        trackCategory={TRACK}
        onConfirm={() => {
          if (!toDelete) return;
          remove
            .mutateAsync(toDelete.id)
            .then(res => {
              toast.success(
                `Price deleted. ${res.repriced} call${res.repriced === 1 ? '' : 's'} repriced.`,
              );
              setToDelete(null);
            })
            .catch((err: unknown) =>
              toast.error(clawErrorText(err, 'Could not delete the price.')),
            );
        }}
      />
    </div>
  );
};

export default ControlPanelSettingsScreen;
