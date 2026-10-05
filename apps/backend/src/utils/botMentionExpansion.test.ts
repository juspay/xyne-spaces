import {
  BOT_MENTION_PRECHECK_RE,
  expandBotMentionShorthand,
  expandSpacesMentions,
} from './botMentionExpansion';

const ARUN_ID = 'equr3x2qjgw87m1ftvlq9tde';
const TARA_POST = 'On-call rotation for this week: <@u3a13b5cuw000zu2ws09uf3z> please pick up the queue.';

const byId = (rows: Array<{ id: string; name: string }>) => async (id: string) =>
  rows.filter((r) => r.id === id);

describe('expandSpacesMentions (bracketed shorthand → span)', () => {
  it('lifts @Name[userId] into a user mention span with data-username', () => {
    const out = expandSpacesMentions(`ping @Arunkumar A[${ARUN_ID}] here`);
    expect(out).toContain('data-mention-type="user"');
    expect(out).toContain(`data-user-id="${ARUN_ID}"`);
    expect(out).toContain('data-username="Arunkumar A"');
    expect(out).toContain('class="chat-input-mention"');
    expect(out).toContain('@Arunkumar A</span>');
    expect(out).not.toContain(`[${ARUN_ID}]`);
  });

  it('lifts group shorthand into a group mention span', () => {
    const out = expandSpacesMentions('cc @data-intelligence[group:abcdefgh12:Data Intelligence]');
    expect(out).toContain('data-mention-type="group"');
    expect(out).toContain('data-group-id="abcdefgh12"');
    expect(out).toContain('data-group-alias="data-intelligence"');
  });

  it('lifts @channel and @here into special mention spans', () => {
    expect(expandSpacesMentions('@channel standup moved')).toContain(
      'class="chat-input-special-mention"',
    );
    expect(expandSpacesMentions('@here check this')).toContain(
      'class="chat-input-special-mention"',
    );
  });

  it('leaves fenced code blocks untouched', () => {
    const fenced = 'docs:\n```\n@Arunkumar A[equr3x2qjgw87m1ftvlq9tde]\n```';
    expect(expandSpacesMentions(fenced)).toBe(fenced);
  });

  it('is idempotent on already-expanded content', () => {
    const once = expandSpacesMentions(`ping @Arunkumar A[${ARUN_ID}]`);
    expect(expandSpacesMentions(once)).toBe(once);
  });

  it('leaves content already containing spans unchanged', () => {
    const html =
      '<span data-mention="" data-mention-type="user" data-user-id="equr3x2qjgw87m1ftvlq9tde" data-username="Arunkumar A" class="chat-input-mention">@Arunkumar A</span>';
    expect(expandSpacesMentions(html)).toBe(html);
  });
});

describe('expandBotMentionShorthand (Slack token + lift)', () => {
  it('resolves <@userId> via the lookup and emits a span with the DB display name', async () => {
    const out = await expandBotMentionShorthand(
      TARA_POST,
      byId([{ id: 'u3a13b5cuw000zu2ws09uf3z', name: 'Arunkumar A' }]),
    );
    expect(out).toContain('data-mention-type="user"');
    expect(out).toContain('data-user-id="u3a13b5cuw000zu2ws09uf3z"');
    expect(out).toContain('data-username="Arunkumar A"');
    expect(out).not.toContain('<@u3a13b5cuw000zu2ws09uf3z>');
  });

  it('leaves the token raw when the id matches no user', async () => {
    const out = await expandBotMentionShorthand(TARA_POST, byId([]));
    expect(out).toContain('<@u3a13b5cuw000zu2ws09uf3z>');
    expect(out).not.toContain('data-mention-type="user"');
  });

  it('leaves the token raw when the id is ambiguous (2+ matches)', async () => {
    const out = await expandBotMentionShorthand(
      TARA_POST,
      byId([
        { id: 'u3a13b5cuw000zu2ws09uf3z', name: 'Arunkumar A' },
        { id: 'u3a13b5cuw000zu2ws09uf3z', name: 'Arunkumar A (inactive)' },
      ]),
    );
    expect(out).toContain('<@u3a13b5cuw000zu2ws09uf3z>');
  });

  it('leaves the token raw when the lookup rejects (never blocks the save)', async () => {
    const out = await expandBotMentionShorthand(TARA_POST, async () => {
      throw new Error('db down');
    });
    expect(out).toContain('<@u3a13b5cuw000zu2ws09uf3z>');
  });

  it('does not resolve Slack tokens inside code fences', async () => {
    const fenced = '```\n<@u3a13b5cuw000zu2ws09uf3z>\n```';
    const out = await expandBotMentionShorthand(
      fenced,
      byId([{ id: 'u3a13b5cuw000zu2ws09uf3z', name: 'Arunkumar A' }]),
    );
    expect(out).toBe(fenced);
  });

  it('expands a mixed post: slack token + bracketed form together', async () => {
    const out = await expandBotMentionShorthand(
      `<@u3a13b5cuw000zu2ws09uf3z> and @Bhavneet Singh[q7u5t5wp0usmkpcqahtyzkga]`,
      byId([{ id: 'u3a13b5cuw000zu2ws09uf3z', name: 'Arunkumar A' }]),
    );
    expect(out).toContain('data-username="Arunkumar A"');
    expect(out).toContain('data-username="Bhavneet Singh"');
    expect(out.match(/chat-input-mention/g)).toHaveLength(2);
  });
});

describe('BOT_MENTION_PRECHECK_RE (repository gate)', () => {
  it('matches both token shapes', () => {
    expect(BOT_MENTION_PRECHECK_RE.test(TARA_POST)).toBe(true);
    expect(BOT_MENTION_PRECHECK_RE.test(`hi @Arunkumar A[${ARUN_ID}]`)).toBe(true);
  });

  it('does not match ordinary text or plain @Name', () => {
    expect(BOT_MENTION_PRECHECK_RE.test('deploy looks green, shipping now')).toBe(false);
    expect(BOT_MENTION_PRECHECK_RE.test('thanks @Arunkumar')).toBe(false);
    expect(BOT_MENTION_PRECHECK_RE.test('email me at a@b.co')).toBe(false);
  });
});
