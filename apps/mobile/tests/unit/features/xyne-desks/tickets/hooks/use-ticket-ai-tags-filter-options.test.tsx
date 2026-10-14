/* eslint-disable @typescript-eslint/no-require-imports -- jest.mock factories run before imports and cannot reference module scope */
import { describe, expect, it, jest } from '@jest/globals';
import { type ReactElement } from 'react';
import { act, create } from 'react-test-renderer';

import { tagsConfigApi } from '@/src/features/xyne-desks/tickets/api/tags-config-api';
import { useTicketAiTagsFilterOptions } from '@/src/features/xyne-desks/tickets/hooks/use-ticket-ai-tags-filter-options';

jest.mock('@/src/features/xyne-desks/tickets/api/tags-config-api', () => ({
  tagsConfigApi: {
    getAllGeneratedTags: jest.fn(),
  },
}));

const mockedGetAllGeneratedTags = jest.mocked(tagsConfigApi.getAllGeneratedTags);

type HookReturn = ReturnType<typeof useTicketAiTagsFilterOptions>;
let latest!: HookReturn;

function Probe({ channelId }: { channelId: string }): ReactElement | null {
  latest = useTicketAiTagsFilterOptions(channelId);
  return null;
}

describe('useTicketAiTagsFilterOptions', () => {
  it('maps the all-generated-tags catalog into category:tag options', async () => {
    mockedGetAllGeneratedTags.mockResolvedValue([
      { category: 'priority', tag: 'high' },
      { category: 'intent', tag: 'refund' },
    ]);

    await act(async () => {
      create(<Probe channelId='ch-1' />);
    });

    expect(mockedGetAllGeneratedTags).toHaveBeenCalledWith('ch-1');
    expect(latest.options).toEqual([
      { id: 'priority:high', label: 'high', subtitle: 'priority' },
      { id: 'intent:refund', label: 'refund', subtitle: 'intent' },
    ]);
    expect(latest.isLoading).toBe(false);
  });
});
