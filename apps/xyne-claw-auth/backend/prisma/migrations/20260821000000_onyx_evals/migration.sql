-- EnterpriseRAG-Bench (Onyx) eval harness — run RESULTS only. The dataset
-- (questions / gold answers / facts) is input posted with each run, and the
-- corpus lives only in the separate eval Vespa, so these tables carry no
-- workspaceId by design — like the other eval tables.

CREATE TABLE "public"."onyx_eval_runs" (
    "id"              TEXT        NOT NULL,
    "status"          TEXT        NOT NULL DEFAULT 'running',
    "config"          JSONB       NOT NULL,
    "aggregate"       JSONB,
    "total_questions" INTEGER     NOT NULL DEFAULT 0,
    "processed"       INTEGER     NOT NULL DEFAULT 0,
    "corrections"     INTEGER     NOT NULL DEFAULT 0,
    "last_error"      TEXT,
    "created_by"      TEXT,
    "org_id"          TEXT,
    "started_at"      TIMESTAMPTZ NOT NULL DEFAULT now(),
    "finished_at"     TIMESTAMPTZ,
    CONSTRAINT "onyx_eval_runs_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "onyx_eval_runs_status_started_at_idx" ON "public"."onyx_eval_runs"("status", "started_at");

CREATE TABLE "public"."onyx_eval_questions" (
    "run_id"                 TEXT      NOT NULL,
    "question_id"            TEXT      NOT NULL,
    "question_type"          TEXT      NOT NULL,
    "question"               TEXT      NOT NULL,
    "retrieved"              JSONB     NOT NULL,
    "raw_answer"             TEXT,
    "answer_text"            TEXT,
    "cited_doc_ids"          TEXT[]    NOT NULL DEFAULT '{}',
    "correctness"            SMALLINT,
    "correctness_reasoning"  TEXT,
    "completeness"           REAL,
    "fact_supported"         BOOLEAN[] NOT NULL DEFAULT '{}',
    "gold_votes"             JSONB,
    "valid_doc_ids"          TEXT[]    NOT NULL DEFAULT '{}',
    "invalid_extra"          INTEGER,
    "document_recall"        REAL,
    "corrected"              BOOLEAN   NOT NULL DEFAULT false,
    "gold_doc_ids_original"  TEXT[]    NOT NULL DEFAULT '{}',
    "gold_doc_ids_corrected" TEXT[]    NOT NULL DEFAULT '{}',
    "gold_answer"            TEXT,
    "answer_facts"           TEXT[]    NOT NULL DEFAULT '{}',
    "dsid_to_synthetic"      JSONB     NOT NULL DEFAULT '{}',
    "error"                  TEXT,
    "created_at"             TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT "onyx_eval_questions_pkey" PRIMARY KEY ("run_id", "question_id"),
    CONSTRAINT "onyx_eval_questions_run_id_fkey" FOREIGN KEY ("run_id")
        REFERENCES "public"."onyx_eval_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "onyx_eval_questions_run_type_idx" ON "public"."onyx_eval_questions"("run_id", "question_type");
CREATE INDEX "onyx_eval_questions_run_correctness_idx" ON "public"."onyx_eval_questions"("run_id", "correctness");
