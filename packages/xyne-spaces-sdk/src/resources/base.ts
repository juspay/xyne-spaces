/**
 * Base Resource Class
 *
 * Provides the foundation for all resource classes.
 * Each resource class represents a collection of related operations
 * (e.g., users, channels, messages).
 */

import type { Transport } from '../core/transport.js';
import type { Operation } from '../registry/types.js';

/**
 * Base class for all resource classes.
 * Provides the `call` method for executing operations.
 */
export abstract class Resource {
  constructor(protected transport: Transport) {}

  /**
   * Execute an operation with the given arguments.
   */
  protected call<TArgs, TResult>(
    operation: Operation<TArgs, TResult>,
    args: TArgs
  ): Promise<TResult> {
    return this.transport.execute(operation, args);
  }
}
