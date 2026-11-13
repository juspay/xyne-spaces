/**
 * A step or trigger found in a workflow tree, and where its config lives.
 *
 * Structural, not validation-specific: it says what is there and at what path,
 * so anything walking a workflow can address a component's config the same way
 * — and an issue raised about one lands where a shape issue about the same field
 * would.
 */
export interface ComponentRef {
  readonly kind: 'trigger' | 'step';
  readonly type: string;
  /** `'trigger.config'`, `'steps[0].config'`, `'steps[0].config.body[2].config'`. */
  readonly path: string;
  readonly config: Record<string, unknown>;
  /** Present for steps — unique across the tree, nested branches included. */
  readonly stepId?: string;
}
