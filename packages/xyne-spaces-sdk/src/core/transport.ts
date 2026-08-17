/**
 * Transport Layer
 *
 * Routes SDK operations to the appropriate backend:
 * - Zero queries via the OAuth-protected /api/sdk/catalog/query adapter
 * - Zero mutators via the OAuth-protected /api/sdk/catalog/mutate adapter
 * - Direct API calls via /api/sdk/*
 */

import type { Operation } from '../registry/types.js';
import type { HttpClient } from './http.js';

interface CatalogQueryResponse {
  data: unknown;
}

export class Transport {
  constructor(private http: HttpClient) {}

  /**
   * The access token currently in use.
   *
   * Exposed so a resource can read the caller's own identity out of its token —
   * see `core/token.ts`. Not for authorization decisions.
   */
  getToken(): string | undefined {
    return this.http.getToken();
  }

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
   * Execute a catalog query through the public OAuth API.
   */
  private async executeQuery(name: string, args: unknown): Promise<unknown> {
    const response = await this.http.post<CatalogQueryResponse>('/api/sdk/catalog/query', {
      name,
      args,
    });
    return response.data;
  }

  /**
   * Execute a catalog mutator through the public OAuth API.
   */
  private async executeMutator(name: string, args: unknown): Promise<unknown> {
    return this.http.post('/api/sdk/catalog/mutate', {
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
