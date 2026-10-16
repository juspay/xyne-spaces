# Category 7: Trust, control and safety

## What this category covers

Whether people can tell what the system did and why, stay in charge of
automated and AI-made changes, see what they are allowed to see and know
when they are not, and recover from anything that destroys their work.
This category has grown in importance as more of the product acts on the
user's behalf.

## The principle

### 10. Let people see where a value came from, correct automated suggestions before they commit, and recover from anything destructive

**What it means**

Three ideas.

Legibility. A user should be able to tell what a thing is (an agent, a
skill, a rule), what it did, why, and what access it has. Microsoft's
Guidelines for Human-AI Interaction (Amershi et al., 2019) put it as:
make clear what the system can do (G1), how well it can do it (G2), and
why it did what it did (G11). A value that an AI produced must look
different from one a person typed, and both must be auditable.

Control. Automation should propose, and the person should dispose.
Horvitz's mixed-initiative principles and the HAX guideline "support
efficient correction" (G9) both say the user must be able to edit or
reject an automated suggestion before it takes effect, cheaply. Lee and
See's work on trust in automation shows trust must be calibrated: people
should rely on the system exactly as much as it deserves, which requires
the system to show its confidence and its mistakes.

Recoverability. Nielsen's heuristic #3 (user control and freedom) and
Shneiderman's rule 6 (permit easy reversal) say the same thing: any
action that removes or overwrites user work must be reversible, and the
way back must be easy to find. Confirmation dialogs alone are not enough
because people click through them; undo, trash and version history are
what actually save work. Before a delete, the system must say what else
depends on the thing being deleted.

**Why it matters**

Trust is the asset. A collaborative editor that loses a user's work once
is avoided for months. An AI assistant that commits changes without a
chance to edit is switched off. A permission system that hides things
without saying so makes people think the product is broken rather than
restricted. In each case the fix is cheap next to the cost.

**How to apply**

- Mark AI-generated values visibly and store their origin (who or what,
  when, from which input). Show a diff before the user accepts.
- Every automated action gets a review step with Edit, Accept and Reject,
  and an undo after acceptance.
- Describe each agent, skill and rule in one sentence where it is used:
  what it does, what it can write to, and what access it runs with.
- Keep server-side version history for every document and canvas, with
  a visible Restore action. Deleting moves to a trash with a retention
  window. Show Undo in the acknowledgement.
- In collaborative editing, scope undo to the user's own edits so one
  Cmd+Z never reverts another person's work or a whole page.
- Before a delete, list what depends on the item and what will happen
  to it. Make the consequence part of the confirmation, not a surprise.
- When access is restricted, say the thing exists and how to request
  access. Never show a blank or pretend it does not exist.

## The detailed rules behind this

- Let people correct automated suggestions before they commit.
- Make the origin of a value visible.
- Gate sensitive detail by role, and make the gating clear.
- Make the system's reasoning and rules legible.
- Make destructive or lossy actions recoverable.
- Spell out the consequence of deleting something.

## Key readings and what each teaches

- Amershi et al. (2019), "Guidelines for Human-AI Interaction" (CHI). The 18 guidelines, tested on 20 AI products. The single most useful source for this category. Companion site: Microsoft HAX Toolkit.
- Google PAIR, "People + AI Guidebook", chapters "Explainability + Trust" and "Feedback + Control". Practical patterns with examples.
- Liao, Gruen and Miller (2020), "Questioning the AI". What questions users actually ask of AI systems, and what explanations should answer.
- Lee and See (2004), "Trust in automation: designing for appropriate reliance". Why trust must be calibrated, not maximised.
- Horvitz (1999), "Principles of mixed-initiative user interfaces". The original rules for systems that act on your behalf.
- Shneiderman (2020), "Human-centered artificial intelligence: reliable, safe and trustworthy". High automation with high human control.
- Nielsen Norman Group, "User Control and Freedom" and "Confirmation Dialogs Can Prevent User Errors, If Not Overused". Why undo beats confirmation.
- Abowd and Dix (1992), "Giving undo attention". Undo as a user intention to support, including in shared editors.
- Apple Human Interface Guidelines, "Undo and redo". Name the undo, show the result, allow multiple levels.
- Bainbridge (1983), "Ironies of automation" and Parasuraman and Riley (1997), "Humans and automation: use, misuse, disuse, abuse". The classic warnings about what automation does to the humans around it. Paywalled.

## A non-software way to think about it

A doctor can amend an AI-drafted note before signing it. A lab report marks
which results were machine-read and which were entered by hand. A cloud
console says "this volume is attached to 2 servers" before you delete it.
A shared drive says a file is restricted instead of hiding it.


---

# Reading list: Trust, control and safety

All links were opened and checked at the time of writing.

## Articles and guidelines

- [Guidelines for Human-AI Interaction (Microsoft HAX Toolkit)](https://www.microsoft.com/en-us/haxtoolkit/ai-guidelines/): The 18 guidelines with examples.
- [HAX Design Library (Microsoft)](https://www.microsoft.com/en-us/haxtoolkit/library/)
- [Guideline 9: Support efficient correction (Microsoft HAX)](https://www.microsoft.com/en-us/haxtoolkit/guideline/support-efficient-correction/)
- [Guideline 11: Make clear why the system did what it did (Microsoft HAX)](https://www.microsoft.com/en-us/haxtoolkit/guideline/make-clear-why-the-system-did-what-it-did/)
- [People + AI Guidebook: Explainability + Trust (Google PAIR)](https://pair.withgoogle.com/chapter/explainability-trust/)
- [People + AI Guidebook: Feedback + Control (Google PAIR)](https://pair.withgoogle.com/chapter/feedback-controls/)
- [User Control and Freedom, Usability Heuristic #3 (NN/G)](https://www.nngroup.com/articles/user-control-and-freedom/)
- [Confirmation Dialogs Can Prevent User Errors, If Not Overused (NN/G)](https://www.nngroup.com/articles/confirmation-dialog/)
- [Error-Message Guidelines (NN/G); preserve the user's input](https://www.nngroup.com/articles/error-message-guidelines/)
- [The Eight Golden Rules of Interface Design (Ben Shneiderman); rule 6, permit easy reversal of actions](https://www.cs.umd.edu/~ben/goldenrules.html)
- [Undo and redo (Apple Human Interface Guidelines)](https://developer.apple.com/design/human-interface-guidelines/undo-and-redo)
- [Generative AI (Apple Human Interface Guidelines)](https://developer.apple.com/design/human-interface-guidelines/generative-ai)
- [Confirmation and acknowledgement (Material Design, archive)](https://material.io/archive/guidelines/patterns/confirmation-acknowledgement.html)
- [View a file's version history (Figma Help); a product example of restore](https://help.figma.com/hc/en-us/articles/360038006754-View-a-file-s-version-history)
- [Find what's changed in a file (Google Docs Help); version history](https://support.google.com/docs/answer/190843)
- [PROV Overview (W3C); a standard for recording where data came from](https://www.w3.org/TR/prov-overview/)
- [C2PA, content credentials; provenance for AI-generated media](https://c2pa.org/)
- [EU AI Act, Article 50, transparency obligations](https://eur-lex.europa.eu/eli/reg/2024/1689/oj)

## Papers

- Amershi, S., et al. (2019). Guidelines for Human-AI Interaction. CHI 2019. [DOI](https://doi.org/10.1145/3290605.3300233)
- Liao, Q. V., Gruen, D., and Miller, S. (2020). Questioning the AI: informing design practices for explainable AI user experiences. CHI 2020. [DOI](https://doi.org/10.1145/3313831.3376590)
- Lee, J. D., and See, K. A. (2004). Trust in automation: designing for appropriate reliance. Human Factors 46(1). [DOI](https://doi.org/10.1518/hfes.46.1.50_30392)
- Horvitz, E. (1999). Principles of mixed-initiative user interfaces. CHI 1999. [DOI](https://doi.org/10.1145/302979.303030)
- Shneiderman, B. (2020). Human-centered artificial intelligence: reliable, safe and trustworthy. International Journal of Human-Computer Interaction 36(6). [DOI](https://doi.org/10.1080/10447318.2020.1741118)
- Abowd, G. D., and Dix, A. J. (1992). Giving undo attention. Interacting with Computers 4(3). [DOI](https://doi.org/10.1016/0953-5438(92)90021-7)
- Berlage, T. (1994). A selective undo mechanism for graphical user interfaces based on command objects. ACM TOCHI 1(3). [DOI](https://doi.org/10.1145/196699.196721)
- Parasuraman, R., and Riley, V. (1997). Humans and automation: use, misuse, disuse, abuse. Human Factors 39(2). Paywalled. [DOI](https://doi.org/10.1518/001872097778543886)
- Bainbridge, L. (1983). Ironies of automation. Automatica 19(6). Paywalled. [DOI](https://doi.org/10.1016/0005-1098(83)90046-8)
- Shapiro, M., et al. (2011). Conflict-free replicated data types. SSS 2011. Open on HAL; download by hand. [Link](https://inria.hal.science/hal-00932836)
