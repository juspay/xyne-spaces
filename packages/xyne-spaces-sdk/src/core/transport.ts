/**
 * Transport Layer
 *
 * Routes SDK operations to the versioned API:
 * - Operation ids via /api/sdk/v1/query and /api/sdk/v1/mutate
 * - Versioned REST routes via /api/sdk/v1/*
 */

import type { Operation } from '../registry/types.js';
import type { HttpClient } from './http.js';

/**
 * The API version this build of the SDK speaks.
 */
const V1 = '/api/sdk/v1';

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
    const mappedArgs = 'mapArgs' in operation && operation.mapArgs ? operation.mapArgs(args) : args;

    let rawResult: unknown;

    switch (operation.type) {
      case 'sdk':
        rawResult = await this.executeV1(operation.op, operation.kind, mappedArgs);
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
   * Execute an operation on the versioned API.
   *
   * The request carries the SDK's own operation id and nothing else about the
   * backend: `{ op: 'projects.update', args }`. Resolving that to a catalog
   * operation is the server's job, which is what lets the catalog move without
   * breaking a published client.
   *
   * A write echoes back any id the server minted for it, so a caller that
   * created a row learns its id without having had to invent one.
   */
  private async executeV1(
    op: string,
    kind: 'query' | 'mutator' | 'direct',
    args: unknown
  ): Promise<unknown> {
    if (kind === 'query') {
      const response = await this.http.post<{ data: unknown }>(`${V1}/query`, { op, args });
      return response.data;
    }
    const response = await this.http.post<{ success: boolean; generated?: Record<string, string> }>(
      `${V1}/mutate`,
      { op, args }
    );
    return response.generated ?? response;
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
