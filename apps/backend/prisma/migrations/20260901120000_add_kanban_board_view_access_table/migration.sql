-- CreateTable
CREATE TABLE "kanban_board_view_access" (
    "workspaceId" TEXT NOT NULL,
    "id" TEXT NOT NULL,
    "viewId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sharedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kanban_board_view_access_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "kanban_board_view_access_userId_viewId_key" ON "kanban_board_view_access"("userId", "viewId");

-- CreateIndex
CREATE INDEX "kanban_board_view_access_viewId_idx" ON "kanban_board_view_access"("viewId");

-- AddForeignKey
ALTER TABLE "kanban_board_view_access" ADD CONSTRAINT "kanban_board_view_access_viewId_fkey" FOREIGN KEY ("viewId") REFERENCES "saved_user_configurations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kanban_board_view_access" ADD CONSTRAINT "kanban_board_view_access_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
