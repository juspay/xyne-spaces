# Web Workers

Background processing in separate threads.

**Location**: `src/workers/`

## Available Workers

| Worker | Purpose |
|--------|---------|
| `heartbeat.worker` | Connection health monitoring |

## When to Use

| Use Case | Solution |
|----------|----------|
| Heavy computation | Web worker |
| Background polling | Web worker |
| UI operations | Main thread |
| API calls | Services |

## Creating a Worker

| Task | Location |
|------|----------|
| Create worker | `src/workers/{name}.worker.ts` |
| Reference pattern | Look at `heartbeat.worker.ts` |

## Do's

- Use for CPU-intensive tasks
- Keep worker communication minimal
- Handle worker errors

## Don'ts

- Don't access DOM in workers
- Don't use workers for simple tasks
- Don't send large payloads frequently
