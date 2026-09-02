import {
  isDigestEligible,
  capChannelMessages,
  rankAndCapChannels,
  UNREAD_DIGEST_CAPS,
} from './unreadDigestSelection';

const at = (iso: string) => new Date(iso);

describe('isDigestEligible', () => {
  const base = {
    userId: 'u1',
    lastViewedAt: at('2026-01-01T10:00:00Z'),
    snapshotAt: at('2026-01-01T12:00:00Z'),
  };

  it('includes a public message from someone else created after lastViewedAt and at/before the snapshot', () => {
    expect(
      isDigestEligible(
        { senderId: 'u2', isDeleted: false, visibleTo: null, createdAt: at('2026-01-01T11:00:00Z') },
        base
      )
    ).toBe(true);
  });

  it('excludes the requesting user’s own messages', () => {
    expect(
      isDigestEligible(
        { senderId: 'u1', isDeleted: false, visibleTo: null, createdAt: at('2026-01-01T11:00:00Z') },
        base
      )
    ).toBe(false);
  });

  it('excludes soft-deleted messages', () => {
    expect(
      isDigestEligible(
        { senderId: 'u2', isDeleted: true, visibleTo: null, createdAt: at('2026-01-01T11:00:00Z') },
        base
      )
    ).toBe(false);
  });

  it('excludes messages already read (created at or before lastViewedAt)', () => {
    expect(
      isDigestEligible(
        { senderId: 'u2', isDeleted: false, visibleTo: null, createdAt: at('2026-01-01T10:00:00Z') },
        base
      )
    ).toBe(false);
  });

  it('excludes messages created after the snapshot boundary (arrived mid-generation)', () => {
    expect(
      isDigestEligible(
        { senderId: 'u2', isDeleted: false, visibleTo: null, createdAt: at('2026-01-01T12:00:01Z') },
        base
      )
    ).toBe(false);
  });

  it('excludes private messages addressed to a different user', () => {
    expect(
      isDigestEligible(
        { senderId: 'u2', isDeleted: false, visibleTo: 'u3', createdAt: at('2026-01-01T11:00:00Z') },
        base
      )
    ).toBe(false);
  });

  it('includes private messages addressed to the requesting user', () => {
    expect(
      isDigestEligible(
        { senderId: 'u2', isDeleted: false, visibleTo: 'u1', createdAt: at('2026-01-01T11:00:00Z') },
        base
      )
    ).toBe(true);
  });

  it('treats a null lastViewedAt as "never read" and includes older messages', () => {
    expect(
      isDigestEligible(
        { senderId: 'u2', isDeleted: false, visibleTo: null, createdAt: at('2020-01-01T00:00:00Z') },
        { ...base, lastViewedAt: null }
      )
    ).toBe(true);
  });
});

describe('capChannelMessages', () => {
  const msgs = Array.from({ length: 5 }, (_, i) => ({
    id: String(i),
    createdAt: at(`2026-01-01T10:0${i}:00Z`),
  }));

  it('returns everything when under the cap', () => {
    const { kept, omitted } = capChannelMessages(msgs, 10);
    expect(kept).toHaveLength(5);
    expect(omitted).toBe(0);
  });

  it('keeps the NEWEST messages when over the cap, in ascending order', () => {
    const { kept, omitted } = capChannelMessages(msgs, 2);
    expect(omitted).toBe(3);
    expect(kept.map((m) => m.id)).toEqual(['3', '4']);
  });
});

describe('rankAndCapChannels', () => {
  const mk = (unreadHint: number, latest: string) => ({
    unreadHint,
    messages: [{ createdAt: at(latest) }],
  });

  it('orders by unread hint desc then newest activity, and caps the count', () => {
    const channels = [
      mk(1, '2026-01-01T10:00:00Z'),
      mk(5, '2026-01-01T09:00:00Z'),
      mk(5, '2026-01-01T11:00:00Z'),
      mk(2, '2026-01-01T08:00:00Z'),
    ];
    const { included, omittedChannelCount } = rankAndCapChannels(channels, 2);
    expect(included).toHaveLength(2);
    expect(omittedChannelCount).toBe(2);
    // Both top channels have unreadHint 5; the newer one wins the tiebreak.
    expect(included[0].messages[0].createdAt.toISOString()).toBe('2026-01-01T11:00:00.000Z');
    expect(included[1].messages[0].createdAt.toISOString()).toBe('2026-01-01T09:00:00.000Z');
  });
});

describe('UNREAD_DIGEST_CAPS', () => {
  it('exposes the documented, bounded caps', () => {
    expect(UNREAD_DIGEST_CAPS.maxChannels).toBe(25);
    expect(UNREAD_DIGEST_CAPS.maxMessagesPerChannel).toBe(200);
    expect(UNREAD_DIGEST_CAPS.maxMessagesOverall).toBe(1000);
  });
});
