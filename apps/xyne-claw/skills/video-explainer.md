---
name: video-explainer
description: Create narrated MP4 explainers from storyboard JSON. Load when a user asks for a video walkthrough, narrated explainer, visual commit explanation, or architecture video. Includes the storyboard contract, command-mode behavior, and commit-walkthrough recipe.
---

# Video Explainer

Use `create-video-explainer` to turn a concise storyboard into a narrated MP4. The tool renders HTML, Manim, and D2 scenes in a writable sandbox and synthesizes narration through the trusted TTS proxy. It attaches the resulting MP4 directly.

## Approval behavior

### `/explainer` command mode

When the user's task starts with `/explainer`, the command itself is explicit approval to draft and render. Do not show the storyboard, ask for confirmation, or stop between drafting and rendering. Call `create-video-explainer` in the same run. The renderer never burns captions into the video and attaches the MP4 automatically; do not call `sandbox-deliver-files` and do not add a textual final response.

### Ordinary video requests

Outside `/explainer` command mode, show the complete storyboard and receive explicit approval before rendering. Rendering is the expensive step; stop after presenting the storyboard and render only after an affirmative response. Narration remains audio-only; never add visible captions.

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
- Supported kinds are `title`, `diagram`, `code`, `diff`, `bullets`, `manim`, and `d2`.
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
8. In ordinary mode, show the full storyboard and wait for approval. In `/explainer` command mode, skip this gate and continue immediately.
9. Ensure the conversation has a writable sandbox, then call `create-video-explainer`.
10. The tool attaches the MP4 directly. Never deliver it a second time with `sandbox-deliver-files`.

Aim for a coherent 2–4 minute explanation, not an exhaustive screen-recorded code review.
