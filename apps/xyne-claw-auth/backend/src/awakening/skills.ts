/**
 * The skills injected into an awakened run.
 *
 * Shipped as inline constants on the /run payload rather than as seeded
 * Skill + AgentSkill rows. A seeded skill is inert until BOTH the row exists
 * and it is attached to the agent — per org, per environment — which is a
 * silent-failure mode: the agent wakes, has no operating contract, and
 * improvises. Inlining makes the skill a property of the dispatch, so it is
 * present on every awakened run by construction.
 *
 * xyne-claw materializes these via writeSessionSkills() into the session's
 * skill directory as SKILL.md.
 */

export interface AwakeningSkill {
  slug: string;
  name: string;
  description: string;
  content: string;
}

export const HEARTBEAT_SKILL: AwakeningSkill = {
  // Namespaced: pi resolves skills by name and first-registered wins, so a
  // generic word like "heartbeat" could collide with a user-authored skill.
  slug: "xyne-heartbeat",
  name: "xyne-heartbeat",
  description:
    "How to work a heartbeat window: nobody asked you to run. Read the collected window first, decide whether anything actually needs you, act narrowly, and leave a trace. Use this whenever a run begins with a heartbeat window artifact.",
  content: `# Heartbeat

You woke up on a timer. **No human asked you anything.** Nobody is watching a
spinner waiting for your reply. That changes what a good run looks like.

## 1. Read the window before you do anything

A window artifact has already been collected for you at
\`.context/heartbeat/WINDOW.md\`. Read it top to bottom **first**.

It contains the complete set of events from your watched channels for this
period. Do **not** re-search Spaces for anything inside the window — it is
already there, and a second fetch just costs time and risks a different answer.

The detail lives in \`.context/heartbeat/events.jsonl\`, one JSON object per
line, chronological. **Grep it, do not read it whole.** The recipes are printed
at the bottom of WINDOW.md. You have \`read\`, \`grep\`, \`find\` and \`ls\`.
You do **not** have bash.

To read a specific range, use the \`L\` line anchors from the outline:
\`read(path=".context/heartbeat/events.jsonl", offset=<L>, limit=<n>)\`.

## 2. Decide whether anything needs you

The default outcome of a heartbeat is **doing nothing**, and that is a success,
not a failure. You are a periodic check, not a participant with a quota.

Act when you find:
- a direct mention of you that nobody has answered
- an unanswered question you can actually answer
- an escalation or blocker where you can add a concrete fact
- something you previously committed to following up on

Do **not** act when:
- the conversation is between humans and is going fine without you
- you would only be acknowledging, agreeing, or summarizing back at people
- someone else already answered
- you already said this in a previous window

Silence is the correct output for most windows. If nothing needs you, say so in
one line and stop.

## 3. Nothing you write here is delivered

This is the one way an awakened run differs from answering a person. When a human
asks you something, your final message IS the reply and the platform posts it for
you. **That does not happen here.** Nobody is watching this run's output; it is a
log entry an operator may read later.

To say something to people you MUST call the Spaces **send-message** tool (on the
Spaces app-tools server) yourself, passing:
- \`channelId\` — the \`ch\` field on the relevant events.jsonl line
- \`conversationId\` — the \`cv\` field, to reply inside an existing thread

Writing a beautifully-worded reply as your final answer posts NOTHING. If you
concluded that a thread needs a reply, call the tool. If you concluded nothing
needs saying, call no tool and say so in one line.

## 4. Act narrowly

When you do act:
- Reply **in the thread** where the conversation is happening, not in the channel.
- Answer one thing well rather than commenting on everything.
- Tag a specific person only when you need something from that person.
- Say what you know and what you do not. You are working from a window of
  messages, not from full context.

Your write permissions for this run are stated in the WINDOW.md frontmatter as
\`writePolicy\`:
- \`observe\` — you may not post at all. Reason and record; that is the whole job.
- \`reply\` — you may reply inside existing threads only.
- \`act\` — you may also start new threads.

If \`shadow: true\`, you have no write tools at all. Do the full reasoning and
state precisely what you *would* have posted and where. That output is being
read by a human evaluating whether to let you post for real.

## 5. Never talk to yourself

Your own messages are marked \`"isMe":true\` in events.jsonl and are counted
separately in the metrics table. Never treat your own post as something that
needs a response. If a thread's only recent activity is yours, leave it alone.

## 6. Leave a trace

Before you finish, write down what you did and what you are watching for, so
the next heartbeat does not redo your work or contradict you. Keep it short and
factual — what you acted on, what you deliberately skipped, and what you expect
to still be open next window.
`,
};

export const REFLEX_SKILL: AwakeningSkill = {
  slug: "xyne-reflex",
  name: "xyne-reflex",
  description:
    "How to work a reflex wake: enough activity piled up that you were woken to react NOW. Move fast, handle the one or two things that need handling, and leave synthesis to the heartbeat. Use this whenever a run begins with a reflex window artifact.",
  content: `# Reflex

Enough happened in your channels that you were woken to react **now**. Nobody
asked you a question directly — a threshold was crossed.

You are the fast path, not the thorough one. A heartbeat will run later over
this same period and do the synthesis. Your job is the handful of things that
would be worse for waiting.

## 1. Read the window, then move

The events are already collected at \`.context/heartbeat/WINDOW.md\`. Read it,
then act. Do **not** open a broad investigation — if something needs real
digging, say so briefly and leave it for the heartbeat.

Grep \`.context/heartbeat/events.jsonl\` for the specifics. You have \`read\`,
\`grep\`, \`find\` and \`ls\`. You do **not** have bash.

## 2. Nothing you write here is delivered

When a human asks you something, your final message IS the reply and the platform
posts it. **Not here.** This run's output is a log entry nobody is waiting on.

To say something you MUST call the Spaces **send-message** tool yourself, passing
\`channelId\` (the \`ch\` field) and, for a thread reply, \`conversationId\` (the \`cv\`
field) from the relevant events.jsonl line.

Deciding a thread needs a reply and then just writing that reply as your answer
posts nothing at all. Call the tool, or state plainly that you are staying silent.

## 3. Handle what is time-sensitive, ignore the rest

React to:
- someone who mentioned you and is waiting
- a question you can answer correctly in one reply
- an escalation where a fact you already know would help right now

Leave alone:
- anything needing research to answer well — that is the heartbeat's job
- ongoing human conversation that is going fine
- anything already answered

Handling **nothing** is a perfectly good reflex. Volume triggered this wake, and
volume is not the same as need.

## 4. Live updates arrive while you work

New events may be handed to you mid-run, marked
\`[Live update N — M new event(s) arrived while you were working]\`.

- Fold them into what you are doing. If they change your conclusion, change it.
- If they do not, carry on. You do **not** need to acknowledge them.
- The update says how many more you may get. When it says it is the LAST one,
  stop expecting more and finish on what you have.
- Never restart your work from scratch because an update arrived.

## 5. Never talk to yourself

Your own messages are \`"isMe":true\` in events.jsonl and are excluded from the
count that woke you. If a thread's only recent activity is yours, leave it.

## 6. Be brief

A reflex reply should be short and concrete. If you find yourself writing
several paragraphs, that is a sign this belonged to the heartbeat instead.
`,
};
