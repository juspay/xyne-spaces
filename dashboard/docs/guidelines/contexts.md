# Contexts

React contexts for shared state.

**Location**: `src/contexts/`

## Available Contexts

| Context | Purpose |
|---------|---------|
| `CodeServerContext` | Code server integration |
| `DragDropFileContext` | File drag and drop |
| `TypingStateContext` | Typing indicators |
| `VSCodeContext` | VS Code integration |

## When to Use

| Use Case | Solution |
|----------|----------|
| App-wide config | Provider |
| Subtree-specific state | Context |
| Cross-component communication | Context |

## Creating a Context

| Task | Location |
|------|----------|
| Create context | `src/contexts/{Name}Context.tsx` |
| Reference pattern | Look at existing contexts |

## Do's 

- Keep contexts focused on single concern
- Provide default values
- Use memo for context values

## Don'ts 

- Don't use context for server data (use Zero)
- Don't create deeply nested contexts
- Don't put business logic in context
