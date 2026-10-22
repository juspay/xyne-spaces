import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  getAssigneeFilterFirstName,
  formatAssigneeFilterLabel,
} from '@/src/features/xyne-desks/tickets/utils/format-assignee-filter-label';

describe('getAssigneeFilterFirstName', () => {
  it('returns the first whitespace-delimited token', () => {
    assert.equal(getAssigneeFilterFirstName('Krishna Kumar'), 'Krishna');
    assert.equal(getAssigneeFilterFirstName('  Alice   Bob '), 'Alice');
  });

  it('returns the local part for a spaceless email', () => {
    assert.equal(getAssigneeFilterFirstName('krishna@example.com'), 'krishna');
  });

  it('treats an email with a space as a normal display name', () => {
    // Has a space, so the email branch is skipped and the first token wins.
    assert.equal(getAssigneeFilterFirstName('a@b.com c'), 'a@b.com');
  });

  it('returns a single-word name unchanged', () => {
    assert.equal(getAssigneeFilterFirstName('John'), 'John');
  });

  it('returns an empty string for blank input', () => {
    assert.equal(getAssigneeFilterFirstName(''), '');
    assert.equal(getAssigneeFilterFirstName('   '), '');
  });
});

describe('formatAssigneeFilterLabel', () => {
  it('returns "Assignee" when nobody is selected', () => {
    assert.equal(formatAssigneeFilterLabel([]), 'Assignee');
  });

  it('returns the first name for a single assignee', () => {
    assert.equal(formatAssigneeFilterLabel(['Krishna Kumar']), 'Krishna');
    assert.equal(formatAssigneeFilterLabel(['krishna@example.com']), 'krishna');
  });

  it('summarizes multiple assignees as "First + N more"', () => {
    assert.equal(formatAssigneeFilterLabel(['Krishna Kumar', 'Bob', 'Carol']), 'Krishna + 2 more');
  });

  it('falls back to "Assignee" when the only name is blank', () => {
    assert.equal(formatAssigneeFilterLabel(['']), 'Assignee');
  });
});
