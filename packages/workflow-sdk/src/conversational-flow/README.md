# Conversational flows

A workflow that talks someone through a process: screens with options, typed
text routed by a model, things fetched on the way, and a finish with an outcome.
It is built from ordinary steps — `CYCLE`, `SWITCH`, `WAIT`, `CONDITIONAL`,
`GO_TO`, `FINISH`, `HTTP_REQUEST` and an agent step — so nothing here is a new
engine construct.

## The config is the tree

The conversation is a `CYCLE`; its `SWITCH` has one case per screen; and **a
screen with screens inside it is a case holding a `CYCLE` of its own**:

```
CYCLE root                         input { screen, text }
└ SWITCH root_route
   ├ case eq(screen, 'root')       [ the first screen's question ]
   ├ case any(payments subtree)    [ what Payments fetches…, CYCLE payments [ SWITCH … ] ]
   └ default                       GO_TO root
```

Three things follow, and they are why the shape is this way:

- **Where a case sits is where the screen is.** No `parent` is stored anywhere;
  the tree is the config, so it cannot disagree with itself.
- **What a section fetches stays in scope inside it.** A step placed before a
  frame has run by the time anything in that frame runs, and the engine keeps
  its output for as long as the frame is open — so a lookup in front of Payments
  is readable by every screen beneath it, and is not repeated as they move
  between those screens.
- **A section's case names its whole subtree**, so routing to a screen four
  levels down is one jump to the conversation: each switch on the way tests the
  same unchanged target and opens the section that holds it.

Everything derived — those subtrees, the round each frame carries, where each
jump is aimed, the headings, what a router may choose, what a hand off offers —
is written by `settle` after every edit. An edit only ever says what the author
meant.

| File | What it does |
| --- | --- |
| `read.ts`, `prompt.ts`, `calls.ts`, `types.ts`, `tree.ts`, `routers.ts` | Read a config as screens, options, lookups and a menu tree |
| `shape.ts`, `locate.ts`, `rounds.ts`, `jumps.ts` | The vocabulary of that shape, and where things sit in it |
| `settle.ts`, `typing.ts` | What is true of a config once an edit is done |
| `edit/`, `create.ts` | Change a flow, or start one, as pure `config → config` functions |
| `turn.ts`, `paths.ts` | Read a run as a conversation: the turn being asked, how to answer it, what happened |
| `server/` | The Conversation API — a service over the runtime, and its routes |

## Looking something up

Anything a screen needs from outside is an `HTTP_REQUEST` placed **in front of**
the frame it feeds — which is the whole of its behaviour:

```
case any(payments subtree)
  HTTP_REQUEST charge         ← runs on the way into Payments
  CONDITIONAL                 ← optional: if it failed, open some other screen
  CYCLE payments [ … ]        ← every screen inside can quote {{steps.charge.output.body…}}
```

Where it sits is its scope, and nothing stores that: before the conversation's
own cycle it runs once for the whole conversation; before a section's cycle it
runs on the way in and stays in scope inside it; before a screen's question it
runs every time that screen opens. `addCall` picks the one that fits the screen
and `readConversationalFlow` reads it back as `scope`.

A failed lookup either fails the run or opens a screen that says so — that is
the `CONDITIONAL` after it, written by `setCallFallback`. The turn reports one
as a `looked_up` event: `{ name, ok, status?, ms? }`.

## Ask AI

An agent that answers, then waits for the person: a reply continues the same
conversation, a way out moves on.

```
WAIT ask_x          the intro, the ways out, a text box
CONDITIONAL         typed → RUN_AGENT ai_x  { …, waitForReply: true }
                            GO_TO { screen: {{steps.ai_x.output.choice}} }
                    tapped → GO_TO the way out
```

`waitForReply` is the host agent step's own behaviour — no engine support
beyond an ordinary pause. After each answer the step pauses with the answer as
its prompt and one text field — the core's `feedback`. A reply resumes it: the step runs the next turn and hands its
provider `conversation: { id, turn }`, so the backend (claw) continues the same
session — nothing about the conversation is stored in the run beyond the step's
place in it. A resume carrying `choice` (or an empty reply) ends it: the output
is the last answer plus `choice`. The ways out are the WAIT's options; the
Conversation API offers them again after every answer.

## Hand off

A screen where a person takes over, in the integrator's own system. It is a
`WAIT` showing a `handoff` display section, then a `GO_TO` carrying its answer:

```
WAIT handoff_x      display [{ id: 'handoff' }], a select of where it can go — no text box
GO_TO               { screen: {{steps.handoff_x.output.resumeData.data.choice}} }
```

Where it can go is written for the author after every edit: every Finish, then
every screen. The run waits there, and the turn says so:

```json
{ "status": "handed_off", "turnId": "…/handoff_x",
  "handoff": { "context": [ …everything asked and answered so far… ] },
  "reply": { "options": [ { "id": "done", "kind": "finish" }, { "id": "payments", "kind": "next" }, … ],
             "text": { "allowed": false } } }
```

When the person's call is over, the integrator answers that turn like any
other — a Finish closes the conversation, a screen hands it back to the flow —
and the next turn carries a `handed_back` event. The customer's own messages go
to the person meanwhile; the turn takes no text. The run stays paused until
someone answers it, or `POST /end` ends it.

## Typed messages

A screen's typed branch names a router screen, and a router reaches exactly the
screens its own frame holds. So a router in the conversation's frame serves the
whole flow, and one inside Payments serves Payments — scoping is where the
router *is*, not a field on it (`scopeRouter` puts one in a section and points
that section's screens at it).

Which router a screen asks stays the author's: an exception made on one screen
survives every later edit. `settle` repairs only the impossible ones — a screen
moved out from under the router it named is pointed at the nearest one above it.

## Conversation API

Mounted by `createWorkflowRouter`; the client is `client.conversations`.

Three calls, because a conversation is a state machine with a person in it and
there are only three things to do with one: move it on, look at it, stop it.

| Route | |
| --- | --- |
| `POST /conversations` | **Advance.** Start with `{ workflowId, context? }`, answer with `{ conversationId, turnId, choice? \| text? \| values? }`, or read with `{ conversationId }` alone → `Turn`; `409 { turn }` for a turn that has moved on |
| `GET /conversations/:id?waitMs=` | **Observe.** The current turn; `?stream=1` to watch until it ends |
| `POST /conversations/:id/end` | **Terminate.** |

Starting and answering are one call because they are one act — the machine moves
and tells you where it is. Which one it is depends on whether you send
`workflowId` or `conversationId`.

**`stream` decides the format, and nothing else does.** `true` always answers
with SSE, even when the reply is a fixed menu with nothing to stream; `false`
always answers with JSON. An integrator cannot know whether the next screen is a
fixed message or an agent writing, so asking them to choose per call would be
asking a question they can't answer — instead they choose once, and write one
loop.

A streamed `POST` ends when it is someone's move again, so the close *is* the
"your turn" signal and a reply arrives exactly once, on the connection that asked
for it. The `GET` stream is the other job — watching, and picking the thread back
up after a reload — so it runs until the conversation ends. Once a stream has
begun, a failure can no longer be a status code, so it arrives as an `error`
event.

A turn is the whole contract: how a channel shows it — buttons, a numbered
list in a text message — is the integrator's choice, made in their code. Render
from `messages` and `reply` alone; `screen`, `events` and the rest are there for
logs and analytics, and a client that branches on them takes away the author's
ability to change the flow.

It uses the runtime and nothing else. A conversation is an execution. A turn is
the node path of its paused step. An answer resumes that step, and waiting for
the next turn follows the execution's own events. **Starting a conversation is
triggering the workflow**: `context` is the trigger's own payload, exactly as
`POST /workflows/:id/trigger` takes it, validated against the same `inputSchema`
and read as `{{trigger.context.<key>}}`. Nothing is added on the way through, so
everything a caller wants to carry goes there — which is also where the builder
can offer it in its value picker and the validator can check it.

`readTranscript` is still on the service for a host that wants it, but it is not
a route: a caller following the conversation already has every turn, and the one
case that needs history without having watched — a person taking over a hand off
— gets it on the turn as `handoff.context`.

## Not done yet

- **`waitForReply` on the SDK's own pi agent step.** Only the host agent step
  has it. The pi step's runtime keeps sessions in memory only, so it would have
  to store its messages on the step record to continue across a pause; its
  resume code for that (`continueConversation`) exists but is never fed. Its
  tool-approval "pause" is likewise only half built — the tool is blocked
  (`{ block: true, reason: '__pause__' }`) but the step never parks. And its
  review-gate "retry with feedback" drops the feedback (the config schema strips
  it) and starts afresh.

- **Webhooks, for channels that can't wait on a request.** A WhatsApp or Slack
  integration receives each message on its own webhook and must answer within
  seconds, so it can't hold `POST /replies` open while an agent works. The usual
  answer: the integrator registers a URL, answers with `stream: false` and
  `waitMs: 0`, and the next turn is `POST`ed to that URL when it is ready —
  signed, and retried on failure. Belongs with outside access (API keys),
  which is being done separately.

- **Hand offs in the Approvals inbox.** A hand off is an approval WAIT, and
  the runtime's pending-approvals list takes every paused run — so an open hand
  off (like any paused screen) is listed there, and anyone who can see the
  workflow could answer it from that page. The list should leave out
  conversational flows, or only list gates meant for approvers.

- **Who answers a hand off.** The customer's replies and the person's answer to
  a hand off go through the same `POST /conversations`, under the same permissions:
  nothing tells the two apart. Fine while both come from the integrator's own
  server; a separate permission for answering hand offs would be needed once
  customers call the API directly.

- **Marking test runs in Runs.** Test conversations are indistinguishable from
  real ones in the runs list. `channel` used to be sent for this and was never
  read, so it went; a listed run carries only its `origin`, which the runtime
  records for scheduled runs alone (`createAndEnqueue`). The plan is to record
  `origin` for every run — the persistence contract already calls it "useful
  provenance on any other" run — and then have Runs label test runs and offer
  to hide them. The cost to weigh first: every run would store its trigger
  event twice, which matters for webhooks with large bodies.

- **Nothing makes a start idempotent.** A retried start creates a second
  conversation and no key on the wire prevents it. Answers are safe — the same
  `turnId` returns the same result or a 409 — but a start that times out leaves
  the caller not knowing whether it began. An `idempotencyKey`, deduped on the
  workflow, is the fix; it waits for the first integrator who needs it.
