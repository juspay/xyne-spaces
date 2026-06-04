---- Prisma model: CanvasUserStatus
CREATE TABLE "public"."canvas_user_status" (
    "id" TEXT NOT NULL,
    "canvasId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "isStarred" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3),

    CONSTRAINT "canvas_user_status_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "canvas_user_status_canvasId_userId_key"
ON "public"."canvas_user_status"("canvasId", "userId");

CREATE INDEX "canvas_user_status_canvasId_idx"
ON "public"."canvas_user_status"("canvasId");

CREATE INDEX "canvas_user_status_userId_idx"
ON "public"."canvas_user_status"("userId");

CREATE INDEX "canvas_user_status_userId_isStarred_idx"
ON "public"."canvas_user_status"("userId", "isStarred");
