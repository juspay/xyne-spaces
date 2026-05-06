# Issue Workflow

Automated issue analysis and resolution workflow with payment systems expertise and multi-repository support.

## Overview

This workflow analyzes issue descriptions and:
1. **Identifies affected repositories** - Single or multiple repos
2. **Analyzes the issue** - Classifies type, severity, and gateway (PayU, Razorpay, JioPay, etc.)
3. **Analyzes code** - Examines Class F files (Flow.hs, Config.hs, Types.hs) if code change needed
4. **Creates fix or report** - Generates PRs or investigation report

## Key Features

### Payment Systems Expertise
- **Gateway Detection** - Identifies specific gateways (PayU, Razorpay, JioPay, PhonePe, etc.)
- **Class F Awareness** - Knows to check Flow.hs, Config.hs, Types.hs for gateway issues
- **Priority** - Code/logs analysis FIRST, then configuration if needed

### Reliability
- **Retry Logic** - Exponential backoff (2s → 4s → 8s)
- **Error Tracking** - Comprehensive error logging with fallback values
- **Step Persistence** - All steps saved with Research Agent session IDs

### Multi-Repository Support
- Single-repo fixes
- Multi-repo coordinated fixes
- Any repository in the system

## Quick Start

### Prerequisites
```bash
# backend/.env.local
WORKFLOW_TYPE=ISSUE_WORKFLOW
RESEARCH_AGENT_POMERIUM_COOKIE=<your-cookie>
RESEARCH_AGENT_API_KEY=<your-key>
```

### Run Servers
```bash
# Terminal 1: Backend
cd backend && npm run dev

# Terminal 2: Worker
cd backend && npm run dev:worker
```

### Test Scripts

#### 1. Simple Test (Custom Description)
```bash
cd backend/src/workflows/definitions/issue-workflow/test-scripts
./test-issue.sh "Your issue description here"
```

#### 2. Detailed Test (With Steps)
```bash
./test-with-steps.sh
```
Shows complete workflow execution including:
- Workflow ID and execution ID
- Step-by-step progress
- Final results and context
- Step details with RA session IDs

## Input

```json
{
  "ticketId": "ISSUE-123",
  "workflowType": "ISSUE_WORKFLOW",
  "title": "Issue Title",
  "description": "Detailed issue description",
  "input": {
    "description": "Same as above"
  }
}
```

## Output

### Single Repository
```json
{
  "issueType": "bug",
  "severity": "high",
  "issueCategory": "gateway",
  "gatewayName": "PayU",
  "repositories": ["euler-api-gateway"],
  "multiRepo": false,
  "requiresCodeChange": true,
  "analysisApproach": "code_and_logs_first",
  "prLink": "https://bitbucket.org/..."
}
```

### Multiple Repositories
```json
{
  "repositories": ["euler-api-gateway", "euler-hs"],
  "multiRepo": true,
  "prLinks": {
    "euler-api-gateway": "https://...",
    "euler-hs": "https://..."
  }
}
```

## Classification

### Issue Categories
- `gateway` - Payment gateway issues (PayU, Razorpay, JioPay, etc.)
- `core_flow` - Core payment processing logic
- `multi_repo` - Cross-repository issues
- `other` - General issues

### Analysis Approach
- `code_and_logs_first` - Default: Check code/logs before configs
- `configuration_check` - Configuration-specific issue
- `requires_investigation` - Needs more information

### Severity
- `critical` - System down, data loss, security
- `high` - Major functionality broken
- `medium` - Moderate impact
- `low` - Minor issue

## Configuration

### Workflow Config (`config.ts`)
```typescript
{
  agents: {
    step1: 'issue-step1-repository-identifier',
    step2: 'issue-step2-issue-analyzer',
    step3: 'issue-step3-code-analyzer'
  },
  retry: {
    maxRetries: 2,
    retryDelayMs: 2000,
    exponentialBackoff: true
  }
}
```

### Agent System Prompts (`../../config.ts`)
- Repository identification with multi-repo awareness
- Issue analysis with payment systems expertise
- Code analysis with Class F file knowledge

## File Structure

```
issue-workflow/
├── README.md                    # This file
├── issueWorkflow.ts            # Main workflow logic
├── config.ts                   # Workflow configuration
├── prompts.ts                  # User prompt builders
├── types.ts                    # TypeScript interfaces
├── utils.ts                    # Helper functions
├── retry-utils.ts              # Retry logic
├── retry-tracking.ts           # Retry metadata
└── test-scripts/
    ├── test-issue.sh           # Simple test
    └── test-with-steps.sh      # Detailed test with steps
```

## Troubleshooting

**Research Agent 401 Error**
- Update `RESEARCH_AGENT_POMERIUM_COOKIE` in `.env.local`
- Restart worker: `npm run dev:worker`

**Workflow Stuck in PENDING**
- Check worker is running: `npm run dev:worker`
- Check `WORKFLOW_TYPE=ISSUE_WORKFLOW` in `.env.local`
- Check worker logs: `tail -f /tmp/xyne-server.log`

**Steps Not Found**
- Check execution ID is correct
- Ensure workflow completed (not still running)
- Check worker logs for serialization errors
