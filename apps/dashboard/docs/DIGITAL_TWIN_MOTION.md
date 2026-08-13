# Digital Twin motion contract

Digital Twin motion should make state changes easier to follow while preserving
the calm, inspectable character of the workspace. It must never delay access to
content or become the only way a change is communicated.

## Timing and easing

The shared values live in `digitalTwin/motion.ts` for Framer Motion and
`digitalTwin/digital-twin-motion.css` for CSS. Keep both representations
aligned.

| Purpose  | Duration | Use                                                     |
| -------- | -------: | ------------------------------------------------------- |
| Press    |   120 ms | Button and selectable-row press feedback                |
| Feedback |   180 ms | Color, opacity, and small icon feedback                 |
| State    |   240 ms | Disclosures, banners, and local state changes           |
| Layout   |   300 ms | Reordering, optimistic removal, and shared tab movement |
| Route    |   340 ms | Primary Digital Twin view changes                       |
| Entrance |   420 ms | One-time page or staged-list entrance                   |

Use the shared ease-out curve for elements entering or responding, ease-in for
exits, and ease-in-out only when an element remains visible while moving. List
staggering is capped after six items so long collections never make users wait.

## Interaction rules

- Animate opacity and transforms. Avoid animating layout properties except the
  existing grid-row disclosure pattern.
- Keep route motion subtle: no more than 8 px of vertical travel.
- Preserve spatial continuity when selection changes. The primary navigation
  uses one shared active indicator; master-detail views animate in the direction
  of the changed pane.
- Use `layout="position"` or `layout` for optimistic removals so surrounding
  content closes the gap instead of jumping.
- Animate newly revealed content, not routine data refreshes. Background polling
  should not repeatedly replay entrance motion.
- Keep all controls usable during decorative animation. Only mutation state may
  disable a control.
- Do not add indefinite decorative motion. Loading indicators must retain
  adjacent text or another non-motion status cue.

## Reusable hooks and classes

- Wrap Digital Twin routes in `MotionConfig reducedMotion="user"`.
- Use `DIGITAL_TWIN_MOTION` and the exported easing curves rather than one-off
  numbers.
- Use `digitalTwinStaggerDelay(index)` for capped staged entrances.
- Add `dt-pressable` to direct-action controls and `dt-selectable` to persistent
  choices.
- Use `dt-details-chevron` for disclosure icons and `dt-result-bar-segment` for
  transform-based result bars.
- Add one of `dt-menu-content`, `dt-filter-menu-content`, or `dt-select-content`
  to portaled Digital Twin menus so their timing and reduced-motion behavior
  remain scoped to this feature.

## Reduced motion

When `prefers-reduced-motion: reduce` is active:

- Framer Motion removes transform and layout travel through the route-level
  `MotionConfig`.
- CSS transitions and animations inside the Digital Twin workspace complete in
  `0.01ms`.
- Portaled menus and dialogs receive the same treatment explicitly because they
  are rendered outside the workspace element.
- Content remains visible and state changes remain understandable through text,
  shape, position, focus, and ARIA semantics.

## Review checklist

Before shipping a new Digital Twin animation:

1. Test it at the desktop minimum width and at a wide viewport in all supported
   themes.
2. Repeat the journey with keyboard input and verify focus is never lost after
   an animated removal or route change.
3. Repeat with reduced motion enabled and confirm no meaningful transform or
   delayed choreography remains.
4. Confirm loading, empty, success, error, rollback, and long-content states do
   not jump or replay entrance animation during polling.
5. Check the browser console for motion-related runtime warnings and confirm
   TypeScript, ESLint, Prettier, and the production build pass.
