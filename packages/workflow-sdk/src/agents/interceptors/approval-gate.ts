/**
 * ApprovalGateInterceptor — gates tool calls that require human approval.
 *
 * Any tool whose name is in the configured list always returns 'pause',
 * causing AgentStep to build a PauseRequest for the host UI.
 */

import type { ToolInterceptor } from '../interceptor.js';

export class ApprovalGateInterceptor implements ToolInterceptor {
  private readonly gatedTools: ReadonlySet<string>;

  constructor(toolNames: readonly string[]) {
    this.gatedTools = new Set(toolNames);
  }

  shouldIntercept(toolName: string): boolean {
    return this.gatedTools.has(toolName);
  }

  async handle(): Promise<'pause'> {
    return 'pause';
  }
}
