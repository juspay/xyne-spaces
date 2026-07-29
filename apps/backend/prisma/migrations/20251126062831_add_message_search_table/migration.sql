-- CreateTable
CREATE TABLE "message_search" (
    "messageId" TEXT NOT NULL,
    "plaintextContent" TEXT NOT NULL,
    "searchVector" tsvector NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "message_search_pkey" PRIMARY KEY ("messageId")
);

-- AddForeignKey
ALTER TABLE "message_search" ADD CONSTRAINT "message_search_messageId_fkey" FOREIGN KEY ("messageId") REFERENCES "messages"("messageId") ON DELETE CASCADE ON UPDATE CASCADE;

