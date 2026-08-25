# Xyne Spaces — Product Video Script

Runtime: 1:52 | 8 beats | 252 VO words | ~135 wpm

---

## [0:00 – 0:09] COLD OPEN (9s)

VO:
"Your organization already knows the answer. It's just spread across six tools,
four threads, and a call nobody rewatched."

ON SCREEN:
Fast cuts, no UI chrome — a Slack thread scrolling past, a Jira ticket, an inbox,
a call recording thumbnail with an untouched progress bar. Each drifts apart from
the others. Silence under the last frame.

SUPER: "Where did we decide this?"

---

## [0:09 – 0:19] THE PREMISE (10s)

VO:
"Xyne Spaces gives it one home — a context layer for your org, and the apps your
team actually works in, built around it."

ON SCREEN:
The scattered fragments pull inward and resolve into the layered architecture
diagram — context store at the centre, apps ringed around it. Hold two beats.
Wordmark resolves.

SUPER: "Xyne Spaces — the org OS"

---

## [0:19 – 0:34] CONTEXT ARRIVES (15s)

VO:
"Connect Slack, Google Workspace, Microsoft 365. Bulk-import years of Jira and
Confluence. Every message, ticket, document and transcript lands normalized,
threaded and indexed — in one store, behind one set of permissions."

ON SCREEN:
Connector cards flip from grey to connected, one per beat of the VO. Cut to a
migration preview: a Jira import counting up through thousands of issues. Then
records streaming into a single indexed list — messy inputs, one clean shape out.

SUPER: "Live sync + bulk migration"

---

## [0:34 – 0:50] PERMISSION-AWARE SEARCH (16s)

VO:
"Then just ask. One search across all of it, scoped to what you're allowed to see.
Same question, two people, two different answers — because permissions are
enforced at the data layer, not painted on in the UI."

ON SCREEN:
Hero shot of the search box; a real question typed in full. Results resolve with
citations across a doc, a thread and a call transcript. Then the frame splits —
same query, two signed-in users, visibly different result sets. Don't blur the
difference, show it.

SUPER: "Access control at the data layer"

---

## [0:50 – 1:08] THE APPS (18s)

VO:
"Around that core sit the apps. Chat and threads. Calls, with transcripts indexed
the moment they end. Canvases you draft together. Tickets, boards, a support desk.
All of it real-time — and all of it feeding the same context back."

ON SCREEN:
Tight montage, one app per clause, cut on the beat. Land on a canvas with two live
cursors editing the same paragraph — no lag, no save button. Close the loop
visually: a line traces from the canvas back into the context store.

SUPER: "Eight apps. One store."

---

## [1:08 – 1:32] AGENTS — THE PAYOFF (24s)

VO:
"Which is what finally makes agents useful. Ask one in a thread, and it answers
from your org's actual context — with citations. It runs sandboxed, holds no
credentials of its own, and inherits your access exactly. No privileged bypass.
It can reach fifty-plus connected tools. And before it acts as you, it asks."

ON SCREEN:
The longest beat — give it room. Someone @-mentions an agent in a real thread. It
works, then answers with sources you can click. Cut to the sandbox diagram:
gateway holds the secrets, runtime holds none. Return to the thread for the
approve/decline card. Hold on the cursor. Click APPROVE. The ticket appears.

SUPER: "Writes need a human"

---

## [1:32 – 1:43] AUTOMATIONS (11s)

VO:
"Put agents on a schedule, and the routine work runs itself. Ticket triage, draft
replies, SLA tracking, the morning recap — done before you're in."

ON SCREEN:
A schedule list ticking through overnight runs, timestamps in the small hours.
Resolve on a daily brief already sitting at the top of someone's channel at 8:59am.

SUPER: "Ran at 04:12. Waiting for you."

---

## [1:43 – 1:52] CLOSE (9s)

VO:
"Xyne Spaces. The org OS. Open source, Apache 2.0 — and running on your machine
with one command."

ON SCREEN:
Terminal, real capture: `pnpm run up`. The dashboard opens. Cut to black, then the
end card.

SUPER: "github.com/juspay/xyne-spaces"

---

# PRODUCTION NOTES

TONE
  Confident and plain. The product is technically unusual, so the script never
  oversells — it just states what happens. Read it under-energised rather than over.

PACE
  135 wpm with real pauses between beats. Beat 6 is deliberately the longest; if
  you're running over, take the time from beats 3 and 5, never from 6.

MUSIC
  Sparse and rhythmic under beats 1–2, builds through the app montage, drops out
  entirely on the approval click at ~1:28. Silence sells that moment.

CAPTURE
  All UI shot from a seeded workspace with believable names and volume — an empty
  demo instance undercuts the whole premise. Show real latency; the point is it's
  already fast.

SUPERS
  Set in the product's own display face, bottom-left, no box. One per beat maximum.
  They caption the claim, they don't repeat the VO.

ACCURACY GUARDRAILS
  "No credentials of its own" is exact and worth keeping verbatim.
  The egress-closed microVM applies to the shell sandbox specifically — don't
  broaden it to "agents have no network".

---

# 0:45 SOCIAL CUTDOWN

  Beat                  New TC    Status      Change
  --------------------------------------------------------------------------------
  1  Cold open          0:00      Keep        Trim to the first sentence only.
  2  The premise        0:05      Keep        Full.
  3  Context arrives    0:15      Compress    "Connect the tools you already use.
                                              Everything lands normalized, threaded
                                              and indexed."
  4  Search             0:22      Compress    Keep "same question, two people, two
                                              different answers." Drop the rest.
  5  The apps           —         Cut         Covered visually under beat 6.
  6  Agents             0:29      Keep        Full — this is the cutdown's whole
                                              argument.
  7  Automations        —         Cut         Reserve for its own standalone clip.
  8  Close              0:41      Keep        Drop "Apache 2.0"; end card carries it.
