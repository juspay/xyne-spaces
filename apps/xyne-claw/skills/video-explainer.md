---
name: video-explainer
description: Create narrated MP4 explainers from approved storyboard JSON. Load when a user asks for a video walkthrough, narrated explainer, visual commit explanation, or architecture video. Includes the storyboard contract, commit-walkthrough recipe, and the mandatory approval gate before rendering.
---

# Video Explainer

Use `create-video-explainer` to turn a concise storyboard into a narrated MP4. The tool renders deterministic HTML scenes in a writable sandbox, synthesizes narration through the trusted TTS proxy, burns in captions, and writes `results/explainer.mp4`.

## Mandatory approval gate

**ALWAYS show the complete storyboard text to the user and receive explicit approval BEFORE calling `create-video-explainer`.**

Rendering is the expensive step. Drafting and revising storyboard text is cheap. Never treat a request for a video as implicit approval of a storyboard the user has not seen. After showing it, stop and ask the user to approve or request edits. Render only after an affirmative response.

## Storyboard shape

```jsonc
{
  "title": "Refactor: the Slack surface becomes the exemplar",
  "voice": "default",
  "scenes": [
    {
      "kind": "title",
      "narration": "A short opening that states the change and why it matters."
    },
    {
      "kind": "diagram",
      "mermaid": "graph LR; Request-->Route; Route-->Service; Service-->Adapter",
      "narration": "Explain the structural story shown by the diagram."
    },
    {
      "kind": "code",
      "file": "src/surfaces/slack/api.ts",
      "highlight": [39, 61],
      "narration": "Explain only the load-bearing logic in these lines."
    },
    {
      "kind": "diff",
      "before": "old call shape",
      "after": "new call shape",
      "narration": "Contrast the behavior, not every textual edit."
    },
    {
      "kind": "bullets",
      "items": ["One integration door", "Typed failures", "Simpler extension path"],
      "narration": "Close with what this means for the viewer."
    }
  ]
}
```

Rules:

- Use 1–12 scenes.
- Supported kinds are `title`, `diagram`, `code`, `diff`, and `bullets`.
- Every scene needs narration. Keep each narration under 2,000 characters and the whole storyboard under 4,000 words.
- `code.file` is a path inside the current sandbox; `highlight` is an inclusive `[startLine, endLine]` range.
- Use `voice: "default"` unless the user asks for a particular configured voice.
- Keep visual text sparse. Put the explanation in narration, not dense slides.

## Commit-walkthrough recipe

1. Inspect the commit message and `git show --stat <commit>`. Use them to define the arc: intent, structural change, load-bearing implementation, and impact.
2. Read the relevant diff. Select only changes needed to explain the architecture or behavior.
3. Draft a title scene that states the commit’s purpose in plain language.
4. Use **exactly ONE diagram scene** for the structural story. Show boundaries and flow, not every file.
5. Use **2–4 code scenes** for load-bearing changes only. Never create one scene per changed file. Prefer the smallest line ranges that make the behavior understandable.
6. Add a diff scene only when a before/after contrast communicates the change better than another code scene.
7. End with a bullets scene whose narration explicitly answers: **“what this means for you.”**
8. Show the full storyboard to the user and wait for approval.
9. Ensure the conversation has a writable sandbox (`sandbox-repo-setup` with `write: true` when the current repo is read-first), then call `create-video-explainer`.
10. Deliver the returned MP4 path with `sandbox-deliver-files`.

Aim for a coherent 2–4 minute explanation, not an exhaustive screen-recorded code review.
