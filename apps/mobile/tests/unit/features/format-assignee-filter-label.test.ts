import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getAssigneeFilterFirstName,
  formatAssigneeFilterLabel,
} from '@/src/features/xyne-desks/tickets/utils/format-assignee-filter-label';

describe('getAssigneeFilterFirstName', () => {
  it('returns the local-part before @ for a space-less email', () => {
    assert.equal(getAssigneeFilterFirstName('krishna@x.com'), 'krishna');
  });

  it('returns the first whitespace-delimited token for a display name', () => {
    assert.equal(getAssigneeFilterFirstName('Krishna Kumar'), 'Krishna');
  });

  it('collapses arbitrary whitespace and takes the first token', () => {
    assert.equal(getAssigneeFilterFirstName('  Krishna   Kumar  '), 'Krishna');
  });

  it('returns empty string for blank/whitespace-only input', () => {
    assert.equal(getAssigneeFilterFirstName('  '), '');
    assert.equal(getAssigneeFilterFirstName(''), '');
  });

  it('does not apply email-splitting when the name contains a space (even with @)', () => {
    assert.equal(getAssigneeFilterFirstName('Krishna @work'), 'Krishna');
  });

  it('treats a leading-@ handle with no space as an email and returns the whole token', () => {
    // local-part before @ is empty, so it falls back to the trimmed token
    assert.equal(getAssigneeFilterFirstName('@handle'), '@handle');
  });
});

describe('formatAssigneeFilterLabel', () => {
  it('returns "Assignee" when there are no names', () => {
    assert.equal(formatAssigneeFilterLabel([]), 'Assignee');
  });

  it('returns the first name for a single assignee', () => {
    assert.equal(formatAssigneeFilterLabel(['Krishna Kumar']), 'Krishna');
  });

  it('returns "First + N more" for multiple assignees', () => {
    assert.equal(formatAssigneeFilterLabel(['Krishna', 'Ravi', 'Sita']), 'Krishna + 2 more');
  });

  it('falls back to "Assignee" when the single name is blank', () => {
    assert.equal(formatAssigneeFilterLabel(['']), 'Assignee');
  });

  it('counts remaining names, not distinct names', () => {
    assert.equal(formatAssigneeFilterLabel(['A', 'B']), 'A + 1 more');
  });
});
