import React from 'react';
import { Link } from 'react-router-dom';
import type { FlowComponent } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { buttonVariants } from '../../ui/Button/Button';
import { CardShell } from './cardPrimitives';

/**
 * Roster summary — "N agents available", with a CTA into the agent library.
 *
 * Answers "list all my agents" without a wall of prose: the count is the useful
 * part and the library is where you actually act on them. Counts come from the
 * server's own query, so the model cannot misreport them.
 *
 * The destination is built here, not carried in props. `Link` is the
 * workspace-aware shim (src/lib/react-router-dom-shim.ts), so it resolves to
 * /:workspaceId/ai/library on its own — which keeps navigation client-side and
 * means a payload can never retarget this CTA. It is styled with
 * `buttonVariants` rather than wrapping a <button>, since an <a> around a
 * <button> is invalid and breaks keyboard semantics.
 */
interface AgentSummaryProps {
  total?: number;
  global?: number;
  personal?: number;
  label?: string;
}

export const AgentSummaryNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as AgentSummaryProps | undefined;
  const total = props?.total ?? 0;

  const headline = props?.label ?? `${total} ${total === 1 ? 'agent' : 'agents'} available`;

  const parts: string[] = [];
  if (props?.global !== undefined) parts.push(`${props.global} org-wide`);
  if (props?.personal !== undefined) parts.push(`${props.personal} personal`);
  const breakdown = parts.length > 0 ? parts.join(' · ') : 'Browse them in the library';

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col items-start rounded-b-[11px] border-b border-border bg-card p-3'>
        <div className='flex w-full items-center px-1'>
          <div className='flex min-w-0 flex-1 flex-col items-start py-1.5'>
            <p className='break-words text-sm font-semibold leading-5 text-foreground'>
              {headline}
            </p>
          </div>
        </div>
      </div>

      <div className='flex w-full items-center justify-between gap-3 px-3 py-2'>
        <p className='min-w-0 truncate text-xs font-semibold leading-5 text-foreground'>
          {breakdown}
        </p>
        <Link
          to='/ai/library?tab=agents'
          className={cn(
            buttonVariants({ variant: 'outline', size: 'sm' }),
            'h-7 shrink-0 rounded-lg px-2.5 text-sm font-semibold',
            // Beats global.css's `.jp-message-html a` rules, which paint every
            // anchor inside message content link-blue and underlined — some with
            // !important. This CTA is a button by intent, not a link in prose.
            '!text-foreground !no-underline hover:!text-foreground',
          )}
          data-track-category='AGENT_ARTIFACT'
          data-track-name='OPEN_AGENT_LIBRARY'
        >
          Show Agents
        </Link>
      </div>
    </CardShell>
  );
};
