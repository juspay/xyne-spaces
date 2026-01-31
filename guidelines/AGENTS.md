# AGENTS.md

This document provides code style guidelines for agentic coding agents working in this repository.

## Project Structure

This is a monorepo with multiple workspaces:
- `backend/` - Node.js/Express API server (TypeScript)
- `dashboard/` - React/Vite web dashboard (TypeScript + React)
- `apps/xyne-spaces/` - React Native mobile app
- `framework/` - Agentic AI framework library
- `shared/` - Shared code between dashboard and backend
- `xyne-automation/` - Playwright E2E test suite

## Code Style Guidelines

### Imports
- ES6 import syntax: `import { foo } from 'bar'`
- Group: external libs first, then internal modules
- Backend: `@/` alias for src/ paths; Dashboard: relative imports

### Formatting (Prettier)
```json
{"semi":true,"singleQuote":true,"trailingComma":"all","printWidth":100,"tabWidth":2,"useTabs":false,"jsxSingleQuote":true}
```

### TypeScript
- Strict mode enabled; explicit return types **warned** (preferred)
- `any` type: **error** in dashboard, **warn** in backend/framework
- Use `zod` for runtime validation; interfaces for public APIs, types for internal

### Naming
- Classes/Interfaces/Types: `PascalCase` (e.g., `UserService`)
- Functions/Variables: `camelCase` (e.g., `getUserById`)
- Constants: `UPPER_CASE` (e.g., `MAX_RETRY_COUNT`)
- Private members: prefix `_` (e.g., `_privateMethod`)
- Enum members: `UPPER_CASE` (e.g., `TicketStatus.OPENED`)
- Type parameters: `PascalCase` (e.g., `T`, `K`)
- Event types: colon notation allowed (e.g., `pipeline:started`)

### Error Handling
Backend uses `AppError` (src/middleware/errorHandler.ts): `throw new AppError('msg', 404);`
Log with context, return proper HTTP status codes

### React (Dashboard)
- Functional components with hooks
- Custom hooks prefix `use` (e.g., `useAuth`)
- Use XState machines for complex state (`machines/` dir)
- Use `@tanstack/react-query` for server state
- Components using `@xyne/shared` Context must use `useAuthContextValues`

### ESLint Rules (Key)
- `eqeqeq`: strict equality (`===`, `!==`)
- `no-console`: warn (use logger)
- `curly`: braces for all control statements
- `prefer-const`: const over let for non-reassigned
- `@typescript-eslint/no-unused-vars`: allow `_` prefix
- `react/react-in-jsx-scope`: off

## Technologies

### Core Stack
- **Backend**: Node.js (Express), Prisma (ORM), Bull/Redis (Task Queues).
- **Dashboard**: React, Vite, TanStack Query, XState (State Machines).
- **Mobile**: React Native (0.82.1) + Hermes, LiveKit for calls.
- **Framework**: Custom Agentic AI framework using `@modelcontextprotocol/sdk` and `litellm`.

### Zero (Real-time Sync)
- **Zero**: Local-first sync engine for real-time data across clients.
  - **Queries**: Defined in `zero/queries.ts` using `zql` (Zero Query Language).
  - **Mutators**: Defined in `zero/mutators.ts`. Used for data modifications.
  - **Important**: When adding or changing queries/mutators, you **must** update them in both `backend/src/zero/` and `dashboard/src/zero/`.
  - **Schema**: Defined in `shared/src/zero/schema.ts`. Any database schema changes must be reflected here.
  - Mutators in the dashboard provide optimistic UI updates, while backend mutators perform the actual database operations.

### Collaboration & Editor
- **Yjs / y-sweet**: CRDT-based collaborative editing for documents.
- **BlockNote**: Block-based rich text editor used for notes/docs.

### AI & Infrastructure
- **LLM**: LiteLLM for multi-provider support (Anthropic, Vertex, etc.).
- **Search**: Vespa for vector search and high-performance retrieval.
- **Storage**: Google Cloud Storage (GCS) for media and attachments.
- **Analytics**: Mixpanel for event tracking across platforms.

### Quality & Automation
- **Testing**: Playwright + Cucumber (BDD) in `xyne-automation/`.
- **Validation**: Zod for runtime type checking and API validation.


### Notes
- Backend: `@/` maps to `src/`; Dashboard: Vite + strict TS
- React Native: React 0.82.1 + Hermes; Electron support in `electron/`
- Docker compose: `npm run services`
