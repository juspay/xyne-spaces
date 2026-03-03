# Integrity Debug Workflow - Test Scripts

This folder contains test scripts for the Integrity Debug Workflow. These are for development and testing purposes only.

## Location

These scripts are located within the workflow directory to keep workflow-specific tests organized:
```
backend/src/workflows/definitions/integrity-debug-workflow/test-scripts/
```

## Test Scripts

### `quick-test.sh`
Quick test using mock data (for fast local testing without research agent).
```bash
./quick-test.sh
```
- Uses `USE_MOCK_ANALYSIS=true`
- Tests basic workflow execution
- Takes ~10 seconds

### `test-with-real-agent.sh`
Test with real research agent (fetches actual logs and analyzes code).
```bash
./test-with-real-agent.sh
```
- Uses `USE_MOCK_ANALYSIS=false`
- Connects to actual research agent
- Fetches real logs from database
- Takes several minutes

## Usage

All scripts should be run from the `backend/` directory:

```bash
cd backend
./src/workflows/definitions/integrity-debug-workflow/test-scripts/quick-test.sh
```

Or use a relative path from the workflow directory:

```bash
cd backend/src/workflows/definitions/integrity-debug-workflow
./test-scripts/test-with-real-agent.sh
```

## Requirements

- Backend server running (`npm run dev`)
- Environment variables configured in `.env.local`
- For real agent tests:
  - `USE_MOCK_ANALYSIS=false`
  - `RESEARCH_AGENT_URL` configured
  - `RESEARCH_AGENT_BEARER_TOKEN` configured
