/**
 * Shared fixtures for the Morning Brief render tests. Not a test file —
 * jest only picks up `*.test.tsx` and node:test only `*.test.ts`.
 */
import type {
  BriefCitation,
  DailyBriefPayload,
} from '@/src/features/morning-brief/api/dailyBriefApi';
import type { BriefRenderContext } from '@/src/features/morning-brief/hooks/useBriefRenderContext';
import type { BriefLineHandlers } from '@/src/features/morning-brief/components/BriefLine';
import type { BriefPalette } from '@/src/features/morning-brief/utils/briefMarkdownStyle';

export const testPalette: BriefPalette = {
  foreground: '#111111',
  foregroundMuted: '#666666',
  cardBg: '#ffffff',
  brand: '#fe6d36',
  linkColor: '#3b82f6',
  mentionColor: '#3b82f6',
  mentionBg: 'rgba(59,130,246,0.1)',
  chipBg: '#f4f4f5',
};

export function makeCitation(overrides: Partial<BriefCitation> = {}): BriefCitation {
  return { kind: 'ticket', ticketId: 'XYNE-54503', label: 'Ticket XYNE-54503', ...overrides };
}

/** A render context whose citation resolver labels chips by toolCallId. */
export function makeRenderContext(overrides: Partial<BriefRenderContext> = {}): BriefRenderContext {
  return {
    lineContext: {
      isRoutable: () => true,
      ticketPrefixes: new Set<string>(),
      resolveUserName: () => null,
      resolveChannelName: () => null,
    },
    markdownStyle: {},
    palette: testPalette,
    resolveCitation: ref => makeCitation({ label: `Ticket ${ref.toolCallId}` }),
    ...overrides,
  };
}

export function makeHandlers(overrides: Partial<BriefLineHandlers> = {}): BriefLineHandlers {
  return {
    onLinkPress: () => {},
    onPressCitation: () => {},
    onPressGroup: () => {},
    ...overrides,
  };
}

export function makePayload(overrides: Partial<DailyBriefPayload> = {}): DailyBriefPayload {
  return {
    generated_for: 'user-1',
    date: '2026-09-01',
    what_needs_you: ['Triage the queue before deep work. [clf-tool.a:0#1]'],
    overdue: ['Five tickets are past their ETA.'],
    waiting_on_others: [],
    assigned_to_you: [],
    todays_schedule: ['Standup at 10:00.'],
    clawCitations: [{ toolCallId: 'tool.a:0', citations: [makeCitation({ chunkIndex: 1 })] }],
    ...overrides,
  };
}
