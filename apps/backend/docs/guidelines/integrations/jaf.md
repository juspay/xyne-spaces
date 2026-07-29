# JAF (Juspay Agent Framework)

AI agent execution framework for intelligent automation.

**Package:** `@xynehq/jaf`

**Location:** `src/agents/`, `framework/`

---

## Overview

JAF provides the foundation for building AI agents with:
- Tool-based capabilities
- Streaming responses
- OpenTelemetry tracing
- LiteLLM integration

---

## Configuration

| Variable | Purpose |
|----------|---------|
| `LITELLM_API_BASE` | LiteLLM server URL |
| `LITELLM_MODEL` | Model name |
| `LITELLM_API_KEY` | API key |

---

## Agents

| Agent | Purpose | Location |
|-------|---------|----------|
| `xyne-ai` | Main AI assistant | `src/agents/xyne-ai/` |
| `summariser` | Content summarization | `src/agents/summariser/` |
| `ticket-duplicate` | Duplicate detection | `src/agents/ticket-duplicate/` |
| `title-generator` | Auto-generate titles | `src/services/agents/title-generator.ts` |

---

## Key Imports

```typescript
import {
  Agent,
  Tool,
  Message,
  Streaming,
  getOtelTraceId,
} from '@xynehq/jaf';
```

---

## Tool System

Tools extend agent capabilities with specific functions.

### Existing Tools (xyne-ai)

| Tool | Purpose |
|------|---------|
| `genius.ts` | Code generation |
| `search_relevant_tickets.ts` | Search tickets |
| `search_relevant_messages.ts` | Search messages |
| `fetch_thread_messages.ts` | Fetch conversation messages |
| `fetch_channel_messages.ts` | Fetch channel messages |
| `research_agent.ts` | Research operations |
| `field_value_discovery.ts` | Discover field values |

### Tool Structure

```typescript
import { type Tool } from '@xynehq/jaf';

export const myTool: Tool = {
  name: 'my_tool',
  description: 'What this tool does',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Search query' },
    },
    required: ['query'],
  },
  execute: async (params) => {
    // Tool logic
    return { result: 'data' };
  },
};
```

---

## Streaming

Handle streaming responses from agents:

```typescript
import { Streaming } from '@xynehq/jaf';

const stream = new Streaming();
// Use for real-time response handling
```

---

## Tracing

OpenTelemetry integration for observability:

```typescript
import { getOtelTraceId } from '@xynehq/jaf';

const traceId = getOtelTraceId();
// Use for request tracing
```

---

## Langfuse Integration

Agent tracing with Langfuse:

**Location:** `src/agents/xyne-ai/langfuse/tracing.ts`

Provides:
- Conversation tracking
- Token usage monitoring
- Agent execution traces

---

## Agent Structure (xyne-ai)

```
src/agents/xyne-ai/
├── index.ts           # Agent exports
├── agent.ts           # Agent definition
├── stream.ts          # Streaming handler
├── types.ts           # Type definitions
├── tools/             # Agent tools
│   ├── index.ts
│   ├── genius.ts
│   ├── search_relevant_tickets.ts
│   └── ...
├── langfuse/          # Tracing
│   └── tracing.ts
└── utils/             # Utilities
    └── attachmentConverter.ts
```

---

## Usage in Controllers

```typescript
import { agentController } from '@/controllers/agentController';

// Agent endpoints handle:
// - Message streaming
// - Tool execution
// - Context management
```

---

## Attachment Handling

Convert attachments for agent consumption:

```typescript
import type { Attachment } from '@xynehq/jaf';
import {
  convertToBase64,
  getMimeType,
} from '@xynehq/jaf/utils';
```
