# Category 1: Performance and responsiveness

## What this category covers

How fast the product feels, whether what is on screen is current, and what the
user sees while they wait. Performance here is a design subject, not only an
engineering one. The same server time can feel instant or broken depending on
what the interface does during the wait.

## The two principles

### 1. Speed is felt, not measured

*Show something within a second, and show progress for anything longer.*

**What it means**

People do not experience milliseconds. They experience whether the thing
responded to them. Research since the 1960s agrees on three thresholds:
about 0.1 second feels instant, about 1 second keeps the user's train of
thought, and about 10 seconds is the limit of attention. Below 1 second you
need no feedback. Between 1 and 10 seconds you need an indicator that the
system is working. Past 10 seconds you need a percent-done indicator and
a way to do something else meanwhile.

**Why it matters**

A delay with no feedback reads as a failure. Users retry, double-submit, or
leave. Doherty and Thadani showed in 1982 that when response time dropped
under about 400 ms, people's own productivity rose more than the time saved,
because they stayed in flow. The reverse is also true: a slow product makes
its users slower than the delay alone explains.

**How to apply**

- Measure the 95th percentile, not the average, for every user-facing wait.
- Under 1 s: no spinner. 1 to 10 s: an indeterminate indicator. Over 10 s:
  a determinate progress bar with percent or remaining count.
- Render what you already have first (the shell, cached data, the cart),
  then fill in the slow parts. Never block the whole page for one query.
- For uploads, show bytes or percent, and let the user keep working.
- Search: return exact matches first, under 1 s, with suggestions as you
  type.

### 2. What is on screen must match reality

*Stale views and silent delays cost trust, not just time.*

**What it means**

A view that does not update when the world changes is lying. A thread that
does not show a new reply, a feed that needs a manual refresh, or a frozen
screen all teach the user that the product cannot be relied on. Nielsen's
first heuristic, visibility of system status, is exactly this: keep users
informed about what is going on through appropriate feedback within a
reasonable time.

**Why it matters**

Trust is cumulative and asymmetric. One stale screen makes users doubt
every screen. Once they start pressing refresh "just to be sure", every
interaction costs them an extra step and you have lost the value of a
live product.

**How to apply**

- Every list or feed that can change behind the user needs a push update,
  polling, or at least a visible "updated 2 min ago, refresh" marker.
- Use stale-while-revalidate: show the cached version at once, fetch the
  fresh one, and swap it in without moving the user's place.
- Use optimistic updates for the user's own actions (their message appears
  immediately) and reconcile with the server afterwards.
- Test on a throttled connection (Chrome DevTools "Slow 3G") and on a phone
  before calling anything done. Design for the worst network, not the best.

## The detailed rules behind these

- Perceived speed is part of the design.
- Keep views fresh without a manual refresh.
- Design for the worst network, not the best.
- Give feedback on long operations.
- Search must deliver what the user typed, and quickly.

## Numbers to remember

| Value | Meaning | Source |
|-------|---------|--------|
| 0.1 s | feels instant, no feedback needed | (Nielsen; Miller 1968) |
| 0.4 s | Doherty threshold, keeps users in flow | (Doherty and Thadani 1982) |
| 1 s | limit for the user's train of thought | (Nielsen; Card et al. 1991) |
| 10 s | limit of attention; show percent done | (Nielsen; Myers 1985) |
| 2.5 s | "good" Largest Contentful Paint | (Google Web Vitals) |
| 200 ms | "good" Interaction to Next Paint | (Google Web Vitals) |

## Key readings and what each teaches

- Nielsen, "Response Time Limits" (NN/G). The three thresholds and what to show at each. Start here.
- Miller (1968), "Response time in man-computer conversational transactions". The original paper the thresholds come from.
- Doherty and Thadani (1982), "The economic value of rapid response time". The IBM study behind the 400 ms figure.
- Card, Robertson and Mackinlay (1991), "The information visualizer". Restates the 0.1 / 1 / 10 s bands for interactive systems.
- Myers (1985), "The importance of percent-done progress indicators". Showed users prefer and work better with percent-done feedback.
- Harrison et al. (2007) and Harrison, Yeo and Hudson (2010) on progress bars. How the bar is drawn changes how long the wait feels.
- Nielsen Norman Group, "Progress Indicators Make a Slow System Less Insufferable" and "Skeleton Screens 101". Practical guidance. Note that the evidence on skeleton screens is mixed: some studies find they feel faster, one 136-person test found them worst. Use them, but measure.
- Google web.dev, "Web Vitals" and "RAIL". The modern measurement targets.

## A non-software way to think about it

A restaurant brings bread while the kitchen cooks. An airport departures
board that goes stale makes travellers distrust every board in the building.


---

# Reading list: Performance and responsiveness

All links were opened and checked at the time of writing.

## Articles and guidelines

- [Response Time Limits (NN/G)](https://www.nngroup.com/articles/response-times-3-important-limits/): The 0.1 s / 1 s / 10 s thresholds and what feedback each needs.
- [Website Response Times (NN/G)](https://www.nngroup.com/articles/website-response-times/): Same thresholds applied to the web; 1 s needed for good navigation.
- [Doherty Threshold (Laws of UX)](https://lawsofux.com/doherty-threshold/): Respond within 400 ms to keep users' attention and productivity.
- [Visibility of System Status, Usability Heuristic #1 (NN/G)](https://www.nngroup.com/articles/visibility-system-status/): Keep users informed about what is going on, in reasonable time.
- [Progress Indicators Make a Slow System Less Insufferable (NN/G)](https://www.nngroup.com/articles/progress-indicators/): When to use spinners vs percent-done bars.
- [Skeleton Screens 101 (NN/G)](https://www.nngroup.com/articles/skeleton-screens/): What skeleton screens are and when they help.
- [Web Vitals (Google, web.dev)](https://web.dev/articles/vitals): LCP, INP and CLS targets.
- [Measure performance with the RAIL model (Google, web.dev)](https://web.dev/articles/rail): Response, Animation, Idle, Load budgets.
- [Interaction to Next Paint (Google, web.dev)](https://web.dev/articles/inp): The responsiveness metric: 200 ms or less is good.
- [Cumulative Layout Shift (Google, web.dev)](https://web.dev/articles/cls): Why content must not jump while loading.

## Papers

- Miller, R. B. (1968). Response time in man-computer conversational transactions. AFIPS Fall Joint Computer Conference. [Link](https://dl.acm.org/doi/10.1145/1476589.1476628)
- Doherty, W. J., and Thadani, A. J. (1982). The economic value of rapid response time. IBM Technical Report GE20-0752. [Link](https://archive.computerhistory.org/resources/access/text/2024/03/102751398-05-01-acc.pdf)
- Card, S. K., Robertson, G. G., and Mackinlay, J. D. (1991). The information visualizer, an information workspace. CHI 1991. [DOI](https://doi.org/10.1145/108844.108874)
- Myers, B. A. (1985). The importance of percent-done progress indicators for computer-human interfaces. CHI 1985. [Link](https://www.cs.cmu.edu/~bam/papers/percentdoneCHI85.pdf)
- Harrison, C., Amento, B., Kuznetsov, S., and Bell, R. (2007). Rethinking the progress bar. UIST 2007. [Link](https://www.chrisharrison.net/projects/progressbars/ProgBarHarrison.pdf)
- Harrison, C., Yeo, Z., and Hudson, S. E. (2010). Faster progress bars: manipulating perceived duration with visual augmentations. CHI 2010. [Link](https://www.chrisharrison.net/projects/progressbars2/ProgressBarsHarrison.pdf)
- Galletta, D. F., Henry, R., McCoy, S., and Polak, P. (2004). Web site delays: how tolerant are users? Journal of the AIS 5(1). Free, download by hand. [Link](https://aisel.aisnet.org/jais/vol5/iss1/1/)
- Mejtoft, T., Langstrom, S., and Soderstrom, U. (2018). The effect of skeleton screens: users' perception of speed and ease of navigation. ECCE 2018. Free access at ACM. [Link](https://dl.acm.org/doi/10.1145/3232078.3232086)
- Costa and Belem (2025). The perception of waiting time in digital applications: a comparative study of loading strategies. IHC 2025. [Link](https://sol.sbc.org.br/index.php/ihc_estendido/article/view/37767)
