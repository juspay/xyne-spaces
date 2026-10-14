/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { type ReactElement } from 'react';
import { act, create } from 'react-test-renderer';
import { TicketPriority } from '@xyne/shared';

jest.mock('@xyne/shared', () => require('../../../../../mocks/xyne-shared'));

import {
  useTicketsDeskFilters,
  type UseTicketsDeskFiltersReturn,
} from '@/src/features/xyne-desks/tickets/hooks/use-tickets-desk-filters';

let latest!: UseTicketsDeskFiltersReturn;

function Probe({ channelId }: { channelId: string }): ReactElement | null {
  latest = useTicketsDeskFilters(channelId);
  return null;
}

describe('useTicketsDeskFilters', () => {
  it('resets every per-desk filter when the channel changes', () => {
    let renderer: ReturnType<typeof create>;
    act(() => {
      renderer = create(<Probe channelId='ch-1' />);
    });

    act(() => {
      latest.setMyTicketsOnly(true);
      latest.setAssigneeIds(['u-1']);
      latest.setCreatedByIds(['u-2']);
      latest.setPriorities([TicketPriority.HIGH]);
      latest.setStageNames(['Open']);
      latest.setHasAiDraft(true);
      latest.setHasSubTickets(true);
      latest.setAiCategories(['Billing']);
      latest.setGeneratedTags(['tag:urgent']);
      latest.setUserGroupIds(['g-1']);
      latest.setConversationLabelId('label-1');
      latest.setDynamicFields({ field: ['yes'] });
      latest.setLastUpdatedRange({ start: 1, end: 2 });
      latest.setDateRange({ start: 3, end: 4 });
      latest.setActiveFolder('spam');
    });

    expect(latest.assigneeIds).toEqual(['u-1']);
    expect(latest.activeFolder).toBe('spam');

    act(() => {
      renderer.update(<Probe channelId='ch-2' />);
    });

    expect(latest.myTicketsOnly).toBe(false);
    expect(latest.assigneeIds).toEqual([]);
    expect(latest.createdByIds).toEqual([]);
    expect(latest.priorities).toEqual([]);
    expect(latest.stageNames).toEqual([]);
    expect(latest.hasAiDraft).toBe(false);
    expect(latest.hasSubTickets).toBe(false);
    expect(latest.aiCategories).toEqual([]);
    expect(latest.generatedTags).toEqual([]);
    expect(latest.userGroupIds).toEqual([]);
    expect(latest.conversationLabelId).toBeUndefined();
    expect(latest.dynamicFields).toEqual({});
    expect(latest.lastUpdatedRange).toEqual({});
    expect(latest.dateRange).toEqual({});
    expect(latest.activeFolder).toBe('inbox');
  });

  it('keeps the mailbox folder when clearing filters on the same desk', () => {
    act(() => {
      create(<Probe channelId='ch-1' />);
    });

    act(() => {
      latest.setActiveFolder('starred');
      latest.setAssigneeIds(['u-1']);
      latest.clearAllFilters();
    });

    expect(latest.assigneeIds).toEqual([]);
    expect(latest.activeFolder).toBe('starred');
  });
});
