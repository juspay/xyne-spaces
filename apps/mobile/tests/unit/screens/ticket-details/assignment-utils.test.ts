import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { TicketPriority } from '@xyne/shared';

import {
  formatUserGroupDisplayName,
  normalizeGroupId,
  parseTicketPriority,
  resolveAssigneePickerGroupId,
  resolveTicketUserGroupId,
  toAssignedToValue,
} from '@/src/screens/ticket-details/assignment-utils';

describe('toAssignedToValue', () => {
  it('preserves the user: prefix when the ticket already uses it', () => {
    assert.equal(toAssignedToValue('u-2', 'user:u-1'), 'user:u-2');
  });

  it('stores a bare user id when the current assignee is bare or empty', () => {
    assert.equal(toAssignedToValue('u-2', 'u-1'), 'u-2');
    assert.equal(toAssignedToValue('u-2', null), 'u-2');
    assert.equal(toAssignedToValue('u-2', undefined), 'u-2');
    assert.equal(toAssignedToValue('u-2', ''), 'u-2');
  });
});

describe('parseTicketPriority', () => {
  it('returns null for blank or unknown values', () => {
    assert.equal(parseTicketPriority(null), null);
    assert.equal(parseTicketPriority(undefined), null);
    assert.equal(parseTicketPriority(''), null);
    assert.equal(parseTicketPriority('   '), null);
    assert.equal(parseTicketPriority('urgent'), null);
  });

  it('parses exact enum values case-insensitively', () => {
    assert.equal(parseTicketPriority('LOW'), TicketPriority.LOW);
    assert.equal(parseTicketPriority('medium'), TicketPriority.MEDIUM);
    assert.equal(parseTicketPriority('High'), TicketPriority.HIGH);
    assert.equal(parseTicketPriority('CRITICAL'), TicketPriority.CRITICAL);
  });

  it('matches priority keywords inside display strings', () => {
    assert.equal(parseTicketPriority('Priority: High'), TicketPriority.HIGH);
    assert.equal(parseTicketPriority('critical issue'), TicketPriority.CRITICAL);
    assert.equal(parseTicketPriority('low priority'), TicketPriority.LOW);
  });
});

describe('normalizeGroupId', () => {
  it('returns empty for blank input', () => {
    assert.equal(normalizeGroupId(null), '');
    assert.equal(normalizeGroupId(undefined), '');
    assert.equal(normalizeGroupId('   '), '');
  });

  it('strips group: and userGroup: prefixes', () => {
    assert.equal(normalizeGroupId('group:g-1'), 'g-1');
    assert.equal(normalizeGroupId('userGroup:g-2'), 'g-2');
  });

  it('leaves bare ids unchanged', () => {
    assert.equal(normalizeGroupId('g-3'), 'g-3');
  });
});

describe('resolveTicketUserGroupId', () => {
  it('uses the hydrated ticket field even when null (no assignee fallthrough)', () => {
    assert.equal(resolveTicketUserGroupId(true, null, 'fallback-group'), null);
    assert.equal(resolveTicketUserGroupId(true, 'ticket-group', 'fallback-group'), 'ticket-group');
  });

  it('falls back to conversation ticket md only before ticket hydrates', () => {
    assert.equal(resolveTicketUserGroupId(false, 'ignored', 'fallback-group'), 'fallback-group');
    assert.equal(resolveTicketUserGroupId(false, undefined, null), null);
  });

  it('normalizes group: prefixed ids so lookup and picker selection match group.id', () => {
    const ticketUserGroupId = resolveTicketUserGroupId(true, 'group:g-1', null);
    assert.equal(ticketUserGroupId, 'g-1');

    const userGroups = [{ id: 'g-1', name: 'Platform' }];
    const name = userGroups.find(group => group.id === ticketUserGroupId)?.name ?? null;
    assert.equal(formatUserGroupDisplayName(name, ticketUserGroupId), 'Platform');
    // Picker options use bare group.id as value — selectedValue must match.
    assert.equal(ticketUserGroupId, userGroups[0]?.id);

    assert.equal(resolveTicketUserGroupId(false, null, 'userGroup:g-2'), 'g-2');
  });
});

describe('resolveAssigneePickerGroupId', () => {
  it('prefers ticket user group over assignee-as-group', () => {
    assert.equal(resolveAssigneePickerGroupId('ticket-group', 'assignee-group'), 'ticket-group');
    assert.equal(resolveAssigneePickerGroupId(null, 'assignee-group'), 'assignee-group');
    assert.equal(resolveAssigneePickerGroupId(null, null), null);
  });

  it('normalizes prefixed ticket or assignee group ids', () => {
    assert.equal(resolveAssigneePickerGroupId('group:g-1', 'assignee-group'), 'g-1');
    assert.equal(resolveAssigneePickerGroupId(null, 'group:g-2'), 'g-2');
  });
});

describe('formatUserGroupDisplayName', () => {
  it('shows group name, Unknown for unresolved id, or Assign Group when unset', () => {
    assert.equal(formatUserGroupDisplayName('Platform', 'g-1'), 'Platform');
    assert.equal(formatUserGroupDisplayName('  ', 'g-1'), 'Unknown');
    assert.equal(formatUserGroupDisplayName(null, 'g-1'), 'Unknown');
    assert.equal(formatUserGroupDisplayName(null, null), 'Assign Group');
  });
});
