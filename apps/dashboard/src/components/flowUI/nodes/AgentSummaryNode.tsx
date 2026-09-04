import React from 'react';
import { Link } from 'react-router-dom';
import type { FlowComponent } from '@xyne/shared';
import { cn } from '../../../utils/classNames';
import { buttonVariants } from '../../ui/Button/Button';
import { CardShell } from './cardPrimitives';
import { ChatWithAgentButton } from './agent/ChatWithAgentButton';

/**
 * Agent roster — a sample of the workspace's agents, each opening its own page,
 * with a Browse footer into the library.
 *
 * Answers "list all my agents" without a wall of prose. Counts and rows come
 * from the server's own query, so the model cannot misreport them.
 *
 * Routes are built here rather than carried in props: `Link` is the
 * workspace-aware shim (src/lib/react-router-dom-shim.ts), so it resolves to
 * /:workspaceId/... on its own, navigation stays client-side, and a payload can
 * never retarget these links.
 */
interface AgentSummaryRow {
  slug: string;
  name: string;
  description?: string;
}

interface AgentSummaryProps {
  total?: number;
  global?: number;
  personal?: number;
  label?: string;
  agents?: AgentSummaryRow[];
}

// global.css paints every anchor inside message content link-blue and
// underlined; these are buttons by intent, not links in prose.
const LINK_BUTTON = '!text-foreground !no-underline hover:!text-foreground';

export const AgentSummaryNode: React.FC<{ node: FlowComponent; children?: React.ReactNode }> = ({
  node,
}) => {
  const props = node.props as AgentSummaryProps | undefined;
  const total = props?.total ?? 0;
  const agents = props?.agents ?? [];

  const breakdown: string[] = [];
  if (props?.global !== undefined) breakdown.push(`${props.global} org-wide`);
  if (props?.personal !== undefined) breakdown.push(`${props.personal} personal`);

  return (
    <CardShell style={node.style}>
      <div className='flex flex-col gap-4 rounded-b-[11px] border-b border-border bg-card/80 px-3 pb-4 pt-3'>
        <div className='flex h-6 items-center pl-1'>
          <span className='min-w-0 truncate text-sm font-medium leading-5 tracking-[-0.5px] text-muted-foreground'>
            {props?.label ?? `${total} ${total === 1 ? 'agent' : 'agents'} available`}
          </span>
        </div>

        {agents.length > 0 && (
          <div className='flex flex-col'>
            {agents.map(agent => (
              <div
                key={agent.slug}
                className='-mx-1 flex items-center gap-3 rounded-xl px-2 py-2.5 hover:bg-foreground/[0.04]'
              >
                <Link
                  to={`/ai/library/agent/${encodeURIComponent(agent.slug)}?tab=persona`}
                  className={cn('flex min-w-0 flex-1 flex-col', LINK_BUTTON)}
                  data-track-category='Claw Agents'
                  data-track-name='ViewAgentFromCard'
                >
                  <span className='truncate text-sm font-medium leading-5 text-foreground'>
                    {agent.name}
                  </span>
                  {agent.description && (
                    <span className='truncate text-xs leading-5 text-muted-foreground'>
                      {agent.description}
                    </span>
                  )}
                </Link>
                <ChatWithAgentButton slug={agent.slug} />
              </div>
            ))}
          </div>
        )}
      </div>

      <div className='flex items-center justify-between gap-3 px-4 py-3'>
        <span className='min-w-0 truncate text-xs leading-5 text-muted-foreground'>
          {breakdown.length > 0 ? breakdown.join(' · ') : 'Browse them in the library'}
        </span>
        <Link
          to='/ai/library?tab=agents'
          className={cn(
            buttonVariants({ variant: 'ghost', size: 'sm' }),
            'h-7 shrink-0 rounded-[10px] px-2.5 text-sm font-medium',
            LINK_BUTTON,
          )}
          data-track-category='Claw Agents'
          data-track-name='BrowseAgentLibrary'
        >
          Browse agents
        </Link>
      </div>
    </CardShell>
  );
};
