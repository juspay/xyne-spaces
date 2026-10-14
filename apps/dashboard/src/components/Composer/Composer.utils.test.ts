import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Channel, MentionResult } from '@xyne/shared';
import type { DisplaySearchResult } from '../../types/search';
import type { MentionRow } from '../MentionMenu/MentionMenu.utils';
import { rowToPick } from './Composer.utils';

// pickFromResult strips markup with DOMParser, which the node test env lacks;
// a tag-stripping stand-in is all these inputs need.
const realDOMParser = globalThis.DOMParser;
beforeAll(() => {
  globalThis.DOMParser = class {
    parseFromString(value: string): { body: { textContent: string } } {
      return { body: { textContent: value.replace(/<[^>]*>/g, '') } };
    }
  } as unknown as typeof DOMParser;
});
afterAll(() => {
  globalThis.DOMParser = realDOMParser;
});

const person = (over: Partial<MentionResult> & Pick<MentionResult, 'id' | 'name'>): MentionRow => ({
  type: 'person',
  id: `person:${over.id}`,
  person: { type: 'user', ...over },
});

const result = (
  over: Partial<DisplaySearchResult> & Pick<DisplaySearchResult, 'type' | 'id'>,
): MentionRow => ({
  type: 'result',
  id: `${over.type}:${over.id}`,
  result: { title: '', subtitle: '', relevanceScore: 1, metadata: {}, ...over },
});

describe('rowToPick', () => {
  it('attaches a user as a person, without the "(you)" mark', () => {
    expect(rowToPick(person({ id: 'u1', name: 'Samit Barai' }))).toEqual({
      kind: 'person',
      id: 'u1',
      label: 'Samit Barai',
      mention: 'Samit Barai',
    });
    expect(rowToPick(person({ id: 'me', name: 'Pradeesh S (you)' }))).toMatchObject({
      label: 'Pradeesh S',
      mention: 'Pradeesh S',
    });
  });

  it('attaches nothing for groups and @channel / @here', () => {
    expect(rowToPick(person({ id: 'g1', name: 'Design', type: 'group' }))).toBeNull();
    expect(
      rowToPick(person({ id: 'channel', name: 'channel', type: 'channel', isSpecial: true })),
    ).toBeNull();
  });

  it('attaches a channel under the name the row shows', () => {
    const row: MentionRow = {
      type: 'channel',
      id: 'channel:c1',
      channel: { id: 'c1', name: 'eng-core', visibility: 'PRIVATE' } as unknown as Channel,
      displayName: 'eng-core',
    };
    expect(rowToPick(row)).toEqual({
      kind: 'channel',
      id: 'c1',
      label: 'eng-core',
      mention: 'eng-core',
      isPrivate: true,
    });
  });

  it('attaches a DM by its participants rather than its raw name', () => {
    const row: MentionRow = {
      type: 'channel',
      id: 'channel:dm1',
      channel: { id: 'dm1', name: 'u1,u2', visibility: 'PUBLIC' } as unknown as Channel,
      displayName: 'Emma Wu',
    };
    expect(rowToPick(row)).toMatchObject({ kind: 'channel', label: 'Emma Wu', isPrivate: false });
  });

  it('attaches a message as "First\'s message"', () => {
    const row = result({
      type: 'conversation',
      id: 'r1',
      title: 'general',
      context: 'Ship the <hi>release</hi> today',
      searchContext: { senderName: 'Emma Wu', messageId: 'm1', channelId: 'c1' },
    });
    expect(rowToPick(row)).toEqual({
      kind: 'message',
      id: 'm1',
      label: 'Emma Wu: Ship the release today',
      mention: "Emma's message",
      channelId: 'c1',
    });
  });

  it('attaches files, canvases, calls and tickets by kind', () => {
    expect(
      rowToPick(
        result({
          type: 'attachment',
          id: 'a1',
          searchContext: { fileName: 'Q3 plan.pdf', attachmentId: 'att1' },
        }),
      ),
    ).toMatchObject({ kind: 'attachment', id: 'att1', mention: 'Q3 plan.pdf' });
    expect(
      rowToPick(
        result({
          type: 'attachment',
          id: 'cv1',
          title: 'Roadmap',
          searchContext: { subApp: 'CANVAS' },
        }),
      ),
    ).toMatchObject({ kind: 'canvas', label: 'Roadmap', canvasId: 'cv1' });
    expect(
      rowToPick(
        result({
          type: 'attachment',
          id: 't1',
          title: 'Standup',
          searchContext: { subApp: 'TRANSCRIPT' },
        }),
      ),
    ).toMatchObject({ kind: 'call', label: 'Standup' });
    expect(
      rowToPick(
        result({
          type: 'ticket',
          id: 'k1',
          title: 'Login fails',
          searchContext: { xyneId: 'XYS-9' },
        }),
      ),
    ).toMatchObject({ kind: 'ticket', label: 'Login fails', mention: 'XYS-9' });
  });

  it('attaches nothing for results the agent cannot take as context', () => {
    expect(
      rowToPick(result({ type: 'conversation', id: 'd1', searchContext: { subApp: 'DESK' } })),
    ).toBeNull();
    expect(
      rowToPick(
        result({
          type: 'attachment',
          id: 'd2',
          title: 'mail.eml',
          searchContext: { subApp: 'DESK' },
        }),
      ),
    ).toBeNull();
  });

  it('attaches an artifact app by its title', () => {
    const row: MentionRow = {
      type: 'app',
      id: 'app:x1',
      app: { id: 'x1', title: 'Budget tracker' },
      subtitle: 'by Emma',
    };
    expect(rowToPick(row)).toEqual({
      kind: 'app',
      id: 'x1',
      label: 'Budget tracker',
      mention: 'Budget tracker',
    });
  });
});
