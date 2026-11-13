/**
 * ToolLoggingInterceptor — emits tool call events via ctx.emit() for observability.
 *
 * Intercepts all tool calls, emits a 'tool_call' progress event, and
 * always returns 'allow' (never blocks).
 */

import type { StepProgressEvent } from '../../types/step-events.js';
import type { ToolInterceptor } from '../interceptor.js';

export class ToolLoggingInterceptor implements ToolInterceptor {
  constructor(
    private readonly emit: (event: StepProgressEvent) => void,
  ) {}

  shouldIntercept(): boolean {
    return true;
  }

  async handle(
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<'allow'> {
    this.emit({
      type: 'tool_call',
      data: { tool: toolName, args, phase: 'start' },
    });
    return 'allow';
  }
}
