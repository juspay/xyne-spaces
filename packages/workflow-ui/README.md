# @xyne/workflow-ui

React UI for [`@xyne/workflow-sdk`](https://www.npmjs.com/package/@xyne/workflow-sdk) — a visual workflow builder and execution viewer.

## Install

```bash
npm install @xyne/workflow-ui @xyne/workflow-sdk react react-dom
```

`react`, `react-dom`, and `@xyne/workflow-sdk` are peer dependencies.

## Usage

```tsx
import '@xyne/workflow-ui/styles.css';
import { WorkflowUIProvider, WorkflowDashboard } from '@xyne/workflow-ui';
import { createWorkflowClient } from '@xyne/workflow-sdk/client';

const client = createWorkflowClient({
  baseUrl: '/api/workflows',
  getHeaders: () => ({ Authorization: `Bearer ${token}` }),
});

export function App() {
  return (
    <WorkflowUIProvider client={client}>
      <WorkflowDashboard />
    </WorkflowUIProvider>
  );
}
```

Hooks are available from `@xyne/workflow-ui/hooks`.

## License

UNLICENSED — © Xyne. All rights reserved.
