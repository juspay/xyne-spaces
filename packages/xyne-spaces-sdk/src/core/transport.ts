/**
 * Transport Layer
 *
 * Routes SDK operations to the appropriate backend:
 * - Zero queries via /zero/query-fallback
 * - Zero mutators via /zero/push-fallback
 * - Direct API calls via /api/v1/*
 */

import type { Operation } from '../registry/types.js';
import type { HttpClient } from './http.js';
import { ZeroOperationError } from './errors.js';

interface QueryFallbackResponse {
  results: Array<{
    name: string;
    data: unknown;
    error?: string;
  }>;
}

export class Transport {
  constructor(private http: HttpClient) {}

  /**
   * Execute an operation against the appropriate backend.
   */
  async execute<TArgs, TResult>(
    operation: Operation<TArgs, TResult>,
    args: TArgs
  ): Promise<TResult> {
    // Transform args if mapper provided
    const mappedArgs = operation.mapArgs ? operation.mapArgs(args) : args;

    let rawResult: unknown;

    switch (operation.type) {
      case 'query':
        rawResult = await this.executeQuery(operation.name, mappedArgs);
        break;
      case 'mutator':
        rawResult = await this.executeMutator(operation.name, mappedArgs);
        break;
      case 'api':
        rawResult = await this.executeApi(
          operation.method,
          typeof operation.path === 'function' ? operation.path(args) : operation.path,
          mappedArgs
        );
        break;
    }

    // Transform result if mapper provided
    return operation.mapResult
      ? operation.mapResult(rawResult)
      : (rawResult as TResult);
  }

  /**
   * Execute a Zero query via /zero/query-fallback
   */
  private async executeQuery(name: string, args: unknown): Promise<unknown> {
    const response = await this.http.post<QueryFallbackResponse>(
      '/zero/query-fallback',
      {
        queries: [{ name, args }],
      }
    );

    const result = response.results?.[0];
    if (result?.error) {
      throw new ZeroOperationError(name, result.error);
    }

    return result?.data;
  }

  /**
   * Execute a Zero mutator via /zero/push-fallback
   */
  private async executeMutator(name: string, args: unknown): Promise<unknown> {
    return this.http.post('/zero/push-fallback', {
      name,
      args,
    });
  }

  /**
   * Execute a direct API call
   */
  private async executeApi(
    method: string,
    path: string,
    args: unknown
  ): Promise<unknown> {
    const params = args as Record<string, unknown> | undefined;

    switch (method) {
      case 'GET':
        return this.http.get(path, params);
      case 'POST':
        return this.http.post(path, params);
      case 'PUT':
        return this.http.put(path, params);
      case 'PATCH':
        return this.http.patch(path, params);
      case 'DELETE':
        return this.http.delete(path, params);
      default:
        throw new Error(`Unsupported HTTP method: ${method}`);
    }
  }
}
