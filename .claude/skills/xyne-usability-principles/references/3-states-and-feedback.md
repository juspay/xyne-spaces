# Category 3: States and feedback

## What this category covers

What the screen shows in every condition a view can be in, and how the
product tells the user what happened after they act. Most bugs that users
call "the page is broken" are not crashes. They are states nobody designed:
a list that is still "Loading..." after the server said "empty", a toast with
no text, a raw error code, a board the user cannot open that shows nothing.

## The two principles

### 5. Every state needs a screen, including empty, failed and no-access

*Loading forever and blank errors are design failures.*

**What it means**

Scott Hurff's "UI Stack" names five states every screen has: blank
(nothing yet), loading, partial (some data), error, and ideal. Designers
and engineers usually build only the ideal state. The others get whatever
the code does by accident. The rule is simple: for each screen, write down
all five states and design each one on purpose. "No access" is a sixth
state in any product with permissions, and it needs its own screen that
says the thing exists and how to ask for access.

**Why it matters**

The user cannot tell "still loading" from "loaded, and there is nothing"
unless you tell them. A spinner that never stops looks like a hang. A table
with bare headers looks like a failed query. A blank where a board should
be looks like a bug. Each of these costs a support ticket and a little
trust, and they are cheap to fix once they are designed.

**How to apply**

- For every screen, fill in a six-row state matrix before building:
  - **loading**: skeleton or spinner, with a timeout message after 10 s
  - **empty**: explain why it is empty and offer the first action
  - **partial**: show what arrived, mark what is still coming
  - **error**: plain-language message, what to do next, how to report
  - **no access**: say it exists, who can grant access, and how to ask
  - **ideal**: the happy path
- Derive "empty" from the server's answer, never from "no items yet".
- A toast with no message must not render. Fall back to a generic message.
- Compute button enabled/disabled from the live form state, not from a
  counter kept beside it. Better: keep it enabled and validate on submit.

### 6. Never fail silently

*If something went wrong, say so in the user's language and give them a way out or a way to report it.*

**What it means**

Shneiderman's golden rule is "offer informative feedback": every action
should produce a response. Nielsen's heuristic #9 says error messages
should be in plain language, state the problem precisely, and suggest a
solution. Raw API output ("E09 / Could not find resource") is a message for
the developer, not the user. And when something fails for the user, the
fastest path to a fix is a "report this" action that carries the context
(URL, user, stack trace) with it.

**Why it matters**

Silent failure is the worst case: the user thinks it worked. A notification
that is dropped with no error, a message that never arrives, or a delete
that silently does not persist all break the user's model of what the
product did. Even a loud failure is better, and a loud failure with a way
out is best.

**How to apply**

- Every failure path needs a user-visible outcome. If delivery fails,
  retry, then tell the user, then log it. Never only log it.
- Map every backend error code to a human sentence: what happened, what
  the user can do. Unknown codes get a generic sentence, never the code.
- Preserve the user's input when showing an error so they fix, not redo.
- Put a "Report a problem" action in the error itself, prefilled with
  context, so the report costs the user one click.
- Audit notification paths end to end on each platform (web, mobile,
  email) with a test user who has each permission combination.

## The detailed rules behind these

- Never fail silently.
- Tell "still loading" apart from "loaded, and there's nothing".
- Never show an empty error.
- Every state needs a screen, including "no access".
- An error that exposes raw API output is a failure of design.
- Give the user a way to report the problem from the error itself.
- A form that depends on a hidden state breaks in surprising ways.

## Key readings and what each teaches

- Scott Hurff, "The UI Stack" (2015). The five states every screen has. Start here; it is a ten-minute read that changes how you spec screens.
- Nielsen Norman Group, "Error-Message Guidelines". Visible, plain language, precise, constructive, polite, and keep the user's input.
- Nielsen Norman Group, "Designing Empty States in Complex Applications". Three guidelines for empty states.
- Material Design, "Empty states". Google's pattern page, with examples.
- GOV.UK Design System, "Error message" and "Validation". The most tested public pattern for form errors.
- Shneiderman (1982), "Designing computer system messages". The classic study on message wording: specific, constructive, positive tone. Paywalled.
- Norman (1983), "Design rules based on analyses of human error". Slips vs mistakes, and why systems must expect both. Paywalled.
- Bargas-Avila et al. (2010), "20 guidelines for usable web form design". Open access. Includes where and when to show errors.
- Seckler et al. (2014), "Designing usable web forms". Tested those guidelines empirically.
- Nielsen and Molich (1990), "Heuristic evaluation of user interfaces". The origin of walking a screen against a checklist, which is how unhandled states get found.

## A non-software way to think about it

A courier leaves a "missed delivery" card instead of quietly returning the
parcel. A search page says "No results for 'x'" instead of spinning forever.
A shop says "We couldn't find that item" instead of "404 NULL".


---

# Reading list: States and feedback

All links were opened and checked at the time of writing.

## Articles and guidelines

- [How to fix a bad user interface: The UI Stack (scotthurff.com)](https://www.scotthurff.com/posts/why-your-user-interface-is-awkward-youre-ignoring-the-ui-stack/): The five states every screen has: blank, loading, partial, error, ideal.
- [Error-Message Guidelines (NN/G)](https://www.nngroup.com/articles/error-message-guidelines/): Visible, plain language, precise, constructive, preserve input.
- [Visibility of System Status, Usability Heuristic #1 (NN/G)](https://www.nngroup.com/articles/visibility-system-status/)
- [10 Usability Heuristics for User Interface Design (NN/G)](https://www.nngroup.com/articles/ten-usability-heuristics/): Heuristics #1, #5 and #9 cover feedback, prevention and recovery.
- [Designing Empty States in Complex Applications: 3 Guidelines (NN/G)](https://www.nngroup.com/articles/empty-state-interface-design/)
- [Empty states (Material Design 2)](https://m2.material.io/design/communication/empty-states.html)
- [Empty states (Material Design 1, archived)](https://m1.material.io/patterns/empty-states.html)
- [Empty states pattern (IBM Carbon Design System)](https://carbondesignsystem.com/patterns/empty-states-pattern/)
- [Validation pattern (GOV.UK Design System)](https://design-system.service.gov.uk/patterns/validation/)
- [Error summary component (GOV.UK Design System)](https://design-system.service.gov.uk/components/error-summary/)
- [Confirmation Dialogs Can Prevent User Errors, If Not Overused (NN/G)](https://www.nngroup.com/articles/confirmation-dialog/)
- [The Eight Golden Rules of Interface Design (Ben Shneiderman)](https://www.cs.umd.edu/~ben/goldenrules.html): Rule 3: offer informative feedback. Rule 5: prevent errors.

## Papers

- Shneiderman, B. (1982). Designing computer system messages. Communications of the ACM 25(9). Paywalled. [DOI](https://doi.org/10.1145/358628.358639)
- Norman, D. A. (1983). Design rules based on analyses of human error. Communications of the ACM 26(4). Paywalled. [DOI](https://doi.org/10.1145/2163.358092)
- Lewis, C., and Norman, D. A. (1986). Designing for error. In Norman and Draper (Eds.), User Centered System Design. Book chapter. [Link](https://www.routledge.com/User-Centered-System-Design-New-Perspectives-on-Human-computer-Interaction/Norman-Draper/p/book/9780898598728)
- Reason, J. (1990). Human Error. Cambridge University Press. Book. [DOI](https://doi.org/10.1017/CBO9781139062367)
- Nielsen, J., and Molich, R. (1990). Heuristic evaluation of user interfaces. CHI 1990. Paywalled. [DOI](https://doi.org/10.1145/97243.97281)
- Bargas-Avila, J. A., et al. (2010). Simple but crucial user interfaces in the World Wide Web: introducing 20 guidelines for usable web form design. In User Interfaces (IntechOpen). Open access, CC BY-NC-SA. [Link](https://www.intechopen.com/chapters/10814)
- Seckler, M., Heinz, S., Bargas-Avila, J. A., Opwis, K., and Tuch, A. N. (2014). Designing usable web forms: empirical evaluation of web form improvement guidelines. CHI 2014. [DOI](https://doi.org/10.1145/2556288.2557265)
- Bargas-Avila, J. A., et al. (2007). Usable error message presentation in the World Wide Web: do not show errors right away. Interacting with Computers 19(3). Paywalled. [DOI](https://doi.org/10.1016/j.intcom.2007.01.003)
