# Dashboard Development Guidelines

## Quick Start

```bash
# Install dependencies (from project root)
npm install

# Start dashboard
cd dashboard
npm run dev
```

## Tech Stack

| Technology | Purpose |
|------------|---------|
| React | UI framework |
| TypeScript | Type safety |
| Vite | Build tool |
| Zero (Rocicorp) | Real-time sync |
| XState | State machines |
| TailwindCSS | Styling |
| Lucide React | Icons |
| React Query | API calls |

---

## Documentation Structure

| File/Folder | Description |
|-------------|-------------|
| [SETUP.md](SETUP.md) | Environment setup, OrbStack, Docker |
| [PROJECT_STRUCTURE.md](PROJECT_STRUCTURE.md) | Directory structure and where to put code |
| [providers.md](providers.md) | React providers and context setup |
| [hooks.md](hooks.md) | Custom hooks catalog |
| [services.md](services.md) | Frontend services |
| [machines.md](machines.md) | XState state machines |
| [contexts.md](contexts.md) | React contexts |
| [workers.md](workers.md) | Web workers |
| [zero/](zero/) | Zero sync (queries, mutators, schema) |

---

## General Guidelines

### Before Writing Code

1. **Read existing code** - Check for similar patterns
2. **Ask about design** - Clarify before implementing
3. **Use existing hooks/services** - Don't duplicate functionality

### When Making Changes

| Guideline | Details |
|-----------|---------|
| Stick to requirements | No extra features |
| Use existing components | Check `src/components/` first |
| Keep components small | Single responsibility |
| Avoid prop drilling | Use contexts or Zero queries |

---

## Component Design

### Principles

| Principle | Details |
|-----------|---------|
| Single responsibility | Each component does one thing well |
| Reusability | Build components that can be reused across features |
| Composition over conditionals | Compose small components instead of one component with many if/else |
| Dumb components | Presentational components receive data via props, don't fetch themselves |

### Avoid "God Components"

Components should not "know everything". Break down components when they:
- Have multiple if/else branches for different rendering paths
- Handle too many use cases in one file
- Mix data fetching, business logic, and UI rendering

### Composition Pattern

```typescript
// Bad - one component handling everything
<MessageItem message={msg} isThread={true} isEditing={editingId === msg.id} ... />

// Good - compose specialized components
<ThreadMessage message={msg}>
  {isEditing ? <MessageEditor /> : <MessageContent />}
</ThreadMessage>
```

### Guidelines

- Create small, focused components that do one thing
- Use composition to build complex UIs from simple parts
- Keep conditional logic minimal inside components
- Extract variants into separate components when logic diverges significantly
- Prefer props for configuration, composition for structure

---

## Styling

| Rule | Details |
|------|---------|
| Use TailwindCSS | All styling via Tailwind utility classes |
| No inline styles | Avoid `style={{}}` props |
| Use design tokens | Leverage Tailwind theme for colors, spacing |
| Responsive design | Use Tailwind responsive prefixes (`sm:`, `md:`, `lg:`) |

```typescript
// Bad - inline styles
<div style={{ padding: '16px', backgroundColor: '#f0f0f0' }}>

// Good - Tailwind classes
<div className="p-4 bg-gray-100">
```

---

## Zero Sync

Frontend queries and mutators must **exactly match** backend definitions.

| Rule | Details |
|------|---------|
| Queries identical | Same code as backend |
| Mutators optimistic | Generate UUIDs/dates before calling |
| No heavy logic | Keep mutators lightweight |
| Use `useCachedQuery` | For Zero queries, prevents unnecessary re-renders |
| Write in query file | Never write direct zql queries in components |
| Use `useZero` from hooks | Import from `@/hooks/useZero`, not from Zero library |

See [zero/](zero/) for detailed guidelines.

---

## Specific Scenarios

### Icons

Use **Lucide React** for all icons:
```typescript
import { Plus, Settings } from 'lucide-react';
```

### API Calls

Use **useQuery from React Query** for REST API calls:
```typescript
import { useQuery } from '@tanstack/react-query';
```

### Custom Message Types

When adding new message types, create **custom HTML elements** in the renderer:
- Add element to `renderWithHtml` 
- Don't put data in metadata with conditional rendering
- Keep message rendering clean and extensible

### Performance

| Check | Action |
|-------|--------|
| Zero queries | Use `useCachedQuery` instead of raw queries where pagination is not there |
| N+1 queries | Never make point queries in loops |
| ESLint | Run `npm run lint` before committing |
| TypeScript | Run `npm run typecheck` before committing |
| Format | Run `npm run format` before finalizing code |
| Validate | Run `npm run validate` before finalizing code |

---

## Logging

| Type | When to Use |
|------|-------------|
| Analytics | User actions, feature usage |
| Metrics | Performance measurements |

---

## Do's 

- Use existing hooks, services, providers
- Keep components focused and small
- Use Zero for real-time data
- Generate UUIDs/timestamps before mutations
- Follow existing patterns
- Use Lucide React for icons
- Use useQuery (React Query) for API calls
- Use `useCachedQuery` for Zero queries where pagination is not there
- Check eslint and typecheck before writing code
- Update documentation when making changes that affect guidelines
- Maintain backward compatibility for routes and URL paths unless explicitly told to break it
- Read `backend/docs/guidelines/CLAUDE.md` when doing backend changes

## Don'ts 

- Don't duplicate existing functionality
- Don't add features not in requirements
- Don't put heavy logic in mutators
- Don't call point queries in loops (N+1 pattern)
- Don't bypass existing providers
- Don't write direct zql queries in components
- Don't cause unnecessary re-renders
- Don't put complex data in message metadata

---

## Common Fixes

| Issue | Solution |
|-------|----------|
| Continuous refresh on frontend | Delete all nodes and volumes in OrbStack, start setup fresh |
| TypeScript errors | Run `npm run db:push` in backend folder, then `npm install` in both dashboard and backend |
