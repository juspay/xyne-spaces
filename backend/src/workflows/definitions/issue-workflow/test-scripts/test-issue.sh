#!/bin/bash
# Test script for Issue Workflow

echo "🚀 Issue Workflow Test"
echo "======================"
echo ""

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"

# Check if issue description is provided
if [ -z "$1" ]; then
    echo "Usage: ./test-issue.sh \"<issue description>\""
    echo ""
    echo "Example:"
    echo "  ./test-issue.sh \"PayU webhook integrity check is failing with amount mismatch\""
    echo ""
    exit 1
fi

ISSUE_DESCRIPTION="$1"
TICKET_ID="${TICKET_ID:-ISSUE-TEST-$(date +%s)}"

echo "📝 Creating workflow..."
echo "Ticket ID: $TICKET_ID"
echo "Description: $ISSUE_DESCRIPTION"
echo ""

RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/workflows" \
  -H "Content-Type: application/json" \
  -H "x-dev-mode: true" \
  -H "x-dev-user-id: default-user" \
  -H "x-dev-user-email: admin@xyne.local" \
  -H "x-dev-user-name: Admin User" \
  -H "x-workspace-id: default-workspace" \
  -d @- <<EOF
{
  "ticketId": "$TICKET_ID",
  "workflowType": "ISSUE_WORKFLOW",
  "title": "Issue Analysis",
  "description": "$ISSUE_DESCRIPTION",
  "input": {
    "description": "$ISSUE_DESCRIPTION"
  }
}
EOF
)

WORKFLOW_ID=$(echo "$RESPONSE" | jq -r '.workflow.id // .workflowId' 2>/dev/null)

if [ "$WORKFLOW_ID" != "null" ] && [ -n "$WORKFLOW_ID" ]; then
    echo "✅ Workflow created!"
    echo "   Workflow ID: $WORKFLOW_ID"
    echo ""
    echo "⏳ Waiting for completion..."
    echo "   (This may take 2-5 minutes depending on the issue complexity)"
    echo ""

    # Poll for completion
    MAX_WAIT=600  # 10 minutes
    WAIT_TIME=0
    INTERVAL=10

    while [ $WAIT_TIME -lt $MAX_WAIT ]; do
        sleep $INTERVAL
        WAIT_TIME=$((WAIT_TIME + INTERVAL))

        STATUS_RESPONSE=$(curl -s \
          -H "x-dev-mode: true" \
          -H "x-dev-user-id: default-user" \
          -H "x-dev-user-email: admin@xyne.local" \
          -H "x-dev-user-name: Admin User" \
          -H "x-workspace-id: default-workspace" \
          "$BACKEND_URL/api/workflows/$WORKFLOW_ID")
        STATUS=$(echo "$STATUS_RESPONSE" | jq -r '.status' 2>/dev/null)

        echo "   Status after ${WAIT_TIME}s: $STATUS"

        if [ "$STATUS" = "SUCCESS" ] || [ "$STATUS" = "FAILURE" ] || [ "$STATUS" = "CANCELLED" ]; then
            break
        fi
    done

    echo ""
    echo "📊 Results:"
    echo "=========="

    curl -s \
      -H "x-dev-mode: true" \
      -H "x-dev-user-id: default-user" \
      -H "x-dev-user-email: admin@xyne.local" \
      -H "x-dev-user-name: Admin User" \
      -H "x-workspace-id: default-workspace" \
      "$BACKEND_URL/api/workflows/$WORKFLOW_ID" | jq '{
      status,
      issueType: .context.issueType,
      severity: .context.severity,
      issueCategory: .context.issueCategory,
      gatewayName: .context.gatewayName,
      repositories: .context.repositories,
      requiresCodeChange: .context.requiresCodeChange,
      analysisApproach: .context.analysisApproach,
      prLink: .context.prLink,
      prLinks: .context.prLinks
    }'

    echo ""
    echo "✅ Test complete!"
    echo ""
    echo "📄 To view full workflow details:"
    echo "   curl $BACKEND_URL/api/workflows/$WORKFLOW_ID | jq '.'"
    echo ""
    echo "📋 To view workflow context:"
    echo "   curl $BACKEND_URL/api/workflows/$WORKFLOW_ID | jq '.context'"
else
    echo "❌ Failed to create workflow"
    echo ""
    echo "Response:"
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
    echo ""
    echo "Make sure backend is running:"
    echo "  cd backend && npm run dev"
fi
