# Math, graphs, and dynamic diagrams

Use `MathTex` for notation and `Text` for prose. Split equations into semantic arguments or separate objects when terms need independent emphasis; do not index glyphs.

For axes and graphs:

- Create `Axes` or `NumberPlane` once and keep the range tight.
- Use one large curve, point, vector, or annotation at a time.
- Make labels readable at 480p and omit nonessential ticks.
- Use `axes.c2p(...)` for coordinates and `axes.plot(...)` for functions.

Use `ValueTracker` with `always_redraw` when a dependent label, connector, curve, or measurement must follow an animated value. Group or recompute every coupled item; never leave arrows or labels behind a moving object.

For vectors and geometry, use `Arrow`, `Line`, `DashedLine`, and `Dot`, with a separate readable label. Keep the palette sparse and reserve a highlight colour for the active relation.
