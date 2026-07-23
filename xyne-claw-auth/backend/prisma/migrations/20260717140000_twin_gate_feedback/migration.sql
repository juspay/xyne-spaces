-- Gate decision + "should have responded" feedback on behavioural signals.
ALTER TABLE "twin_behavior_signals" ADD COLUMN "gateDecision" TEXT;
ALTER TABLE "twin_behavior_signals" ADD COLUMN "gateConfidence" DOUBLE PRECISION;
ALTER TABLE "twin_behavior_signals" ADD COLUMN "gateReason" TEXT;
ALTER TABLE "twin_behavior_signals" ADD COLUMN "gateAt" TIMESTAMP(3);
ALTER TABLE "twin_behavior_signals" ADD COLUMN "shouldHaveResponded" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "twin_behavior_signals_userId_shouldHaveResponded_idx"
  ON "twin_behavior_signals" ("userId", "shouldHaveResponded");
