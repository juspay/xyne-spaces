#!/bin/bash

# Test Integrity Debug Workflow with REAL Research Agent
# This uses actual research agent to fetch logs and analyze code

set -e

echo "========================================"
echo "Testing Integrity Debug Workflow"
echo "WITH REAL RESEARCH AGENT"
echo "========================================"
echo ""

# Check if USE_MOCK_ANALYSIS is false
if grep -q "USE_MOCK_ANALYSIS=true" .env.local 2>/dev/null; then
    echo "❌ ERROR: USE_MOCK_ANALYSIS is still set to true in .env.local"
    echo "   Please set USE_MOCK_ANALYSIS=false to use real research agent"
    exit 1
fi

echo "✅ Mock mode is disabled (will use real research agent)"
echo ""

# Generate a unique ticket ID
TICKET_ID="TEST-REAL-AGENT-$(date +%s)"

# ============================================
# CONFIGURE THESE VALUES BEFORE RUNNING:
# ============================================
ORDER_IDS='["YOUR_ORDER_ID_1"]'                    # Replace with actual order IDs
GATEWAY="YOUR_GATEWAY"                              # e.g., SETU, PAYU, RAZORPAY
MERCHANT_ID="YOUR_MERCHANT_ID"                      # e.g., storytv, test_merchant
FLOW="WEBHOOK"                                      # WEBHOOK, SYNC, or REDIRECT

# Multiple orders example (uncomment and replace):
# ORDER_IDS='["ORDER_ID_1","ORDER_ID_2","ORDER_ID_3"]'

echo "Test Configuration:"
echo "  Ticket ID: $TICKET_ID"
echo "  Gateway: $GATEWAY"
echo "  Merchant: $MERCHANT_ID"
echo "  Flow: $FLOW"
echo "  Order IDs: $(echo $ORDER_IDS | jq -r 'length') order(s)"
echo "  Mode: REAL (will fetch actual logs and analyze code)"
echo ""

# Create the request payload
PAYLOAD=$(jq -n \
  --arg ticketId "$TICKET_ID" \
  --argjson orderIds "$ORDER_IDS" \
  --arg gateway "$GATEWAY" \
  --arg merchantId "$MERCHANT_ID" \
  --arg flow "$FLOW" \
  '{
    ticketId: $ticketId,
    workflowType: "INTEGRITY_DEBUG_WORKFLOW",
    title: "Test Integrity Debug - Real Agent",
    description: "Testing with real research agent",
    gateway: $gateway,
    merchantId: $merchantId,
    flow: $flow,
    failureReason: "INTEGRITY_CHECK_FAILED",
    orderIds: $orderIds
  }')

echo "Starting workflow execution..."
echo ""

# Make the API request with dev mode headers
RESPONSE=$(curl -s -X POST http://localhost:3001/api/workflows \
  -H "Content-Type: application/json" \
  -H "x-dev-mode: true" \
  -H "x-dev-user-id: test-user-123" \
  -H "x-dev-user-email: test@example.com" \
  -H "x-dev-user-name: Test User" \
  -d "$PAYLOAD")

# Extract workflow and execution IDs
WORKFLOW_ID=$(echo "$RESPONSE" | jq -r '.workflow.id // .workflowId // .id // empty')
EXECUTION_ID=$(echo "$RESPONSE" | jq -r '.execution.id // .executionId // empty')

if [ -z "$WORKFLOW_ID" ]; then
  echo "❌ Failed to start workflow"
  echo "Response:"
  echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
  exit 1
fi

echo "✅ Workflow started successfully"
echo "   Workflow ID: $WORKFLOW_ID"
echo "   Execution ID: $EXECUTION_ID"
echo ""

# Wait for workflow to complete
echo "⏳ Waiting for workflow to complete..."
echo "   (This will take several minutes with real research agent)"
echo ""

MAX_WAIT=900  # 15 minutes (research agent can take time)
ELAPSED=0
POLL_INTERVAL=10

while [ $ELAPSED -lt $MAX_WAIT ]; do
  # Check workflow status
  STATUS_RESPONSE=$(curl -s "http://localhost:3001/api/workflows/executions/$EXECUTION_ID" \
    -H "x-dev-mode: true" \
    -H "x-dev-user-id: test-user-123" \
    -H "x-dev-user-email: test@example.com" \
    -H "x-dev-user-name: Test User")
  STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status // empty')

  # Get current step info
  CURRENT_STEP=$(curl -s "http://localhost:3001/api/workflows/executions/$EXECUTION_ID/steps" \
    -H "x-dev-mode: true" \
    -H "x-dev-user-id: test-user-123" \
    -H "x-dev-user-email: test@example.com" \
    -H "x-dev-user-name: Test User" | \
    jq -r '.steps[] | select(.status == "in_progress" or .status == "pending") | .stepName' | head -1)

  echo "  [${ELAPSED}s] Status: $STATUS | Current Step: ${CURRENT_STEP:-completed}"

  if [ "$STATUS" = "SUCCESS" ] || [ "$STATUS" = "completed" ]; then
    echo ""
    echo "✅ Workflow completed successfully!"
    echo ""
    break
  fi

  if [ "$STATUS" = "FAILURE" ] || [ "$STATUS" = "failed" ]; then
    echo ""
    echo "❌ Workflow failed!"
    echo ""
    echo "Error details:"
    echo "$STATUS_RESPONSE" | jq '.error // .message // .'
    echo ""
    echo "Check logs for details:"
    echo "  grep '$TICKET_ID' logs/*.log"
    exit 1
  fi

  sleep $POLL_INTERVAL
  ELAPSED=$((ELAPSED + POLL_INTERVAL))
done

if [ $ELAPSED -ge $MAX_WAIT ]; then
  echo ""
  echo "❌ Workflow timed out after ${MAX_WAIT} seconds"
  echo "   Workflow ID: $WORKFLOW_ID"
  echo "   Execution ID: $EXECUTION_ID"
  echo ""
  echo "Check status manually:"
  echo "  curl http://localhost:3001/api/workflows/executions/$EXECUTION_ID | jq '.'"
  exit 1
fi

# Show results
echo "========================================"
echo "Workflow Results:"
echo "========================================"
echo ""

# Get final workflow output
FINAL_OUTPUT=$(curl -s "http://localhost:3001/api/workflows/executions/$EXECUTION_ID" \
  -H "x-dev-mode: true" \
  -H "x-dev-user-id: test-user-123" \
  -H "x-dev-user-email: test@example.com" \
  -H "x-dev-user-name: Test User")

# Parse output
OUTPUT=$(echo "$FINAL_OUTPUT" | jq -r '.output // empty')

if [ -n "$OUTPUT" ] && [ "$OUTPUT" != "null" ]; then
  ANALYSIS=$(echo "$OUTPUT" | jq '.')
  
  SESSIONS_ANALYZED=$(echo "$ANALYSIS" | jq -r '.sessionsAnalyzed // "N/A"')
  ISSUE_TYPE=$(echo "$ANALYSIS" | jq -r '.issueType // "N/A"')
  REPOSITORY=$(echo "$ANALYSIS" | jq -r '.repository // "N/A"')
  PR_LINK=$(echo "$ANALYSIS" | jq -r '.prLink // "N/A"')
  
  echo "📊 Summary:"
  echo "  Sessions Analyzed: $SESSIONS_ANALYZED"
  echo "  Issue Type: $ISSUE_TYPE"
  echo "  Repository: $REPOSITORY"
  echo ""
  
  if [ "$PR_LINK" != "N/A" ] && [ "$PR_LINK" != "null" ]; then
    echo "🔗 Changes:"
    echo "  $PR_LINK"
    echo ""
  fi
  
  echo "🔍 Code Analysis:"
  echo "=================="
  ANALYSIS_SUMMARY=$(echo "$ANALYSIS" | jq -r '.analysisDetails.analysis_summary // "N/A"')
  echo "$ANALYSIS_SUMMARY"
  echo ""
  
  echo "📄 Affected Files:"
  echo "$ANALYSIS" | jq -r '.analysisDetails.affected_files[]? | "  - \(.file_path) (\(.function_name), lines \(.line_numbers))"' 2>/dev/null || echo "  No file details"
  echo ""
  
  echo "✏️  Suggested Fix:"
  echo "$ANALYSIS" | jq -r '.analysisDetails.suggested_fix.description // "N/A"'
  echo ""
  
  # Show git diff if available
  GIT_DIFF=$(echo "$ANALYSIS" | jq -r '.gitDiff // "N/A"')
  if [ "$GIT_DIFF" != "N/A" ] && [ "$GIT_DIFF" != "null" ] && [ -n "$GIT_DIFF" ]; then
    echo "🔧 Git Diff:"
    echo "============"
    echo "$GIT_DIFF"
    echo ""
  fi
  
  echo "📝 Full Output:"
  echo "$ANALYSIS" | jq '.'
else
  echo "⚠️  No output available"
  echo ""
  echo "Full response:"
  echo "$FINAL_OUTPUT" | jq '.'
fi

echo ""
echo "========================================"
echo "Test completed! ✅"
echo "========================================"
echo ""
echo "📖 Next Steps:"
echo "  1. Check local repository for changes:"
echo "     cd /Users/chaitanya.nair/Documents/juspay/euler-api-txns"
echo "     git diff"
echo ""
echo "  2. View detailed logs:"
echo "     grep '$TICKET_ID' logs/*.log"
echo ""
echo "  3. View in dashboard:"
echo "     open http://localhost:5173/tickets/$TICKET_ID"
echo ""
