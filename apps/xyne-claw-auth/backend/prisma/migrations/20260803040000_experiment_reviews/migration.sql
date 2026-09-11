-- Second-agent verdicts on findings. Advisory only: a review never mutates
-- experiment_findings.status.
CREATE TABLE "experiment_reviews" (
  "id"           TEXT NOT NULL,
  "experimentId" TEXT NOT NULL,
  "findingId"    TEXT NOT NULL,
  "epoch"        INTEGER NOT NULL,
  "verdict"      TEXT NOT NULL,
  "reason"       TEXT NOT NULL,
  "duplicateOf"  TEXT,
  "createdAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "experiment_reviews_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "experiment_reviews_findingId_epoch_key" ON "experiment_reviews"("findingId", "epoch");
CREATE INDEX "experiment_reviews_experimentId_idx" ON "experiment_reviews"("experimentId");

ALTER TABLE "experiment_reviews" ADD CONSTRAINT "experiment_reviews_experimentId_fkey"
  FOREIGN KEY ("experimentId") REFERENCES "experiment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "experiment_reviews" ADD CONSTRAINT "experiment_reviews_findingId_fkey"
  FOREIGN KEY ("findingId") REFERENCES "experiment_findings"("id") ON DELETE CASCADE ON UPDATE CASCADE;
