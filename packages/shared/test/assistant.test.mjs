import test from 'node:test';
import assert from 'node:assert/strict';

import {
  advance,
  bindPlan,
  ACTIONS,
  confirmPolicyOf,
  EMPTY_CONVERSATION,
  intentCriteria,
  loadActions,
  MAX_ACTIONS_PER_AREA,
  MAX_PARKED,
  renderTemplate,
} from '../dist/assistant/index.js';

const priya = { kind: 'person', id: 'u-priya', name: 'Priya Shah' };
const daniel = { kind: 'person', id: 'u-daniel', name: 'Daniel Okafor' };
const deepak = { kind: 'person', id: 'u-deepak', name: 'Deepak Rao' };

const set = (field, value, certain = true) => ({ field, op: 'set', value, certain });
const request = (action, ...updates) => ({ type: 'request', action, updates });

/** Runs a sequence of events from an empty conversation; returns every result. */
function converse(...events) {
  let state = EMPTY_CONVERSATION;
  return events.map(event => {
    const result = advance(state, event, ACTIONS);
    state = result.state;
    return result;
  });
}

// ─── Conversation behaviour ──────────────────────────────────────────────────

test('everything in one sentence: a clear DM runs without a preview', () => {
  const [result] = converse(request('send_dm', set('recipient', daniel), set('message', 'hello')));
  assert.equal(result.step.kind, 'run');
  assert.deepEqual(result.step.plan, [
    { op: 'open_or_create_dm', user: daniel },
    { op: 'navigate', target: { fromStep: 0 } },
    { op: 'send_message', target: { fromStep: 0 }, text: 'hello' },
  ]);
  assert.equal(result.step.done, 'Sent to Daniel Okafor.');
  assert.equal(result.state.active, null);
});

test('an unclear detail gets a preview; "yes" runs exactly what was shown', () => {
  const [preview, approved] = converse(
    request('send_dm', set('recipient', daniel, false), set('message', 'hello')),
    { type: 'yes' },
  );
  assert.equal(preview.step.kind, 'confirm');
  assert.equal(preview.step.summary, 'Send “hello” to Daniel Okafor');
  assert.equal(approved.step.kind, 'run');
  assert.equal(approved.step.fingerprint, preview.step.fingerprint);
});

test('one detail per turn, in the order the action asks', () => {
  const steps = converse(
    request('create_channel'),
    { type: 'details', updates: [set('name', 'ABC')] },
    { type: 'choose', optionId: 'private' },
    { type: 'no' },
    { type: 'yes' },
  ).map(result => result.step);

  assert.equal(steps[0].field, 'name');
  assert.equal(steps[1].field, 'visibility');
  assert.deepEqual(
    steps[1].options.map(option => option.id),
    ['public', 'private'],
  );
  assert.equal(steps[2].field, 'members');
  assert.equal(steps[2].prompt, 'Want to add anyone? Say their names, or say no.');
  assert.equal(steps[3].kind, 'confirm');
  assert.equal(steps[3].summary, 'Create a private channel named “ABC”');
  assert.equal(steps[4].kind, 'run');
  assert.deepEqual(steps[4].plan, [
    { op: 'create_channel', name: 'ABC', visibility: 'private', members: [] },
    { op: 'navigate', target: { fromStep: 0 } },
  ]);
});

test('answering a different detail than the one asked', () => {
  const [, answer] = converse(request('create_channel'), {
    type: 'details',
    updates: [set('visibility', 'public')],
  });
  // Asked for the name, got the visibility: keep it, and still ask for the name.
  assert.equal(answer.step.field, 'name');
  assert.equal(answer.state.active.values.visibility, 'public');
});

test('a correction replaces the value and voids the preview that was showing', () => {
  const [, preview, renamed] = converse(
    request('create_channel', set('name', 'ABC'), set('visibility', 'public')),
    { type: 'no' }, // no members
    { type: 'details', updates: [set('name', 'XYZ')] }, // "actually call it XYZ"
  );
  assert.equal(preview.step.kind, 'confirm');
  assert.equal(renamed.step.summary, 'Create a public channel named “XYZ”');
  assert.notEqual(renamed.step.fingerprint, preview.step.fingerprint);
});

test('adding someone at the review step', () => {
  const review = converse(
    request('create_channel', set('name', 'Launch'), set('visibility', 'public')),
    { type: 'no' },
    { type: 'details', updates: [{ field: 'members', op: 'add', value: priya, certain: true }] },
  ).at(-1).step;
  assert.equal(review.kind, 'confirm');
  assert.equal(review.summary, 'Create a public channel named “Launch” with Priya Shah');
});

test('"yes" to an optional offer asks for it; "no" skips it', () => {
  const offerChannel = request('create_channel', set('name', 'ABC'), set('visibility', 'public'));
  const [offer, yes] = converse(offerChannel, { type: 'yes' });
  assert.equal(offer.step.field, 'members');
  assert.equal(yes.step.prompt, 'Who should I add?');

  const [, no] = converse(offerChannel, { type: 'no' });
  assert.equal(no.step.kind, 'confirm');
  assert.deepEqual(no.state.active.skipped, ['members']);
});

test('switching to something else parks the request; "continue" brings it back', () => {
  const [started, dm, resumed] = converse(
    request('create_channel', set('name', 'ABC')),
    request('send_dm', set('recipient', priya), set('message', 'hi')),
    { type: 'resume' },
  );
  assert.equal(started.step.field, 'visibility');

  assert.deepEqual(dm.notes[0], {
    kind: 'parked',
    action: 'create_channel',
    summary: 'create_channel (name: ABC)',
  });
  assert.equal(dm.step.kind, 'run');
  // Set aside in this very turn: reported once, not also as "still waiting".
  assert.equal(dm.notes.length, 1);

  assert.equal(resumed.notes.at(-1).kind, 'resumed');
  assert.equal(resumed.step.field, 'visibility');
  assert.equal(resumed.state.active.values.name, 'ABC');
  assert.equal(resumed.state.parked.length, 0);
});

test('a new request for the same action is new: the waiting one is set aside, not overwritten', () => {
  const [, second] = converse(
    request('send_dm', set('recipient', daniel, false), set('message', 'hello')),
    request('send_dm', set('recipient', priya, false), set('message', 'the build is green')),
  );
  assert.equal(second.step.summary, 'Send “the build is green” to Priya Shah');
  assert.equal(second.state.parked.length, 1);
  assert.equal(second.state.parked[0].values.recipient, daniel);
});

test(`at most ${MAX_PARKED} requests are held; the oldest goes first`, () => {
  const results = converse(
    ...['A1', 'B2', 'C3', 'D4', 'E5'].flatMap(name => [
      request('create_channel', set('name', name)),
      request('send_dm', set('recipient', priya)),
    ]),
  );
  const { parked } = results.at(-1).state;
  assert.equal(parked.length, MAX_PARKED);
  assert.ok(parked.every(draft => draft.values.name !== 'A1'));
});

test('cancel drops the request at any point; nothing runs', () => {
  const [, cancelled, nothing] = converse(
    request('send_dm', set('recipient', priya)),
    { type: 'cancel' },
    { type: 'cancel' },
  );
  assert.deepEqual(cancelled.step, { kind: 'cancelled', action: 'send_dm' });
  assert.equal(cancelled.state.active, null);
  assert.deepEqual(nothing.step, { kind: 'idle', reason: 'nothing-pending' });
});

test('"no" to a detail the request needs asks for it again, marked as declined', () => {
  const [asked, declined] = converse(request('create_channel'), { type: 'no' });
  assert.equal(asked.step.kind, 'ask');
  assert.equal(asked.step.declined, undefined);
  assert.equal(declined.step.kind, 'ask');
  assert.equal(declined.step.field, 'name');
  assert.equal(declined.step.declined, true);
  assert.ok(declined.state.active, 'the request is kept');
});

test('"no" to a preview cancels it', () => {
  const [preview, no] = converse(
    request('send_dm', set('recipient', priya, false), set('message', 'hi')),
    { type: 'no' },
  );
  assert.equal(preview.step.kind, 'confirm');
  assert.equal(no.step.kind, 'cancelled');
});

test('creating a channel always previews, even when every detail is clear', () => {
  const [result] = converse(
    request(
      'create_channel',
      set('name', 'ABC'),
      set('visibility', 'public'),
      set('firstMessage', 'hello'),
      { field: 'members', op: 'add', value: priya, certain: true },
    ),
  );
  assert.equal(result.step.kind, 'confirm');
  assert.equal(
    result.step.summary,
    'Create a public channel named “ABC” with Priya Shah and post “hello”',
  );
});

test('a new channel opens first, then its first message is posted', () => {
  const run = converse(
    request(
      'create_channel',
      set('name', 'ABC'),
      set('visibility', 'public'),
      set('firstMessage', 'hello'),
    ),
    { type: 'no' },
    { type: 'yes' },
  ).at(-1);
  assert.deepEqual(run.step.plan, [
    { op: 'create_channel', name: 'ABC', visibility: 'public', members: [] },
    { op: 'navigate', target: { fromStep: 0 } },
    { op: 'send_message', target: { fromStep: 0 }, text: 'hello' },
  ]);
  assert.equal(run.step.done, 'Created “ABC” and posted “hello”. It’s open now.');
});

test('a name matching several people asks which one, then continues', () => {
  const candidates = [
    { id: 'u-daniel', label: 'Daniel Okafor', value: daniel },
    { id: 'u-deepak', label: 'Deepak Rao', value: deepak },
  ];
  const [ask, chosen] = converse(
    request(
      'send_dm',
      { field: 'recipient', op: 'ambiguous', mention: 'Dee', candidates },
      set('message', 'hi'),
    ),
    { type: 'choose', optionId: 'u-deepak' },
  );
  assert.equal(ask.step.prompt, 'Which one do you mean by “Dee”?');
  // Chips carry labels only; the records stay on the server.
  assert.deepEqual(ask.step.options, [
    { id: 'u-daniel', label: 'Daniel Okafor' },
    { id: 'u-deepak', label: 'Deepak Rao' },
  ]);
  assert.equal(chosen.step.kind, 'run');
  assert.deepEqual(chosen.step.plan[0], { op: 'open_or_create_dm', user: deepak });
});

test('a name matching nobody says so in the next question', () => {
  const [result] = converse(
    request('send_dm', { field: 'recipient', op: 'unknown', mention: 'Zorro' }),
  );
  assert.equal(result.step.prompt, "I couldn't find “Zorro”. Who should I message?");
});

test('a later request mentions one that is still waiting', () => {
  const [, , later] = converse(
    request('create_channel', set('name', 'ABC')),
    request('send_dm', set('recipient', priya)),
    { type: 'details', updates: [set('message', 'hi')] },
  );
  assert.equal(later.step.kind, 'run');
  assert.deepEqual(later.notes, [
    { kind: 'still-parked', action: 'create_channel', summary: 'create_channel (name: ABC)' },
  ]);
});

test('an unknown name is reported for optional details too ("add Zorro")', () => {
  const [, result] = converse(
    request('create_channel', set('name', 'ABC'), set('visibility', 'public')),
    { type: 'details', updates: [{ field: 'members', op: 'unknown', mention: 'Zorro' }] },
  );
  assert.equal(result.step.kind, 'ask');
  assert.equal(result.step.field, 'members');
  assert.equal(result.step.prompt, "I couldn't find “Zorro”. Who should I add?");
});

test('several records of any kind can be collected, without duplicates', () => {
  const [, , twice] = converse(
    request('create_channel', set('name', 'ABC'), set('visibility', 'public')),
    { type: 'details', updates: [{ field: 'members', op: 'add', value: priya, certain: true }] },
    { type: 'details', updates: [{ field: 'members', op: 'add', value: priya, certain: true }] },
  );
  assert.deepEqual(twice.state.active.values.members, [priya]);
});

test('the next question uses what is already known', () => {
  const [result] = converse(request('send_dm', set('recipient', priya)));
  assert.equal(result.step.prompt, 'What should I say to Priya Shah?');
});

test('a preview whose details changed underneath is not run by "yes"', () => {
  const [preview] = converse(
    request('send_dm', set('recipient', priya, false), set('message', 'hi')),
  );
  const { active } = preview.state;
  const tampered = {
    ...preview.state,
    active: { ...active, values: { ...active.values, message: 'bye' } },
  };
  const result = advance(tampered, { type: 'yes' }, ACTIONS);
  assert.equal(result.step.kind, 'confirm');
  assert.equal(result.step.summary, 'Send “bye” to Priya Shah');
});

test('unknown actions and fields are reported, never guessed', () => {
  const [unknown, ignored] = converse(
    request('launch_rocket'),
    request('send_dm', set('subject', 'x')),
  );
  assert.deepEqual(unknown.step, { kind: 'idle', reason: 'unknown-action' });
  assert.deepEqual(ignored.notes, [{ kind: 'ignored-field', field: 'subject' }]);
});

test('the engine is deterministic and never mutates its input', () => {
  const event = request('send_dm', set('recipient', priya, false), set('message', 'hi'));
  const input = JSON.parse(JSON.stringify(EMPTY_CONVERSATION));
  const first = advance(input, event, ACTIONS);
  assert.deepEqual(advance(input, event, ACTIONS), first);
  assert.deepEqual(input, EMPTY_CONVERSATION);
});

// ─── Definitions as data ─────────────────────────────────────────────────────

test('the intent text for the model is built from the definition’s parts', () => {
  const text = intentCriteria(ACTIONS.get('send_dm'));
  assert.match(
    text,
    /^Send a direct message .* starting the DM if needed\. Examples: "Tell Priya hi", /,
  );
  assert.match(
    text,
    /Not for: posting in a thread, .* \(that is a post in that conversation\); opening a DM/,
  );
});

test('the effect sets how careful the assistant is, unless the definition overrides it', () => {
  assert.equal(confirmPolicyOf(ACTIONS.get('send_dm')), 'when-unclear');
  assert.equal(confirmPolicyOf(ACTIONS.get('create_channel')), 'always');
  const open = { ...minimal(), effect: 'navigate' };
  assert.equal(confirmPolicyOf(loadActions([area(open)]).get('open_page')), 'never');
  assert.equal(
    confirmPolicyOf(loadActions([area({ ...open, confirm: 'always' })]).get('open_page')),
    'always',
  );
});

test('templates: {field} fills in, [ … ] shows only when its fields have values', () => {
  const template = 'Create “{name}”[ with {members}][ and post “{firstMessage}”]';
  assert.equal(renderTemplate(template, { name: 'ABC' }), 'Create “ABC”');
  assert.equal(
    renderTemplate(template, { name: 'ABC', members: [priya, daniel], firstMessage: 'hi' }),
    'Create “ABC” with Priya Shah, Daniel Okafor and post “hi”',
  );
});

test('plans: skipped steps are removed and later references renumbered', () => {
  const steps = [
    { op: 'open_or_create_dm', user: '$to' },
    { op: 'send_message', if: 'intro', target: { fromStep: 0 }, text: '$intro' },
    { op: 'send_message', target: { fromStep: 0 }, text: '$body' },
  ];
  assert.deepEqual(bindPlan(steps, new Set(), { to: priya, body: 'hi' }), [
    { op: 'open_or_create_dm', user: priya },
    { op: 'send_message', target: { fromStep: 0 }, text: 'hi' },
  ]);
});

test('a bound plan is validated: a wrong value never reaches the runner', () => {
  assert.throws(
    () => bindPlan([{ op: 'open_or_create_dm', user: '$to' }], new Set(), { to: 'just a name' }),
    /Expected object/,
  );
});

test('every mistake in a definition stops startup and names the problem', () => {
  const cases = [
    [{ id: 'Bad-Id' }, /action Bad-Id: id must be snake_case/],
    [{ intent: { description: 'x', examples: ['only one'] } }, /examples/],
    [{ summarize: 'Hi {nobody}' }, /summarize uses unknown field \{nobody\}/],
    [
      { summarize: 'Hi {note}' },
      /summarize always shows optional field \{note\}; wrap it in \[ \]/,
    ],
    [{ plan: [{ op: 'launch', to: '$to' }] }, /plan step 0 \(launch\): unknown operation/],
    [{ plan: [{ op: 'navigate', where: '$to' }] }, /unknown parameter where/],
    [
      { plan: [{ op: 'send_message', target: { channelId: 'c1' }, text: '$note' }] },
      /optional \$note needs "if": "note"/,
    ],
    [
      {
        plan: [
          { op: 'send_message', target: { channelId: 'c1' }, text: '$body' },
          { op: 'navigate', target: { fromStep: 0 } },
        ],
      },
      /step 0 \(send_message\) produces nothing to use/,
    ],
    [
      {
        fields: {
          body: { kind: 'text', required: true, ask: 'Say what to {to}?', describe: 'body' },
          to: { kind: 'person', required: true, ask: 'Who?', describe: 'recipient' },
        },
        summarize: 'Send {body} to {to}',
      },
      /field body ask needs \{to\} before it is asked; wrap it in \[ \]/,
    ],
    [
      {
        fields: { kind: { kind: 'choice', required: true, ask: 'Which?', describe: 'k' } },
        summarize: 'Pick {kind}',
        plan: [{ op: 'navigate', target: { channelId: 'c1' } }],
      },
      /a choice needs options/,
    ],
  ];
  for (const [change, message] of cases) {
    assert.throws(() => loadActions([area({ ...minimal(), ...change })]), message);
  }
  assert.throws(() => loadActions([area(minimal(), minimal())]), /Duplicate action id: open_page/);
});

test('every shipped action loads and renders with sample values', () => {
  const android = { kind: 'channel', id: 'c-android', name: 'android' };
  const samples = {
    recipient: priya,
    message: 'hi',
    name: 'ABC',
    visibility: 'public',
    channel: android,
    conversation: {
      kind: 'thread',
      id: 't-perf',
      name: 'Reduce startup work',
      channelId: 'c-perf',
      channelName: 'releases',
    },
  };
  for (const definition of ACTIONS.values()) {
    const values = Object.fromEntries(
      Object.entries(definition.fields)
        .filter(([, field]) => field.required)
        .map(([id]) => [id, samples[id]]),
    );
    assert.ok(Object.values(values).every(Boolean), `${definition.id}: add sample values`);
    assert.ok(renderTemplate(definition.summarize, values).length > 0);
    assert.ok(renderTemplate(definition.done, values).length > 0);
  }
});

test('opening a channel navigates to the channel that was found', () => {
  const android = { kind: 'channel', id: 'c-android', name: 'android' };
  const open = ACTIONS.get('open_channel');
  assert.deepEqual(bindPlan(open.plan, new Set(), { channel: android }), [
    { op: 'navigate', target: android },
  ]);
});

/** An area holding the given actions. */
function area(...actions) {
  return { id: 'test_area', description: 'Actions under test.', actions };
}

/** The smallest valid action, for testing the checks one mistake at a time. */
function minimal() {
  return {
    id: 'open_page',
    title: 'Open a page',
    intent: { description: 'Open a page.', examples: ['open tickets', 'go to settings'] },
    effect: 'send',
    fields: {
      to: { kind: 'person', required: true, ask: 'Who?', describe: 'recipient' },
      body: { kind: 'text', required: true, ask: 'What[ to {to}]?', describe: 'body' },
      note: { kind: 'text', required: false, ask: 'Any note?', describe: 'note' },
    },
    summarize: 'Send {body} to {to}',
    plan: [{ op: 'open_or_create_dm', user: '$to' }],
    done: 'Done.',
  };
}
