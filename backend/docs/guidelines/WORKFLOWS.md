# Workflows Guide

Multi-step workflow engine for automated task execution. Located in `src/workflows/`.

---

## Overview

Workflows are long-running, multi-step processes that execute autonomously. They are deployed as **separate worker services** that poll the database for pending executions.

**Key Characteristics:**
- Polling-based execution (not event-driven)
- Distributed lock management (prevents duplicate execution)
- Step-by-step progress tracking
- Support for pause, resume, and cancellation
- Parent-child workflow relationships

---

## Architecture

```
API Request → Create Workflow Record → WorkflowExecution (PENDING)
                                              ↓
                              Worker Service (polling)
                                              ↓
                              Lock Acquired → Execute Steps
                                              ↓
                              Update Status (SUCCESS/FAILURE)
```

**Database Tables:**
- `Workflow` - Workflow definition and metadata
- `WorkflowExecution` - Execution instance with status, context, output
- `WorkflowStep` - Individual step progress and results

---

## Worker Deployment

Workflows run as a **separate service** via `worker.ts`. Enable different workers using environment variables.

### Starting Workers

```bash
# Start workflow worker (default - runs pollingService)
npm run worker

# Start with specific workflow type filter
WORKFLOW_TYPE=<WORKFLOW_TYPE_FROM_ENUM> npm run worker
```

### Worker Behavior

When no specific worker is enabled, the default behavior starts:
1. `pollingService` - Polls `WorkflowExecution` table for PENDING executions
2. `eventPollingService` - Polls for event-based workflow triggers

---

## Execution Flow

### Polling Mechanism

The `WorkflowPoller` continuously polls the `WorkflowExecution` table:

1. Query for executions with status `PENDING`
2. Acquire distributed lock on execution ID
3. Update status to `RUNNING`
4. Execute workflow steps sequentially
5. Update status to `SUCCESS` or `FAILURE`
6. Release lock

**Polling Config:**
- `minInterval` - Minimum poll interval when work available
- `maxInterval` - Maximum poll interval when idle
- `batchSize` - Number of parallel polling lanes

### Execution Statuses

| Status | Description |
|--------|-------------|
| `NEW` | Just created |
| `PENDING` | Waiting to be picked up |
| `RUNNING` | Currently executing |
| `SUCCESS` | Completed successfully |
| `FAILURE` | Failed with error |
| `PAUSED` | Manually paused |
| `CANCELLED` | Manually cancelled |
| `WAIT_FOR_EVENT` | Waiting for external event |
| `EXTERNAL_WAIT` | Waiting for external system |

---

## Implementing a Workflow

**Always create a dedicated folder** for each workflow in `src/workflows/definitions/`:

```
definitions/
└── my-workflow/
    ├── myWorkflow.ts      # Main workflow definition
    ├── types.ts           # Workflow-specific types
    └── utils.ts           # Helper functions
```

This keeps each workflow isolated and maintainable

### Step 1: Define Workflow Type

Add to `src/workflows/types/workflow-enums.ts`:

```typescript
export enum WorkflowType {
  // ... existing types
  MY_NEW_WORKFLOW = 'MY_NEW_WORKFLOW',
}
```

### Step 2: Define Step Enum

Create step identifiers:

```typescript
export enum MyWorkflowSteps {
  STEP_ONE = 'step_one',
  STEP_TWO = 'step_two',
  FINAL_STEP = 'final_step',
}
```

### Step 3: Create Workflow Definition

Create file in `src/workflows/definitions/`:

```typescript
import { WorkflowDefinition } from '../registry/workflowRegistry';
import { WorkflowType } from '../types/workflow-enums';
import { z } from 'zod';

// Input schema for validation
const inputSchema = z.object({
  ticketId: z.string(),
  description: z.string(),
});

// Context mapper to convert input to context
const contextMapper = (payload: any) => ({
  ticketId: payload.ticketId,
  description: payload.description,
  results: {},
});

export const myWorkflow: WorkflowDefinition<MyContext, MyOutput, typeof MyWorkflowSteps> = {
  type: WorkflowType.MY_NEW_WORKFLOW,
  name: 'My New Workflow',
  description: 'Description of what this workflow does',
  inputSchema,
  contextMapper,
  
  execute: async (engine, preExecuteResult) => {
    // Step 1
    await engine.step(MyWorkflowSteps.STEP_ONE, async (ctx) => {
      // Step logic here
      return { stepOneResult: 'data' };
    });

    // Step 2
    await engine.step(MyWorkflowSteps.STEP_TWO, async (ctx) => {
      const prevResult = ctx.results.step_one;
      return { stepTwoResult: 'processed' };
    });

    // Final step
    return engine.step(MyWorkflowSteps.FINAL_STEP, async (ctx) => {
      return { success: true, output: ctx.results };
    });
  },
};
```

### Step 4: Register Workflow

Add to `src/workflows/definitions/index.ts`:

```typescript
import { myWorkflow } from './my-workflow/myWorkflow';

export const WORKFLOW_DEFINITIONS = {
  // ... existing
  [WorkflowType.MY_NEW_WORKFLOW]: myWorkflow,
};

export function registerAllWorkflows(): void {
  // ... existing
  workflowRegistry.register(WORKFLOW_DEFINITIONS[WorkflowType.MY_NEW_WORKFLOW]);
}
```

---

## Workflow Patterns

### Sequential Steps

Execute steps one after another:

```typescript
await engine.step('step_1', async (ctx) => { /* ... */ });
await engine.step('step_2', async (ctx) => { /* ... */ });
await engine.step('step_3', async (ctx) => { /* ... */ });
```

### Loop Control

Iterate with conditions:

```typescript
await engine.loop('my_loop', async (ctx, iteration) => {
  if (iteration >= 5) {
    return LoopControl.BREAK;
  }
  // Process iteration
  return LoopControl.CONTINUE;
});
```

### Child Workflows

Spawn sub-workflows:

```typescript
await engine.spawnChildWorkflow(WorkflowType.CHILD_WORKFLOW, childContext);
```

### External Wait

Wait for external system:

```typescript
await engine.waitForExternal('external_system_id');
```

---

## Workflow Configuration

Agent configurations in `src/workflows/config.ts`:

```typescript
export const config: WorkflowConfig = {
  "agent-name": {
    systemPrompt: "Agent system prompt...",
    tools: [
      { name: "read", status: ToolStatus.ENABLED },
      { name: "write", status: ToolStatus.ENABLED },
      // ... more tools
    ]
  },
};
```

---

## Key Files

| File | Purpose |
|------|---------|
| `worker.ts` | Worker service entry point |
| `workflows/polling/workflow-poller.ts` | Polling and execution logic |
| `workflows/definitions/index.ts` | Workflow registration |
| `workflows/registry/workflowRegistry.ts` | Registry singleton |
| `workflows/types/workflow-enums.ts` | Workflow types and statuses |
| `workflows/config.ts` | Agent configurations |
| `workflows/workflow-engine.ts` | Step execution engine |

---

## Best Practices

1. **Keep steps idempotent** - Steps may retry on failure

2. **Store intermediate results** - Use context to pass data between steps

3. **Handle cancellation** - Check for cancellation in long-running steps

4. **Use descriptive step IDs** - Makes debugging easier

5. **Validate inputs** - Use Zod schema for input validation

6. **Clean up resources** - Cleanup workspaces on completion/failure

---

## Anti-Patterns

- Running workflows synchronously in API handlers
- Creating workflows without registering them
- Storing large data in context (use IDs, fetch in steps)
- Not handling workflow exceptions
- Polling too frequently (use minInterval/maxInterval)
