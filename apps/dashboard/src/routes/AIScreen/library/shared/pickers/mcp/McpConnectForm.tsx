import { useState, type FormEvent, type ReactElement } from 'react';
import { Loader2 } from 'lucide-react';
import { cn } from '@/utils/classNames';
import type { CredentialField } from '@/services/claw/clawMcpTypes';

interface McpConnectFormProps {
  fields: readonly CredentialField[];
  isPending: boolean;
  error: string | null;
  onCancel: () => void;
  onSubmit: (credentials: Record<string, string>) => void;
}

export function McpConnectForm({
  fields,
  isPending,
  error,
  onCancel,
  onSubmit,
}: McpConnectFormProps): ReactElement {
  const [values, setValues] = useState<Record<string, string>>({});

  const missingRequired = fields.some(field => !field.optional && !values[field.name]?.trim());

  const submit = (event: FormEvent<HTMLFormElement>): void => {
    event.preventDefault();
    if (missingRequired || isPending) return;
    const credentials: Record<string, string> = {};
    for (const field of fields) {
      const value = values[field.name]?.trim();
      if (value) credentials[field.name] = value;
    }
    onSubmit(credentials);
  };

  return (
    <form onSubmit={submit} className='flex w-full flex-col gap-2'>
      {fields.map(field => (
        <div key={field.name} className='flex w-full flex-col gap-2'>
          <label
            htmlFor={`mcp-cred-${field.name}`}
            className='text-xs leading-4 tracking-[-0.24px] text-muted-foreground'
          >
            {field.label || field.name}
            {field.optional && <span className='ml-1'>(optional)</span>}
          </label>
          <input
            id={`mcp-cred-${field.name}`}
            type={field.type === 'password' ? 'password' : 'text'}
            value={values[field.name] ?? ''}
            onChange={event => setValues(prev => ({ ...prev, [field.name]: event.target.value }))}
            placeholder={field.placeholder}
            autoComplete='off'
            data-track-category='Claw Agents'
            data-track-name='Create agent v2: MCP credential input'
            className='h-10 w-full rounded-[10px] border border-border bg-card p-3 text-sm leading-5 text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring'
          />
        </div>
      ))}

      {error && <p className='text-xs leading-4 text-destructive'>{error}</p>}

      <div className='flex w-full items-center justify-end gap-1.5'>
        <button
          type='button'
          onClick={onCancel}
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: cancel MCP connect'
          className='flex h-7 items-center justify-center rounded-lg bg-card px-2 py-1.5 text-sm font-medium leading-5 text-foreground transition-colors hover:bg-muted'
        >
          Cancel
        </button>
        <button
          type='submit'
          disabled={missingRequired || isPending}
          data-track-category='Claw Agents'
          data-track-name='Create agent v2: submit MCP connect'
          className={cn(
            'flex h-7 items-center justify-center gap-1.5 rounded-lg bg-foreground/[0.06] px-2 py-1.5 text-sm font-medium leading-5 text-foreground transition-colors hover:bg-foreground/[0.09]',
            (missingRequired || isPending) && 'cursor-not-allowed opacity-50',
          )}
        >
          {isPending && <Loader2 className='size-3.5 animate-spin' aria-hidden />}
          Connect
        </button>
      </div>
    </form>
  );
}
