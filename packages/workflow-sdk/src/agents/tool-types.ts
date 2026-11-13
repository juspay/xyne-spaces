/**
 * WorkflowTool — Zod-based tool interface for engine consumers.
 *
 * Tool authors write tools using Zod schemas (consistent with the rest of
 * the engine). AgentStep converts these to pi-mono AgentTool at execution
 * time via JSON Schema conversion.
 */

import type { z } from 'zod';
import type { Attachment } from '../common/attachment.js';
import type { SandboxSession } from '../sandbox/types.js';

/** Tool definition for engine consumers — uses Zod (consistent with engine patterns). */
/**
 * A file a tool produced and already holds in memory.
 *
 * Distinct from the adapter's stream-only `StorageFile`: a sandbox hands back
 * bytes, so pretending otherwise here would only mean wrapping and unwrapping.
 * The step converts once, at the point it writes.
 */
export interface ProducedFile {
  readonly name: string;
  readonly mimeType: string;
  readonly bytes: Uint8Array;
}

export interface WorkflowTool<
  TInput extends z.ZodTypeAny = z.ZodTypeAny,
> {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: TInput;
  execute(
    args: z.infer<TInput>,
    ctx: ToolExecutionContext,
  ): Promise<unknown>;
}

/** Context available to tool execute() calls. */
export interface ToolExecutionContext {
  readonly signal: AbortSignal;
  readonly log: {
    info(msg: string): void;
    warn(msg: string): void;
    error(msg: string): void;
  };
  readonly sandbox?: SandboxSession | undefined;
  readonly addArtifact?: ((file: ProducedFile) => Promise<Attachment>) | undefined;
}
