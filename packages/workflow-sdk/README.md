# @xyne/workflow-sdk

Workflow engine SDK — build, validate, and execute workflows composed of triggers, steps, and control-flow primitives, with a framework-agnostic HTTP router and an optional LLM-agent system.

## Install

```bash
npm install @xyne/workflow-sdk
```

The agent system (`@xyne/workflow-sdk/agents`) additionally requires the pi-mono peer dependencies:

```bash
npm install @earendil-works/pi-agent-core @earendil-works/pi-ai typebox
```

## Entry points

| Import | Contents |
| --- | --- |
| `@xyne/workflow-sdk` | Core: registries, executor, runtime, types |
| `@xyne/workflow-sdk/builder` | `WorkflowConfig` / step / trigger config types for building workflows |
| `@xyne/workflow-sdk/conversational-flow` | Conversational flows: read, edit and create them, and read a run turn by turn (see `src/conversational-flow/README.md`) |
| `@xyne/workflow-sdk/client` | Typed HTTP client for the workflow router |
| `@xyne/workflow-sdk/router` | Framework-agnostic route definitions |
| `@xyne/workflow-sdk/runtime` | Runtime wiring types |
| `@xyne/workflow-sdk/agents` | LLM agent step + tool registry (requires pi-mono peers) |
| `@xyne/workflow-sdk/testing` | Mock contexts + test helpers |
| `@xyne/workflow-sdk/common` | Shared utilities |

## Built-in steps

`CODE`, `HTTP_REQUEST`, `CONDITIONAL`, `SWITCH`, `LOOP`, `PARALLEL`, `WAIT`, `DEDUP`, plus the agent step (`RUN_AGENT`).

## License

UNLICENSED — © Xyne. All rights reserved.
