# Category 6: Visual design and accessibility

## What this category covers

How visual weight guides attention, and the hard requirements that make a
product usable by everyone: contrast, themes, hover behaviour and the size
of things people have to hit. Most of this category has numbers attached,
because accessibility standards are testable.

## The principle

### 9. Visual weight should match importance, and contrast, dark mode, hover behaviour and touch size are requirements to test in every theme, not polish

**What it means**

Two halves.

Visual hierarchy. The eye is pulled by colour, size, contrast and motion
before the mind decides what to look at (Wolfe and Horowitz; Healey and
Enns). So the heaviest element on a screen is the one the user will read
first, whether you meant it or not. An indicator that is heavier than the
content it points to steals attention from the content. A helper element
(a typing indicator, a banner, a tooltip) that covers content defeats its
own purpose.

Accessibility requirements. WCAG 2.2 sets testable minimums: 4.5:1
contrast for normal text and 3:1 for large text and UI components; hover
content must be dismissable, hoverable and persistent; interactive targets
must be at least 24 by 24 CSS pixels (AA) and 44 by 44 for the stricter
AAA level. Platform guides go further: Apple's default control is 44 pt,
Android's is 48 dp. These are not polish because every theme the product
ships must meet them, and a theme that was never tested will not.

**Why it matters**

Contrast failures lock out users with low vision and annoy everyone in
sunlight. Small targets cause mis-taps on phones; Parhi, Karlson and
Bederson found thumb targets need roughly 9 to 10 mm. Hover popups that
fire instantly are noise; popups that cover content are worse. A theme
with an undefined token renders transparent or unreadable, and users on
that theme see a broken product while every tester on the default sees
nothing wrong.

**How to apply**

- Give every indicator less weight than what it marks: thinner, lighter,
  or smaller. Never overlap content with an indicator.
- Place helper UI (typing indicators, banners, toasts) outside the content
  area, or make it push content rather than cover it.
- Every design token must have a value in every theme. Add a check that
  fails the build when a theme is missing a token.
- Run contrast checks (4.5:1 text, 3:1 components) against each theme, not
  only the default. Chromatic or Storybook "modes" can snapshot every
  theme automatically.
- Hover cards and tooltips: delay about 0.5 to 1 s before showing, keep
  them open while hovered, and let Escape dismiss them (WCAG 1.4.13).
- Interactive targets: at least 24 px with spacing, aim for 44 px on touch.
- Test in dark mode and on a phone before sign-off, every time.

## The detailed rules behind this

- Visual weight should match importance.
- Make sure every theme is tested, not only the default.
- Treat contrast and dark mode as a requirement, not polish.
- Don't let helper UI hide what it's helping with.
- Delay hover-triggered popups.
- Controls should have reasonable touch targets.

## Numbers to remember

| Value | Meaning | Source |
|-------|---------|--------|
| 4.5:1 | contrast for normal text | WCAG 2.2 SC 1.4.3 (AA) |
| 3:1 | contrast for large text, UI components | WCAG 2.2 SC 1.4.3, 1.4.11 |
| 24x24 px | minimum target size | WCAG 2.2 SC 2.5.8 (AA) |
| 44x44 px | enhanced target size | WCAG 2.2 SC 2.5.5 (AAA) |
| 44 pt | Apple default control size (28 pt min) | Apple HIG, Accessibility |
| 48 dp | Android touch target | Android developer docs |
| ~9 mm | thumb target on small touchscreens | Parhi, Karlson, Bederson 2006 |
| 0.5 s | default tooltip delay on Windows | Microsoft Win32 guidelines |

## Key readings and what each teaches

- W3C, WCAG 2.2 "Understanding" pages for 1.4.3, 1.4.11, 1.4.13, 2.5.5 and 2.5.8. The testable rules, with the reasoning behind each.
- Nielsen Norman Group, "Visual Hierarchy". How weight, size and position direct attention.
- Nielsen Norman Group, "Dark Mode vs. Light Mode: Which Is Better?". The research summary: light mode wins on reading performance for most people, dark mode matters for some users and contexts, so support both and test both.
- Nielsen Norman Group, "Touch Target Size" and "Tooltip Guidelines". Practical rules for targets and hover content.
- Fitts (1954) and MacKenzie (1992). The law behind target size: time to hit a target depends on its size and distance.
- Parhi, Karlson and Bederson (2006), "Target size study for one-handed thumb use". Where the 9 to 10 mm number comes from.
- Wolfe and Horowitz (2004, 2017). What visual features capture attention before you decide to look. The science behind visual weight.
- Healey and Enns (2012), "Attention and visual memory in visualization". Preattentive features applied to screens.
- Piepenbrock et al. (2013), Buchner and Baumgartner (2007). Dark text on light background reads better for most people. Paywalled.

## A non-software way to think about it

A road sign must not block the view of the junction it warns about, and it
must be legible at night. A stove knob should be big enough to turn with
oven gloves. A print layout is checked in black and white as well as colour.


---

# Reading list: Visual design and accessibility

All links were opened and checked at the time of writing.

## Standards

- [Understanding SC 1.4.3 Contrast (Minimum) (W3C, WCAG 2.2)](https://www.w3.org/WAI/WCAG22/Understanding/contrast-minimum.html)
- [Understanding SC 1.4.11 Non-text Contrast (W3C, WCAG 2.2)](https://www.w3.org/WAI/WCAG22/Understanding/non-text-contrast.html)
- [Understanding SC 1.4.13 Content on Hover or Focus (W3C, WCAG 2.2)](https://www.w3.org/WAI/WCAG22/Understanding/content-on-hover-or-focus.html)
- [Understanding SC 2.5.8 Target Size (Minimum) (W3C, WCAG 2.2)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-minimum.html)
- [Understanding SC 2.5.5 Target Size (Enhanced) (W3C, WCAG 2.2)](https://www.w3.org/WAI/WCAG22/Understanding/target-size-enhanced.html)

## Articles and guidelines

- [Visual Hierarchy (NN/G)](https://www.nngroup.com/articles/visual-hierarchy-ux-definition/)
- [Dark Mode vs. Light Mode: Which Is Better? (NN/G)](https://www.nngroup.com/articles/dark-mode/)
- [Touch Target Size (NN/G)](https://www.nngroup.com/articles/touch-target-size/)
- [Tooltip Guidelines (NN/G)](https://www.nngroup.com/articles/tooltip-guidelines/)
- [Buttons (Apple Human Interface Guidelines); 44 by 44 pt](https://developer.apple.com/design/human-interface-guidelines/buttons)
- [Accessibility (Apple Human Interface Guidelines); control sizes](https://developer.apple.com/design/human-interface-guidelines/accessibility)
- [Accessible tap targets (Google, web.dev); 48 px with 8 px gap](https://web.dev/articles/accessible-tap-targets)
- [Tooltips (Microsoft Win32 design guidelines); delays and placement](https://learn.microsoft.com/en-us/windows/win32/uxguide/ctrl-tooltips-and-infotips)
- [Chromatic: Modes (test every theme automatically)](https://www.chromatic.com/docs/modes/)
- [Storybook: Visual tests](https://storybook.js.org/docs/writing-tests/visual-testing)
- [Design Tokens Format Module (W3C Design Tokens Community Group)](https://www.designtokens.org/tr/drafts/format/)

## Papers

- Fitts, P. M. (1954). The information capacity of the human motor system in controlling the amplitude of movement. Journal of Experimental Psychology 47(6). [DOI](https://doi.org/10.1037/h0055392)
- MacKenzie, I. S. (1992). Fitts' law as a research and design tool in human-computer interaction. Human-Computer Interaction 7(1). [DOI](https://doi.org/10.1207/s15327051hci0701_3)
- Parhi, P., Karlson, A. K., and Bederson, B. B. (2006). Target size study for one-handed thumb use on small touchscreen devices. MobileHCI 2006. [DOI](https://doi.org/10.1145/1152215.1152260)
- Wolfe, J. M., and Horowitz, T. S. (2004). What attributes guide the deployment of visual attention and how do they do it? Nature Reviews Neuroscience 5. [DOI](https://doi.org/10.1038/nrn1411)
- Wolfe, J. M., and Horowitz, T. S. (2017). Five factors that guide attention in visual search. Nature Human Behaviour 1. [DOI](https://doi.org/10.1038/s41562-017-0058)
- Healey, C. G., and Enns, J. T. (2012). Attention and visual memory in visualization and computer graphics. IEEE TVCG 18(7). [DOI](https://doi.org/10.1109/TVCG.2011.127)
- Piepenbrock, C., Mayr, S., Mund, I., and Buchner, A. (2013). Positive display polarity is advantageous for both younger and older adults. Ergonomics 56(7). Paywalled. [DOI](https://doi.org/10.1080/00140139.2013.790485)
- Buchner, A., and Baumgartner, N. (2007). Text-background polarity affects performance irrespective of ambient illumination and colour contrast. Ergonomics 50(7). Paywalled. [DOI](https://doi.org/10.1080/00140130701306413)
- Wertheimer, M. (1923). Laws of organization in perceptual forms. English translation free as HTML. [Link](https://psychclassics.yorku.ca/Wertheimer/Forms/forms.htm)
