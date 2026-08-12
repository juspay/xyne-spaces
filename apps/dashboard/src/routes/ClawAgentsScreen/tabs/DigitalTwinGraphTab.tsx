import { ReactElement, useMemo, useState } from 'react';
import { Background, Controls, ReactFlow } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { List, Network, RefreshCw } from '@/components/ClawAgents/digitalTwin/icons';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { useClawDigitalTwinGraph } from '@/hooks/useClawDigitalTwin';
import {
  layoutSubsystems,
  makeSubsystemEdges,
} from '@/components/ClawAgents/digitalTwin/graphLayout';
import { SubsystemMemoriesPanel } from '@/components/ClawAgents/digitalTwin/SubsystemMemoriesPanel';
import { fmtDate } from '@/components/ClawAgents/digitalTwin/format';
import { subsystemLabel } from '@/components/ClawAgents/digitalTwin/subsystems';

const DigitalTwinGraphTab = (): ReactElement => {
  const graphQuery = useClawDigitalTwinGraph();
  const [view, setView] = useState<'list' | 'graph'>('list');
  const [selectedSubsystem, setSelectedSubsystem] = useState<string | null>(null);
  const nodes = useMemo(
    () =>
      graphQuery.data ? layoutSubsystems(graphQuery.data.subsystems, graphQuery.data.edges) : [],
    [graphQuery.data],
  );
  const edges = useMemo(
    () => (graphQuery.data ? makeSubsystemEdges(graphQuery.data.edges) : []),
    [graphQuery.data],
  );
  const subsystems = useMemo(
    () =>
      [...(graphQuery.data?.subsystems ?? [])].sort(
        (left, right) => right.memoryCount - left.memoryCount,
      ),
    [graphQuery.data],
  );

  return (
    <div className='flex flex-col gap-7'>
      <div className='grid gap-5 lg:grid-cols-[minmax(0,1fr)_auto] lg:items-end'>
        <div>
          <p className='dt-accent text-sm font-bold'>Inspect · Knowledge map</p>
          <h2 className='dt-display mt-1 text-2xl font-semibold text-[var(--dt-ink)]'>
            How memory areas connect
          </h2>
          <p className='dt-muted mt-2 max-w-[70ch] text-base'>
            Start with the ranked list for exact counts. The visual map is an optional way to
            explore knowledge areas that share source sessions.
          </p>
        </div>
        <div
          className='flex items-center rounded-lg border dt-rule p-1'
          aria-label='Knowledge map view'
        >
          <button
            type='button'
            onClick={() => setView('list')}
            aria-pressed={view === 'list'}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin show knowledge list'
            className={
              view === 'list'
                ? 'dt-control dt-transition inline-flex items-center gap-2 rounded-md bg-[var(--dt-ink)] px-4 text-sm font-semibold text-[var(--dt-paper)]'
                : 'dt-control dt-transition inline-flex items-center gap-2 rounded-md px-4 text-sm font-semibold text-[var(--dt-muted)]'
            }
          >
            <List className='size-4' />
            Ranked list
          </button>
          <button
            type='button'
            onClick={() => setView('graph')}
            aria-pressed={view === 'graph'}
            data-track-category='Claw Agents'
            data-track-name='Digital Twin show visual knowledge map'
            className={
              view === 'graph'
                ? 'dt-control dt-transition inline-flex items-center gap-2 rounded-md bg-[var(--dt-ink)] px-4 text-sm font-semibold text-[var(--dt-paper)]'
                : 'dt-control dt-transition inline-flex items-center gap-2 rounded-md px-4 text-sm font-semibold text-[var(--dt-muted)]'
            }
          >
            <Network className='size-4' />
            Visual map
          </button>
        </div>
      </div>

      {graphQuery.isError && (
        <div
          role='alert'
          className='border border-[var(--dt-danger)] bg-[var(--dt-danger-soft)] p-4'
        >
          <p className='font-semibold text-[var(--dt-danger)]'>The knowledge map did not load.</p>
          <p className='dt-muted mt-1 text-sm'>{graphQuery.error.message}</p>
          <Button
            variant='outline'
            className='dt-control mt-3'
            onClick={() => void graphQuery.refetch()}
          >
            <RefreshCw className='size-4' />
            Try again
          </Button>
        </div>
      )}

      {graphQuery.isLoading ? (
        <Skeleton className='h-[480px] w-full rounded-none' />
      ) : !graphQuery.isError && subsystems.length === 0 ? (
        <div className='dt-grid-lines flex min-h-72 flex-col items-start justify-center border-y dt-rule px-8 py-12'>
          <Network className='size-7 text-[var(--dt-accent)]' />
          <h3 className='dt-display mt-5 text-xl font-semibold text-[var(--dt-ink)]'>
            No connected knowledge yet
          </h3>
          <p className='dt-muted mt-2 max-w-[58ch] text-base'>
            The map appears after approved memories span multiple knowledge areas.
          </p>
        </div>
      ) : (
        !graphQuery.isError && (
          <div className={selectedSubsystem ? 'grid gap-6 xl:grid-cols-[minmax(0,1fr)_390px]' : ''}>
            {view === 'list' ? (
              <div className='overflow-x-auto border-y dt-rule'>
                <table className='w-full min-w-[720px] border-collapse text-left'>
                  <thead>
                    <tr className='dt-paper-raised text-sm text-[var(--dt-muted)]'>
                      <th scope='col' className='px-4 py-3 font-semibold'>
                        Knowledge area
                      </th>
                      <th scope='col' className='px-4 py-3 text-right font-semibold'>
                        Memories
                      </th>
                      <th scope='col' className='px-4 py-3 text-right font-semibold'>
                        Sessions
                      </th>
                      <th scope='col' className='px-4 py-3 font-semibold'>
                        Last updated
                      </th>
                      <th scope='col' className='px-4 py-3 font-semibold'>
                        Sample
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {subsystems.map(subsystem => (
                      <tr
                        key={subsystem.name}
                        className='dt-transition border-t dt-rule hover:bg-[var(--dt-paper-raised)]'
                      >
                        <th scope='row' className='px-4 py-4 font-semibold text-[var(--dt-ink)]'>
                          <button
                            type='button'
                            className='dt-control text-left hover:underline'
                            onClick={() => setSelectedSubsystem(subsystem.name)}
                            data-track-category='Claw Agents'
                            data-track-name='Digital Twin inspect knowledge area'
                          >
                            {subsystemLabel(subsystem.name)}
                          </button>
                        </th>
                        <td className='px-4 py-4 text-right tabular-nums text-[var(--dt-ink)]'>
                          {subsystem.memoryCount.toLocaleString()}
                        </td>
                        <td className='px-4 py-4 text-right tabular-nums text-[var(--dt-ink)]'>
                          {subsystem.sessionCount.toLocaleString()}
                        </td>
                        <td className='dt-muted px-4 py-4'>{fmtDate(subsystem.lastUpdated)}</td>
                        <td className='dt-muted max-w-sm px-4 py-4 text-sm'>
                          <span className='line-clamp-2'>{subsystem.sampleContent}</span>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div
                className='h-[540px] overflow-hidden border-y dt-rule bg-[var(--dt-paper-raised)]'
                aria-label='Interactive visual map. An equivalent ranked table is available.'
              >
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  fitView
                  nodesDraggable={false}
                  nodesConnectable={false}
                  elementsSelectable
                  onNodeClick={(_, node) => setSelectedSubsystem(node.id)}
                >
                  <Background color='var(--dt-rule)' />
                  <Controls />
                </ReactFlow>
              </div>
            )}

            {selectedSubsystem && (
              <div className='min-h-[540px]'>
                <SubsystemMemoriesPanel
                  subsystem={selectedSubsystem}
                  onClose={() => setSelectedSubsystem(null)}
                />
              </div>
            )}
          </div>
        )
      )}

      {!graphQuery.isError && (graphQuery.data?.edges.length ?? 0) > 0 && (
        <section aria-labelledby='knowledge-connections-heading'>
          <div className='border-b-2 border-[var(--dt-ink)] pb-3'>
            <h3
              id='knowledge-connections-heading'
              className='dt-display text-xl font-semibold text-[var(--dt-ink)]'
            >
              Connections
            </h3>
            <p className='dt-muted mt-1 text-sm'>
              An exact adjacency list for the visual map, ordered by shared source sessions.
            </p>
          </div>
          <ul className='grid gap-px bg-[var(--dt-rule)] lg:grid-cols-2'>
            {[...(graphQuery.data?.edges ?? [])]
              .sort((left, right) => right.sharedSessions - left.sharedSessions)
              .map(edge => (
                <li
                  key={`${edge.source}:${edge.target}`}
                  className='dt-paper-raised flex min-h-16 flex-wrap items-center gap-x-2 px-4 py-3 text-sm'
                >
                  <button
                    type='button'
                    className='dt-control font-semibold text-[var(--dt-ink)] hover:underline'
                    onClick={() => setSelectedSubsystem(edge.source)}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin inspect connected knowledge area'
                  >
                    {subsystemLabel(edge.source)}
                  </button>
                  <span className='dt-muted'>connects to</span>
                  <button
                    type='button'
                    className='dt-control font-semibold text-[var(--dt-ink)] hover:underline'
                    onClick={() => setSelectedSubsystem(edge.target)}
                    data-track-category='Claw Agents'
                    data-track-name='Digital Twin inspect connected knowledge area'
                  >
                    {subsystemLabel(edge.target)}
                  </button>
                  <span className='dt-muted ml-auto tabular-nums'>
                    {edge.sharedSessions.toLocaleString()} shared session
                    {edge.sharedSessions === 1 ? '' : 's'}
                  </span>
                </li>
              ))}
          </ul>
        </section>
      )}
    </div>
  );
};

export default DigitalTwinGraphTab;
