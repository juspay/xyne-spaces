/**
 * NEW 4-STEP WORKFLOW PROMPTS
 * Based on dry-run feedback - more comprehensive and iterative approach
 */

// ============================================================================
// STEP 1: REPOSITORY IDENTIFICATION
// ============================================================================
// Note: System prompts are now stored in agent configs (backend/src/workflows/config.ts)

export function buildStep1RepositoryIdentificationPrompt(gateway: string): string {
  return `Identify which repository contains the integration code for ${gateway} gateway.

Return JSON: {"repository": "euler-api-txns"} or {"repository": "euler-api-gateway"}`;
}

// ============================================================================
// STEP 2: AMOUNT FORMAT DISCOVERY (Money Framework)
// ============================================================================
// Note: System prompts are now stored in agent configs (backend/src/workflows/config.ts)

export function buildStep2AmountFormatPrompt(gateway: string, collectedLogsJson: string): string {
  return `${collectedLogsJson}

**Your Task:**

Analyze the Money framework to determine the amount logic and calculate what amount should be used for integrity verification in ${gateway} gateway.

**Given Data:**
- txn_detail.txnAmount: Amount stored in our database
- txn_detail.surchargeAmount: Surcharge amount (if any)
- txn_detail.taxAmount: Tax amount (if any)
- order_reference.amount: Amount in order
- gateway_response.amount: Amount returned by gateway
- outgoing_gateway_request.amount: Amount we sent to gateway

**CRITICAL - Amount Calculation Logic:**

Even though the DB has different amount fields (txnAmount, surchargeAmount, taxAmount), the actual amount used for integrity verification is CALCULATED using Money framework logic.

**Steps:**

1. **Find Money framework files** for ${gateway}:
   - Search for Money/${gateway}/ directory
   - Look for amount conversion functions
   - Check surcharge/tax handling logic
   - Identify if it uses base_amount or total_amount

2. **Determine the amount format**:
   - Compare the amounts in logs (DB vs gateway response)
   - If gateway returns 39900 for ₹399 → smallest_denomination (multiplier=100, paise)
   - If gateway returns 399 for ₹399 → higher_denomination (multiplier=1, rupees)

3. **Calculate the expected amount using Money framework logic**:
   
   **For base_amount:**
   - Use ONLY txnAmount (exclude surcharge and tax)
   - Apply offer deduction if present
   - Formula: base_amount = txnAmount - offer_deduction
   - Then convert to denomination: base_amount * multiplier
   
   **For total_amount:**
   - Include txnAmount + surchargeAmount + taxAmount
   - Apply offer deduction
   - Formula: total_amount = (txnAmount + surchargeAmount + taxAmount) - offer_deduction
   - Then convert to denomination: total_amount * multiplier

4. **Return the calculated amount**:
   - This calculated amount is what should be compared with gateway response
   - Even if DB has txnAmount=399, the actual amount for verification might be different based on Money framework logic
   - Provide clear formula showing how the amount is calculated

**Example:**
- DB: txnAmount=399, surchargeAmount=10, taxAmount=5
- Gateway uses: base_amount in smallest_denomination
- Calculation: 399 * 100 = 39900 (surcharge and tax excluded)
- This 39900 is what should be compared with gateway response, NOT the DB txnAmount directly

**IMPORTANT:** The calculated amount is what matters for integrity verification, not the raw DB values. Provide the complete calculation formula.

Return JSON with:
- Amount format (smallest/higher denomination)
- Amount type (base/total)
- Calculated amount with step-by-step formula
- This calculation will be used for dry-run analysis in next step`;
}

// ============================================================================
// STEP 3: LOG REQUIREMENTS DISCOVERY
// ============================================================================
// Note: System prompts are now stored in agent configs (backend/src/workflows/config.ts)

export function buildStep3LogRequirementsPrompt(gateway: string, orderIds: string[], merchantId: string, flow: string): string {
  return `In ${gateway} gateway, integrity checks are failing for multiple orders.

**Context:**
- Gateway: ${gateway}
- Flow: ${flow}
- Order IDs: ${orderIds.join(', ')}
- Merchant ID: ${merchantId}
- Number of failed orders: ${orderIds.length}

**IMPORTANT**: Integrity failures can be due to:
- Amount mismatch
- Currency mismatch  
- Transaction ID mismatch
- Hash/signature verification failure
- Missing or incorrect fields
- Status validation failures

**Your Task:**

First, check the ${gateway} code comprehensively:

1. **Find ALL integrity check locations:**
   - Search for ALL functions containing: "integrity", "verify", "validate", "check"
   - Search for ALL functions that process webhook responses
   - Search for ALL functions that process sync/status responses
   - Search for ALL functions that process redirection/callback responses
   - Search for ALL functions that create IntegrityOutput objects
   - Search for hash/signature verification functions
   - List EVERY function found - don't assume specific names

2. **For EACH function found, extract:**
   - ALL conditions where integrity check is skipped
   - ALL fields being verified (amount, currency, txnId, hash, signature, status, etc.)
   - ALL transaction type detection logic (mandate, penny, registration, recurring)
   - ALL payment method checks (UPI, CARD, NB, WALLET)
   - ALL amount field selection logic
   - ALL currency validation logic
   - ALL txnId validation logic
   - ALL hash/signature verification logic

3. **Determine what data you need for dry-run:**
   - To check if skipping happens: What DB fields do you need?
   - To check amount comparison: What DB fields and gateway fields do you need?
   - To check currency comparison: What fields do you need?
   - To check txnId comparison: What fields do you need?
   - To check hash/signature: What fields and algorithms do you need?
   - To detect transaction type: What fields do you need?
   - To trace the flow: What fields do you need?

**IMPORTANT:**
- Check ALL flows (WEBHOOK, SYNC, REDIRECT, CALLBACK)
- Check ALL transaction types
- Check ALL payment methods
- Check ALL integrity verification types (amount, currency, txnId, hash, signature)
- Be exhaustive - integrity can be in multiple places and verify multiple fields

Return the structured JSON as specified in the system prompt.`;
}

// ============================================================================
// STEP 4: LOG COLLECTION
// ============================================================================
// Note: System prompts are now stored in agent configs (backend/src/workflows/config.ts)

export function buildStep4LogCollectionPrompt(
  gateway: string,
  orderIds: string[],
  merchantId: string,
  requiredFields: any,
  flow: string
): string {
  // Handle empty or null requiredFields
  if (!requiredFields || Object.keys(requiredFields).length === 0) {
    throw new Error('Required fields are empty or not provided');
  }

  const fieldsList = Object.entries(requiredFields)
    .filter(([_table, fields]) => fields && (Array.isArray(fields) || typeof fields === 'object'))
    .map(([table, fields]) => {
      // Handle both array and object fields
      if (Array.isArray(fields)) {
        return `From ${table}:\n${fields.map(f => `  - ${f}`).join('\n')}`;
      } else if (typeof fields === 'object' && fields !== null) {
        // Handle nested objects (like verification_metadata)
        const fieldNames = Object.keys(fields as Record<string, any>);
        if (fieldNames.length === 0) return `From ${table}:\n  (No specific fields)`;
        return `From ${table}:\n${fieldNames.map(f => `  - ${f}`).join('\n')}`;
      }
      return `From ${table}:\n  - ${String(fields)}`;
    })
    .join('\n\n');

  const webhookSyncInstruction = flow === 'WEBHOOK' ? `

**CRITICAL - Webhook with Mandatory Sync:**
Since the flow is WEBHOOK, check if ${gateway} gateway performs a mandatory sync after receiving webhook.
If yes:
1. Collect webhook logs (initial notification from gateway) - find the session_id from webhook logs
2. ALSO collect sync logs from the SAME session_id (our verification call to gateway after webhook)
3. Include both webhook_response and sync_response in the output
4. Some gateways use sync response for integrity verification, not webhook data

**IMPORTANT**: The sync log will be in the same session as the webhook. Use the session_id from webhook to find the corresponding sync log.

To check for mandatory sync:
- Search ${gateway} gateway code for sync calls after webhook processing
- Look for patterns like "mandatorySync", "verifyWebhook", "statusCheck after webhook"
- If found, collect both webhook and sync logs from the same session_id` : '';

  return `Collect logs for these transactions:

**Transaction Details:**
- Order IDs: ${orderIds.join(', ')}
- Number of orders: ${orderIds.length}
- Merchant ID: ${merchantId}
- Gateway: ${gateway}
- Flow: ${flow}

**Required Data:**

${fieldsList}
${webhookSyncInstruction}

**Instructions:**

1. Use the Order IDs and Merchant ID to search logs exhaustively
2. Collect EXACTLY the fields listed above for EACH order ID that has logs
3. If a field is missing for any order, mark it as "NOT_FOUND"
4. If logs are not found for an order ID, SKIP that order entirely (don't include it in the output)
5. Return the data in structured JSON format (array of logs, one per order that has logs)
6. Include outgoing gateway request logs (what we sent to gateway)
7. Include gateway response logs (what gateway returned)
8. For WEBHOOK flow: Check for and include sync logs if mandatory sync exists

**IMPORTANT:**
- Just collect the data for orders that have logs, do not analyze
- ONLY include order IDs where logs were found
- If no logs are found for any order, return empty array: []
- Do an exhaustive search - check all log sources
- For WEBHOOK flow with mandatory sync: include both webhook and sync logs from the SAME session_id

Return structured JSON with the collected data: an array of log objects for orders where logs were found.`;
}

// ============================================================================
// STEP 5: COMPREHENSIVE CODE ANALYSIS
// ============================================================================
// Note: System prompts are now stored in agent configs (backend/src/workflows/config.ts)

export function buildStep5CodeAnalysisPrompt(
  gateway: string,
  orderIds: string[],
  _merchantId: string,
  collectedLogs: string,
  amountFormat: any
): string {
  // Parse collected logs to see how many orders have logs
  let logsCount = orderIds.length;
  try {
    const logsObj = JSON.parse(collectedLogs);
    if (Array.isArray(logsObj)) {
      logsCount = logsObj.length;
    } else if (logsObj.sessions && Array.isArray(logsObj.sessions)) {
      logsCount = logsObj.sessions.length;
    }
  } catch (e) {
    // Ignore parse errors
  }

  const amountFormatInfo = amountFormat ? `

**Amount Format Information (from Money Framework):**
- Gateway: ${amountFormat.gateway}
- Format: ${amountFormat.amount_format}
- Multiplier: ${amountFormat.multiplier}
- Smallest Unit: ${amountFormat.smallest_unit}
- Example: ${amountFormat.examples?.explanation || 'N/A'}
${amountFormat.special_cases?.length > 0 ? `- Special Cases: ${amountFormat.special_cases.map((sc: any) => `${sc.condition} → ${sc.amount_format}`).join(', ')}` : ''}
` : '';

  return `${collectedLogs}

Gateway: ${gateway}
Order IDs requested: ${orderIds.join(', ')} (${orderIds.length} total)
Order IDs with logs found: ${logsCount}
${amountFormatInfo}
**Analysis Task:**

**STEP 0: Check if integrity verification is applicable**
FIRST, before analyzing any verification failures, check if integrity should even be performed:

**0a. Check transaction status:**
- Look at transaction status in logs (txn_detail.status, gateway_response.status)
- If transaction status is FAILED/REJECTED/DECLINED/ERROR → Set can_perform_integrity=false, cannot_perform_reason="transaction_failed"
- Integrity checks should only run for successful transactions
- If found → Provide code changes to return CANNOT_PERFORM_INTEGRITY for failed transactions
- Suggest specific condition to add (e.g., "if txn_status is not SUCCESS, return CANNOT_PERFORM_INTEGRITY")
- Make it clear: failed transactions should NOT be marked as integrity_failed

**0b. Check for mandatory sync decode/timeout errors:**
- If the flow involves mandatory sync after webhook, check sync logs for decode errors or timeout errors
- If found → Set can_perform_integrity=false, cannot_perform_reason="decode_error" or "timeout_error"
- If found → Provide code changes to return CANNOT_PERFORM_INTEGRITY for sync decode/timeout
- Suggest adding condition to detect sync decode/timeout and return CANNOT_PERFORM_INTEGRITY
- Make it clear: sync decode/timeout should NOT be marked as integrity_failed
- This is NOT an integrity bug - code should handle it by returning CANNOT_PERFORM_INTEGRITY

**STEP 1: Identify the failed verification type from actual failure reason**
Look at the integrity check failure logs and error messages to determine WHICH field verification actually failed:
- Check the failure reason/error message in logs
- Is it complaining about amount? → Amount verification failed
- Is it complaining about currency? → Currency verification failed
- Is it complaining about signature/hash? → Hash verification failed
- Is it complaining about txnId? → Transaction ID verification failed
- Don't assume - use the actual failure reason from logs

**STEP 2: Examine complete gateway response and determine if it's gateway issue or our issue**

**2a. Check the COMPLETE gateway response:**
- Look at ALL fields in gateway_response, not just what we currently verify
- Identify if there are OTHER fields we could use for integrity (orderId, merchantTxnId, email, etc.)
- Check if gateway provides additional checksums or validation fields we're not using
- Document all potential verification opportunities, even if not currently failing

**2b. Determine if it's gateway issue or our issue:**
Compare what we sent vs what gateway returned FOR THE SPECIFIC FIELD THAT FAILED:

**For AMOUNT failures specifically:**
- **CRITICAL**: Compare outgoing_gateway_request.amount (what WE sent) vs gateway_response.amount (what THEY returned)
- **If they DON'T match**: Gateway returned different amount than we sent → Gateway issue → Escalate to PG
  - Example: We sent 39900, gateway returned 39800 → PG issue
  - Set is_our_issue=false
- **If they MATCH**: Gateway correctly echoed back what we sent → Our verification logic is wrong → Fix our code
  - Example: We sent 39900, gateway returned 39900, but our integrity check compares against 399 → Our bug
  - Set is_our_issue=true
  - Root cause: We're not using same amount logic in verification as we used in initiation
  - Fix: Update verification to use correct Money framework logic, multiplier, base vs total amount

**For OTHER field failures (currency, txnId, hash):**
- Compare outgoing_request vs gateway_response for that specific field
- If they don't match → Gateway issue → Escalate
- If they match but verification fails → Our code issue → Debug our verification logic

Our DB values are NEVER wrong - they are contextually correct.

**STEP 3: Scan gateway integrity code**
Check all places where integrity is done in the gateway flow:
- Find ALL functions that create IntegrityOutput objects
- Find ALL verification functions (amount, currency, txnId, hash, signature)
- Find ALL skip conditions
- List which fields are verified in each location

**STEP 4: Field-specific analysis based on actual failure reason**

**ONLY IF amount verification failed** (check Step 1):
Use the calculated amount from Step 2 (Amount Format Discovery):
- Gateway returns amount in: ${amountFormat?.amount_format || 'unknown'} format (multiplier: ${amountFormat?.multiplier || 'unknown'})
- Amount type: ${amountFormat?.amount_type || 'unknown'} (base_amount or total_amount)
- Calculated amount for verification: ${amountFormat?.calculated_amount || 'unknown'}
- Calculation formula: ${amountFormat?.calculation_breakdown?.formula || 'unknown'}

For amount dry-run analysis:
- Use the calculated amount for comparison, NOT the raw DB txnAmount
- Check if our code applies the same Money framework logic
- Verify if our code uses base_amount or total_amount correctly
- Check if the denomination conversion (multiplier) is applied correctly

**ONLY IF currency verification failed** (check Step 1):
- Compare currency in outgoing request vs gateway response
- Check if our code is comparing the right currency field
- Verify currency code format (INR vs in vs 356)

**ONLY IF signature/hash verification failed** (check Step 1):
- Check the hash algorithm used
- Verify the input string format for hash calculation
- Compare calculated hash with gateway's hash
- Check if all required fields are included in hash calculation

**ONLY IF txnId verification failed** (check Step 1):
- Compare txnId in outgoing request vs gateway response
- Check if our code is comparing the right txnId field
- Verify txnId field mapping

**Don't analyze fields that didn't fail** - focus only on what actually failed based on the failure reason.

**STEP 5: Dry-run analysis for the specific failed field**
Trace the exact code path for these transactions, focusing on the field that actually failed:
- Which integrity location(s) are reached?
- For the specific failed field (from Step 1): Which verification function is used?
- Is there a skip condition that should apply but doesn't?
- For the failed verification: What value do we have vs what gateway returned?
- Is the transaction type correctly detected?
- Is the correct DB field being used for comparison?

**IMPORTANT**: Only do dry-run for the field that actually failed. Don't waste time tracing verifications that passed.

**STEP 6: Identify the fix specific to the scenario**

**If can_perform_integrity=false:**
- If reason is "transaction_failed":
  - **Provide code changes** to return CANNOT_PERFORM_INTEGRITY in Gateway/{GatewayName}/ files
  - Suggest checking transaction status before integrity verification
  - Example: "if txn_status != SUCCESS, return CANNOT_PERFORM_INTEGRITY" or "if gateway_status is FAILED/REJECTED, return CANNOT_PERFORM_INTEGRITY"
  - Specify exact function and file where this check should be added
  - Provide the condition logic to implement
  - **CRITICAL**: Use CANNOT_PERFORM_INTEGRITY status, not integrity_failed

- If reason is "decode_error" or "timeout_error":
  - **Provide code changes** to return CANNOT_PERFORM_INTEGRITY when sync fails
  - Suggest adding condition to detect when sync call failed with decode/timeout
  - Example: "if sync response has decode error, return CANNOT_PERFORM_INTEGRITY" or "if sync timed out, return CANNOT_PERFORM_INTEGRITY"
  - Specify exact function and file where this check should be added
  - Code should return CANNOT_PERFORM_INTEGRITY (not integrity_failed) for sync issues
  - Provide the condition logic to implement
  - **CRITICAL**: Use CANNOT_PERFORM_INTEGRITY status, not integrity_failed

- Provide clear explanation of why integrity cannot be performed and how code should return CANNOT_PERFORM_INTEGRITY

**If can_perform_integrity=true (actual integrity bug):**
After dry-run, determine:
- Which file(s) need changes (Gateway/{GatewayName}/ files ONLY)
- For amount failures: What amount calculation logic needs to be added/modified
- For currency failures: What currency validation logic needs to be added/modified
- For signature/hash failures: What hash calculation logic needs to be added/modified
- For txnId failures: What txnId comparison logic needs to be added/modified
- What skip conditions are missing for this specific verification type

Analyze patterns across failed orders to identify common root cause.

**IMPORTANT:**
- The failure reason tells you what to fix - don't fix other things
- If it's a currency issue, don't suggest amount fixes
- If it's a signature issue, don't suggest amount fixes
- Match your fix to the actual failure reason
- If logs were found for only some orders, focus analysis on those orders
- For transaction failures: **provide code changes** to return CANNOT_PERFORM_INTEGRITY (not integrity_failed) for failed transactions
- For decode/timeout errors: **provide code changes** to return CANNOT_PERFORM_INTEGRITY (not integrity_failed) for sync failures
- **CRITICAL**: Both scenarios should use CANNOT_PERFORM_INTEGRITY status in the code fix`;
}
