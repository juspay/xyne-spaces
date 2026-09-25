import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react';
import { toast } from 'sonner';
import { Button } from '../../ui/Button/Button';
import { WebhookStepForm } from '../../Automation/AutomationBuilder/StepCard/WebhookStepForm';
import { appsService } from '../../../services/Apps/appsService';
import { cn } from '../../../utils/classNames';
import { AppFetchMapping } from './AppFetchMapping';
import { AppFetchTestResult } from './AppFetchTestResult';
import type {
  AppFetchConfig,
  AppFetchFormValue,
  AppFetchSectionProps,
  FetchConfigTestResult,
} from './AppFetchSection.types';
import {
  EMPTY_FETCH_FORM,
  FETCH_METHODS,
  buildFetchVariableSources,
  configToFormValue,
  formError,
  isBlankForm,
  readPagination,
  readValidationIssues,
} from './AppFetchSection.utils';

/**
 * Configures how Xyne pulls ticket history from this app.
 *
 * The form itself is the automations TRIGGER_WEBHOOK step form, reused verbatim:
 * the stored config has the same shape, so the method/URL/auth/headers/body
 * controls and the `(x)` variable picker all work unchanged — only the variables
 * offered differ, and those are a prop. What lives here is the surrounding
 * load / save / test / clear behaviour, which a step inside an automation does
 * not need.
 *
 * One configuration covers every desk channel this app is connected to: the app
 * receives `{{channel.id}}` and branches on it, rather than Xyne holding a
 * separate config per channel.
 */
export const AppFetchSection = ({
  installedAppId,
  readOnly = false,
}: AppFetchSectionProps): ReactElement => {
  const [value, setValue] = useState<AppFetchFormValue>(() => ({ ...EMPTY_FETCH_FORM }));
  /** Server state at load, so "unsaved changes" is measured against it. */
  const [baseline, setBaseline] = useState<string>('');
  const [configured, setConfigured] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<FetchConfigTestResult | null>(null);
  /** A stored config the server could not parse. Still removable — see canSave. */
  const [invalid, setInvalid] = useState(false);
  /** Server-side validation messages from the last rejected save. */
  const [saveIssues, setSaveIssues] = useState<string[]>([]);
  /**
   * Bumped to remount WebhookStepForm. It seeds its header rows and auth state
   * from `value` once and never resyncs, so after Clear it would still show the
   * old rows and re-commit them on the next keystroke.
   */
  const [formKey, setFormKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const load = async (): Promise<void> => {
      try {
        const response = await appsService.getFetchConfig(installedAppId);
        if (cancelled) return;
        const next = configToFormValue(response.config);
        setValue(next);
        setBaseline(JSON.stringify(next));
        setConfigured(response.configured && !response.invalid);
        setInvalid(Boolean(response.invalid));
        setFormKey(k => k + 1);
        if (response.invalid) {
          toast.error('Stored fetch configuration could not be read', {
            description: response.error ?? 'Re-save it to repair it.',
          });
        }
      } catch {
        if (!cancelled) toast.error('Could not load the fetch configuration');
      } finally {
        if (!cancelled) setLoaded(true);
      }
    };
    void load();
    return (): void => {
      cancelled = true;
    };
  }, [installedAppId]);

  const error = useMemo(() => formError(value), [value]);
  // Rebuilt when the pagination mode changes, so the picker only ever offers
  // variables that actually carry a value in the selected mode.
  const variableSources = useMemo(() => buildFetchVariableSources(readPagination(value)), [value]);
  const blank = useMemo(() => isBlankForm(value), [value]);
  const dirty = loaded && JSON.stringify(value) !== baseline;
  /**
   * Saving a blank form removes the stored config. `invalid` counts as stored:
   * the server could not parse it, so the form opens blank and never becomes
   * dirty, which previously left the install unfixable and unremovable.
   */
  const willRemove = blank && (configured || invalid);
  const canSave = (dirty || invalid) && (willRemove || !error);

  const handleChange = useCallback((next: AppFetchFormValue): void => {
    setValue(next);
    // A result describes a request built from the old config; keeping it on
    // screen next to edited fields would misreport what the app answered.
    setTestResult(null);
  }, []);

  /**
   * Commits the form. An emptied form removes the stored config — the only way a
   * removal reaches the server, so closing without saving discards it like any
   * other edit.
   */
  const handleSave = useCallback(async (): Promise<void> => {
    setSaving(true);
    setSaveIssues([]);
    try {
      if (willRemove) {
        await appsService.deleteFetchConfig(installedAppId);
        setConfigured(false);
        setTestResult(null);
        toast.success('Fetch configuration removed');
      } else {
        await appsService.saveFetchConfig(installedAppId, value as unknown as AppFetchConfig);
        setConfigured(true);
        toast.success('Fetch configuration saved');
      }
      setInvalid(false);
      setBaseline(JSON.stringify(value));
    } catch (err) {
      // The server names the offending field; without this the rules it
      // enforces (a missing {{fetch.startDate}}, a reserved header) surface as
      // a bare "Invalid fetch configuration" with nothing to act on.
      const issues = readValidationIssues(err);
      setSaveIssues(issues);
      toast.error(
        willRemove
          ? 'Could not remove the fetch configuration'
          : 'Could not save the fetch configuration',
        {
          description:
            issues.length > 0 ? issues.join(' · ') : err instanceof Error ? err.message : undefined,
        },
      );
    } finally {
      setSaving(false);
    }
  }, [willRemove, value, installedAppId]);

  const handleTest = useCallback(async (): Promise<void> => {
    setTesting(true);
    setTestResult(null);
    try {
      // The unsaved form is sent, so a config can be proven before it is stored.
      setTestResult(
        await appsService.testFetchConfig(installedAppId, {
          config: value as unknown as AppFetchConfig,
        }),
      );
    } catch (err) {
      toast.error('Could not run the test fetch', {
        description: err instanceof Error ? err.message : undefined,
      });
    } finally {
      setTesting(false);
    }
  }, [value, installedAppId]);

  /**
   * Empties the form only. Nothing is removed server-side until Save, so this is
   * undone by closing the dialog — the same as any other unsaved edit.
   */
  const handleClear = useCallback((): void => {
    setValue({ ...EMPTY_FETCH_FORM });
    setTestResult(null);
    setSaveIssues([]);
    setFormKey(k => k + 1);
  }, []);

  if (!loaded) {
    return <p className='text-xs text-muted-foreground'>Loading…</p>;
  }

  return (
    <div className='flex flex-col gap-3'>
      <div className='flex items-center justify-between gap-2 flex-wrap'>
        <h3 className='text-sm font-medium'>History fetch</h3>
        <span className='text-xs text-muted-foreground'>
          {configured ? 'Configured' : 'Not configured'}
        </span>
      </div>

      <p className='text-[11px] leading-snug text-muted-foreground bg-muted/40 border border-border rounded-md px-2.5 py-2'>
        How Xyne pulls past tickets from this app when someone fetches history on a desk channel.
        One configuration covers every channel this app is connected to send{' '}
        <code className='font-mono'>{'{{channel.id}}'}</code> in the body and branch on it. Xyne
        also signs every request with the app&apos;s signing secret, so authentication here is only
        needed if the endpoint sits behind something else.
      </p>

      {/*
        The shared step form only ever applied `readOnly` to its response-shape
        editor, which this screen hides — so a READ-only user could edit the URL,
        headers and body. A disabled fieldset gates every control inside it
        natively, without changing the form for automations.
      */}
      <fieldset disabled={readOnly} className='contents'>
        <WebhookStepForm
          key={formKey}
          value={value}
          onChange={handleChange}
          issues={null}
          pathPrefix='fetchConfig'
          variableSources={variableSources}
          readOnly={readOnly}
          // The export response contract is fixed and nothing reads it downstream,
          // so there is no shape for an admin to declare.
          showResponseSchema={false}
          methods={FETCH_METHODS}
        />

        <AppFetchMapping value={value} onChange={handleChange} readOnly={readOnly} />
      </fieldset>

      {saveIssues.length > 0 && (
        <ul className='flex flex-col gap-0.5 rounded-md border border-destructive/40 bg-destructive/5 px-2.5 py-2'>
          {saveIssues.map(issue => (
            <li key={issue} className='text-[11px] text-destructive'>
              {issue}
            </li>
          ))}
        </ul>
      )}

      {error && !blank ? <span className='text-[11px] text-destructive'>{error}</span> : null}

      {testResult ? <AppFetchTestResult result={testResult} /> : null}

      {!readOnly && (
        <div className='flex items-center justify-between gap-2 flex-wrap'>
          <Button
            type='button'
            size='sm'
            variant='ghost'
            className='h-7 text-xs'
            onClick={handleClear}
            disabled={saving || (blank && !invalid)}
          >
            Clear
          </Button>
          <div className='flex items-center gap-2'>
            {(dirty || invalid) && (
              <span className='text-[11px] text-destructive'>
                {invalid && blank
                  ? 'Stored configuration is unreadable — Remove it, then set it up again'
                  : willRemove
                    ? 'Save to remove the configuration'
                    : 'Unsaved changes'}
              </span>
            )}
            <Button
              type='button'
              size='sm'
              variant='outline'
              className='h-7 text-xs'
              onClick={() => void handleTest()}
              disabled={testing || Boolean(error)}
              data-track-category='Apps'
              data-track-name='TestAppFetchConfig'
            >
              {testing ? 'Testing…' : 'Test fetch'}
            </Button>
            <Button
              type='button'
              size='sm'
              variant='outline'
              className={cn('h-7 text-xs', willRemove && 'text-destructive')}
              onClick={() => void handleSave()}
              disabled={saving || !canSave}
              data-track-category='Apps'
              data-track-name='SaveAppFetchConfig'
            >
              {saving ? 'Saving…' : willRemove ? 'Remove' : 'Save'}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
};
