# Integrity Debug Workflow

Automated debugging of payment integrity check failures using AI agents.

## What It Does

When integrity checks fail, this workflow:
1. Identifies which repository contains the gateway code
2. Analyzes the Money framework to understand expected amount format
3. Determines what log fields are needed for debugging
4. Collects logs for the failed orders
5. Performs dry-run code analysis and suggests fixes

## Quick Start

### 1. Configure Environment

```bash
# backend/.env.local

# Mock mode (for testing without research agent)
USE_MOCK_ANALYSIS=true

# Real mode (requires research agent)
USE_MOCK_ANALYSIS=false
RESEARCH_AGENT_URL=https://your-research-agent-url
RESEARCH_AGENT_BEARER_TOKEN=your-token
```

### 2. Start Backend

```bash
cd backend
npm run dev
```

### 3. Run Test

```bash
# Quick test with mock data
./src/workflows/definitions/integrity-debug-workflow/test-scripts/quick-test.sh

# Test with real research agent
./src/workflows/definitions/integrity-debug-workflow/test-scripts/test-with-real-agent.sh
```

## Input Format

```json
{
  "ticketId": "XYNE-1234",
  "workflowType": "INTEGRITY_DEBUG_WORKFLOW",
  "gateway": "PAYU",
  "merchantId": "test_merchant",
  "flow": "WEBHOOK",
  "failureReason": "INTEGRITY_CHECK_FAILED",
  "orderIds": ["ORDER123", "ORDER456"]
}
```

**Fields:**
- `gateway` - Payment gateway (PAYU, RAZORPAY, SETU, etc.)
- `merchantId` - Merchant identifier
- `flow` - WEBHOOK, SYNC, or REDIRECT
- `failureReason` - Reason for integrity failure
- `orderIds` - Array of order IDs to analyze

## Workflow Steps

1. **Identify Repository** - Determines if code is in euler-api-txns or euler-api-gateway
2. **Analyze Amount Format** - Understands Money framework configuration
3. **Discover Log Requirements** - Identifies what data is needed from logs
4. **Collect Logs** - Fetches transaction logs for the failed orders
5. **Code Analysis** - Performs dry-run analysis and suggests fixes

## Configuration

### Workflow Configuration

All configuration is in `config.ts`:

```typescript
{
  use_mock_analysis: false,  // Toggle mock/real mode
  agents: {
    step1: 'integrity-step1-repository-identifier',
    step2: 'integrity-step2-amount-format-analyzer',
    step3: 'integrity-step3-log-requirements-analyzer',
    step4: 'integrity-step4-log-collector',
    step5: 'integrity-step5-code-analyzer',
  }
}
```

Git settings are hardcoded in `INTEGRITY_GIT_CONFIG`.

### Retry Configuration

The workflow includes automatic retry logic for all research agent steps. Add these to `.env.local`:

```bash
# Retry Configuration (all enabled by default)
INTEGRITY_RETRY_ENABLED=true                    # Enable/disable retries (default: true)
INTEGRITY_MAX_RETRIES=5                         # Maximum number of retries (default: 5)
INTEGRITY_RETRY_DELAY_MS=2000                   # Initial retry delay in ms (default: 2000)
INTEGRITY_EXPONENTIAL_BACKOFF=true              # Use exponential backoff (default: true)
```

**Retry Behavior:**
- Exponential backoff: 2s → 4s → 8s → 16s → 32s
- All 5 steps retry independently
- Retry metadata tracked in workflow step outputs
- Graceful fallbacks if all retries fail

**Environment-Specific Settings:**

```bash
# Production (robust retry)
INTEGRITY_MAX_RETRIES=5
INTEGRITY_RETRY_DELAY_MS=2000
INTEGRITY_EXPONENTIAL_BACKOFF=true

# Development (faster iteration)
INTEGRITY_MAX_RETRIES=2
INTEGRITY_RETRY_DELAY_MS=1000
INTEGRITY_EXPONENTIAL_BACKOFF=false

# Debugging (no retries)
INTEGRITY_RETRY_ENABLED=false
```

## Output

```json
{
  "sessionsAnalyzed": 2,
  "issueType": "amount_mismatch",
  "repository": "euler-api-txns",
  "analysisDetails": {
    "analysis_summary": "...",
    "is_our_issue": true,
    "affected_files": [...],
    "suggested_fix": {...}
  },
  "prLink": "https://bitbucket.org/..."
}
```

## Test Scripts

Located in `test-scripts/` folder:

- `quick-test.sh` - Fast test with mock data (~10 seconds)
- `test-with-real-agent.sh` - Full test with real research agent (several minutes)
- `README.md` - Test scripts documentation

## Key Files

```
integrity-debug-workflow/
├── README.md                    # This file
├── config.ts                    # Workflow configuration
├── integrityDebugWorkflow.ts    # Main workflow implementation
├── prompts-v2.ts                # User prompt builders
├── mockResearchAgent-v2.ts      # Mock responses for testing
├── types.ts                     # TypeScript interfaces
├── utils.ts                     # Helper functions
└── test-scripts/                # Test scripts
    ├── README.md
    ├── quick-test.sh
    └── test-with-real-agent.sh
```

## Agents

System prompts are defined in `backend/src/workflows/config.ts`:

- `integrity-step1-repository-identifier` - Repository identification
- `integrity-step2-amount-format-analyzer` - Money framework analysis
- `integrity-step3-log-requirements-analyzer` - Log discovery
- `integrity-step4-log-collector` - Log collection
- `integrity-step5-code-analyzer` - Code analysis and fix suggestion

These are automatically synced to the database on deployment.

## Development

### Adding a New Agent

1. Define agent config in `backend/src/workflows/config.ts`
2. Add to workflow config agents in `config.ts`
3. Update workflow code to use the agent

### Debugging

```bash
# Enable debug mode
NODE_ENV=development

# View workflow logs
tail -f logs/*.log | grep "XYNE-1234"

# Check specific step
grep "step2-amount-format" logs/XYNE-1234/*.json
```

### Mock Mode

Mock responses are in `mockResearchAgent-v2.ts`. When `USE_MOCK_ANALYSIS=true`:
- No research agent calls are made
- Predefined responses are returned
- Faster execution for testing
- No external dependencies

## Recent Improvements

### Repository-Specific Branches
- api-gateway uses `master` branch
- api-txns uses `main` branch
- Auto-detects correct base branch per repository

### Commit Requirements
- Automatically adds `EUL-0000` prefix for Bitbucket compliance
- Meets Jira ticket requirements for git push

### PG Failure Handling
- Checks actual PG response status (not txnStatus)
- Skips integrity check only when PG itself fails
- All other flows (txn status mapping, webhooks) continue normally
- Returns `CANNOT_PERFORM_INTEGRITY` only for decode/timeout errors

## Notes

- **Repository IDs** are hardcoded in `getRepositoryId()` function
- **Git configuration** is hardcoded in `INTEGRITY_GIT_CONFIG`
- **System prompts** come from database (defined in agent configs)
- **User prompts** are built dynamically based on workflow context
- **Debug files** are only written in development/test mode (not production)
- **Retry tracking** stores attempt metadata in step outputs

## Retry Tracking & Observability

Retry attempts are tracked and stored in workflow step outputs for debugging:

```json
{
  "repository": "api-gateway",
  "retryMetadata": {
    "totalAttempts": 2,
    "maxRetries": 5,
    "finalStatus": "success",
    "attempts": [
      {
        "attemptNumber": 1,
        "status": "failed",
        "error": "Connection timeout",
        "durationMs": 2340
      },
      {
        "attemptNumber": 2,
        "status": "success",
        "durationMs": 850
      }
    ]
  }
}
```

**Access retry data:**
- API: `GET /api/workflows/executions/:id/steps`
- Logs: Search for "RETRY", "FAILED", or "Retry Summary"
- Step outputs: Includes full retry metadata

**Console logs example:**
```
[TICKET-123 - Repository Identification] 🔄 Attempt 1/6
[TICKET-123 - Repository Identification] ❌ Attempt 1/6 FAILED: Connection timeout
[TICKET-123 - Repository Identification] ⏳ Waiting 2000ms before retry...
[TICKET-123 - Repository Identification] 🔄 Attempt 2/6 (RETRY)
[TICKET-123 - Repository Identification] ✅ SUCCEEDED on retry attempt 2 after 1 failures
```

## Failure Handling

The workflow handles special cases:

- **Decode/Timeout Errors** - Returns `CANNOT_PERFORM_INTEGRITY` (not failure)
- **PG Response Failures** - Skips integrity check when PG response indicates failure (normal txn status mapping continues)
- **Gateway Issues** - Escalates to gateway team instead of creating PR
- **Missing Logs** - Reports clearly which orders have no logs
- **Retry Exhaustion** - Falls back to sensible defaults and continues workflow

## Troubleshooting

**"Research query completed but no complete response was received"**
- Research agent timed out
- Check research agent logs
- May need to simplify prompt or increase server timeout

**"Cannot convert undefined or null to object"**
- Missing required field in step output
- Check step response structure matches expected format

**TypeScript compilation errors**
- Run `npx tsc --noEmit` to check
- Ensure all imports are correct