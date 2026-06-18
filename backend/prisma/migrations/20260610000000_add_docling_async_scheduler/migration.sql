-- Async OCR (Docling/LightOn) scheduler state-machine tables.
-- Placed in the non_zero schema (backend-internal, not Zero-synced).
-- No foreign keys: the datasource uses relationMode = "prisma", so referential
-- integrity is emulated by Prisma (the parts→files relation has no DB FK).

CREATE SCHEMA IF NOT EXISTS "non_zero";

-- CreateTable
CREATE TABLE "non_zero"."docling_async_files" (
    "file_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "source_path" TEXT NOT NULL,
    "source_storage_key" TEXT,
    "stage_dir" TEXT,
    "results_dir" TEXT,
    "base_priority" INTEGER NOT NULL DEFAULT 0,
    "priority_override" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'pending_split',
    "total_pages" INTEGER NOT NULL DEFAULT 0,
    "total_parts" INTEGER NOT NULL DEFAULT 0,
    "page_chunk_size" INTEGER NOT NULL DEFAULT 0,
    "ready_parts_count" INTEGER NOT NULL DEFAULT 0,
    "write_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "split_attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lease_owner" TEXT,
    "lease_token" TEXT,
    "lease_until" TIMESTAMP(3),
    "ocr_activated_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "docling_async_files_pkey" PRIMARY KEY ("file_id")
);

-- CreateTable
CREATE TABLE "non_zero"."docling_async_parts" (
    "file_id" TEXT NOT NULL,
    "part_index" INTEGER NOT NULL,
    "doc_id" TEXT NOT NULL,
    "current_job_id" TEXT,
    "part_path" TEXT NOT NULL,
    "result_path" TEXT,
    "start_page" INTEGER NOT NULL,
    "end_page" INTEGER NOT NULL,
    "part_size_bytes" INTEGER NOT NULL DEFAULT 0,
    "page_count" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "attempt_count" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "ready_at" TIMESTAMP(3),
    "written_at" TIMESTAMP(3),
    "lease_owner" TEXT,
    "lease_until" TIMESTAMP(3),
    "submit_permit_id" TEXT,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "docling_async_parts_pk" PRIMARY KEY ("file_id","part_index")
);

-- CreateIndex
CREATE INDEX "docling_async_files_status_priority_idx" ON "non_zero"."docling_async_files"("status", "available_at", "base_priority", "created_at");

-- CreateIndex
CREATE INDEX "docling_async_files_active_status_idx" ON "non_zero"."docling_async_files"("status", "lease_until");

-- CreateIndex
CREATE INDEX "docling_async_files_collection_idx" ON "non_zero"."docling_async_files"("collection_id");

-- CreateIndex
CREATE UNIQUE INDEX "docling_async_parts_current_job_id_uidx" ON "non_zero"."docling_async_parts"("current_job_id");

-- CreateIndex
CREATE INDEX "docling_async_parts_status_available_idx" ON "non_zero"."docling_async_parts"("status", "available_at", "created_at");

-- CreateIndex
CREATE INDEX "docling_async_parts_file_status_idx" ON "non_zero"."docling_async_parts"("file_id", "status");

-- CreateIndex
CREATE INDEX "docling_async_parts_file_status_part_idx" ON "non_zero"."docling_async_parts"("file_id", "status", "part_index");

-- CreateIndex
CREATE INDEX "docling_async_parts_status_file_idx" ON "non_zero"."docling_async_parts"("status", "file_id");

-- CreateIndex
CREATE INDEX "docling_async_parts_submit_permit_idx" ON "non_zero"."docling_async_parts"("submit_permit_id");
