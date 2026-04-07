-- Create non_zero schema if it doesn't exist
CREATE SCHEMA IF NOT EXISTS "non_zero";

-- Create UserSkill table in non_zero schema with composite primary key
CREATE TABLE "non_zero"."user_skills" (
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "user_skills_pkey" PRIMARY KEY ("userId", "name")
);