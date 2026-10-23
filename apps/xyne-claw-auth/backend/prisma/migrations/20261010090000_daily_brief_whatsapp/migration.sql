-- AlterTable
ALTER TABLE "users" ADD COLUMN     "dailyBriefWhatsappEnabled" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "dailyBriefWhatsappChangedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "generated_content" ADD COLUMN     "whatsappDeliveredAt" TIMESTAMP(3);
