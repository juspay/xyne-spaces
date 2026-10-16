# Category 5: Consistency and conventions

## What this category covers

Whether the same thing has the same name, the same look and the same
behaviour everywhere in the product, and whether the product behaves the way
the tools people already use have taught them to expect.

## The principle

### 8. One name, one behaviour, one wording everywhere, and follow the conventions people bring from the tools they already use

**What it means**

Two kinds of consistency matter.

Internal consistency: within the product, a person's chosen display name
shows on every surface; two dropdowns that do the same job behave the
same; the button that cancels is called "Cancel" in every modal; labels
use the same case and the same terms. Nielsen's heuristic #4 puts it as:
users should not have to wonder whether different words, situations or
actions mean the same thing.

External consistency: Jakob's law says users spend most of their time in
other products, so those products set their expectations. In chat tools
people expect Enter or Cmd+Enter to send, Shift+Enter to add a line, and
Tab or Enter to complete an @mention. When a key does something else,
their fingers are wrong before their eyes catch up. Apple's guidance is
blunt: do not redefine a standard shortcut.

The one caveat, from Grudin (1989): consistency with the user's task and
world matters more than consistency with the product's own internals.
If following an internal pattern would make a screen worse for its task,
the task wins. Keep exceptions few and deliberate.

**Why it matters**

Inconsistency makes people stop and ask "is this the same thing?" at
every step. Each stop is small, but there are hundreds a day. A different
name for the same person reads as a different person, or a bug. Research
on transfer (Polson and colleagues, 1986) shows people learn consistent
interfaces faster because what they learned on one screen carries to the
next. Lane et al. (2005) found that even expert users rarely adopt
keyboard shortcuts; non-standard ones make that worse.

**How to apply**

- Resolve a person's shown name in one shared function (display name,
  then full name, then account id). Never inline the fallback in a
  component. Test it on every surface: sidebar, mentions, notifications,
  email, exports.
- Keep one component per job. Two dropdowns means one dropdown component
  with two configurations.
- Keep a terms list (a content style guide): what we call things, what
  case we use, what the buttons say. Check copy against it in review.
- Match the platform and the category leaders for keys: Enter/Cmd+Enter
  to send, Shift+Enter for a new line, Tab/Enter to complete a mention,
  Escape to close, Cmd+Z to undo. Do not invent.
- When you must break a convention, do it on purpose, write down why, and
  tell the user the first time.
- Design tokens (named colours, sizes, spacing) are how consistency is
  enforced in code; a value typed by hand is a future inconsistency.

## The detailed rules behind this

- Show one name everywhere.
- Follow the conventions people already know.
- Choose the same control behaviour everywhere.
- Label wording must be identical across the product.

## Key readings and what each teaches

- Nielsen Norman Group, "Maintain Consistency and Adhere to Standards" (heuristic #4). The core rule with examples.
- Laws of UX, "Jakob's Law". Users bring expectations from other products.
- Shneiderman, "Eight Golden Rules", rule 1: strive for consistency.
- W3C, WCAG 2.2 success criteria 3.2.3 Consistent Navigation and 3.2.4 Consistent Identification. Consistency as a testable accessibility rule.
- Apple Human Interface Guidelines, "Keyboards" and "Writing". Standard shortcuts, and keep a terms list.
- Microsoft Writing Style Guide and Mailchimp Content Style Guide. Two public examples of the terms-and-case list every product needs.
- Grudin (1989), "The case against user interface consistency". The classic counterpoint: consistency with the user's world beats internal consistency. Read it before writing a style rule.
- Lane, Napier, Peres and Sandor (2005), "Hidden costs of graphical user interfaces". Experienced users still do not adopt shortcuts; conventions are the only hope.
- Polson, Muncher and Engelbeck (1986), "A test of a common elements theory of transfer". Why consistent interfaces are learned faster. Paywalled.
- Nielsen (Ed.) (1989), "Coordinating User Interfaces for Consistency". The book-length treatment, including Kellogg's "dimensions of consistency".

## A non-software way to think about it

Car pedals are in the same order in every model, so a driver can switch
cars without relearning. A hospital calls a patient by their preferred name
at every desk, not only at reception. A legal document uses one defined
term throughout.


---

# Reading list: Consistency and conventions

All links were opened and checked at the time of writing.

## Articles and guidelines

- [Maintain Consistency and Adhere to Standards, Usability Heuristic #4 (NN/G)](https://www.nngroup.com/articles/consistency-and-standards/)
- [10 Usability Heuristics for User Interface Design (NN/G)](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [Jakob's Law (Laws of UX)](https://lawsofux.com/jakobs-law/)
- [Jakob's Law of Internet User Experience (NN/G video)](https://www.nngroup.com/videos/jakobs-law-internet-ux/)
- [Top 10 Mistakes in Web Design (NN/G); mistake #2 is inconsistency](https://www.nngroup.com/articles/top-10-mistakes-web-design/)
- [The Eight Golden Rules of Interface Design (Ben Shneiderman); rule 1](https://www.cs.umd.edu/~ben/goldenrules.html)
- [First Principles of Interaction Design (Bruce Tognazzini); see Consistency](https://asktog.com/atc/principles-of-interaction-design/)
- [Understanding SC 3.2.4 Consistent Identification (W3C, WCAG 2.2)](https://www.w3.org/WAI/WCAG22/Understanding/consistent-identification.html)
- [Understanding SC 3.2.3 Consistent Navigation (W3C, WCAG 2.2)](https://www.w3.org/WAI/WCAG22/Understanding/consistent-navigation.html)
- [Keyboards (Apple Human Interface Guidelines); standard shortcuts](https://developer.apple.com/design/human-interface-guidelines/keyboards)
- [Writing (Apple Human Interface Guidelines); keep a list of common terms](https://developer.apple.com/design/human-interface-guidelines/writing)
- [Microsoft Writing Style Guide](https://learn.microsoft.com/en-us/style-guide/welcome/)
- [Mailchimp Content Style Guide](https://styleguide.mailchimp.com/)
- [Design Tokens Format Module (W3C Design Tokens Community Group)](https://www.designtokens.org/tr/drafts/format/)

## Papers

- Grudin, J. (1989). The case against user interface consistency. Communications of the ACM 32(10). [DOI](https://doi.org/10.1145/67933.67934)
- Lane, D. M., Napier, H. A., Peres, S. C., and Sandor, A. (2005). Hidden costs of graphical user interfaces: failure to make the transition from menus and icon toolbars to keyboard shortcuts. International Journal of Human-Computer Interaction 18(2). [DOI](https://doi.org/10.1207/s15327590ijhc1802_1)
- Polson, P. G., Muncher, E., and Engelbeck, G. (1986). A test of a common elements theory of transfer. CHI 1986. Paywalled. [DOI](https://doi.org/10.1145/22627.22352)
- Kellogg, W. A. (1987). Conceptual consistency in the user interface: effects on user performance. INTERACT 1987. Paywalled. [DOI](https://doi.org/10.1016/B978-0-444-70304-0.50068-6)
- Reisner, P. (1981). Formal grammar and human factors design of an interactive graphics system. IEEE Transactions on Software Engineering 7(2). Paywalled. [DOI](https://doi.org/10.1109/TSE.1981.234520)
- Nielsen, J. (Ed.) (1989). Coordinating User Interfaces for Consistency. Academic Press. Book. [Link](https://shop.elsevier.com/books/coordinating-user-interfaces-for-consistency/nielsen/978-0-12-518400-7)
