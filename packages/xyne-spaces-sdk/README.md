# @xyne/spaces-sdk

TypeScript SDK for the Xyne Spaces API.

## Installation

```bash
npm install @xyne/spaces-sdk
# or
pnpm add @xyne/spaces-sdk
```

## Usage

```typescript
import { createClient } from '@xyne/spaces-sdk';

// Create a client with your access token
const sdk = createClient({
  token: process.env.XYNE_SPACES_TOKEN,
});

// List users in the workspace
const users = await sdk.users.list();
for (const user of users) {
  console.log(user.email);
}

// Get a user's profile
const profile = await sdk.users.getProfile('user-123');

// Search across messages, tickets, files, etc.
const results = await sdk.search.query({
  q: 'project update',
  type: 'message',
  limit: 20,
});
```

## Architecture

The SDK uses a registry-based architecture that transparently routes operations to the appropriate backend:

- **Zero queries** via `/zero/query-fallback` for reads
- **Zero mutators** via `/zero/push-fallback` for writes
- **Direct API** via `/api/v1/*` for custom operations (e.g., search)

This design allows operations to be easily migrated between backends without changing the SDK interface.

## Error Handling

```typescript
import { createClient, AuthError, NotFoundError, RateLimitError } from '@xyne/spaces-sdk';

const sdk = createClient({ token: '...' });

try {
  const profile = await sdk.users.getProfile('invalid-id');
} catch (error) {
  if (error instanceof NotFoundError) {
    console.log('User not found');
  } else if (error instanceof AuthError) {
    console.log('Authentication failed - check your token');
  } else if (error instanceof RateLimitError) {
    console.log(`Rate limited - retry after ${error.retryAfter}s`);
  } else {
    throw error;
  }
}
```

## Available Resources

### Users

- `sdk.users.list(options?)` - List all users in the workspace
- `sdk.users.listBasic(options?)` - List users without presence data
- `sdk.users.getProfiles(userIds)` - Get profiles for multiple users
- `sdk.users.getProfile(userId)` - Get a single user's profile

### Search

- `sdk.search.query(options)` - Search across messages, tickets, files, channels, calls, and users
- `sdk.search.getSchema(type)` - Get the schema for a search index

## License

MIT
