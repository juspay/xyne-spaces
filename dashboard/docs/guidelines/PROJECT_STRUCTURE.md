# Project Structure

## Directory Overview

```
src/
├── api/              # API client functions
├── assets/           # Static assets (images, fonts)
├── components/       # React components (by feature)
├── config/           # App configuration
├── constants/        # Constants and enums
├── contexts/         # React contexts
├── hooks/            # Custom React hooks
├── machines/         # XState state machines
├── providers/        # React providers
├── routes/           # Route definitions
├── services/         # Business logic services
├── shortcuts/        # Keyboard shortcuts
├── themes/           # Theme definitions
├── types/            # TypeScript types
├── utils/            # Utility functions
├── workers/          # Web workers
└── zero/             # Zero sync (queries, mutators)
```

## Components Structure

| Folder | Purpose |
|--------|---------|
| `Activity/` | Activity feed components |
| `AnalyticsDashboard/` | Analytics and metrics UI |
| `AppSidebar/` | Main application sidebar |
| `Auth/` | Authentication components |
| `Board/` | Kanban board components |
| `Call/` | Audio/video call components |
| `Canvas/` | Canvas/whiteboard components |
| `Chat/` | Chat and messaging components |
| `DocsViewer/` | Document viewer |
| `FileViewer/` | File preview components |
| `Form/` | Form components |
| `GlobalCommandMenu/` | Command palette |
| `GlobalTopBar/` | Top navigation bar |
| `Project/` | Project management UI |
| `Settings/` | Settings pages |
| `Sidebar/` | Sidebar components |
| `Tickets/` | Ticket management UI |
| `UserAvatar/` | User avatar components |
| `UserGroup/` | User group components |
| `Workflow/` | Workflow components |
| `ui/` | Shared UI primitives (buttons, inputs, etc.) |
| `icons/` | Custom icon components |

## Key Files

| File | Purpose |
|------|---------|
| `App.tsx` | Root component |
| `main.tsx` | Application entry point |
| `config.ts` | Environment configuration |
| `global.css` | Global styles |

## Where to Put Code

| Type | Location |
|------|----------|
| New feature component | `src/components/{FeatureName}/` |
| Shared UI component | `src/components/ui/` |
| Custom hook | `src/hooks/use{Name}.ts` |
| API call function | `src/api/` |
| Business logic | `src/services/` |
| State machine | `src/machines/{name}Machine.ts` |
| Zero query/mutator | `src/zero/` |
| TypeScript types | `src/types/` |
| Utility function | `src/utils/` |
