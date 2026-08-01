import React from 'react';
import { ExternalLink } from 'lucide-react';
import type { FlowComponent } from '@xyne/shared';
import { McpServerIcon } from '../../ClawAgents/McpServerIcon';
import { cn } from '../../../utils/classNames';

interface ConnectAccountNodeProps {
  node: FlowComponent;
  children?: React.ReactNode;
}

type ConnectAccountProps = {
  displayName: string;
  authUrl: string;
  reason?: string;
  serverType?: string;
};

type ProviderDisplay = {
  name: string;
  detail?: string;
};

const isConnectAccountProps = (value: unknown): value is ConnectAccountProps => {
  if (!value || typeof value !== 'object') return false;
  const record = value as Record<string, unknown>;
  return typeof record['displayName'] === 'string' && typeof record['authUrl'] === 'string';
};

const providerTypeFromName = (displayName: string): string => {
  const normalized = displayName.toLowerCase();
  if (normalized.includes('google') || normalized.includes('gmail')) return 'google';
  if (normalized.includes('microsoft') || normalized.includes('outlook')) return 'microsoft';
  return displayName.trim().toLowerCase().replace(/[_\s]+/g, '-');
};

const providerDisplayFromName = (displayName: string): ProviderDisplay => {
  const match = /^(.*?)\s*\((.*?)\)\s*$/.exec(displayName.trim());
  if (!match) return { name: displayName.trim() };

  const name = match[1]?.trim() || displayName.trim();
  const detail = match[2]?.trim();
  return detail ? { name, detail } : { name };
};

export const ConnectAccountNode: React.FC<ConnectAccountNodeProps> = ({ node }) => {
  if (!isConnectAccountProps(node.props)) return null;
  const props = node.props;

  const serverType = props.serverType || providerTypeFromName(props.displayName);
  const provider = providerDisplayFromName(props.displayName);
  const reason = props.reason?.trim();
  const detail = reason || (provider.detail ? `Required for ${provider.detail}.` : 'Required before this agent can use the account.');

  return (
    <div
      className='flex w-[450px] max-w-full items-center gap-3 rounded-xl border border-border bg-muted/40 p-3'
      style={node.style}
    >
      <McpServerIcon server={{ type: serverType, name: provider.name }} size='md' />
      <div className='min-w-0 flex-1'>
        <div className='flex items-center gap-2'>
          <p className='truncate text-base font-semibold leading-[1.25] text-foreground'>Connect {provider.name}</p>
          <span className='shrink-0 rounded px-1 py-px text-xs font-semibold leading-[18px] tracking-[0.2px] bg-muted text-muted-foreground'>
            Required
          </span>
        </div>
        <p className='mt-0.5 line-clamp-2 text-sm leading-[1.4] text-foreground/70'>{detail}</p>
      </div>

      <a
        href={props.authUrl}
        target='_blank'
        rel='noopener noreferrer'
        className={cn(
          'inline-flex h-9 shrink-0 items-center gap-1.5 rounded-lg border border-border bg-background px-3',
          'text-sm font-medium leading-none text-foreground',
          'hover:bg-foreground/[0.04]',
        )}
        data-track-category='CONNECT_ACCOUNT_ARTIFACT'
        data-track-name='CONNECT_ACCOUNT'
      >
        Connect
        <ExternalLink size={14} strokeWidth={2} />
      </a>
    </div>
  );
};
