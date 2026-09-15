import { type ReactElement, useEffect, useState } from 'react';
import { Button } from '@/components/ui/Button/Button';
import { createMcpConnection } from '@/services/claw/clawMcpService';
import type { McpServer } from '@/services/claw/clawMcpTypes';
import { V2Dialog } from '../../shared/primitives/V2Dialog';
import { McpLogo } from '../../shared/pickers/mcp/McpLogo';
import { useMcpCredentialFields } from '../../shared/pickers/mcp/useMcpCredentialFields';

/**
 * Collects a connector's own credentials (url, token, api key, …) and creates
 * the connection.
 *
 * Which inputs to show comes from the /servers/credential-fields registry
 * first, falling back to the connector's own `credentialForm` /
 * `credentialSchema` columns. Reading the columns alone is what broke prod:
 * they are nullable and unset for connectors whose fields live only in code
 * (amplitude, asana, bigquery, bitbucket…), so the dialog said "no details
 * needed" and Connect posted an empty bag the backend then rejected.
 *
 * Values are posted straight to claw-auth and never stored client-side.
 */
interface McpConnectDialogProps {
  server: McpServer;
  iconType: string;
  label: string;
  description?: string;
  userId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onConnected: () => void;
}

export const McpConnectDialog = ({
  server,
  iconType,
  label,
  description,
  userId,
  open,
  onOpenChange,
  onConnected,
}: McpConnectDialogProps): ReactElement => {
  const { fieldsFor, loading: fieldsLoading } = useMcpCredentialFields();
  const fields = fieldsFor(server);
  const [values, setValues] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Reopening after a failure should present a clean form rather than the
  // half-typed values that failed.
  useEffect(() => {
    if (open) {
      setValues({});
      setError(null);
    }
  }, [open]);

  const missingRequired = fields.some(
    field => !field.optional && !(values[field.name] ?? '').trim(),
  );

  const handleSubmit = async (): Promise<void> => {
    if (submitting || fieldsLoading || missingRequired) return;
    setError(null);
    setSubmitting(true);
    try {
      await createMcpConnection(userId, server.id, values);
      onConnected();
      onOpenChange(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not connect. Check the details above.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <V2Dialog
      open={open}
      onOpenChange={onOpenChange}
      title={`Connect ${label}`}
      description='These details are sent to the connector and stored encrypted.'
      testId='mcp-connect-dialog'
      footer={
        <>
          <Button
            variant='ghost'
            onClick={(): void => onOpenChange(false)}
            data-track-category='Claw MCP'
            data-track-name='CancelConnectMcp'
          >
            Cancel
          </Button>
          <Button
            onClick={(): void => void handleSubmit()}
            disabled={submitting || fieldsLoading || missingRequired}
            data-track-category='Claw MCP'
            data-track-name='SubmitConnectMcp'
          >
            {submitting ? 'Connecting…' : 'Connect'}
          </Button>
        </>
      }
    >
      <div className='flex items-center gap-3 rounded-xl border border-border bg-muted/40 p-3'>
        <McpLogo type={iconType} name={label} size='md' />
        <div className='flex min-w-0 flex-col gap-0.5'>
          <span className='truncate text-sm font-semibold leading-5 text-foreground'>{label}</span>
          {description && (
            <span className='line-clamp-2 text-xs leading-4 text-muted-foreground'>
              {description}
            </span>
          )}
        </div>
      </div>

      {fields.length === 0 ? (
        <p className='text-sm text-muted-foreground'>
          {fieldsLoading
            ? 'Checking what this connector needs…'
            : 'This connector needs no details — confirm to connect.'}
        </p>
      ) : (
        fields.map(field => (
          <div key={field.name} className='flex flex-col gap-2'>
            <label
              htmlFor={`mcp-cred-${field.name}`}
              className='text-sm font-medium leading-5 text-foreground'
            >
              {field.label}
              {field.optional && (
                <span className='ml-1 font-normal text-muted-foreground'>(optional)</span>
              )}
            </label>
            <input
              id={`mcp-cred-${field.name}`}
              type={field.type === 'password' ? 'password' : 'text'}
              value={values[field.name] ?? ''}
              placeholder={field.placeholder}
              autoComplete='off'
              onChange={(e): void => setValues(prev => ({ ...prev, [field.name]: e.target.value }))}
              className='h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition-colors placeholder:text-muted-foreground focus:border-primary'
              data-testid={`mcp-cred-${field.name}`}
              data-track-category='Claw MCP'
              data-track-name='EditMcpCredential'
            />
          </div>
        ))
      )}

      {error && <p className='text-sm leading-5 text-destructive'>{error}</p>}
    </V2Dialog>
  );
};
