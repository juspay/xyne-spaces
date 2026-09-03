-- Add kind column to experiment_runs so /understanding runs stay tagged across every epoch dispatch.
-- Default "experiment" preserves existing rows and the classic proof-reward loop.
ALTER TABLE "experiment_runs" ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'experiment';
