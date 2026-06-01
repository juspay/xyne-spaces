/**
 * NEW 4-STEP WORKFLOW PROMPTS
 * Based on dry-run feedback - more comprehensive and iterative approach
 */

/**
 * Append free-text "additional user info" (provided at runtime via the workflow
 * input) to a hardcoded user prompt. If the value is empty/undefined/whitespace-only,
 * the original prompt is returned unchanged - preserving today's behaviour.
 */
function appendAdditionalUserInfo(prompt: string, additionalUserInfo?: string): string {
  if (!additionalUserInfo || !additionalUserInfo.trim()) return prompt;
  return `${prompt}\n\n## Additional User Info:\n${additionalUserInfo.trim()}`;
}


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

**CRITICAL - Amount Storage & Conversion:**

**How amounts are stored in DB:**
- **ALL amounts in DB are ALWAYS stored in MAJOR denomination** (e.g., ₹399 stored as 399, NOT 39900)
- DB fields: txnAmount, surchargeAmount, taxAmount, offerDeductionAmount - all in major denomination
- This is consistent across all gateways and currencies

**Money Framework Conversion:**
- Money framework ONLY converts these DB amounts according to gateway requirements
- Conversion is based on:
  1. **Gateway's expected format** (smallest vs major denomination)
  2. **Currency** (e.g., INR uses paise/rupee, USD uses cents/dollar)
- The framework does NOT change which DB field to use, only how to convert it

**Where to find Money Framework configuration:**
- **For api-gateway**: Check euler-db repository > money_framework_instance > look for ${gateway}
- **For api-txns**: Money framework config is present in the txns repository itself > check gateway-specific instance
- This tells you: multiplier, denomination format, currency handling

**Steps:**

1. **Find Money framework configuration** for ${gateway}:
   - Check the code to see which gateway use what conversion

2. **Determine the amount format**:
   - Compare the amounts in logs (DB vs gateway response)
   - If gateway returns 39900 for ₹399 → smallest_denomination (multiplier=100, paise)
   - If gateway returns 399 for ₹399 → higher_denomination (multiplier=1, rupees)

3. **Calculate the expected amount using Money framework logic**:

   **Remember**: All DB amounts are in MAJOR denomination. Money framework converts them.

   **For amount:**
   - Check the instance and functions in money framework on how its calculated, substitute the value in function to get the amount, it can be base amount or effective amount (check that in money framework instance of gateway)

4. **Return the calculated amount**:
   - This calculated amount (after Money framework conversion) is what should be compared with gateway response
   - DB stores in major denomination (e.g., 399 for ₹399)
   - Gateway expects amount per Money framework config (e.g., 39900 for paise if smallest_denomination)
   - The verification MUST use the converted amount, not the DB value directly
   - Provide clear formula showing: DB value (major) → Money framework conversion → Expected amount

**Example:**
- **DB (always major denomination)**: txnAmount=399, surchargeAmount=10, taxAmount=5 (stored as ₹399, ₹10, ₹5)
- **Money framework for this gateway**: base_amount in smallest_denomination, multiplier=100 (paise)
- **Calculation**:
  1. Use base_amount or total amount from money framework instance: 399
  2. Convert to smallest denomination: 399 * 100 = 39900 paise
- **Result**: 39900 is what should be compared with gateway response
- **NOT**: Don't use DB txnAmount (399) directly for comparison

**IMPORTANT:**
- DB stores in major denomination (399 = ₹399)
- Money framework converts to gateway's expected format (39900 = 39900 paise)
- Always calculate using Money framework logic, not raw DB values
- Provide the complete calculation formula showing the conversion

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
  flow: string,
  additionalUserInfo?: string
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

**READ THIS FIRST — the log file contains many different log entry types**, NOT just webhooks. Fetching logs by order_id returns a mix of entries: REFUND_WORKFLOW_TRACKING_DATA, internal workflow events, txn lifecycle events, INCOMING_API webhooks, OUTGOING_API syncs, and others. **Each entry type has a DIFFERENT "message" structure** (e.g. tracking events have "message.description", workflow events have "message.code"/"message.flow_name", API logs have "message.req_body"/"message.res_body").

You MUST therefore **filter the entries by (api_tag pattern + category) FIRST**, then extract fields ONLY from the filtered entries. Do NOT attempt to extract "message.req_body" or any other field from arbitrary entries — non-API entries will not have those fields and you'll waste turns chasing them. After filtering, the structure is guaranteed (see field paths below). **If an entry doesn't match the filter, SKIP IT — don't try to inspect or normalize it.**

Write a SINGLE Python script that parses the jsonl logs in two filtering passes and outputs the correlated failure-webhook + mandatory-sync pairs as JSON. Do NOT write two separate scripts; run python ONCE.

PASS 1 — Find FAILURE webhooks (filter to incoming-API webhook entries only, then keep the failures):
  An entry qualifies ONLY IF ALL of these are true (filter first; ignore everything else):
    - "category" (top-level) equals "INCOMING_API"
    - "api_tag" matches pattern "*_PAY_WEBHOOKS" (e.g. GW_MERCHANTID_GW_REFID_BASED_PAY_WEBHOOKS). Read it from NESTED "message.api_tag" OR from top-level "entity" (both carry the same value on these entries).
    - "resp_code" is non 200 (i.e., 400, 500, or any non 2xx) — this picks out FAILURES (top-level; mirrored at "message.res_code")
    - "udf_order_id" (top-level) equals one of the given order IDs
    - "merchant_id" OR "merchant_idx_id" (top-level) equals the given merchant ID
  DEDUPLICATE matched entries by (x-request-id, api_tag, timestamp).
  For these filtered entries, the structure is GUARANTEED to have: top-level "x-request-id", "udf_order_id", "merchant_id", "resp_code"; and nested "message.api_tag", "message.req_body" (gateway's incoming payload), "message.res_body" (our error response), "message.error_info".
  Collect each matched entry's top-level "x-request-id" into a set — call it FAILED_REQUEST_IDS. This is the correlation key that links incoming webhook to outgoing sync. **There is NO "session_id" field in these logs**; "x-request-id" is the canonical correlation id (e.g. "4cb5a654-5e48-4e3b-aa85-1ace01341990"). Mirrored at "euler-request-id" and "udf_txn_uuid" if you need cross-checks.

PASS 2 — Find the mandatory SYNC outgoing call(s) with the SAME x-request-id (filter to outgoing-API sync entries only, correlated by x-request-id):
  An entry qualifies ONLY IF ALL of these are true (again — filter first, do not inspect non-matching entries):
    - "category" (top-level) equals "OUTGOING_API"
    - "api_tag" matches pattern "*_SYNC" (e.g. GW_MANDATE_SYNC). Read it from nested "message.api_tag" OR top-level "entity".
    - "x-request-id" (top-level) is in FAILED_REQUEST_IDS
    - (Optional belt-and-braces) "x-parent-api-tag" (top-level on sync entries) equals the corresponding failure webhook's api_tag — outgoing sync logs carry this pointer back to the webhook that triggered them.
  DEDUPLICATE by (x-request-id, api_tag, timestamp).
  For these filtered entries, the structure is GUARANTEED to have: top-level "x-request-id", "resp_code", "x-parent-api-tag"; and nested "message.api_tag", "message.url" (gateway endpoint), "message.req_body" (what WE sent to gateway), "message.res_body" (gateway's response or timeout details).

OUTPUT — print a JSON ARRAY to stdout. One element per failure webhook found, with the matched sync entry attached (or null if no sync exists for that x-request-id). Schema:
[
  {
    "x_request_id": "<top-level x-request-id value>",
    "failure_webhook": { ...full failure-webhook log entry... },
    "mandatory_sync": { ...full matching sync log entry... } | null
  },
  ...
]

Then, for each pair in the output, classify the outcome by inspecting the mandatory_sync entry's status code (top-level "resp_code"; mirrored at "message.res_code"):
- mandatory_sync.resp_code is 5XX → gateway-side failure (e.g. ResponseTimeout, gateway unreachable). Classify as GATEWAY issue.
- mandatory_sync.resp_code is 4XX or 2XX → extract and analyze the request/response payloads at "mandatory_sync.message.req_body" and "mandatory_sync.message.res_body" for further analysis.
- mandatory_sync is null → no sync call was triggered (or none exists) for that failure webhook. Fall back to analysing the FAILURE WEBHOOK itself to determine why it failed:
    * Inspect "failure_webhook.message.req_body" - this is the payload the gateway sent us; check for missing/invalid fields, wrong types, unexpected values, or malformed structure.
    * Inspect "failure_webhook.message.res_body" - this is OUR error response and typically contains the most useful diagnostic info: "error_code" (e.g. "invalid_request", "INVALID_INPUT"), "status", and "error_info.developer_message" / "error_info.user_message" / "error_info.code" explaining what we rejected and why.
    * Also check top-level "failure_webhook.error_code" and "failure_webhook.error_info" for additional context (e.g. "WEBHOOK_VERIFICATION_FAILED").
    * Use the combination of (req_body, res_body, error_info) to pinpoint the validation/parsing/signature/business-rule failure on our side.

Include the FULL JSON array (with both webhook and sync entries for each pair) in your final response. Some gateways rely on the sync response for integrity verification rather than the webhook data, so both are needed downstream.`: '';

  const base = `Collect Euler logs for these transactions:

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

**CRITICAL - Handling Encrypted Gateway Logs:**
Some gateways encrypt their request/response payloads. **ONLY** if you encounter encrypted data:
- Check if the gateway response/request contains fields like "ENCRYPTED_PAYLOAD", "encrypted", "payload" with encrypted values
- **If and only if encrypted**, then look for logs tagged with **DECRYPTED_RESPONSE** or **DECRYPTED_REQUEST**
- These logs contain the decrypted version of the gateway payload
- Search for log entries with these keywords in the same session
- Example log patterns to search:
  - "DECRYPTED_RESPONSE" - Decrypted gateway response after webhook/sync
  - "DECRYPTED_REQUEST" - Decrypted outgoing request to gateway
  - Check logs immediately after encrypted payload logs (same session_id/timestamp)
- **Use the decrypted data for integrity verification, NOT the encrypted payload**
- **If logs are NOT encrypted** (you can see plain JSON data), use them directly - no need to search for DECRYPTED logs

**IMPORTANT:**
- Just collect the data for orders that have logs, do not analyze
- ONLY include order IDs where logs were found
- If no logs are found for any order, return empty array: []
- Do an exhaustive search - check all log sources
- For WEBHOOK flow with mandatory sync: include both webhook and sync logs from the SAME session_id
- **If logs are encrypted, use DECRYPTED_RESPONSE/DECRYPTED_REQUEST logs instead**

Return structured JSON with the collected data: an array of log objects for orders where logs were found.`;
  return appendAdditionalUserInfo(base, additionalUserInfo);
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

**NOTE - Gateway Logs:**
The logs you need for analysis are ALREADY EMBEDDED in this prompt as the JSON block at the very top (above this section, before the "Gateway:" header). They were collected by the previous step (Log Collection / Step 4) and pre-correlated for you.

**DO NOT use uploaded_files_list, uploaded_files_read, euler_logs_with_order_id, log-viewer tools, or any other log-fetching tool to search for additional logs.** Those tools will return 0 results for this order id because the logs have already been fetched and live in this prompt. Calling them is a waste of turns and will lead you to incorrectly conclude "no logs found."

If the logs JSON at the top of this prompt is empty (e.g. \`[]\` or \`{"sessions": []}\`), that means upstream collection failed — return "needs_human_review" with "no logs available from Step 4" as the reason, rather than trying to refetch.

The collected logs contain either plain JSON or decrypted gateway payloads. If the gateway uses encryption, the logs will already contain decrypted data (from DECRYPTED_RESPONSE/DECRYPTED_REQUEST entries). Use the provided log data for analysis - it's ready to use.

---

**RULES YOU MUST FOLLOW BEFORE ANY ANALYSIS — these are HARD constraints, not suggestions:**

**Rule 1 — Consistency with Step 3 (Log Requirements Discovery):**
The Step 3 output (passed as context above and/or available via prior workflow state) enumerates the integrity-check functions, skip conditions, and verified fields it found for ${gateway}. Your conclusions MUST be consistent with those findings. Specifically:
- Do NOT claim that ${gateway} is "not supported in the integrity framework" if Step 3 identified ${gateway}-specific integrity functions. If you believe Step 3 was wrong, you must say so explicitly, cite the file:line you actually read that contradicts it, and quote the relevant code excerpt.
- Treat Step 3's "skip_conditions" list as ground truth for which conditions are supposed to bypass integrity. If your analysis depends on a condition NOT in that list, explain why Step 3 missed it.

**Rule 2 — Evidence requirement for every code-level claim:**
Every statement of the form "X function exists/is missing", "Y case is not handled", "Z field is read from W", "the case statement is at line N" MUST be backed by evidence from THIS session:
- The exact tool call you used (grep pattern, glob pattern, read of file:line range)
- A quoted excerpt of the relevant lines (not paraphrased)
- The file path

A claim without this triple (tool + excerpt + path) will be treated as a hallucination and is grounds for the entire analysis being rejected. If you cannot find evidence for a claim, say "I could not verify X — needs human review" rather than asserting it.

**Rule 3 — Anchor your investigation to the actual error message in the logs:**
Start from the literal error string in the failure logs (e.g. "WEBHOOK_VERIFICATION_FAILED", "webhook validation failed", "INVALID_INPUT", or whatever appears in failure_webhook.message.res_body / failure_webhook.error_info / failure_webhook.error_code). Then:
- Grep the codebase for that exact error string to find the function that emitted it.
- Walk forward from that function to identify what condition triggered it.
- Your final root cause MUST terminate at code that could plausibly emit the observed error. If your proposed root cause is at a function that doesn't produce that error string, you are looking at the wrong place.

**Rule 4 — No code_changes_required without having read the target file:**
Before listing any entry in "code_changes_required", you MUST have read the target file in THIS session and your output must quote the actual current content of the lines you propose to change. Do NOT propose line-number-specific edits ("at line ~115", "at line ~5220") to files you have not opened in this session. If you have not read the file, either read it now or move the suggestion to "additional_verifications_needed" instead.

**If you cannot satisfy any of these rules for a finding, return that finding as "needs_human_review" with the reason, rather than fabricating a confident answer.**

---

**Analysis Task:**

**STEP 0: Check if integrity verification is applicable**
FIRST, before analyzing any verification failures, check if integrity should even be performed:

**0a. Check Payment Gateway (PG) response status (NOT txnStatus):**
- **CRITICAL**: Look at the actual PG response status in gateway_response, NOT the transaction's final status (txn_detail.status)
- **Why**: In webhook/async flows, txnStatus can be SUCCESS even if PG initially returned failure (webhook updates it later)
- **For WEBHOOK flow**: Check the webhook payload status from PG (gateway_response.status, gateway_response.txn_status, etc.)
- **For SYNC flow**: Check the sync response status from PG
- If PG response status is FAILED/REJECTED/DECLINED/ERROR (Check pg specific mapping in code for failure) → then skip integrity
- **Integrity check should be skipped when PG itself returns failure** - there's nothing to verify
- If found → Provide code changes to skip the integrity check ONLY when PG response indicates failure
- **IMPORTANT**: All other flows should continue normally - txn status mapping, response handling, etc.
- The code should ONLY skip the integrity verification step, everything else remains unchanged
- Suggest specific condition to add (e.g., "if gateway_response.status is FAILED/REJECTED/DECLINED, skip integrity check and continue with normal flow")
- **DO NOT check txnStatus** - only check the actual PG response status
- Make it clear: PG failures should NOT be marked as integrity_failed, just skip integrity verification

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
  - Example: We sent 39900, gateway returned 39900, but our integrity check compares against DB value 399 → Our bug
  - Set is_our_issue=true
  - Root cause: We're not using same Money framework conversion in verification as we used in initiation
  - **Remember**: DB stores amounts in MAJOR denomination (399 = ₹399), but verification must use Money framework converted amount (39900 = paise)
  - Fix: Update verification to apply correct Money framework conversion (multiplier, base vs total amount)

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
- **CRITICAL**: DB stores amounts in MAJOR denomination (e.g., 399 for ₹399)
- Use the Money framework CONVERTED amount for comparison, NOT the raw DB txnAmount
- Example: DB has 399, but verification should use 39900 (after Money framework conversion with multiplier=100)
- Check if our code applies the same Money framework logic in both:
  1. Initiation (when sending to gateway)
  2. Verification (when checking integrity)
- Verify if our code uses base_amount or total_amount correctly
- Check if the denomination conversion (multiplier) is applied correctly in verification code

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
- If reason is "pg_failure":
  - **Provide code changes** to skip integrity check in Gateway/{GatewayName}/ files when PG response indicates failure
  - **CRITICAL**: Check PG response status, NOT txnStatus (txnStatus can be SUCCESS even if PG initially failed)
  - Suggest checking PG response status before integrity verification
  - Example: "if gateway_response.status is FAILED/REJECTED/DECLINED, skip integrity check" or "if webhook_payload.status is FAILED, skip integrity check"
  - **IMPORTANT**: Only skip the integrity verification step - all other processing (txn status mapping, response handling, etc.) should continue normally as it currently does
  - **DO NOT use txn_status** - only check the actual PG response status fields
  - Specify exact function and file where this check should be added
  - Provide the condition logic to implement
  - The code should skip integrity verification but proceed with normal flow otherwise

- If reason is "decode_error" or "timeout_error":
  - **Provide code changes** to return CANNOT_PERFORM_INTEGRITY when sync fails
  - Suggest adding condition to detect when sync call failed with decode/timeout
  - Example: "if sync response has decode error, return CANNOT_PERFORM_INTEGRITY" or "if sync timed out, return CANNOT_PERFORM_INTEGRITY"
  - Specify exact function and file where this check should be added
  - Code should return CANNOT_PERFORM_INTEGRITY (not integrity_failed) for sync issues
  - Provide the condition logic to implement
  - **CRITICAL**: Use CANNOT_PERFORM_INTEGRITY status, not integrity_failed

- Provide clear explanation of why integrity cannot be performed and how code should handle it (skip for PG failures, CANNOT_PERFORM_INTEGRITY for decode/timeout)

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
- For PG failures: **provide code changes** to skip the integrity check ONLY (not integrity_failed) when PG response indicates failure (check gateway_response.status, NOT txnStatus). All other flows (txn status mapping, response handling) should continue normally.
- For decode/timeout errors: **provide code changes** to return CANNOT_PERFORM_INTEGRITY (not integrity_failed) for sync failures
- **CRITICAL**: PG failures should skip integrity verification only (normal flows continue), decode/timeout should return CANNOT_PERFORM_INTEGRITY
- **CRITICAL**: Never check txnStatus to determine if integrity should run - always check the actual PG response status`;
}