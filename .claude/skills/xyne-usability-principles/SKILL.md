---
name: xyne-usability-principles
description: Ten UX principles, backed by Nielsen, WCAG and HCI research, for designing and for reviewing. Use this whenever the user wants to design, plan or spec a screen, flow or feature, or wants an existing design reviewed — a mockup, screenshot, Figma frame, prototype, or a live website or web app ("review this page", "what's wrong with this flow", "critique this design", "how should this screen work", "do a UX audit"). Use it even when the user doesn't say "UX" or "principles". Not for choosing visual styles, colour palettes or fonts.
---

# Xyne usability principles

Ten principles drawn from recurring product feedback and checked against
research. They exist because the same problems keep coming back: screens that
load forever, Back buttons that loop, features nobody finds, themes nobody
tested, automated changes nobody could edit first. Use them for two jobs:
designing something new, and reviewing something that exists. The walkthrough
is the method; the principles are the lens.

## The ten principles

Each has a sentence to remember and the checks that make it concrete. Use the
numbers: "it feels slow" is an opinion, "no feedback for 3 s after Save" is a
finding someone can fix.

### Performance — `references/1-performance.md`

1. **Speed is felt, not measured.** Show something within a second, and show progress for anything longer.
   - About 0.1 s feels instant; under 1 s needs no indicator; 1–10 s needs one; past 10 s needs percent done and a way to keep working.
   - Render the shell and cached data first. One slow query must not blank the whole page.
   - Uploads show bytes or percent. Search returns exact matches first, in under a second.
2. **What is on screen must match reality.** Stale views and silent delays cost trust, not just time.
   - Anything that can change behind the user (feeds, threads, counts) updates itself, or says "updated 2 min ago".
   - The user's own action shows at once and reconciles with the server afterwards.
   - Judge it on a slow network and a phone, not on office wifi.

### Flow — `references/2-flow.md`

3. **Judge the whole journey, not the screen.** Make the common path one action and keep the user's place when the view changes.
   - Count the main task's steps: clicks, fields, page changes, decisions. Every extra choice on the path slows people (Hick's law).
   - The default is the most common intent; the other options are one click away.
   - Scroll position, selected tab, filters and drafts survive mode changes, navigation and reload.
   - Nothing the user is looking at moves or reorders by itself; leave room for content that loads late.
4. **Never trap people.** Back always goes back, and every choice can be undone.
   - Back or Escape reverses every navigation-like change (a panel, a filter, a wizard step), and never loops.
   - Keep the main button enabled; on press, point at what's missing and focus it.
   - "Hide" and "dismiss" come with Undo, and a place to find hidden things again.

### States and feedback — `references/3-states-and-feedback.md`

5. **Every state needs a screen,** including empty, failed and no-access. Loading forever and blank errors are design failures.
   - Every view has: loading (with a message if it passes ~10 s), empty (why, and the first action), partial, error, no access (it exists, who can grant access, how to ask), and ideal.
   - "Empty" comes from the server's answer, never from "nothing has arrived yet".
6. **Never fail silently.** Say what went wrong in the user's language, and give a way out or a way to report it.
   - No raw error codes, no blank toasts: what happened, and what to do now.
   - Keep the user's input when showing an error. Offer "Report a problem" with the context attached.

### Discoverability — `references/4-discoverability.md`

7. **A feature nobody finds doesn't exist.** Put it where the user already is.
   - Actions sit next to the thing they act on. Hover-only controls have a visible fallback and a matching right-click menu.
   - Off-screen content shows that it exists: a cut-off card, "+3 more", a scroll shadow.
   - Teach at the moment of first use with a short hint that can be dismissed, not an upfront tour.
   - Explain a term or acronym where it first appears.

### Consistency — `references/5-consistency.md`

8. **One name, one behaviour, one wording everywhere,** and follow the conventions people bring from the tools they already use.
   - The same person has the same name on every surface; the same job uses the same control; the same button has the same label and case.
   - Standard keys: Enter or Cmd+Enter sends, Shift+Enter adds a line, Tab or Enter completes a mention, Escape closes, Cmd+Z undoes. Don't redefine them.
   - Fitting the user's task beats matching our own internals (Grudin). Break a convention only on purpose, and tell the user the first time.

### Visual design and accessibility — `references/6-visual-and-accessibility.md`

9. **Visual weight should match importance,** and contrast, dark mode, hover behaviour and touch size are requirements to check in every theme, not polish.
   - An indicator is lighter than what it marks. Helper UI (typing indicators, banners, toasts) never covers the content it helps with.
   - Contrast of at least 4.5:1 for text and 3:1 for large text and controls, in every theme, not only the default.
   - Hover cards wait about 0.5–1 s, stay open while hovered, and close on Escape.
   - Targets are at least 24×24 px, and 44×44 for touch.

### Trust, control and safety — `references/7-trust.md`

10. **Let people see where a value came from, correct automated suggestions before they commit, and recover from anything destructive.**
    - Values made by AI or rules look different from typed ones. Before anything is applied there's a preview with Edit, Accept and Reject, and Undo afterwards.
    - Each agent, rule or skill says in one line what it does and what it can change.
    - A delete says what depends on the item. Trash, version history and a visible Restore protect work better than a confirmation dialog.
    - In shared editing, Undo reverts only the user's own changes.

## Reviewing a design or website

A review should end in a short list of problems a team can act on, the most
important first, each tied to a principle so the reasoning is visible. Forty nits
bury the three things that matter.

1. **Work with the real thing.** Establish what is being reviewed, who uses it, and what they come to do. If it's a URL and you have a browser tool, use the site rather than only looking at it:
   - do the main task end to end;
   - press Back after each step, and close overlays with Escape;
   - try an empty search and a wrong input;
   - narrow the window to phone width;
   - switch to dark mode if the site offers it.

   If you only have screenshots or a Figma frame, review what's visible. List what only a live product can show (speed, Back, hover timing, focus order) under "Couldn't check" instead of guessing.
2. **Walk the main journey first** (principle 3). Write down the steps the main task takes. Flow problems outrank screen problems, because they repeat every time someone does the task.
3. **Then go through principles 1–10 screen by screen** using the checks above. Open the matching reference file when a principle is central to a finding, or when you need its evidence, numbers or sources.
4. **Rank by what it costs the user:**
   - **Blocker**: the user can't finish the task, loses work, or is misled about what happened. Examples: a silent failure, a dead end, a Back loop.
   - **Major**: costs trust or time on the main path, or shuts some people out. Examples: stale data; a missing error, empty or no-access state; contrast failing in a theme; a hidden main action.
   - **Minor**: friction off the main path, or an inconsistency. Examples: two names for one thing, an extra step, a small target.
   - **Polish**: worth doing when someone is working nearby.
5. **Write it up** in this shape:

```
## UX review: <what was reviewed>
For <who> doing <main task>. Reviewed from <live site / screenshots / Figma>.

### Main journey
<the steps, numbered, marking where it breaks or drags>

### Findings
1. **<Blocker | Major | Minor | Polish>: <short title>** (principle N)
   Where: <screen or element>
   What happens: <what the user sees or does>
   Why it matters: <one sentence, with the number or rule where there is one>
   Fix: <a concrete change>

### What works
<two to four things to keep, so nobody "fixes" them away>

### Couldn't check
<what needs a live product, real data or a test with users>
```

Make every finding something a designer or engineer could act on today.

## Designing a screen, flow or feature

Designs fail less from bad ideas than from missing cases: the empty state, the error,
the way back, the dark theme. Walking the principles in order surfaces those cases
while they are still cheap to handle.

1. **Outcome first.** Who is this for, what are they trying to get done, and what signal will show it worked (task success, time taken, adoption)? If the user hasn't said, propose one and mark it as an assumption.
2. **Options before a choice.** When the direction is open, outline two or three different approaches in a line or two each. Then pick one against the outcome and say why, rather than polishing the first idea.
3. **The flow.** List the main task's steps and cut them down: the best default, one action for the common case, and the user's place kept across changes (principle 3). Mark where Back and Escape go from each step, and what can be undone (principle 4).
4. **Every state of every screen** (principle 5): loading, empty, partial, error, no access and ideal, each with what it shows and says. Add timing: what appears within a second, and what shows progress (principle 1). Say how the view stays current (principle 2).
5. **Failure paths** (principle 6): everything that can go wrong, the message in plain words, and what the user can do next.
6. **How people find it** (principle 7): entry points where the user already is, cues for content off-screen, help at first use, and terms explained.
7. **Words and behaviour** (principle 8): names and labels that match the rest of the product, and standard keys.
8. **Look and access** (principle 9): the heaviest thing on each screen should be the most important one. Check contrast in every theme, target sizes and hover timing.
9. **Automation and deletion** (principle 10): for anything made by AI or rules, how the user sees it, edits it and rejects it. For anything destructive, what it affects and how to undo or restore it.

Deliver the design in this shape:

```
## <Feature>: design
Goal: <user outcome> · Signal: <how we'll know it worked>

### Options considered
<two or three approaches, the one chosen, and why>

### Flow
<numbered steps; for each, what the user does, what they see, and where Back goes>

### Screens
<per screen: its purpose, the layout in words or a rough sketch, then its states>
| State     | What shows | Copy |
|-----------|------------|------|
| Loading   |            |      |
| Empty     |            |      |
| Partial   |            |      |
| Error     |            |      |
| No access |            |      |
| Ideal     |            |      |

### Copy
<labels, buttons and messages, in the product's existing terms>

### Open questions
<what still needs a decision or a test with users>
```

Scale it to the request: a single dialog needs a few lines per section, a new
feature needs all of it. If the user wants it built rather than specified, still
settle the states and failure paths first, then build them in.

## When principles pull against each other

They sometimes do. Fewer steps (3) can clash with safety (10), and consistency (8)
can clash with what suits this particular task. Protect the user's work and trust
first, then the main task's speed, then consistency. An Undo usually settles the
first clash better than a confirmation dialog. Say which way you leaned and why.

## Sources

Each file in `references/` is the full write-up for its category. It has the
reasoning, how to apply the principle, the key numbers, and a reading list with
links. When the user asks why, or wants a source, quote from these rather than
from memory.
