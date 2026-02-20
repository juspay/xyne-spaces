# React Component Best Practices

Guidelines for creating and maintaining React components in the dashboard. Follow these to keep the UI consistent, maintainable, and performant.

- **Atomic components** live in `src/components/ui/` (e.g. Avatar, Button, Input). They are primitives with minimal logic.
- **Molecular components** are larger, feature-level components built from atoms. They live in their own folders under `src/components/` and follow the structure below.

---

## 1. Molecular component folder structure

When creating a new molecular component, give it a **dedicated folder** under `src/components/` (not under `src/components/ui/`). Inside that folder use three files:

| File | Purpose |
|------|--------|
| `NewComponent.tsx` | The main component and its JSX. |
| `NewComponent.utils.ts` | Pure utility functions, formatters, and helpers used by the component. |
| `NewComponent.types.ts` | All component-related types and interfaces (props, emitted events, option shapes, etc.). |

**Example folder layout:**

```
src/components/
  ui/                    # atomic components only
    Avatar/
    Button/
  NewComponent/          # one folder per molecular component
    NewComponent.tsx
    NewComponent.utils.ts
    NewComponent.types.ts
```

**Example: `NewComponent.types.ts`**

```ts
export interface NewComponentProps {
  title: string;
  variant?: 'default' | 'compact';
  onSelect?: (id: string) => void;
  className?: string;
}

export type NewComponentStatus = 'idle' | 'loading' | 'error';
```

**Example: `NewComponent.utils.ts`**

```ts
export function formatDisplayValue(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

export function getStatusColor(status: string): string {
  const map: Record<string, string> = {
    idle: 'text-muted-foreground',
    loading: 'text-amber-500',
    error: 'text-destructive',
  };
  return map[status] ?? map.idle;
}
```

**Example: `NewComponent.tsx`** (imports from same folder)

```tsx
import type { NewComponentProps, NewComponentStatus } from './NewComponent.types';
import { formatDisplayValue, getStatusColor } from './NewComponent.utils';
import { cn } from '../../utils/classNames';

export function NewComponent({ title, variant = 'default', onSelect, className }: NewComponentProps) {
  // ... state and logic
  return (
    <div className={cn(getStatusColor(status), className)}>
      {formatDisplayValue(title)}
    </div>
  );
}
```

Keep atomic building blocks in `src/components/ui/`; only add new molecular components under `src/components/` with this three-file structure.

---

## 2. Mobile-specific variants

**First goal: one responsive component.** Prefer a single component that adapts with responsive styles (e.g. Tailwind breakpoints, flex/grid, conditional classes). That keeps one source of truth and avoids duplicate logic.

**When to split:** Use a separate **mobile-only file** (`NewComponent.mobile.tsx`) only when the mobile UI is **very complex** or would require **many conditionals in the JSX** (e.g. different structure, different components, or hard-to-read `isMobile ? ... : ...` branches). In those cases, add `NewComponent.mobile.tsx` in the same folder. The main entry (`NewComponent.tsx`) should use `isMobile` from `usePlatform()` and render the mobile variant when true, so a single import still works everywhere.

**Hook:** `src/hooks/usePlatform.ts` returns `{ platform, isWeb, isElectron, isMobile, isMac }`. `isMobile` is `true` when the app is in a React Native WebView or when the viewport width is under 700px.

**Example folder layout with mobile variant:**

```
NewComponent/
  NewComponent.tsx         # main component; branches on isMobile
  NewComponent.mobile.tsx  # mobile-only UI
  NewComponent.utils.ts
  NewComponent.types.ts
```

**Example: conditional render in main component**

```tsx
// NewComponent.tsx
import { usePlatform } from '../../../hooks/usePlatform';
import type { NewComponentProps } from './NewComponent.types';
import { NewComponentMobile } from './NewComponent.mobile';

export function NewComponent(props: NewComponentProps) {
  const { isMobile } = usePlatform();

  if (isMobile) {
    return <NewComponentMobile {...props} />;
  }

  return (
    <div className="...">
      {/* desktop layout */}
    </div>
  );
}
```

**Example: mobile file** (same props, different layout)

```tsx
// NewComponent.mobile.tsx
import type { NewComponentProps } from './NewComponent.types';

export function NewComponentMobile(props: NewComponentProps) {
  return (
    <div className="flex flex-col gap-2 px-2">
      {/* mobile-optimized layout, touch-friendly, etc. */}
    </div>
  );
}
```

Keep shared types in `NewComponent.types.ts` and shared logic in `NewComponent.utils.ts` so both desktop and mobile variants stay in sync. Only split JSX/layout by platform.

**Hover states on mobile:** Touch devices don’t have a meaningful hover state, so avoid hover-only UX on mobile. In a **single responsive component**, conditionally add hover classes with `cn()` so they apply only when `!isMobile`. In a **separate** `*.mobile.tsx`, omit hover classes entirely.

```tsx
const { isMobile } = usePlatform();

<button
  className={cn(
    'rounded-lg px-4 py-2 transition-colors',
    !isMobile && 'hover:bg-accent hover:text-accent-foreground',
  )}
>
  Action
</button>
```

---

## 3. Component structure and file layout (inside a file)

- **One main component per file** when the component has its own logic or is exported for reuse. Co-locate small, file-specific subcomponents at the bottom of the same file when they are not reused.
- **Order inside the file**: types/interfaces → constants → main component → subcomponents → exports. Keep hooks and helpers close to where they’re used.
- **Use named exports** for public API (e.g. `Avatar`, `AvatarGroup`) and default export only when the file represents a single screen or route.

---

## 4. State declarations at the top

Keep the component body easy to scan by **declaring all state and hooks at the top**, before any derived values or callbacks. Group related state together and avoid scattering `useState` / `useEffect` / other hooks lower in the function.

**Preferred:** state and hooks first, then derived values, then handlers, then render.

```tsx
export function UserCard({ userId, onEdit }: UserCardProps) {
  // —— State and hooks at the top ———
  const [isExpanded, setIsExpanded] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const user = useUser(userId);
  const { mutate } = useZero();

  // —— Derived values ———
  const displayName = user?.name ?? user?.email ?? 'Unknown';
  const canEdit = !!user && !user.isGuest;

  // —— Handlers ———
  const handleToggle = () => setIsExpanded(prev => !prev);
  const handleSave = (name: string) => { /* ... */ };

  // —— Render ———
  return (
    <div>
      <span>{displayName}</span>
      {/* ... */}
    </div>
  );
}
```

**Avoid:** state or hooks declared in the middle of the component or after early returns, which makes the data flow harder to follow.

```tsx
// Avoid: hook after conditional logic
export function UserCard({ userId }: UserCardProps) {
  const displayName = getDisplayName(userId);
  if (!displayName) return null;
  const [isExpanded, setIsExpanded] = useState(false); // ❌ Hook after return
  return <div>...</div>;
}
```

---

## 5. Early returns for conditional rendering

Use **early returns** for conditional UI instead of nesting complex conditions inside JSX. It keeps the main return simple and makes loading, error, and empty states obvious.

**Respect the Rules of Hooks.** All hooks must run on every render, in the same order. So **call every hook before any early return**. If you return early first, any hook after that would run conditionally and break React’s rules.

```tsx
// ✅ Correct: all hooks at the top, then early returns
export function TicketSummary({ ticketId }: TicketSummaryProps) {
  const ticket = useTicket(ticketId);
  const [dismissed, setDismissed] = useState(false);

  if (!ticketId) return null;
  if (dismissed) return null;
  if (ticket.isLoading) return <TicketSummarySkeleton />;
  if (ticket.error) return <ErrorMessage message={ticket.error.message} />;
  if (!ticket.data) return null;

  const { title, status } = ticket.data;
  return (
    <div className="rounded-lg border p-4">
      <h3>{title}</h3>
      <Badge>{status}</Badge>
    </div>
  );
}
```

```tsx
// ❌ Wrong: early return before a hook — violates Rules of Hooks
export function TicketSummary({ ticketId }: TicketSummaryProps) {
  if (!ticketId) return null;  // early return...

  const ticket = useTicket(ticketId);  // ...makes this hook conditional
  const [dismissed, setDismissed] = useState(false);
  // ...
}
```

**Preferred:** resolve guard and edge cases with early returns only **after** all state and hooks are declared. Keep the final return for the happy path.

**Avoid:** complex ternaries or multiple conditions inside the main JSX.

```tsx
// Avoid: hard-to-scan conditions in JSX
return (
  <div>
    {!ticketId ? null : dismissed ? null : ticket.isLoading ? (
      <TicketSummarySkeleton />
    ) : ticket.error ? (
      <ErrorMessage message={ticket.error.message} />
    ) : ticket.data ? (
      <div className="rounded-lg border p-4">
        <h3>{ticket.data.title}</h3>
        <Badge>{ticket.data.status}</Badge>
      </div>
    ) : null}
  </div>
);
```

Use early returns for **loading**, **error**, **empty**, and **guard** cases—always after all hooks—and keep the last return for the main UI only.

---

## 6. Props and typing (see also §1 types file)

- **Define an explicit props interface** (e.g. `AvatarProps`) and use it on the component. Prefer `interface` for object shapes so they can be extended later if needed.
- **Keep props minimal and purposeful.** Avoid “prop drilling”; use composition, context, or state management when many layers need the same data.
- **Support `className`** on presentational components so callers can adjust layout and styling. Merge with `cn()` and pass through to the root DOM node.
- **Use `React.ComponentProps<typeof Primitive>`** when wrapping a library component (e.g. Radix) so you inherit and forward the right types without re-declaring them.

---

## 7. Composition and children

- **Prefer composition over configuration.** Use `children` and optional slots (e.g. `fallback`, `icon`) instead of long prop lists that try to describe every variant.
- **Compound components** improve flexibility and keep the API clear. Export a single namespace object (e.g. `Card.Header`, `Card.Body`) when it makes sense.
- **Avoid unnecessary wrappers.** If a component only forwards props and children to one child, consider inlining or a thin wrapper that adds real value (e.g. default styles, accessibility).

**Composition over configuration:** accept React nodes as props instead of enum-like or string config.

```tsx
// ✅ Prefer: slots for content
interface PanelProps {
  title: React.ReactNode;
  icon?: React.ReactNode;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export function Panel({ title, icon, children, footer }: PanelProps) {
  return (
    <div className="rounded-lg border bg-card p-4">
      <div className="flex items-center gap-2">
        {icon}
        <h2 className="text-lg font-medium">{title}</h2>
      </div>
      <div className="mt-2">{children}</div>
      {footer && <div className="mt-4 border-t pt-2">{footer}</div>}
    </div>
  );
}

// Usage: caller composes content
<Panel title="Settings" icon={<SettingsIcon />} footer={<Button>Save</Button>}>
  <FormFields />
</Panel>
```

```tsx
// ❌ Avoid: configuration-only API that can’t express custom content
interface PanelProps {
  title: string;
  iconName?: 'settings' | 'user' | 'gear';
  bodyText: string;
  footerButtonLabel?: string;
  footerButtonVariant?: 'primary' | 'secondary';
}
```

**Compound components:** group related pieces under one export so structure is explicit and flexible.

```tsx
// Card.tsx — plain divs, no external headless UI
function CardRoot({ className, children, ...props }: React.ComponentProps<'div'>) {
  return (
    <div className={cn('rounded-lg border bg-card', className)} {...props}>
      {children}
    </div>
  );
}

function CardHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('border-b px-4 py-2 font-medium', className)} {...props} />;
}

function CardBody({ className, ...props }: React.ComponentProps<'div'>) {
  return <div className={cn('p-4', className)} {...props} />;
}

export const Card = Object.assign(CardRoot, { Header: CardHeader, Body: CardBody });

// Usage
<Card>
  <Card.Header>Title</Card.Header>
  <Card.Body>Content here</Card.Body>
</Card>
```

**Avoid unnecessary wrappers:** only add a component layer if it does something useful (default styles, ref forwarding, accessibility). A component that only does `className` + `children` is often better inlined or replaced with a shared class name.

---

## 8. Styling

- **Use Tailwind and `cn()`** for styling. Put base and variant styles in the component; allow overrides via `className`.
- **Keep design tokens in one place** (e.g. size maps like `sizeClasses`) so spacing, typography, and colors stay consistent and easy to change.
- **Hover states:** Add hover classes only when `!isMobile` (e.g. `cn(!isMobile && 'hover:bg-accent')`). On mobile, omit hover styles; see §2.

---

## 9. Accessibility and semantics

- **Use the right HTML element** (button, link, heading, list, etc.) so structure and behavior are correct without extra ARIA.
- **Support keyboard and focus** for interactive components. Don’t rely only on click; handle Enter/Space where appropriate.
- **Add `data-slot` (or similar) on primitives** when building design-system components so tests and styles can target them reliably.
- **Forward refs** when the component wraps a single focusable or DOM element, using `React.forwardRef` and passing the ref to that element.

---

## 10. State and side effects

- **Keep UI state local** when it isn’t needed elsewhere. Lift state only when multiple components need to stay in sync or when the state is part of a broader flow.
- **Colocate data fetching** in hooks or services; components should consume data via props or hooks rather than performing fetch logic directly in the component body.
- **Avoid unnecessary `useEffect`.** Prefer deriving values during render or in event handlers. Use `useEffect` for real side effects (subscriptions, sync with external systems, DOM).

---

## 11. Performance

- **Memoize only when needed.** Use `React.memo` (or equivalent) when a component re-renders often with the same props and the render is expensive. Prefer fixing unnecessary parent re-renders first.
- **Stable callbacks:** Pass stable references (e.g. from `useCallback`) to children that are memoized or to effects that depend on those callbacks.
- **Lazy load heavy or route-level components** with `React.lazy` and `Suspense` to keep initial bundle size and first paint time low.

---

## 12. Testing and maintainability

- **Keep components easy to test:** minimal side effects, props over globals, and clear inputs/outputs. Prefer testing behavior and accessibility over implementation details.
- **Document non-obvious props and behavior** with JSDoc when the API is public or the behavior is subtle (e.g. when a prop changes loading or error state).
- **Reuse shared primitives** (e.g. from `components/ui`) instead of duplicating layout and styling. Contribute back improvements to the design system when you find gaps.

---

## Summary

- **Atomic components** live in `src/components/ui/`; **molecular components** get their own folder under `src/components/` with `ComponentName.tsx`, `ComponentName.utils.ts`, and `ComponentName.types.ts`. Prefer one responsive component; add `ComponentName.mobile.tsx` and branch on `isMobile` from `usePlatform()` only when the mobile UI is complex or would require many conditionals in the JSX (§2).
- Keep **state and hooks at the top** of each component; use **early returns** for loading, error, and guard cases instead of complex conditions in JSX.
- Use clear structure and typing, composition over configuration, consistent styling with Tailwind and `cn()`, and attention to accessibility and performance. When in doubt, align with existing patterns in `src/components/ui` and the rest of the dashboard.
