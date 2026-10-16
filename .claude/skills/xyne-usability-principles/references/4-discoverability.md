# Category 4: Discoverability and onboarding

## What this category covers

Whether people can find what the product can do, learn it at the moment they
need it, and understand the words the product uses. A feature that exists
but is never found has the cost of building it and none of the value.

## The principle

### 7. A feature nobody finds doesn't exist

*Put it where the user already is, hint at what is off-screen, and explain jargon before asking people to use it.*

**What it means**

Four ideas sit under this one sentence.

a) Recognition beats recall (Nielsen heuristic #6). People find things by
   seeing them, not by remembering where they live. A command hidden in a
   hover menu, a setting three levels deep, or a channel left out of the
   directory is invisible to most users. Put actions at the point of use.

b) The illusion of completeness (NN/G). If the visible part of a
   screen looks finished, users assume there is nothing more. A board that
   scrolls sideways with no cue reads as "the board has three columns",
   not "there are more columns to the right". Give off-screen content a
   visible edge, a count, or a partial item.

c) Teach in context, not up front. Research on onboarding tutorials and
   instructional overlays finds that people skip or forget tours shown
   before they have a task. Contextual help at the moment of need, for the
   first few times, works better (NN/G; Grossman and Fitzmaurice, ToolClips).
   People are impatient to act, not to learn (Carroll and Rosson, the
   paradox of the active user), so the product must meet them mid-task.

d) Explain terms before asking people to use them. A field labelled with
   an acronym the user has never seen is a wall. Plain-language guidance
   is to define a term the first time, or avoid it.

**Why it matters**

Support load, low adoption and "I didn't know it could do that" all trace
back here. Each hidden feature becomes a training problem, and training
does not scale. Discoverable products teach themselves.

**How to apply**

- Make every action reachable from where its object is shown. If a thing
  can be searched, put the search where the thing is picked.
- Hover-only controls need a visible fallback (a visible "..." or a
  right-click menu that matches).
- Show that more exists: a cut-off card at the edge, a "+3 more" count, a
  scroll shadow. Collapse empty columns so real ones fit.
- Replace the upfront tour with a one-time, dismissable hint at the moment
  of first use, shown at most a few times.
- Offer suggestions in the composer or toolbar that name a feature at the
  point where it applies.
- Keep a glossary. Define a term the first time it appears, in a tooltip
  or inline note. Never label a required field with an unexplained acronym.
- Put new object types (channels, boards) in the same directory as the
  old ones. Hidden by default means not found.

## The detailed rules behind this

- Help people find things.
- Make the thing findable where people are.
- Users can't use a feature they don't know exists.
- Advertise features where the user already is.
- Hand-hold the first-time user to the next step.
- Explain jargon before asking the user to use it.
- If content is off-screen, show that it exists.

## Key readings and what each teaches

- Nielsen Norman Group, "Recognition and Recall in User Interfaces". Why visible options beat remembered ones.
- Nielsen Norman Group, "The Illusion of Completeness". The off-screen content problem, with examples and fixes.
- Nielsen Norman Group, "Onboarding Tutorials vs. Contextual Help". Why tours fail and contextual help works.
- Nielsen Norman Group, "Instructional Overlays and Coach Marks for Mobile Apps". Research showing overlays are skipped or forgotten.
- Nielsen Norman Group, "Information Scent". How people decide where to go next, based on Pirolli and Card's information foraging theory.
- Norman, "Affordance, conventions, and design" and Gaver (1991), "Technology affordances". The theory of what a control looks like it can do.
- Grossman, Fitzmaurice and Attar (2009), "A survey of software learnability". How learnability is defined and measured.
- Grossman and Fitzmaurice (2010), "ToolClips". Contextual video help at the point of use improved task success.
- Malacria et al. (2013), "ExposeHK" and Grossman et al. (2007), "Strategies for accelerating on-line learning of hotkeys". How to make hidden shortcuts discoverable.
- Cockburn et al. (2014), "Supporting novice to expert transitions". The survey of how interfaces help people get faster.
- Digital.gov, "Avoid jargon". US federal plain-language guidance.

## A non-software way to think about it

A library puts the returns slot at the exit, not behind the front desk. A
supermarket groups items by how shoppers think, not by supplier. A tax form
has a one-line gloss next to each term.


---

# Reading list: Discoverability and onboarding

All links were opened and checked at the time of writing.

## Articles and guidelines

- [Memory Recognition and Recall in User Interfaces (NN/G)](https://www.nngroup.com/articles/recognition-and-recall/)
- [10 Usability Heuristics (NN/G): #6 Recognition rather than recall, #10 Help and documentation](https://www.nngroup.com/articles/ten-usability-heuristics/)
- [The Illusion of Completeness: What It Is and How to Avoid It (NN/G)](https://www.nngroup.com/articles/illusion-of-completeness/)
- [Onboarding Tutorials vs. Contextual Help (NN/G)](https://www.nngroup.com/articles/onboarding-tutorials/)
- [Instructional Overlays and Coach Marks for Mobile Apps (NN/G)](https://www.nngroup.com/articles/mobile-instructional-overlay/)
- [Information Scent: How Users Decide Where to Go Next (NN/G)](https://www.nngroup.com/articles/information-scent/)
- [Progressive Disclosure (NN/G)](https://www.nngroup.com/articles/progressive-disclosure/)
- [Tooltip Guidelines (NN/G)](https://www.nngroup.com/articles/tooltip-guidelines/)
- [The Paradox of the Active User (NN/G summary of Carroll and Rosson, 1987)](https://www.nngroup.com/articles/paradox-of-the-active-user/)
- [Affordance, conventions, and design (Don Norman, author's web version)](https://jnd.org/affordance-conventions-and-design-part-2/)
- [Avoid jargon (Digital.gov plain language guide)](https://digital.gov/guides/plain-language/principles/avoid-jargon)

## Papers

- Pirolli, P., and Card, S. (1999). Information foraging. Psychological Review 106(4). Paywalled. [DOI](https://doi.org/10.1037/0033-295X.106.4.643)
- Norman, D. A. (1999). Affordance, conventions, and design. interactions 6(3). [DOI](https://doi.org/10.1145/301153.301168)
- Gaver, W. W. (1991). Technology affordances. CHI 1991. [DOI](https://doi.org/10.1145/108844.108856)
- Grossman, T., Fitzmaurice, G., and Attar, R. (2009). A survey of software learnability: metrics, methodologies and guidelines. CHI 2009. [DOI](https://doi.org/10.1145/1518701.1518803)
- Grossman, T., and Fitzmaurice, G. (2010). ToolClips: an investigation of contextual video assistance for functionality understanding. CHI 2010. [DOI](https://doi.org/10.1145/1753326.1753552)
- Grossman, T., Dragicevic, P., and Balakrishnan, R. (2007). Strategies for accelerating on-line learning of hotkeys. CHI 2007. [DOI](https://doi.org/10.1145/1240624.1240865)
- Malacria, S., Bailly, G., Harrison, J., Cockburn, A., and Gutwin, C. (2013). Promoting hotkey use through rehearsal with ExposeHK. CHI 2013. [DOI](https://doi.org/10.1145/2470654.2470735)
- Findlater, L., and McGrenere, J. (2004). A comparison of static, adaptive, and adaptable menus. CHI 2004. [DOI](https://doi.org/10.1145/985692.985704)
- Cockburn, A., Gutwin, C., Scarr, J., and Malacria, S. (2014). Supporting novice to expert transitions in user interfaces. ACM Computing Surveys 47(2). [DOI](https://doi.org/10.1145/2659796)
- Carroll, J. M., and Rosson, M. B. (1987). Paradox of the active user. In Interfacing Thought (MIT Press). Book chapter, no open copy.
