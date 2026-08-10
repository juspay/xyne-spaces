---
name: xyne-lens
description: Create concise, visual-first educational animations with Manim Community Edition in the isolated Xyne Lens Cairo renderer. Use for concepts expressed through diagrams, equations, graphs, vectors, algorithms, systems flows, scientific simulations, or Cairo-compatible 3D scenes.
---

# Xyne Lens

Create a short explainer that makes one idea visible. Prefer a small set of semantic objects, deliberate transformations, and readable labels over decorative animation or dense slides.

## Runtime and boundaries

- The session advertises this skill's read-only absolute `<location>`. Read this `SKILL.md` there, then read a reference using that same directory. Do not search the application repository or `/workspace/xyne-lens` for this bundle: those paths are not the mounted skill library.
- Write **Manim Community Edition** only: `from manim import *`.
- The renderer is fixed: Cairo, 854×480, 30 fps, H.264. Do not set renderers, quality, resolution, FPS, output paths, media directories, or CLI flags in source.
- Keep the delivered MP4 below 100 MiB. Use concise chapter pacing and simple reusable visuals before compromising legibility.
- Available when useful: `Text`, `Tex`, `MathTex`, `TexTemplate`, `MovingCameraScene`, `ThreeDScene`, NumPy, SciPy, FFmpeg, LaTeX, dvisvgm, and Ghostscript.
- Never use `manimlib`, `manimgl`, `InteractiveScene`, `ShowCreation`, OpenGL, Jupyter magics, shell commands, package installation, plugins, external files, downloads, or browser/network access.
- Use only the Lens file and renderer tools. Keep source paths relative, such as `gravity.py` or `scenes/gravity.py`.

## Workflow

1. State a 3–8 beat visual storyboard: learning goal, objects, what changes, and takeaway.
2. Render a tiny runnable skeleton before adding detail.
3. Build each beat from the previous state where possible. Keep object identity, colours, labels, arrows, and equations coherent through transformations.
4. Render early and after meaningful changes. On an error, read the source and make the smallest exact edit; do not rewrite a working scene for a local fix. Copy `oldText` exactly from that immediately preceding read, make one localized repair, then render again. If replacement fails, re-read before another edit.
5. Inspect the opening preview and important transition timestamps. Deliver only after the final MP4 has passed the renderer's validation.

For a researched parent handoff, treat supplied claims, evidence, and technical context as the factual boundary. Convert them into an accurate visual abstraction; do not invent code paths, facts, measurements, or citations.

## Visual direction

- Start concrete, then introduce labels and abstractions. Reveal complexity progressively.
- Give each colour one stable meaning. Use two or three semantic colours and one highlight.
- At 480p, show one idea per beat. Use large text and avoid full source files, dense paragraphs, and tiny axis labels.
- Use `Text` for prose/UI and `MathTex`/`Tex` for notation. Split formulas into meaningful objects; never animate individual glyph indices.
- Use `Transform`, `ReplacementTransform`, `TransformMatchingTex`, `AnimationGroup`, `LaggedStart`, `Succession`, and `always_redraw` to preserve continuity.
- Use documented rate functions only: `smooth`, `linear`, `there_and_back`, `rush_into`, `rush_from`, or a small inline lambda.

## Read references selectively

- For a narrative or visual metaphor, read [visual-storytelling.md](references/visual-storytelling.md).
- For formulas, vectors, axes, graphs, or moving measurements, read [math-graphs-and-updaters.md](references/math-graphs-and-updaters.md).
- For surfaces, camera movement, numerical traces, or SciPy, read [cairo-3d-and-science.md](references/cairo-3d-and-science.md).
- For code, algorithms, data structures, and request/data flows, read [algorithms-and-systems.md](references/algorithms-and-systems.md).
- For short, safe implementation snippets, read [approved-patterns.md](references/approved-patterns.md).
- For a fitting, tested scene reference, read [scene-catalog.md](references/scene-catalog.md), then read only the relevant category file.
- For a five-minute-or-longer deliverable, read [long-form-lessons.md](references/long-form-lessons.md) before designing the master scene.

## Longer lessons (five minutes or more)

- Plan chapters before code: one learning question and takeaway per chapter, usually 20–45 seconds each. Establish recurring colours, terms, and visual objects in the first chapter and reuse them.
- Lens produces one MP4 from one selected Manim class. Assemble a long lesson as one master `Scene` whose `construct` calls ordered chapter methods such as `chapter_request_flow()`, `chapter_cache()`, and `chapter_takeaway()`.
- During development, keep each chapter short and independently testable: either render a temporary preview `Scene` for that chapter or temporarily call only that chapter from the master scene. Then restore the master sequence for final rendering.
- Treat each chapter boundary as a reset, bridge, or transformation. Clear obsolete objects deliberately, retain only useful visual anchors, and add a short pause before a new abstraction.
- Add chapters incrementally. After each addition, inspect the chapter's entry, its key transition, and its exit; only then render the growing master lesson. Do not rewrite earlier working chapters.
- Keep the final output below the delivery limit. Prefer concise holds, simple geometry, and reusable objects over long static slides or expensive per-frame computation.

## Final checks

- Define one named `Scene` or `ThreeDScene` subclass and render that exact class.
- Before the first full render, keep the scene to a title and one visual beat. Use only the documented primitives and rate functions named above; in particular do not guess helpers such as `accelerate` or `ease_in_cubic` from another Manim version.
- Keep coupled visuals grouped, transformed together, or derived with `always_redraw`.
- Prefer clear 15–90 second videos unless a longer lesson is explicitly requested; for long lessons, use the chapter workflow above.
- Narration is a script and pacing aid only; the isolated renderer does not synthesize audio.
