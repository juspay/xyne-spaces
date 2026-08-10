# Algorithms and systems

Show state, not a full program. Represent the important state with cards, array cells, nodes, arrows, payloads, pointers, or a short pseudocode line.

Use this beat structure:

1. Establish the data structure, participants, or invariant.
2. Highlight the active element or message.
3. Animate one state transition.
4. Update the caption or invariant.
5. Repeat only until the pattern is clear, then show the result.

For recursion, use a small tree and fade old branches. For pipelines, use left-to-right stages and transform an active payload as it crosses each stage. For distributed systems, prefer a compact request/state/data-flow abstraction over implementation details.

Use `Transform` for a state change, `Indicate` for focus, `LaggedStart` for ordered progression, and `MoveAlongPath` for travel. The motion should explain causality rather than decorate the scene.
