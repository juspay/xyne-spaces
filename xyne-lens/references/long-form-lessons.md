# Long-form lessons

Use a long lesson only when the subject needs sustained reasoning. A five-minute video should be a sequence of small explanations, not one long scene with more text.

## Production structure

- Create a chapter outline first: question, visual model, key transition, takeaway, and approximate duration for every chapter.
- Keep chapters to roughly 20–45 seconds. A five-minute lesson commonly has 8–12 chapters, including a hook, recap bridges, and conclusion.
- Keep a design ledger while writing: colour meaning, label vocabulary, coordinate conventions, and recurring objects. Reuse them across chapters.
- Render one new chapter at a time while building. Inspect its entry, key transition, and exit. Then add it to the master scene and check that the join makes visual sense.
- Use a short bridge, transform, or deliberate `self.clear()` at a chapter boundary. Do not leave obsolete objects accumulating through the lesson.

## Master scene pattern

Lens renders one selected class into one MP4. Make that class the episode assembler; chapter methods are ordinary methods, not separately delivered scenes. Read [scenes-long-form.py](scenes-long-form.py) for the executable `FullLesson` and `MechanismPreview` pattern.

Render `MechanismPreview` during development, then render `FullLesson` for delivery. Do not claim that separately rendered preview classes will be concatenated automatically.

## Duration and reliability

- Make long explanations more visual, not more verbose: use recurring diagrams, transformations, and short labels.
- Precompute data once; long videos multiply the cost of per-frame updaters and complex surfaces.
- Keep an eye on the final delivery-size limit. At 480p, simple reusable graphics are preferable to expensive full-screen motion or prolonged static title cards.
- Preserve working chapter methods. Fix a failure in the smallest affected chapter, then recheck the master sequence.
- If a full master render exceeds the renderer's practical resource limit, simplify the affected chapter or agree on separately delivered parts. Lens does not automatically concatenate independently rendered MP4s.
