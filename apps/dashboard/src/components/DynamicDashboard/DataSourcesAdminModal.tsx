import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Loader2,
  RefreshCw,
  Sparkles,
  Table2,
  X,
} from 'lucide-react';
import { ReactElement, useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';
import { useDebouncedValue } from '../../hooks/useDebouncedValue';
import {
  createDataSource,
  discoverDataSourceTables,
  getDataSourceConfig,
  testDataSourceConnection,
} from '../../services/DynamicDashboard/dataSourcesAdminService';
import Input from '../ui/Input';
import { Textarea } from '../ui/Textarea';
import { CaCertificateField } from './CaCertificateField';
import { SOURCE_TYPES, type SourceType } from './dataSources.constants';
import {
  connectionSignature,
  emptyForm,
  extractApiErrorMessage,
  firstNTableKeys,
  selectedIncludedTables,
  tableKey,
  toApiInput,
  type Discovery,
  type FormState,
  type TestResult,
} from './dataSources.utils';

interface DataSourcesAdminModalProps {
  onClose: () => void;
}

interface FormFieldProps {
  label: string;
  required?: boolean;
  className?: string;
  children: ReactElement;
}

const INPUT_CLASS =
  'bg-white text-xyne-gray-900 caret-xyne-gray-900 placeholder:text-xyne-gray-400 selection:bg-xyne-primary-500/20 selection:text-xyne-gray-900';

const FormField = ({ label, required, className, children }: FormFieldProps): ReactElement => (
  <div className={`space-y-1.5 ${className ?? ''}`}>
    <label className='block text-[13px] leading-[18px] font-medium text-xyne-gray-900'>
      {label}
      {required && <span className='text-xyne-red-500 ml-0.5'>*</span>}
    </label>
    {children}
  </div>
);

export const DataSourcesAdminModal = ({ onClose }: DataSourcesAdminModalProps): ReactElement => {
  const queryClient = useQueryClient();

  const [step, setStep] = useState<1 | 2>(1);
  const [form, setForm] = useState<FormState>(() => emptyForm('postgres'));
  const setField = <K extends keyof FormState>(k: K, v: FormState[K]): void =>
    setForm(prev => ({ ...prev, [k]: v }));

  const [testResult, setTestResult] = useState<TestResult>({ kind: 'idle' });
  const [discovery, setDiscovery] = useState<Discovery>({ kind: 'idle' });
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);

  const { data: configResp } = useQuery({
    queryKey: ['dataSources', 'config'],
    queryFn: getDataSourceConfig,
    staleTime: 60 * 60 * 1000,
  });
  const ingestTableLimit = configResp?.ingestTableLimit ?? 0;

  const apiInput = toApiInput(form);

  const debouncedConnSig = useDebouncedValue(connectionSignature(form), 300);
  useEffect(() => {
    setTestResult({ kind: 'idle' });
    setDiscovery({ kind: 'idle' });
    setSelected(new Set());
    setStep(1);
  }, [debouncedConnSig]);

  const invalidateList = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: ['dataSources', 'list'] });
  }, [queryClient]);

  const handleSelectSourceType = useCallback((next: SourceType) => {
    setForm(emptyForm(next));
  }, []);

  const runTestConnection = useCallback(async () => {
    if (!apiInput) return;
    setTestResult({ kind: 'testing' });
    try {
      const result = await testDataSourceConnection({
        sourceType: apiInput.sourceType,
        connectionConfig: apiInput.connectionConfig,
      });
      if (result.ok) {
        setTestResult({
          kind: 'ok',
          ...(result.version !== undefined && { version: result.version }),
        });
      } else {
        setTestResult({ kind: 'fail', error: result.error ?? 'Unknown error' });
      }
    } catch (err) {
      setTestResult({
        kind: 'fail',
        error: extractApiErrorMessage(err, 'Could not test connection'),
      });
    }
  }, [apiInput]);

  const runDiscoverTables = useCallback(async () => {
    if (!apiInput) return;
    setDiscovery({ kind: 'loading' });
    setSelected(new Set());
    try {
      const tables = await discoverDataSourceTables({
        sourceType: apiInput.sourceType,
        connectionConfig: apiInput.connectionConfig,
      });
      setDiscovery({ kind: 'loaded', tables });
    } catch (err) {
      setDiscovery({
        kind: 'fail',
        error: extractApiErrorMessage(err, 'Could not list tables'),
      });
    }
  }, [apiInput]);

  const handleNextFromStep1 = useCallback(() => {
    if (!apiInput || testResult.kind === 'testing') return;
    if (testResult.kind === 'ok') {
      setStep(2);
      void runDiscoverTables();
    } else {
      void runTestConnection();
    }
  }, [apiInput, testResult, runDiscoverTables, runTestConnection]);

  const handlePrevious = useCallback(() => setStep(1), []);

  const toggleTable = useCallback(
    (key: string) => {
      setSelected(prev => {
        const next = new Set(prev);
        if (next.has(key)) {
          next.delete(key);
          return next;
        }
        if (next.size >= ingestTableLimit) {
          toast.error(`You can ingest at most ${ingestTableLimit} tables per source.`);
          return prev;
        }
        next.add(key);
        return next;
      });
    },
    [ingestTableLimit],
  );

  const selectAll = useCallback(() => {
    if (discovery.kind !== 'loaded') return;
    setSelected(new Set(firstNTableKeys(discovery.tables, ingestTableLimit)));
    if (discovery.tables.length > ingestTableLimit) {
      toast.info(
        `Selected the first ${ingestTableLimit} tables — that's the ingest cap. Adjust the selection manually if you need different ones.`,
      );
    }
  }, [discovery, ingestTableLimit]);

  const clearAll = useCallback(() => setSelected(new Set()), []);

  const handleSave = useCallback(async () => {
    if (!apiInput) return;
    if (discovery.kind !== 'loaded' || selected.size === 0) return;
    const includedTables = selectedIncludedTables(discovery.tables, selected);
    setSaving(true);
    try {
      await createDataSource({ ...apiInput, includedTables });
      toast.success(
        `Data source created — ingesting ${includedTables.length} ${includedTables.length === 1 ? 'table' : 'tables'}`,
      );
      invalidateList();
      onClose();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, 'Failed to create data source'));
    } finally {
      setSaving(false);
    }
  }, [apiInput, invalidateList, discovery, selected, onClose]);

  if (step === 1) {
    const canAdvance = !!apiInput && testResult.kind !== 'testing';
    return (
      <div className='w-[min(916px,96vw)] flex flex-col max-h-[88vh] bg-white rounded-xl shadow-[0px_8px_24px_0px_rgba(43,45,47,0.08),0px_0px_4px_0px_rgba(0,0,0,0.14)] overflow-hidden'>
        <div className='px-6 py-4 border-b border-xyne-gray-200 flex items-center justify-between shrink-0'>
          <h2 className='text-[17px] leading-[22px] font-semibold text-xyne-gray-900 tracking-[-0.01em]'>
            Connect your source
          </h2>
          <button
            type='button'
            onClick={onClose}
            data-track-category='DATA_SOURCE'
            data-track-name='Close_Modal_Click'
            className='inline-flex items-center justify-center w-7 h-7 rounded-lg border border-xyne-gray-200 text-xyne-gray-600 hover:bg-xyne-gray-100 transition-colors'
            aria-label='Close'
          >
            <X size={14} />
          </button>
        </div>

        <div className='flex flex-1 min-h-0'>
          <div className='w-[220px] shrink-0 border-r border-xyne-gray-200 bg-xyne-gray-50 p-3 space-y-1 overflow-auto'>
            {SOURCE_TYPES.map(st => {
              const active = form.sourceType === st.id;
              return (
                <button
                  key={st.id}
                  type='button'
                  onClick={() => !st.disabled && handleSelectSourceType(st.id)}
                  disabled={st.disabled}
                  title={st.disabled ? 'Coming soon' : undefined}
                  aria-pressed={active}
                  data-track-category='DATA_SOURCE'
                  data-track-name={`Source_Type_${st.id}_Click`}
                  className={`w-full flex items-center gap-2.5 px-3 h-10 rounded-lg text-[14px] leading-[20px] transition-colors ${
                    active
                      ? 'bg-white border border-xyne-gray-200 shadow-[0px_1px_2px_0px_rgba(0,0,0,0.06)] text-xyne-gray-900 font-semibold'
                      : st.disabled
                        ? 'text-xyne-gray-400 cursor-default font-medium'
                        : 'text-xyne-gray-600 hover:bg-white/60 border border-transparent font-medium'
                  }`}
                >
                  <span className='shrink-0 w-4 h-4 flex items-center justify-center'>
                    {st.icon}
                  </span>
                  {st.label}
                </button>
              );
            })}
          </div>

          <div className='flex-1 min-w-0 overflow-auto p-6 space-y-4'>
            {testResult.kind === 'ok' && (
              <div className='flex items-start gap-3 bg-emerald-50 border border-emerald-200 text-emerald-700 rounded-lg px-4 py-3'>
                <CheckCircle2 size={18} className='mt-0.5 shrink-0' />
                <div className='min-w-0'>
                  <div className='font-semibold text-[14px] leading-5 text-emerald-800'>
                    Connection Successful
                  </div>
                  {testResult.version && (
                    <div className='text-emerald-700/90 mt-0.5 text-[13px] leading-[18px] truncate'>
                      {testResult.version.slice(0, 140)}
                    </div>
                  )}
                </div>
              </div>
            )}
            {testResult.kind === 'fail' && (
              <div className='flex items-start gap-3 bg-rose-50 border border-rose-200 text-rose-700 rounded-lg px-4 py-3'>
                <AlertTriangle size={18} className='mt-0.5 shrink-0' />
                <div className='min-w-0'>
                  <div className='font-semibold text-[14px] leading-5 text-rose-800'>
                    Connection failed
                  </div>
                  <div className='text-rose-700/90 mt-0.5 text-[13px] leading-[18px]'>
                    {testResult.error}
                  </div>
                </div>
              </div>
            )}

            <FormField label='Display name' required>
              <Input
                value={form.name}
                onChange={e => setField('name', e.target.value)}
                placeholder='Enter your source name'
                className={INPUT_CLASS}
              />
            </FormField>

            <FormField label='Description'>
              <Textarea
                value={form.description}
                onChange={e => setField('description', e.target.value)}
                rows={3}
                placeholder='Enter your descriptions'
                className={INPUT_CLASS}
              />
            </FormField>

            <div className='grid grid-cols-2 gap-4'>
              <FormField label='Host' required>
                <Input
                  value={form.host}
                  onChange={e => setField('host', e.target.value)}
                  placeholder='Enter host name'
                  className={INPUT_CLASS}
                />
              </FormField>
              <FormField label='Port' required>
                <Input
                  type='number'
                  min={1}
                  max={65535}
                  value={form.port}
                  onChange={e => setField('port', e.target.value)}
                  placeholder='Enter port number'
                  className={INPUT_CLASS}
                />
              </FormField>
            </div>

            <div className='grid grid-cols-2 gap-4'>
              <FormField label='User' required>
                <Input
                  value={form.user}
                  onChange={e => setField('user', e.target.value)}
                  placeholder='Enter username'
                  className={INPUT_CLASS}
                  name='ds-conn-user'
                  autoComplete='new-password'
                  data-1p-ignore='true'
                  data-lpignore='true'
                />
              </FormField>
              <FormField label='Password' required>
                <Input
                  type='text'
                  value={form.password}
                  onChange={e => setField('password', e.target.value)}
                  placeholder='Enter password'
                  className={INPUT_CLASS}
                  style={{ WebkitTextSecurity: 'disc' } as React.CSSProperties}
                  name='ds-conn-secret'
                  autoComplete='new-password'
                  data-1p-ignore='true'
                  data-lpignore='true'
                />
              </FormField>
            </div>

            <FormField label='Database' required>
              <Input
                value={form.database}
                onChange={e => setField('database', e.target.value)}
                placeholder='Enter database'
                className={INPUT_CLASS}
              />
            </FormField>

            <label className='inline-flex items-center gap-2.5 text-[14px] leading-[20px] text-xyne-gray-900 cursor-pointer select-none'>
              <input
                type='checkbox'
                checked={form.ssl}
                onChange={e => setField('ssl', e.target.checked)}
                data-track-category='DATA_SOURCE'
                data-track-name='Ssl_Toggle_Change'
                className='sr-only peer'
              />
              <span
                className={`flex items-center justify-center w-[18px] h-[18px] rounded-[5px] shrink-0 border transition-colors ${
                  form.ssl
                    ? 'bg-xyne-primary-500 border-xyne-primary-500'
                    : 'bg-white border-xyne-gray-200 peer-focus-visible:border-xyne-primary-500'
                }`}
                aria-hidden
              >
                {form.ssl && <Check size={12} className='text-white' strokeWidth={3} />}
              </span>
              Use SSL (Recommended for production)
            </label>

            {form.ssl && <CaCertificateField value={form.ca} onChange={ca => setField('ca', ca)} />}
          </div>
        </div>

        <div className='px-6 py-4 border-t border-xyne-gray-200 flex items-center justify-end shrink-0'>
          <button
            type='button'
            onClick={handleNextFromStep1}
            disabled={!canAdvance}
            data-track-category='DATA_SOURCE'
            data-track-name={
              testResult.kind === 'ok' ? 'Wizard_Advance_Step_2' : 'Wizard_Test_Connection'
            }
            className={`inline-flex items-center gap-1.5 h-9 px-5 rounded-lg text-[13px] leading-[18px] font-medium text-white transition-colors ${
              canAdvance
                ? 'bg-xyne-primary-500 hover:bg-xyne-primary-600'
                : 'bg-xyne-primary-200 cursor-not-allowed'
            }`}
          >
            {testResult.kind === 'testing' ? (
              <>
                <Loader2 size={14} className='animate-spin' />
                Testing…
              </>
            ) : (
              'Next'
            )}
          </button>
        </div>
      </div>
    );
  }

  const tablesLoaded = discovery.kind === 'loaded';
  const tables = tablesLoaded ? discovery.tables : [];
  const canSave = !!apiInput && !saving && tablesLoaded && selected.size > 0;
  return (
    <div className='w-[min(916px,96vw)] flex flex-col max-h-[88vh] bg-white rounded-xl shadow-[0px_8px_24px_0px_rgba(43,45,47,0.08),0px_0px_4px_0px_rgba(0,0,0,0.14)] overflow-hidden'>
      <div className='px-6 py-4 border-b border-xyne-gray-200 flex items-center justify-between shrink-0'>
        <h3 className='text-[17px] leading-[22px] font-semibold text-xyne-gray-900 tracking-[-0.01em]'>
          Select tables to integrate
        </h3>
        <button
          type='button'
          onClick={onClose}
          data-track-category='DATA_SOURCE'
          data-track-name='Close_Modal_Click'
          className='inline-flex items-center justify-center w-7 h-7 rounded-lg border border-xyne-gray-200 text-xyne-gray-600 hover:bg-xyne-gray-100 transition-colors'
          aria-label='Close'
        >
          <X size={14} />
        </button>
      </div>

      <div className='flex-1 min-h-0 overflow-auto p-6'>
        {discovery.kind === 'loading' && (
          <div className='flex items-center justify-center gap-2 text-xs text-xyne-gray-500 py-12'>
            <Loader2 size={14} className='animate-spin' />
            Listing tables…
          </div>
        )}
        {discovery.kind === 'fail' && (
          <div className='flex items-start gap-2 text-xs bg-rose-50 border border-rose-200 text-rose-700 rounded-lg p-3'>
            <AlertTriangle size={14} className='mt-0.5 shrink-0' />
            <div className='flex-1 min-w-0'>
              <div className='font-medium'>Couldn’t list tables.</div>
              <div className='text-rose-700/80 mt-0.5 text-[11px]'>{discovery.error}</div>
            </div>
            <button
              type='button'
              onClick={() => {
                void runDiscoverTables();
              }}
              className='inline-flex items-center gap-1 h-7 px-2 rounded-md border border-rose-300 bg-white text-rose-700 text-[11px] font-medium hover:bg-rose-100 transition-colors shrink-0'
              data-track-category='DATA_SOURCE'
              data-track-name='Discovery_Retry'
            >
              <RefreshCw size={11} />
              Retry
            </button>
          </div>
        )}
        {tablesLoaded && (
          <div className='flex flex-col gap-4'>
            <div className='flex items-center justify-between'>
              <div className='text-[16px] leading-[18px] text-xyne-gray-900'>
                {selected.size} of {tables.length} Selected
                {tables.length > ingestTableLimit && (
                  <span className='ml-2 text-[13px] text-xyne-gray-500'>
                    (max {ingestTableLimit})
                  </span>
                )}
              </div>
              <div className='flex items-center gap-2'>
                <button
                  type='button'
                  onClick={selectAll}
                  disabled={tables.length === 0}
                  data-track-category='DATA_SOURCE'
                  data-track-name='Wizard_Tables_Select_All'
                  className='inline-flex items-center h-9 px-5 rounded-lg border border-xyne-gray-200 bg-white text-[13px] leading-[18px] font-medium text-xyne-gray-900 hover:bg-xyne-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                >
                  Select all
                </button>
                <button
                  type='button'
                  onClick={clearAll}
                  disabled={selected.size === 0}
                  data-track-category='DATA_SOURCE'
                  data-track-name='Wizard_Tables_Clear'
                  className='inline-flex items-center h-9 px-5 rounded-lg border border-xyne-gray-200 bg-white text-[13px] leading-[18px] font-medium text-xyne-gray-900 hover:bg-xyne-gray-50 disabled:opacity-50 disabled:cursor-not-allowed transition-colors'
                >
                  Clear
                </button>
              </div>
            </div>

            {tables.length === 0 ? (
              <div className='border border-xyne-gray-150 rounded-lg px-6 py-12 text-xs text-xyne-gray-500 text-center'>
                No tables found on this connection.
              </div>
            ) : (
              <ul className='border border-xyne-gray-150 rounded-lg overflow-hidden bg-white'>
                {tables.map((t, idx) => {
                  const key = tableKey(t.schemaName, t.tableName);
                  const checked = selected.has(key);
                  const isLast = idx === tables.length - 1;
                  const atCap = selected.size >= ingestTableLimit;
                  const disabled = atCap && !checked;
                  return (
                    <li key={key} className={isLast ? '' : 'border-b border-xyne-gray-150'}>
                      <label
                        className={`flex items-center h-14 px-4 transition-colors ${
                          disabled
                            ? 'cursor-not-allowed opacity-50'
                            : 'cursor-pointer hover:bg-xyne-gray-25'
                        }`}
                        title={
                          disabled
                            ? `Cap reached: at most ${ingestTableLimit} tables per source.`
                            : undefined
                        }
                      >
                        <span className='w-8 shrink-0 flex items-center'>
                          <input
                            type='checkbox'
                            checked={checked}
                            disabled={disabled}
                            onChange={() => toggleTable(key)}
                            data-track-category='DATA_SOURCE'
                            data-track-name='Wizard_Tables_Toggle'
                            className='sr-only peer'
                          />
                          <span
                            className={`flex items-center justify-center w-[18px] h-[18px] rounded-[5px] shrink-0 border transition-colors ${
                              checked
                                ? 'bg-xyne-primary-500 border-xyne-primary-500'
                                : 'bg-white border-xyne-gray-200 peer-focus-visible:border-xyne-primary-500'
                            }`}
                            aria-hidden
                          >
                            {checked && <Check size={12} className='text-white' strokeWidth={3} />}
                          </span>
                        </span>
                        <Table2 size={16} className='text-xyne-gray-400 shrink-0 mr-2' />
                        <span className='text-[14px] leading-[18px] text-xyne-gray-900 truncate flex-1'>
                          {t.schemaName}.{t.tableName}
                        </span>
                        {t.rowCountEstimate !== null && t.rowCountEstimate !== undefined && (
                          <span className='ml-4 text-[13px] text-xyne-gray-400 shrink-0'>
                            ~{Number(t.rowCountEstimate).toLocaleString()} rows
                          </span>
                        )}
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}
      </div>

      <div className='px-6 py-4 border-t border-xyne-gray-200 flex items-center justify-between shrink-0'>
        <button
          type='button'
          onClick={handlePrevious}
          data-track-category='DATA_SOURCE'
          data-track-name='Wizard_Back_Step_1'
          className='inline-flex items-center h-9 px-5 rounded-lg border border-xyne-gray-200 bg-white text-[13px] leading-[18px] font-medium text-xyne-gray-900 hover:bg-xyne-gray-50 transition-colors'
        >
          Previous
        </button>
        <button
          type='button'
          onClick={() => void handleSave()}
          disabled={!canSave}
          data-track-category='DATA_SOURCE'
          data-track-name='Wizard_Save_Ingest'
          className={`inline-flex items-center gap-1.5 h-9 px-5 rounded-lg text-[13px] leading-[18px] font-medium text-white transition-colors ${
            canSave
              ? 'bg-xyne-primary-500 hover:bg-xyne-primary-600'
              : 'bg-xyne-primary-200 cursor-not-allowed'
          }`}
        >
          {saving ? (
            <>
              <Sparkles size={14} className='animate-pulse' />
              Ingesting
            </>
          ) : (
            'Save & Ingest'
          )}
        </button>
      </div>
    </div>
  );
};

export default DataSourcesAdminModal;
