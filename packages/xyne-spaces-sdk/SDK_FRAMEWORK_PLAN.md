# Xyne Spaces SDK Framework Design

## Overview

This document describes the architecture for the `@xyne/spaces-sdk` package, which provides a TypeScript SDK for interacting with the Xyne Spaces API.

### Design Goals

1. **Unified Interface**: Expose clean, typed methods like `sdk.users.me()`, `sdk.channels.list()`
2. **Transparent Routing**: Automatically route operations to the appropriate backend:
   - **Zero queries** via `/zero/query-fallback` for reads
   - **Zero mutators** via `/zero/push-fallback` for writes
   - **Direct API** via `/api/v1/*` for custom operations
3. **Easy Migration**: Switch between Zero and API backends with minimal code changes
4. **Type Safety**: Full TypeScript support with inference
5. **Extensibility**: Easy to add new resources and operations

---

## Architecture

### Directory Structure

```
packages/xyne-spaces-sdk/
├── package.json
├── tsconfig.json
├── README.md
├── SDK_FRAMEWORK_PLAN.md          # This file
│
├── src/
│   ├── index.ts                   # Public entry point
│   ├── client.ts                  # Main SpacesClient class
│   │
│   ├── core/
│   │   ├── transport.ts           # Routes operations to query/mutator/api
│   │   ├── http.ts                # HTTP client with auth, retry, errors
│   │   └── errors.ts              # SDK error types
│   │
│   ├── auth/
│   │   ├── index.ts               # Auth provider chain
│   │   ├── device-flow.ts         # Browser-based authorization
│   │   ├── token-store.ts         # Credential file management
│   │   └── refresh.ts             # Token refresh logic
│   │
│   ├── registry/
│   │   ├── types.ts               # Operation definition types
│   │   ├── users.ts               # User operations mapping
│   │   ├── channels.ts            # Channel operations mapping
│   │   ├── messages.ts            # Message operations mapping
│   │   ├── tickets.ts             # Ticket operations mapping
│   │   └── ...                    # Other resource registries
│   │
│   ├── resources/
│   │   ├── base.ts                # Base Resource class
│   │   ├── users.ts               # UsersResource class
│   │   ├── channels.ts            # ChannelsResource class
│   │   ├── messages.ts            # MessagesResource class
│   │   ├── tickets.ts             # TicketsResource class
│   │   └── ...                    # Other resource classes
│   │
│   └── types/
│       ├── index.ts               # Re-exports
│       ├── models.ts              # Entity types (User, Channel, etc.)
│       └── responses.ts           # API response types
│
├── examples/
│   ├── login-whoami.ts            # Basic auth example
│   ├── list-channels.ts           # Read example
│   └── send-message.ts            # Write example
│
└── test/
    ├── transport.test.ts
    ├── resources/
    └── ...
```

---

## Core Components

### 1. Operation Registry (`registry/types.ts`)

The registry defines how SDK methods map to backend operations.

```typescript
// registry/types.ts

export type OperationType = 'query' | 'mutator' | 'api';

/**
 * A Zero query operation.
 * Executed via POST /zero/query-fallback
 */
export interface QueryOperation<TArgs = unknown, TResult = unknown> {
  type: 'query';
  /** Zero query name (defined in backend/src/zero/queries.ts) */
  name: string;
  /** Transform SDK args to Zero query args */
  mapArgs?: (args: TArgs) => unknown;
  /** Transform Zero result to SDK result */
  mapResult?: (raw: unknown) => TResult;
}

/**
 * A Zero mutator operation.
 * Executed via POST /zero/push-fallback
 */
export interface MutatorOperation<TArgs = unknown, TResult = unknown> {
  type: 'mutator';
  /** Zero mutator name (defined in backend/src/zero/mutators.ts) */
  name: string;
  /** Transform SDK args to Zero mutator args */
  mapArgs?: (args: TArgs) => unknown;
  /** Transform Zero result to SDK result */
  mapResult?: (raw: unknown) => TResult;
}

/**
 * A direct REST API operation.
 * Executed via the specified HTTP method to /api/v1/*
 */
export interface ApiOperation<TArgs = unknown, TResult = unknown> {
  type: 'api';
  /** HTTP method */
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** API endpoint path (e.g., '/api/v1/users/search') */
  path: string;
  /** Transform SDK args to API request body/params */
  mapArgs?: (args: TArgs) => unknown;
  /** Transform API response to SDK result */
  mapResult?: (raw: unknown) => TResult;
}

export type Operation<TArgs = unknown, TResult = unknown> =
  | QueryOperation<TArgs, TResult>
  | MutatorOperation<TArgs, TResult>
  | ApiOperation<TArgs, TResult>;
```

#### Helper Functions

```typescript
// registry/types.ts (continued)

/** Define a Zero query operation */
export function query<TArgs, TResult>(
  name: string,
  options?: {
    mapArgs?: (args: TArgs) => unknown;
    mapResult?: (raw: unknown) => TResult;
  }
): QueryOperation<TArgs, TResult> {
  return { type: 'query', name, ...options };
}

/** Define a Zero mutator operation */
export function mutator<TArgs, TResult>(
  name: string,
  options?: {
    mapArgs?: (args: TArgs) => unknown;
    mapResult?: (raw: unknown) => TResult;
  }
): MutatorOperation<TArgs, TResult> {
  return { type: 'mutator', name, ...options };
}

/** Define a direct API operation */
export function api<TArgs, TResult>(
  method: ApiOperation['method'],
  path: string,
  options?: {
    mapArgs?: (args: TArgs) => unknown;
    mapResult?: (raw: unknown) => TResult;
  }
): ApiOperation<TArgs, TResult> {
  return { type: 'api', method, path, ...options };
}
```

---

### 2. Resource Registry Examples

#### Users Registry

```typescript
// registry/users.ts

import { query, mutator, api } from './types';
import type { User, UserProfile, UserPresence } from '../types';

export const usersOperations = {
  /**
   * Get current authenticated user.
   * Maps to: Zero query 'currentUser'
   */
  me: query<void, User>('currentUser'),

  /**
   * Get user by ID.
   * Maps to: Zero query 'getUserById'
   */
  get: query<{ userId: string }, User>('getUserById'),

  /**
   * List users in workspace.
   * Maps to: Zero query 'listUsers'
   */
  list: query<{ limit?: number; cursor?: string }, User[]>('listUsers', {
    mapArgs: (args) => ({
      limit: args.limit ?? 100,
      cursor: args.cursor,
    }),
  }),

  /**
   * Get user profile.
   * Maps to: Zero query 'getUserProfile'
   */
  getProfile: query<{ userId: string }, UserProfile>('getUserProfile'),

  /**
   * Update user profile.
   * Maps to: Zero mutator 'updateUserProfile'
   */
  updateProfile: mutator<
    { userId: string; displayName?: string; bio?: string },
    User
  >('updateUserProfile'),

  /**
   * Update user presence.
   * Not in Zero - uses direct API.
   */
  updatePresence: api<{ status: 'online' | 'away' | 'dnd' }, void>(
    'POST',
    '/api/v1/users/presence'
  ),

  /**
   * Search users.
   * Not in Zero - uses direct API.
   */
  search: api<{ query: string; limit?: number }, User[]>(
    'GET',
    '/api/v1/users/search',
    {
      mapArgs: (args) => ({
        q: args.query,
        limit: args.limit ?? 20,
      }),
    }
  ),
} as const;
```

#### Channels Registry

```typescript
// registry/channels.ts

import { query, mutator, api } from './types';
import type { Channel, ChannelParticipant, Message } from '../types';

export const channelsOperations = {
  /**
   * List channels the user is a member of.
   * Maps to: Zero query 'userChannels'
   */
  list: query<{ limit?: number }, Channel[]>('userChannels'),

  /**
   * Get channel by ID.
   * Maps to: Zero query 'getChannelById'
   */
  get: query<{ channelId: string }, Channel>('getChannelById'),

  /**
   * Get channel participants.
   * Maps to: Zero query 'channelParticipants'
   */
  getParticipants: query<{ channelId: string }, ChannelParticipant[]>(
    'channelParticipants'
  ),

  /**
   * Create a new channel.
   * Maps to: Zero mutator 'createChannel'
   */
  create: mutator<
    { name: string; description?: string; isPrivate?: boolean },
    Channel
  >('createChannel'),

  /**
   * Update channel.
   * Maps to: Zero mutator 'updateChannel'
   */
  update: mutator<
    { channelId: string; name?: string; description?: string },
    Channel
  >('updateChannel'),

  /**
   * Add participant to channel.
   * Maps to: Zero mutator 'addChannelParticipant'
   */
  addParticipant: mutator<{ channelId: string; userId: string }, void>(
    'addChannelParticipant'
  ),

  /**
   * Remove participant from channel.
   * Maps to: Zero mutator 'removeChannelParticipant'
   */
  removeParticipant: mutator<{ channelId: string; userId: string }, void>(
    'removeChannelParticipant'
  ),
} as const;
```

#### Messages Registry

```typescript
// registry/messages.ts

import { query, mutator, api } from './types';
import type { Message, MessageAttachment } from '../types';

export const messagesOperations = {
  /**
   * List messages in a conversation.
   * Maps to: Zero query 'conversationMessages'
   */
  list: query<
    { conversationId: string; limit?: number; before?: string },
    Message[]
  >('conversationMessages'),

  /**
   * Get message by ID.
   * Maps to: Zero query 'getMessageById'
   */
  get: query<{ messageId: string }, Message>('getMessageById'),

  /**
   * Send a message.
   * Maps to: Zero mutator 'sendMessage'
   */
  send: mutator<
    {
      channelId: string;
      conversationId?: string;
      content: string;
      attachments?: string[];
    },
    Message
  >('sendMessage'),

  /**
   * Update a message.
   * Maps to: Zero mutator 'updateMessage'
   */
  update: mutator<{ messageId: string; content: string }, Message>(
    'updateMessage'
  ),

  /**
   * Delete a message.
   * Maps to: Zero mutator 'deleteMessage'
   */
  delete: mutator<{ messageId: string }, void>('deleteMessage'),

  /**
   * Add reaction to message.
   * Maps to: Zero mutator 'addReaction'
   */
  addReaction: mutator<{ messageId: string; emoji: string }, void>(
    'addReaction'
  ),

  /**
   * Remove reaction from message.
   * Maps to: Zero mutator 'removeReaction'
   */
  removeReaction: mutator<{ messageId: string; emoji: string }, void>(
    'removeReaction'
  ),

  /**
   * Search messages.
   * Not in Zero - uses direct API.
   */
  search: api<{ query: string; channelId?: string; limit?: number }, Message[]>(
    'GET',
    '/api/v1/messages/search'
  ),
} as const;
```

---

### 3. Transport Layer (`core/transport.ts`)

The transport layer routes operations to the appropriate backend.

```typescript
// core/transport.ts

import type {
  Operation,
  QueryOperation,
  MutatorOperation,
  ApiOperation,
} from '../registry/types';
import type { HttpClient } from './http';

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
        rawResult = await this.executeQuery(operation, mappedArgs);
        break;
      case 'mutator':
        rawResult = await this.executeMutator(operation, mappedArgs);
        break;
      case 'api':
        rawResult = await this.executeApi(operation, mappedArgs);
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
  private async executeQuery(
    op: QueryOperation,
    args: unknown
  ): Promise<unknown> {
    const response = await this.http.post<{
      results: Array<{ name: string; data: unknown; error?: string }>;
    }>('/zero/query-fallback', {
      queries: [{ name: op.name, args }],
    });

    const result = response.results?.[0];
    if (result?.error) {
      throw new Error(`Query '${op.name}' failed: ${result.error}`);
    }

    return result?.data;
  }

  /**
   * Execute a Zero mutator via /zero/push-fallback
   */
  private async executeMutator(
    op: MutatorOperation,
    args: unknown
  ): Promise<unknown> {
    return this.http.post('/zero/push-fallback', {
      name: op.name,
      args,
    });
  }

  /**
   * Execute a direct API call
   */
  private async executeApi(
    op: ApiOperation,
    args: unknown
  ): Promise<unknown> {
    const params = args as Record<string, unknown> | undefined;

    switch (op.method) {
      case 'GET':
        return this.http.get(op.path, params);
      case 'POST':
        return this.http.post(op.path, params);
      case 'PUT':
        return this.http.put(op.path, params);
      case 'PATCH':
        return this.http.patch(op.path, params);
      case 'DELETE':
        return this.http.delete(op.path, params);
    }
  }
}
```

---

### 4. HTTP Client (`core/http.ts`)

```typescript
// core/http.ts

import { SdkError, AuthError, RateLimitError, NotFoundError } from './errors';

export interface HttpClientOptions {
  baseUrl: string;
  token?: string;
  timeout?: number;
}

export class HttpClient {
  private baseUrl: string;
  private token?: string;
  private timeout: number;

  constructor(options: HttpClientOptions) {
    this.baseUrl = options.baseUrl.replace(/\/$/, '');
    this.token = options.token;
    this.timeout = options.timeout ?? 30000;
  }

  setToken(token: string): void {
    this.token = token;
  }

  async get<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return this.request<T>('GET', url.toString());
  }

  async post<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('POST', `${this.baseUrl}${path}`, body);
  }

  async put<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PUT', `${this.baseUrl}${path}`, body);
  }

  async patch<T>(path: string, body?: unknown): Promise<T> {
    return this.request<T>('PATCH', `${this.baseUrl}${path}`, body);
  }

  async delete<T>(path: string, params?: Record<string, unknown>): Promise<T> {
    const url = new URL(path, this.baseUrl);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        if (value !== undefined) {
          url.searchParams.set(key, String(value));
        }
      }
    }
    return this.request<T>('DELETE', url.toString());
  }

  private async request<T>(
    method: string,
    url: string,
    body?: unknown
  ): Promise<T> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    };

    if (this.token) {
      headers['Authorization'] = `Bearer ${this.token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers,
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!response.ok) {
        await this.handleError(response);
      }

      // Handle empty responses
      const text = await response.text();
      if (!text) return undefined as T;

      return JSON.parse(text) as T;
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof SdkError) throw error;
      throw new SdkError('network_error', `Request failed: ${error}`);
    }
  }

  private async handleError(response: Response): Promise<never> {
    let body: { error?: string; message?: string } = {};
    try {
      body = await response.json();
    } catch {
      // Ignore JSON parse errors
    }

    const message = body.message || body.error || response.statusText;

    switch (response.status) {
      case 401:
        throw new AuthError(message);
      case 403:
        throw new SdkError('forbidden', message);
      case 404:
        throw new NotFoundError(message);
      case 429:
        throw new RateLimitError(message);
      default:
        throw new SdkError('api_error', message);
    }
  }
}
```

---

### 5. Resource Base Class (`resources/base.ts`)

```typescript
// resources/base.ts

import type { Transport } from '../core/transport';
import type { Operation } from '../registry/types';

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
```

---

### 6. Resource Classes

#### Users Resource

```typescript
// resources/users.ts

import { Resource } from './base';
import { usersOperations } from '../registry/users';
import type { User, UserProfile } from '../types';

export class UsersResource extends Resource {
  /**
   * Get the currently authenticated user.
   *
   * @example
   * const me = await sdk.users.me();
   * console.log(me.email);
   */
  me(): Promise<User> {
    return this.call(usersOperations.me, undefined);
  }

  /**
   * Get a user by ID.
   *
   * @example
   * const user = await sdk.users.get('user_abc123');
   */
  get(userId: string): Promise<User> {
    return this.call(usersOperations.get, { userId });
  }

  /**
   * List users in the workspace.
   *
   * @example
   * const users = await sdk.users.list({ limit: 50 });
   */
  list(options?: { limit?: number; cursor?: string }): Promise<User[]> {
    return this.call(usersOperations.list, options ?? {});
  }

  /**
   * Get a user's profile.
   *
   * @example
   * const profile = await sdk.users.getProfile('user_abc123');
   */
  getProfile(userId: string): Promise<UserProfile> {
    return this.call(usersOperations.getProfile, { userId });
  }

  /**
   * Update a user's profile.
   *
   * @example
   * await sdk.users.updateProfile('user_abc123', { displayName: 'John' });
   */
  updateProfile(
    userId: string,
    data: { displayName?: string; bio?: string }
  ): Promise<User> {
    return this.call(usersOperations.updateProfile, { userId, ...data });
  }

  /**
   * Update the current user's presence status.
   *
   * @example
   * await sdk.users.updatePresence('away');
   */
  updatePresence(status: 'online' | 'away' | 'dnd'): Promise<void> {
    return this.call(usersOperations.updatePresence, { status });
  }

  /**
   * Search for users.
   *
   * @example
   * const results = await sdk.users.search('john', 10);
   */
  search(query: string, limit?: number): Promise<User[]> {
    return this.call(usersOperations.search, { query, limit });
  }
}
```

#### Channels Resource

```typescript
// resources/channels.ts

import { Resource } from './base';
import { channelsOperations } from '../registry/channels';
import type { Channel, ChannelParticipant } from '../types';

export class ChannelsResource extends Resource {
  /**
   * List channels the user is a member of.
   */
  list(options?: { limit?: number }): Promise<Channel[]> {
    return this.call(channelsOperations.list, options ?? {});
  }

  /**
   * Get a channel by ID.
   */
  get(channelId: string): Promise<Channel> {
    return this.call(channelsOperations.get, { channelId });
  }

  /**
   * Get channel participants.
   */
  getParticipants(channelId: string): Promise<ChannelParticipant[]> {
    return this.call(channelsOperations.getParticipants, { channelId });
  }

  /**
   * Create a new channel.
   */
  create(data: {
    name: string;
    description?: string;
    isPrivate?: boolean;
  }): Promise<Channel> {
    return this.call(channelsOperations.create, data);
  }

  /**
   * Update a channel.
   */
  update(
    channelId: string,
    data: { name?: string; description?: string }
  ): Promise<Channel> {
    return this.call(channelsOperations.update, { channelId, ...data });
  }

  /**
   * Add a participant to a channel.
   */
  addParticipant(channelId: string, userId: string): Promise<void> {
    return this.call(channelsOperations.addParticipant, { channelId, userId });
  }

  /**
   * Remove a participant from a channel.
   */
  removeParticipant(channelId: string, userId: string): Promise<void> {
    return this.call(channelsOperations.removeParticipant, {
      channelId,
      userId,
    });
  }
}
```

---

### 7. Main Client (`client.ts`)

```typescript
// client.ts

import { HttpClient } from './core/http';
import { Transport } from './core/transport';
import { UsersResource } from './resources/users';
import { ChannelsResource } from './resources/channels';
import { MessagesResource } from './resources/messages';
import { TicketsResource } from './resources/tickets';
import { SearchResource } from './resources/search';

export interface SpacesClientOptions {
  /** Base URL of the Spaces API (default: https://spaces.xyne.app) */
  baseUrl?: string;
  /** Access token for authentication */
  token?: string;
  /** Request timeout in milliseconds (default: 30000) */
  timeout?: number;
}

export class SpacesClient {
  private http: HttpClient;
  private transport: Transport;

  /** User operations */
  readonly users: UsersResource;
  /** Channel operations */
  readonly channels: ChannelsResource;
  /** Message operations */
  readonly messages: MessagesResource;
  /** Ticket operations */
  readonly tickets: TicketsResource;
  /** Search operations */
  readonly search: SearchResource;

  constructor(options: SpacesClientOptions = {}) {
    this.http = new HttpClient({
      baseUrl: options.baseUrl ?? 'https://spaces.xyne.app',
      token: options.token,
      timeout: options.timeout,
    });

    this.transport = new Transport(this.http);

    // Initialize resources
    this.users = new UsersResource(this.transport);
    this.channels = new ChannelsResource(this.transport);
    this.messages = new MessagesResource(this.transport);
    this.tickets = new TicketsResource(this.transport);
    this.search = new SearchResource(this.transport);
  }

  /**
   * Set the access token for authentication.
   * Useful for token refresh scenarios.
   */
  setToken(token: string): void {
    this.http.setToken(token);
  }
}

/**
 * Create a new Spaces SDK client.
 *
 * @example
 * const sdk = createClient({ token: process.env.XYNE_TOKEN });
 * const me = await sdk.users.me();
 */
export function createClient(options?: SpacesClientOptions): SpacesClient {
  return new SpacesClient(options);
}
```

---

### 8. Public Entry Point (`index.ts`)

```typescript
// index.ts

export { createClient, SpacesClient } from './client';
export type { SpacesClientOptions } from './client';

// Export error types
export {
  SdkError,
  AuthError,
  NotFoundError,
  RateLimitError,
} from './core/errors';

// Export model types
export type {
  User,
  UserProfile,
  UserPresence,
  Channel,
  ChannelParticipant,
  Message,
  MessageAttachment,
  Ticket,
  // ... other types
} from './types';
```

---

## Usage Examples

### Basic Usage

```typescript
import { createClient } from '@xyne/spaces-sdk';

// Create client with token
const sdk = createClient({
  token: process.env.XYNE_SPACES_TOKEN,
});

// Get current user (uses Zero query)
const me = await sdk.users.me();
console.log(`Logged in as ${me.email}`);

// List channels (uses Zero query)
const channels = await sdk.channels.list({ limit: 10 });
for (const channel of channels) {
  console.log(`#${channel.name}`);
}

// Send message (uses Zero mutator)
await sdk.messages.send({
  channelId: channels[0].channelId,
  content: 'Hello from the SDK!',
});

// Search users (uses direct API)
const users = await sdk.users.search('john');
```

### Error Handling

```typescript
import { createClient, AuthError, NotFoundError } from '@xyne/spaces-sdk';

const sdk = createClient({ token: '...' });

try {
  const channel = await sdk.channels.get('invalid-id');
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log('Channel not found');
  } else if (error instanceof AuthError) {
    console.log('Authentication failed');
  } else {
    throw error;
  }
}
```

---

## Migration: Zero to API

When an operation needs to move from Zero to a custom API endpoint, only the registry changes:

```typescript
// Before: Uses Zero query
me: query<void, User>('currentUser'),

// After: Uses custom API
me: api<void, User>('GET', '/api/v1/users/me'),
```

The resource class and all consumer code remain unchanged.

---

## Benefits Summary

| Benefit | Description |
|---------|-------------|
| **Single Source of Truth** | All operation mappings in registry files |
| **Easy to Add Operations** | Add entry to registry + method to resource |
| **Easy Backend Migration** | Change `query` to `api` in registry only |
| **Type Safety** | Full TypeScript inference for args/results |
| **Testable** | Mock Transport for unit tests |
| **Transparent Routing** | Consumer doesn't know/care about backend |
| **Consistent Patterns** | All operations follow same pattern |
| **Self-Documenting** | Registry shows all available operations |

---

## Implementation Checklist

- [ ] Create package scaffold (`package.json`, `tsconfig.json`)
- [ ] Implement `core/errors.ts`
- [ ] Implement `core/http.ts`
- [ ] Implement `registry/types.ts`
- [ ] Implement `core/transport.ts`
- [ ] Implement `resources/base.ts`
- [ ] Implement auth module (`auth/*`)
- [ ] Implement users resource (`registry/users.ts`, `resources/users.ts`)
- [ ] Implement channels resource
- [ ] Implement messages resource
- [ ] Implement tickets resource
- [ ] Implement search resource
- [ ] Implement remaining resources
- [ ] Add examples
- [ ] Add tests
- [ ] Add README documentation
