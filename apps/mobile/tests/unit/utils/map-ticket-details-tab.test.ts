import { describe, it } from 'node:test';
import assert from 'node:assert/strict';

import { mapTicketDetailsTab } from '@/src/features/xyne-desks/detail/utils/map-ticket-details-tab';

describe('mapTicketDetailsTab', () => {
  it('returns null for non-object input or a row without an id', () => {
    assert.equal(mapTicketDetailsTab(null), null);
    assert.equal(mapTicketDetailsTab('nope'), null);
    assert.equal(mapTicketDetailsTab({ title: 'x' }), null);
  });

  it('fills sensible defaults for a minimal row', () => {
    assert.deepEqual(mapTicketDetailsTab({ id: 't1' }), {
      id: 't1',
      xyneId: 't1',
      title: '(No subject)',
      description: null,
      status: null,
      stageName: null,
      priority: null,
      assignedTo: null,
      createdBy: null,
      eta: null,
      boardName: null,
      projectName: null,
      labels: [],
    });
  });

  it('prefers statusV2 and nested board/project names, and filters blank labels', () => {
    const out = mapTicketDetailsTab({
      id: 't2',
      xyneId: '  XY-2  ',
      title: '  Fix login  ',
      description: '  broken  ',
      status: 'OPEN',
      statusV2: 'IN_PROGRESS',
      stageName: 'Triage',
      priority: 'HIGH',
      assignedTo: 'u1',
      createdBy: 'u2',
      eta: 1700,
      boardName: 'Fallback board',
      board: { name: 'Real board' },
      project: { name: 'Payments' },
      tagMappings: [{ tagName: 'bug' }, { tagName: '  ' }, { tagName: null }, { tagName: 'ui' }],
    });

    assert.equal(out?.xyneId, 'XY-2');
    assert.equal(out?.title, 'Fix login');
    assert.equal(out?.description, 'broken');
    assert.equal(out?.status, 'IN_PROGRESS');
    assert.equal(out?.boardName, 'Real board');
    assert.equal(out?.projectName, 'Payments');
    assert.deepEqual(out?.labels, ['bug', 'ui']);
  });

  it('keeps a numeric eta but drops a non-numeric one', () => {
    assert.equal(mapTicketDetailsTab({ id: 't3', eta: 42 })?.eta, 42);
    assert.equal(mapTicketDetailsTab({ id: 't4', eta: 'soon' })?.eta, null);
  });
});
