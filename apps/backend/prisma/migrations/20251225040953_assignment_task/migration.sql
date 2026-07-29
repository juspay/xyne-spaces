-- CreateTable
CREATE TABLE "user_assignment_states" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "onCall" BOOLEAN NOT NULL DEFAULT true,
    "isActiveForAssignment" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "user_assignment_states_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "board_complexity_scores" (
    "id" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "board_complexity_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_workload_mappings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "activeTasks" INTEGER NOT NULL DEFAULT 0,
    "totalTasks" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "user_workload_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_expertise_mappings" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "userGroupId" TEXT NOT NULL,
    "boardId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdBy" TEXT NOT NULL,

    CONSTRAINT "user_expertise_mappings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "user_assignment_states_userGroupId_idx" ON "user_assignment_states"("userGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "user_assignment_states_userId_userGroupId_key" ON "user_assignment_states"("userId", "userGroupId");

-- CreateIndex
CREATE INDEX "board_complexity_scores_userGroupId_idx" ON "board_complexity_scores"("userGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "board_complexity_scores_userGroupId_boardId_key" ON "board_complexity_scores"("userGroupId", "boardId");

-- CreateIndex
CREATE INDEX "user_workload_mappings_userGroupId_idx" ON "user_workload_mappings"("userGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "user_workload_mappings_userId_userGroupId_boardId_key" ON "user_workload_mappings"("userId", "userGroupId", "boardId");

-- CreateIndex
CREATE INDEX "user_expertise_mappings_userGroupId_idx" ON "user_expertise_mappings"("userGroupId");

-- CreateIndex
CREATE UNIQUE INDEX "user_expertise_mappings_userId_userGroupId_boardId_key" ON "user_expertise_mappings"("userId", "userGroupId", "boardId");
