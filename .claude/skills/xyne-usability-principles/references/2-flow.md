# Category 2: Flow and navigation

## What this category covers

How a person moves from intent to outcome: how many steps it takes, whether
they keep their place, whether they can always get back, and whether the
product respects the decisions they have already made. This is where
Juspay's stated principle "Master the flow" lives.

## The two principles

### 3. Judge the whole journey, not the screen

*Make the common path one action and keep the user's place when the view changes.*

**What it means**

A screen can be perfect and the flow still bad. What matters is the
sequence: how many clicks, how many decisions, how many times the user has
to re-find where they were. The keystroke-level model (Card, Moran and
Newell, 1980) gives you a way to count this: every keystroke, pointer
move, and mental pause has a cost, and the total is the cost of the flow.
Hick's law covers each single decision: the more options it offers, the
longer it takes to choose, so keep the choices on the main path few. Defaults matter because
most users never change them (Nielsen, "The Power of Defaults"): a good
default makes the common case one action.

**Why it matters**

Friction compounds. A task people do ten times a day that costs three
extra steps costs thirty steps a day, and people notice it as "this tool
is annoying" without being able to say why. Losing your place when a view
changes is worse: the user has to rebuild their context from scratch.

**How to apply**

- For each key task, write down the steps today and the steps it should
  take. Count clicks, fields, and page changes.
- Pick the default that matches the most common intent; put the other
  options one click away, not on the main path.
- Preserve scroll position, selected tab, filters and draft text across
  mode changes, navigation and reload.
- Never move or reorder what the user is looking at. Reserve space for
  late-loading content so nothing jumps (Google measures this as
  Cumulative Layout Shift).
- Let users choose list order, and remember the choice.
- Review flows end to end in a walkthrough, not screen by screen.

### 4. Never trap people

*Back always goes back, and every choice can be undone.*

**What it means**

Nielsen's third heuristic is user control and freedom: users often choose
functions by mistake and need a clearly marked emergency exit. The back
button is the most used emergency exit on the web, and people expect it to
undo the last navigation-like change, including overlays, filters and
steps in a flow (Baymard). A choice that cannot be reversed, such as
dismissing a notification or filtering something out, makes people
hesitate before every choice.

**Why it matters**

Fear of being stuck changes behaviour. People stop exploring, open things
in new tabs "just in case", and avoid features they cannot see the way out
of. A broken back button is rated high severity by users because it breaks
the one habit they rely on everywhere.

**How to apply**

- Every navigation-like change (open a panel, apply a filter, step in a
  wizard) must be reversible with Back or Escape, and must never loop.
- Do not disable the main action. Let the user press it, then show exactly
  what is missing, next to the field, and focus it (GOV.UK validation
  pattern).
- Any "hide this" or "dismiss" action gets an undo in the acknowledgement
  and a place where hidden items can be found again.
- Test the browser back button on every route, including after search and
  after opening something in a modal.

## The detailed rules behind these

- Keep the user's context when the view changes.
- Don't move things the user is looking at.
- Let people say "not for me", and make it reversible.
- Don't disable the main action; validate when the user submits.
- The back button must always go back.
- Let the user choose how a list is ordered.
- Master the flow (Juspay stated principle).

## Key readings and what each teaches

- Card, Moran and Newell (1980), "The keystroke-level model". How to count the cost of a flow in operators.
- Hick (1952), "On the rate of gain of information". Decision time rises with the log of the number of choices. Paywalled; summary at Laws of UX.
- Nielsen, "The Power of Defaults" (NN/G). Users rarely change defaults, so the default is the design.
- Nielsen Norman Group, "User Control and Freedom" (heuristic #3). Emergency exits, undo, and why back must work.
- Baymard, "Back Button Expectations". What users expect Back to undo on modern sites (overlays, filters, accordion steps).
- Weinreich et al. (2006), "Off the beaten tracks". Measured how much web navigation is the back button and how it changed over a decade.
- Mitchell and Shneiderman (1989), "Dynamic versus static menus". Menus that reorder themselves were slower and disliked: do not move things.
- Sears and Shneiderman (1994), "Split menus". How to put frequent items first without moving the rest.
- GOV.UK Design System, "Validation" and "Error summary". Validate on submit, list errors at the top, link each to its field.
- Adam Silver, "The problem with disabled buttons and what to do instead". The practitioner case for not disabling the main action.
- Google web.dev, "Cumulative Layout Shift". The measurable form of "don't move what the user is looking at".

## A non-software way to think about it

A bank branch pre-fills the standard form for the most common request. A
supermarket does not rearrange its aisles every week. A paper form where the
clerk circles the missing line instead of refusing to take it.


---

# Reading list: Flow and navigation

All links were opened and checked at the time of writing.

## Articles and guidelines

- [User Control and Freedom, Usability Heuristic #3 (NN/G)](https://www.nngroup.com/articles/user-control-and-freedom/): Emergency exits, undo and redo, back must work.
- [The Power of Defaults (NN/G)](https://www.nngroup.com/articles/the-power-of-defaults/): Users rarely change defaults; choose them for the common intent.
- [Hick's Law (Laws of UX)](https://lawsofux.com/hicks-law/): Decision time grows with the number and complexity of choices.
- [Tesler's Law (Laws of UX)](https://lawsofux.com/teslers-law/): Complexity cannot be removed, only moved; keep it off the user's path.
- [Back Button Expectations (Baymard Institute)](https://baymard.com/blog/back-button-expectations): What users expect the back button to undo on modern sites.
- [Validation pattern (GOV.UK Design System)](https://design-system.service.gov.uk/patterns/validation/): Validate on submit, show errors next to fields, do not disable the button.
- [Error summary component (GOV.UK Design System)](https://design-system.service.gov.uk/components/error-summary/): List all errors at the top and link each to its field.
- [The problem with disabled buttons and what to do instead (adamsilver.io)](https://adamsilver.io/blog/the-problem-with-disabled-buttons-and-what-to-do-instead/): Why disabled submit buttons hurt and what to do instead.
- [Disabled buttons suck (Axess Lab)](https://axesslab.com/disabled-buttons-suck/): Accessibility case against disabled buttons.
- [Why Disabled Buttons Hurt UX, and How to Fix Them (NN/G video)](https://www.nngroup.com/videos/why-disabled-buttons-hurt-ux-and-how-to-fix-them/)
- [Cumulative Layout Shift (Google, web.dev)](https://web.dev/articles/cls): Measures content jumping while the user is looking at it.
- [Optimize Cumulative Layout Shift (Google, web.dev)](https://web.dev/articles/optimize-cls): How to reserve space so nothing moves.
- [Opening Links in New Browser Windows and Tabs (NN/G)](https://www.nngroup.com/articles/new-browser-windows-and-tabs/): Why breaking the back button is a top mistake.

## Papers

- Card, S. K., Moran, T. P., and Newell, A. (1980). The keystroke-level model for user performance time with interactive systems. Communications of the ACM 23(7). [DOI](https://doi.org/10.1145/358886.358895)
- Hick, W. E. (1952). On the rate of gain of information. Quarterly Journal of Experimental Psychology 4(1). Paywalled. [DOI](https://doi.org/10.1080/17470215208416600)
- Weinreich, H., Obendorf, H., Herder, E., and Mayer, M. (2006). Off the beaten tracks: exploring three aspects of web navigation. WWW 2006. [DOI](https://doi.org/10.1145/1135777.1135802)
- Cockburn, A., and McKenzie, B. (2001). What do web users do? An empirical analysis of web use. International Journal of Human-Computer Studies 54(6). [DOI](https://doi.org/10.1006/ijhc.2001.0459)
- Catledge, L. D., and Pitkow, J. E. (1995). Characterizing browsing strategies in the World-Wide Web. WWW 1995. Full text free as HTML. [Link](https://archives.iw3c2.org/www3/proceedings/papers/80/userpatterns/UserPatterns.Paper4.formatted.html)
- Mitchell, J., and Shneiderman, B. (1989). Dynamic versus static menus: an exploratory comparison. SIGCHI Bulletin 20(4). [DOI](https://doi.org/10.1145/67243.67247)
- Sears, A., and Shneiderman, B. (1994). Split menus: effectively using selection frequency to organize menus. ACM TOCHI 1(1). [DOI](https://doi.org/10.1145/174630.174632)
- Sweller, J. (1988). Cognitive load during problem solving: effects on learning. Cognitive Science 12(2). Paywalled. [DOI](https://doi.org/10.1207/s15516709cog1202_4)
