import { useState, type ReactElement } from 'react';
import { cn } from '@/utils/classNames';
import Tooltip from '@/components/ui/Tooltip';
import { Pill } from '../../primitives/Pill';
import type { McpCatalogEntry } from './mcpCatalog';
import { McpConnectFlow } from './McpConnectFlow';
import { McpLogo } from './McpLogo';
import { useMcpConnect } from './useMcpConnect';
import { useMcpCredentialFields } from './useMcpCredentialFields';

/** Whose key a connector runs with for this user, as the card shows it. */
export type McpKeyState = 'personal' | 'org' | 'none';

const HINT: Record<McpKeyState, string> = {
  personal: 'The agent runs with the key you connected.',
  org: 'Runs with a key your organisation shares. Connect your own to act as you.',
  none: 'Needs a key before this connector can do anything.',
};

/**
 * One connector the agent uses, with whose key it would run on and a way to
 * connect in place. Status follows the live connections, so connecting here
 * (or anywhere else) turns it to Connected. Renders nothing for connectors
 * that need no key, including the ones that run on the Spaces sign-in.
 */
export function McpConnectCard({
  entry,
  keyState,
  trackPrefix,
}: {
  entry: McpCatalogEntry;
  keyState: McpKeyState;
  /** Analytics name prefix, e.g. "Create agent chat". */
  trackPrefix: string;
}): ReactElement | null {
  const [open, setOpen] = useState(false);
  const connect = useMcpConnect(entry.server, () => setOpen(false));
  const { loading } = useMcpCredentialFields();
  if (!entry.server || loading || !connect.needsKey) return null;

  return (
    <div
      className='flex w-full flex-col gap-3 rounded-xl border border-border bg-card p-3'
      data-testid='mcp-connect-card'
      data-mcp={entry.slug}
      data-key-state={keyState}
    >
      <div className='flex min-w-0 items-start gap-2.5'>
        <McpLogo type={entry.iconType} name={entry.label} size='sm' />
        <div className='flex min-w-0 flex-1 flex-col gap-0.5'>
          <span className='truncate text-sm font-semibold leading-5 tracking-[-0.28px] text-foreground'>
            {entry.label}
          </span>
          {entry.description ? (
            <p className='line-clamp-2 text-xs leading-4 tracking-[-0.24px] text-muted-foreground'>
              {entry.description}
            </p>
          ) : null}
        </div>
      </div>

      <div className='flex min-w-0 items-center justify-between gap-2'>
        <Tooltip content={HINT[keyState]} side='top'>
          <span className='flex min-w-0 flex-wrap items-center gap-1'>
            {keyState === 'personal' ? <Pill tone='success'>Connected</Pill> : null}
            {keyState === 'org' ? (
              <>
                <Pill tone='success'>Org key connected</Pill>
                <Pill tone='neutral'>Your key not connected</Pill>
              </>
            ) : null}
            {keyState === 'none' ? <Pill tone='warning'>Not connected</Pill> : null}
          </span>
        </Tooltip>
        {keyState !== 'personal' && !open ? (
          <button
            type='button'
            onClick={() => {
              connect.reset();
              setOpen(true);
            }}
            title={
              keyState === 'org'
                ? 'Your own key takes precedence over the shared one'
                : `Connect ${entry.label}`
            }
            data-track-category='Claw Agents'
            data-track-name={`${trackPrefix}: connect MCP`}
            className={cn(
              'flex h-7 shrink-0 items-center justify-center rounded-lg px-2 text-sm font-medium leading-[1.2] transition-colors',
              keyState === 'org'
                ? 'border border-border bg-card text-foreground hover:bg-muted'
                : 'border border-transparent bg-primary text-primary-foreground hover:bg-primary/90',
            )}
          >
            {keyState === 'org' ? 'Connect your own' : 'Connect'}
          </button>
        ) : null}
      </div>

      {open && keyState !== 'personal' ? (
        <div className='flex w-full flex-col gap-2 border-t border-border pt-3'>
          <McpConnectFlow
            label={entry.label}
            connect={connect}
            onCancel={() => setOpen(false)}
            trackPrefix={trackPrefix}
          />
        </div>
      ) : null}
    </div>
  );
}
