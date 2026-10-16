-- Every activity is now classified XOR → LLM → fallback. The label its creator used to
-- hardcode is kept here as that last fallback; the row itself starts as PENDING_CLASSIFY.
ALTER TABLE "public"."activities" ADD COLUMN "fallbackClassification" TEXT;
