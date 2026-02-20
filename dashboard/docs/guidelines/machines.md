# State Machines

XState machines for complex state management.

**Location**: `src/machines/`

## Available Machines

| Machine | Purpose |
|---------|---------|
| `authMachine` | Authentication flow |
| `callMachine` | Call state management |
| `roomMachine` | Room/channel state |
| `shortcutsMachine` | Keyboard shortcuts |
| `ticketFiltersMachine` | Ticket filtering |
| `xyneAIMachine` | AI assistant state |
| `workflowScreenMachine` | Workflow UI state |
| `queryCacheMachine` | Query caching |
| `pdfMachine` | PDF generation |
| `webviewMachine` | Webview state |
| `vscodeWorkspaceMachine` | VS Code integration |
| `stateMachine` | Generic state machine utilities, having cached values of data and other utilites |

## When to Use

| Use Case | Solution |
|----------|----------|
| Simple state | useState |
| Shared state | Context or Zero |
| Complex flows | XState machine |
| Multi-step processes | XState machine |

## Creating a Machine

| Task | Location |
|------|----------|
| Create machine | `src/machines/{name}Machine.ts` |
| Reference pattern | Look at `authMachine`, `callMachine` |

## Do's 

- Use for complex state with multiple transitions
- Define all states and events
- Keep machines focused on single concern

## Don'ts 

- Don't use machines for simple state
- Don't put API calls directly in machines
- Don't create overly complex machines
