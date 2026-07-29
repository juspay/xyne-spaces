# Services

Frontend services for API calls and business logic.

**Location**: `src/services/`

## Service Categories

| Folder | Purpose |
|--------|---------|
| `Analytics/` | Analytics tracking |
| `Bot/` | Bot interactions |
| `Call/` | Call management |
| `Canvas/` | Canvas operations |
| `Chat/` | Chat functionality |
| `Emoji/` | Custom emoji handling |
| `Form/` | Form operations |
| `Jenkins/` | Jenkins integration |
| `Knowledge/` | Knowledge base |
| `Workflow/` | Workflow operations |
| `clients/` | API clients |
| `notifications/` | Notification handling |
| `otel/` | OpenTelemetry |

## Standalone Services

| Service | Purpose |
|---------|---------|
| `searchService` | Search functionality |
| `summarizeService` | AI summarization |
| `heartbeatService` | Connection health |
| `metricsService` | Metrics collection |
| `indexedDBService` | Local storage |

## Creating a Service

| Task | Location |
|------|----------|
| Create service | `src/services/{name}Service.ts` |
| Create folder | `src/services/{Name}/` for complex services |
| Reference pattern | Look at existing services |

## Do's

- Keep services stateless
- Return promises for async operations
- Use existing API clients
- Handle errors appropriately

## Don'ts

- Don't put UI logic in services
- Don't duplicate existing service functionality
- Don't store state in services
