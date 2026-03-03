/**
 * Mock Research Agent - NEW 5-STEP WORKFLOW
 * Returns responses based on actual dry-run results
 */

import { logger } from '../../../utils/logger.js';

// ============================================================================
// STEP 1: Repository Identification Mock Response
// ============================================================================

export function getMockStep1RepositoryIdentification(): { repository: string } {
  logger.info('[MOCK] Returning repository identification');

  return {
    repository: "euler-api-txns"
  };
}

// ============================================================================
// STEP 2: Amount Format Discovery Mock Response
// ============================================================================

export function getMockStep2AmountFormat(): any {
  logger.info('[MOCK] Returning amount logic analysis');

  return {
    gateway: "SETU",
    amount_format: "smallest_denomination",
    multiplier: 100,
    smallest_unit: "paise",
    amount_type: "base_amount",
    calculated_amount: 39900,
    calculation_breakdown: {
      txn_amount: 399,
      surcharge_amount: 0,
      tax_amount: 0,
      offer_deduction: 0,
      formula: "base_amount: txn_amount * 100 = 399 * 100 = 39900",
      explanation: "SETU gateway expects base amount in smallest denomination (paise). Surcharge and tax are excluded."
    },
    money_framework_files: [
      {
        file_path: "Money/Setu/Config.hs",
        relevant_functions: ["toSmallestDenomination", "getBaseAmount"]
      }
    ]
  };
}

// ============================================================================
// STEP 3: Log Requirements Discovery Mock Response
// (Keeping existing comprehensive response - it's already correct)
// ============================================================================

export function getMockStep3LogRequirements(): any {
  logger.info('[MOCK] Returning log requirements discovery');

  return {
    integrity_locations_found: [
      {
        function_name: "payuPayUResponseReq",
        file_path: "Gateway/Payu/Flow.hs",
        line_numbers: "5998-6006",
        flow_type: "WEBHOOK",
        skip_conditions: ["isPennyMandateTxn", "isEnachOrEmandateRegister"],
        transaction_type_checks: ["penny_mandate", "enach_emandate_register"],
        payment_method_checks: ["NB", "CARD"]
      },
      {
        function_name: "payuTxndetailSyncRespIntegrity",
        file_path: "Gateway/Payu/Flow.hs",
        line_numbers: "6010-6020",
        flow_type: "SYNC",
        skip_conditions: ["isPennyMandateTxn", "isEnachOrEmandateRegister"],
        transaction_type_checks: ["penny_mandate", "enach_emandate_register"],
        payment_method_checks: ["NB", "CARD"]
      },
      {
        function_name: "validateStatusResponse",
        file_path: "Gateway/Payu/Flow.hs",
        line_numbers: "4500-4600",
        flow_type: "LEGACY",
        skip_conditions: ["checkMandateOTMWithMaxAmount"],
        transaction_type_checks: ["mandate_onetime"],
        payment_method_checks: ["UPI", "NB", "CARD"]
      }
    ],
    required_fields: {
      txn_detail: [
        "txn_id",
        "txn_uuid",
        "txn_object_type",
        "source_object_id",
        "merchant_id",
        "txn_amount",
        "currency",
        "internal_metadata",
        "gateway",
        "status",
        "gateway_txn_id",
        "created_at",
        "updated_at",
        "payment_method_type",
        "card_isin",
        "txn_date"
      ],
      order_reference: [
        "id",
        "order_id",
        "amount",
        "currency",
        "status",
        "metadata",
        "merchant_id",
        "created_at"
      ],
      gateway_response: [
        "status",
        "transaction_amount",
        "additional_charges",
        "mihpayid",
        "card_no",
        "payment_method",
        "error_code",
        "error_description",
        "hash",
        "gateway_status",
        "response_payload",
        "created_at"
      ],
      outgoing_gateway_request: [
        "txn_id",
        "amount",
        "currency",
        "hash",
        "merchant_key",
        "payment_method",
        "udf_fields",
        "request_payload",
        "created_at"
      ],
      mandate: [
        "mandate_id",
        "frequency",
        "max_amount",
        "mandate_type",
        "status",
        "source_object_id",
        "created_at",
        "updated_at"
      ]
    },
    rationale: "To properly debug PayU integrity failures, we need these fields to: (1) detect transaction type via txn_object_type and internal_metadata, (2) check skip conditions via payment_method_type, (3) verify amount comparison via gateway_response vs order/mandate amounts, (4) trace what we sent to gateway vs what it returned. The skip conditions in payuPayUResponseReq and payuTxndetailSyncRespIntegrity only check for isPennyMandateTxn and isEnachOrEmandateRegister (which only handles NB/CARD, not UPI)."
  };
}

// ============================================================================
// STEP 4: Log Collection Mock Response
// ============================================================================

export function getMockStep4LogCollection(): any {
  logger.info('[MOCK] Returning collected logs');

  return {
    txn_detail: {
      txn_id: "merchant-abc-ORDER123XYZ-1",
      txn_uuid: "abcd1234efgh5678",
      txn_object_type: "EMANDATE_REGISTER",
      source_object_id: "11111111111",
      merchant_id: "test_merchant",
      txn_amount: 1,
      currency: "INR",
      internal_metadata: "{\"useMoneyFramework\":true,\"mandateTxnInfo\":{\"txnType\":\"REGISTER_AND_DEBIT\",\"debitAmount\":1}}",
      gateway: "PAYU",
      status: "AUTHORIZATION_FAILED",
      gateway_txn_id: "12345678901",
      created_at: "2026-02-19T12:57:20Z",
      updated_at: "2026-02-19T14:03:48Z",
      payment_method_type: "UPI",
      card_isin: "NOT_FOUND",
      txn_date: "2026-02-19"
    },
    order_reference: {
      id: "22222222222",
      order_id: "ORDER123XYZ",
      amount: 1,
      currency: "INR",
      status: "AUTHORIZATION_FAILED",
      metadata: "{}",
      merchant_id: "test_merchant",
      created_at: "2026-02-19T12:57:20Z"
    },
    gateway_response: {
      status: "failure",
      transaction_amount: "120873.00",
      additional_charges: "0.00",
      mihpayid: "12345678901",
      card_no: "",
      payment_method: "UPI",
      error_code: "E231",
      error_description: "Transaction was marked as dropped",
      hash: "abcd1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef1234567890",
      gateway_status: "dropped",
      response_payload: "{}",
      created_at: "2026-02-19T14:03:48Z"
    },
    outgoing_gateway_request: {
      txn_id: "merchant-abc-ORDER123XYZ-1",
      amount: "120873.00",
      currency: "INR",
      hash: "NOT_FOUND",
      merchant_key: "ABCD1234",
      payment_method: "UPI",
      udf_fields: {
        udf1: "U123456789",
        udf2: "SI_INITIAL",
        udf3: "19022026",
        udf4: "Created",
        udf5: "ALL"
      },
      request_payload: "upi://mandate?pa=merchant.payu@testbank&am=120873.00&...",
      created_at: "2026-02-19T12:57:20Z"
    },
    mandate: {
      mandate_id: "mandate_abc123xyz456",
      frequency: "ONETIME",
      max_amount: 120873,
      mandate_type: "EMANDATE",
      status: "FAILURE",
      source_object_id: "11111111111",
      created_at: "2026-02-19T12:57:20Z",
      updated_at: "2026-02-19T14:03:48Z"
    }
  };
}

// ============================================================================
// STEP 5: Code Analysis Mock Response
// USING EXACT RESPONSE FROM DRY-RUN
// ============================================================================

export function getMockStep5CodeAnalysis(): any {
  logger.info('[MOCK] Returning comprehensive code analysis');

  return {
    analysis_summary: "PayU UPI eMandate REGISTER_AND_DEBIT transaction failing integrity check because amount verification is not skipped for UPI payment method. The DB txn_amount is 1 (registration amount) but gateway returns 120873.00 (the actual debit amount from mandate). The isEnachOrEmandateRegister function only checks for NB/CARD payment methods, not UPI.",
    is_our_issue: true,
    issue_type: "missing_skip_condition",
    responsible_party: "our_code",
    repository: "api-txns",
    integrity_locations_analysis: [
      {
        function_name: "payuPayUResponseReq",
        file_path: "euler-x/src-generated/Gateway/Payu/Flow.hs",
        line_numbers: "5995-6008",
        flow_type: "WEBHOOK",
        skip_conditions_present: [
          "isPennyMandateTxn - checks if penny mandate registration",
          "isEnachOrEmandateRegister txnDetail txnCardInfo - checks if NB/CARD eMandate"
        ],
        skip_conditions_missing: [
          "isUpiMandateRegisterTxn txnDetail txnCardInfo - UPI mandate registration check",
          "Check for mandateTxnInfo.txnType == REGISTER_AND_DEBIT"
        ],
        dry_run_result: "For this transaction: isPennyMandateTxn=FALSE, isEnachOrEmandateRegister=FALSE (because paymentMethod=UPI). So skipAmountVerification=FALSE. Integrity compares DB amount=1 vs Gateway amount=120873.00 -> FAILS",
        amount_field_used: "calculatedTotalTxnAmtWithCurr from gateway response transaction_amount field (120873.00)"
      },
      {
        function_name: "payuTxndetailSyncRespIntegrity",
        file_path: "euler-x/src-generated/Gateway/Payu/Flow.hs",
        line_numbers: "6008-6020",
        flow_type: "SYNC",
        skip_conditions_present: [
          "isPennyMandateTxn",
          "isEnachOrEmandateRegister txnDetail txnCardInfo"
        ],
        skip_conditions_missing: [
          "isUpiMandateRegisterTxn txnDetail txnCardInfo",
          "Check for REGISTER_AND_DEBIT transaction type"
        ],
        dry_run_result: "Same as webhook flow - skipAmountVerification=FALSE because UPI payment method not covered by isEnachOrEmandateRegister",
        amount_field_used: "calculatedTotalTxnAmtWithCurr from gateway response"
      },
      {
        function_name: "verifyMessageIntegrityV2 - PayURedirectResponse case",
        file_path: "euler-x/src-generated/Gateway/Payu/Flow.hs",
        line_numbers: "2240-2250",
        flow_type: "REDIRECT",
        skip_conditions_present: [
          "Txn.isPennyMandateRegTxn check to set maybeOrder=None",
          "isEnachOrEmandateRegister check to set maybeOrder=None"
        ],
        skip_conditions_missing: [
          "isUpiMandateRegisterTxn for amount verification skip"
        ],
        dry_run_result: "maybeOrder=Just order (not skipped because UPI mandate), integrity check happens with full amount comparison",
        amount_field_used: "gwAmount from verifyMessageForPayU"
      }
    ],
    affected_files: [
      {
        file_path: "euler-x/src-generated/Gateway/Payu/Flow.hs",
        function_name: "payuPayUResponseReq",
        line_numbers: "6001-6005",
        issue_description: "skipAmountVerification condition only checks isPennyMandateTxn and isEnachOrEmandateRegister. For UPI eMandate REGISTER_AND_DEBIT, isEnachOrEmandateRegister returns FALSE because it only checks for NB/CARD payment methods. Need to add isUpiMandateRegisterTxn check.",
        can_be_modified: true
      },
      {
        file_path: "euler-x/src-generated/Gateway/Payu/Flow.hs",
        function_name: "payuTxndetailSyncRespIntegrity",
        line_numbers: "6012-6016",
        issue_description: "Same issue as payuPayUResponseReq - skipAmountVerification doesn't account for UPI mandate registrations with REGISTER_AND_DEBIT type",
        can_be_modified: true
      }
    ],
    detailed_findings: {
      gateway_sent: "120873.00 (from outgoing_gateway_request.amount - the actual mandate max amount for REGISTER_AND_DEBIT)",
      gateway_returned: "120873.00 (from gateway_response.transaction_amount)",
      expected_amount_in_code: "1.00 (txn_amount from DB for EMANDATE_REGISTER transaction type)",
      actual_comparison_made: "DB txn_amount=1 vs Gateway transaction_amount=120873.00",
      transaction_type_detected: "EMANDATE_REGISTER with UPI payment method - detected as mandate registration",
      transaction_type_actual: "REGISTER_AND_DEBIT - UPI mandate with immediate debit of actual amount (not penny)",
      code_issues: [
        {
          problem: "isEnachOrEmandateRegister function in Gateway/Payu/Transforms.hs only checks for NB/CARD payment methods, excludes UPI",
          location: "Gateway.Payu.Transforms line ~1492 and Gateway.Payu.Flow line ~6001",
          current_logic: "isEnachOrEmandateRegister = (txnDetail.txnObjectType == Just EMANDATE_REGISTER) && (elem paymentMethodType [NB, CARD])",
          missing_check: "UPI payment method for REGISTER_AND_DEBIT transactions",
          correct_logic: "Should also skip amount verification for UPI mandate registrations when txnType is REGISTER_AND_DEBIT"
        },
        {
          problem: "Amount verification skip logic doesn't account for UPI mandate REGISTER_AND_DEBIT pattern",
          location: "payuPayUResponseReq and payuTxndetailSyncRespIntegrity functions",
          current_logic: "skipAmountVerification = isPennyMandateTxn || isEnachOrEmandateRegister txnDetail txnCardInfo",
          missing_check: "|| (isUpiMandateRegisterAndDebitTxn txnDetail txnCardInfo)",
          correct_logic: "skipAmountVerification = isPennyMandateTxn || isEnachOrEmandateRegister txnDetail txnCardInfo || (isUpiMandateRegisterTxn txnDetail txnCardInfo && isRegisterAndDebitType txnDetail)"
        }
      ]
    },
    suggested_fix: {
      type: "add_skip_condition",
      description: "Modify the skipAmountVerification condition in PayU Flow.hs to also skip amount verification for UPI eMandate REGISTER_AND_DEBIT transactions. The function isUpiMandateRegisterTxn already exists in Transforms.hs and correctly identifies UPI mandate registrations. We need to use this in the integrity skip logic OR create a new function that also checks mandateTxnInfo.txnType == REGISTER_AND_DEBIT.",
      code_changes: [
        {
          file: "euler-x/src-generated/Gateway/Payu/Flow.hs",
          function: "payuPayUResponseReq",
          change_type: "add_condition",
          change_description: "Change line ~6001 from: skipAmountVerification = isPennyMandateTxn || (isEnachOrEmandateRegister txnDetail txnCardInfo) To: skipAmountVerification = isPennyMandateTxn || (isEnachOrEmandateRegister txnDetail txnCardInfo) || (isUpiMandateRegisterTxn txnDetail txnCardInfo && isRegisterAndDebitTxn txnDetail)"
        },
        {
          file: "euler-x/src-generated/Gateway/Payu/Flow.hs",
          function: "payuTxndetailSyncRespIntegrity",
          change_type: "add_condition",
          change_description: "Change line ~6014 similarly to include UPI mandate REGISTER_AND_DEBIT check"
        }
      ],
      core_files_identified_but_not_modified: [
        "VerifyIntegrityService.hs - core service that performs the actual comparison, not modified",
        "IntegrityWorkflow.hs - framework file that orchestrates integrity checks, not modified",
        "IntegrityFramework/Types.hs - defines IntegrityOutput structure, not modified"
      ]
    },
    pr_description_draft: "## Fix: Skip amount verification for UPI eMandate REGISTER_AND_DEBIT transactions in PayU\n\n### Problem\nUPI eMandate transactions with `txnType: REGISTER_AND_DEBIT` are failing integrity checks because our code compares the DB txn_amount (1.00 for registration) against the gateway returned amount (actual debit amount from mandate, e.g., 120873.00).\n\n### Root Cause\nThe `skipAmountVerification` condition in PayU's integrity handlers only checks:\n1. `isPennyMandateTxn` - for penny mandate registrations  \n2. `isEnachOrEmandateRegister` - which ONLY covers NB/CARD payment methods\n\nFor UPI mandate registrations, `isEnachOrEmandateRegister` returns FALSE because it explicitly checks for `[NB, CARD]` payment methods, excluding UPI.\n\n### Transaction Example\n- **Txn ID**: merchant-abc-ORDER123XYZ-1\n- **Txn Object Type**: EMANDATE_REGISTER\n- **Payment Method**: UPI\n- **Mandate Txn Type**: REGISTER_AND_DEBIT\n- **DB Amount**: 1.00\n- **Gateway Amount**: 120873.00\n- **Result**: AMOUNT_MISMATCH integrity failure\n\n### Solution\nAdd UPI mandate REGISTER_AND_DEBIT check to the amount verification skip logic in:\n1. `payuPayUResponseReq` function (line ~6001)\n2. `payuTxndetailSyncRespIntegrity` function (line ~6014)\n\nUse existing `isUpiMandateRegisterTxn` function (already imported from Transforms.hs) combined with a check for REGISTER_AND_DEBIT transaction type.\n\n### Files Changed\n- `euler-x/src-generated/Gateway/Payu/Flow.hs` - Updated skipAmountVerification conditions\n\n### Testing\n- [ ] UPI mandate REGISTER_AND_DEBIT transactions should pass integrity\n- [ ] NB/CARD mandate registrations should continue to work\n- [ ] Regular UPI payments should not be affected",
    gateway_escalation_details: null
  };
}
