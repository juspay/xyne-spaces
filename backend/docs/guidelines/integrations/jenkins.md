# Jenkins Integration

CI/CD integration for triggering builds and monitoring pipeline status.

**Location:** `src/services/jenkinsService.ts`

---

## Service

Singleton service: `jenkinsService`

```typescript
import { jenkinsService } from '@/services/jenkinsService';
```

---

## Configuration

| Variable | Purpose |
|----------|---------|
| `JENKINS_BASE_URL` | Jenkins server URL |
| `JENKINS_USERNAME` | API username |
| `JENKINS_API_TOKEN` | API token (not password) |
| `JENKINS_JOB_PATH` | Path to job (e.g., `/job/xyne-spaces`) |

**Note:** If credentials not configured, service logs warning and disables integration.

---

## Availability Check

```typescript
if (jenkinsService.isAvailable()) {
  // Jenkins is configured and ready
}
```

---

## API Operations

### Trigger Build

```typescript
const result = await jenkinsService.triggerBuild('feature-branch', {
  PARAM1: 'value1',
  PARAM2: 'value2',
});

// Returns: { success: boolean, message?: string, error?: string }
```

### Get Latest Build

```typescript
const build = await jenkinsService.getLatestBuild('main');

// Returns: JenkinsBuild | null
// {
//   id, number, url, result, building,
//   duration, estimatedDuration, timestamp,
//   displayName, description
// }
```

### Get Build Stages

```typescript
const stages = await jenkinsService.getBuildStages(123, 'main');

// Returns: JenkinsStage[]
// {
//   id, name, status, startTimeMillis,
//   durationMillis, pauseDurationMillis
// }
```

---

## Stage Status Values

| Status | Meaning |
|--------|---------|
| `SUCCESS` | Stage completed successfully |
| `FAILED` | Stage failed |
| `IN_PROGRESS` | Stage currently running |
| `NOT_EXECUTED` | Stage not run yet |
| `ABORTED` | Stage was aborted |
| `PAUSED_PENDING_INPUT` | Waiting for manual input |

---

## Authentication

- Uses Basic auth: `username:apiToken`
- Handles CSRF crumb for POST requests (if enabled on Jenkins)

**CSRF Crumb:**
```typescript
// Automatically fetched before POST requests
const crumb = await this.getCrumb();
// Returns: { crumb: string, crumbField: string } | null
```

---

## Routes

| Method | Route | Purpose |
|--------|-------|---------|
| GET | `/api/jenkins/builds/:branch/latest` | Get latest build |
| GET | `/api/jenkins/builds/:branch/:buildNumber/stages` | Get pipeline stages |
| POST | `/api/jenkins/builds/:branch/trigger` | Trigger new build |

---

## Error Handling

All errors logged with context:
- Branch name
- Build number
- Error message

Returns `null` or error response on failure, never throws.

---

## Usage Example

```typescript
import { jenkinsService } from '@/services/jenkinsService';

// Check if available
if (!jenkinsService.isAvailable()) {
  console.log('Jenkins not configured');
  return;
}

// Trigger a build
const triggerResult = await jenkinsService.triggerBuild('feature/my-branch');

if (triggerResult.success) {
  // Wait and get build info
  const build = await jenkinsService.getLatestBuild('feature/my-branch');
  
  if (build && !build.building) {
    const stages = await jenkinsService.getBuildStages(build.number, 'feature/my-branch');
    console.log('Build stages:', stages);
  }
}
```
