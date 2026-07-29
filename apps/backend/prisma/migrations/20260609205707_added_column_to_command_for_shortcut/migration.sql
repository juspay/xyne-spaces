-- CreateEnum
CREATE TYPE "public"."CommandType" AS ENUM ('COMMAND', 'SHORTCUT');

-- CreateEnum
CREATE TYPE "public"."CommandAccessibility" AS ENUM ('CHAT', 'THREAD', 'BOTH', 'MESSAGE', 'GLOBAL');

-- AlterTable
ALTER TABLE "public"."app_commands" ADD COLUMN     "commandAccessibility" "public"."CommandAccessibility" NOT NULL DEFAULT 'BOTH',
ADD COLUMN     "commandType" "public"."CommandType" NOT NULL DEFAULT 'COMMAND',
ALTER COLUMN "isForThread" DROP NOT NULL,
ALTER COLUMN "isForThread" DROP DEFAULT,
ALTER COLUMN "isForChat" DROP NOT NULL,
ALTER COLUMN "isForChat" DROP DEFAULT;
