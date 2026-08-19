import React, { useMemo, useState } from 'react';
import { KeyRound } from 'lucide-react';
import type { FlowComponent } from '@xyne/shared';
import { McpServerIcon } from '../../ClawAgents/McpServerIcon';
import type { McpServer } from '@/services/claw/clawMcpTypes';
import { cn } from '../../../utils/classNames';
import { useFlow } from '../FlowContext';

interface McpConfigureNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

type CredentialField = {
  name: string;
  label: string;
  type: 'text' | 'password';
  placeholder?: string;
  optional?: boolean;
};

type McpConfigureProps = {
  serverType: string;
  serverName: string;
  mcpServerId: string;
  reason?: string;
  fields: CredentialField[];
};

const isMcpConfigureProps = (value: unknown): value is McpConfigureProps => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record['serverType'] === 'string' &&
    typeof record['serverName'] === 'string' &&
    typeof record['mcpServerId'] === 'string' &&
    Array.isArray(record['fields']) &&
    record['fields'].every(field => {
      if (!field || typeof field !== 'object') return false;
      const f = field as Record<string, unknown>;
      return (
        typeof f['name'] === 'string' &&
        typeof f['label'] === 'string' &&
        (f['type'] === 'text' || f['type'] === 'password')
      );
    })
  );
};

const titleForServer = (name: string): string => {
  const trimmed = name.trim();
  if (!trimmed) return 'MCP';
  return trimmed.replace(/\b\w/g, char => char.toUpperCase());
};

export const McpConfigureNode: React.FC<McpConfigureNodeProps> = ({ node }) => {
  const { state, updateFieldValue, executeAction, isSubmitting } = useFlow();
  const [showErrors, setShowErrors] = useState(false);

  const props = isMcpConfigureProps(node.props) ? node.props : null;
  const requiredMissing = useMemo(() => {
    if (!props) return [];
    return props.fields
      .filter(field => !field.optional)
      .filter(field => {
        const value = state.values[field.name];
        return typeof value !== 'string' || value.trim().length === 0;
      })
      .map(field => field.name);
  }, [props, state.values]);

  if (!props) return null;

  const title = titleForServer(props.serverName);
  const missing = new Set(requiredMissing);

  const onSubmit = async (): Promise<void> => {
    setShowErrors(true);
    if (requiredMissing.length > 0) return;
    await executeAction({
      type: 'submit',
      actionId: 'mcp-configure-submit',
      errorMessage: `Could not configure ${title}`,
    });
  };

  return (
    <div
      className='w-[500px] max-w-full rounded-xl border border-border bg-muted/40 p-3'
      style={node.style}
    >
      <div className='flex items-start gap-3'>
        <McpServerIcon
          server={{ type: props.serverType, name: props.serverName } as McpServer}
          size='md'
        />
        <div className='min-w-0 flex-1'>
          <div className='flex min-w-0 items-center gap-2'>
            <p className='truncate text-base font-semibold leading-[1.25] text-foreground'>
              Configure {title}
            </p>
            <span className='shrink-0 rounded px-1 py-px text-xs font-semibold leading-[18px] bg-muted text-muted-foreground'>
              Required
            </span>
          </div>
          <p className='mt-0.5 line-clamp-2 text-sm leading-[1.4] text-foreground/70'>
            {props.reason?.trim() || `Add credentials so this agent can use ${title}.`}
          </p>
        </div>
      </div>

      <div className='mt-3 grid gap-2'>
        {props.fields.map(field => {
          const rawValue = state.values[field.name];
          const value = typeof rawValue === 'string' ? rawValue : '';
          const hasError = showErrors && missing.has(field.name);

          return (
            <label key={field.name} className='grid gap-1.5'>
              <span className='text-xs font-medium leading-none text-foreground/75'>
                {field.label}
                {field.optional ? (
                  <span className='font-normal text-muted-foreground'> optional</span>
                ) : null}
              </span>
              <input
                type={field.type}
                value={value}
                placeholder={field.placeholder}
                autoComplete='off'
                onChange={event => updateFieldValue(field.name, event.target.value)}
                data-track-category='MCP_CONFIGURE_ARTIFACT'
                data-track-name='MCP_CONFIGURE_FIELD_CHANGE'
                className={cn(
                  'h-9 rounded-lg border bg-background px-3 text-sm text-foreground outline-none',
                  'placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/25',
                  hasError
                    ? 'border-destructive focus:border-destructive focus:ring-destructive/20'
                    : 'border-border',
                )}
              />
              {hasError ? <span className='text-xs text-destructive'>Required</span> : null}
            </label>
          );
        })}
      </div>

      <div className='mt-3 flex justify-end'>
        <button
          type='button'
          onClick={() => {
            void onSubmit();
          }}
          disabled={isSubmitting}
          className={cn(
            'inline-flex h-9 items-center gap-1.5 rounded-lg border border-border bg-background px-3',
            'text-sm font-medium leading-none text-foreground hover:bg-foreground/[0.04] disabled:cursor-not-allowed disabled:opacity-60',
          )}
          data-track-category='MCP_CONFIGURE_ARTIFACT'
          data-track-name='MCP_CONFIGURE_SUBMIT'
        >
          <KeyRound size={14} strokeWidth={2} />
          {isSubmitting ? 'Configuring' : 'Configure'}
        </button>
      </div>
    </div>
  );
};
