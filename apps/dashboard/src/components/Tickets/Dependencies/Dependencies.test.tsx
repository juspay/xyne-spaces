import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import type { DependencyState } from '@xyne/shared';
import type { DependencyBatch, PublicDependencyEdge } from '../../../services/dependencies/types';
import { DependencyBadge } from './DependencyBadge';
import { DependencyHoverCard } from './DependencyHoverCard';
import { dependencyOtherLabel } from './Dependencies.utils';

const hidden: PublicDependencyEdge = {
  id: 'opaque-private-edge',
  kind: 'BLOCKS',
  blockerTicketId: 'restricted:opaque:blocker',
  dependentTicketId: 'visible',
  strength: 'HARD',
  gatedStageId: null,
  satisfiedStageId: null,
  satisfiedAt: null,
  reviewNeededAt: null,
  override: { at: '2026-11-27', by: 'private-author', reason: 'private-override-reason' },
  restricted: true,
};
const empty: DependencyBatch = { edges: [], tickets: [], boards: [], stages: [], states: {} };
const state = (primary: DependencyState['primary']): DependencyState => ({
  primary,
  blockedBy: [hidden],
  blocking: [],
});

describe('dependency presentation', () => {
  it('renders no badge for a ticket with no dependencies', () => {
    expect(
      renderToStaticMarkup(
        <DependencyBadge state={{ primary: null, blockedBy: [], blocking: [] }} />,
      ),
    ).toBe('');
  });
  it('renders Unblocked distinctly from no dependencies', () => {
    expect(renderToStaticMarkup(<DependencyBadge state={state('Unblocked')} />)).toContain(
      'Unblocked',
    );
  });
  it('renders blocked and gated-later counts', () => {
    expect(renderToStaticMarkup(<DependencyBadge state={state('Blocked')} />)).toContain(
      'Blocked · 1',
    );
    expect(renderToStaticMarkup(<DependencyBadge state={state('Gated later')} />)).toContain(
      'Gated later · 1',
    );
  });
  it('renders ETA risk duration and independent blocking count', () => {
    const html = renderToStaticMarkup(
      <DependencyBadge state={{ ...state('At risk'), atRiskDays: 3, blocking: [hidden] }} />,
    );
    expect(html).toContain('At risk');
    expect(html).toContain('3d');
    expect(html).toContain('Blocking 1');
  });
  it('keeps restricted titles and opaque identifiers out of hover content', () => {
    const html = renderToStaticMarkup(
      <DependencyHoverCard ticketId='visible' batch={{ ...empty, edges: [hidden] }} />,
    );
    expect(html).toContain('Restricted ticket');
    expect(html).toContain('Waiting on');
    for (const secret of [
      'opaque-private-edge',
      'restricted:opaque:blocker',
      'private-author',
      'private-override-reason',
    ])
      expect(html).not.toContain(secret);
  });
  it('ignores stale endpoint summaries for an explicitly restricted edge', () => {
    const batch: DependencyBatch = {
      ...empty,
      edges: [hidden],
      tickets: [
        {
          id: hidden.blockerTicketId,
          title: 'Revoked title',
          xyneId: 'SECRET-1',
          boardId: 'board',
          stageName: 'Private stage',
          assignedTo: 'Private owner',
          eta: '2026-12-01',
        },
      ],
    };
    expect(dependencyOtherLabel('visible', hidden, batch)).toBe('Restricted ticket');
    const html = renderToStaticMarkup(<DependencyHoverCard ticketId='visible' batch={batch} />);
    expect(html).not.toContain('Revoked title');
    expect(html).not.toContain('Private stage');
    expect(html).not.toContain('Private owner');
  });
  it('ignores stale stage metadata for restricted edges', () => {
    const edge = { ...hidden, satisfiedStageId: 'private-stage', gatedStageId: 'private-stage' };
    const batch: DependencyBatch = {
      ...empty,
      edges: [edge],
      stages: [
        {
          id: 'private-stage',
          boardId: 'private-board',
          name: 'Secret stage name',
          sequenceNumber: 1,
          defaultTicketStatusV2: 'COMPLETED',
        },
      ],
    };
    const html = renderToStaticMarkup(<DependencyHoverCard ticketId='visible' batch={batch} />);
    expect(html).toContain('Restricted ticket');
    expect(html).not.toContain('Secret stage name');
    expect(html).not.toContain('private-stage');
  });
  it('escapes visible titles and omits authored override metadata', () => {
    const edge = { ...hidden, restricted: false, blockerTicketId: 'other' };
    const html = renderToStaticMarkup(
      <DependencyHoverCard
        ticketId='visible'
        batch={{
          ...empty,
          edges: [edge],
          tickets: [
            {
              id: 'other',
              title: '<script>unsafe()</script>',
              xyneId: 'XYNE-1',
              boardId: 'board',
              stageName: 'Open',
              assignedTo: null,
              eta: null,
            },
          ],
        }}
      />,
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('private-override-reason');
  });
  it('does not show satisfied edges as outstanding', () => {
    const html = renderToStaticMarkup(
      <DependencyHoverCard
        ticketId='visible'
        batch={{ ...empty, edges: [{ ...hidden, satisfiedAt: '2026-11-27' }] }}
      />,
    );
    expect(html).toContain('No outstanding dependencies.');
    expect(html).not.toContain('Restricted ticket');
  });
});
