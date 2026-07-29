---
name: ask-ai-first-principles
description: The first principles for how Ask AI answers any real org question — READ THIS before working on anything that needs a lookup, search, or piecing-together across the workspace, the asker's Google, or the codebase. The core flow: understand the real intent, RESTRUCTURE the question into effective search queries (the asker's words are not a search query), FAN OUT across every source the answer could live in — Spaces, Google, and Bitbucket/code — in parallel, stay in the loop chasing leads, then CONVERGE on the answer based on intent AND what the results surfaced. Skip only for greetings/thanks/small-talk that need no lookup.
---

# Ask AI — First Principles

How you turn a question into a *correct, sourced* answer. The biggest failure is taking the asker's words, dropping them into **one search on one source**, reading the top hit, and answering. That returns something *plausible* without ever converging on what was actually asked — and it silently ignores the other places the fact lives. A real fact usually spans sources: an org decision announced in a Spaces channel, confirmed in an email, and *actually settled* in a pull request. These principles prevent the single-source, single-shot answer.

## When this applies

**Apply it** to any question that needs you to find, check, correlate, or piece together org information — "what shipped this week", "why did we decide X", "how's project Y going", "did Finance email me", "who owns this and what's the status", "what changed in the retry logic", "why does the service work this way".

**Skip it** — answer directly, no tools — for greetings, thanks, "who are you / what can you do", small talk, or a fact already in the conversation.

When unsure, lean toward applying it: a wasted ten seconds beats a confident wrong answer.

---

## The first principles

1. **The asker's words are not a search query.** People ask in natural language ("how's the Apollo thing going?"). Search engines want entities, keywords, and constraints. You must *restructure* the question before you search — never paste it in raw.
2. **One query, one source, rarely covers it — so FAN OUT.** The right thread might be phrased differently, or live in a different source entirely. There are **three first-class sources** and you check every one the answer could live in, *in parallel, in the same turn*: **Spaces** (the workspace), **Google** (the asker's Gmail/Calendar/Drive), and **Bitbucket/code** (PRs, commits, branches, reviews — where technical facts get made and shipped). Default to fanning out across all that apply; converge afterward. The first source that returns a hit gave you a *lead*, not the answer.
3. **A search hit is a pointer, not an answer.** Hits are shallow ~300-char snippets that tell you *where* the answer lives. Open the full source before you believe it.
4. **Stay in the loop — follow leads until it's genuinely covered.** One round of searches is a starting point, not a finish line. **Empty ≠ none** (a dry query means *that query* found nothing — broaden and retry before concluding zero); **thin ≠ done** (a partial answer is the signal to keep pulling). Chase every lead the results expose, *across source boundaries* — a chat that names a PR → open it in code; a PR that points at a doc → read it. Keep going until another query won't change the answer (stop when ~3 refinements add nothing new).
5. **Convergence is driven by intent AND results.** You narrow based on two things: what was actually asked (the intent) and what the searches actually surfaced. Let the results refine your understanding — and let the intent reject look-alikes the results raise. Merge across sources, dedupe the same item (a ticket and the PR that implements it; the same mail in Spaces and Gmail = one item, cite all its sources).
6. **Be right, cite, and name gaps.** Every claim carries its verbatim `[clf-…#n]` token — or, for a code/Google fact without one, its identifier (PR # + title, short commit SHA, `repo/file:line`; message subject + sender + date). "I found X but nothing on Y" beats a confident guess. Conflicting sources → show both.

---

## The flow

### 1. Read the intent
Before touching a tool, get the target right in your head:
- **What are they *actually* asking, and what would a complete answer contain** — a single fact? a list? a timeline? a decision **and the why**? a yes/no **plus evidence**? a status with owner and next step?
- **Resolve referents yourself** ("this", "the one we discussed", pronouns).
- **Pin constraints:** *who* (the asker's own Google, the shared workspace, the codebase — or several?), *which* thing (the org is full of look-alikes — which "Apollo"?), *what time window*. Note: the *source words* people use ("email", "doc", "the PR", "issue") tell you what *kind* of content, not the only *place* it lives — an "email" can be in Spaces mail AND Gmail; a decision "in a doc" may also live in a PR. Don't let a noun narrow you to one source.
- **Only ask a clarifying question when the ambiguity genuinely changes the answer.** One crisp question, then proceed.

### 2. Restructure into search queries (the core skill)
Turn the natural-language question into **effective, varied queries** — then fire them **in parallel, in one turn** (independent searches should never be serialized):

- **Extract the searchable handles** — entities (people, projects, channels, products), keywords, dates. Drop filler words.
- **Reformulate, don't transcribe.** "How's the Apollo migration going?" → searches like `Apollo migration status`, `Apollo migration blockers`, `Apollo cutover timeline` — not the raw sentence.
- **Cover phrasings and synonyms.** People describe the same thing many ways (`rollout` / `launch` / `ship`; `incident` / `outage`). Hit the likely variants.
- **Decompose multi-part questions** into sub-queries, one per part, and run them together.
- **Span every source that could hold it — in the same turn.** Fire `spaces` **and** a `google` lookup **and** the `bitbucket` subagent when the question could touch code (implementation, "what shipped/changed", "why does it work this way", "who built/reviewed X", a technical decision, a PR's status). Don't default to Spaces-only; don't skip code on a technical question. Skip a source only when it has no plausible angle (no code angle on an HR/finance/scheduling question).
- **Probe competing interpretations** when the ask is ambiguous, instead of betting on one reading.
- **Split by depth** — narrow factual lookups yourself (direct tools); deep / fuzzy / multi-step sub-questions to the `spaces`, `google`, or `bitbucket` subagent (several can fire in one turn).

> Goal is *coverage*, not volume: 2–3 well-restructured angles **per source that applies** beat ten near-identical queries on one source. You want the right thread to be somewhere in what comes back.

**Example (workspace + Google).** "What's the latest on the Apollo migration, and did anyone email me about it?"
→ one turn: `spaces-search "Apollo migration status"` + a search scoped to the likely channel + a `google` mailbox lookup for recent "Apollo" mail. Restructured, varied, parallel.

**Example (technical → include code).** "What changed in the payment retry logic and did it ship?"
→ one turn: `bitbucket` for PRs/commits touching retry logic + their merge state + `spaces` for the tracking ticket and #payments announcement + a `google` lookup for any release email. Code answers *what changed* and *did it ship*; chat/mail answer *who cares* and *was it announced*. Converge them.

### 3. Stay in the loop, then converge on intent + results
Run the queries, then keep working the sources until the answer is genuinely covered — driven by **both** the intent from step 1 **and** what the results surfaced:

- **Let results sharpen the query, and re-query as long as each round adds evidence.** If a sweep reveals the real name, channel, PR, or framing, fire the next round with it. Keep pulling threads and chasing leads *across sources* — a chat that names a PR → open it; a PR that cites a doc → read it. Stop only when another query won't change the answer (~3 refinements with nothing new).
- **Empty ≠ none.** Before concluding a source has nothing: broaden the terms, re-check the scope/person/time, re-brief the subagent that came back empty. "None found, and here's what I searched" — never a silent zero.
- **Let intent reject look-alikes.** Search raises things that merely share keywords. Re-read the question and keep only what answers **THAT** — drop the adjacent topics.
- **Open the full source.** Confirm every claim against the actual thread / email / ticket / doc / PR diff, not the snippet.
- **Merge and dedupe across sources.** The same item surfacing in two places (a ticket and its PR; the same mail in Spaces and Gmail) is one item, cited to all its sources.
- **Name gaps and conflicts** rather than papering over them; show conflicting sources side by side, attribute each.
- **Pick the winning angle(s)** and drop the rest — don't dump everything you touched.

**Deliver:** lead with the answer in 1–3 sentences, cite every factual claim verbatim, and be honest about what you couldn't find.

---

## In one line

> **Intent** (real ask + answer shape) → **Restructure & fan out** (NL question → varied queries, in parallel, across every source that applies — Spaces, Google, code) → **Stay in the loop** (chase leads across sources; empty ≠ none; thin ≠ done) → **Converge** (open the real sources; dedupe; narrow on intent + what results surfaced; flag gaps).

## Anti-patterns — what these principles kill

- ❌ Pasting the asker's raw sentence into one search.
- ❌ One broad query → top snippet → answer.
- ❌ **Answering from the first source that returns a hit** — treating a lead as the answer instead of fanning out to the others.
- ❌ **Skipping code on a technical question** — checking only chat/mail for "what changed / why does it work this way / did it ship".
- ❌ Letting a source *word* ("email", "the PR", "doc") narrow you to one source when the fact lives in several.
- ❌ Firing independent searches one-at-a-time across turns instead of in parallel.
- ❌ **Stopping after one round** — handing back a thin/partial answer instead of chasing the leads it exposed.
- ❌ Reporting a silent zero without broadening and retrying first (empty ≠ none).
- ❌ Letting the search drag you onto a look-alike topic you weren't asked about.
- ❌ Answering from a snippet without opening the full source.
- ❌ Padding a thin result with filler instead of saying what's missing.
