-- CreateTable
CREATE TABLE "user_profiles" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dob" TIMESTAMP(3),
    "phoneNumber" TEXT,
    "displayName" TEXT,
    "team" TEXT,
    "pronunciation" TEXT,
    "manager" TEXT,
    "joinedOn" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_profiles_userId_key" ON "user_profiles"("userId");

-- CreateIndex
CREATE INDEX "user_profiles_userId" ON "user_profiles"("userId");

-- Add status fields to user_presence table
ALTER TABLE "user_presence" 
ADD COLUMN "statusEmoji" TEXT,
ADD COLUMN "statusContent" TEXT,
ADD COLUMN "statusExpiryAt" TIMESTAMP(3);
