-- EnterpriseRAG-Bench eval bookkeeping (onyx only). Intra-run artifacts, NOT
-- tenant data: no workspaceId by design — the benchmark corpus lives only in
-- the separate Vespa, so these tables live in `public` and are exempt from the
-- tenant ACL/stamp middleware. One row per /api/onyx-eval/run-claw, one row
-- per question within it.

CREATE TABLE "public"."onyx_eval_run" (
    "id"              TEXT        NOT NULL,
    "started_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "finished_at"     TIMESTAMPTZ,
    "status"          TEXT        NOT NULL DEFAULT 'running',
    "config"          JSONB       NOT NULL,
    "aggregate"       JSONB,
    "total_questions" INTEGER     NOT NULL DEFAULT 0,
    "processed"       INTEGER     NOT NULL DEFAULT 0,
    "corrections"     INTEGER     NOT NULL DEFAULT 0,
    "last_error"      TEXT,
    CONSTRAINT "onyx_eval_run_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "public"."onyx_eval_question" (
    "run_id"                TEXT    NOT NULL,
    "question_id"           TEXT    NOT NULL,
    "question_type"         TEXT    NOT NULL,
    "retrieved"             JSONB   NOT NULL,
    "raw_answer"            TEXT,
    "answer_text"           TEXT,
    "cited_doc_ids"         TEXT[]  NOT NULL DEFAULT '{}',
    "correctness"           SMALLINT,
    "correctness_reasoning" TEXT,
    "completeness"          REAL,
    "fact_supported"        BOOLEAN[] NOT NULL DEFAULT '{}',
    "gold_votes"            JSONB,
    "valid_doc_ids"         TEXT[]  NOT NULL DEFAULT '{}',
    "invalid_extra"         INTEGER,
    "document_recall"       REAL,
    "corrected"             BOOLEAN NOT NULL DEFAULT false,
    "gold_doc_ids_original" TEXT[]  NOT NULL DEFAULT '{}',
    "gold_doc_ids_corrected" TEXT[]  NOT NULL DEFAULT '{}',
    "dsid_to_synthetic"     JSONB   NOT NULL,
    "error"                 TEXT,
    CONSTRAINT "onyx_eval_question_pkey" PRIMARY KEY ("run_id", "question_id"),
    CONSTRAINT "onyx_eval_question_run_id_fkey" FOREIGN KEY ("run_id")
        REFERENCES "public"."onyx_eval_run"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "onyx_eval_question_run_type_idx" ON "public"."onyx_eval_question"("run_id", "question_type");
CREATE INDEX "onyx_eval_question_run_correctness_idx" ON "public"."onyx_eval_question"("run_id", "correctness");
