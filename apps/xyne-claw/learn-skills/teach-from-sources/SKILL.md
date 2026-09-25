---
name: Teach From Sources
description: Read the links or sources the user gives, in the workspace browser, and teach the topic from them — grounded, ordered, and honest about what the sources do not say.
---

# Teaching from sources

Use this skill when the user asks to be taught something, or hands over links and wants them explained.

## Open every source before you teach

Open each link with the browser tool so it loads in the workspace panel, then read it. The user watches the page you are reading, which is half the value: they see where the answer came from.

Two rules, and they are the difference between a tutor and a bluffer:

- **Never teach from a page you could not open.** If a source fails to load, is behind a wall you cannot pass, or turns out to be something other than what its URL suggested, say so and carry on without it. Do not backfill from memory and present it as that source.
- **Never present recall as reading.** Anything you knew before opening the sources is your own commentary. Mark it as such in one short phrase, and keep it out of the parts the user will quote.

When the user names a topic instead of giving links, find sources first, then open them. The same rules apply.

## Teach the idea, not the pages

Do not walk source by source. That is a reading list, not teaching.

Build the explanation in the order someone learns it:

1. **The problem it solves.** What goes wrong without this thing. One or two sentences, concrete.
2. **The core idea.** The smallest mental model that makes the rest predictable. One idea, named plainly.
3. **How it actually works.** The mechanism, in the order it happens. This is where a diagram earns its place.
4. **Where it bites.** The failure modes, the surprising costs, the thing everyone gets wrong the first time.
5. **What is still unsettled.** Where the sources disagree, or where you could not confirm.

Match the depth to what was asked. A quick orientation is a few hundred words. "Teach me properly" is a full pass with the mechanism worked through. Ask nothing before starting; pick from the words used and say which depth you chose in one clause.

## Attribute as you go

Each substantive claim names the source it came from, inline and briefly. Where two sources say different things, show both and say which is better supported and why, rather than averaging them into mush.

## The lesson

Deliver one self-contained HTML page named `lesson.html`, written to the workspace and delivered with the delivery tool available in this run. It holds:

1. **The topic and the depth**, plus a one-sentence statement of what the reader will be able to do afterwards.
2. **The explanation**, in the five-part order above.
3. **A diagram** of how the pieces relate, in a `<pre class="mermaid">` block with mermaid from a CDN and a dark theme. Make it clickable to expand into a fixed overlay covering the viewport, with escape to close. Never use the fullscreen API; the page is served inside a sandboxed frame where it silently fails.
4. **Sources**, one row each: the link, what it contributed, and for anything that failed, what went wrong.
5. **Check yourself**, three or four questions whose answers are in the lesson.

Never put the page, or any fenced `html` block, in the chat reply. The chat surface reads a fenced html block as a design revision, hides your answer and replaces it with "Design updated in preview", and your teaching is lost. Write the file, deliver it, and teach in prose in the chat.

The chat reply is the lesson in miniature: the problem, the core idea, the mechanism in a few sentences, and the one thing people get wrong. Point at the page for the full pass.
