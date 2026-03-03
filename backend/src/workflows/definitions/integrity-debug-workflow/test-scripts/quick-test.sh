#!/bin/bash
# Quick test script for Integrity Debug Workflow

echo "🚀 Quick Test - Integrity Debug Workflow"
echo "========================================"
echo ""

# Check if USE_MOCK_ANALYSIS is set
if ! grep -q "USE_MOCK_ANALYSIS=true" .env 2>/dev/null; then
    echo "⚠️  Warning: USE_MOCK_ANALYSIS not found in .env"
    echo "   Adding it now..."
    echo "USE_MOCK_ANALYSIS=true" >> .env
    echo "   ✅ Added USE_MOCK_ANALYSIS=true to .env"
    echo ""
fi

BACKEND_URL="${BACKEND_URL:-http://localhost:3001}"

echo "📝 Creating workflow..."
echo ""

RESPONSE=$(curl -s -X POST "$BACKEND_URL/api/workflows" \
  -H "Content-Type: application/json" \
  -d '{
    "ticketId": "QUICK-TEST-'$(date +%s)'",
    "workflowType": "INTEGRITY_DEBUG_WORKFLOW",
    "title": "Quick Test",
    "description": "Quick test with mock data",
    "input": {
      "csvData": "order_id,merchant_id,failure_reason,gateway,flow\nORDER123XYZ,test_merchant,integrity_check_failure,PAYU,SYNC"
    }
  }')

WORKFLOW_ID=$(echo "$RESPONSE" | jq -r '.workflowId' 2>/dev/null)

if [ "$WORKFLOW_ID" != "null" ] && [ -n "$WORKFLOW_ID" ]; then
    echo "✅ Workflow created!"
    echo "   Workflow ID: $WORKFLOW_ID"
    echo ""
    echo "⏳ Waiting for completion (this takes ~10 seconds with mock data)..."

    sleep 10

    echo ""
    echo "📊 Results:"
    curl -s "$BACKEND_URL/api/workflows/$WORKFLOW_ID" | jq '{
      status,
      issueType: .context.issueType,
      repository: .context.repository,
      sessionsAnalyzed: .context.sessionsAnalyzed
    }'

    echo ""
    echo "✅ Test complete!"
    echo ""
    echo "To view full details:"
    echo "  curl $BACKEND_URL/api/workflows/$WORKFLOW_ID | jq '.'"
else
    echo "❌ Failed to create workflow"
    echo ""
    echo "Response:"
    echo "$RESPONSE" | jq '.' 2>/dev/null || echo "$RESPONSE"
    echo ""
    echo "Make sure backend is running:"
    echo "  cd backend && npm run dev"
fi
