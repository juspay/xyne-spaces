import { useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { toast } from 'sonner';
import { AutomationIdContext } from '../AutomationIdContext';
import { Button } from '../../../ui/Button/Button';
import { SchemaForm } from '../SchemaForm/SchemaForm';
import { resolveSchema } from '../SchemaForm/SchemaForm.utils';
import { ReferenceChip, UseVariableButton } from '../SchemaForm/VariableFieldParts';
import { FileAttachmentsField } from './FileAttachmentsField';
import {
  personalEmailService,
  type PersonalEmailStatus,
} from '@/services/Automation/personalEmailService';
import { recordingEmailService } from '@/services/Recording/recordingEmailService';
import type { AutomationTemplateAttachment } from '../../../../api/automationsApi';
import type { VariablePickerSource } from '../VariablePicker/VariablePicker.types';
import type { JsonSchema, ValidationIssue } from '../../Automation.types';

/** Rendered below by hand, so SchemaForm must not also draw them generically. */
const CUSTOM_FIELDS = ['attachments', 'triggerAttachments'] as const;

interface SendEmailToUserStepFormProps {
  schema: JsonSchema;
  stepId: string;
  value: Record<string, unknown>;
  onChange: (next: Record<string, unknown>) => void;
  issues: ValidationIssue[] | null;
  pathPrefix: string;
  variableSources: VariablePickerSource[];
  readOnly?: boolean;
}

export function SendEmailToUserStepForm({
  schema,
  stepId,
  value,
  onChange,
  issues,
  pathPrefix,
  variableSources,
  readOnly = false,
}: SendEmailToUserStepFormProps): React.ReactElement {
  const genericSchema = useMemo(() => {
    const resolved = resolveSchema(schema);
    if (!resolved.properties) return resolved;
    const properties = { ...resolved.properties };
    CUSTOM_FIELDS.forEach(key => delete properties[key]);
    return { ...resolved, properties };
  }, [schema]);

  // pathPrefix already ends in a dot, so the key is appended bare. Prefix rather
  // than equality because config-validator emits an element issue as
  // `<prefix>attachments.0.mimetype`, which no exact match would find.
  const issueFor = (key: string): string | undefined => {
    const base = `${pathPrefix}${key}`;
    return (issues ?? []).find(issue => issue.path === base || issue.path.startsWith(`${base}.`))
      ?.message;
  };

  const setField = (key: string, next: unknown): void => onChange({ ...value, [key]: next });

  const triggerRef =
    typeof value['triggerAttachments'] === 'string' ? value['triggerAttachments'] : '';

  return (
    <div className='flex flex-col gap-4'>
      <SchemaForm
        schema={genericSchema}
        value={value}
        onChange={onChange}
        issues={issues}
        pathPrefix={pathPrefix}
        variableSources={variableSources}
      />
      {value['sendAs'] === 'PERSONAL' ? <PersonalMailboxNotice /> : null}

      <FieldRow
        label='Files'
        error={issueFor('attachments')}
        description='Sent exactly as uploaded. Only .txt, .md and .html files have their variables resolved first.'
      >
        <FileAttachmentsField
          stepId={stepId}
          value={
            Array.isArray(value['attachments'])
              ? (value['attachments'] as AutomationTemplateAttachment[])
              : []
          }
          onChange={next => setField('attachments', next)}
          readOnly={readOnly}
        />
      </FieldRow>

      <FieldRow
        label='Files from the trigger'
        error={issueFor('triggerAttachments')}
        description='Forward the files the triggering email carried, e.g. the email attachments variable.'
      >
        {triggerRef ? (
          <ReferenceChip
            value={triggerRef}
            sources={variableSources}
            onClear={() => setField('triggerAttachments', undefined)}
          />
        ) : (
          <UseVariableButton
            sources={variableSources}
            onPick={reference => setField('triggerAttachments', reference)}
            // Only an array can resolve to a file list; without this the picker
            // offers strings that would fail at run time instead of at pick time.
            targetLeafType='array'
          />
        )}
      </FieldRow>
    </div>
  );
}

function FieldRow({
  label,
  description,
  error,
  children,
}: {
  label: string;
  description?: string;
  error?: string | undefined;
  children: React.ReactNode;
}): React.ReactElement {
  return (
    <div className='flex flex-col gap-1.5'>
      <div className='flex items-baseline gap-2'>
        <label className='text-sm font-medium text-foreground'>{label}</label>
        {description && <span className='text-[11px] text-muted-foreground'>{description}</span>}
      </div>
      {children}
      {error && <span className='text-[11px] text-red-600'>{error}</span>}
    </div>
  );
}

/**
 * Nothing in the config reveals whether the author has connected their mailbox,
 * so without this prompt a PERSONAL step saves fine and fails on its first run.
 */
function PersonalMailboxNotice(): React.ReactElement {
  const [status, setStatus] = useState<PersonalEmailStatus | null>(null);
  const [isConnecting, setIsConnecting] = useState(false);
  // Undefined until first save, where the creator is the author.
  const automationId = useContext(AutomationIdContext);

  useEffect(() => {
    let cancelled = false;
    const load = (): void => {
      personalEmailService
        .getStatus(automationId)
        .then(next => {
          if (!cancelled) setStatus(next);
        })
        .catch(() => undefined);
    };
    load();
    // Electron sends consent to the system browser while this stays mounted, so
    // without this the notice would sit on "not connected" with no way to recheck.
    window.addEventListener('focus', load);
    return () => {
      cancelled = true;
      window.removeEventListener('focus', load);
    };
  }, [automationId]);

  const handleConnect = useCallback(async (): Promise<void> => {
    setIsConnecting(true);
    try {
      const currentPath = `${window.location.pathname}${window.location.search}`;
      const returnPath =
        currentPath.startsWith('/') && !currentPath.startsWith('//') ? currentPath : '/automations';
      // Electron must hand the consent screen to the system browser, and the
      // backend needs to know so the callback returns through /launch instead of
      // stranding the user on the web app. Mirrors the recording composer.
      const isElectron = typeof window.electronAPI?.openExternal === 'function';
      const authUrl = await recordingEmailService.connectGoogle(
        returnPath,
        isElectron ? 'electron' : 'web',
      );
      // Never navigate this tab away: the builder holds the whole automation in
      // component state with no draft persistence, so leaving would discard every
      // unsaved edit — including the sendAs choice that raised this prompt.
      if (isElectron) {
        window.electronAPI?.openExternal(authUrl);
      } else {
        window.open(authUrl, '_blank', 'noopener');
      }
      setIsConnecting(false);
    } catch (error) {
      const message =
        (error as { response?: { data?: { error?: string } } })?.response?.data?.error ||
        (error instanceof Error ? error.message : 'Unable to start Google email connection');
      toast.error(message);
      setIsConnecting(false);
    }
  }, []);

  // A failed status call leaves this unknown; showing "not connected" then would
  // nag a connected author forever and send them through a pointless consent.
  if (!status) return <></>;

  return (
    <div
      className={`rounded-md border px-3 py-2 text-[12px] ${
        status.connected
          ? 'border-emerald-200 bg-emerald-50 text-emerald-800 dark:border-emerald-900/60 dark:bg-emerald-950/30 dark:text-emerald-200'
          : 'border-amber-200 bg-amber-50 text-amber-800 dark:border-amber-900/60 dark:bg-amber-950/30 dark:text-amber-200'
      }`}
    >
      <div className='flex flex-wrap items-center gap-x-3 gap-y-2'>
        <span>
          {status.connected
            ? `Sending as ${status.email ?? "the automation owner's Google account"}${
                status.isOwner ? '.' : ' — the automation owner.'
              }`
            : status.isOwner
              ? 'Connect your Google account so this step can send from your own address.'
              : `The owner (${status.email ?? 'unknown'}) has to reconnect their Google account before this can send.`}
        </span>
        {/* Only the owner can grant consent, and only their grant is ever used.
            Offered even when connected: a revoked grant is fixed by reconnecting. */}
        {status.isOwner ? (
          <Button
            type='button'
            size='sm'
            variant='secondary'
            onClick={() => void handleConnect()}
            disabled={isConnecting}
            loading={isConnecting}
          >
            {status.connected ? 'Reconnect' : 'Connect Google account'}
          </Button>
        ) : null}
      </div>
    </div>
  );
}
